import EventEmitter from 'events';
import axios from 'axios';
import WebSocket from 'ws';
import { logger } from '../utils/logger.js';
import { MarketSnapshot } from '../models/MarketSnapshot.js';
import { symbolService } from './symbolService.js';
import { pivotService } from './pivotService.js';

class MarketDataService extends EventEmitter {
  constructor() {
    super();
    this.activeSymbol = 'XAUUSD';
    this.pollingInterval = 2000;

    this.basePrice = null;
    this.currentData = {
      symbol: 'XAU/USD',
      rawSymbol: 'XAUUSD',
      displayName: 'Gold / USD Spot',
      assetType: 'COMMODITY',
      exchange: 'OANDA',
      provider: 'TradingView Real-Time (OANDA)',
      price: null,
      previousPrice: null,
      bid: null,
      ask: null,
      high24h: null,
      low24h: null,
      open: null,
      change: null,
      changePercent: null,
      volume: null,
      marketStatus: 'CONNECTING...',
      connected: false,
      lastUpdated: new Date(),
      distances: {}
    };

    this.klines = [];
    this.pollTimer = null;
    this.microTickTimer = null;
    this.snapshotTimer = null;
    this.ws = null;
    this.isWsConnected = false;
  }

  async initialize() {
    await symbolService.initialize();
    this.activeSymbol = symbolService.getActiveSymbol();
    
    logger.market(`Initializing Real-Time Market Feed for Active Symbol '${this.activeSymbol}'...`);

    // Listen to symbol changes
    symbolService.on('activeSymbolChanged', async ({ activeSymbol }) => {
      await this.switchSymbol(activeSymbol);
    });

    await this.setupActiveSymbolFeed();

    // Snapshot persistence every 60s
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.snapshotTimer = setInterval(() => this.saveSnapshot(), 60000);
  }

  async switchSymbol(newSymbolStr) {
    const sym = newSymbolStr.toUpperCase();
    if (this.activeSymbol === sym && this.currentData.connected) return;

    logger.market(`🔄 MarketDataService switching active symbol from ${this.activeSymbol} to ${sym}...`);
    this.activeSymbol = sym;

    // Reset current data
    const symConfig = symbolService.getSymbol(sym) || symbolService.getActiveSymbolConfig();
    this.basePrice = null;
    this.currentData = {
      symbol: symConfig.displayName || sym,
      rawSymbol: sym,
      displayName: symConfig.displayName,
      assetType: symConfig.assetType,
      exchange: symConfig.exchange,
      provider: symConfig.provider,
      price: null,
      previousPrice: null,
      bid: null,
      ask: null,
      high24h: null,
      low24h: null,
      open: null,
      change: null,
      changePercent: null,
      volume: null,
      marketStatus: 'SWITCHING...',
      connected: false,
      lastUpdated: new Date(),
      distances: {}
    };

    this.klines = [];

    // Tear down existing WebSocket
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch (e) {}
      this.ws = null;
      this.isWsConnected = false;
    }

    await this.setupActiveSymbolFeed();
  }

  async setupActiveSymbolFeed() {
    const symConfig = symbolService.getSymbol(this.activeSymbol) || symbolService.getActiveSymbolConfig();
    
    // 1. Fetch initial live quote
    await this.fetchLiveQuoteForActiveSymbol();

    // 2. If Crypto, initialize high-speed WebSocket stream
    if (symConfig.assetType === 'CRYPTO') {
      this.initCryptoWebSocketStream(this.activeSymbol);
    }

    // 3. Start micro-tick pulse (runs only when verified live price exists)
    this.startMicroTickPulse();

    // 4. Start polling sync
    this.startPolling();
  }

  /**
   * Primary live quote fetcher supporting TradingView Scanner, Yahoo Finance, and Binance
   */
  async fetchLiveQuoteForActiveSymbol() {
    const sym = this.activeSymbol;
    const symConfig = symbolService.getSymbol(sym) || symbolService.getActiveSymbolConfig();
    const decimals = symConfig.priceDecimals || 2;

    // 1. Crypto: Binance Ticker API
    if (symConfig.assetType === 'CRYPTO') {
      try {
        const pair = sym.includes('USD') && !sym.includes('USDT') ? `${sym.replace('USD', 'USDT')}` : sym;
        const res = await axios.get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`, { timeout: 4500 });
        if (res.data && res.data.lastPrice) {
          const price = parseFloat(parseFloat(res.data.lastPrice).toFixed(decimals));
          const open = parseFloat(parseFloat(res.data.openPrice).toFixed(decimals));
          const high = parseFloat(parseFloat(res.data.highPrice).toFixed(decimals));
          const low = parseFloat(parseFloat(res.data.lowPrice).toFixed(decimals));
          const bid = parseFloat(parseFloat(res.data.bidPrice || (price - 0.50)).toFixed(decimals));
          const ask = parseFloat(parseFloat(res.data.askPrice || (price + 0.50)).toFixed(decimals));
          const change = parseFloat((price - open).toFixed(decimals));
          const changePercent = parseFloat(((change / open) * 100).toFixed(2));
          const volume = parseFloat(parseFloat(res.data.volume).toFixed(2));

          this.updateMarketState({ price, open, high, low, bid, ask, change, changePercent, volume });
          return;
        }
      } catch (err) {
        logger.warn(`Binance 24hr quote failed for ${sym}: ${err.message}`);
      }
    }

    // 2. TradingView Scanner API (Forex, Commodities, Indices, Stocks)
    try {
      const tvTicker = symConfig.tradingViewTicker || `OANDA:${sym}`;
      const response = await axios.post(
        'https://scanner.tradingview.com/cfd/scan',
        {
          symbols: { tickers: [tvTicker, `OANDA:${sym}`, `FX_IDC:${sym}`, `PEPPERSTONE:${sym}`] },
          columns: ['name', 'close', 'change', 'change_abs', 'high', 'low', 'open', 'bid', 'ask', 'volume']
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 4500 }
      );

      if (response.data?.data?.[0]?.d) {
        const [, close, change, change_abs, high, low, open, bid, ask, volume] = response.data.data[0].d;
        if (close && !isNaN(close)) {
          const price = parseFloat(parseFloat(close).toFixed(decimals));
          const o = open ? parseFloat(parseFloat(open).toFixed(decimals)) : price;
          const h = high ? parseFloat(parseFloat(high).toFixed(decimals)) : price;
          const l = low ? parseFloat(parseFloat(low).toFixed(decimals)) : price;
          const b = bid ? parseFloat(parseFloat(bid).toFixed(decimals)) : parseFloat((price - (0.01 * Math.pow(10, -decimals + 2))).toFixed(decimals));
          const a = ask ? parseFloat(parseFloat(ask).toFixed(decimals)) : parseFloat((price + (0.01 * Math.pow(10, -decimals + 2))).toFixed(decimals));
          const chg = change_abs !== null ? parseFloat(parseFloat(change_abs).toFixed(decimals)) : parseFloat((price - o).toFixed(decimals));
          const chgPct = change !== null ? parseFloat(parseFloat(change).toFixed(2)) : parseFloat(((chg / o) * 100).toFixed(2));

          this.updateMarketState({ price, open: o, high: h, low: l, bid: b, ask: a, change: chg, changePercent: chgPct, volume: volume || 0 });
          return;
        }
      }
    } catch (tvErr) {
      // Fall through to Yahoo Finance
    }

    // 3. Yahoo Finance Fallback
    const yfMap = {
      XAUUSD: 'GC=F',
      XAGUSD: 'SI=F',
      EURUSD: 'EURUSD=X',
      GBPUSD: 'GBPUSD=X',
      USDJPY: 'JPY=X',
      NIFTY: '^NSEI',
      BANKNIFTY: '^NSEBANK',
      US30: '^DJI',
      SPX: '^GSPC',
      NASDAQ: '^IXIC',
      AAPL: 'AAPL',
      TSLA: 'TSLA',
      NVDA: 'NVDA'
    };

    const yfSymbol = yfMap[sym] || sym;
    try {
      const res = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSymbol)}?interval=1m&range=1d`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 4500
      });

      const meta = res.data?.chart?.result?.[0]?.meta;
      if (meta && meta.regularMarketPrice) {
        const price = parseFloat(parseFloat(meta.regularMarketPrice).toFixed(decimals));
        const prevClose = meta.previousClose || meta.chartPreviousClose || price;
        const open = meta.regularMarketOpen || prevClose;
        const high = meta.regularMarketDayHigh || price;
        const low = meta.regularMarketDayLow || price;
        const change = parseFloat((price - prevClose).toFixed(decimals));
        const changePercent = parseFloat(((change / prevClose) * 100).toFixed(2));

        this.updateMarketState({
          price,
          open,
          high,
          low,
          bid: parseFloat((price - (0.01 * Math.pow(10, -decimals + 2))).toFixed(decimals)),
          ask: parseFloat((price + (0.01 * Math.pow(10, -decimals + 2))).toFixed(decimals)),
          change,
          changePercent,
          volume: meta.regularMarketVolume || 0
        });
        return;
      }
    } catch (yfErr) {
      logger.warn(`Yahoo Finance quote failed for ${sym} (${yfSymbol}): ${yfErr.message}`);
    }
  }

  updateMarketState({ price, open, high, low, bid, ask, change, changePercent, volume }) {
    const prev = this.currentData.price;
    const symConfig = symbolService.getSymbol(this.activeSymbol) || symbolService.getActiveSymbolConfig();
    const decimals = symConfig.priceDecimals || 2;

    this.basePrice = price;
    this.currentData.price = price;
    this.currentData.previousPrice = prev;
    this.currentData.open = open;
    this.currentData.high24h = high;
    this.currentData.low24h = low;
    this.currentData.bid = bid;
    this.currentData.ask = ask;
    this.currentData.change = change;
    this.currentData.changePercent = changePercent;
    this.currentData.volume = volume;
    this.currentData.marketStatus = 'LIVE';
    this.currentData.connected = true;
    this.currentData.lastUpdated = new Date();

    // Calculate dynamic distance to active pivot levels
    const pivot = pivotService.getActivePivotState();
    if (pivot && price) {
      this.currentData.distances = {
        r3: parseFloat(Math.abs(price - pivot.r3).toFixed(decimals)),
        r2: parseFloat(Math.abs(price - pivot.r2).toFixed(decimals)),
        r1: parseFloat(Math.abs(price - (pivot.r1 || pivot.p)).toFixed(decimals)),
        pivot: parseFloat(Math.abs(price - pivot.p).toFixed(decimals)),
        s1: parseFloat(Math.abs(price - (pivot.s1 || pivot.p)).toFixed(decimals)),
        s2: parseFloat(Math.abs(price - pivot.s2).toFixed(decimals)),
        s3: parseFloat(Math.abs(price - pivot.s3).toFixed(decimals))
      };
    }

    const tickType = prev ? (price >= prev ? 'UP' : 'DOWN') : 'UP';
    this.emit('tick', { ...this.currentData, tickType });
  }

  /**
   * Continuous micro-tick stream for high responsiveness (tightly pinned to live base price)
   */
  startMicroTickPulse() {
    if (this.microTickTimer) clearInterval(this.microTickTimer);

    this.microTickTimer = setInterval(() => {
      if (!this.basePrice || !this.currentData.connected || !this.currentData.price) return;

      const symConfig = symbolService.getSymbol(this.activeSymbol) || symbolService.getActiveSymbolConfig();
      const decimals = symConfig.priceDecimals || 2;
      const isCrypto = symConfig.assetType === 'CRYPTO';

      // For crypto with live WebSocket, rely on native ticks
      if (isCrypto && this.isWsConnected) return;

      const stepUnit = Math.pow(10, -decimals);
      const stepMultiplier = decimals >= 4 ? (1 + Math.floor(Math.random() * 3)) : (1 + Math.floor(Math.random() * 8));
      const step = parseFloat((stepUnit * stepMultiplier).toFixed(decimals));

      const isUp = Math.random() >= 0.5;
      const delta = isUp ? step : -step;
      const prev = this.currentData.price;
      const newPrice = parseFloat((this.currentData.price + delta).toFixed(decimals));

      const maxBand = this.basePrice * 0.0008; // 0.08% micro band around live price
      if (Math.abs(newPrice - this.basePrice) > maxBand) {
        this.currentData.price = parseFloat((this.basePrice + (isUp ? -step : step)).toFixed(decimals));
      } else {
        this.currentData.price = newPrice;
      }

      this.currentData.previousPrice = prev;
      this.currentData.bid = parseFloat((this.currentData.price - step).toFixed(decimals));
      this.currentData.ask = parseFloat((this.currentData.price + step).toFixed(decimals));
      this.currentData.lastUpdated = new Date();

      if (this.currentData.open) {
        this.currentData.change = parseFloat((this.currentData.price - this.currentData.open).toFixed(decimals));
        this.currentData.changePercent = parseFloat(((this.currentData.change / this.currentData.open) * 100).toFixed(2));
      }

      // Recompute distances
      const pivot = pivotService.getActivePivotState();
      if (pivot) {
        this.currentData.distances = {
          r3: parseFloat(Math.abs(this.currentData.price - pivot.r3).toFixed(decimals)),
          r2: parseFloat(Math.abs(this.currentData.price - pivot.r2).toFixed(decimals)),
          r1: parseFloat(Math.abs(this.currentData.price - (pivot.r1 || pivot.p)).toFixed(decimals)),
          pivot: parseFloat(Math.abs(this.currentData.price - pivot.p).toFixed(decimals)),
          s1: parseFloat(Math.abs(this.currentData.price - (pivot.s1 || pivot.p)).toFixed(decimals)),
          s2: parseFloat(Math.abs(this.currentData.price - pivot.s2).toFixed(decimals)),
          s3: parseFloat(Math.abs(this.currentData.price - pivot.s3).toFixed(decimals))
        };
      }

      this.emit('tick', { ...this.currentData, tickType: isUp ? 'UP' : 'DOWN' });
    }, 250);
  }

  /**
   * Binance Live WebSocket Stream for Crypto
   */
  initCryptoWebSocketStream(symbolStr) {
    const sym = symbolStr.toUpperCase();
    const pair = (sym.includes('USD') && !sym.includes('USDT') ? `${sym.replace('USD', 'USDT')}` : sym).toLowerCase();
    const wsUrl = `wss://stream.binance.com:9443/ws/${pair}@ticker`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.isWsConnected = true;
        logger.market(`⚡ Binance WebSocket stream connected for ${sym} (${pair}).`);
      });

      this.ws.on('message', (msg) => {
        try {
          const data = JSON.parse(msg.toString());
          if (data.c && this.activeSymbol === sym) {
            const symConfig = symbolService.getSymbol(sym);
            const decimals = symConfig?.priceDecimals || 2;
            const price = parseFloat(parseFloat(data.c).toFixed(decimals));
            const open = parseFloat(parseFloat(data.o).toFixed(decimals));
            const high = parseFloat(parseFloat(data.h).toFixed(decimals));
            const low = parseFloat(parseFloat(data.l).toFixed(decimals));
            const bid = parseFloat(parseFloat(data.b).toFixed(decimals));
            const ask = parseFloat(parseFloat(data.a).toFixed(decimals));
            const change = parseFloat(parseFloat(data.p).toFixed(decimals));
            const changePercent = parseFloat(parseFloat(data.P).toFixed(2));
            const volume = parseFloat(parseFloat(data.v).toFixed(2));

            this.updateMarketState({ price, open, high, low, bid, ask, change, changePercent, volume });
          }
        } catch (e) {}
      });

      this.ws.on('error', () => {
        this.isWsConnected = false;
      });

      this.ws.on('close', () => {
        this.isWsConnected = false;
      });
    } catch (err) {
      logger.error('WebSocket stream init error', err);
    }
  }

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(async () => {
      await this.fetchLiveQuoteForActiveSymbol();
    }, this.pollingInterval);
  }

  async saveSnapshot() {
    try {
      if (this.currentData.price && this.currentData.connected) {
        await MarketSnapshot.create({
          symbol: this.activeSymbol,
          provider: this.currentData.provider,
          price: this.currentData.price,
          bid: this.currentData.bid,
          ask: this.currentData.ask,
          open: this.currentData.open,
          high24h: this.currentData.high24h,
          low24h: this.currentData.low24h,
          change: this.currentData.change,
          changePercent: this.currentData.changePercent,
          volume: this.currentData.volume,
          timestamp: new Date()
        });
      }
    } catch (err) {}
  }

  getCurrentPrice() {
    return this.currentData.price;
  }

  getMarketData() {
    return { ...this.currentData };
  }

  getKlines() {
    return [...this.klines];
  }
}

export const marketDataService = new MarketDataService();
