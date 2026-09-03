import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MarketEvent } from '../models/MarketEvent.js';
import { alertService } from '../services/alertService.js';
import { screenshotService } from '../services/screenshotService.js';
import { cloudinaryService } from '../services/cloudinaryService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.join(__dirname, '../public/screenshots');

export const getAlertHistory = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const page = parseInt(req.query.page || '1', 10);
    const filter = {};

    if (req.query.level) filter.level = req.query.level;
    if (req.query.isTest !== undefined) filter.isTest = req.query.isTest === 'true';

    const total = await MarketEvent.countDocuments(filter);
    const events = await MarketEvent.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: events
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getAlertById = async (req, res) => {
  try {
    const event = await MarketEvent.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, error: 'Alert event not found' });
    res.json({ success: true, data: event });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteAlert = async (req, res) => {
  try {
    const { id } = req.params;
    let event = null;

    if (id && id.length === 24) {
      event = await MarketEvent.findById(id);
    }

    if (event) {
      // Delete Cloudinary / physical screenshot file if it exists
      if (event.screenshotPath) {
        if (event.screenshotPath.startsWith('http')) {
          await cloudinaryService.deleteScreenshot(event.screenshotPath);
        }
        const filename = path.basename(event.screenshotPath);
        const fullPath = path.join(SCREENSHOTS_DIR, filename);
        if (fs.existsSync(fullPath)) {
          try { fs.unlinkSync(fullPath); } catch (e) {}
        }
      }
      await MarketEvent.findByIdAndDelete(id);
    }

    res.json({ success: true, message: 'Screenshot alert deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getAlertStates = (req, res) => {
  try {
    const { symbol } = req.query;
    const states = alertService.getAllLevelStates(symbol);
    res.json({ success: true, data: states });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getCustomPriceAlert = (req, res) => {
  try {
    const { symbol } = req.query;
    const custom = alertService.getCustomAlert(symbol);
    res.json({ success: true, data: custom });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const setCustomPriceAlert = async (req, res) => {
  try {
    const { symbol, targetPrice, price, enabled } = req.body || {};
    const priceVal = targetPrice !== undefined ? targetPrice : price;
    const isEnabled = enabled !== undefined ? enabled : true;

    const result = await alertService.setCustomAlert(symbol, priceVal, isEnabled);
    res.json({ success: true, message: 'Custom price alert set successfully.', data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

export const deleteCustomPriceAlert = async (req, res) => {
  try {
    const symbol = req.params.symbol || req.query.symbol || req.body?.symbol;
    const result = await alertService.deleteCustomAlert(symbol);
    res.json({ success: true, message: 'Custom price alert deleted successfully.', data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const triggerCustomTestAlert = async (req, res) => {
  try {
    const { symbol, targetPrice, price } = req.body || {};
    const priceVal = targetPrice !== undefined ? targetPrice : price;
    const event = await alertService.triggerTestAlert('CUSTOM', priceVal);
    res.json({ success: true, message: 'Custom test alert triggered.', data: event });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const resetAlertLevel = (req, res) => {
  try {
    const { symbol } = req.body || {};
    const ok = alertService.resetLevelState(symbol, 'CUSTOM');
    res.json({ success: ok, message: 'Custom alert state reset to READY.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getScreenshotEngineStatus = (req, res) => {
  try {
    const status = screenshotService.stats || {};
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const triggerScreenshotCleanup = (req, res) => {
  try {
    screenshotService.cleanupOldScreenshots();
    res.json({ success: true, message: 'Manual screenshot cleanup completed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
