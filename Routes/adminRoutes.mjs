import express from "express";
import { body, validationResult } from "express-validator";
import { createObjectCsvWriter } from "csv-writer";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import Admin from "../models/Admin.js";
import Analytics from "../models/Analytics.js";
import Transaction from "../models/Transaction.js";
import BonusConfig from "../models/BonusConfig.js";
import Bonus from "../models/Bonus.js";
import OTP from "../models/OTP.js";
import Game from "../models/Game.js";
import Stats from "../models/Stats.js";
import { verifyToken } from "../middleware/verifyToken.mjs";
import { calculateMonthlyTrend } from "../utils/calculateMonthlyTrendUtils.mjs";
import { transporter } from "../services/mailerService.mjs";

dotenv.config();

const router  = express.Router();
const SERVER_START_TIME = new Date();

router.get('/verify-token', verifyToken, (req, res) => {
    // If the middleware passes, the token is valid
    res.json({ valid: true, admin: req.admin });
  });
  
router.post('/refresh-token', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(401).json({ message: 'Refresh Token is required' });
    }
  
    try {
      const admin = await Admin.findOne({ refreshToken });
      if (!admin) {
        return res.status(403).json({ message: 'Invalid refresh token' });
      }
  
      jwt.verify(
        refreshToken,
        process.env.REFRESH_TOKEN_SECRET,
        (err, decoded) => {
          if (err) {
            return res.status(403).json({ message: 'Invalid refresh token' });
          }
  
          const token = jwt.sign(
            { username: admin.username, id: admin._id },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
          );
  
          res.json({ token });
        }
      );
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });
  
router.post('/login', async (req, res, next) => {
    try {
      const { username, password } = req.body;
      const user = await Admin.findOne({ username });
      if (!user) {
        return res.status(401).json({ message: 'Invalid username or password' });
      }
      if (user.isBlocked) {
        return res
          .status(403)
          .json({ message: 'Admin is blocked. Contact support.' });
      }
  
      let isPasswordValid;
      if (user.isPasswordHashed) {
        isPasswordValid = await bcrypt.compare(password, user.password);
      } else {
        // For unhashed passwords, compare directly
        isPasswordValid = password === user.password;
  
        // If login is successful, update to hashed password
        if (isPasswordValid) {
          const hashedPassword = await bcrypt.hash(password, 10);
          user.password = hashedPassword;
          user.isPasswordHashed = true;
          await user.save();
        }
      }
  
      if (!isPasswordValid) {
        return res.status(401).json({ message: 'Invalid username or password' });
      }
  
      user.lastLoginTime = new Date();
      await user.save();
      const token = jwt.sign(
        { username: user.username, id: user._id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );
  
      const refreshToken = jwt.sign(
        { username: user.username, id: user._id, role: user.role },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: '1d' }
      );
  
      user.refreshToken = refreshToken;
      await user.save();
  
      res.json({
        token,
        refreshToken,
        username: user.username,
        role: user.role,
        userId: user._id,
        dashboardType: user.dashboardType,
      });
    } catch (err) {
      next(err);
    }
  });
  
 router.get('/:userId/dashboard-preference',
    verifyToken,
    async (req, res) => {
      try {
        const admin = await Admin.findById(req.admin.id);
  
        if (!admin) {
          return res.status(404).json({ message: 'Admin not found' });
        }
  
        res.json({ dashboardType: admin.dashboardType });
      } catch (error) {
        console.error('Error fetching dashboard preference:', error);
        res.status(500).json({ message: 'Error fetching dashboard preference' });
      }
    }
  );
  
  router.put('/:adminId/dashboard-preference',verifyToken,
    async (req, res) => {
      try {
        const { adminId } = req.params;
        const { dashboardType } = req.body;
  
        if (!['default', 'second', 'simple'].includes(dashboardType)) {
          return res.status(400).json({ message: 'Invalid dashboard type' });
        }
  
        const admin = await Admin.findByIdAndUpdate(
          adminId,
          { dashboardType },
          { new: true }
        );
  
        if (!admin) {
          return res.status(404).json({ message: 'Admin not found' });
        }
  
        res.json({
          message: 'Dashboard preference updated successfully',
          dashboardType: admin.dashboardType,
        });
      } catch (error) {
        console.error('Error updating dashboard preference:', error);
        res.status(500).json({ message: 'Error updating dashboard preference' });
      }
    }
  );
     
router.post('/signup/protected/hope',
    [
      body('username').isString().notEmpty(),
      body('password').isString().isLength({ min: 6 }),
      body('initialWallet').optional().isFloat({ min: 0 }),
      body('role').isIn(['admin', 'subadmin']).optional(),
      body('createdBy').optional().isMongoId(),
    ],
    async (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { username, password, initialWallet, role, createdBy } = req.body;
  
      const existingUser = await Admin.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ message: 'User already exists' });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const newAdmin = new Admin({
        username,
        password: hashedPassword,
        wallet: parseFloat(initialWallet) || 0,
        lastGames: [],
        isPasswordHashed: true,
        role: role || 'admin',
        createdBy: createdBy || null,
      });
      await newAdmin.save();
      res
        .status(201)
        .json({ message: 'User registered successfully', role: newAdmin.role });
    }
  );

router.get('/hope/all/protected', verifyToken, async (req, res) => {
    try {
      const requestingAdmin = await Admin.findById(req.admin.id).populate(
        'createdBy',
        'username'
      );
  
      if (!requestingAdmin) {
        const admins = await Admin.find().populate('createdBy', 'username');
        return res.json(admins);
      }
  
      let admins;
      if (requestingAdmin.role === 'subadmin') {
        // For subadmins, return only the admins they created
        admins = await Admin.find({
          createdBy: requestingAdmin._id,
          role: 'admin',
        }).populate('createdBy', 'username');
      }
      // Fetch ongoing games for all admins
      const ongoingGames = await Game.find({ status: 'ongoing' });
  
      // Calculate ongoing profits for each admin
      const adminOngoingProfits = {};
      ongoingGames.forEach((game) => {
        if (!adminOngoingProfits[game.adminId]) {
          adminOngoingProfits[game.adminId] = 0;
        }
        adminOngoingProfits[game.adminId] += game.profit;
      });
      res.json({
        requestingAdmin: {
          _id: requestingAdmin._id,
          username: requestingAdmin.username,
          role: requestingAdmin.role,
          wallet: requestingAdmin.wallet,
          ongoingProfit: adminOngoingProfits[requestingAdmin._id.toString()] || 0,
        },
        admins: admins,
      });
    } catch (error) {
      console.error('Error fetching admins:', error);
      res.status(500).json({ error: 'Failed to fetch admins' });
    }
  });
     
router.post('/:adminId/unlimited-wallet',verifyToken,
    async (req, res) => {
      try {
        const { adminId } = req.params;
        const { expirationDays } = req.body;
  
        console.log(
          `Activating unlimited wallet for admin ${adminId} with expiration in ${expirationDays} days`
        );
  
        if (!expirationDays || isNaN(expirationDays)) {
          return res
            .status(400)
            .json({ success: false, message: 'Invalid expiration days' });
        }
  
        const admin = await Admin.findById(adminId);
        if (!admin) {
          return res
            .status(404)
            .json({ success: false, message: 'Admin not found' });
        }
  
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + parseInt(expirationDays));
  
        admin.unlimitedWallet = {
          active: true,
          expiresAt: expiresAt,
        };
  
        const savedAdmin = await admin.save();
  
        res.status(200).json({
          success: true,
          message: 'Admin unlimited-walleted successfully',
          admin: {
            _id: savedAdmin._id,
            username: savedAdmin.username,
            unlimitedWallet: savedAdmin.unlimitedWallet,
          },
        });
      } catch (error) {
        console.error('Error activating unlimited wallet:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message,
        });
      }
    }
  );

router.post('/:adminId/deactivate-unlimited-wallet',verifyToken,
    async (req, res) => {
      try {
        const { adminId } = req.params;
  
        const admin = await Admin.findById(adminId);
        if (!admin) {
          return res
            .status(404)
            .json({ success: false, message: 'Admin not found' });
        }
  
        admin.unlimitedWallet = {
          active: false,
          expiresAt: null,
        };
  
        const savedAdmin = await admin.save();
  
        res.status(200).json({
          success: true,
          message: 'Admin unlimited wallet deactivated successfully',
          admin: {
            _id: savedAdmin._id,
            username: savedAdmin.username,
            unlimitedWallet: savedAdmin.unlimitedWallet,
          },
        });
      } catch (error) {
        console.error('Error deactivating unlimited wallet:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message,
        });
      }
    }
  );
  

router.put('/:adminId/wallet', async (req, res) => {
    const { adminId } = req.params;
    const { wallet, amount, transactionType = 'PAID', commission = 0 } = req.body;
  
    try {
      const admin = await Admin.findById(adminId);
      if (!admin) return res.status(404).json({ error: 'Admin not found' });
  
      const oldWallet = admin.wallet;
  
      // Validate transaction type and commission
      if (!['PAID', 'CREDIT'].includes(transactionType)) {
        return res.status(400).json({ error: 'Invalid transaction type' });
      }
  
      if (commission < 0 || commission > 100) {
        return res
          .status(400)
          .json({ error: 'Commission must be between 0 and 100' });
      }
      //Calculate profit and ROI
      const parsedAmount = parseFloat(amount);
      const parsedCommission = parseFloat(commission);
      const profitGenerated = (parsedAmount * parsedCommission) / 100;
      const roi = (profitGenerated / parsedAmount) * 100;
  
      // Check if unlimited wallet is active
      if (
        admin.unlimitedWallet &&
        admin.unlimitedWallet.active &&
        admin.unlimitedWallet.expiresAt > new Date()
      ) {
        admin.wallet = Infinity;
      } else {
        admin.wallet = wallet;
      }
  
      await admin.save();
  
      // Create a new analytics record
      const newAnalytics = new Analytics({
        adminId: admin._id,
        amount: parsedAmount,
        type: transactionType,
        commission: parsedCommission,
        status: 'COMPLETED',
        profitGenerated: profitGenerated, // Using calculated profit
        roi: roi, // Using calculated ROI
      });
  
      await newAnalytics.save();
  
      // Create transaction record for history
      const newTransaction = new Transaction({
        adminId: admin._id,
        amount: parseFloat(amount),
        toAdmin: admin._id,
        type: 'deposit',
        description: `Wallet update (${transactionType}): ${oldWallet} -> ${admin.wallet}`,
      });
      await newTransaction.save();
  
      // Update bonus stats
      const bonusConfig = await BonusConfig.findOne();
      if (bonusConfig && bonusConfig.active) {
        const currentDate = new Date();
        let monthlyBonus = await Bonus.findOne({
          adminId: admin._id,
          type: 'monthly',
          startDate: { $lte: currentDate },
          endDate: { $gte: currentDate },
        });
  
        if (monthlyBonus) {
          // Only update walletTopUp for PAID transactions
          if (transactionType === 'PAID') {
            monthlyBonus.walletTopUp += parseFloat(amount);
            await monthlyBonus.save();
          }
        }
      }
  
 
      res.json({
        message: `Admin wallet updated by ${amount}`,
        analytics: {
          _id: newAnalytics._id,
          date: newAnalytics.date,
          amount: newAnalytics.amount,
          type: newAnalytics.type,
          commission: newAnalytics.commission,
          status: newAnalytics.status,
        },
        transaction: {
          _id: newTransaction._id,
          date: newTransaction.date,
          admin: admin.username,
          amount: newTransaction.amount,
          type: newTransaction.type,
          description: newTransaction.description,
        },
        newWallet: admin.wallet,
      });
    } catch (error) {
      console.error('Error updating wallet:', error);
      res.status(500).json({ error: 'Failed to update wallet' });
    }
  });

 router.post('/:adminId/:action', async (req, res) => {
    const { adminId, action } = req.params;
    try {
      const admin = await Admin.findById(adminId);
      if (!admin) return res.status(404).json({ error: 'Admin not found' });
  
      admin.isBlocked = action === 'block';
      await admin.save();
  
      res.json({ message: `Admin ${action}ed successfully` });
    } catch (error) {
      console.error(`Error ${action}ing admin:`, error);
      res.status(500).json({ error: `Failed to ${action} admin` });
    }
  });
  
  router.post('/:adminId/reverse-deposit/:transactionId',
    verifyToken,
    async (req, res) => {
      try {
        const { adminId, transactionId } = req.params;
        const admin = await Admin.findById(adminId);
  
        if (!admin) {
          return res.status(404).json({ message: 'Admin not found' });
        }
  
        const depositToReverse = await Transaction.findOne({
          _id: transactionId,
          adminId: adminId,
          type: 'deposit',
        });
  
        if (!depositToReverse) {
          return res
            .status(404)
            .json({ message: 'Deposit transaction not found' });
        }
  
        const threeDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
        if (depositToReverse.date < threeDaysAgo) {
          return res
            .status(400)
            .json({ message: 'Deposit is too old to reverse' });
        }
  
        const reversedAmount = depositToReverse.amount;
  
        if (admin.wallet < reversedAmount) {
          return res
            .status(400)
            .json({ message: 'Insufficient balance to reverse the deposit' });
        }
  
        // Reverse the deposit
        admin.wallet -= reversedAmount;
        await admin.save();
  
        // Create a new transaction for the reversal
        const newTransaction = new Transaction({
          adminId: admin._id,
          amount: -reversedAmount,
          type: 'reversal',
          description: `Reversal of deposit: ${depositToReverse._id}`,
        });
        await newTransaction.save();
  
        res.json({
          message: 'Deposit reversed successfully',
          reversedAmount: reversedAmount,
        });
      } catch (error) {
        console.error('Error reversing deposit:', error);
        res.status(500).json({ message: 'Failed to reverse deposit' });
      }
    }
  );
  
  router.get('/:adminId/recent-deposits',verifyToken,
    async (req, res) => {
      try {
        const { adminId } = req.params;
        const threeDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  
        const recentDeposits = await Transaction.find({
          adminId: adminId,
          type: 'deposit',
          date: { $gte: threeDaysAgo },
        })
          .sort({ date: -1 })
          .limit(20); // Fetch last 20 deposits within 5 days
  
        res.json(recentDeposits);
      } catch (error) {
        console.error('Error fetching recent deposits:', error);
        res.status(500).json({ message: 'Failed to fetch recent deposits' });
      }
    }
  );
  
 
  router.post('/change-password', async (req, res) => {
    const { adminId, newPassword, masterKey } = req.body;
  
    try {
      const admin = await Admin.findById(adminId);
      if (!admin) return res.status(404).json({ error: 'Admin not found' });
  
      if (masterKey !== process.env.MASTER_KEY) {
        return res.status(403).json({ error: 'Invalid master key' });
      }
  
      // Hash the new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
  
      // Save the hashed password
      admin.password = hashedPassword;
      admin.isPasswordHashed = true; // Ensure this flag is set
      await admin.save();
  
      res.json({ message: 'Password changed successfully' });
    } catch (error) {
      console.error('Error changing password:', error);
      res.status(500).json({ error: 'Failed to change password' });
    }
  });

  router.get('/dashboard-metrics', verifyToken, async (req, res) => {
    try {
      const userBase = await Admin.countDocuments();
  
      // Calculate server runtime in hours
      const currentTime = new Date();
      const runtimeInMilliseconds = currentTime - SERVER_START_TIME;
      const serverRuntime = Math.floor(runtimeInMilliseconds / (1000 * 60 * 60)); // Convert to hours
      const runtimeInMinutes = Math.floor(runtimeInMilliseconds / (1000 * 60)); // Convert to minutes
  
      // Change active user time window to 30 minutes
      const activeUsers = await Admin.countDocuments({
        lastLoginTime: { $gte: new Date(Date.now() - 30 * 60 * 1000) },
      });
      const inactiveUsers = userBase - activeUsers;
  
      res.json({
        userBase,
        activeUsers,
        inactiveUsers,
        serverRuntime,
        serverRuntimeDetails: {
          startTime: SERVER_START_TIME,
          currentTime: currentTime,
          runtimeInMilliseconds,
          runtimeInMinutes,
        },
      });
    } catch (error) {
      console.error('Error fetching dashboard metrics:', error);
      res.status(500).json({ message: 'Error fetching dashboard metrics' });
    }
  });


  router.get('/stats', verifyToken, async (req, res) => {
        try {
        const admin = await Admin.findById(req.admin.id);
        if (!admin) {
            return res.status(404).json({ message: 'Admin not found' });
        }
    
        const today = new Date();
        const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    
        // Fetch stats from the Stats collection
        const stats = await Stats.find({
            adminId: admin._id,
            date: { $gte: thirtyDaysAgo, $lte: today },
        }).sort({ date: 1 });
    
        // Fetch ongoing games
        const ongoingGames = await Game.find({
            adminId: admin._id,
            status: 'ongoing',
        });
    
        // Create a map to store ongoing profit by date
        const ongoingProfitByDate = {};
        ongoingGames.forEach((game) => {
            const dateStr = game.createdAt.toISOString().split('T')[0];
            if (!ongoingProfitByDate[dateStr]) {
            ongoingProfitByDate[dateStr] = 0;
            }
            ongoingProfitByDate[dateStr] += game.profit;
        });
    
        const statsByPeriod = stats.map((stat) => {
            const dateStr = stat.date.toISOString().split('T')[0];
            return {
            date: stat.date,
            profit: stat.profit,
            gamesPlayed: stat.gamesPlayed,
            betAmount: stat.betAmount,
            ongoingProfit: ongoingProfitByDate[dateStr] || 0,
            };
        });
    
        const totalStats = stats.reduce(
            (acc, stat) => {
            acc.totalProfit += stat.profit;
            acc.totalBetAmount += stat.betAmount;
            acc.totalGames += stat.gamesPlayed;
            return acc;
            },
            { totalProfit: 0, totalBetAmount: 0, totalGames: 0 }
        );
    
        // If no stats found for the period, use lifetimeStats
        if (totalStats.totalGames === 0) {
            totalStats.totalGames = admin.lifetimeStats.totalGames;
            totalStats.totalProfit = admin.lifetimeStats.totalProfit;
            totalStats.totalBetAmount = admin.lifetimeStats.totalBetAmount;
        }
    
        // Calculate total ongoing profit
        const totalOngoingProfit = Object.values(ongoingProfitByDate).reduce(
            (sum, profit) => sum + profit,
            0
        );
    
        res.json({
            statsByPeriod,
            totalStats,
            lifetimeStats: admin.lifetimeStats,
            ongoingProfit: totalOngoingProfit,
            adjustedTotalProfit: totalStats.totalProfit + totalOngoingProfit,
        });
        } catch (error) {
        console.error('Error fetching admin stats:', error);
        res
            .status(500)
            .json({ message: 'An error occurred while fetching admin stats' });
        }
    });
  
  router.get('/myGames', verifyToken, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = 10; // Number of games per page
  
      const admin = await Admin.findById(req.admin.id);
      if (!admin) {
        return res.status(404).json({ message: 'Admin not found' });
      }
  
      // Get total games from Admin's lifetimeStats
      let totalGames = admin.lifetimeStats.totalGames;
  
      // Get available games (those not yet deleted)
      const availableGames = await Game.countDocuments({ adminId: admin._id });
  
      // If lifetimeStats is not available, fallback to availableGames
      if (totalGames === 0) {
        totalGames = availableGames;
      }
  
      const totalPages = Math.max(1, Math.ceil(availableGames / limit));
  
      // Adjust page if it exceeds available pages
      const adjustedPage = Math.min(page, totalPages);
      const adjustedSkip = Math.max(0, (adjustedPage - 1) * limit);
  
      const games = await Game.find({ adminId: admin._id })
        .sort({ createdAt: -1 })
        .skip(adjustedSkip)
        .limit(limit);
  
      const formattedGames = games.map((game) => ({
        id: game._id,
        date: game.createdAt,
        bettingAmount: game.bettingAmount,
        players: game.numberOfPlayers,
        status: game.status,
        totalBetAmount: game.bettingAmount * game.numberOfPlayers,
        profit: game.profit,
        profitPercentage: game.profitPercentage,
        winningCardNumbers: game.winningCardNumbers,
        totalCallsToWin: game.totalCallsToWin,
      }));
      const adminBonus = await Bonus.findOne({
        adminId: req.admin.id,
        type: 'monthly',
        startDate: { $lte: new Date() },
        endDate: { $gte: new Date() },
      });
  
      let adminRank = null;
      if (adminBonus) {
        adminRank = await calculateRank(adminBonus);
      }
    
      res.json({
        games: formattedGames,
        currentPage: adjustedPage,
        totalPages: totalPages,
        totalGames: totalGames,
        availableGames: availableGames,
        wallet: admin.wallet,
        unlimitedWallet: {
          active: admin.unlimitedWallet ? admin.unlimitedWallet.active : false,
          expiresAt: admin.unlimitedWallet
            ? admin.unlimitedWallet.expiresAt
            : null,
          adminRank: adminRank,
        },
        note: 'For performance reasons, detailed game data is retained for a limited time. Total game count includes all games played.',
      });
    } catch (error) {
      console.error('Error fetching admin games:', error);
      res
        .status(500)
        .json({ message: 'An error occurred while fetching admin games' });
    }
  });
  
  router.get('/exportGames', verifyToken, async (req, res) => {
    try {
      const admin = await Admin.findById(req.admin.id);
      if (!admin) {
        return res.status(404).json({ message: 'Admin not found' });
      }
  
      const games = await Game.find({ adminId: admin._id }).sort({
        createdAt: -1,
      });
  
      const csvWriter = createObjectCsvWriter({
        path: 'games_export.csv',
        header: [
          { id: 'date', title: 'Date' },
          { id: 'bettingAmount', title: 'Betting Amount' },
          { id: 'players', title: 'Players' },
          { id: 'status', title: 'Status' },
          { id: 'totalBetAmount', title: 'Total Bet Amount' },
          { id: 'profit', title: 'Profit' },
        ],
      });
  
      const records = games.map((game) => ({
        date: game.createdAt.toISOString(),
        bettingAmount: game.bettingAmount,
        players: game.numberOfPlayers,
        status: game.status,
        totalBetAmount: game.bettingAmount * game.numberOfPlayers,
        profit: game.profit,
      }));
  
      await csvWriter.writeRecords(records);
  
      const filePath = path.resolve('games_export.csv');
      res.download(filePath, 'my_games.csv', (err) => {
        if (err) {
          console.error('Error downloading file:', err);
          res.status(500).send('Error downloading file');
        }
        // Delete the file after sending
        fs.unlinkSync(filePath);
      });
    } catch (error) {
      console.error('Error exporting games:', error);
      res
        .status(500)
        .json({ message: 'An error occurred while exporting games' });
    }
  });
  
  router.get('/transactions', verifyToken, async (req, res) => {
    try {
      
      const transactions = await Transaction.find()
        .sort({ date: -1 })
        .limit(300)
        .populate('adminId', 'username');
  
      
  
      const formattedTransactions = transactions.map((transaction) => ({
        _id: transaction._id,
        date: transaction.date,
        admin: transaction.adminId ? transaction.adminId.username : 'Unknown',
        toAdmin: transaction.toAdmin ? transaction.toAdmin.username : 'N/A',
        amount: transaction.amount,
        type: transaction.type,
        description: transaction.description,
      }));
  
      res.json(formattedTransactions);
    } catch (error) {
      console.error('Error fetching recent transactions:', error);
      res.status(500).json({
        message: 'An error occurred while fetching recent transactions',
        error: error.message,
      });
    }
  });

  router.get('/:adminId/last-games', verifyToken, async (req, res) => {
    try {
      const { adminId } = req.params;
  
      // Verify that the admin exists
      const admin = await Admin.findById(adminId);
      if (!admin) {
        return res.status(404).json({ message: 'Admin not found' });
      }
  
      // Fetch the last 10 games for this admin
      const lastTenGames = await Game.find({ adminId })
        .sort({ createdAt: -1 }) // Sort by creation date, newest first
        .limit(10) // Limit to 10 results
        .populate('adminId', 'username'); // Populate the admin field with just the username
  
      // Format the games data
      const formattedGames = lastTenGames.map((game) => ({
        _id: game._id,
        createdAt: game.createdAt,
        admin: {
          username: game.adminId ? game.adminId.username : 'Unknown',
        },
        bettingAmount: game.bettingAmount,
        numberOfPlayers: game.numberOfPlayers,
        payoutToWinner: game.payoutToWinner,
        profit: game.profit,
        profitPercentage: game.profitPercentage, 
        status: game.status,
      }));
  
      res.json(formattedGames);
    } catch (error) {
      console.error('Error fetching last 10 games:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  });
  
  router.get('/last-games', verifyToken, async (req, res) => {
    try {
     
      // Fetch all admins except the main admin 
      const subAdmins = await Admin.find({
        username: { $ne: 'main_admin_username' },
      });
  
      let allGames = [];
  
      for (let admin of subAdmins) {
        const adminGames = await Game.find({ adminId: admin._id })
          .sort({ createdAt: -1 })
          .limit(100) // Adjust this number as needed
          .populate('adminId', 'username');
  
        allGames = allGames.concat(adminGames);
      }
  
      // Sort all games by createdAt in descending order
      allGames.sort((a, b) => b.createdAt - a.createdAt);
  
      // Take the last 200 games (or adjust as needed)
      const lastGames = allGames.slice(0, 200);
  
      // Map the games to the desired format
      const formattedGames = lastGames.map((game) => ({
        _id: game._id,
        createdAt: game.createdAt,
        admin: {
          username: game.adminId ? game.adminId.username : 'Unknown',
        },
        bettingAmount: game.bettingAmount,
        numberOfPlayers: game.numberOfPlayers,
        payoutToWinner: game.payoutToWinner,
        profit: game.profit,
        profitPercentage: game.profitPercentage, // new line
        status: game.status,
      }));
  
      console.log(`Formatted games: ${formattedGames.length}`);
      console.log('First formatted game:', formattedGames[0]);
  
      res.json(formattedGames);
    } catch (error) {
      console.error('Error fetching last games:', error);
      res.status(500).json({
        message: 'An error occurred while fetching the last games',
        error: error.message,
      });
    }
  });

router.get('/profits', verifyToken, async (req, res) => {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const profits = await Game.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            profit: { $sum: '$profit' },
          },
        },
        { $sort: { _id: -1 } },
      ]);
      res.json(profits);
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Error fetching profits', error: error.message });
    }
  });
  
  router.get('/business-analytics', verifyToken, async (req, res) => {
    try {
      // Get all analytics records
      const analytics = await Analytics.find()
        .sort({ date: -1 }) // Sort by date descending
        .populate('adminId', 'username'); // Populate admin username
  
      // Transaction Summary
      const transactionSummary = {
        paidCount: analytics.filter((t) => t.type === 'PAID').length,
        creditCount: analytics.filter((t) => t.type === 'CREDIT').length,
        totalCredit: analytics
          .filter((t) => t.type === 'CREDIT')
          .reduce((sum, t) => sum + t.amount, 0),
  
        totalDeposits: analytics
          .filter((t) => t.type === 'PAID')
          .reduce((sum, t) => sum + t.amount, 0),
      };
  
      // Profit Analysis
      const profitAnalysis = {
        totalRevenue: analytics.reduce((sum, t) => sum + t.amount, 0),
        totalProfit: analytics.reduce((sum, t) => sum + t.profitGenerated, 0),
        averageROI:
          analytics.reduce((sum, t) => sum + t.roi, 0) / analytics.length || 0,
        monthlyTrend: calculateMonthlyTrend(analytics),
      };
  
      // Commission Stats
      const commissionStats = {
        totalCommission: analytics.reduce(
          (sum, t) => sum + (t.amount * t.commission) / 100,
          0
        ),
        averageCommission:
          analytics.reduce((sum, t) => sum + t.commission, 0) /
            analytics.length || 0,
      };
  
      // Recent Transactions
      const recentTransactions = analytics.map((t) => ({
        _id: t._id,
        date: t.date,
        adminUsername: t.adminId.username,
        amount: t.amount,
        type: t.type,
        commission: t.commission,
        profitGenerated: t.profitGenerated,
        roi: t.roi,
      }));
  
      res.json({
        transactionSummary,
        profitAnalysis,
        commissionStats,
        recentTransactions,
      });
    } catch (error) {
      console.error('Error fetching analytics:', error);
      res.status(500).json({ error: 'Failed to fetch analytics data' });
    }
  });
  
  router.post('/verify-password', async (req, res) => {
    const { password } = req.body;
    const correctPassword = process.env.ADMIN_PASSWORD; 
  
    if (password === correctPassword) {
      // Generate a token
      const token = jwt.sign(
        { username: 'admin' }, // You can use a generic admin username
        process.env.JWT_SECRET,
        { expiresIn: '5m' } // Token expires in 5 minutes
      );
      res.json({ success: true, token });
    } else {
      res.json({ success: false });
    }
  });
  
  router.delete('/api/admin/:id', verifyToken, async (req, res) => {
    try {
      const adminId = req.params.id;
  
      // Delete the admin
      await Admin.findByIdAndDelete(adminId);
  
      // Delete associated games
      await Game.deleteMany({ adminId: adminId });
  
      // Delete associated transactions
      await Transaction.deleteMany({ adminId: adminId });
  
      res.json({ message: 'Admin and associated data deleted successfully' });
    } catch (error) {
      console.error('Error deleting admin:', error);
      res.status(500).json({
        message: 'An error occurred while deleting the admin',
        error: error.message,
      });
    }
  });
  
  router.put('/:adminId/toggle-profit-option', verifyToken,
    async (req, res) => {
      try {
        const { adminId } = req.params;
        const { allowProfitOption } = req.body;
  
        // Find the admin and update the allowProfitOption field
        const updatedAdmin = await Admin.findByIdAndUpdate(
          adminId,
          { allowProfitOption },
          { new: true } 
        );
  
        if (!updatedAdmin) {
          return res
            .status(404)
            .json({ success: false, message: 'Admin not found' });
        }
  
        res.json({
          success: true,
          message: 'Profit option updated successfully',
          allowProfitOption: updatedAdmin.allowProfitOption,
        });
      } catch (error) {
        console.error('Error toggling profit option:', error);
        res.status(500).json({
          success: false,
          message: 'An error occurred while updating profit option',
        });
      }
    }
  );
 
router.get('/profit-option-status', verifyToken, async (req, res) => {
    try {
      const admin = await Admin.findById(req.admin.id);
      if (!admin) {
        return res.status(404).json({ message: 'Admin not found' });
      }
      res.json({ allowProfitOption: admin.allowProfitOption });
    } catch (error) {
      console.error('Error fetching profit option status:', error);
      res.status(500).json({
        message: 'An error occurred while fetching profit option status',
      });
    }
  });
  
  router.post('/billboard', verifyToken, async (req, res) => {
    try {
      const { content, type, expirationDays } = req.body;
  
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expirationDays);
  
      const result = await Admin.updateMany(
        {},
        {
          $set: {
            'billboard.content': content,
            'billboard.type': type,
            'billboard.active': true,
            'billboard.createdAt': new Date(),
            'billboard.expiresAt': expiresAt,
          },
        }
      );
  
  
      if (result.modifiedCount > 0) {
        res
          .status(200)
          .json({ message: 'Billboard updated successfully for all admins' });
      } else {
        console.log('No admins were updated');
        res.status(404).json({ message: 'No admins were updated' });
      }
    } catch (error) {
      console.error('Error updating billboard:', error);
      res
        .status(500)
        .json({ message: 'Error updating billboard', error: error.message });
    }
  });
  
  router.get('/billboard', async (req, res) => {
    try {
      const admin = await Admin.findOne({
        'billboard.active': true,
        'billboard.expiresAt': { $gt: new Date() },
      });
      if (admin && admin.billboard) {
        res.json(admin.billboard);
      } else {
        res.status(404).json({ message: 'No active billboard found' });
      }
    } catch (error) {
      console.error('Error fetching billboard:', error);
      res
        .status(500)
        .json({ message: 'Error fetching billboard', error: error.message });
    }
  });
  
router.post('/request-otp', verifyToken, async (req, res) => {
    try {
      const { action } = req.body;
      console.log('OTP Request received for action:', action);
  
      // Generate 4-digit OTP
      const otp = Math.floor(1000 + Math.random() * 9000).toString();
      console.log('Generated OTP:', otp);
  
      // Delete any existing OTP for this action
      const deleteResult = await OTP.deleteMany({ action });
      console.log('Deleted existing OTPs:', deleteResult);
  
      // Save new OTP
      const otpRecord = await OTP.create({
        action,
        otp,
        attempts: 0,
      });
      console.log('Created new OTP record:', otpRecord);
  
      // Configure email
      const mailOptions = {
        from: 'tesunlocks@gmail.com',
        to: 'tesunlocks@gmail.com',
        subject: 'Security Verification Required',
        html: `
          <h2>Security Alert: Action Verification Required</h2>
          <p>A sensitive action (${action}) was requested.</p>
          <p>Verification code: <strong>${otp}</strong></p>
          <p>This code will expire in 5 minutes.</p>
          <p>If you didn't request this action, please investigate immediately.</p>
        `,
      };
    
  
      // Test email configuration
      await transporter.verify();
    
  
      // Send email
      const info = await transporter.sendMail(mailOptions);
      console.log('Email sent successfully:', info);
  
      res.json({
        success: true,
        message: 'Verification code sent to secure email',
      });
    } catch (error) {
      console.error('Detailed error in OTP request:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
      });
      res.status(500).json({
        success: false,
        message: 'Failed to send verification code',
        error: error.message,
      });
    }
  });
 
  router.post('/verify-otp', verifyToken, async (req, res) => {
    try {
      const { otp, action } = req.body;
  
      // Find the OTP record
      const otpRecord = await OTP.findOne({ action });
  
      if (!otpRecord) {
        return res.json({
          success: false,
          message: 'No active verification code found. Please request a new one.',
        });
      }
  
      // Check attempts
      if (otpRecord.attempts >= 3) {
        await OTP.deleteOne({ _id: otpRecord._id });
        return res.json({
          success: false,
          message:
            'Maximum attempts reached. Please request a new verification code.',
          maxAttemptsReached: true,
        });
      }
  
      // Increment attempts
      otpRecord.attempts += 1;
      await otpRecord.save();
  
      // Verify OTP
      if (otpRecord.otp !== otp) {
        const remainingAttempts = 3 - otpRecord.attempts;
        return res.json({
          success: false,
          message: `Invalid code. ${remainingAttempts} attempts remaining.`,
          remainingAttempts,
        });
      }
  
      // Code is correct - delete it and return success
      await OTP.deleteOne({ _id: otpRecord._id });
  
      res.json({
        success: true,
        message: 'Action verified successfully',
      });
    } catch (error) {
      console.error('Error verifying code:', error);
      res.status(500).json({
        success: false,
        message: 'Verification failed',
      });
    }
  });
  
  router.put('/:adminId/toggle-bonus', verifyToken, async (req, res) => {
    try {
      const { adminId } = req.params;
      const { bonusEnabled } = req.body;
  
      const updatedAdmin = await Admin.findByIdAndUpdate(
        adminId,
        { bonusEnabled },
        { new: true }
      );
  
      if (!updatedAdmin) {
        return res.status(404).json({
          success: false,
          message: 'Admin not found',
        });
      }
  
      res.json({
        success: true,
        message: 'Bonus status updated successfully',
        bonusEnabled: updatedAdmin.bonusEnabled,
      });
    } catch (error) {
      console.error('Error toggling bonus:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update bonus status',
      });
    }
  });
  
  router.get('/:userId/bonus-status', verifyToken, async (req, res) => {
    try {
      const { userId } = req.params;
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required',
        });
      }
  
      const admin = await Admin.findById(userId);
  
      if (!admin) {
        console.log('Admin not found for userId:', userId);
        return res.status(404).json({
          success: false,
          message: 'Admin not found',
        });
      }
  
      res.json({
        success: true,
        bonusEnabled: admin.bonusEnabled || false,
        message: `Bonus is ${
          admin.bonusEnabled ? 'enabled' : 'disabled'
        } for this admin`,
      });
    } catch (error) {
      console.error('Error checking bonus status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check bonus status',
        error: error.message,
      });
    }
  });

router.get('/:adminId/game-count', verifyToken, async (req, res) => {
    try {
      const { adminId } = req.params;
      const count = await Game.countDocuments({ adminId });
      res.json({ success: true, count });
    } catch (error) {
      console.error('Error getting game count:', error);
      res
        .status(500)
        .json({ success: false, message: 'Failed to get game count' });
    }
  });
  
  router.delete('/:adminId/clean-history',verifyToken,
    async (req, res) => {
      try {
        const { adminId } = req.params;
        const { cleanType } = req.body; // 'all' or 'half'
  
        const totalGames = await Game.countDocuments({ adminId });
  
        let result;
        if (cleanType === 'half') {
          // Get the oldest half of games
          const skipCount = Math.ceil(totalGames / 2);
          const oldestGames = await Game.find({ adminId })
            .sort({ createdAt: 1 })
            .limit(skipCount)
            .select('_id');
  
          const gameIds = oldestGames.map((game) => game._id);
          result = await Game.deleteMany({ _id: { $in: gameIds } });
        } else {
          // Delete all games
          result = await Game.deleteMany({ adminId });
        }
  
        res.json({
          success: true,
          message: `Successfully deleted ${result.deletedCount} games`,
          deletedCount: result.deletedCount,
          remainingCount: totalGames - result.deletedCount,
        });
      } catch (error) {
        console.error('Error cleaning game history:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to clean game history',
          error: error.message,
        });
      }
    }
  );

  
router.get('/list/:subadminId', verifyToken, async (req, res) => {
    try {
      const { subadminId } = req.params;
  
      // Verify that the requesting user is the subadmin or has appropriate permissions
      if (req.admin.id !== subadminId && req.admin.role !== 'subadmin') {
        return res.status(403).json({ message: 'Unauthorized access' });
      }
  
      // Query the database for admins created by this subadmin
      const admins = await Admin.find({
        createdBy: subadminId,
        role: 'admin',
      }).select('username wallet createdAt');
  
      console.log(
        `Found ${admins.length} admins created by subadmin ${subadminId}`
      );
  
      res.json(admins);
    } catch (error) {
      console.error('Error fetching admins:', error);
      res
        .status(500)
        .json({ message: 'An error occurred while fetching admins' });
    }
  });
  

export  default router;