import mongoose from 'mongoose';

const BonusSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    required: true,
    index: true,
  },
  type: { type: String, enum: ["monthly"], required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  walletTopUp: { type: Number, default: 0 },
  gamesPlayed: { type: Number, default: 0 },
  rank: { type: Number },
  bonusAmount: { type: Number },
});

const Bonus = mongoose.model('Bonus', BonusSchema);
export default Bonus;
