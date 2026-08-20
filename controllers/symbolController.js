import { symbolService } from '../services/symbolService.js';
import { pivotService } from '../services/pivotService.js';
import { marketDataService } from '../services/marketDataService.js';

export const symbolController = {
  // Get all supported symbols or filtered by assetType
  getAllSymbols: async (req, res) => {
    try {
      const { assetType } = req.query;
      const symbols = symbolService.getAllSymbols(assetType);
      const active = symbolService.getActiveSymbolConfig();

      res.json({
        success: true,
        data: {
          symbols,
          activeSymbol: active.symbol,
          activeConfig: active
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // Search symbols
  searchSymbols: async (req, res) => {
    try {
      const { q = '', assetType = 'ALL' } = req.query;
      const results = symbolService.searchSymbols(q, assetType);
      res.json({ success: true, data: results });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // Get active symbol
  getActiveSymbol: async (req, res) => {
    try {
      const activeConfig = symbolService.getActiveSymbolConfig();
      const pivotState = pivotService.getActivePivotState();
      const market = marketDataService.getMarketData();

      res.json({
        success: true,
        data: {
          symbol: activeConfig.symbol,
          config: activeConfig,
          pivotState,
          market
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // Switch active symbol
  setActiveSymbol: async (req, res) => {
    try {
      const { symbol } = req.body;
      if (!symbol) {
        return res.status(400).json({ success: false, error: 'Symbol parameter is required.' });
      }

      const symConfig = await symbolService.setActiveSymbol(symbol);
      const pivotState = await pivotService.getOrCalculatePivotsForSymbol(symConfig.symbol);
      const market = marketDataService.getMarketData();

      res.json({
        success: true,
        data: {
          symbol: symConfig.symbol,
          config: symConfig,
          pivotState,
          market
        }
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  },

  // Validate pivot calculations
  validateSymbolPivot: async (req, res) => {
    try {
      const sym = (req.params.symbol || symbolService.getActiveSymbol()).toUpperCase();
      const validation = pivotService.validatePivot(sym);
      const pivotState = pivotService.getPivotState(sym);

      res.json({
        success: true,
        data: {
          symbol: sym,
          isValid: validation.isValid,
          errors: validation.errors,
          pivotState
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
};
