import mongoose from 'mongoose';

const SymbolConfigSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true
  },
  displayName: {
    type: String,
    required: true
  },
  assetType: {
    type: String,
    required: true,
    enum: ['COMMODITY', 'FOREX', 'CRYPTO', 'INDEX', 'STOCK'],
    default: 'COMMODITY'
  },
  exchange: {
    type: String,
    default: 'OANDA'
  },
  tradingViewTicker: {
    type: String,
    required: true
  },
  provider: {
    type: String,
    default: 'TradingView Real-Time'
  },
  timezone: {
    type: String,
    default: 'America/New_York'
  },
  sessionCloseUtc: {
    type: String,
    default: '22:00' // 17:00 NY = 22:00 UTC (Standard)
  },
  priceDecimals: {
    type: Number,
    default: 2
  },
  tolerance: {
    type: Number,
    default: 0.20
  },
  retriggerDistance: {
    type: Number,
    default: 1.00
  },
  customChartUrl: {
    type: String,
    default: ''
  },
  chartTimeframe: {
    type: String,
    default: '15'
  },
  chartRange: {
    type: String,
    default: '1D'
  },
  barSpacing: {
    type: Number,
    default: 22
  },
  enabled: {
    type: Boolean,
    default: true
  },
  isDefault: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

export const SymbolConfig = mongoose.model('SymbolConfig', SymbolConfigSchema);
