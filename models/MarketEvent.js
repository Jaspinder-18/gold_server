import mongoose from 'mongoose';

const MarketEventSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    default: 'XAUUSD',
    trim: true,
    index: true
  },
  assetType: {
    type: String,
    default: 'COMMODITY'
  },
  exchange: {
    type: String,
    default: 'OANDA'
  },
  pivotType: {
    type: String,
    default: 'TRADITIONAL'
  },
  pivotTimeframe: {
    type: String,
    default: 'DAILY'
  },
  pivotPeriod: {
    type: String
  },
  currentPrice: {
    type: Number,
    required: true
  },
  level: {
    type: String,
    required: true,
    enum: ['R3', 'R2', 'R1', 'PIVOT', 'S1', 'S2', 'S3', 'MANUAL'],
    index: true
  },
  levelPrice: {
    type: Number,
    required: true
  },
  direction: {
    type: String,
    enum: ['TOUCH_HIGH', 'TOUCH_LOW', 'TOUCH_RESISTANCE', 'TOUCH_SUPPORT', 'CROSS_UP', 'CROSS_DOWN', 'TEST_TRIGGER', 'MANUAL_CAPTURE'],
    default: 'TOUCH_HIGH'
  },
  tolerance: {
    type: Number,
    default: 0.20
  },
  previousPrice: {
    type: Number
  },
  triggerReason: {
    type: String,
    required: true
  },
  screenshotPath: {
    type: String,
    default: ''
  },
  telegramStatus: {
    type: String,
    enum: ['SENT', 'FAILED', 'PENDING', 'SKIPPED', 'MANUAL_CAPTURE'],
    default: 'PENDING',
    index: true
  },
  telegramMessage: {
    type: String
  },
  telegramMessageId: {
    type: String
  },
  telegramError: {
    type: String
  },
  isTest: {
    type: Boolean,
    default: false,
    index: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

export const MarketEvent = mongoose.model('MarketEvent', MarketEventSchema);
