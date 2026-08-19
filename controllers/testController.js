import { alertService } from '../services/alertService.js';
import { telegramService } from '../services/telegramService.js';
import { screenshotService } from '../services/screenshotService.js';
import { marketDataService } from '../services/marketDataService.js';
import { pivotService } from '../services/pivotService.js';
import { MarketEvent } from '../models/MarketEvent.js';
import { logger } from '../utils/logger.js';

export const triggerTestAlert = async (req, res) => {
  try {
    const { level = 'R2', price } = req.body;
    logger.info(`Processing Test Mode Alert Trigger for level ${level} @ price ${price || 'auto'}...`);

    const event = await alertService.triggerTestAlert(level, price);

    res.json({
      success: true,
      message: `Test alert for level ${level} executed successfully.`,
      data: event
    });
  } catch (err) {
    logger.error('Error executing test alert', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const captureLiveScreenshot = async (req, res) => {
  try {
    const { level = 'MANUAL', symbol, timeframe, range, barSpacing } = req.body;
    const config = pivotService.getConfig();
    const currentPrice = marketDataService.getCurrentPrice() || 4442.30;
    const dynamicTimeframe = String(timeframe || config.chartTimeframe || '15');
    const dynamicRange = String(range || config.chartRange || '1D');
    const dynamicBarSpacing = Number(barSpacing || config.barSpacing || 22);
    
    logger.info(`Capturing on-demand TradingView chart screenshot (${dynamicTimeframe}m, ${dynamicRange} range, ${dynamicBarSpacing}px barSpacing) for ${level}...`);
    const screenshotData = await screenshotService.generateChartScreenshot({
      symbol: symbol || process.env.TRADINGVIEW_TICKER || 'OANDA:XAUUSD',
      level,
      levelPrice: currentPrice,
      currentPrice,
      tolerance: config.tolerance || 0.20,
      timeframe: dynamicTimeframe,
      range: dynamicRange,
      barSpacing: dynamicBarSpacing,
      pivotConfig: config,
      timestamp: new Date(),
      isTest: true
    });

    const screenshotPath = screenshotData.cloudinaryUrl || screenshotData.relativePath;

    // Save manual capture to MongoDB so it persists across refreshes
    const event = await MarketEvent.create({
      symbol: symbol || 'XAUUSD',
      level: 'MANUAL',
      levelPrice: currentPrice,
      currentPrice,
      tolerance: config.tolerance || 0.20,
      screenshotPath,
      telegramStatus: 'MANUAL_CAPTURE',
      triggerReason: `Manual TradingView screenshot capture (${dynamicTimeframe}m, ${dynamicRange} range, ${dynamicBarSpacing}px barSpacing)`,
      timestamp: new Date(),
      isTest: true
    });

    // Enforce strict 6 history limit in MongoDB and disk
    await alertService.enforceMaxHistory(6);

    res.json({
      success: true,
      message: 'TradingView screenshot captured and saved successfully.',
      data: event
    });
  } catch (err) {
    logger.error('Error capturing manual chart screenshot', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const testTelegram = async (req, res) => {
  try {
    const { customMessage } = req.body;
    const msg = customMessage || `🧪 <b>GOLD SYSTEM TEST MESSAGE</b>\n\nTelegram Bot connection test successful!\nTimestamp: ${new Date().toISOString()}`;
    const result = await telegramService.sendMessage(msg);

    res.json({
      success: true,
      message: 'Telegram test message delivered.',
      result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
