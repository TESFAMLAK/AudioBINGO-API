import mongoose from 'mongoose';

const StatsSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    required: true,
    index: true,
  },
  date: { type: Date, required: true },
  profit: { type: Number, default: 0 },
  betAmount: { type: Number, default: 0 },
  gamesPlayed: { type: Number, default: 0 },
});

const Stats = mongoose.model('Stats', StatsSchema);
export default Stats;
