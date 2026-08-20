import { pivotService } from '../services/pivotService.js';
import { marketDataService } from '../services/marketDataService.js';

export const getConfig = async (req, res) => {
  try {
    const { symbol } = req.query;
    const config = pivotService.getConfig(symbol);
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateConfig = async (req, res) => {
  try {
    const { symbol, pivotType, pivotTimeframe } = req.body;
    const targetSymbol = symbol || pivotService.getConfig().symbol;
    
    // Recalculate with new options if requested
    const state = await pivotService.getOrCalculatePivotsForSymbol(targetSymbol, {
      pivotType: pivotType || req.body.pivotType,
      pivotTimeframe: pivotTimeframe || req.body.pivotTimeframe
    });

    const config = pivotService.getConfig(targetSymbol);
    res.json({ success: true, data: config, pivotState: state });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const calculatePivots = async (req, res) => {
  try {
    const { symbol, high, low, close, open, pivotType } = req.body;
    if (!high || !low || !close) {
      return res.status(400).json({ success: false, error: 'High, Low, and Close prices required' });
    }
    const targetSymbol = symbol || pivotService.getConfig().symbol;
    const calc = pivotService.calculatePivotsFromOHLC({ high, low, close, open, pivotType });
    res.json({ success: true, data: calc });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const autoCalculatePivots = async (req, res) => {
  try {
    const { symbol, pivotType, pivotTimeframe } = req.body;
    const targetSymbol = symbol || pivotService.getConfig().symbol;
    const updated = await pivotService.getOrCalculatePivotsForSymbol(targetSymbol, { pivotType, pivotTimeframe });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getPivotHistory = async (req, res) => {
  try {
    const { symbol } = req.query;
    const targetSymbol = (symbol || pivotService.getConfig().symbol).toUpperCase();
    const pivotState = pivotService.getPivotState(targetSymbol);
    res.json({ success: true, data: pivotState ? [pivotState] : [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
