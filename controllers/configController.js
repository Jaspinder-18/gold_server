import { pivotService } from '../services/pivotService.js';
import { marketDataService } from '../services/marketDataService.js';

export const getConfig = async (req, res) => {
  try {
    const config = pivotService.getConfig();
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateConfig = async (req, res) => {
  try {
    const updated = await pivotService.updateManualConfig(req.body);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const calculatePivots = async (req, res) => {
  try {
    const { high, low, close } = req.body;
    if (!high || !low || !close) {
      return res.status(400).json({ success: false, error: 'High, Low, and Close prices required' });
    }
    const updated = await pivotService.updateDailyPivots(high, low, close);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const autoCalculatePivots = async (req, res) => {
  try {
    const data = marketDataService.getCurrentData();
    const updated = await pivotService.autoRecalculateFromMarket(data);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getPivotHistory = async (req, res) => {
  try {
    const history = pivotService.getPreviousSessions();
    res.json({ success: true, data: history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
