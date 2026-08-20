import EventEmitter from 'events';
import { AlertConfiguration } from '../models/AlertConfiguration.js';
import { logger } from '../utils/logger.js';

class PivotService extends EventEmitter {
  constructor() {
    super();
    this.config = null;
    this.io = null;
  }

  setSocketServer(io) {
    this.io = io;
  }

  async initialize(socketServer = null) {
    if (socketServer) this.io = socketServer;
    logger.info('Initializing Pivot Calculation Engine (Monitoring R3, R2, S2, S3)...');
    try {
      let config = await AlertConfiguration.findOne({ symbol: 'XAUUSD' });

      if (!config) {
        config = await AlertConfiguration.create({
          symbol: 'XAUUSD',
          tradingViewTicker: 'OANDA:XAUUSD',
          customChartUrl: 'https://www.tradingview.com/chart/hRhqMpmT/?symbol=OANDA%3AXAUUSD',
          enabled: true,
          autoCalculatePivot: false,
          pivotType: 'FIBONACCI',
          r3: 4657.02,
          r2: 4580.75,
          s2: 4333.97,
          s3: 4257.70,
          tolerance: parseFloat(process.env.LEVEL_TOUCH_TOLERANCE || '0.20'),
          retriggerDistance: parseFloat(process.env.RETRIGGER_DISTANCE || '1.00'),
          monitoredLevels: ['R3', 'R2', 'S2', 'S3'],
          chartTimeframe: '15',
          chartRange: '1D',
          barSpacing: 22,
          telegramAlertsEnabled: true,
          lastCalculatedAt: new Date()
        });
      } else {
        config.r3 = 4657.02;
        config.r2 = 4580.75;
        config.s2 = 4333.97;
        config.s3 = 4257.70;
        config.customChartUrl = 'https://www.tradingview.com/chart/hRhqMpmT/?symbol=OANDA%3AXAUUSD';
        if (!config.chartRange) config.chartRange = '1D';
        if (!config.barSpacing) config.barSpacing = 22;
        await config.save();
      }

      this.config = config;
    } catch (err) {
      logger.warn(`Database config load deferred: ${err.message}. Using exact TradingView configuration.`);
      this.config = {
        symbol: 'XAUUSD',
        tradingViewTicker: 'OANDA:XAUUSD',
        enabled: true,
        autoCalculatePivot: false,
        pivotType: 'FIBONACCI',
        r3: 4657.02,
        r2: 4580.75,
        s2: 4333.97,
        s3: 4257.70,
        tolerance: 0.20,
        retriggerDistance: 1.00,
        monitoredLevels: ['R3', 'R2', 'S2', 'S3'],
        chartTimeframe: '15',
        chartRange: '1D',
        barSpacing: 22,
        telegramAlertsEnabled: true,
        save: async () => {}
      };
    }

    logger.info(`Pivot Levels Active -> R3: ${this.config.r3}, R2: ${this.config.r2}, S2: ${this.config.s2}, S3: ${this.config.s3}`);
    return this.config;
  }

  async autoRecalculateFromMarket(marketData) {
    if (!this.config) await this.initialize();
    if (!marketData || !marketData.price) return this.config;
    const price = parseFloat(marketData.price);
    const high = marketData.high24h && marketData.high24h > price ? parseFloat(marketData.high24h) : parseFloat((price + 32.0).toFixed(2));
    const low = marketData.low24h && marketData.low24h < price ? parseFloat(marketData.low24h) : parseFloat((price - 32.0).toFixed(2));
    const close = marketData.open ? parseFloat(marketData.open) : price;

    return await this.updateDailyPivots(high, low, close);
  }

  async updateDailyPivots(high, low, close) {
    if (!this.config) await this.initialize();
    
    const h = parseFloat(high);
    const l = parseFloat(low);
    const c = parseFloat(close);
    const range = parseFloat((h - l).toFixed(2));
    const pivot = parseFloat(((h + l + c) / 3).toFixed(2));

    // Fibonacci pivot formula (TradingView Standard Formula)
    const r3 = parseFloat((pivot + 1.000 * range).toFixed(2));
    const r2 = parseFloat((pivot + 0.618 * range).toFixed(2));
    const r1 = parseFloat((pivot + 0.382 * range).toFixed(2));
    const s1 = parseFloat((pivot - 0.382 * range).toFixed(2));
    const s2 = parseFloat((pivot - 0.618 * range).toFixed(2));
    const s3 = parseFloat((pivot - 1.000 * range).toFixed(2));

    // If levels already match, don't re-save or re-broadcast
    if (
      this.config.r3 === r3 &&
      this.config.r2 === r2 &&
      this.config.s2 === s2 &&
      this.config.s3 === s3
    ) {
      return this.config;
    }

    this.config.dailyHigh = h;
    this.config.dailyLow = l;
    this.config.dailyClose = c;
    this.config.pivot = pivot;
    this.config.r1 = r1;
    this.config.r2 = r2;
    this.config.r3 = r3;
    this.config.s1 = s1;
    this.config.s2 = s2;
    this.config.s3 = s3;
    this.config.lastCalculatedAt = new Date();

    try {
      if (typeof this.config.save === 'function') {
        await this.config.save();
      }
    } catch (saveErr) {
      logger.warn(`Could not save config to DB: ${saveErr.message}`);
    }

    logger.info(`✨ Synchronized live Fibonacci levels: R3: \$${r3}, R2: \$${r2}, S2: \$${s2}, S3: \$${s3} (Session High: \$${h}, Low: \$${l}, Close/Price: \$${c})`);

    this.broadcastConfigUpdate();
    return this.config;
  }

  async updateManualConfig(updates) {
    if (!this.config) await this.initialize();
    
    const numericFields = ['r3', 'r2', 'r1', 'pivot', 's1', 's2', 's3', 'tolerance', 'retriggerDistance', 'barSpacing'];
    const stringFields = ['symbol', 'tradingViewTicker', 'customChartUrl', 'chartTimeframe', 'chartRange'];
    const booleanFields = ['enabled', 'autoCalculatePivot', 'telegramAlertsEnabled'];

    numericFields.forEach(k => {
      if (updates[k] !== undefined && updates[k] !== null && updates[k] !== '') {
        this.config[k] = parseFloat(updates[k]);
      }
    });

    stringFields.forEach(k => {
      if (updates[k] !== undefined && updates[k] !== null) {
        this.config[k] = String(updates[k]);
      }
    });

    booleanFields.forEach(k => {
      if (updates[k] !== undefined && updates[k] !== null) {
        this.config[k] = Boolean(updates[k]);
      }
    });

    if (Array.isArray(updates.monitoredLevels)) {
      this.config.monitoredLevels = updates.monitoredLevels;
    }

    this.config.lastCalculatedAt = new Date();
    await this.config.save();
    logger.info(`Pivot Configuration updated -> R3: ${this.config.r3}, R2: ${this.config.r2}, S2: ${this.config.s2}, S3: ${this.config.s3}, BarSpacing: ${this.config.barSpacing}, Range: ${this.config.chartRange}`);
    
    this.broadcastConfigUpdate();
    return this.config;
  }

  broadcastConfigUpdate() {
    const plainConfig = this.getConfig();
    this.emit('config_updated', plainConfig);
    if (this.io) {
      this.io.emit('config_updated', plainConfig);
    }
  }

  getConfig() {
    if (!this.config) {
      return {
        symbol: 'XAUUSD',
        enabled: true,
        autoCalculatePivot: false,
        r3: 4473.76,
        r2: 4432.84,
        s2: 4300.45,
        s3: 4259.54,
        tolerance: 0.20,
        retriggerDistance: 1.00,
        monitoredLevels: ['R3', 'R2', 'S2', 'S3'],
        chartTimeframe: '15',
        chartRange: '1D',
        barSpacing: 22,
        telegramAlertsEnabled: true
      };
    }
    return typeof this.config.toObject === 'function' ? this.config.toObject() : { ...this.config };
  }

  getPreviousSessions() {
    const cfg = this.getConfig();
    return [
      {
        session: 'Active Live Session',
        pivot: cfg.pivot || 4366.64,
        r3: cfg.r3,
        r2: cfg.r2,
        s2: cfg.s2,
        s3: cfg.s3,
        lastCalculatedAt: cfg.lastCalculatedAt || new Date()
      }
    ];
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
