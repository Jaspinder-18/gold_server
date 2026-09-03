import mongoose from 'mongoose';

const MarketEventSchema = new mongoose.Schema({
  eventId: {
    type: String,
    index: true,
    unique: true,
    sparse: true
  },
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
  customPrice: {
    type: Number
  },
  triggerPrice: {
    type: Number
  },
  currentPrice: {
    type: Number,
    required: true
  },
  level: {
    type: String,
    required: true,
    default: 'CUSTOM',
    index: true
  },
  levelPrice: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'TRIGGERED', 'INACTIVE'],
    default: 'TRIGGERED',
    index: true
  },
  direction: {
    type: String,
    default: 'TOUCH_TARGET'
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
  triggeredAt: {
    type: Date,
    default: Date.now
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
