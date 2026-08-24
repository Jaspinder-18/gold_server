import EventEmitter from 'events';
import { SymbolConfig } from '../models/SymbolConfig.js';
import { logger } from '../utils/logger.js';

// Pre-configured catalog of verified symbols across all asset classes
export const DEFAULT_SYMBOLS = [
  // Commodities
  {
    symbol: 'XAUUSD',
    displayName: 'Gold / USD Spot',
    assetType: 'COMMODITY',
    exchange: 'OANDA',
    tradingViewTicker: 'OANDA:XAUUSD',
    provider: 'TradingView Real-Time (OANDA)',
    timezone: 'America/New_York',
    sessionCloseUtc: '22:00', // 17:00 NY
    priceDecimals: 3,
    tolerance: 0.20,
    retriggerDistance: 1.00,
    isDefault: true
  },
  {
    symbol: 'XAGUSD',
    displayName: 'Silver / USD Spot',
    assetType: 'COMMODITY',
    exchange: 'TVC',
    tradingViewTicker: 'TVC:SILVER',
    provider: 'TradingView Real-Time (TVC:SILVER)',
    timezone: 'America/New_York',
    sessionCloseUtc: '22:00',
    priceDecimals: 3,
    tolerance: 0.05,
    retriggerDistance: 0.20
  },

  // Crypto
  {
    symbol: 'BTCUSD',
    displayName: 'Bitcoin / US Dollar',
    assetType: 'CRYPTO',
    exchange: 'BINANCE',
    tradingViewTicker: 'BINANCE:BTCUSDT',
    provider: 'Binance Live WebSocket Stream',
    timezone: 'UTC',
    sessionCloseUtc: '00:00',
    priceDecimals: 2,
    tolerance: 15.00,
    retriggerDistance: 80.00
  },
  {
    symbol: 'ETHUSD',
    displayName: 'Ethereum / US Dollar',
    assetType: 'CRYPTO',
    exchange: 'BINANCE',
    tradingViewTicker: 'BINANCE:ETHUSDT',
    provider: 'Binance Live WebSocket Stream',
    timezone: 'UTC',
    sessionCloseUtc: '00:00',
    priceDecimals: 2,
    tolerance: 1.50,
    retriggerDistance: 8.00
  },
  {
    symbol: 'SOLUSD',
    displayName: 'Solana / US Dollar',
    assetType: 'CRYPTO',
    exchange: 'BINANCE',
    tradingViewTicker: 'BINANCE:SOLUSDT',
    provider: 'Binance Live WebSocket Stream',
    timezone: 'UTC',
    sessionCloseUtc: '00:00',
    priceDecimals: 2,
    tolerance: 0.25,
    retriggerDistance: 1.00
  },

  // Forex
  {
    symbol: 'EURUSD',
    displayName: 'Euro / US Dollar',
    assetType: 'FOREX',
    exchange: 'FX_IDC',
    tradingViewTicker: 'FX_IDC:EURUSD',
    provider: 'TradingView Scanner / Spot Forex',
    timezone: 'America/New_York',
    sessionCloseUtc: '22:00',
    priceDecimals: 5,
    tolerance: 0.0003,
    retriggerDistance: 0.0015
  },
  {
    symbol: 'GBPUSD',
    displayName: 'British Pound / US Dollar',
    assetType: 'FOREX',
    exchange: 'FX_IDC',
    tradingViewTicker: 'FX_IDC:GBPUSD',
    provider: 'TradingView Scanner / Spot Forex',
    timezone: 'America/New_York',
    sessionCloseUtc: '22:00',
    priceDecimals: 5,
    tolerance: 0.0004,
    retriggerDistance: 0.0020
  },
  {
    symbol: 'USDJPY',
    displayName: 'US Dollar / Japanese Yen',
    assetType: 'FOREX',
    exchange: 'FX_IDC',
    tradingViewTicker: 'FX_IDC:USDJPY',
    provider: 'TradingView Scanner / Spot Forex',
    timezone: 'America/New_York',
    sessionCloseUtc: '22:00',
    priceDecimals: 3,
    tolerance: 0.04,
    retriggerDistance: 0.20
  },

  // Indices
  {
    symbol: 'NIFTY',
    displayName: 'NIFTY 50 Index',
    assetType: 'INDEX',
    exchange: 'NSE',
    tradingViewTicker: 'NSE:NIFTY',
    provider: 'NSE Live / Yahoo Finance (^NSEI)',
    timezone: 'Asia/Kolkata',
    sessionCloseUtc: '10:00', // 15:30 IST = 10:00 UTC
    priceDecimals: 2,
    tolerance: 5.00,
    retriggerDistance: 25.00
  },
  {
    symbol: 'BANKNIFTY',
    displayName: 'NIFTY Bank Index',
    assetType: 'INDEX',
    exchange: 'NSE',
    tradingViewTicker: 'NSE:BANKNIFTY',
    provider: 'NSE Live / Yahoo Finance (^NSEBANK)',
    timezone: 'Asia/Kolkata',
    sessionCloseUtc: '10:00',
    priceDecimals: 2,
    tolerance: 15.00,
    retriggerDistance: 60.00
  },
  {
    symbol: 'US30',
    displayName: 'Dow Jones Industrial Average 30',
    assetType: 'INDEX',
    exchange: 'DJ',
    tradingViewTicker: 'DJ:DJI',
    provider: 'TradingView Scanner / TVC:DJI',
    timezone: 'America/New_York',
    sessionCloseUtc: '21:00',
    priceDecimals: 2,
    tolerance: 10.00,
    retriggerDistance: 50.00
  },
  {
    symbol: 'SPX',
    displayName: 'S&P 500 Index',
    assetType: 'INDEX',
    exchange: 'SP',
    tradingViewTicker: 'SP:SPX',
    provider: 'TradingView Scanner / TVC:SPX',
    timezone: 'America/New_York',
    sessionCloseUtc: '21:00',
    priceDecimals: 2,
    tolerance: 2.00,
    retriggerDistance: 10.00
  },
  {
    symbol: 'NASDAQ',
    displayName: 'Nasdaq 100 Index',
    assetType: 'INDEX',
    exchange: 'NASDAQ',
    tradingViewTicker: 'NASDAQ:NDX',
    provider: 'TradingView Scanner / TVC:NDX',
    timezone: 'America/New_York',
    sessionCloseUtc: '21:00',
    priceDecimals: 2,
    tolerance: 5.00,
    retriggerDistance: 30.00
  },

  // US Equities
  {
    symbol: 'AAPL',
    displayName: 'Apple Inc.',
    assetType: 'STOCK',
    exchange: 'NASDAQ',
    tradingViewTicker: 'NASDAQ:AAPL',
    provider: 'TradingView Scanner / Nasdaq Live',
    timezone: 'America/New_York',
    sessionCloseUtc: '21:00',
    priceDecimals: 2,
    tolerance: 0.20,
    retriggerDistance: 1.00
  },
  {
    symbol: 'TSLA',
    displayName: 'Tesla, Inc.',
    assetType: 'STOCK',
    exchange: 'NASDAQ',
    tradingViewTicker: 'NASDAQ:TSLA',
    provider: 'TradingView Scanner / Nasdaq Live',
    timezone: 'America/New_York',
    sessionCloseUtc: '21:00',
    priceDecimals: 2,
    tolerance: 0.35,
    retriggerDistance: 1.50
  },
  {
    symbol: 'NVDA',
    displayName: 'NVIDIA Corporation',
    assetType: 'STOCK',
    exchange: 'NASDAQ',
    tradingViewTicker: 'NASDAQ:NVDA',
    provider: 'TradingView Scanner / Nasdaq Live',
    timezone: 'America/New_York',
    sessionCloseUtc: '21:00',
    priceDecimals: 2,
    tolerance: 0.30,
    retriggerDistance: 1.50
  }
];

import mongoose from 'mongoose';

class SymbolService extends EventEmitter {
  constructor() {
    super();
    this.activeSymbol = 'XAUUSD';
    this.symbols = new Map();
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;

    logger.info('Initializing Symbol Catalog & Registry...');

    // Load defaults into memory map
    DEFAULT_SYMBOLS.forEach(sym => {
      this.symbols.set(sym.symbol.toUpperCase(), { ...sym });
    });

    if (mongoose.connection.readyState === 1) {
      try {
        // Sync with MongoDB if connected
        for (const def of DEFAULT_SYMBOLS) {
          await SymbolConfig.findOneAndUpdate(
            { symbol: def.symbol },
            { $set: def },
            { upsert: true, new: true }
          );
        }

        // Load any active symbol preference from DB
        const savedActive = await SymbolConfig.findOne({ isDefault: true }).lean();
        if (savedActive) {
          this.activeSymbol = savedActive.symbol;
        }
      } catch (dbErr) {
        logger.warn(`Could not sync symbol registry with MongoDB: ${dbErr.message}`);
      }
    }

    this.isInitialized = true;
    logger.info(`Symbol Registry loaded with ${this.symbols.size} verified multi-asset symbols. Active: ${this.activeSymbol}`);
  }

  getActiveSymbol() {
    return this.activeSymbol;
  }

  getActiveSymbolConfig() {
    return this.getSymbol(this.activeSymbol) || this.symbols.get('XAUUSD');
  }

  getSymbol(symbolStr) {
    if (!symbolStr) return null;
    return this.symbols.get(symbolStr.toUpperCase()) || null;
  }

  getAllSymbols(assetType = null) {
    const all = Array.from(this.symbols.values());
    if (!assetType || assetType === 'ALL') return all;
    return all.filter(s => s.assetType.toUpperCase() === assetType.toUpperCase());
  }

  searchSymbols(query = '', assetType = 'ALL') {
    const q = (query || '').trim().toLowerCase();
    const type = (assetType || 'ALL').toUpperCase();

    let list = Array.from(this.symbols.values());
    if (type !== 'ALL') {
      list = list.filter(s => s.assetType === type);
    }

    if (!q) return list;

    return list.filter(s =>
      s.symbol.toLowerCase().includes(q) ||
      s.displayName.toLowerCase().includes(q) ||
      (s.exchange && s.exchange.toLowerCase().includes(q))
    );
  }

  async setActiveSymbol(symbolStr) {
    const sym = (symbolStr || '').toUpperCase();
    if (!this.symbols.has(sym)) {
      throw new Error(`Symbol '${sym}' is not supported in the active asset catalog.`);
    }

    const previousSymbol = this.activeSymbol;
    if (previousSymbol === sym) {
      return this.symbols.get(sym);
    }

    this.activeSymbol = sym;
    logger.info(`🔄 Active trading symbol switched from '${previousSymbol}' -> '${sym}'`);

    // Update isDefault flag in DB if connected
    if (mongoose.connection.readyState === 1) {
      try {
        await SymbolConfig.updateMany({}, { $set: { isDefault: false } });
        await SymbolConfig.findOneAndUpdate({ symbol: sym }, { $set: { isDefault: true } });
      } catch (dbErr) {
        logger.warn(`Failed to persist active symbol switch in DB: ${dbErr.message}`);
      }
    }

    const newConfig = this.symbols.get(sym);
    this.emit('activeSymbolChanged', {
      activeSymbol: sym,
      previousSymbol,
      config: newConfig
    });

    return newConfig;
  }
}

export const symbolService = new SymbolService();
