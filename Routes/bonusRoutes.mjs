import express from "express";
import bcrypt from "bcrypt";
import Admin from "../models/Admin.js";
import PatternBonusConfig from "../models/PatternBonusConfig.js";
import { verifyToken } from "../middleware/verifyToken.mjs";
const router  = express.Router();


router.post('/set-passcode', verifyToken, async (req, res) => {
    try {
      const { passcode } = req.body;
      const admin = await Admin.findById(req.admin.id);
  
      if (!admin) {
        return res.status(404).json({
          success: false,
          message: 'Admin not found',
        });
      }
  
      if (!admin.bonusEnabled) {
        return res.status(403).json({
          success: false,
          message: 'Bonus feature not enabled for this admin',
        });
      }
  
      // Hash passcode before storing
      const hashedPasscode = await bcrypt.hash(passcode, 10);
      admin.bonusPasscode = hashedPasscode;
      await admin.save();
  
      res.json({
        success: true,
        message: 'Passcode set successfully',
      });
    } catch (error) {
      console.error('Error setting bonus passcode:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to set passcode',
      });
    }
  });
  
  router.post('/verify-passcode', verifyToken, async (req, res) => {
    try {
      const { passcode } = req.body;
      const admin = await Admin.findById(req.admin.id);
  
      if (!admin) {
        return res.status(404).json({
          success: false,
          message: 'Admin not found',
        });
      }
  
      if (!admin.bonusEnabled) {
        return res.status(403).json({
          success: false,
          message: 'Bonus feature not enabled for this admin',
        });
      }
  
      // If no passcode is provided, check if passcode exists
      if (!passcode) {
        return res.json({
          success: true,
          needsSetup: !admin.bonusPasscode,
          message: admin.bonusPasscode
            ? 'Passcode exists'
            : 'Passcode needs to be set',
        });
      }
  
      // If no bonusPasscode exists, they need to set one
      if (!admin.bonusPasscode) {
        return res.json({
          success: false,
          needsSetup: true,
          message: 'Passcode needs to be set',
        });
      }
  
      // Verify the provided passcode
      const isValid = await bcrypt.compare(passcode, admin.bonusPasscode);
  
      res.json({
        success: isValid,
        needsSetup: false,
        message: isValid ? 'Passcode verified successfully' : 'Invalid passcode',
      });
    } catch (error) {
      console.error('Error verifying bonus passcode:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to verify passcode',
      });
    }
  });
  
  router.get('/config', verifyToken, async (req, res) => {
    try {
      const adminId = req.admin.id;
      const admin = await Admin.findById(adminId);
  
      if (!admin) {
        return res.status(404).json({
          success: false,
          message: 'Admin not found',
        });
      }
  
      // Get the pattern bonus configuration
      const patternConfig = await PatternBonusConfig.findOne({ adminId });
  
      // Default config if none exists
      const defaultConfig = {
        patterns: {
          SurroundingCenter: { enabled: false, amount: 0 },
          LShape: { enabled: false, amount: 0 },
          BothDiagonal: { enabled: false, amount: 0 },
        },
        dailyLimit: {
          enabled: false,
          limit: 5,
        },
        payoutThreshold: {
          enabled: false,
          amount: 0,
        },
      };
  
      res.json({
        success: true,
        config: patternConfig?.config || defaultConfig,
      });
    } catch (error) {
      console.error('Error getting pattern bonus config:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get pattern bonus configuration',
      });
    }
  });
  
  router.post('/config', verifyToken, async (req, res) => {
    try {
      const adminId = req.admin.id;
      const config = req.body;
  
      await PatternBonusConfig.findOneAndUpdate(
        { adminId },
        {
          adminId,
          config,
          updatedAt: new Date(),
        },
        { upsert: true, new: true }
      );
  
      res.json({
        success: true,
        message: 'Pattern bonus configuration saved successfully',
      });
    } catch (error) {
      console.error('Error saving pattern bonus config:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save pattern bonus configuration',
      });
    }
  });
  
  router.post('/claim', verifyToken, async (req, res) => {
    try {
      const adminId = req.admin.id;
      const { patternType, amount, payoutAmount } = req.body;
  
      let bonusConfig = await PatternBonusConfig.findOne({ adminId });
  
      if (!bonusConfig) {
        bonusConfig = new PatternBonusConfig({
          adminId,
          config: {
            patterns: {},
            dailyLimit: { enabled: true, limit: 5 },
          },
          dailyClaims: {
            date: new Date(),
            count: 0,
            claims: [],
          },
        });
      }
  
      if (bonusConfig.config.payoutThreshold.enabled) {
        if (payoutAmount < bonusConfig.config.payoutThreshold.amount) {
          return res.json({
            success: false,
            message:
              'Payout amount does not meet the minimum threshold for bonus',
            requiredAmount: bonusConfig.config.payoutThreshold.amount,
            actualAmount: payoutAmount,
          });
        }
      }
  
      try {
        bonusConfig.checkAndResetDailyClaims();
      } catch (error) {
        console.error('Error in checkAndResetDailyClaims:', error);
        console.log('Current bonusConfig state:', bonusConfig);
        throw error;
      }
  
      if (bonusConfig.dailyClaims.count >= bonusConfig.config.dailyLimit.limit) {
        return res.json({
          success: false,
          message: 'Daily bonus limit reached',
          dailyClaims: bonusConfig.dailyClaims.count,
          limit: bonusConfig.config.dailyLimit.limit,
        });
      }
  
      bonusConfig.addClaim(patternType, amount);
      await bonusConfig.save();
  
      res.json({
        success: true,
        dailyClaims: bonusConfig.dailyClaims.count,
        limit: bonusConfig.config.dailyLimit.limit,
        claims: bonusConfig.dailyClaims.claims,
      });
    } catch (error) {
      console.error('Detailed error in bonus claim:', {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        success: false,
        message: 'Failed to claim bonus',
        error: error.message,
      });
    }
  });
  
  router.get('/claim-history', verifyToken, async (req, res) => {
    try {
      const adminId = req.admin.id;
      const bonusConfig = await PatternBonusConfig.findOne({ adminId });
  
      if (!bonusConfig) {
        return res.json({
          dailyClaims: 0,
          limit: 5,
          claims: [],
          payoutThreshold: { enabled: false, amount: 0 },
        });
      }
  
      bonusConfig.checkAndResetDailyClaims();
      await bonusConfig.save();
  
      res.json({
        dailyClaims: bonusConfig.dailyClaims.count,
        limit: bonusConfig.config.dailyLimit.limit,
        claims: bonusConfig.dailyClaims.claims,
        payoutThreshold: bonusConfig.config.payoutThreshold,
      });
    } catch (error) {
      console.error('Error fetching claim history:', error);
      res.status(500).json({ message: 'Failed to fetch claim history' });
    }
  });
  

export  default router;