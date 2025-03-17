import express from 'express';
import Admin from '../models/Admin.js';
import BankTransaction from '../models/BankTransaction.js';
import DepositTransaction from '../models/DepositTransaction.js';
import { verifyToken } from '../middleware/verifyToken.mjs';
const router = express.Router();

// Get payment details for deposits
router.get('/payment-details', verifyToken, async (req, res) => {
  try {
    const admin = await Admin.findOne({ role: 'admin' });
    if (!admin) {
      return res.status(404).json({ 
        success: false, 
        message: 'Payment details not found' 
      });
    }

    res.json({
      success: true,
      serviceFeePercentage: admin.serviceFeePercentage,
      paymentDetails: admin.paymentDetails
    });
  } catch (error) {
    console.error('Error fetching payment details:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Process deposit request
router.post('/subadmin', verifyToken, async (req, res) => {
  try {
    const { amount, paymentMethod, transactionNumber, serviceFee } = req.body;
    const subadminId = req.user._id;

    // Validate input
    if (!amount || !paymentMethod || !transactionNumber || !serviceFee) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    // Validate amount
    if (amount < 1000) {
      return res.status(400).json({
        success: false,
        message: 'Minimum deposit amount is 1000'
      });
    }

    // Validate payment method
    if (!['CBE', 'TELEBIRR'].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method'
      });
    }

    // Validate transaction
    const bankTransaction = await BankTransaction.findOne({
      transactionInfo: transactionNumber,
      status: 'available'
    });

    if (!bankTransaction) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or already used transaction number'
      });
    }

    // Verify service fee amount
    if (bankTransaction.amount !== serviceFee) {
      return res.status(400).json({
        success: false,
        message: 'Service fee amount does not match'
      });
    }

    // Get admin configuration
    const admin = await Admin.findOne({ role: 'admin' });
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin configuration not found'
      });
    }

    // Create deposit transaction
    const depositTransaction = new DepositTransaction({
      subadminId,
      amount,
      serviceFee,
      serviceFeePercentage: admin.serviceFeePercentage,
      paymentMethod,
      serviceFeeTransactionId: bankTransaction._id,
      status: 'completed',
      completedAt: new Date()
    });

    // Update bank transaction status
    bankTransaction.status = 'used';
    bankTransaction.usedBy = {
      userId: subadminId,
      username: req.user.username,
      timestamp: Date.now()
    };

    // Update subadmin wallet
    const subadmin = await Admin.findById(subadminId);
    if (!subadmin) {
      return res.status(404).json({
        success: false,
        message: 'Subadmin not found'
      });
    }
    subadmin.wallet += amount;

    // Save all changes
    await Promise.all([
      depositTransaction.save(),
      bankTransaction.save(),
      subadmin.save()
    ]);

    res.json({
      success: true,
      message: 'Deposit processed successfully'
    });
  } catch (error) {
    console.error('Deposit processing error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process deposit'
    });
  }
});

// Get deposit history
router.get('/history', verifyToken, async (req, res) => {
  try {
    const deposits = await DepositTransaction.find({
      subadminId: req.user._id
    })
    .sort({ createdAt: -1 })
    .limit(50); // Limit to last 50 deposits

    res.json({
      success: true,
      deposits
    });
  } catch (error) {
    console.error('Error fetching deposit history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch deposit history'
    });
  }
});

export default router; 