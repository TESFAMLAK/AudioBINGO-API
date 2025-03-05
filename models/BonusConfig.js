import mongoose from 'mongoose';

const BonusConfigSchema = new mongoose.Schema({
  active: { type: Boolean, default: false },
  rewards: {
    monthly: {
      first: { type: Number, default: 50000 },
      second: { type: Number, default: 25000 },
    },
  },
  rules: {
    monthly: {
      walletTopUp: { type: Number, default: 100000 },
      gamesPlayed: { type: Number, default: 500 },
    },
  },
  startDate: { type: Date },
  endDate: { type: Date },
});
const BonusConfig = mongoose.model('BonusConfig', BonusConfigSchema);
export default BonusConfig;
