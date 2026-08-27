import EventEmitter from 'events';
import axios from 'axios';
import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';
import { PivotState } from '../models/PivotState.js';
import { AlertConfiguration } from '../models/AlertConfiguration.js';
import { symbolService } from './symbolService.js';

class PivotService extends EventEmitter {
  constructor() {
    super();
    this.pivotStates = new Map(); // symbol -> PivotState
    this.alertConfigs = new Map(); // symbol -> AlertConfiguration
    this.rolloverCheckTimer = null;
    this.autoCalcTimer = null;
    this.io = null;
  }

  async initialize(socketServer = null) {
    if (socketServer) this.io = socketServer;
    logger.info('Initializing Dynamic Pivot Calculation & Rollover Engine...');

    await symbolService.initialize();

    // Listen for active symbol switch
    symbolService.on('activeSymbolChanged', async ({ activeSymbol }) => {
      logger.info(`Pivot Engine syncing for newly selected active symbol: ${activeSymbol}`);
      await this.getOrCalculatePivotsForSymbol(activeSymbol);
      this.broadcastPivotState();
    });

    // Pre-calculate initial levels for active symbol
    const activeSym = symbolService.getActiveSymbol();
    await this.getOrCalculatePivotsForSymbol(activeSym);

    // Schedule automated session rollover checking every 30 seconds
    if (this.rolloverCheckTimer) clearInterval(this.rolloverCheckTimer);
    this.rolloverCheckTimer = setInterval(() => this.checkSessionRollovers(), 30000);

    // Schedule periodic auto-calculation interval check (15m, 30m, etc.) every 30 seconds
    if (this.autoCalcTimer) clearInterval(this.autoCalcTimer);
    this.autoCalcTimer = setInterval(() => this.runPeriodicAutoCalculation(), 30000);

    logger.info(`Pivot Service ready. Active Symbol '${activeSym}' Levels: P=${this.getPivotState(activeSym)?.p || 'N/A'}`);
  }

  /**
   * Returns current active symbol's pivot state
   */
  getActivePivotState() {
    const sym = symbolService.getActiveSymbol();
    return this.getPivotState(sym);
  }

  getPivotState(symbolStr) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).toUpperCase();
    return this.pivotStates.get(sym) || null;
  }

  /**
   * Returns alert config for symbol
   */
  getConfig(symbolStr) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).toUpperCase();
    const pivot = this.getPivotState(sym);
    const symConfig = symbolService.getSymbol(sym) || symbolService.getActiveSymbolConfig();
    const alertCfg = this.alertConfigs.get(sym) || {};

    return {
      symbol: sym,
      tradingViewTicker: alertCfg.tradingViewTicker || symConfig?.tradingViewTicker || `OANDA:${sym}`,
      customChartUrl: alertCfg.customChartUrl || symConfig?.customChartUrl || '',
      chartTimeframe: alertCfg.chartTimeframe || symConfig?.chartTimeframe || '15',
      chartRange: alertCfg.chartRange || symConfig?.chartRange || '1D',
      barSpacing: Number(alertCfg.barSpacing || symConfig?.barSpacing || 22),
      enabled: alertCfg.enabled !== false,
      autoCalculatePivot: alertCfg.autoCalculatePivot !== false,
      autoCalcIntervalMinutes: alertCfg.autoCalcIntervalMinutes !== undefined ? Number(alertCfg.autoCalcIntervalMinutes) : 15,
      pivotType: pivot?.pivotType || alertCfg.pivotType || 'FIBONACCI',
      pivotTimeframe: pivot?.pivotTimeframe || alertCfg.pivotTimeframe || 'DAILY',
      tolerance: alertCfg.tolerance !== undefined ? Number(alertCfg.tolerance) : (symConfig?.tolerance || 0.20),
      retriggerDistance: alertCfg.retriggerDistance !== undefined ? Number(alertCfg.retriggerDistance) : (symConfig?.retriggerDistance || 1.00),
      telegramAlertsEnabled: alertCfg.telegramAlertsEnabled !== false,
      r3: pivot?.r3 ?? 0,
      r2: pivot?.r2 ?? 0,
      r1: pivot?.r1 ?? 0,
      pivot: pivot?.p ?? 0,
      s1: pivot?.s1 ?? 0,
      s2: pivot?.s2 ?? 0,
      s3: pivot?.s3 ?? 0,
      dailyHigh: pivot?.high ?? 0,
      dailyLow: pivot?.low ?? 0,
      dailyClose: pivot?.close ?? 0,
      dailyOpen: pivot?.open ?? 0,
      lastCalculatedAt: pivot?.calculatedAt || new Date(),
      nextRolloverAt: pivot?.nextRolloverAt || null,
      isValid: pivot?.isValid ?? true,
      validationErrors: pivot?.validationErrors || []
    };
  }

  /**
   * Primary: Fetches previous completed period OHLC candle directly from TradingView Scanner API
   * with automated fallbacks to Binance Klines and Yahoo Finance.
   */
  async fetchPreviousCompletedOHLC(symbolStr, timeframe = 'DAILY') {
    const sym = (symbolStr || symbolService.getActiveSymbol()).toUpperCase();
    const symConfig = symbolService.getSymbol(sym) || symbolService.getActiveSymbolConfig();
    const decimals = symConfig?.priceDecimals ?? 2;

    logger.info(`Fetching previous completed ${timeframe} OHLC for ${sym} (${symConfig?.provider || 'TradingView'})...`);

    // 1. TradingView Scanner API (Authoritative source for completed daily bars: high[1], low[1], close[1], open[1])
    const candidateScanners = [];
    if (symConfig?.assetType === 'CRYPTO') candidateScanners.push('crypto');
    else if (symConfig?.assetType === 'FOREX') candidateScanners.push('forex');
    else if (symConfig?.assetType === 'INDEX' && symConfig?.exchange === 'NSE') candidateScanners.push('india');
    else if (symConfig?.assetType === 'INDEX') candidateScanners.push('america', 'cfd', 'global');
    else if (symConfig?.assetType === 'STOCK') candidateScanners.push('america');
    else candidateScanners.push('cfd', 'forex', 'global');

    // General fallback scanner list
    ['cfd', 'forex', 'crypto', 'america', 'india', 'global'].forEach(sc => {
      if (!candidateScanners.includes(sc)) candidateScanners.push(sc);
    });

    const candidateTickers = [
      symConfig?.tradingViewTicker,
      `OANDA:${sym}`,
      `FX_IDC:${sym}`,
      `TVC:${sym}`,
      `PEPPERSTONE:${sym}`,
      `FOREXCOM:${sym}`,
      `BINANCE:${sym.replace('USD', 'USDT')}`,
      `BINANCE:${sym}`
    ].filter(Boolean);

    for (const sc of candidateScanners) {
      try {
        const res = await axios.post(
          `https://scanner.tradingview.com/${sc}/scan`,
          {
            symbols: { tickers: candidateTickers },
            columns: ['name', 'open[1]', 'high[1]', 'low[1]', 'close[1]', 'close', 'open[2]', 'high[2]', 'low[2]', 'close[2]']
          },
          { headers: { 'Content-Type': 'application/json' }, timeout: 4500 }
        );

        if (res.data?.data && Array.isArray(res.data.data) && res.data.data.length > 0) {
          const match = res.data.data.find(item => item.d && item.d[2] !== null && item.d[3] !== null && item.d[4] !== null);
          if (match) {
            const [, o1, h1, l1, c1] = match.d;
            const high = parseFloat(parseFloat(h1).toFixed(decimals));
            const low = parseFloat(parseFloat(l1).toFixed(decimals));
            const close = parseFloat(parseFloat(c1).toFixed(decimals));
            const open = o1 !== null ? parseFloat(parseFloat(o1).toFixed(decimals)) : close;

            // Compute session date
            const now = new Date();
            const sessionDate = new Date(now.getTime() - 86400000);
            const periodDateStr = sessionDate.toISOString().split('T')[0];

            logger.info(`✅ TradingView Scanner [${sc}] Completed ${timeframe} OHLC for ${sym} (${match.s}): High=${high}, Low=${low}, Close=${close}, Open=${open}`);
            return {
              high,
              low,
              close,
              open,
              periodStart: sessionDate,
              periodEnd: now,
              periodDateStr,
              dataSource: `TradingView Scanner (${match.s})`
            };
          }
        }
      } catch (tvErr) {
        // continue to next candidate scanner
      }
    }

    // 2. Crypto Fallback: Binance Klines API
    if (symConfig?.assetType === 'CRYPTO') {
      try {
        const pair = sym.includes('USD') && !sym.includes('USDT') ? `${sym.replace('USD', 'USDT')}` : sym;
        const interval = timeframe === 'WEEKLY' ? '1w' : (timeframe === 'MONTHLY' ? '1M' : '1d');
        const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=5`;
        
        const res = await axios.get(url, { timeout: 4500 });
        if (Array.isArray(res.data) && res.data.length >= 2) {
          const completedBar = res.data[res.data.length - 2];
          const openTime = new Date(completedBar[0]);
          const closeTime = new Date(completedBar[6]);
          const open = parseFloat(parseFloat(completedBar[1]).toFixed(decimals));
          const high = parseFloat(parseFloat(completedBar[2]).toFixed(decimals));
          const low = parseFloat(parseFloat(completedBar[3]).toFixed(decimals));
          const close = parseFloat(parseFloat(completedBar[4]).toFixed(decimals));

          logger.info(`✅ Binance Completed ${timeframe} OHLC for ${sym} (${pair}): High=${high}, Low=${low}, Close=${close} (Bar Date: ${openTime.toISOString().split('T')[0]})`);
          return {
            high,
            low,
            close,
            open,
            periodStart: openTime,
            periodEnd: closeTime,
            periodDateStr: openTime.toISOString().split('T')[0],
            dataSource: `Binance Completed Klines (${pair})`
          };
        }
      } catch (binanceErr) {
        logger.warn(`Binance completed klines fallback failed for ${sym}: ${binanceErr.message}`);
      }
    }

    // 3. Fallback: Yahoo Finance Historical Chart API
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

    const yfTicker = yfMap[sym] || sym;
    try {
      const range = timeframe === 'WEEKLY' ? '1mo' : (timeframe === 'MONTHLY' ? '3mo' : '5d');
      const interval = timeframe === 'WEEKLY' ? '1wk' : (timeframe === 'MONTHLY' ? '1mo' : '1d');
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfTicker)}?interval=${interval}&range=${range}`;

      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 4500
      });

      const result = res.data?.chart?.result?.[0];
      if (result && result.indicators?.quote?.[0]) {
        const timestamps = result.timestamp || [];
        const quotes = result.indicators.quote[0];
        
        let validIdx = -1;
        for (let i = timestamps.length - 1; i >= 0; i--) {
          if (quotes.high[i] !== null && quotes.low[i] !== null && quotes.close[i] !== null) {
            const barDate = new Date(timestamps[i] * 1000);
            const now = new Date();
            const isToday = barDate.getUTCFullYear() === now.getUTCFullYear() &&
                            barDate.getUTCMonth() === now.getUTCMonth() &&
                            barDate.getUTCDate() === now.getUTCDate();
            
            if (isToday && i > 0 && quotes.close[i - 1] !== null) {
              validIdx = i - 1; // finalized yesterday
            } else {
              validIdx = i;
            }
            break;
          }
        }

        if (validIdx >= 0) {
          const high = parseFloat(parseFloat(quotes.high[validIdx]).toFixed(decimals));
          const low = parseFloat(parseFloat(quotes.low[validIdx]).toFixed(decimals));
          const close = parseFloat(parseFloat(quotes.close[validIdx]).toFixed(decimals));
          const open = quotes.open[validIdx] ? parseFloat(parseFloat(quotes.open[validIdx]).toFixed(decimals)) : close;
          const barDate = new Date(timestamps[validIdx] * 1000);

          logger.info(`✅ Yahoo Finance Completed ${timeframe} OHLC for ${sym} (${yfTicker}): High=${high}, Low=${low}, Close=${close} (Bar Date: ${barDate.toISOString().split('T')[0]})`);
          return {
            high,
            low,
            close,
            open,
            periodStart: barDate,
            periodEnd: new Date(barDate.getTime() + 86400000),
            periodDateStr: barDate.toISOString().split('T')[0],
            dataSource: `Yahoo Finance Historical (${yfTicker})`
          };
        }
      }
    } catch (yfErr) {
      logger.warn(`Yahoo Finance historical OHLC fallback failed for ${sym} (${yfTicker}): ${yfErr.message}`);
    }

    throw new Error(`Unable to fetch valid historical completed OHLC data for '${sym}' from TradingView, Binance, or Yahoo Finance.`);
  }

  /**
   * Fetches completed OHLC for multiple previous days (e.g. past 10 sessions)
   * and calculates the historical pivot levels for each day.
   */
  async fetchCompletedOHLCHistory(symbolStr, count = 10, timeframe = 'DAILY', pivotType = 'FIBONACCI') {
    const sym = (symbolStr || symbolService.getActiveSymbol()).toUpperCase();
    const symConfig = symbolService.getSymbol(sym) || symbolService.getActiveSymbolConfig();
    const decimals = symConfig?.priceDecimals ?? 2;
    const historyList = [];

    try {
      // 1. Try TradingView Scanner for multi-day columns (Day [1] through Day [5])
      const sc = symConfig?.assetType === 'CRYPTO' ? 'crypto' :
                 symConfig?.assetType === 'FOREX' ? 'forex' :
                 (symConfig?.assetType === 'INDEX' && symConfig?.exchange === 'NSE') ? 'india' :
                 symConfig?.assetType === 'STOCK' ? 'america' : 'cfd';

      const candidateTickers = [
        symConfig?.tradingViewTicker,
        `OANDA:${sym}`,
        `FX_IDC:${sym}`,
        `TVC:${sym}`,
        `PEPPERSTONE:${sym}`
      ].filter(Boolean);

      const cols = ['name'];
      for (let i = 1; i <= Math.min(count, 5); i++) {
        cols.push(`open[${i}]`, `high[${i}]`, `low[${i}]`, `close[${i}]`);
      }

      const res = await axios.post(
        `https://scanner.tradingview.com/${sc}/scan`,
        { symbols: { tickers: candidateTickers }, columns: cols },
        { headers: { 'Content-Type': 'application/json' }, timeout: 4500 }
      );

      if (res.data?.data && Array.isArray(res.data.data)) {
        const match = res.data.data.find(item => item.d && item.d[2] !== null);
        if (match && match.d) {
          const d = match.d;
          const now = new Date();

          for (let i = 1; i <= Math.min(count, 5); i++) {
            const offset = 1 + (i - 1) * 4;
            const o = d[offset];
            const h = d[offset + 1];
            const l = d[offset + 2];
            const c = d[offset + 3];

            if (h !== null && l !== null && c !== null && !isNaN(h) && !isNaN(l) && !isNaN(c)) {
              const dayHigh = parseFloat(parseFloat(h).toFixed(decimals));
              const dayLow = parseFloat(parseFloat(l).toFixed(decimals));
              const dayClose = parseFloat(parseFloat(c).toFixed(decimals));
              const dayOpen = o !== null ? parseFloat(parseFloat(o).toFixed(decimals)) : dayClose;

              const sessionDate = new Date(now.getTime() - i * 86400000);
              const dateStr = sessionDate.toISOString().split('T')[0];

              const calc = this.calculatePivotsFromOHLC({
                high: dayHigh,
                low: dayLow,
                close: dayClose,
                open: dayOpen,
                pivotType,
                priceDecimals: decimals
              });

              historyList.push({
                date: dateStr,
                sessionIndex: i,
                dayHigh,
                dayLow,
                dayClose,
                dayOpen,
                p: calc.p,
                r1: calc.r1,
                r2: calc.r2,
                r3: calc.r3,
                s1: calc.s1,
                s2: calc.s2,
                s3: calc.s3,
                r3Touched: false,
                r2Touched: false,
                s2Touched: false,
                s3Touched: false,
                dataSource: `TradingView Scanner (${match.s})`
              });
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`TradingView scanner multi-day fetch for ${sym}: ${err.message}`);
    }

    // 2. Supplement from MongoDB historical pivot states if available
    if (mongoose.connection.readyState === 1 && historyList.length < count) {
      try {
        const dbHistory = await PivotState.find({
          symbol: sym,
          pivotType,
          pivotTimeframe: timeframe
        })
        .sort({ calculatedAt: -1 })
        .limit(count)
        .lean();

        for (const item of dbHistory) {
          const dateStr = item.periodDateStr || (item.calculatedAt ? new Date(item.calculatedAt).toISOString().split('T')[0] : '');
          if (dateStr && !historyList.some(h => h.date === dateStr)) {
            historyList.push({
              date: dateStr,
              dayHigh: item.high,
              dayLow: item.low,
              dayClose: item.close,
              dayOpen: item.open,
              p: item.p,
              r1: item.r1,
              r2: item.r2,
              r3: item.r3,
              s1: item.s1,
              s2: item.s2,
              s3: item.s3,
              r3Touched: false,
              r2Touched: false,
              s2Touched: false,
              s3Touched: false,
              dataSource: item.dataSource || 'MongoDB Stored History'
            });
          }
        }
      } catch (dbErr) {
        logger.warn(`Could not read MongoDB PivotState history: ${dbErr.message}`);
      }
    }

    return historyList;
  }

  /**
   * Mathematically calculates pivot levels from completed [High, Low, Close]
   */
  calculatePivotsFromOHLC({ high, low, close, open = null, pivotType = 'FIBONACCI', priceDecimals = 3 }) {
    const H = parseFloat(high);
    const L = parseFloat(low);
    const C = parseFloat(close);
    const O = open !== null ? parseFloat(open) : C;
    const rawRange = H - L;

    let rawP, rawR1, rawR2, rawR3, rawS1, rawS2, rawS3;
    const type = (pivotType || 'FIBONACCI').toUpperCase();

    if (type === 'FIBONACCI') {
      // TradingView Standard Fibonacci Pivot Formula
      rawP = (H + L + C) / 3;
      rawR1 = rawP + 0.382 * rawRange;
      rawS1 = rawP - 0.382 * rawRange;
      rawR2 = rawP + 0.618 * rawRange;
      rawS2 = rawP - 0.618 * rawRange;
      rawR3 = rawP + 1.000 * rawRange;
      rawS3 = rawP - 1.000 * rawRange;
    } else if (type === 'CAMARILLA') {
      // Camarilla Pivot Formula
      rawP = (H + L + C) / 3;
      rawR1 = C + rawRange * 1.1 / 12;
      rawS1 = C - rawRange * 1.1 / 12;
      rawR2 = C + rawRange * 1.1 / 6;
      rawS2 = C - rawRange * 1.1 / 6;
      rawR3 = C + rawRange * 1.1 / 4;
      rawS3 = C - rawRange * 1.1 / 4;
    } else if (type === 'WOODIE') {
      // Woodie Pivot Formula
      rawP = (H + L + 2 * C) / 4;
      rawR1 = 2 * rawP - L;
      rawS1 = 2 * rawP - H;
      rawR2 = rawP + rawRange;
      rawS2 = rawP - rawRange;
      rawR3 = H + 2 * (rawP - L);
      rawS3 = L - 2 * (H - rawP);
    } else {
      // TRADITIONAL / CLASSIC (Floor Pivot Methodology)
      rawP = (H + L + C) / 3;
      rawR1 = 2 * rawP - L;
      rawS1 = 2 * rawP - H;
      rawR2 = rawP + rawRange;
      rawS2 = rawP - rawRange;
      rawR3 = H + 2 * (rawP - L);
      rawS3 = L - 2 * (H - rawP);
    }

    return {
      pivotType: type,
      high: parseFloat(H.toFixed(priceDecimals)),
      low: parseFloat(L.toFixed(priceDecimals)),
      close: parseFloat(C.toFixed(priceDecimals)),
      open: parseFloat(O.toFixed(priceDecimals)),
      range: parseFloat(rawRange.toFixed(priceDecimals)),
      p: parseFloat(rawP.toFixed(priceDecimals)),
      r1: parseFloat(rawR1.toFixed(priceDecimals)),
      r2: parseFloat(rawR2.toFixed(priceDecimals)),
      r3: parseFloat(rawR3.toFixed(priceDecimals)),
      s1: parseFloat(rawS1.toFixed(priceDecimals)),
      s2: parseFloat(rawS2.toFixed(priceDecimals)),
      s3: parseFloat(rawS3.toFixed(priceDecimals))
    };
  }

  /**
   * 10-Point Mathematical Validation Function
   */
  validatePivot(symbolStr, calculatedState = null) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).toUpperCase();
    const state = calculatedState || this.getPivotState(sym);
    const errors = [];

    if (!state) {
      errors.push(`No pivot state found for symbol '${sym}'.`);
      return { isValid: false, errors };
    }

    // 1. Symbol matching
    if (state.symbol && state.symbol.toUpperCase() !== sym) {
      errors.push(`Symbol mismatch: expected '${sym}', got '${state.symbol}'.`);
    }

    // 2. Numerical validity of OHLC
    if (isNaN(state.high) || isNaN(state.low) || isNaN(state.close)) {
      errors.push('OHLC values must be valid non-NaN numbers.');
    }

    // 3. High >= Low boundary check
    if (state.high < state.low) {
      errors.push(`Invalid OHLC bounds: High (${state.high}) is less than Low (${state.low}).`);
    }

    // 4. Close is within High-Low range (or reasonable session spread)
    if (state.close > state.high * 1.05 || state.close < state.low * 0.95) {
      errors.push(`Close price (${state.close}) is outside reasonable [Low, High] bounds.`);
    }

    // 5. Positive non-zero numbers
    if (state.high <= 0 || state.low <= 0 || state.close <= 0) {
      errors.push('OHLC prices must be strictly positive numbers.');
    }

    // 6. Calculated Levels validity
    const levels = ['p', 'r1', 'r2', 'r3', 's1', 's2', 's3'];
    levels.forEach(lvl => {
      if (state[lvl] === undefined || state[lvl] === null || isNaN(state[lvl])) {
        errors.push(`Pivot level '${lvl.toUpperCase()}' is null or NaN.`);
      }
    });

    // 7. Hierarchy checks: R3 > R2 > P > S2 > S3
    if (state.r3 <= state.r2) errors.push(`R3 (${state.r3}) should be greater than R2 (${state.r2}).`);
    if (state.r2 <= state.p) errors.push(`R2 (${state.r2}) should be greater than Pivot (${state.p}).`);
    if (state.p <= state.s2) errors.push(`Pivot (${state.p}) should be greater than S2 (${state.s2}).`);
    if (state.s2 <= state.s3) errors.push(`S2 (${state.s2}) should be greater than S3 (${state.s3}).`);

    // 8. Completed period date check
    if (!state.periodDateStr && !state.periodStart) {
      errors.push('Completed period date timestamp is missing.');
    }

    // 9. Timeframe check
    if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes((state.pivotTimeframe || '').toUpperCase())) {
      errors.push(`Invalid pivot timeframe '${state.pivotTimeframe}'.`);
    }

    // 10. Pivot formula check
    if (!['TRADITIONAL', 'FIBONACCI', 'CAMARILLA', 'WOODIE', 'CLASSIC'].includes((state.pivotType || '').toUpperCase())) {
      errors.push(`Invalid pivot type formula '${state.pivotType}'.`);
    }

    const isValid = errors.length === 0;
    if (!isValid) {
      logger.error(`❌ PIVOT VALIDATION FAILED for ${sym}: ${errors.join(' | ')}`);
    }

    return { isValid, errors };
  }

  /**
   * Calculates next session rollover timestamp based on symbol timezone & session close
   */
  calculateNextRolloverTime(symbolStr, timeframe = 'DAILY') {
    const sym = (symbolStr || symbolService.getActiveSymbol()).toUpperCase();
    const symConfig = symbolService.getSymbol(sym);
    const now = new Date();

    if (timeframe === 'WEEKLY') {
      const nextSunday = new Date(now);
      const day = now.getUTCDay();
      const diff = (7 - day) % 7 || 7;
      nextSunday.setUTCDate(now.getUTCDate() + diff);
      nextSunday.setUTCHours(22, 0, 0, 0);
      return nextSunday;
    }

    if (timeframe === 'MONTHLY') {
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
    }

    // Daily rollover: parse sessionCloseUtc (e.g. "22:00" for Forex, "10:00" for NSE, "00:00" for Crypto)
    const [closeHour, closeMin] = (symConfig?.sessionCloseUtc || '22:00').split(':').map(Number);
    const rollover = new Date();
    rollover.setUTCHours(closeHour, closeMin, 0, 0);

    if (now.getTime() >= rollover.getTime()) {
      rollover.setUTCDate(rollover.getUTCDate() + 1);
    }

    return rollover;
  }

  /**
   * Returns current active pivot period string based on session close time (e.g. '2026-08-24')
   */
  getCurrentPivotPeriod(symbolStr, timeframe = 'DAILY') {
    const sym = (symbolStr || symbolService.getActiveSymbol()).toUpperCase();
    const symConfig = symbolService.getSymbol(sym);
    const now = new Date();

    if (timeframe === 'WEEKLY') {
      const year = now.getUTCFullYear();
      const week = Math.ceil((((now.getTime() - new Date(Date.UTC(year, 0, 1)).getTime()) / 86400000) + 1) / 7);
      return `${year}-W${String(week).padStart(2, '0')}`;
    }

    if (timeframe === 'MONTHLY') {
      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    // Daily
    const [closeHour, closeMin] = (symConfig?.sessionCloseUtc || '22:00').split(':').map(Number);
    const sessionCloseToday = new Date(now);
    sessionCloseToday.setUTCHours(closeHour, closeMin, 0, 0);

    const sessionDate = new Date(now);
    if (now.getTime() >= sessionCloseToday.getTime()) {
      sessionDate.setUTCDate(sessionDate.getUTCDate() + 1);
    }
    return sessionDate.toISOString().split('T')[0];
  }

  /**
   * Primary method: Retrieves or recalculates pivots dynamically from real live completed OHLC data
   */
  async getOrCalculatePivotsForSymbol(symbolStr, options = {}) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).toUpperCase();
    const symConfig = symbolService.getSymbol(sym) || symbolService.getActiveSymbolConfig();
    
    const pivotType = (options.pivotType || 'FIBONACCI').toUpperCase();
    const pivotTimeframe = (options.pivotTimeframe || 'DAILY').toUpperCase();
    const currentPeriod = this.getCurrentPivotPeriod(sym, pivotTimeframe);

    // 1. Check existing in-memory state if not forced
    const existingState = this.pivotStates.get(sym);
    if (!options.force && existingState && existingState.pivotPeriod === currentPeriod && existingState.pivotType === pivotType && existingState.pivotTimeframe === pivotTimeframe && existingState.isValid) {
      return existingState;
    }

    if (!options.force && mongoose.connection.readyState === 1) {
      try {
        const dbActive = await PivotState.findOne({
          symbol: sym,
          pivotType,
          pivotTimeframe,
          pivotPeriod: currentPeriod,
          status: 'ACTIVE',
          isValid: true
        }).lean();

        if (dbActive) {
          this.pivotStates.set(sym, dbActive);
          return dbActive;
        }
      } catch (e) {}
    }

    try {
      // 2. Fetch real completed OHLC for previous closed period (no hardcoding)
      const ohlc = await this.fetchPreviousCompletedOHLC(sym, pivotTimeframe);

      // 3. Compute levels
      const calc = this.calculatePivotsFromOHLC({
        high: ohlc.high,
        low: ohlc.low,
        close: ohlc.close,
        open: ohlc.open,
        pivotType,
        priceDecimals: symConfig?.priceDecimals ?? 2
      });

      // 4. Next rollover time
      const nextRolloverAt = this.calculateNextRolloverTime(sym, pivotTimeframe);

      // 5. Build previous levels reference
      const prevLevels = existingState ? {
        periodDateStr: existingState.pivotPeriod || existingState.periodDateStr,
        high: existingState.high,
        low: existingState.low,
        close: existingState.close,
        p: existingState.p,
        r1: existingState.r1,
        r2: existingState.r2,
        r3: existingState.r3,
        s1: existingState.s1,
        s2: existingState.s2,
        s3: existingState.s3
      } : null;

      const stateObj = {
        symbol: sym,
        pivotType,
        pivotTimeframe,
        pivotPeriod: currentPeriod,
        status: 'ACTIVE',
        periodStart: ohlc.periodStart,
        periodEnd: ohlc.periodEnd,
        periodDateStr: ohlc.periodDateStr,
        high: calc.high,
        low: calc.low,
        close: calc.close,
        open: calc.open,
        range: calc.range,
        p: calc.p,
        r1: calc.r1,
        r2: calc.r2,
        r3: calc.r3,
        s1: calc.s1,
        s2: calc.s2,
        s3: calc.s3,
        previousLevels: prevLevels,
        calculatedAt: new Date(),
        nextRolloverAt,
        dataSource: ohlc.dataSource,
        isValid: true,
        validationErrors: []
      };

      // 6. 10-Point Mathematical Validation
      const validation = this.validatePivot(sym, stateObj);
      stateObj.isValid = validation.isValid;
      stateObj.validationErrors = validation.errors;

      if (!validation.isValid) {
        logger.error(`❌ Validation failed for newly calculated levels of ${sym}. Retaining existing state.`);
        return existingState || stateObj;
      }

      // 7. Mark old state as HISTORICAL in MongoDB
      if (mongoose.connection.readyState === 1) {
        try {
          await PivotState.updateMany(
            { symbol: sym, pivotType, pivotTimeframe, status: 'ACTIVE', pivotPeriod: { $ne: currentPeriod } },
            { $set: { status: 'HISTORICAL' } }
          );

          try {
            await PivotState.findOneAndUpdate(
              { symbol: sym, pivotType, pivotTimeframe, pivotPeriod: currentPeriod },
              { $set: stateObj },
              { upsert: true, new: true }
            );
          } catch (e11000) {
            if (e11000.code === 11000) {
              await PivotState.collection.dropIndex('symbol_1_pivotType_1_pivotTimeframe_1').catch(() => {});
              await PivotState.findOneAndUpdate(
                { symbol: sym, pivotType, pivotTimeframe },
                { $set: stateObj },
                { upsert: true, new: true }
              );
            } else {
              throw e11000;
            }
          }
        } catch (dbErr) {
          logger.warn(`Could not persist PivotState in MongoDB: ${dbErr.message}`);
        }
      }

      // 8. Store in memory
      this.pivotStates.set(sym, stateObj);

      // 9. Structured Diagnostic Log & Difference Detection
      const isDifferent = !existingState ||
        existingState.r3 !== calc.r3 ||
        existingState.r2 !== calc.r2 ||
        existingState.s2 !== calc.s2 ||
        existingState.s3 !== calc.s3 ||
        existingState.pivotPeriod !== currentPeriod;

      const isPeriodChange = existingState && existingState.pivotPeriod !== currentPeriod;
      logger.info(`=======================================================`);
      logger.info(`  [PIVOT ${isPeriodChange ? 'ROLLOVER' : 'CALCULATION'}]`);
      logger.info(`  Symbol:        ${sym} (${symConfig?.displayName || sym})`);
      logger.info(`  Data Source:   ${ohlc.dataSource}`);
      logger.info(`  Session Date:  ${ohlc.periodDateStr} (${pivotTimeframe})`);
      logger.info(`  Completed Bar: High=${calc.high} | Low=${calc.low} | Close=${calc.close}`);
      logger.info(`  NEW LEVELS:    R3=${calc.r3} | R2=${calc.r2} | R1=${calc.r1} | P=${calc.p} | S1=${calc.s1} | S2=${calc.s2} | S3=${calc.s3}`);
      logger.info(`  Levels Changed: ${isDifferent ? 'YES (New levels active in memory)' : 'NO (Unchanged)'}`);
      logger.info(`  Status:        ACTIVE (Validated 100%)`);
      logger.info(`=======================================================`);

      // 10. Notify Alert Engine & Broadcast over Socket.IO
      this.emit('pivot:updated', { symbol: sym, state: stateObj, previousState: existingState, isDifferent });
      this.broadcastPivotState(stateObj);

      return stateObj;
    } catch (err) {
      logger.error(`Failed to calculate pivots for ${sym}: ${err.message}`);
      return existingState || this.getPivotState(sym);
    }
  }

  /**
   * Automated periodic check to detect session rollovers
   */
  async checkSessionRollovers() {
    const now = new Date();
    for (const [sym, state] of this.pivotStates.entries()) {
      const currentExpectedPeriod = this.getCurrentPivotPeriod(sym, state.pivotTimeframe || 'DAILY');
      const isPastRolloverTime = state.nextRolloverAt && now.getTime() >= new Date(state.nextRolloverAt).getTime();
      const isPeriodShifted = state.pivotPeriod && state.pivotPeriod !== currentExpectedPeriod;

      if (isPastRolloverTime || isPeriodShifted) {
        logger.info(`⏰ Automated session boundary update for ${sym}. Recalculating live levels...`);
        await this.getOrCalculatePivotsForSymbol(sym, {
          pivotType: state.pivotType,
          pivotTimeframe: state.pivotTimeframe,
          force: true
        });
      }
    }
  }

  /**
   * Periodic automatic recalculation worker (runs every 15m, 30m, etc.)
   */
  async runPeriodicAutoCalculation() {
    const now = new Date();
    for (const [sym, state] of this.pivotStates.entries()) {
      const cfg = this.getConfig(sym);
      if (!cfg || cfg.enabled === false || cfg.autoCalculatePivot === false) continue;

      const intervalMin = Number(cfg.autoCalcIntervalMinutes || 15);
      if (intervalMin <= 0) continue;

      const intervalMs = intervalMin * 60 * 1000;
      const lastCalcTime = state?.calculatedAt ? new Date(state.calculatedAt).getTime() : 0;
      const elapsed = now.getTime() - lastCalcTime;

      if (elapsed >= intervalMs) {
        logger.info(`⏰ [AUTO-CALC ${intervalMin}m] Triggering automatic recalculation for ${sym} (elapsed: ${Math.round(elapsed / 60000)}m)...`);
        await this.getOrCalculatePivotsForSymbol(sym, {
          pivotType: cfg.pivotType || state.pivotType,
          pivotTimeframe: cfg.pivotTimeframe || state.pivotTimeframe,
          force: true,
          isPeriodic: true
        });
      }
    }
  }

  broadcastPivotState(specificState) {
    if (!this.io) return;
    const activeSym = symbolService.getActiveSymbol();
    const pivotState = specificState || this.getActivePivotState();
    if (!pivotState) return;

    const symConfig = this.getConfig(pivotState.symbol);

    const payload = {
      symbol: pivotState.symbol,
      pivotType: pivotState.pivotType,
      pivotTimeframe: pivotState.pivotTimeframe,
      pivotPeriod: pivotState.pivotPeriod,
      p: pivotState.p,
      r1: pivotState.r1,
      r2: pivotState.r2,
      r3: pivotState.r3,
      s1: pivotState.s1,
      s2: pivotState.s2,
      s3: pivotState.s3,
      dailyHigh: pivotState.high,
      dailyLow: pivotState.low,
      dailyClose: pivotState.close,
      dailyOpen: pivotState.open,
      previousPeriod: {
        high: pivotState.high,
        low: pivotState.low,
        close: pivotState.close,
        open: pivotState.open
      },
      previousPivotState: pivotState.previousLevels,
      calculatedAt: pivotState.calculatedAt,
      nextRolloverAt: pivotState.nextRolloverAt,
      autoCalcIntervalMinutes: symConfig.autoCalcIntervalMinutes || 15,
      dataSource: pivotState.dataSource,
      status: 'ACTIVE'
    };

    // Primary requested event
    this.io.emit('pivotUpdated', payload);

    // Additional listeners
    this.io.emit('pivot:state', pivotState);
    this.io.emit('config:update', symConfig);
  }
}

export const pivotService = new PivotService();
