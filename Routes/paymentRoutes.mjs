import express from 'express';
import BankTransaction from '../models/BankTransaction.js';
import { cleanAndValidateTransaction } from '../utils/transactionUtils.js';
import Admin from '../models/Admin.js';
import { verifyToken } from '../middleware/verifyToken.mjs';

const router = express.Router();

// API endpoints for direct communication with the app
router.get('/test-connection', (req, res) => {
    try {
      const chatId = req.query.chatId;
      
      if (!chatId) {
        return res.status(400).json({ 
          success: false, 
          message: 'Missing chatId parameter' 
        });
      }
      
      console.log(`Received test connection request for chatId: ${chatId}`);
      res.json({ 
        success: true, 
        message: 'Test message sent successfully' 
      });
    } catch (error) {
      console.error('Error in test-connection endpoint:', error);
      res.status(500).json({ 
        success: false, 
        message: error.message || 'Internal server error' 
      });
    }
  });
  
  router.post('/process-transaction', async (req, res) => {
    try {
      const { chatId, type, id, amount, senderName, senderPhone, timestamp } = req.body;
      
      if (!chatId || !type || !id || !amount) {
        return res.status(400).json({ 
          success: false, 
          message: 'Missing required parameters: chatId, type, id, amount' 
        });
      }
      
      console.log(`Processing transaction via API: Type=${type}, ID=${id}, Amount=${amount}`);
      
      // Validate transaction type
      if (type !== 'CBE' && type !== 'TELEBIRR') {
        return res.status(400).json({ 
          success: false, 
          message: `Invalid payment method: ${type}` 
        });
      }
      
      // Clean and validate the transaction
      let cleanedTransaction;
      try {
        // Make sure id is a string before passing to cleanAndValidateTransaction
        if (typeof id !== 'string') {
          console.error('Invalid transaction ID type:', typeof id, id);
          return res.status(400).json({ 
            success: false, 
            message: 'Transaction ID must be a string' 
          });
        }
        
        cleanedTransaction = {
          id: cleanAndValidateTransaction(id, type),
          amount: parseFloat(amount)
        };
      } catch (error) {
        console.error('Error validating transaction:', error.message);
        return res.status(400).json({ 
          success: false, 
          message: error.message || 'Invalid transaction format' 
        });
      }
    
      // Create transaction object with optional sender info
      const transactionData = {
        transactionInfo: cleanedTransaction.id,
        amount: cleanedTransaction.amount,
        method: type,
        timestamp: Date.now()
      };
  
      // Only add sender info for Telebirr transactions
      if (type === 'TELEBIRR' && senderName) {
        transactionData.senderName = senderName;
        if (senderPhone) {
          transactionData.senderPhone = senderPhone;
        }
      }
      
      // Save to database
      const transaction = new BankTransaction(transactionData);
      await transaction.save();
      
      // Return success response
      res.json({ 
        success: true, 
        message: 'Transaction processed successfully',
        transaction: {
          id: cleanedTransaction.id,
          amount: cleanedTransaction.amount,
          type,
          senderName: type === 'TELEBIRR' ? senderName : undefined,
          senderPhone: type === 'TELEBIRR' ? senderPhone : undefined
        }
      });
    } catch (error) {
      console.error('Error in process-transaction endpoint:', error);
      res.status(500).json({ 
        success: false, 
        message: error.message || 'Internal server error' 
      });
    }
  });

// Get payment configuration
router.get('/payment-config/:adminId', verifyToken, async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.adminId);
    if (!admin) {
      return res.status(404).json({ 
        success: false, 
        message: 'Admin not found' 
      });
    }
    res.json({
      success: true,
      serviceFeePercentage: admin.serviceFeePercentage,
      paymentDetails: admin.paymentDetails
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch payment configuration' 
    });
  }
});

// Update payment configuration
router.put('/payment-config/:adminId', verifyToken, async (req, res) => {
  try {
    const { serviceFeePercentage, paymentDetails } = req.body;
    const admin = await Admin.findById(req.params.adminId);
    
    if (!admin) {
      return res.status(404).json({ 
        success: false, 
        message: 'Admin not found' 
      });
    }

    // Validate service fee percentage
    if (serviceFeePercentage < 0 || serviceFeePercentage > 100) {
      return res.status(400).json({
        success: false,
        message: 'Service fee percentage must be between 0 and 100'
      });
    }

    admin.serviceFeePercentage = serviceFeePercentage;
    admin.paymentDetails = paymentDetails;
    await admin.save();

    res.json({ 
      success: true, 
      message: 'Payment configuration updated successfully' 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update payment configuration' 
    });
  }
});

export default router;
