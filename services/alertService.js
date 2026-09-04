import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';
import { MarketEvent } from '../models/MarketEvent.js';
import { AlertConfiguration } from '../models/AlertConfiguration.js';
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

    // Per-symbol active custom alert state:
    // symbol -> { targetPrice: number, enabled: boolean, status: 'ACTIVE' | 'TRIGGERED' | 'INACTIVE', eventId: string, lastTriggerPrice: number, lastTriggerTime: Date }
    this.customAlerts = new Map();
    // Non-blocking lock set to prevent duplicate trigger races: 'SYMBOL:CUSTOM'
    this.alertLocks = new Set();
  }

  async initialize(socketServer) {
    logger.alert('Initializing Central Custom Price Alert Engine...');
    this.io = socketServer;

    // 1. Load active custom price alerts from MongoDB into memory
    await this.loadActiveCustomAlertsFromDB();

    // 2. Listen to market ticks from centralized MarketDataService
    marketDataService.on('tick', (data) => {
      this.evaluateMarketPrice(data);
    });

    // 3. Listen to config updates
    pivotService.on('config:updated', ({ symbol, config }) => {
      this.syncCustomAlertFromConfig(symbol, config);
    });

    // 4. Initial history cleanup (max 6 latest records)
    if (mongoose.connection.readyState === 1) {
      await this.enforceMaxHistory(6);
    }

    logger.alert('Central Custom Price Alert Engine ready (Level-touch alert monitoring completely removed).');
  }

  /**
   * Load saved custom price alert configurations from MongoDB
   */
  async loadActiveCustomAlertsFromDB() {
    if (mongoose.connection.readyState !== 1) return;
    try {
      const configs = await AlertConfiguration.find();
      for (const cfg of configs) {
        const sym = (cfg.symbol || 'XAUUSD').toUpperCase();
        const enabled = Boolean(cfg.customPriceAlertEnabled);
        const targetPrice = parseFloat(cfg.customPriceAlertTarget) || 0;
        const status = cfg.customPriceAlertStatus || (enabled && targetPrice > 0 ? 'ACTIVE' : 'INACTIVE');

        this.customAlerts.set(sym, {
          symbol: sym,
          targetPrice,
          enabled,
          status,
          eventId: null,
          lastTriggerPrice: null,
          lastTriggerTime: null
        });
      }
      logger.info(`Loaded ${this.customAlerts.size} custom price alert configurations from database.`);
    } catch (err) {
      logger.warn(`Could not load custom alerts from DB: ${err.message}`);
    }
  }

  /**
   * Sync memory state with updated config
   */
  syncCustomAlertFromConfig(symbolStr, config) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).toUpperCase();
    if (!config) return;

    const enabled = Boolean(config.customPriceAlertEnabled);
    const targetPrice = parseFloat(config.customPriceAlertTarget) || 0;
    const status = enabled && targetPrice > 0 ? (config.customPriceAlertStatus || 'ACTIVE') : 'INACTIVE';

    this.customAlerts.set(sym, {
      symbol: sym,
      targetPrice,
      enabled,
      status,
      eventId: null,
      lastTriggerPrice: null,
      lastTriggerTime: null
    });

    this.alertLocks.delete(`${sym}:CUSTOM`);
    logger.info(`Custom alert synchronized for ${sym}: target=$${targetPrice.toFixed(2)}, enabled=${enabled}, status=${status}`);
  }

  /**
   * Get active custom alert for symbol
   */
  getCustomAlert(symbolStr) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).replace(/^.*:/, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (!this.customAlerts.has(sym)) {
      const config = pivotService.getConfig(sym);
      const enabled = Boolean(config?.customPriceAlertEnabled);
      const targetPrice = parseFloat(config?.customPriceAlertTarget) || 0;
      this.customAlerts.set(sym, {
        symbol: sym,
        targetPrice,
        enabled,
        status: enabled && targetPrice > 0 ? 'ACTIVE' : 'INACTIVE',
        eventId: null,
        lastTriggerPrice: null,
        lastTriggerTime: null
      });
    }
    return this.customAlerts.get(sym);
  }

  /**
   * Backward-compatible alert state helper (returns CUSTOM state)
   */
  getAllLevelStates(symbolStr) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).toUpperCase();
    const custom = this.getCustomAlert(sym);
    return {
      CUSTOM: {
        status: custom.status === 'ACTIVE' ? 'READY' : custom.status,
        targetPrice: custom.targetPrice,
        enabled: custom.enabled,
        lastTriggerPrice: custom.lastTriggerPrice,
        lastTriggerTime: custom.lastTriggerTime
      }
    };
  }

  getAlertStates(symbolStr) {
    return this.getAllLevelStates(symbolStr);
  }

  resetLevelState(symbolStr, levelName) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).toUpperCase();
    return this.rearmCustomAlert(sym);
  }

  resetLevel(levelName, symbolStr) {
    return this.resetLevelState(symbolStr, levelName);
  }

  resetAllLevelStates(symbolStr) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).toUpperCase();
    return this.rearmCustomAlert(sym);
  }

  /**
   * Set or update custom price alert in Online Database and broadcast to all devices
   */
  async setCustomAlert(symbolStr, targetPrice, enabled = true) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).replace(/^.*:/, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const numericTarget = parseFloat(targetPrice);

    if (isNaN(numericTarget) || numericTarget <= 0) {
      throw new Error('Target price must be a valid positive number.');
    }

    const state = {
      symbol: sym,
      targetPrice: numericTarget,
      enabled: Boolean(enabled),
      status: enabled ? 'ACTIVE' : 'INACTIVE',
      eventId: null,
      lastTriggerPrice: null,
      lastTriggerTime: null
    };

    this.customAlerts.set(sym, state);
    this.alertLocks.delete(`${sym}:CUSTOM`);

    // 1. Persist to MongoDB online database (Single Source of Truth)
    if (mongoose.connection.readyState === 1) {
      try {
        await AlertConfiguration.findOneAndUpdate(
          { symbol: sym },
          {
            symbol: sym,
            customPriceAlertEnabled: Boolean(enabled),
            customPriceAlertTarget: numericTarget,
            customPriceAlertStatus: state.status,
            customPriceAlertSetAt: new Date()
          },
          { upsert: true, new: true }
        );
      } catch (dbErr) {
        logger.error(`Failed to save custom alert to MongoDB: ${dbErr.message}`);
      }
    }

    // 2. Update PivotService in-memory alertConfigs map
    const existingAlertCfg = pivotService.alertConfigs.get(sym) || {};
    pivotService.alertConfigs.set(sym, {
      ...existingAlertCfg,
      symbol: sym,
      customPriceAlertEnabled: Boolean(enabled),
      customPriceAlertTarget: numericTarget,
      customPriceAlertStatus: state.status
    });

    // 3. Realtime Broadcast to all connected devices (Web, Mobile 1..5)
    if (this.io) {
      const payload = {
        symbol: sym,
        customPriceAlertEnabled: Boolean(enabled),
        customPriceAlertTarget: numericTarget,
        customPriceAlertStatus: state.status,
        customAlert: state,
        alertStates: this.getAllLevelStates(sym)
      };
      this.io.emit('custom_alert:updated', payload);
      this.io.emit('config:update', payload);
      this.io.emit('config_updated', payload);
      this.io.emit('alert:states', this.getAllLevelStates(sym));
    }

    logger.alert(`🎯 Custom Price Alert SET for ${sym}: $${numericTarget.toFixed(2)} (Status: ${state.status}) - Synced to all devices.`);
    return state;
  }

  /**
   * Delete / Deactivate custom price alert in Online Database and broadcast to all devices
   */
  async deleteCustomAlert(symbolStr) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).replace(/^.*:/, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    
    const state = {
      symbol: sym,
      targetPrice: 0,
      enabled: false,
      status: 'INACTIVE',
      eventId: null,
      lastTriggerPrice: null,
      lastTriggerTime: null
    };

    this.customAlerts.set(sym, state);
    this.alertLocks.delete(`${sym}:CUSTOM`);

    // 1. Clear in MongoDB online database
    if (mongoose.connection.readyState === 1) {
      try {
        await AlertConfiguration.findOneAndUpdate(
          { symbol: sym },
          {
            customPriceAlertEnabled: false,
            customPriceAlertTarget: 0,
            customPriceAlertStatus: 'INACTIVE'
          },
          { new: true }
        );
      } catch (dbErr) {
        logger.error(`Failed to delete custom alert in MongoDB: ${dbErr.message}`);
      }
    }

    // 2. Update PivotService in-memory alertConfigs map
    const existingAlertCfg = pivotService.alertConfigs.get(sym) || {};
    pivotService.alertConfigs.set(sym, {
      ...existingAlertCfg,
      symbol: sym,
      customPriceAlertEnabled: false,
      customPriceAlertTarget: 0,
      customPriceAlertStatus: 'INACTIVE'
    });

    // 3. Realtime Broadcast deletion to all connected devices
    if (this.io) {
      const payload = {
        symbol: sym,
        customPriceAlertEnabled: false,
        customPriceAlertTarget: 0,
        customPriceAlertStatus: 'INACTIVE',
        customAlert: state,
        alertStates: this.getAllLevelStates(sym)
      };
      this.io.emit('custom_alert:deleted', payload);
      this.io.emit('custom_alert:updated', payload);
      this.io.emit('config:update', payload);
      this.io.emit('config_updated', payload);
      this.io.emit('alert:states', this.getAllLevelStates(sym));
    }

    logger.alert(`🗑️ Custom Price Alert DELETED for ${sym} - White line removed, monitoring stopped.`);
    return state;
  }

  /**
   * Re-arm custom price alert to ACTIVE status
   */
  rearmCustomAlert(symbolStr) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).toUpperCase();
    const custom = this.getCustomAlert(sym);
    if (custom && custom.targetPrice > 0) {
      custom.status = 'ACTIVE';
      this.alertLocks.delete(`${sym}:CUSTOM`);
      logger.info(`Custom alert for ${sym} re-armed to ACTIVE.`);
      if (this.io) {
        this.io.emit('custom_alert:updated', { symbol: sym, customAlert: custom });
        this.io.emit('alert:states', this.getAllLevelStates(sym));
      }
      return true;
    }
    return false;
  }

  /**
   * CENTRAL PRICE TOUCH EVALUATION ENGINE
   * Continuously monitors live market ticks strictly against the online custom target.
   * NO LEVEL TOUCH (S2, S3, R2, R3) DETECTION IS PERFORMED.
   */
  evaluateMarketPrice(marketData) {
    if (!marketData || !marketData.price) return;

    const sym = (marketData.rawSymbol || symbolService.getActiveSymbol()).toUpperCase();
    const custom = this.getCustomAlert(sym);

    // Only monitor if alert is enabled, target price is valid, and state is ACTIVE
    if (!custom || !custom.enabled || custom.targetPrice <= 0 || custom.status !== 'ACTIVE') {
      return;
    }

    const currentPrice = parseFloat(marketData.price);
    if (isNaN(currentPrice) || currentPrice <= 0) return;

    const prevPrice = (marketData.previousPrice !== null && marketData.previousPrice !== undefined && !isNaN(marketData.previousPrice))
      ? parseFloat(marketData.previousPrice)
      : currentPrice;

    const config = pivotService.getConfig(sym);
    const tolerance = parseFloat(config?.tolerance || 0.20);
    const targetPrice = custom.targetPrice;
    const lockKey = `${sym}:CUSTOM`;

    // Prevent duplicate trigger if already processing this event
    if (this.alertLocks.has(lockKey)) return;

    // 1. Proximity / Range Touch Check
    const diff = Math.abs(currentPrice - targetPrice);
    const isTouching = diff <= tolerance;

    // 2. Tick Crossing Check (crossed up or crossed down)
    const crossedUp = prevPrice < targetPrice && currentPrice >= targetPrice;
    const crossedDown = prevPrice > targetPrice && currentPrice <= targetPrice;
    const isCrossing = crossedUp || crossedDown;

    if (isTouching || isCrossing) {
      // Mark state as TRIGGERED and switch OFF immediately so all devices turn OFF upon price touch
      custom.status = 'TRIGGERED';
      custom.enabled = false;
      custom.lastTriggerPrice = currentPrice;
      custom.lastTriggerTime = new Date();

      // Update PivotService in-memory alertConfigs map
      const existingAlertCfg = pivotService.alertConfigs.get(sym) || {};
      pivotService.alertConfigs.set(sym, {
        ...existingAlertCfg,
        symbol: sym,
        customPriceAlertEnabled: false,
        customPriceAlertTarget: targetPrice,
        customPriceAlertStatus: 'TRIGGERED'
      });

      const reason = `${sym} touched Custom Target Price @ $${currentPrice.toFixed(2)} (Target: $${targetPrice.toFixed(2)}, Tolerance: ±$${tolerance.toFixed(2)})`;

      logger.alert(`🚨 >>> CENTRAL ALERT TRIGGERED: ${reason} <<<`);

      // Trigger Central Alert Pipeline (generates ONE event with unique eventId)
      this.triggerAlertPipeline({
        symbol: sym,
        displayName: marketData.displayName || sym,
        level: 'CUSTOM',
        levelPrice: targetPrice,
        currentPrice,
        previousPrice: prevPrice,
        direction: crossedUp ? 'CROSS_UP' : (crossedDown ? 'CROSS_DOWN' : 'TOUCH_TARGET'),
        tolerance,
        triggerReason: reason,
        isTest: false
      }).catch(err => {
        logger.error(`Custom price alert pipeline error: ${err.message}`);
      });
    }
  }

  /**
   * Central Alert Pipeline Execution
   * Generates ONE central event with a unique event ID, captures screenshot with white line,
   * sends Telegram notification, saves to MongoDB online database, and broadcasts to all devices.
   */
  async triggerAlertPipeline(alertParams) {
    const sym = (alertParams.symbol || symbolService.getActiveSymbol()).toUpperCase();
    const symConfig = symbolService.getSymbol(sym) || symbolService.getActiveSymbolConfig();
    const config = pivotService.getConfig(sym) || {};
    const lockKey = `${sym}:CUSTOM`;

    this.alertLocks.add(lockKey);

    // Auto-clear lock after 15s safety timeout
    const lockSafetyTimeout = setTimeout(() => {
      this.alertLocks.delete(lockKey);
    }, 15000);

    try {
      const now = new Date();
      const timeStr = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
      const customPriceVal = Number(alertParams.levelPrice || alertParams.currentPrice);
      const eventId = `${sym}-${customPriceVal.toFixed(2)}-${timeStr}`;

      logger.alert(`>>> PROCESSING CENTRAL ALERT EVENT [${eventId}]: ${sym} @ $${alertParams.currentPrice} <<<`);

      // 1. Immediate Socket.IO Broadcast to ALL Connected Devices (Instant UI & Audio Alarm)
      const earlyEvent = {
        eventId,
        symbol: sym,
        assetType: symConfig?.assetType || 'COMMODITY',
        exchange: symConfig?.exchange || 'OANDA',
        customPrice: customPriceVal,
        triggerPrice: alertParams.currentPrice,
        currentPrice: alertParams.currentPrice,
        level: 'CUSTOM',
        levelPrice: customPriceVal,
        status: 'TRIGGERED',
        direction: alertParams.direction,
        tolerance: alertParams.tolerance,
        triggerReason: alertParams.triggerReason,
        screenshotPath: '',
        telegramStatus: 'PENDING',
        isTest: !!alertParams.isTest,
        triggeredAt: now,
        timestamp: now
      };

      const configUpdatePayload = {
        symbol: sym,
        customPriceAlertEnabled: false,
        customPriceAlertTarget: customPriceVal,
        customPriceAlertStatus: 'TRIGGERED',
        customAlert: {
          symbol: sym,
          targetPrice: customPriceVal,
          enabled: false,
          status: 'TRIGGERED'
        },
        alertStates: this.getAllLevelStates(sym)
      };

      if (this.io) {
        this.io.emit('custom_alert:triggered', {
          event: earlyEvent,
          alertStates: this.getAllLevelStates(sym),
          config: configUpdatePayload
        });
        this.io.emit('config:update', configUpdatePayload);
        this.io.emit('config_updated', configUpdatePayload);
        this.io.emit('alert:triggered', {
          event: earlyEvent,
          alertStates: this.getAllLevelStates(sym),
          distances: marketDataService.getMarketData().distances
        });
        this.io.emit('alert_triggered', earlyEvent);
      }

      // 2. Generate Chart Screenshot using EXISTING SETTINGS (showing WHITE custom price line)
      let screenshotData = { filename: '', fullPath: '', relativePath: '', buffer: null };
      try {
        screenshotData = await screenshotService.generateChartScreenshot({
          ...alertParams,
          symbol: symConfig?.tradingViewTicker || `OANDA:${sym}`,
          timeframe: config.chartTimeframe || '15',
          range: config.chartRange || '1D',
          barSpacing: config.barSpacing || 22,
          pivotConfig: config,
          customPrice: customPriceVal,
          timestamp: now
        });
      } catch (screenErr) {
        logger.error(`Screenshot capture error: ${screenErr.message}`);
      }

      const screenshotPath = screenshotData.cloudinaryUrl || screenshotData.relativePath || '';

      // 3. Dispatch Telegram Notification
      let telegramResult = { success: false, messageId: null, error: null };
      if (config.telegramAlertsEnabled !== false) {
        try {
          telegramResult = await telegramService.sendAlertNotification(
            {
              ...alertParams,
              symbol: symConfig?.displayName || sym,
              tradingViewTicker: symConfig?.tradingViewTicker,
              customPrice: customPriceVal,
              timeframe: config.chartTimeframe,
              timestamp: now
            },
            screenshotData.fullPath || screenshotData.buffer
          );
        } catch (tgErr) {
          logger.error(`Telegram delivery error: ${tgErr.message}`);
          telegramResult.error = tgErr.message;
        }
      } else {
        telegramResult = { success: true, messageId: 'DISABLED', message: 'Telegram alerts disabled in settings' };
      }

      // 4. Persist Single Alert Event to MongoDB Online Database
      let eventDoc = null;
      if (mongoose.connection.readyState === 1) {
        try {
          eventDoc = await MarketEvent.create({
            eventId,
            symbol: sym,
            assetType: symConfig?.assetType || 'COMMODITY',
            exchange: symConfig?.exchange || 'OANDA',
            customPrice: customPriceVal,
            triggerPrice: alertParams.currentPrice,
            currentPrice: alertParams.currentPrice,
            level: 'CUSTOM',
            levelPrice: customPriceVal,
            status: 'TRIGGERED',
            direction: alertParams.direction,
            tolerance: alertParams.tolerance,
            triggerReason: alertParams.triggerReason,
            screenshotPath,
            telegramStatus: telegramResult.success ? 'SENT' : 'FAILED',
            telegramMessage: telegramResult.message,
            telegramMessageId: telegramResult.messageId,
            telegramError: telegramResult.error,
            isTest: !!alertParams.isTest,
            triggeredAt: now,
            timestamp: now
          });

          // Update online DB alert status to TRIGGERED and switch to OFF
          await AlertConfiguration.findOneAndUpdate(
            { symbol: sym },
            { customPriceAlertEnabled: false, customPriceAlertStatus: 'TRIGGERED' }
          );
        } catch (dbErr) {
          logger.error(`Failed to save MarketEvent to database: ${dbErr.message}`);
        }
      }

      if (!eventDoc) {
        eventDoc = {
          _id: eventId,
          id: eventId,
          eventId,
          symbol: sym,
          customPrice: customPriceVal,
          triggerPrice: alertParams.currentPrice,
          currentPrice: alertParams.currentPrice,
          level: 'CUSTOM',
          levelPrice: customPriceVal,
          status: 'TRIGGERED',
          direction: alertParams.direction,
          triggerReason: alertParams.triggerReason,
          screenshotPath,
          telegramStatus: telegramResult.success ? 'SENT' : 'FAILED',
          isTest: !!alertParams.isTest,
          triggeredAt: now,
          timestamp: now
        };
      }

      // 5. Enforce Max 6 Records Retention in History
      if (mongoose.connection.readyState === 1) {
        await this.enforceMaxHistory(6);
      }

      // 6. Final Socket.IO Broadcast with completed screenshot URL to all devices
      if (this.io) {
        const payload = {
          event: eventDoc,
          alertStates: this.getAllLevelStates(sym),
          distances: marketDataService.getMarketData().distances
        };

        this.io.emit('custom_alert:triggered', payload);
        this.io.emit('alert:triggered', payload);
        this.io.emit('alert_triggered', eventDoc);
      }

      this.emit('alertProcessed', eventDoc);
      return eventDoc;
    } finally {
      clearTimeout(lockSafetyTimeout);
    }
  }

  /**
   * Test Custom Price Alert simulation
   */
  async triggerTestAlert(levelName = 'CUSTOM', customPrice = null) {
    const sym = symbolService.getActiveSymbol();
    const config = pivotService.getConfig(sym);
    const targetPrice = customPrice !== null && customPrice !== undefined && !isNaN(customPrice)
      ? parseFloat(customPrice)
      : (config.customPriceAlertTarget || 3450.50);

    const reason = `[TEST MODE] Simulated Touch on ${sym} Custom Target Price @ $${targetPrice.toFixed(2)}`;

    return await this.triggerAlertPipeline({
      symbol: sym,
      displayName: symbolService.getActiveSymbolConfig()?.displayName || sym,
      level: 'CUSTOM',
      levelPrice: targetPrice,
      currentPrice: targetPrice,
      previousPrice: targetPrice - 1.0,
      direction: 'TOUCH_TARGET',
      tolerance: config.tolerance || 0.20,
      triggerReason: reason,
      isTest: true
    });
  }

  async enforceMaxHistory(limit = 6) {
    if (mongoose.connection.readyState !== 1) return;
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
