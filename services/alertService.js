import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { MarketEvent } from '../models/MarketEvent.js';
import { symbolService } from './symbolService.js';
import { pivotService } from './pivotService.js';
import { screenshotService } from './screenshotService.js';
import { telegramService } from './telegramService.js';
import { marketDataService } from './marketDataService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.join(__dirname, '../public/screenshots');

class AlertService extends EventEmitter {
  constructor() {
    super();
    this.io = null;

    // Per-symbol level trigger states: symbol -> { R3: { status, touchCount, lastTriggerPrice, lastTriggerTime }, ... }
    this.symbolLevelStates = new Map();
    this.isProcessingAlert = false;
    this.lastProcessedDateStr = new Date().toISOString().split('T')[0];
    this.dailyResetTimer = null;
  }

  async initialize(socketServer) {
    logger.alert('Initializing Multi-Symbol Level Touch Alert Engine...');
    this.io = socketServer;

    // Listen to market ticks
    marketDataService.on('tick', (data) => {
      this.evaluateMarketPrice(data);
    });

    // Listen to new pivot levels and rollover
    pivotService.on('pivot:updated', ({ symbol, state }) => {
      logger.alert(`🔄 Alert Engine re-binding to pivot levels for ${symbol}: R3=${state?.r3}, R2=${state?.r2}, S2=${state?.s2}, S3=${state?.s3}`);
      this.resetAllLevelStates(symbol);
    });

    // Start Daily Session Rollover & Midnight Reset worker (checks every 30s)
    if (this.dailyResetTimer) clearInterval(this.dailyResetTimer);
    this.dailyResetTimer = setInterval(() => this.checkDailyRolloverReset(), 30000);

    // Run initial cleanup to keep max 6 latest records
    await this.enforceMaxHistory(6);

    logger.alert('Level Touch Alert Engine ready.');
  }

  /**
   * Periodic check to ensure level alert states are 100% refreshed every new day / session
   */
  checkDailyRolloverReset() {
    const todayDateStr = new Date().toISOString().split('T')[0];
    if (this.lastProcessedDateStr !== todayDateStr) {
      logger.alert(`🌅 Midnight UTC Rollover detected (${this.lastProcessedDateStr} -> ${todayDateStr}). Resetting all level alert states to READY.`);
      this.lastProcessedDateStr = todayDateStr;
      for (const sym of this.symbolLevelStates.keys()) {
        this.resetAllLevelStates(sym);
      }
    }

    // Safety auto-rearm: If any level was triggered > 12 hours ago, auto-rearm to READY
    const now = Date.now();
    for (const [sym, states] of this.symbolLevelStates.entries()) {
      for (const [lvl, st] of Object.entries(states)) {
        if (st.lastTriggerTime && (st.status === 'TRIGGERED' || st.status === 'COMPLETED')) {
          const elapsed = now - new Date(st.lastTriggerTime).getTime();
          if (elapsed > 12 * 60 * 60 * 1000) {
            logger.info(`⏰ Auto-rearming stale level ${lvl} for ${sym} (last touch was ${Math.round(elapsed / 3600000)}h ago).`);
            st.status = 'READY';
            st.touchCount = 0;
            if (this.io) this.io.emit('alert:states', this.getAllLevelStates(sym));
          }
        }
      }
    }
  }

  getLevelState(symbolStr, levelName) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).replace(/^.*:/, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (!this.symbolLevelStates.has(sym)) {
      this.symbolLevelStates.set(sym, {
        R3: { status: 'READY', touchCount: 0, lastTriggerPrice: null, lastTriggerTime: null },
        R2: { status: 'READY', touchCount: 0, lastTriggerPrice: null, lastTriggerTime: null },
        R1: { status: 'READY', touchCount: 0, lastTriggerPrice: null, lastTriggerTime: null },
        PIVOT: { status: 'READY', touchCount: 0, lastTriggerPrice: null, lastTriggerTime: null },
        S1: { status: 'READY', touchCount: 0, lastTriggerPrice: null, lastTriggerTime: null },
        S2: { status: 'READY', touchCount: 0, lastTriggerPrice: null, lastTriggerTime: null },
        S3: { status: 'READY', touchCount: 0, lastTriggerPrice: null, lastTriggerTime: null }
      });
    }
    return this.symbolLevelStates.get(sym)[levelName];
  }

  getAllLevelStates(symbolStr) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).replace(/^.*:/, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (!this.symbolLevelStates.has(sym)) {
      this.getLevelState(sym, 'R3'); // Initializer
    }
    const stateObj = this.symbolLevelStates.get(sym);
    const result = {};
    for (const [k, v] of Object.entries(stateObj)) {
      result[k] = { status: v.status, touchCount: v.touchCount || 0, maxTouches: 2 };
    }
    return result;
  }

  resetAllLevelStates(symbolStr) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).replace(/^.*:/, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (this.symbolLevelStates.has(sym)) {
      const states = this.symbolLevelStates.get(sym);
      for (const key of Object.keys(states)) {
        states[key] = { status: 'READY', touchCount: 0, lastTriggerPrice: null, lastTriggerTime: null };
      }
    } else {
      this.getLevelState(sym, 'R3');
    }
    logger.alert(`✨ All level alert states for ${sym} have been reset to READY (touchCount=0) for new session period.`);
    if (this.io) {
      this.io.emit('alert:states', this.getAllLevelStates(sym));
    }
  }

  resetLevelState(symbolStr, levelName) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).replace(/^.*:/, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const state = this.getLevelState(sym, levelName);
    if (state) {
      state.status = 'READY';
      state.touchCount = 0;
      state.lastTriggerPrice = null;
      state.lastTriggerTime = null;
      logger.info(`Level ${levelName} for ${sym} manually reset to READY.`);
      if (this.io) {
        this.io.emit('alert:states', this.getAllLevelStates(sym));
      }
    }
  }


  /**
   * Core Level-Touch Evaluation Function with Tick Crossing & Range Detection
   * Enforces 2 triggers/screenshots per level per active pivot period with automatic daily refresh.
   */
  evaluateMarketPrice(marketData) {
    if (this.isProcessingAlert) return;

    const sym = (marketData.rawSymbol || symbolService.getActiveSymbol()).toUpperCase();
    const config = pivotService.getConfig(sym);
    if (!config || !config.enabled) return;

    const pivot = pivotService.getActivePivotState();
    if (!pivot || !pivot.isValid) return;

    const currentPrice = parseFloat(marketData.price);
    if (isNaN(currentPrice)) return;
    const prevPrice = marketData.previousPrice !== null && !isNaN(marketData.previousPrice) ? parseFloat(marketData.previousPrice) : currentPrice;
    const tolerance = parseFloat(config.tolerance || 0.20);
    const retriggerDistance = parseFloat(config.retriggerDistance || 1.00);

    const levelsToEvaluate = [
      { name: 'R3', target: pivot.r3, direction: 'TOUCH_RESISTANCE' },
      { name: 'R2', target: pivot.r2, direction: 'TOUCH_RESISTANCE' },
      { name: 'S2', target: pivot.s2, direction: 'TOUCH_SUPPORT' },
      { name: 'S3', target: pivot.s3, direction: 'TOUCH_SUPPORT' }
    ];

    for (const lvl of levelsToEvaluate) {
      if (lvl.target === undefined || lvl.target === null || isNaN(lvl.target)) continue;

      const state = this.getLevelState(sym, lvl.name);
      if (!state) continue;

      // 2-touch lock check: if level is already COMPLETED / LOCKED / has >=2 touches, check hysteresis
      if (state.status === 'COMPLETED' || state.status === 'LOCKED' || (state.touchCount || 0) >= 2) {
        continue;
      }

      const diff = Math.abs(currentPrice - lvl.target);
      
      // 1. Range Touch Check: within tolerance band
      const isTouching = diff <= tolerance;

      // 2. Tick Crossing Check: price crossed over the level
      const crossedUp = prevPrice < lvl.target && currentPrice >= lvl.target;
      const crossedDown = prevPrice > lvl.target && currentPrice <= lvl.target;
      const isCrossing = crossedUp || crossedDown;

      // Hysteresis & Debounce state transition check
      if (state.status === 'TRIGGERED' || state.status === 'PREVIOUSLY_TOUCHED') {
        const distanceFromLast = Math.abs(currentPrice - (state.lastTriggerPrice || lvl.target));
        
        if (state.status === 'TRIGGERED' && distanceFromLast >= retriggerDistance) {
          state.status = 'PREVIOUSLY_TOUCHED';
          logger.info(`Level ${lvl.name} (${sym}) transitioned to PREVIOUSLY_TOUCHED. Distance moved: ${distanceFromLast.toFixed(2)} (>= threshold ${retriggerDistance.toFixed(2)})`);
          if (this.io) this.io.emit('alert:states', this.getAllLevelStates(sym));
        }

        if (state.status === 'PREVIOUSLY_TOUCHED' && distanceFromLast >= (retriggerDistance * 2.0)) {
          if ((state.touchCount || 0) < 2) {
            state.status = 'READY';
            logger.info(`Level ${lvl.name} (${sym}) re-armed to READY for touch #${(state.touchCount || 0) + 1}/2. Distance: ${distanceFromLast.toFixed(2)}`);
            if (this.io) this.io.emit('alert:states', this.getAllLevelStates(sym));
          } else {
            state.status = 'COMPLETED';
            logger.info(`Level ${lvl.name} (${sym}) has completed 2 touches for current period. Locking level until next session.`);
            if (this.io) this.io.emit('alert:states', this.getAllLevelStates(sym));
          }
        }
      }

      // Trigger condition: Touching or Crossing while in READY state AND touchCount < 2
      if ((isTouching || isCrossing) && state.status === 'READY' && (state.touchCount || 0) < 2) {
        const nextTouchCount = (state.touchCount || 0) + 1;
        state.touchCount = nextTouchCount;
        const reason = `${sym} touched ${lvl.name} (Touch ${nextTouchCount}/2) @ $${currentPrice.toFixed(2)} (Target: $${lvl.target.toFixed(2)}, Tolerance: ±$${tolerance.toFixed(2)})`;

        // Execute alert pipeline asynchronously (non-blocking)
        this.triggerAlertPipeline({
          symbol: sym,
          displayName: marketData.displayName || sym,
          level: lvl.name,
          levelPrice: lvl.target,
          currentPrice,
          previousPrice: prevPrice,
          direction: crossedUp ? 'CROSS_UP' : (crossedDown ? 'CROSS_DOWN' : lvl.direction),
          tolerance,
          triggerReason: reason,
          isTest: false,
          pivotPeriod: pivot.periodDateStr || 'DAILY',
          pivotType: pivot.pivotType,
          pivotTimeframe: pivot.pivotTimeframe,
          touchCount: nextTouchCount
        }).catch(err => {
          logger.error(`Alert pipeline error: ${err.message}`);
        });
        break;
      }
    }
  }

  /**
   * On-demand manual test alert trigger (used by TestConsoleModal)
   */
  async triggerTestAlert(levelName = 'R2', customPrice = null) {
    const sym = symbolService.getActiveSymbol();
    const pivot = pivotService.getActivePivotState();
    const config = pivotService.getConfig(sym);
    const lvlKey = levelName.toLowerCase();
    const targetPrice = customPrice !== null && customPrice !== undefined && !isNaN(customPrice)
      ? parseFloat(customPrice)
      : (pivot?.[lvlKey] || config[lvlKey] || 4657.48);

    const state = this.getLevelState(sym, levelName.toUpperCase());
    const nextTouchCount = state ? Math.min((state.touchCount || 0) + 1, 2) : 1;
    const reason = `[TEST MODE] Simulated Touch ${nextTouchCount}/2 on ${sym} Level ${levelName.toUpperCase()} @ $${targetPrice.toFixed(2)}`;

    return await this.triggerAlertPipeline({
      symbol: sym,
      displayName: symbolService.getActiveSymbolConfig()?.displayName || sym,
      level: levelName.toUpperCase(),
      levelPrice: targetPrice,
      currentPrice: targetPrice,
      previousPrice: targetPrice - 1.0,
      direction: levelName.toUpperCase().startsWith('R') ? 'TOUCH_RESISTANCE' : 'TOUCH_SUPPORT',
      tolerance: config.tolerance || 0.20,
      triggerReason: reason,
      isTest: true,
      pivotPeriod: pivot?.periodDateStr || 'DAILY',
      pivotType: pivot?.pivotType || config.pivotType,
      pivotTimeframe: pivot?.pivotTimeframe || config.pivotTimeframe,
      touchCount: nextTouchCount
    });
  }

  /**
   * Executes full alert pipeline: Fast Socket Broadcast -> Screenshot -> Telegram -> MongoDB
   */
  async triggerAlertPipeline(alertParams) {
    this.isProcessingAlert = true;

    // Safety timeout to prevent isProcessingAlert from ever hanging indefinitely
    const safetyTimeout = setTimeout(() => {
      this.isProcessingAlert = false;
    }, 15000);

    try {
      const sym = (alertParams.symbol || symbolService.getActiveSymbol()).replace(/^.*:/, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const currentTouch = alertParams.touchCount || 1;



      // Update state
      const state = this.getLevelState(sym, alertParams.level);
      
      // Strict 2-touch lock gate: block live market alerts if level is already locked
      if (!alertParams.isTest && state && (state.status === 'COMPLETED' || state.status === 'LOCKED') && state.touchCount >= 2) {
        logger.warn(`🛑 Alert suppressed: Level ${alertParams.level} for ${sym} is locked (2/2 touches reached).`);
        return null;
      }

      logger.alert(`>>> TRIGGERING ALERT (Touch ${currentTouch}/2${currentTouch >= 2 ? ' - LEVEL LOCKED' : ''}): ${sym} ${alertParams.level} @ $${alertParams.currentPrice} (${alertParams.isTest ? 'TEST MODE' : 'LIVE MARKET'}) <<<`);

      if (state) {
        state.touchCount = currentTouch;
        state.status = currentTouch >= 2 ? 'COMPLETED' : 'TRIGGERED';
        state.lastTriggerPrice = alertParams.currentPrice;
        state.lastTriggerTime = new Date();
      }

      const config = pivotService.getConfig(sym);
      const symConfig = symbolService.getSymbol(sym) || symbolService.getActiveSymbolConfig();

      // 1. FAST BROADCAST: Immediately emit to Web & Mobile clients so alarms sound with ZERO delay
      const tempId = `evt-${Date.now()}`;
      const earlyEvent = {
        _id: tempId,
        id: tempId,
        symbol: sym,
        assetType: symConfig?.assetType || 'COMMODITY',
        exchange: symConfig?.exchange || 'OANDA',
        currentPrice: alertParams.currentPrice,
        previousPrice: alertParams.previousPrice,
        level: alertParams.level,
        levelPrice: alertParams.levelPrice,
        direction: alertParams.direction,
        tolerance: alertParams.tolerance,
        triggerReason: alertParams.triggerReason,
        screenshotPath: '',
        telegramStatus: 'PENDING',
        isTest: !!alertParams.isTest,
        timestamp: new Date()
      };

      if (this.io) {
        this.io.emit('alert:triggered', {
          event: earlyEvent,
          alertStates: this.getAllLevelStates(sym),
          distances: marketDataService.getMarketData().distances
        });
        this.io.emit('alert_triggered', earlyEvent);
      }

      // 2. Generate Real TradingView Screenshot (with guaranteed touch & Resvg fallback)
      let screenshotData = { filename: '', fullPath: '', relativePath: '', buffer: null };
      try {
        screenshotData = await screenshotService.generateChartScreenshot({
          ...alertParams,
          symbol: symConfig?.tradingViewTicker || `OANDA:${sym}`,
          timeframe: config.chartTimeframe || '15',
          range: config.chartRange || '1D',
          barSpacing: config.barSpacing || 22,
          pivotConfig: config,
          timestamp: new Date()
        });
      } catch (screenErr) {
        logger.error(`Screenshot generation notice in alert pipeline: ${screenErr.message}`);
      }

      const screenshotPath = screenshotData.cloudinaryUrl || screenshotData.relativePath || '';

      // 3. Dispatch Telegram Notification with screenshot
      let telegramResult = { success: false, messageId: null, error: null };
      if (config.telegramAlertsEnabled !== false) {
        try {
          telegramResult = await telegramService.sendAlertNotification(
            {
              ...alertParams,
              symbol: symConfig?.displayName || sym,
              tradingViewTicker: symConfig?.tradingViewTicker,
              pivot: config.pivot,
              timeframe: config.chartTimeframe,
              touchCount: currentTouch,
              isLocked: currentTouch >= 2
            },
            screenshotData.fullPath || screenshotData.buffer
          );
        } catch (tgErr) {
          logger.error(`Telegram delivery error in alert pipeline: ${tgErr.message}`);
          telegramResult.error = tgErr.message;
        }
      } else {
        telegramResult = { success: true, messageId: 'DISABLED', message: 'Telegram alerts disabled in settings' };
      }

      // 4. Persist Event in MongoDB
      let eventDoc = null;
      try {
        eventDoc = await MarketEvent.create({
          symbol: sym,
          assetType: symConfig?.assetType || 'COMMODITY',
          exchange: symConfig?.exchange || 'OANDA',
          currentPrice: alertParams.currentPrice,
          previousPrice: alertParams.previousPrice,
          level: alertParams.level,
          levelPrice: alertParams.levelPrice,
          direction: alertParams.direction,
          tolerance: alertParams.tolerance,
          triggerReason: alertParams.triggerReason,
          screenshotPath,
          telegramStatus: telegramResult.success ? 'SENT' : 'FAILED',
          telegramMessage: telegramResult.message,
          telegramMessageId: telegramResult.messageId,
          telegramError: telegramResult.error,
          isTest: !!alertParams.isTest,
          pivotType: alertParams.pivotType || config.pivotType,
          pivotTimeframe: alertParams.pivotTimeframe || config.pivotTimeframe,
          pivotPeriod: alertParams.pivotPeriod || 'DAILY',
          timestamp: new Date()
        });
      } catch (dbErr) {
        logger.error(`Failed to save MarketEvent to database: ${dbErr.message}`);
        eventDoc = {
          _id: tempId,
          symbol: sym,
          currentPrice: alertParams.currentPrice,
          level: alertParams.level,
          levelPrice: alertParams.levelPrice,
          direction: alertParams.direction,
          triggerReason: alertParams.triggerReason,
          screenshotPath,
          telegramStatus: telegramResult.success ? 'SENT' : 'FAILED',
          isTest: !!alertParams.isTest,
          timestamp: new Date()
        };
      }

      // 5. Enforce strict max 6 records retention
      await this.enforceMaxHistory(6);

      // 6. Update Connected Clients with finalized event doc (with screenshotPath)
      if (this.io) {
        const payload = {
          event: eventDoc,
          alertStates: this.getAllLevelStates(sym),
          distances: marketDataService.getMarketData().distances
        };

        this.io.emit('alert:triggered', payload);
        this.io.emit('alert_triggered', eventDoc);
      }

      this.emit('alertProcessed', eventDoc);
      return eventDoc;
    } finally {
      clearTimeout(safetyTimeout);
      this.isProcessingAlert = false;
    }
  }

  async enforceMaxHistory(limit = 6) {
    try {
      const allEvents = await MarketEvent.find().sort({ timestamp: -1 });
      if (allEvents.length > limit) {
        const eventsToDelete = allEvents.slice(limit);
        const idsToDelete = eventsToDelete.map(e => e._id);
        await MarketEvent.deleteMany({ _id: { $in: idsToDelete } });

        // Clean up orphaned screenshots from disk
        const currentScreenshots = new Set(
          allEvents.slice(0, limit)
            .map(e => path.basename(e.screenshotPath || ''))
            .filter(Boolean)
        );

        if (fs.existsSync(SCREENSHOTS_DIR)) {
          const diskFiles = fs.readdirSync(SCREENSHOTS_DIR);
          for (const file of diskFiles) {
            if (file !== '.gitkeep' && !currentScreenshots.has(file)) {
              try {
                fs.unlinkSync(path.join(SCREENSHOTS_DIR, file));
              } catch (e) {}
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`Could not enforce alert history limit: ${err.message}`);
    }
  }
}

export const alertService = new AlertService();
