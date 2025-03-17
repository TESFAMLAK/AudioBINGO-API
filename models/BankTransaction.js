import mongoose from "mongoose";

const bankTransactionSchema = new mongoose.Schema({
    transactionInfo: { 
        type: String, 
        required: true, 
        unique: true 
    },
    amount: { 
        type: Number, 
        required: true 
    },
    method: { 
        type: String, 
        required: true,
        enum: ['CBE', 'TELEBIRR', 'CBEBIRR']
    },
    timestamp: { 
        type: Number, 
        default: () => Date.now() 
    },
    senderName: {
        type: String,
        required: false
    },
    senderPhone: {
        type: String,
        required: false
    },
    addedBy: {
        operatorId: String,
        operatorName: String
    },
    status: {
        type: String,
        enum: ['available', 'used', 'invalid'],
        default: 'available'
    },
    usedBy: {
        userId: String,
        username: String,
        timestamp: Number
    }
});

const BankTransaction = mongoose.model('BankTransaction', bankTransactionSchema);
export default BankTransaction; 
