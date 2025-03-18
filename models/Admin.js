import mongoose from 'mongoose';

// Admin Schema
const AdminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  wallet: { type: Number, default: 0 },
  unlimitedWallet: {
    active: { type: Boolean, default: false },
    expiresAt: { type: Date },
  },
  lastGames: [
    {
      gameId: { type: mongoose.Schema.Types.ObjectId, ref: "Game" },
      date: { type: Date },
    },
  ],
  lastLoginTime: { type: Date, default: Date.now },
  ongoingProfit: { type: Number, default: 0 },
  isBlocked: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  statsByPeriod: [
    {
      date: { type: Date },
      profit: { type: Number },
    },
  ],
  isPasswordHashed: { type: Boolean, default: false },
  role: { type: String, enum: ["admin", "subadmin"], default: "admin" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  refreshToken: { type: String },
  allowProfitOption: { type: Boolean, default: false },
  billboard: {
    content: { type: String, default: "" },
    type: { type: String, default: "text" },
    active: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    expiresAt: {
      type: Date,
      default: () => new Date(+new Date() + 7 * 24 * 60 * 60 * 1000),
    },
  },
  monthlyBonus: { type: mongoose.Schema.Types.ObjectId, ref: "Bonus" },
  lifetimeStats: {
    totalProfit: { type: Number, default: 0 },
    totalBetAmount: { type: Number, default: 0 },
    totalGames: { type: Number, default: 0 },
  },
  dashboardType: {
    type: String,
    enum: ["default", "second", "simple"],
    default: "default",
  },
  bonusEnabled: { type: Boolean, default: false },
  bonusPasscode: { type: String },
  isSuspended: {
    type: Boolean,
    default: false,
  },
  // New fields for deposit feature
  serviceFeePercentage: {
    type: Number,
    default: 35, // 35% default service fee
    min: 0,
    max: 100
  },
  paymentDetails: {
    telebirr: {
      phoneNumber: String,
      accountName: String
    },
    cbe: {
      accountNumber: String,
      accountName: String
    }
  }
});

// Add a method to update lastGames
AdminSchema.methods.updateLastGames = function (gameId) {
  this.lastGames.unshift({ gameId, date: new Date() });
  if (this.lastGames.length > 10) {
    this.lastGames = this.lastGames.slice(0, 10);
  }
};

// Add a pre-save hook to log changes
AdminSchema.pre("save", function (next) {
  if (this.isModified("bonusEnabled")) {
    console.log("Bonus status changed:", {
      adminId: this._id,
      newStatus: this.bonusEnabled,
    });
  }
  next();
});

const Admin = mongoose.model('Admin', AdminSchema);
export default Admin;
