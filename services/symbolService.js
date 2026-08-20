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
    exchange: 'OANDA',
    tradingViewTicker: 'OANDA:XAGUSD',
    provider: 'TradingView Real-Time (OANDA)',
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
            { symbol: def.symbol.toUpperCase() },
            { $setOnInsert: def },
            { upsert: true, new: true }
          ).catch(() => {});
        }

        // Load any custom user-added symbols from DB
        const dbConfigs = await SymbolConfig.find({ enabled: true }).lean().catch(() => []);
        dbConfigs.forEach(item => {
          this.symbols.set(item.symbol.toUpperCase(), {
            ...this.symbols.get(item.symbol.toUpperCase()),
            ...item
          });
        });
      } catch (err) {
        logger.warn(`Database symbol sync deferred: ${err.message}. Using built-in symbol catalog.`);
      }
    }

    this.isInitialized = true;
    logger.info(`Symbol Catalog Ready (${this.symbols.size} symbols). Active: ${this.activeSymbol}`);
  }

  getActiveSymbol() {
    return this.activeSymbol;
  }

  getActiveSymbolConfig() {
    return this.getSymbol(this.activeSymbol) || DEFAULT_SYMBOLS[0];
  }

  getSymbol(symbolStr) {
    if (!symbolStr) return null;
    const clean = String(symbolStr).toUpperCase().replace(/[\/\-_]/g, '');
    return this.symbols.get(clean) || null;
  }

  getAllSymbols(filterAssetType = null) {
    const list = Array.from(this.symbols.values());
    if (!filterAssetType || filterAssetType === 'ALL') return list;
    return list.filter(s => s.assetType?.toUpperCase() === filterAssetType.toUpperCase());
  }

  searchSymbols(query = '', assetType = 'ALL') {
    const q = (query || '').trim().toLowerCase();
    let results = Array.from(this.symbols.values());

    if (assetType && assetType !== 'ALL') {
      results = results.filter(s => s.assetType?.toUpperCase() === assetType.toUpperCase());
    }

    if (!q) return results;

    return results.filter(s =>
      s.symbol.toLowerCase().includes(q) ||
      s.displayName.toLowerCase().includes(q) ||
      s.exchange.toLowerCase().includes(q) ||
      s.tradingViewTicker.toLowerCase().includes(q)
    );
  }

  async setActiveSymbol(symbolStr) {
    const sym = this.getSymbol(symbolStr);
    if (!sym) {
      throw new Error(`Symbol '${symbolStr}' is not supported in the active catalog.`);
    }

    const previous = this.activeSymbol;
    this.activeSymbol = sym.symbol.toUpperCase();

    logger.info(`🔄 Active symbol switched from ${previous} to ${this.activeSymbol} (${sym.displayName} on ${sym.exchange})`);
    
    this.emit('activeSymbolChanged', {
      previousSymbol: previous,
      activeSymbol: this.activeSymbol,
      config: sym
    });

    return sym;
  }
}

export const symbolService = new SymbolService();
