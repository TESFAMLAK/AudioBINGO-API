import mongoose from 'mongoose';

const PatternBonusConfigSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "Admin",
  },
  config: {
    patterns: {
      SurroundingCenter: {
        enabled: { type: Boolean, default: false },
        amount: { type: Number, default: 0 },
      },
      LShape: {
        enabled: { type: Boolean, default: false },
        amount: { type: Number, default: 0 },
      },
      BothDiagonal: {
        enabled: { type: Boolean, default: false },
        amount: { type: Number, default: 0 },
      },
    },
    dailyLimit: {
      enabled: { type: Boolean, default: false },
      limit: { type: Number, default: 5 },
    },
    payoutThreshold: {
      enabled: { type: Boolean, default: false },
      amount: { type: Number, default: 0 },
    },
  },
  dailyClaims: {
    date: { type: Date, default: Date.now },
    count: { type: Number, default: 0 },
    claims: [
      {
        patternType: String,
        amount: Number,
        claimedAt: { type: Date, default: Date.now },
      },
    ],
  },
  updatedAt: { type: Date, default: Date.now },
});

PatternBonusConfigSchema.methods.checkAndResetDailyClaims = function () {
  const today = new Date().setHours(0, 0, 0, 0);
  const claimDate = new Date(this.dailyClaims.date).setHours(0, 0, 0, 0);

  if (claimDate < today) {
    this.dailyClaims = {
      date: new Date(),
      count: 0,
      claims: [],
    };
  }
  return this;
};

PatternBonusConfigSchema.methods.addClaim = function (patternType, amount) {
  this.dailyClaims.count += 1;
  this.dailyClaims.claims.push({
    patternType,
    amount,
    claimedAt: new Date(),
  });
  return this;
};


const PatternBonusConfig = mongoose.model(
  'PatternBonusConfig',
  PatternBonusConfigSchema
);
export default PatternBonusConfig;
