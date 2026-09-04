import mongoose from 'mongoose';
import { pivotService } from '../services/pivotService.js';
import { symbolService } from '../services/symbolService.js';
import { marketDataService } from '../services/marketDataService.js';
import { alertService } from '../services/alertService.js';
import { AlertConfiguration } from '../models/AlertConfiguration.js';
import { logger } from '../utils/logger.js';

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
    const {
      symbol,
      pivotType,
      pivotTimeframe,
      r3,
      r2,
      s2,
      s3,
      autoCalculatePivot,
      autoCalcIntervalMinutes,
      chartRange,
      chartTimeframe,
      barSpacing,
      tolerance,
      retriggerDistance,
      telegramAlertsEnabled,
      customPriceAlertEnabled,
      customPriceAlertTarget,
      enabled,
      customChartUrl,
      tradingViewTicker
    } = req.body;

    const targetSymbol = (symbol || pivotService.getConfig().symbol).toUpperCase();
    
    // Update alertConfigs in pivotService map
    const existingCfg = pivotService.alertConfigs.get(targetSymbol) || {};
    const newAlertCfg = {
      ...existingCfg,
      ...(chartRange !== undefined && { chartRange: String(chartRange) }),
      ...(chartTimeframe !== undefined && { chartTimeframe: String(chartTimeframe) }),
      ...(barSpacing !== undefined && { barSpacing: Number(barSpacing) }),
      ...(tolerance !== undefined && { tolerance: parseFloat(tolerance) }),
      ...(retriggerDistance !== undefined && { retriggerDistance: parseFloat(retriggerDistance) }),
      ...(telegramAlertsEnabled !== undefined && { telegramAlertsEnabled: Boolean(telegramAlertsEnabled) }),
      ...(customPriceAlertEnabled !== undefined && { customPriceAlertEnabled: Boolean(customPriceAlertEnabled) }),
      ...(customPriceAlertTarget !== undefined && { customPriceAlertTarget: parseFloat(customPriceAlertTarget) }),
      ...(enabled !== undefined && { enabled: Boolean(enabled) }),
      ...(customChartUrl !== undefined && { customChartUrl: String(customChartUrl) }),
      ...(tradingViewTicker !== undefined && { tradingViewTicker: String(tradingViewTicker) }),
      ...(autoCalculatePivot !== undefined && { autoCalculatePivot: Boolean(autoCalculatePivot) }),
      ...(autoCalcIntervalMinutes !== undefined && { autoCalcIntervalMinutes: Number(autoCalcIntervalMinutes) }),
      ...(pivotType !== undefined && { pivotType: String(pivotType) }),
      ...(pivotTimeframe !== undefined && { pivotTimeframe: String(pivotTimeframe) })
    };
    pivotService.alertConfigs.set(targetSymbol, newAlertCfg);

    // Sync custom price alert in alertService memory
    if (customPriceAlertTarget !== undefined || customPriceAlertEnabled !== undefined) {
      alertService.syncCustomAlertFromConfig(targetSymbol, newAlertCfg);
    }

    // Sync into symbolService in-memory catalog
    const symObj = symbolService.getSymbol(targetSymbol);
    if (symObj) {
      if (chartRange !== undefined) symObj.chartRange = String(chartRange);
      if (chartTimeframe !== undefined) symObj.chartTimeframe = String(chartTimeframe);
      if (barSpacing !== undefined) symObj.barSpacing = Number(barSpacing);
      if (tolerance !== undefined) symObj.tolerance = parseFloat(tolerance);
      if (retriggerDistance !== undefined) symObj.retriggerDistance = parseFloat(retriggerDistance);
      if (tradingViewTicker !== undefined) symObj.tradingViewTicker = String(tradingViewTicker);
      if (customChartUrl !== undefined) symObj.customChartUrl = String(customChartUrl);
    }

    // Also persist in MongoDB if connected
    if (mongoose.connection.readyState === 1) {
      try {
        await AlertConfiguration.findOneAndUpdate(
          { symbol: targetSymbol },
          { $set: { symbol: targetSymbol, ...newAlertCfg } },
          { upsert: true, new: true }
        );
      } catch (dbErr) {
        logger.warn(`Could not persist AlertConfiguration: ${dbErr.message}`);
      }
    }

    let state;
    if (autoCalculatePivot !== false && (!r3 || !r2 || !s2 || !s3)) {
      state = await pivotService.getOrCalculatePivotsForSymbol(targetSymbol, {
        pivotType: pivotType || newAlertCfg.pivotType || 'FIBONACCI',
        pivotTimeframe: pivotTimeframe || newAlertCfg.pivotTimeframe || 'DAILY',
        force: true
      });
    } else if (r3 && r2 && s2 && s3) {
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
    if (!state) {
      state = pivotService.getPivotState(targetSymbol);
    }
    if (state) {
      pivotService.broadcastPivotState(state);
    }
    if (pivotService.io) {
      pivotService.io.emit('config:update', config);
      pivotService.io.emit('config_updated', config);
      pivotService.io.emit('alert:states', alertService.getAllLevelStates(targetSymbol));
    }
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
