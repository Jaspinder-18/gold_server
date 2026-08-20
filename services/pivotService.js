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

    // Schedule automated session rollover checking every 60 seconds
    if (this.rolloverCheckTimer) clearInterval(this.rolloverCheckTimer);
    this.rolloverCheckTimer = setInterval(() => this.checkSessionRollovers(), 60000);

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
      tradingViewTicker: symConfig.tradingViewTicker,
      customChartUrl: symConfig.customChartUrl || '',
      chartTimeframe: symConfig.chartTimeframe || '15',
      chartRange: symConfig.chartRange || '1D',
      barSpacing: symConfig.barSpacing || 22,
      enabled: alertCfg.enabled !== false,
      autoCalculatePivot: true,
      pivotType: pivot?.pivotType || alertCfg.pivotType || 'TRADITIONAL',
      pivotTimeframe: pivot?.pivotTimeframe || alertCfg.pivotTimeframe || 'DAILY',
      tolerance: symConfig.tolerance || 0.20,
      retriggerDistance: symConfig.retriggerDistance || 1.00,
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
      lastCalculatedAt: pivot?.calculatedAt || new Date(),
      nextRolloverAt: pivot?.nextRolloverAt || null,
      isValid: pivot?.isValid ?? true,
      validationErrors: pivot?.validationErrors || []
    };
  }

  /**
   * Fetches previous completed period OHLC candle from official market data feeds
   */
  async fetchPreviousCompletedOHLC(symbolStr, timeframe = 'DAILY') {
    const sym = (symbolStr || symbolService.getActiveSymbol()).toUpperCase();
    const symConfig = symbolService.getSymbol(sym);

    logger.info(`Fetching previous completed ${timeframe} OHLC for ${sym} (${symConfig?.provider || 'Global'})...`);

    // 1. Crypto: Direct Binance Klines API
    if (symConfig?.assetType === 'CRYPTO') {
      try {
        const pair = sym.includes('USD') && !sym.includes('USDT') ? `${sym.replace('USD', 'USDT')}` : sym;
        const interval = timeframe === 'WEEKLY' ? '1w' : (timeframe === 'MONTHLY' ? '1M' : '1d');
        const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=5`;
        
        const res = await axios.get(url, { timeout: 5000 });
        if (res.data && Array.isArray(res.data) && res.data.length >= 2) {
          // Index len - 2 is the PREVIOUS COMPLETED candle (index len - 1 is currently forming)
          const prevCandle = res.data[res.data.length - 2];
          const openTime = new Date(prevCandle[0]);
          const closeTime = new Date(prevCandle[6]);

          const open = parseFloat(parseFloat(prevCandle[1]).toFixed(symConfig.priceDecimals || 2));
          const high = parseFloat(parseFloat(prevCandle[2]).toFixed(symConfig.priceDecimals || 2));
          const low = parseFloat(parseFloat(prevCandle[3]).toFixed(symConfig.priceDecimals || 2));
          const close = parseFloat(parseFloat(prevCandle[4]).toFixed(symConfig.priceDecimals || 2));

          logger.info(`✅ Binance Historical ${timeframe} OHLC for ${sym}: High=${high}, Low=${low}, Close=${close} (Closed: ${closeTime.toUTCString()})`);
          return {
            high,
            low,
            close,
            open,
            periodStart: openTime,
            periodEnd: closeTime,
            periodDateStr: openTime.toISOString().split('T')[0],
            dataSource: 'Binance Completed Klines API'
          };
        }
      } catch (binanceErr) {
        logger.warn(`Binance completed klines fetch error for ${sym}: ${binanceErr.message}`);
      }
    }

    // 2. Forex, Commodities, Indices, Stocks: Yahoo Finance / TradingView Scanner Historical
    const tickerMap = {
      XAUUSD: 'XAUUSD=X',
      XAGUSD: 'XAGUSD=X',
      EURUSD: 'EURUSD=X',
      GBPUSD: 'GBPUSD=X',
      USDJPY: 'USDJPY=X',
      NIFTY: '^NSEI',
      BANKNIFTY: '^NSEBANK',
      US30: '^DJI',
      SPX: '^GSPC',
      NASDAQ: '^IXIC',
      AAPL: 'AAPL',
      TSLA: 'TSLA',
      NVDA: 'NVDA'
    };

    const yfTicker = tickerMap[sym] || sym;
    try {
      const range = timeframe === 'WEEKLY' ? '1mo' : (timeframe === 'MONTHLY' ? '3mo' : '5d');
      const interval = timeframe === 'WEEKLY' ? '1wk' : (timeframe === 'MONTHLY' ? '1mo' : '1d');
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfTicker)}?interval=${interval}&range=${range}`;

      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000
      });

      const result = res.data?.chart?.result?.[0];
      if (result && result.indicators?.quote?.[0]) {
        const timestamps = result.timestamp || [];
        const quotes = result.indicators.quote[0];
        
        // Find latest COMPLETED historical bar (non-null and before today's forming candle)
        let validIdx = -1;
        for (let i = timestamps.length - 1; i >= 0; i--) {
          if (quotes.high[i] !== null && quotes.low[i] !== null && quotes.close[i] !== null) {
            // If the last bar timestamp is very recent (e.g. today during live market), take the previous bar
            const barDate = new Date(timestamps[i] * 1000);
            const now = new Date();
            const isToday = barDate.getUTCFullYear() === now.getUTCFullYear() &&
                            barDate.getUTCMonth() === now.getUTCMonth() &&
                            barDate.getUTCDate() === now.getUTCDate();
            
            if (isToday && i > 0 && quotes.close[i - 1] !== null) {
              validIdx = i - 1; // Take finalized yesterday
            } else {
              validIdx = i;
            }
            break;
          }
        }

        if (validIdx >= 0) {
          const high = parseFloat(parseFloat(quotes.high[validIdx]).toFixed(symConfig?.priceDecimals || 2));
          const low = parseFloat(parseFloat(quotes.low[validIdx]).toFixed(symConfig?.priceDecimals || 2));
          const close = parseFloat(parseFloat(quotes.close[validIdx]).toFixed(symConfig?.priceDecimals || 2));
          const open = quotes.open[validIdx] ? parseFloat(parseFloat(quotes.open[validIdx]).toFixed(symConfig?.priceDecimals || 2)) : close;
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
      logger.warn(`Yahoo Finance historical OHLC fetch failed for ${sym} (${yfTicker}): ${yfErr.message}`);
    }

    // 3. Fallback: TradingView Scanner daily snapshot
    try {
      const tvRes = await axios.post(
        'https://scanner.tradingview.com/cfd/scan',
        {
          symbols: { tickers: [symConfig?.tradingViewTicker || `OANDA:${sym}`] },
          columns: ['name', 'close', 'high', 'low', 'open']
        },
        { timeout: 4500 }
      );

      if (tvRes.data?.data?.[0]?.d) {
        const [, closeVal, highVal, lowVal, openVal] = tvRes.data.data[0].d;
        if (highVal && lowVal && closeVal) {
          const high = parseFloat(parseFloat(highVal).toFixed(symConfig?.priceDecimals || 2));
          const low = parseFloat(parseFloat(lowVal).toFixed(symConfig?.priceDecimals || 2));
          const close = parseFloat(parseFloat(closeVal).toFixed(symConfig?.priceDecimals || 2));
          const open = openVal ? parseFloat(parseFloat(openVal).toFixed(symConfig?.priceDecimals || 2)) : close;
          const todayStr = new Date().toISOString().split('T')[0];

          logger.info(`✅ TradingView Scanner OHLC for ${sym}: High=${high}, Low=${low}, Close=${close}`);
          return {
            high,
            low,
            close,
            open,
            periodStart: new Date(),
            periodEnd: new Date(),
            periodDateStr: todayStr,
            dataSource: 'TradingView Scanner Real-Time'
          };
        }
      }
    } catch (tvErr) {
      logger.warn(`TradingView scanner OHLC fallback failed for ${sym}: ${tvErr.message}`);
    }

    throw new Error(`Unable to fetch valid historical completed OHLC data for '${sym}'.`);
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
      // TRADITIONAL / CLASSIC (Standard Floor Pivot Methodology)
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
    if (state.close > state.high * 1.02 || state.close < state.low * 0.98) {
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
      // Next Sunday 22:00 UTC (Forex session open)
      const nextSunday = new Date(now);
      const day = now.getUTCDay();
      const diff = (7 - day) % 7 || 7;
      nextSunday.setUTCDate(now.getUTCDate() + diff);
      nextSunday.setUTCHours(22, 0, 0, 0);
      return nextSunday;
    }

    if (timeframe === 'MONTHLY') {
      // 1st of next month 00:00 UTC
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
    }

    // Daily rollover: parse sessionCloseUtc (e.g. "22:00" for Forex, "10:00" for NSE, "00:00" for Crypto)
    const [closeHour, closeMin] = (symConfig?.sessionCloseUtc || '22:00').split(':').map(Number);
    const rollover = new Date();
    rollover.setUTCHours(closeHour, closeMin, 0, 0);

    if (now.getTime() >= rollover.getTime()) {
      // Rollover today has already passed, schedule for tomorrow
      rollover.setUTCDate(rollover.getUTCDate() + 1);
    }

    return rollover;
  }

  /**
   * Returns current active pivot period string based on session close time (e.g. '2026-08-20')
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

    // Daily: check if current UTC time has crossed today's sessionCloseUtc
    const [closeHour, closeMin] = (symConfig?.sessionCloseUtc || '22:00').split(':').map(Number);
    const sessionCloseToday = new Date(now);
    sessionCloseToday.setUTCHours(closeHour, closeMin, 0, 0);

    const sessionDate = new Date(now);
    if (now.getTime() >= sessionCloseToday.getTime()) {
      // Session has rolled over into next trading calendar period
      sessionDate.setUTCDate(sessionDate.getUTCDate() + 1);
    }
    return sessionDate.toISOString().split('T')[0];
  }

  /**
   * Primary method: Retrieves or recalculates pivots for given symbol & settings
   */
  async getOrCalculatePivotsForSymbol(symbolStr, options = {}) {
    const sym = (symbolStr || symbolService.getActiveSymbol()).toUpperCase();
    const symConfig = symbolService.getSymbol(sym) || symbolService.getActiveSymbolConfig();
    
    const pivotType = (options.pivotType || 'TRADITIONAL').toUpperCase();
    const pivotTimeframe = (options.pivotTimeframe || 'DAILY').toUpperCase();
    const currentPeriod = this.getCurrentPivotPeriod(sym, pivotTimeframe);

    // 1. Check existing in-memory or DB active state if not forced
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
      // 2. Fetch completed OHLC for previous closed period
      const ohlc = await this.fetchPreviousCompletedOHLC(sym, pivotTimeframe);

      // 3. Compute levels
      const calc = this.calculatePivotsFromOHLC({
        high: ohlc.high,
        low: ohlc.low,
        close: ohlc.close,
        open: ohlc.open,
        pivotType,
        priceDecimals: symConfig?.priceDecimals || 2
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

          await PivotState.findOneAndUpdate(
            { symbol: sym, pivotType, pivotTimeframe, pivotPeriod: currentPeriod },
            { $set: stateObj },
            { upsert: true, new: true }
          );
        } catch (dbErr) {
          logger.warn(`Could not persist PivotState in MongoDB: ${dbErr.message}`);
        }
      }

      // 8. Store in memory
      this.pivotStates.set(sym, stateObj);

      // 9. Structured Diagnostic Rollover Log
      const isPeriodChange = existingState && existingState.pivotPeriod !== currentPeriod;
      logger.info(`=======================================================`);
      logger.info(`  [PIVOT ${isPeriodChange ? 'ROLLOVER' : 'CALCULATION'}]`);
      logger.info(`  Symbol:        ${sym} (${symConfig?.displayName || sym})`);
      logger.info(`  Old Period:    ${existingState?.pivotPeriod || 'INITIAL'}`);
      logger.info(`  New Period:    ${currentPeriod} (${pivotTimeframe})`);
      logger.info(`  Previous OHLC: H=${calc.high} | L=${calc.low} | C=${calc.close}`);
      if (existingState) {
        logger.info(`  OLD LEVELS:    R3=${existingState.r3} | R2=${existingState.r2} | S2=${existingState.s2} | S3=${existingState.s3}`);
      }
      logger.info(`  NEW LEVELS:    R3=${calc.r3} | R2=${calc.r2} | P=${calc.p} | S2=${calc.s2} | S3=${calc.s3}`);
      logger.info(`  Status:        ACTIVE (Validated 100%)`);
      logger.info(`  Frontend:      SYNCED`);
      logger.info(`  Alert Engine:  RESTARTED`);
      logger.info(`=======================================================`);

      // 10. Notify Alert Engine & Broadcast over Socket.IO
      this.emit('pivot:updated', { symbol: sym, state: stateObj });
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
        logger.info(`⏰ Automated session boundary trigger for ${sym}: Period shifting ${state.pivotPeriod} -> ${currentExpectedPeriod}. Re-calculating finalized OHLC...`);
        await this.getOrCalculatePivotsForSymbol(sym, {
          pivotType: state.pivotType,
          pivotTimeframe: state.pivotTimeframe,
          force: true
        });
      }
    }
  }

  broadcastPivotState(specificState) {
    if (!this.io) return;
    const activeSym = symbolService.getActiveSymbol();
    const pivotState = specificState || this.getActivePivotState();
    if (!pivotState) return;

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
      previousPeriod: {
        high: pivotState.high,
        low: pivotState.low,
        close: pivotState.close
      },
      previousPivotState: pivotState.previousLevels,
      calculatedAt: pivotState.calculatedAt,
      nextRolloverAt: pivotState.nextRolloverAt,
      status: 'ACTIVE'
    };

    // Primary requested event
    this.io.emit('pivotUpdated', payload);

    // Legacy fallbacks
    this.io.emit('pivot:state', pivotState);
    this.io.emit('config:update', this.getConfig(pivotState.symbol));
  }
}

export const pivotService = new PivotService();
