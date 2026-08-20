import mongoose from 'mongoose';

const PivotStateSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    index: true
  },
  pivotType: {
    type: String,
    required: true,
    enum: ['TRADITIONAL', 'FIBONACCI', 'CAMARILLA', 'WOODIE', 'CLASSIC'],
    default: 'TRADITIONAL',
    uppercase: true
  },
  pivotTimeframe: {
    type: String,
    required: true,
    enum: ['DAILY', 'WEEKLY', 'MONTHLY'],
    default: 'DAILY',
    uppercase: true
  },
  // Reference completed period details
  periodStart: Date,
  periodEnd: Date,
  periodDateStr: String, // e.g. '2026-08-19'
  high: {
    type: Number,
    required: true
  },
  low: {
    type: Number,
    required: true
  },
  close: {
    type: Number,
    required: true
  },
  open: Number,
  range: Number,

  // Calculated Levels
  p: {
    type: Number,
    required: true
  },
  r1: Number,
  r2: {
    type: Number,
    required: true
  },
  r3: {
    type: Number,
    required: true
  },
  s1: Number,
  s2: {
    type: Number,
    required: true
  },
  s3: {
    type: Number,
    required: true
  },

  // Validation Status
  isValid: {
    type: Boolean,
    default: true
  },
  validationErrors: [String],

  // Lifecycle
  calculatedAt: {
    type: Date,
    default: Date.now
  },
  nextRolloverAt: Date,
  dataSource: {
    type: String,
    default: 'TradingView Scanner / Yahoo Finance'
  }
}, {
  timestamps: true
});

PivotStateSchema.index({ symbol: 1, pivotType: 1, pivotTimeframe: 1 }, { unique: true });

export const PivotState = mongoose.model('PivotState', PivotStateSchema);
