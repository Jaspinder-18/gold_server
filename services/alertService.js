import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { MarketEvent } from '../models/MarketEvent.js';
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

    // Track active trigger status & debounce per level
    this.levelStates = {
      R3: { status: 'READY', lastTriggerPrice: null, lastTriggerTime: null },
      R2: { status: 'READY', lastTriggerPrice: null, lastTriggerTime: null },
      S2: { status: 'READY', lastTriggerPrice: null, lastTriggerTime: null },
      S3: { status: 'READY', lastTriggerPrice: null, lastTriggerTime: null }
    };

    this.isProcessingAlert = false;
  }

  async initialize(socketServer) {
    logger.alert('Initializing Level Touch Alert Engine (Monitoring R3, R2, S2, S3)...');
    this.io = socketServer;

    // Listen to continuous high-frequency market tick stream
    marketDataService.on('tick', (data) => {
      this.evaluateMarketPrice(data);
    });

    // Run initial DB & disk prune to keep strictly latest 6 records
    await this.enforceMaxHistory(6);

    logger.alert('Level Touch Alert Engine running.');
  }

  /**
   * Core Level-Touch Evaluation Function
   */
  evaluateMarketPrice(marketData) {
    if (this.isProcessingAlert) return;

    const config = pivotService.getConfig();
    if (!config || !config.enabled) return;

    const currentPrice = parseFloat(marketData.price);
    const tolerance = parseFloat(config.tolerance || '0.20');
    const retriggerDistance = parseFloat(config.retriggerDistance || '1.00');

    // Strictly evaluate only the 4 levels: R3, R2, S2, S3
    const levelsToEvaluate = [
      { name: 'R3', target: config.r3, direction: 'TOUCH_RESISTANCE' },
      { name: 'R2', target: config.r2, direction: 'TOUCH_RESISTANCE' },
      { name: 'S2', target: config.s2, direction: 'TOUCH_SUPPORT' },
      { name: 'S3', target: config.s3, direction: 'TOUCH_SUPPORT' }
    ];

    for (const lvl of levelsToEvaluate) {
      if (lvl.target === undefined || lvl.target === null || isNaN(lvl.target)) continue;

      const state = this.levelStates[lvl.name] || { status: 'READY', lastTriggerPrice: null };
      const diff = Math.abs(currentPrice - lvl.target);
      const isTouching = diff <= tolerance;

      // Check for re-trigger reset hysteresis
      if (state.status === 'TRIGGERED' || state.status === 'PREVIOUSLY_TOUCHED') {
        const distanceFromLastTrigger = Math.abs(currentPrice - (state.lastTriggerPrice || lvl.target));
        
        if (state.status === 'TRIGGERED' && distanceFromLastTrigger >= retriggerDistance) {
          state.status = 'PREVIOUSLY_TOUCHED';
          logger.info(`Level ${lvl.name} transitioned to PREVIOUSLY_TOUCHED (blue) state. Price moved away by $${distanceFromLastTrigger.toFixed(2)} (>= threshold $${retriggerDistance.toFixed(2)})`);
        }
        
        if (state.status === 'PREVIOUSLY_TOUCHED' && distanceFromLastTrigger >= (retriggerDistance * 2.0)) {
          state.status = 'READY';
          logger.info(`Level ${lvl.name} fully reset to READY (yellow) state. Ready for fresh touch alerts.`);
        }
      }

      // Trigger condition
      if (isTouching && state.status === 'READY') {
        const reason = `Gold XAU/USD touched ${lvl.name} @ $${currentPrice.toFixed(2)} (Target: $${lvl.target.toFixed(2)}, Tolerance: ±$${tolerance.toFixed(2)})`;
        
        this.triggerAlertPipeline({
          symbol: 'XAUUSD',
          level: lvl.name,
          levelPrice: lvl.target,
          currentPrice,
          previousPrice: marketData.previousPrice || currentPrice,
          direction: lvl.direction,
          tolerance,
          triggerReason: reason,
          isTest: false
        });
      }
    }
  }

  /**
   * Executes full alert pipeline: Screenshot -> Telegram -> MongoDB -> Socket.IO
   */
  async triggerAlertPipeline(alertParams) {
    this.isProcessingAlert = true;

    try {
      logger.alert(`>>> TRIGGERING ALERT: ${alertParams.level} @ $${alertParams.currentPrice} (${alertParams.isTest ? 'TEST MODE' : 'LIVE MARKET'}) <<<`);

      // Update level state lock
      if (this.levelStates[alertParams.level]) {
        this.levelStates[alertParams.level] = {
          status: 'TRIGGERED',
          lastTriggerPrice: alertParams.currentPrice,
          lastTriggerTime: new Date()
        };
      }

      const config = pivotService.getConfig();
      const klines = marketDataService.getKlines();

      // 1. Generate Real TradingView Chart Screenshot
      let screenshotData = { filename: '', fullPath: '', relativePath: '', buffer: null };
      try {
        screenshotData = await screenshotService.generateChartScreenshot({
          ...alertParams,
          klines,
          pivotConfig: config,
          timestamp: new Date()
        });
      } catch (screenErr) {
        logger.error(`Screenshot generation error in alert pipeline: ${screenErr.message}`);
      }

      // 2. Dispatch Telegram Alert with Photo & Message
      let telegramResult = { success: false, message: '' };
      if (config.telegramAlertsEnabled !== false) {
        telegramResult = await telegramService.sendAlertNotification(
          alertParams,
          screenshotData.buffer || screenshotData.fullPath
        );
      } else {
        telegramResult = { success: true, message: 'Telegram alerts disabled in configuration.' };
      }

      // 3. Persist Event in MongoDB
      const marketEvent = await MarketEvent.create({
        symbol: alertParams.symbol || 'XAUUSD',
        currentPrice: alertParams.currentPrice,
        level: alertParams.level,
        levelPrice: alertParams.levelPrice,
        direction: alertParams.direction || 'TOUCH_HIGH',
        tolerance: alertParams.tolerance || config.tolerance,
        previousPrice: alertParams.previousPrice,
        triggerReason: alertParams.triggerReason,
        screenshotPath: screenshotData.relativePath || null,
        telegramStatus: telegramResult.success ? 'SENT' : 'FAILED',
        telegramMessage: telegramResult.message,
        telegramMessageId: telegramResult.messageId ? String(telegramResult.messageId) : undefined,
        telegramError: telegramResult.error,
        isTest: alertParams.isTest || false,
        timestamp: new Date()
      });

      logger.alert(`Market Event persisted in DB with ID: ${marketEvent._id}`);

      // 4. Auto-prune database & disk to strictly keep the latest 6
      await this.enforceMaxHistory(6);

      // 5. Emit event in real-time to Dashboard via Socket.IO
      if (this.io) {
        this.io.emit('alert_triggered', {
          event: marketEvent,
          alertStates: this.levelStates,
          distances: pivotService.getDistances(alertParams.currentPrice)
        });
      }

      this.emit('alert', marketEvent);
      return marketEvent;
    } catch (err) {
      logger.error('Error in Alert Execution Pipeline', err);
      throw err;
    } finally {
      this.isProcessingAlert = false;
    }
  }

  /**
   * Automatic cleanup of database and disk records (strictly keeps maxCount = 6)
   */
  async enforceMaxHistory(maxCount = 6) {
    try {
      const allEvents = await MarketEvent.find().sort({ createdAt: -1 });
      if (allEvents.length > maxCount) {
        const toDelete = allEvents.slice(maxCount);
        for (const evt of toDelete) {
          if (evt.screenshotPath) {
            const filename = path.basename(evt.screenshotPath);
            const fullPath = path.join(SCREENSHOTS_DIR, filename);
            if (fs.existsSync(fullPath)) {
              try { fs.unlinkSync(fullPath); } catch (e) {}
            }
          }
          await MarketEvent.findByIdAndDelete(evt._id);
        }
        logger.info(`🧹 DB Auto-Prune: Removed ${toDelete.length} old alerts and screenshots (kept strictly latest ${maxCount}).`);
      }
    } catch (e) {
      logger.warn(`Error in enforceMaxHistory: ${e.message}`);
    }
  }

  /**
   * Test Mode Pipeline Trigger
   */
  async triggerTestAlert(level = 'R2', testPrice = null) {
    const config = pivotService.getConfig();
    const currentPrice = testPrice ? parseFloat(testPrice) : (config[level.toLowerCase()] || 4442.30);
    const levelPrice = config[level.toLowerCase()] || currentPrice;
    const prevPrice = parseFloat((currentPrice - 0.35).toFixed(2));

    return this.triggerAlertPipeline({
      symbol: 'XAUUSD',
      level,
      levelPrice,
      currentPrice,
      previousPrice: prevPrice,
      direction: level.startsWith('R') ? 'TOUCH_RESISTANCE' : 'TOUCH_SUPPORT',
      tolerance: config.tolerance || 0.20,
      triggerReason: `[TEST TRIGGER] Simulated test touch alert for ${level} at $${currentPrice.toFixed(2)}`,
      isTest: true
    });
  }

  getAlertStates() {
    return { ...this.levelStates };
  }

  resetLevel(level) {
    if (this.levelStates[level]) {
      this.levelStates[level] = { status: 'READY', lastTriggerPrice: null, lastTriggerTime: null };
      logger.info(`Level ${level} manually reset to READY.`);
      return true;
    }
    return false;
  }
}

export const alertService = new AlertService();
