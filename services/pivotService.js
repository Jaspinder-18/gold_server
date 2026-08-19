import { AlertConfiguration } from '../models/AlertConfiguration.js';
import { logger } from '../utils/logger.js';

class PivotService {
  constructor() {
    this.config = null;
  }

  async initialize() {
    logger.info('Initializing Pivot Calculation Engine (Monitoring R3, R2, S2, S3)...');
    let config = await AlertConfiguration.findOne({ symbol: 'XAUUSD' });

    if (!config) {
      config = await AlertConfiguration.create({
        symbol: 'XAUUSD',
        enabled: true,
        autoCalculatePivot: false,
        pivotType: 'FIBONACCI',
        r3: 4473.76,
        r2: 4432.84,
        s2: 4300.45,
        s3: 4259.54,
        tolerance: parseFloat(process.env.LEVEL_TOUCH_TOLERANCE || '0.20'),
        retriggerDistance: parseFloat(process.env.RETRIGGER_DISTANCE || '1.00'),
        monitoredLevels: ['R3', 'R2', 'S2', 'S3'],
        chartTimeframe: '15',
        chartRange: '1D',
        barSpacing: 22,
        telegramAlertsEnabled: true,
        lastCalculatedAt: new Date()
      });
      logger.info('Created Gold Alert Configuration with exact chart levels in MongoDB.');
    } else {
      // Pin exact calibrated levels from TradingView chart
      config.r3 = 4473.76;
      config.r2 = 4432.84;
      config.s2 = 4300.45;
      config.s3 = 4259.54;
      if (!config.chartRange) config.chartRange = '1D';
      if (!config.barSpacing) config.barSpacing = 22;
      config.autoCalculatePivot = false;
      await config.save();
    }

    this.config = config;
    logger.info(`Pivot Levels Active -> R3: ${this.config.r3}, R2: ${this.config.r2}, S2: ${this.config.s2}, S3: ${this.config.s3}`);
    return this.config;
  }

  async updateManualConfig(updates) {
    if (!this.config) await this.initialize();
    
    Object.keys(updates).forEach(key => {
      if (this.config[key] !== undefined && updates[key] !== undefined) {
        this.config[key] = updates[key];
      }
    });

    this.config.lastCalculatedAt = new Date();
    await this.config.save();
    logger.info('Pivot Configuration updated.');
    return this.config;
  }

  getConfig() {
    if (!this.config) {
      return {
        symbol: 'XAUUSD',
        enabled: true,
        r3: 4473.76,
        r2: 4432.84,
        s2: 4300.45,
        s3: 4259.54,
        tolerance: 0.20,
        retriggerDistance: 1.00,
        monitoredLevels: ['R3', 'R2', 'S2', 'S3'],
        chartTimeframe: '5',
        chartRange: '2D',
        telegramAlertsEnabled: true
      };
    }
    return this.config;
  }

  // Calculate live distance metrics for ONLY R3, R2, S2, S3
  getDistances(currentPrice) {
    const cfg = this.getConfig();
    const price = parseFloat(currentPrice);

    return {
      r3: {
        level: 'R3',
        target: cfg.r3,
        distance: parseFloat((cfg.r3 - price).toFixed(2)),
        isNear: Math.abs(cfg.r3 - price) <= cfg.tolerance,
        percentage: (((cfg.r3 - price) / price) * 100).toFixed(3)
      },
      r2: {
        level: 'R2',
        target: cfg.r2,
        distance: parseFloat((cfg.r2 - price).toFixed(2)),
        isNear: Math.abs(cfg.r2 - price) <= cfg.tolerance,
        percentage: (((cfg.r2 - price) / price) * 100).toFixed(3)
      },
      s2: {
        level: 'S2',
        target: cfg.s2,
        distance: parseFloat((price - cfg.s2).toFixed(2)),
        isNear: Math.abs(price - cfg.s2) <= cfg.tolerance,
        percentage: (((price - cfg.s2) / price) * 100).toFixed(3)
      },
      s3: {
        level: 'S3',
        target: cfg.s3,
        distance: parseFloat((price - cfg.s3).toFixed(2)),
        isNear: Math.abs(price - cfg.s3) <= cfg.tolerance,
        percentage: (((price - cfg.s3) / price) * 100).toFixed(3)
      }
    };
  }
}

export const pivotService = new PivotService();
