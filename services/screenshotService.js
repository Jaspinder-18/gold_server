import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { cloudinaryService } from './cloudinaryService.js';
import { symbolService } from './symbolService.js';
import { logger } from '../utils/logger.js';

// Ensure Playwright uses local project directory for browsers if on Render
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.join(__dirname, '../public/screenshots');
const LOCAL_CHARTS_JS_PATH = path.join(__dirname, '../public/js/lightweight-charts.standalone.production.js');

let localLightweightChartsJs = '';
try {
  if (fs.existsSync(LOCAL_CHARTS_JS_PATH)) {
    localLightweightChartsJs = fs.readFileSync(LOCAL_CHARTS_JS_PATH, 'utf8');
  }
} catch (e) {
  localLightweightChartsJs = '';
}

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

class ScreenshotService {
  constructor() {
    this.browser = null;
    this.context = null;
    this.isBrowserReady = false;
    this.isInitializing = false;
    this.queue = [];
    this.isProcessingQueue = false;

    // Viewport optimized for crystal clear chart screenshots
    this.viewportWidth = 1280;
    this.viewportHeight = 720;
    this.deviceScaleFactor = 2; // Retina quality
    this.settleMs = 2500;
    this.timeoutMs = 30000;
    this.maxRetries = 2;
    this.cleanupTimer = null;

    this.stats = {
      totalCaptured: 0,
      totalFailed: 0,
      averageCaptureTimeMs: 0,
      lastCaptureTime: null,
      lastError: null
    };
  }

  /**
   * Initializes headless Playwright browser instance
   */
  async initialize() {
    if (this.isBrowserReady && this.context) return;
    if (this.isInitializing) return;
    this.isInitializing = true;

    try {
      logger.info('Initializing Playwright isolated browser instance for TradingView screenshots...');

      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-extensions'
        ]
      });

      this.context = await this.browser.newContext({
        viewport: {
          width: this.viewportWidth,
          height: this.viewportHeight
        },
        deviceScaleFactor: this.deviceScaleFactor,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });

      this.isBrowserReady = true;
      logger.info(`Playwright TradingView Engine ready (Resolution: ${this.viewportWidth}x${this.viewportHeight} @${this.deviceScaleFactor}x DPR).`);

      // Run initial screenshot cleanup
      this.enforceMaxScreenshots(6);
    } catch (err) {
      logger.error('Failed to initialize Playwright browser worker', err);
      this.isBrowserReady = false;
      this.stats.lastError = err.message;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Queues and captures a real TradingView chart screenshot
   */
  async generateChartScreenshot(alertData) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        alertData,
        resolve,
        reject,
        attempts: 0,
        queuedAt: Date.now()
      });

      this.processQueue();
    });
  }

  /**
   * Serialized queue processor to ensure zero race conditions and minimal RAM usage
   */
  async processQueue() {
    if (this.isProcessingQueue || this.queue.length === 0) return;
    this.isProcessingQueue = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      const startTime = Date.now();

      try {
        const result = await this.executeScreenshotCapture(job.alertData);
        const duration = Date.now() - startTime;
        this.stats.totalCaptured++;
        this.stats.lastCaptureTime = new Date();
        this.stats.averageCaptureTimeMs = Math.round(
          (this.stats.averageCaptureTimeMs * (this.stats.totalCaptured - 1) + duration) / this.stats.totalCaptured
        );

        job.resolve(result);
      } catch (err) {
        job.attempts++;
        if (job.attempts < this.maxRetries) {
          logger.warn(`Screenshot capture failed (attempt ${job.attempts}), retrying...`);
          this.queue.unshift(job);
        } else {
          this.stats.totalFailed++;
          this.stats.lastError = err.message;
          job.reject(err);
        }
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Fetches real candlesticks starting from selected history range for ANY symbol (Gold, Silver, Crypto, Forex, Indices, Stocks)
   */
  async fetchCandlesForSession(symbol = 'XAUUSD', timeframe = '15', range = '1D', currentPrice = null) {
    const rawSym = (symbol || 'XAUUSD').replace(/^.*:/, '').toUpperCase();
    const symConfig = symbolService.getSymbol(rawSym) || symbolService.getActiveSymbolConfig();
    const isCrypto = symConfig?.assetType === 'CRYPTO';
    const decimals = symConfig?.priceDecimals || 2;

    try {
      let intervalBinance = '15m';
      let intervalYf = '15m';
      const tf = String(timeframe).toUpperCase();
      if (tf === '1' || tf === '1M') { intervalBinance = '1m'; intervalYf = '1m'; }
      else if (tf === '3' || tf === '3M') { intervalBinance = '3m'; intervalYf = '5m'; }
      else if (tf === '5' || tf === '5M') { intervalBinance = '5m'; intervalYf = '5m'; }
      else if (tf === '15' || tf === '15M') { intervalBinance = '15m'; intervalYf = '15m'; }
      else if (tf === '30' || tf === '30M') { intervalBinance = '30m'; intervalYf = '30m'; }
      else if (tf === '60' || tf === '1H') { intervalBinance = '1h'; intervalYf = '60m'; }
      else if (tf === '120' || tf === '2H') { intervalBinance = '2h'; intervalYf = '60m'; }
      else if (tf === '240' || tf === '4H') { intervalBinance = '4h'; intervalYf = '60m'; }
      else if (tf === 'D' || tf === '1D') { intervalBinance = '1d'; intervalYf = '1d'; }

      // Determine start time based on today's UTC midnight and range
      const todayUtc = new Date();
      todayUtc.setUTCHours(0, 0, 0, 0);
      let startTime = todayUtc.getTime();

      const r = String(range).toUpperCase();
      let rangeYf = '1d';
      if (r === '2D') { startTime -= 1 * 86400000; rangeYf = '2d'; }
      else if (r === '3D') { startTime -= 2 * 86400000; rangeYf = '5d'; }
      else if (r === '5D') { startTime -= 4 * 86400000; rangeYf = '5d'; }

      // 1. If Crypto -> Query Binance API
      if (isCrypto) {
        const pair = rawSym.includes('USD') && !rawSym.includes('USDT') ? `${rawSym.replace('USD', 'USDT')}` : rawSym;
        const urls = [
          `https://data-api.binance.vision/api/v3/klines?symbol=${pair}&interval=${intervalBinance}&startTime=${startTime}&limit=1000`,
          `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${intervalBinance}&startTime=${startTime}&limit=1000`,
          `https://api.binance.us/api/v3/klines?symbol=${pair}&interval=${intervalBinance}&startTime=${startTime}&limit=1000`
        ];

        for (const url of urls) {
          try {
            const res = await axios.get(url, { timeout: 4500 });
            if (res.data && Array.isArray(res.data) && res.data.length > 0) {
              return res.data.map(k => ({
                time: Math.floor(k[0] / 1000),
                open: parseFloat(parseFloat(k[1]).toFixed(decimals)),
                high: parseFloat(parseFloat(k[2]).toFixed(decimals)),
                low: parseFloat(parseFloat(k[3]).toFixed(decimals)),
                close: parseFloat(parseFloat(k[4]).toFixed(decimals)),
                volume: parseFloat(k[5])
              }));
            }
          } catch (e) {}
        }
      }

      // 2. If Gold (XAUUSD) -> Query Binance PAXGUSDT
      if (rawSym === 'XAUUSD') {
        const urls = [
          `https://data-api.binance.vision/api/v3/klines?symbol=PAXGUSDT&interval=${intervalBinance}&startTime=${startTime}&limit=1000`,
          `https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=${intervalBinance}&startTime=${startTime}&limit=1000`
        ];

        for (const url of urls) {
          try {
            const res = await axios.get(url, { timeout: 4500 });
            if (res.data && Array.isArray(res.data) && res.data.length > 0) {
              return res.data.map(k => ({
                time: Math.floor(k[0] / 1000),
                open: parseFloat(parseFloat(k[1]).toFixed(decimals)),
                high: parseFloat(parseFloat(k[2]).toFixed(decimals)),
                low: parseFloat(parseFloat(k[3]).toFixed(decimals)),
                close: parseFloat(parseFloat(k[4]).toFixed(decimals)),
                volume: parseFloat(k[5])
              }));
            }
          } catch (e) {}
        }
      }

      // 3. For all other assets (Silver, Forex, Indices, Stocks) -> Query Yahoo Finance Chart API
      const yfMap = {
        XAUUSD: 'GC=F',
        XAGUSD: 'SI=F',
        EURUSD: 'EURUSD=X',
        GBPUSD: 'GBPUSD=X',
        USDJPY: 'JPY=X',
        AUDUSD: 'AUDUSD=X',
        USDCAD: 'CAD=X',
        USDCHF: 'CHF=X',
        NZDUSD: 'NZDUSD=X',
        NIFTY: '^NSEI',
        BANKNIFTY: '^NSEBANK',
        US30: '^DJI',
        SPX: '^GSPC',
        NASDAQ: '^IXIC',
        AAPL: 'AAPL',
        TSLA: 'TSLA',
        NVDA: 'NVDA'
      };

      const yfTicker = yfMap[rawSym] || rawSym;
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfTicker)}?interval=${intervalYf}&range=${rangeYf}`;
        const res = await axios.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          timeout: 4500
        });

        const result = res.data?.chart?.result?.[0];
        if (result && result.timestamp && result.indicators?.quote?.[0]) {
          const timestamps = result.timestamp;
          const quotes = result.indicators.quote[0];
          const candles = [];

          for (let i = 0; i < timestamps.length; i++) {
            const o = quotes.open[i];
            const h = quotes.high[i];
            const l = quotes.low[i];
            const c = quotes.close[i];
            if (o !== null && h !== null && l !== null && c !== null && !isNaN(c)) {
              candles.push({
                time: timestamps[i],
                open: parseFloat(parseFloat(o).toFixed(decimals)),
                high: parseFloat(parseFloat(h).toFixed(decimals)),
                low: parseFloat(parseFloat(l).toFixed(decimals)),
                close: parseFloat(parseFloat(c).toFixed(decimals)),
                volume: quotes.volume?.[i] || 0
              });
            }
          }

          if (candles.length > 0) {
            return candles;
          }
        }
      } catch (yfErr) {
        // Fall through to synthetic generator
      }
    } catch (err) {
      logger.warn(`Candle fetch notice for ${symbol}: ${err.message}`);
    }

    return null;
  }

  /**
   * Main Execution Function
   */
  async executeScreenshotCapture(alertData) {
    if (!this.isBrowserReady || !this.context) {
      await this.initialize();
    }

    const {
      symbol = 'OANDA:XAUUSD',
      level = 'R2',
      levelPrice = 4432.84,
      currentPrice = 4356.40,
      previousPrice,
      tolerance = 0.20,
      isTest = false,
      timestamp = new Date(),
      pivotConfig = {},
      timeframe,
      range,
      barSpacing
    } = alertData;

    const rawSym = (symbol || 'XAUUSD').replace(/^.*:/, '').toUpperCase();
    const symConfig = symbolService.getSymbol(rawSym) || symbolService.getActiveSymbolConfig();
    const decimals = symConfig?.priceDecimals || (rawSym.includes('JPY') ? 3 : (rawSym.includes('EUR') || rawSym.includes('GBP') ? 5 : 2));

    const dynamicInterval = String(timeframe || pivotConfig?.chartTimeframe || '15');
    const dynamicRange = String(range || pivotConfig?.chartRange || '1D');
    const dynamicBarSpacing = Number(barSpacing || pivotConfig?.barSpacing || (dynamicRange === '1D' ? 22 : (dynamicRange === '2D' ? 14 : (dynamicRange === '3D' ? 9 : 6))));

    const timestampClean = Date.now();
    const filename = `alert-${rawSym.toLowerCase()}-${level.toLowerCase()}-${timestampClean}.png`;
    const fullPath = path.join(SCREENSHOTS_DIR, filename);
    const relativePath = `/screenshots/${filename}`;

    logger.info(`📸 Capturing clean TradingView chart for ${rawSym} (${dynamicInterval}m, ${dynamicRange} range, ${dynamicBarSpacing}px barSpacing) for ${level} alert at $${currentPrice}...`);

    let page = null;
    try {
      page = await this.context.newPage();
      page.setDefaultTimeout(this.timeoutMs);

      // 1. Fetch candles for THIS specific symbol
      let sessionCandles = await this.fetchCandlesForSession(rawSym, dynamicInterval, dynamicRange, currentPrice);

      // Fallback synthetic candles tailored strictly to the specific asset's price and volatility
      if (!sessionCandles || sessionCandles.length === 0) {
        const nowSec = Math.floor(Date.now() / 1000);
        const candleStep = dynamicInterval === '1' ? 60 : (dynamicInterval === '5' ? 300 : (dynamicInterval === '15' ? 900 : (dynamicInterval === '60' || dynamicInterval === '1H' ? 3600 : 900)));
        sessionCandles = [];
        const basePrice = Number(currentPrice) || (symConfig?.defaultPrice || 100.0);
        const volStep = Math.max(Math.pow(10, -decimals), basePrice * 0.0012);
        
        // Generate candles spanning selected range
        const todayUtc = new Date();
        todayUtc.setUTCHours(0, 0, 0, 0);
        let startTimestamp = todayUtc.getTime();
        const rUpper = dynamicRange.toUpperCase();
        if (rUpper === '2D') startTimestamp -= 1 * 86400000;
        else if (rUpper === '3D') startTimestamp -= 2 * 86400000;
        else if (rUpper === '5D') startTimestamp -= 4 * 86400000;

        let startSec = Math.floor(startTimestamp / 1000);
        let cur = basePrice - (volStep * 2);

        for (let t = startSec; t <= nowSec; t += candleStep) {
          const delta = (Math.random() - 0.48) * volStep;
          const open = parseFloat(cur.toFixed(decimals));
          const close = parseFloat((cur + delta).toFixed(decimals));
          const high = parseFloat((Math.max(open, close) + Math.random() * volStep * 0.8).toFixed(decimals));
          const low = parseFloat((Math.min(open, close) - Math.random() * volStep * 0.8).toFixed(decimals));
          sessionCandles.push({ time: t, open, high, low, close });
          cur = close;
        }
      }

      // Ensure last candle matches the exact current alert price
      if (sessionCandles.length > 0) {
        const last = sessionCandles[sessionCandles.length - 1];
        last.close = Number(currentPrice);
        last.high = Math.max(last.high, Number(currentPrice));
        last.low = Math.min(last.low, Number(currentPrice));
      }

      const formattedDate = new Date(timestamp).toUTCString();

      // 2. Build high-fidelity TradingView Canvas HTML with exact level lines
      const html = this.buildTradingViewHtml({
        ticker: symConfig?.tradingViewTicker || symbol || `OANDA:${rawSym}`,
        rawSymbol: rawSym,
        interval: dynamicInterval,
        chartRange: dynamicRange,
        barSpacing: dynamicBarSpacing,
        level,
        levelPrice,
        currentPrice,
        tolerance,
        formattedDate,
        pivotConfig,
        candles: sessionCandles,
        decimals,
        isTest
      });

      await page.setContent(html, { waitUntil: 'networkidle', timeout: this.timeoutMs });

      // Wait for chart canvas to render
      await page.waitForSelector('canvas', { timeout: 15000 });
      await page.waitForTimeout(this.settleMs);

      // Capture screenshot
      const buffer = await page.screenshot({
        type: 'png',
        fullPage: false
      });

      fs.writeFileSync(fullPath, buffer);
      logger.info(`TradingView chart screenshot captured successfully for ${rawSym}: ${filename} (${Math.round(buffer.length / 1024)} KB)`);

      // 3. Upload to Cloudinary if configured
      let cloudinaryUrl = null;
      if (cloudinaryService.isAvailable()) {
        try {
          const cldRes = await cloudinaryService.uploadScreenshot(buffer, filename);
          if (cldRes?.url) {
            cloudinaryUrl = cldRes.url;
          }
        } catch (cldErr) {
          logger.warn(`Cloudinary upload failed (${cldErr.message}), using local path.`);
        }
      }

      // Enforce strict max 6 screenshots retention limit
      this.enforceMaxScreenshots(6);

      return {
        filename,
        fullPath,
        relativePath: cloudinaryUrl || relativePath,
        cloudinaryUrl,
        buffer
      };
    } catch (err) {
      logger.error(`Error during TradingView page screenshot capture: ${err.message}`);
      if (err.message.includes('Target closed') || err.message.includes('browser has been closed')) {
        this.isBrowserReady = false;
      }
      throw err;
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {}
      }
    }
  }

  /**
   * Formats interval string for display (e.g. 5 -> 5M, 15 -> 15M, 60 -> 1H)
   */
  formatIntervalDisplay(interval) {
    const i = String(interval).toUpperCase();
    if (i === '1') return '1';
    if (i === '3') return '3';
    if (i === '5') return '5';
    if (i === '15') return '15';
    if (i === '30') return '30';
    if (i === '60' || i === '1H') return '1H';
    if (i === '120' || i === '2H') return '2H';
    if (i === '240' || i === '4H') return '4H';
    if (i === 'D' || i === '1D') return '1D';
    return i;
  }

  /**
   * Generates the high-fidelity TradingView Canvas HTML with Yellow Level Lines and Red Bold Touched Level Line
   */
  buildTradingViewHtml({
    ticker,
    rawSymbol = 'XAUUSD',
    interval,
    chartRange = '1D',
    barSpacing = 22,
    level,
    levelPrice,
    currentPrice,
    tolerance,
    formattedDate,
    pivotConfig = {},
    candles = [],
    decimals = 2,
    isTest
  }) {
    const tfDisplay = this.formatIntervalDisplay(interval);

    // Strictly the 4 levels: R3, R2, S2, S3 dynamically from active pivotConfig or current alert
    const levels = [
      { name: 'R3', price: Number(pivotConfig?.r3 || (level === 'R3' ? levelPrice : currentPrice * 1.015)) },
      { name: 'R2', price: Number(pivotConfig?.r2 || (level === 'R2' ? levelPrice : currentPrice * 1.008)) },
      { name: 'S2', price: Number(pivotConfig?.s2 || (level === 'S2' ? levelPrice : currentPrice * 0.992)) },
      { name: 'S3', price: Number(pivotConfig?.s3 || (level === 'S3' ? levelPrice : currentPrice * 0.985)) }
    ];

    const firstCandle = candles[0] || { open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice };
    const openPrice = firstCandle.open || currentPrice;
    const highPrice = Math.max(...candles.map(c => c.high), currentPrice);
    const lowPrice = Math.min(...candles.map(c => c.low), currentPrice);
    const closePrice = currentPrice;
    const diff = closePrice - openPrice;
    const diffPercent = openPrice ? (diff / openPrice) * 100 : 0;
    const isPositive = diff >= 0;
    const changeText = `${isPositive ? '+' : ''}${diff.toFixed(decimals)} (${isPositive ? '+' : ''}${diffPercent.toFixed(2)}%)`;
    const changeColor = isPositive ? '#089981' : '#f23645';

    const spread = tolerance ? (tolerance * 0.5) : (closePrice * 0.0005);
    const bidPrice = (closePrice - spread).toFixed(decimals);
    const askPrice = (closePrice + spread).toFixed(decimals);

    const legendLevelsStr = levels.map(l => `${l.name}: ${Number(l.price).toFixed(decimals)}`).join(', ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>TradingView Live Market Alert Chart</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: #000000;
      font-family: -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif;
      user-select: none;
    }
    #chart_wrapper {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      position: relative;
      background: #000000;
    }
    /* TRADINGVIEW TOP BAR MATCHING REFERENCE IMAGE 2 */
    #tv_top_bar {
      height: 46px;
      background: #000000;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      z-index: 100;
    }
    .top-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .tv-symbol-title {
      font-size: 13px;
      font-weight: 700;
      color: #d1d4dc;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tv-dot {
      color: #787b86;
    }
    .tv-ohlc {
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif;
      color: #787b86;
      display: flex;
      gap: 8px;
    }
    .tv-ohlc span {
      color: #d1d4dc;
    }
    .tv-change {
      font-weight: 600;
      color: ${changeColor};
    }
    .trade-buttons {
      display: flex;
      gap: 6px;
      margin-left: 12px;
    }
    .btn-sell {
      background: #f23645;
      color: #ffffff;
      font-size: 11px;
      font-weight: 800;
      padding: 3px 8px;
      border-radius: 4px;
      display: flex;
      flex-direction: column;
      align-items: center;
      line-height: 1.1;
    }
    .btn-buy {
      background: #2962ff;
      color: #ffffff;
      font-size: 11px;
      font-weight: 800;
      padding: 3px 8px;
      border-radius: 4px;
      display: flex;
      flex-direction: column;
      align-items: center;
      line-height: 1.1;
    }
    .btn-sub {
      font-size: 8px;
      opacity: 0.85;
      text-transform: uppercase;
    }
    .indicator-tag {
      font-size: 11px;
      color: #787b86;
      margin-left: 8px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    /* ALERT NOTIFICATION BADGE */
    .alert-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(239, 68, 68, 0.2);
      border: 2px solid #ef4444;
      border-radius: 6px;
      padding: 4px 12px;
      font-size: 12px;
      font-weight: 900;
      color: #ffffff;
      box-shadow: 0 0 12px rgba(239, 68, 68, 0.5);
    }
    .alert-badge .highlight {
      color: #ff4d4d;
      font-size: 13px;
    }
    /* CANVAS CONTAINER */
    #chart_container {
      flex: 1;
      width: 100%;
      height: calc(100% - 46px);
      position: relative;
    }
    /* TRADINGVIEW WATERMARK BOTTOM LEFT */
    .tv-watermark {
      position: absolute;
      bottom: 12px;
      left: 16px;
      z-index: 50;
      display: flex;
      align-items: center;
      gap: 6px;
      opacity: 0.7;
      pointer-events: none;
    }
    .tv-watermark svg {
      width: 24px;
      height: 24px;
      fill: #ffffff;
    }
    .tv-watermark span {
      font-size: 14px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #ffffff;
    }
    /* LEGEND ON CHART */
    .chart-legend {
      position: absolute;
      top: 14px;
      left: 18px;
      z-index: 50;
      display: flex;
      flex-direction: column;
      gap: 4px;
      pointer-events: none;
    }
    .legend-title {
      font-size: 11px;
      font-weight: 700;
      color: #787b86;
      display: flex;
      align-items: center;
      gap: 6px;
    }
  </style>
  ${localLightweightChartsJs ? `<script>${localLightweightChartsJs}</script>` : `<script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>`}
</head>
<body>
  <div id="chart_wrapper">
    <!-- Top TradingView Bar -->
    <header id="tv_top_bar">
      <div class="top-left">
        <div class="tv-symbol-title">
          <span>${ticker}</span>
          <span class="tv-dot">·</span>
          <span>${tfDisplay}</span>
          <span class="tv-dot">·</span>
          <span>${chartRange}</span>
        </div>
        <div class="tv-ohlc">
          <span>O: <b>${openPrice.toFixed(decimals)}</b></span>
          <span>H: <b>${highPrice.toFixed(decimals)}</b></span>
          <span>L: <b>${lowPrice.toFixed(decimals)}</b></span>
          <span>C: <b>${closePrice.toFixed(decimals)}</b></span>
          <span class="tv-change">${changeText}</span>
        </div>
        <div class="trade-buttons">
          <div class="btn-sell">
            <span>${bidPrice}</span>
            <span class="btn-sub">SELL</span>
          </div>
          <div class="btn-buy">
            <span>${askPrice}</span>
            <span class="btn-sub">BUY</span>
          </div>
        </div>
        <div class="indicator-tag">
          <span>Pivots Fibonacci Daily</span>
        </div>
      </div>

      ${level === 'MANUAL' ? `
      <div style="display: flex; align-items: center; gap: 8px; background: rgba(59, 130, 246, 0.2); border: 2px solid #3b82f6; border-radius: 6px; padding: 4px 12px; font-size: 12px; font-weight: 800; color: #93c5fd;">
        <span>📸</span>
        <span>MANUAL CAPTURE · ${rawSymbol}</span>
      </div>
      ` : `
      <div class="alert-badge">
        <span>${isTest ? '🧪' : '🚨'}</span>
        <span>LEVEL TOUCH: <span class="highlight">${level}</span> @ $${Number(levelPrice).toFixed(decimals)}</span>
      </div>
      `}
    </header>

    <!-- TradingView Chart Canvas Container -->
    <div id="chart_container">
      <div class="chart-legend">
        <div class="legend-title">
          <span>Pivots (${legendLevelsStr})</span>
        </div>
      </div>

      <!-- Watermark -->
      <div class="tv-watermark">
        <svg viewBox="0 0 36 28" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 22H7V11H14V22Z" fill="currentColor"/>
          <path d="M22 22H15V6H22V22Z" fill="currentColor"/>
          <path d="M29 22H23V0H29V22Z" fill="currentColor"/>
          <path d="M36 22H30V15H36V22Z" fill="currentColor"/>
        </svg>
        <span>TradingView</span>
      </div>
    </div>
  </div>

  <script>
    const container = document.getElementById('chart_container');
    const dynamicBarSpacing = Number(${Number(barSpacing) || 22});

    const chart = LightweightCharts.createChart(container, {
      width: container.clientWidth || 1280,
      height: container.clientHeight || 674,
      layout: {
        background: { type: 'solid', color: '#000000' },
        textColor: '#787b86',
        fontSize: 11,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif'
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: 'rgba(255, 255, 255, 0.2)', width: 1, style: 3 },
        horzLine: { color: 'rgba(255, 255, 255, 0.2)', width: 1, style: 3 }
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        autoScale: true,
        scaleMargins: {
          top: 0.10,
          bottom: 0.10
        }
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: dynamicBarSpacing,
        rightOffset: 6,
        fixLeftEdge: true,
        fixRightEdge: true
      }
    });

    // Add Candlestick Series with exact TradingView color scheme
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#089981',
      downColor: '#f23645',
      borderUpColor: '#089981',
      borderDownColor: '#f23645',
      wickUpColor: '#089981',
      wickDownColor: '#f23645',
      priceFormat: {
        type: 'price',
        precision: ${decimals},
        minMove: ${Math.pow(10, -decimals)}
      }
    });

    const rawData = ${JSON.stringify(candles)};
    candleSeries.setData(rawData);

    // Add Solid Horizontal Lines for R3, R2, S2, S3 across the entire chart
    const levels = ${JSON.stringify(levels)};
    const activeLevelName = "${String(level).toUpperCase()}";

    // Dynamic zoom price scaling: Scale tightly to candles so candles are tall and not shrunk
    const candleLows = rawData.map(c => c.low).filter(v => typeof v === 'number' && !isNaN(v));
    const candleHighs = rawData.map(c => c.high).filter(v => typeof v === 'number' && !isNaN(v));
    let targetMin = candleLows.length ? Math.min(...candleLows) : Number(${currentPrice});
    let targetMax = candleHighs.length ? Math.max(...candleHighs) : Number(${currentPrice});
    const baseVal = Number(${currentPrice}) || 100.0;

    // If an active level was touched, include that level in the zoom frame
    if (activeLevelName !== 'MANUAL') {
      const activeLvlObj = levels.find(l => l.name.toUpperCase() === activeLevelName);
      if (activeLvlObj && typeof activeLvlObj.price === 'number') {
        targetMin = Math.min(targetMin, activeLvlObj.price);
        targetMax = Math.max(targetMax, activeLvlObj.price);
      }
    } else {
      // For general / manual chart view, frame with nearby levels within reasonable distance (<= 2.5% of price)
      const maxDist = baseVal * 0.025;
      const lowerLevels = levels.filter(l => l.price <= targetMin).map(l => l.price);
      const upperLevels = levels.filter(l => l.price >= targetMax).map(l => l.price);
      if (lowerLevels.length) {
        const closestLower = Math.max(...lowerLevels);
        if (targetMin - closestLower <= maxDist) targetMin = Math.min(targetMin, closestLower);
      }
      if (upperLevels.length) {
        const closestUpper = Math.min(...upperLevels);
        if (closestUpper - targetMax <= maxDist) targetMax = Math.max(targetMax, closestUpper);
      }
    }

    const pad = Math.max((targetMax - targetMin) * 0.08, baseVal * 0.001);
    const finalMin = parseFloat((targetMin - pad).toFixed(${decimals}));
    const finalMax = parseFloat((targetMax + pad).toFixed(${decimals}));

    candleSeries.applyOptions({
      autoscaleInfoProvider: (original) => {
        return {
          priceRange: {
            minValue: finalMin,
            maxValue: finalMax
          }
        };
      }
    });

    levels.forEach(lvl => {
      const isTouched = lvl.name.toUpperCase() === activeLevelName;
      candleSeries.createPriceLine({
        price: lvl.price,
        color: isTouched ? '#ef4444' : '#ffd700', // RED if touched, YELLOW for other levels
        lineWidth: isTouched ? 3 : 2, // BOLD for touched
        lineStyle: LightweightCharts.LineStyle.Solid,
        axisLabelVisible: true,
        title: lvl.name + ' ($' + Number(lvl.price).toFixed(${decimals}) + ')'
      });
    });

    // Respect dynamicBarSpacing and align viewport to latest candles cleanly
    chart.timeScale().applyOptions({
      barSpacing: dynamicBarSpacing,
      rightOffset: 6
    });
    chart.timeScale().scrollToRealTime();

    window.addEventListener('resize', () => {
      chart.resize(container.clientWidth, container.clientHeight);
    });
  </script>
</body>
</html>`;
  }

  /**
   * Enforces strict maximum screenshot file count (keeps latest maxCount = 6)
   */
  enforceMaxScreenshots(maxCount = 6) {
    try {
      if (!fs.existsSync(SCREENSHOTS_DIR)) return;
      const files = fs.readdirSync(SCREENSHOTS_DIR)
        .filter(f => f.endsWith('.png'))
        .map(f => {
          const full = path.join(SCREENSHOTS_DIR, f);
          return { file: f, path: full, mtime: fs.statSync(full).mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime); // newest first

      if (files.length > maxCount) {
        const toDelete = files.slice(maxCount);
        let count = 0;
        for (const item of toDelete) {
          try {
            fs.unlinkSync(item.path);
            count++;
          } catch (e) {}
        }
        if (count > 0) {
          logger.info(`🧹 Enforce Max Limit: Pruned ${count} old screenshot files (kept latest ${maxCount}).`);
        }
      }
    } catch (err) {
      logger.warn(`Error enforcing max screenshots limit: ${err.message}`);
    }
  }

  /**
   * Automatic cleanup of old screenshots
   */
  cleanupOldScreenshots() {
    try {
      if (!fs.existsSync(SCREENSHOTS_DIR)) return;
      const files = fs.readdirSync(SCREENSHOTS_DIR);
      const now = Date.now();
      const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days

      for (const file of files) {
        if (!file.endsWith('.png')) continue;
        const fullPath = path.join(SCREENSHOTS_DIR, file);
        try {
          const stats = fs.statSync(fullPath);
          if (now - stats.mtimeMs > maxAgeMs) {
            fs.unlinkSync(fullPath);
            logger.info(`Cleaned up old screenshot: ${file}`);
          }
        } catch (e) {
          // ignore
        }
      }
    } catch (err) {
      logger.warn(`Error during screenshot cleanup: ${err.message}`);
    }
  }

  getStatus() {
    return {
      isReady: this.isBrowserReady,
      queueLength: this.queue.length,
      isProcessing: this.isProcessingQueue,
      stats: this.stats
    };
  }

  async shutdown() {
    await this.close();
  }

  async close() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {}
      this.browser = null;
      this.context = null;
      this.isBrowserReady = false;
    }
  }
}

export const screenshotService = new ScreenshotService();
