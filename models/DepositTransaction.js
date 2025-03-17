import mongoose from "mongoose";

const depositTransactionSchema = new mongoose.Schema({
    subadminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Admin",
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    serviceFee: {
        type: Number,
        required: true
    },
    serviceFeePercentage: {
        type: Number,
        required: true
    },
    paymentMethod: {
        type: String,
        enum: ['CBE', 'TELEBIRR'],
        required: true
    },
    serviceFeeTransactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "BankTransaction",
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'pending'
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    completedAt: {
        type: Date
    }
});

const DepositTransaction = mongoose.model('DepositTransaction', depositTransactionSchema);
export default DepositTransaction; 