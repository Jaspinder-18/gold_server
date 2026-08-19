import mongoose from 'mongoose';

const MarketSnapshotSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    default: 'XAUUSD',
    index: true
  },
  provider: {
    type: String,
    default: 'tradingview'
  },
  price: {
    type: Number,
    required: true
  },
  bid: {
    type: Number
  },
  ask: {
    type: Number
  },
  open: {
    type: Number
  },
  high24h: {
    type: Number
  },
  low24h: {
    type: Number
  },
  change: {
    type: Number
  },
  changePercent: {
    type: Number
  },
  volume: {
    type: Number
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: { expires: '7d' } // Automatically clean up old snapshots after 7 days
  }
}, {
  timestamps: true
});

export const MarketSnapshot = mongoose.model('MarketSnapshot', MarketSnapshotSchema);
