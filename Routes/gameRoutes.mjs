import express from "express";
import Game from "../models/Game.js";
import Admin from "../models/Admin.js";
import Bonus from "../models/Bonus.js";
import BonusConfig from "../models/BonusConfig.js";
import bingoCards from "../constant/bingoCards.mjs";
import Stats from "../models/Stats.js";
import { verifyToken } from "../middleware/verifyToken.mjs";
import { calculatePayout } from "../utils/calculatePayoutUtils.mjs";
import { generateCalledNumbers } from "../utils/generateCallNumbersUtils.mjs";
import {checkWinningCard} from "../utils/checkwinnersUtils.mjs"

const router  = express.Router();

// start bingo game
router.post('/start', verifyToken, async (req, res) => {
    try {
      const {
        bettingAmount,
        cardPaletteNumbers,
        callSpeed,
        profitPercentage,
        shuffle,
      } = req.body;
  
      const admin = await Admin.findById(req.admin.id);
      if (!admin) {
        return res.status(404).json({ message: 'Admin not found' });
      }
      if (admin.isSuspended) {
        return res.status(403).json({
          message: "Your account is suspended",
          amharicMessage: "እባክዎ የአገልግሎት ክፍያዎን ይክፈሉ",
          isSuspended: true,
        });
      }
  
      // Check if unlimited wallet is active and not expired
      const isUnlimitedWalletActive =
        admin.unlimitedWallet &&
        admin.unlimitedWallet.active &&
        new Date(admin.unlimitedWallet.expiresAt) > new Date();
  
     const calledNumbers = generateCalledNumbers(cardPaletteNumbers,bingoCards,shuffle);
      const numberOfPlayers = cardPaletteNumbers.length;
      const payoutToWinner = calculatePayout(
        bettingAmount,
        numberOfPlayers,
        profitPercentage
      );
      const totalBet = bettingAmount * numberOfPlayers;
      const profit = totalBet * (profitPercentage / 100);
  
      if (!isUnlimitedWalletActive && admin.wallet < profit) {
        return res.status(400).json({ message: 'Insufficient funds' });
      }
  
      // Only deduct from wallet if unlimited wallet is not active
      if (!isUnlimitedWalletActive) {
        admin.wallet -= profit;
        admin.ongoingProfit += profit;
        await admin.save();
      }
  
      const newGame = new Game({
        adminId: admin._id,
        bettingAmount,
        numberOfPlayers,
        payoutToWinner,
        profit,
        status: 'ongoing',
        calledNumbers,
        profitPercentage,
        shuffled: shuffle,
      });
  
      const savedGame = await newGame.save();
  
      // Update Stats
      const today = new Date().toISOString().split('T')[0];
      await Stats.findOneAndUpdate(
        { adminId: admin._id, date: today },
        {
          $inc: {
            profit: savedGame.profit,
            betAmount: savedGame.bettingAmount * savedGame.numberOfPlayers,
            gamesPlayed: 1,
          },
        },
        { upsert: true, new: true }
      );
  
      // Update Admin's lifetime stats
      await Admin.findByIdAndUpdate(admin._id, {
        $inc: {
          'lifetimeStats.totalProfit': savedGame.profit,
          'lifetimeStats.totalBetAmount':
            savedGame.bettingAmount * savedGame.numberOfPlayers,
          'lifetimeStats.totalGames': 1,
        },
      });
      // Update bonus stats
      const bonusConfig = await BonusConfig.findOne();
      if (bonusConfig && bonusConfig.active) {
        const currentDate = new Date();
        // Update monthly bonus
        let monthlyBonus = await Bonus.findOne({
          adminId: admin._id,
          type: 'monthly',
          startDate: { $lte: currentDate },
          endDate: { $gte: currentDate },
        });
  
        if (monthlyBonus) {
          monthlyBonus.gamesPlayed += 1;
          await monthlyBonus.save();
        }
      }
      const response = {
        message: 'Game started successfully',
        gameId: savedGame._id,
        calledNumbers: savedGame.calledNumbers,
        playingCards: cardPaletteNumbers,
        payoutToWinner: savedGame.payoutToWinner,
        callSpeed,
        shuffled: savedGame.shuffled,
        warning: isUnlimitedWalletActive
          ? null
          : admin.wallet < 30
          ? 'Your wallet balance is low. Please add funds soon.'
          : null,
      };
      io.emit('gameStarted', { gameId: savedGame._id });
      res.status(201).json(response);
    } catch (error) {
      console.error('Error starting the game:', error);
      res.status(500).json({ message: 'Server error. Please try again later.' });
    }
  });
  

router.post('/isWinner/:gameId/:cardNumber', async (req, res) => {
    try {
      const { gameId, cardNumber } = req.params;
      const { calledNumbers, winningPattern } = req.body;
      console.log(
        `Checking winner for game ${gameId}, card ${cardNumber}, patterns ${winningPattern}`
      );
      console.log('Called numbers:', calledNumbers);
      const game = await Game.findById(gameId);
      if (!game) {
        console.log(`Game not found: ${gameId}`);
        return res.status(404).json({ message: 'Game not found' });
      }
  
      const card = bingoCards.find(
        (card) => card.paletteNumber === parseInt(cardNumber)
      );
      if (!card) {
        console.log(`Card not found: ${cardNumber}`);
        return res.status(404).json({ message: 'Card not found' });
      }
      console.log('Found card:', JSON.stringify(card, null, 2));
  
      const winningPatterns = winningPattern.split('+');
      let winningDiagonal = null;
      let isWinner = false;
      const actualWinningPatterns = [];
  
      winningPatterns.forEach((pattern) => {
        const result = checkWinningCard(card.numbers, calledNumbers, pattern);
        console.log(`Result for pattern ${pattern}:`, result);
  
        if (pattern === 'All') {
          if (result.length > 0) {
            isWinner = true;
            actualWinningPatterns.push(...result);
            // Check if OneDiagonal is in the result and set winningDiagonal
            if (result.includes('OneDiagonal')) {
              const diagonalResult = checkOneDiagonal(
                card.numbers,
                calledNumbers
              );
              winningDiagonal = diagonalResult.diagonal;
            }
          }
        } else if (result) {
          isWinner = true;
          if (pattern === 'OneDiagonal' && result.diagonal) {
            winningDiagonal = result.diagonal;
            actualWinningPatterns.push(pattern);
          } else if (Array.isArray(result)) {
            actualWinningPatterns.push(...result);
          } else {
            actualWinningPatterns.push(pattern);
          }
        }
      });
  
      console.log(`Winner check result for card ${cardNumber}: ${isWinner}`);
      console.log('Actual winning patterns:', actualWinningPatterns);
      console.log('Winning diagonal:', winningDiagonal);
  
      res.json({
        isWinner,
        winningPatterns: actualWinningPatterns,
        winningDiagonal: winningDiagonal,
      });
    } catch (error) {
      console.error('Error checking winner:', error);
      res.status(500).json({
        message: 'An error occurred while checking the winner',
        error: error.message,
      });
    }
  });

router.post('/:gameId/end', verifyToken, async (req, res) => {
    try {
      const { gameId } = req.params;
  
      const game = await Game.findById(gameId);
      if (!game) {
        return res.status(404).json({ message: 'Game not found.' });
      }
  
      if (game.status === 'completed') {
        return res.status(400).json({ message: 'Game has already ended.' });
      }
  
      game.status = 'completed';
      await game.save();
  
      const admin = await Admin.findById(game.adminId);
      admin.ongoingProfit -= game.profit;
      admin.updateLastGames(game._id);
  
      // Update statsByPeriod
      const date = game.createdAt.toISOString().split('T')[0];
      const statIndex = admin.statsByPeriod.findIndex(
        (stat) => stat.date.toISOString().split('T')[0] === date
      );
      if (statIndex > -1) {
        admin.statsByPeriod[statIndex].profit += game.profit;
      } else {
        admin.statsByPeriod.push({ date: game.createdAt, profit: game.profit });
      }
  
      // Sort statsByPeriod by date in descending order and limit to last 30 days
      admin.statsByPeriod.sort((a, b) => b.date - a.date);
      admin.statsByPeriod = admin.statsByPeriod.slice(0, 30);
  
      await admin.save();
  
      res.status(200).json({ message: 'Game ended successfully.' });
    } catch (error) {
      console.error('Error ending the game:', error);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

  
router.post('/:gameId/recordWinner', verifyToken, async (req, res) => {
    try {
      const { gameId } = req.params;
      const { winningCardNumbers, totalCallsToWin } = req.body;
  
      const game = await Game.findById(gameId);
      if (!game) {
        return res.status(404).json({ message: 'Game not found.' });
      }
  
      game.winningCardNumbers = winningCardNumbers;
      game.totalCallsToWin = totalCallsToWin;
      await game.save();
  
      res
        .status(200)
        .json({ message: 'Winner information recorded successfully.' });
    } catch (error) {
      console.error('Error recording winner information:', error);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });

export  default router;