import express from "express";
import Admin from "../models/Admin";
import Transaction from "../models/Transaction";
import { verifyToken } from "../middleware/verifyToken.mjs";
const router  = express.Router();


router.put('/:adminId/wallet', verifyToken, async (req, res) => {
    const { adminId } = req.params;
    const { amount } = req.body;
    const requestingUserId = req.admin.id;
  
    try {
      const requestingUser = await Admin.findById(requestingUserId);
      if (!requestingUser) {
        return res.status(404).json({ error: 'Requesting user not found' });
      }
  
      const admin = await Admin.findById(adminId);
      if (!admin) return res.status(404).json({ error: 'Admin not found' });
  
      // Check if the requesting user is authorized
      if (requestingUser.role === 'subadmin') {
        if (admin.createdBy.toString() !== requestingUserId) {
          return res.status(403).json({
            error: 'Unauthorized: Subadmin can only modify admins they created',
          });
        }
        // Check if subadmin has sufficient funds
        if (requestingUser.wallet < amount) {
          return res
            .status(400)
            .json({ error: 'Insufficient funds in subadmin wallet' });
        }
      } else if (requestingUser.role !== 'admin') {
        return res.status(403).json({
          error:
            'Unauthorized: Only admins and subadmins can perform this action',
        });
      }
  
      const oldWallet = admin.wallet;
  
      // Check if unlimited wallet is active
      if (
        admin.unlimitedWallet &&
        admin.unlimitedWallet.active &&
        admin.unlimitedWallet.expiresAt > new Date()
      ) {
        // If unlimited wallet is active, don't update the wallet balance
        admin.wallet = Infinity;
      } else {
        admin.wallet += parseFloat(amount);
      }
  
      // If the requesting user is a subadmin, decrease their wallet
      if (requestingUser.role === 'subadmin') {
        requestingUser.wallet -= parseFloat(amount);
        await requestingUser.save();
      }
  
      await admin.save();
  
      // Create a new transaction
      const newTransaction = new Transaction({
        adminId: admin._id,
        amount: parseFloat(amount),
        toAdmin: admin._id,
        type: 'deposit',
        description: `Wallet update: ${oldWallet} -> ${admin.wallet}`,
        performedBy: requestingUserId,
      });
      await newTransaction.save();
  
      res.json({
        message: `Admin wallet updated by ${amount}`,
        transaction: {
          _id: newTransaction._id,
          date: newTransaction.date,
          admin: admin.username,
          amount: newTransaction.amount,
          type: newTransaction.type,
          description: newTransaction.description,
          performedBy: requestingUser.username,
        },
      });
    } catch (error) {
      console.error('Error updating wallet:', error);
      res.status(500).json({ error: 'Failed to update wallet' });
    }
  });
  


export  default router;