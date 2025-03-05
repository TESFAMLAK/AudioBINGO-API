import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now, expires: "15d" },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", index: true },
  toAdmin: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  amount: { type: Number, required: true },
  type: { type: String, enum: ["deposit", "reversal"] },
  description: String,
});

const Transaction = mongoose.model('Transaction', transactionSchema);
export default Transaction;
