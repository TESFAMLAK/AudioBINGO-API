import mongoose from 'mongoose';
const AnalyticsSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  type: {
    type: String,
    enum: ['PAID', 'CREDIT'],
    required: true,
  },
  commission: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  status: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'CANCELLED'],
    default: 'COMPLETED',
  },
  profitGenerated: {
    type: Number,
    default: 0,
  },
  roi: {
    type: Number,
    default: 0,
  },
  date: {
    type: Date,
    default: Date.now,
  },
});

const Analytics = mongoose.model('Analytics', AnalyticsSchema);
export default Analytics;
