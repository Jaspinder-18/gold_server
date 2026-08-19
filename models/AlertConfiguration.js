import mongoose from 'mongoose';

const AlertConfigurationSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    default: 'XAUUSD',
    unique: true
  },
  tradingViewTicker: {
    type: String,
    default: 'OANDA:XAUUSD'
  },
  customChartUrl: {
    type: String,
    default: ''
  },
  chartTimeframe: {
    type: String,
    default: '5'
  },
  chartRange: {
    type: String,
    enum: ['1D', '2D', '3D', '5D'],
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
  autoCalculatePivot: {
    type: Boolean,
    default: true
  },
  // Floor Pivot Point values
  r3: {
    type: Number,
    default: 4447.32
  },
  r2: {
    type: Number,
    default: 4442.28
  },
  r1: {
    type: Number,
    default: 4414.47
  },
  pivot: {
    type: Number,
    default: 4395.50
  },
  s1: {
    type: Number,
    default: 4378.20
  },
  s2: {
    type: Number,
    default: 4366.13
  },
  s3: {
    type: Number,
    default: 4340.00
  },
  // Trigger tolerance in USD
  tolerance: {
    type: Number,
    default: 0.20
  },
  // Minimum distance in USD price must move away to reset a level
  retriggerDistance: {
    type: Number,
    default: 1.00
  },
  // Enabled levels for alerts (R3, R2, S2, S3 required)
  monitoredLevels: {
    type: [String],
    default: ['R3', 'R2', 'S2', 'S3']
  },
  // Telegram notification toggle
  telegramAlertsEnabled: {
    type: Boolean,
    default: true
  },
  // Reference daily HLC used for auto-pivot
  dailyHigh: Number,
  dailyLow: Number,
  dailyClose: Number,
  lastCalculatedAt: Date
}, {
  timestamps: true
});

export const AlertConfiguration = mongoose.model('AlertConfiguration', AlertConfigurationSchema);
