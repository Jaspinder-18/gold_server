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
    const { symbol, pivotType, pivotTimeframe, r3, r2, s2, s3, autoCalculatePivot } = req.body;
    const targetSymbol = (symbol || pivotService.getConfig().symbol).toUpperCase();
    
    let state;
    if (autoCalculatePivot !== false && (!r3 || !r2 || !s2 || !s3)) {
      // Recalculate with new options if requested
      state = await pivotService.getOrCalculatePivotsForSymbol(targetSymbol, {
        pivotType: pivotType || 'FIBONACCI',
        pivotTimeframe: pivotTimeframe || 'DAILY',
        force: true
      });
    } else if (r3 && r2 && s2 && s3) {
      // Manual custom level override
      const currentState = pivotService.getPivotState(targetSymbol) || {};
      state = {
        ...currentState,
        symbol: targetSymbol,
        pivotType: pivotType || 'FIBONACCI',
        pivotTimeframe: pivotTimeframe || 'DAILY',
        r3: parseFloat(r3),
        r2: parseFloat(r2),
        s2: parseFloat(s2),
        s3: parseFloat(s3),
        p: parseFloat(((parseFloat(r2) + parseFloat(s2)) / 2).toFixed(3)),
        status: 'ACTIVE',
        isValid: true,
        calculatedAt: new Date()
      };
      pivotService.pivotStates.set(targetSymbol, state);
      pivotService.broadcastPivotState(state);
    }

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
    const updated = await pivotService.getOrCalculatePivotsForSymbol(targetSymbol, { pivotType, pivotTimeframe, force: true });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getPivotHistory = async (req, res) => {
  try {
    const { symbol, count, timeframe, pivotType } = req.query;
    const targetSymbol = (symbol || pivotService.getConfig().symbol).toUpperCase();
    const limit = parseInt(count || '10', 10);
    const history = await pivotService.fetchCompletedOHLCHistory(targetSymbol, limit, timeframe || 'DAILY', pivotType || 'FIBONACCI');
    res.json({ success: true, data: history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
