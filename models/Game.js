import mongoose from 'mongoose';

// Game Schema
const GameSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      index: true,
    },
    bettingAmount: {
      type: Number,
      required: true,
      min: [10, "Betting amount cannot be negative"],
    },
    numberOfPlayers: {
      type: Number,
      required: true,
      min: [3, "There must be at least 1 player"],
    },
    profitPercentage: {
      type: Number,
      required: true,
      enum: [20, 25, 30, 35, 40],
    },
    payoutToWinner: {
      type: Number,
      required: true,
      validate: {
        validator: function (value) {
          const totalBet = this.bettingAmount * this.numberOfPlayers;
          const maxPayout = totalBet * (1 - this.profitPercentage / 100);
          return value <= maxPayout;
        },
        message:
          "Payout cannot exceed the allowed amount based on profit percentage",
      },
    },
    profit: {
      type: Number,
      required: true,
      default: function () {
        const totalBet = this.bettingAmount * this.numberOfPlayers;
        return totalBet * (this.profitPercentage / 100);
      },
      validate: {
        validator: function (value) {
          return value >= 0;
        },
        message: "Profit cannot be negative",
      },
    },
    winningCardNumbers: [{ type: Number }],
    totalCallsToWin: { type: Number },
    status: {
      type: String,
      enum: ["ongoing", "completed", "canceled"],
      default: "ongoing",
    },
    createdAt: { type: Date, default: Date.now, index: true },
    completedAt: { type: Date },
    calledNumbers: [String],
    totalBetAmount: {
      type: Number,
      default: function () {
        return this.bettingAmount * this.numberOfPlayers;
      },
    },
  },
  {
    timestamps: true,
  }
);

// Middleware to automatically set `completedAt` when the status is changed to "completed"
GameSchema.pre("save", function (next) {
  if (this.status === "completed" || this.status === "canceled") {
    this.completedAt = new Date();
  }
  next();
});

const Game = mongoose.model('Game', GameSchema);
export default Game;
