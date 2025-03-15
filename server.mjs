import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import cors from "cors";
import mongoose from "mongoose";
import cardRoutes from "./cardRoutes.mjs";
import Ticket from "./models/Ticket.js";
import Analytics from "./models/Analytics.js";
import Admin from "./models/Admin.js";
import OTP from "./models/OTP.js";
import Game from "./models/Game.js";
import Notification from "./models/Notification.js";
import Transaction from "./models/Transaction.js";
import PatternBonusConfig from "./models/PatternBonusConfig.js";
import Bonus from "./models/Bonus.js";
import BonusConfig from "./models/BonusConfig.js";
import Stats from "./models/Stats.js";
import fs from "fs";
import path from "path";
import { createObjectCsvWriter } from "csv-writer";
import bingoCards from "./bingoCards.mjs";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { body, validationResult } from "express-validator";
import { Server } from "socket.io";
import http from "http";
import cron from "node-cron";
import { EventEmitter } from "events";
import schedule from "node-schedule";
import timeout from "connect-timeout";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();
app.set('trust proxy', 1);
app.use(timeout('60s'));
app.use(haltOnTimedout);

function haltOnTimedout(req, res, next) {
  if (!req.timedout) next();
}
const PORT = process.env.PORT || 5000;
const eventEmitter = new EventEmitter();

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['https://powerbetbingo.vercel.app', 'https://admin.arifbingo.com', '*'],
    methods: ['GET', 'POST'],
  },
});
io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: ['https://powerbetbingo.vercel.app', 'https://admin.arifbingo.com', '*' ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(
  helmet({
    contentSecurityPolicy: true, // Adjust as needed
    frameguard: { action: 'deny' },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    xssFilter: true,
    noSniff: true,
    ieNoOpen: true,
    referrerPolicy: { policy: 'no-referrer' },
  })
);
const SERVER_START_TIME = new Date();
const logger = {
  error: (message) => console.error(message),
  info: (message) => console.log(message), // Add this line
};

// Rate limiting

const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
});

app.use(globalLimiter);
app.options('*', cors());

// MongoDB connection
const mongoURI = process.env.MONGO_URI;

const connectWithRetry = () => {
  mongoose
    .connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000,
      retryWrites: true,
    })
    .then(() => {
      logger.info('Connected to MongoDB successfully');
    })
    .catch((error) => {
      logger.error('MongoDB connection error:', error);
      logger.info('Retrying connection in 10 seconds...');
      setTimeout(connectWithRetry, 10000);
    });
};

connectWithRetry();

const db = mongoose.connection;

db.on('error', (error) => {
  logger.error('MongoDB connection error:', error);
});

db.on('disconnected', () => {
  logger.warn('MongoDB disconnected. Attempting to reconnect...');
  connectWithRetry();
});

process.on('SIGINT', async () => {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed through app termination');
  process.exit(0);
});



// transporter configuration (around line 150)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'tesunlocks@gmail.com',
    pass: process.env.EMAIL_PASSWORD,
  },
  debug: true, // Enable debug logging
  logger: true, // Enable logger
});

// Test email configuration at startup
transporter.verify((error, success) => {
  if (error) {
    console.error('Email configuration error:', {
      name: error.name,
      message: error.message,
      code: error.code,
    });
  } else {
    console.log('Email server is ready:', success);
  }
});


// Modify the existing verifyToken middleware to include more information
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res
      .status(403)
      .json({ valid: false, message: 'No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .json({ valid: false, message: 'Failed to authenticate token.' });
    }
    req.admin = {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role,
    };
    next();
  });
};

app.get("/api/health", (req, res) => {
  try {
    res.status(200).json({ status: "OK", message: "Server is healthy" });
  } catch (error) {
    res.status(500).json({ status: "ERROR", message: "Server is not healthy" });
  }
});

app.get('/api/admin/verify-token', verifyToken, (req, res) => {
  // If the middleware passes, the token is valid
  res.json({ valid: true, admin: req.admin });
});

// Add a new endpoint for refreshing tokens:
app.post('/api/admin/refresh-token', async (req, res) => {
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

app.use('/api/card', cardRoutes);

// Update the admin login endpoint
app.post('/api/admin/login', async (req, res, next) => {
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

app.get(
  '/api/admin/:userId/dashboard-preference',
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

app.put(
  '/api/admin/:adminId/dashboard-preference',
  verifyToken,
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

// start bingo game
app.post('/api/game/start', verifyToken, async (req, res) => {
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

function calculatePayout(bettingAmount, numberOfPlayers, profitPercentage) {
  const totalBet = bettingAmount * numberOfPlayers;
  const profit = totalBet * (profitPercentage / 100);
  return totalBet - profit;
}

// Updated generateCalledNumbers function

let lastLuckyCardNumber = null;
function generateCalledNumbers(cardPaletteNumbers, bingoCards, shuffle) {
  // 1. Randomly select one lucky card from cardPaletteNumbers
  let availableCards = cardPaletteNumbers;
  if (lastLuckyCardNumber !== null) {
    availableCards = cardPaletteNumbers.filter(
      (num) => num !== lastLuckyCardNumber
    );
  }

  const luckyCardIndex = Math.floor(Math.random() * availableCards.length);
  const luckyCardNumber = availableCards[luckyCardIndex];
  const luckyCard = bingoCards.find(
    (card) => card.paletteNumber === luckyCardNumber
  );
  // Store this lucky card number for next game
  lastLuckyCardNumber = luckyCardNumber;

  console.log("Lucky Card:", luckyCard);

  // 2. Get all 25 numbers from lucky card (excluding FREE space)
  const luckyCardNumbers = [];
  Object.values(luckyCard.numbers).forEach((column) => {
    column.forEach((number) => {
      if (number !== "FREE") {
        luckyCardNumbers.push(number);
      }
    });
  });

  // 3. Randomly select 15 numbers from lucky card
  const priorityNumbers = [];
  while (priorityNumbers.length < 15) {
    const randomIndex = Math.floor(Math.random() * luckyCardNumbers.length);
    const number = luckyCardNumbers[randomIndex];
    if (!priorityNumbers.includes(number)) {
      priorityNumbers.push(number);
    }
  }

  // 4. Create array for first 20 calls with priority numbers randomly distributed
  const first20Calls = Array(20).fill(null);
  const availablePositions = Array.from({ length: 20 }, (_, i) => i);

  // Place 15 priority numbers randomly in first 20 positions
  priorityNumbers.forEach((number) => {
    const randomPosition = Math.floor(
      Math.random() * availablePositions.length
    );
    const position = availablePositions[randomPosition];
    availablePositions.splice(randomPosition, 1);

    // Add bingo letter prefix
    let letter;
    if (number <= 15) letter = "B";
    else if (number <= 30) letter = "I";
    else if (number <= 45) letter = "N";
    else if (number <= 60) letter = "G";
    else letter = "O";

    first20Calls[position] = `${letter}${number}`;
  });

  // 5. Get all remaining numbers from all cards
  const remainingNumbers = new Set();
  cardPaletteNumbers.forEach((paletteNumber) => {
    const card = bingoCards.find(
      (card) => card.paletteNumber === paletteNumber
    );
    Object.values(card.numbers).forEach((column) => {
      column.forEach((number) => {
        if (number !== "FREE" && !priorityNumbers.includes(number)) {
          remainingNumbers.add(number);
        }
      });
    });
  });

  // 6. Fill remaining positions in first 20 calls
  availablePositions.forEach((position) => {
    const remainingArray = Array.from(remainingNumbers);
    const randomIndex = Math.floor(Math.random() * remainingArray.length);
    const number = remainingArray[randomIndex];

    let letter;
    if (number <= 15) letter = "B";
    else if (number <= 30) letter = "I";
    else if (number <= 45) letter = "N";
    else if (number <= 60) letter = "G";
    else letter = "O";

    first20Calls[position] = `${letter}${number}`;
    remainingNumbers.delete(number);
  });

  // 7. Create final called numbers array
  const remainingCalls = Array.from(remainingNumbers).map((number) => {
    let letter;
    if (number <= 15) letter = "B";
    else if (number <= 30) letter = "I";
    else if (number <= 45) letter = "N";
    else if (number <= 60) letter = "G";
    else letter = "O";
    return `${letter}${number}`;
  });

  // Shuffle remaining calls if shuffle parameter is true
  if (shuffle) {
    for (let i = remainingCalls.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remainingCalls[i], remainingCalls[j]] = [
        remainingCalls[j],
        remainingCalls[i],
      ];
    }
  }

  // Combine first 20 calls with remaining calls
  const finalCalledNumbers = [...first20Calls, ...remainingCalls];

  return finalCalledNumbers;
}

app.post('/api/game/isWinner/:gameId/:cardNumber', async (req, res) => {
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

function checkWinningCard(cardNumbers, calledNumbers, winningPattern) {
  console.log(`Checking winning pattern: ${winningPattern}`);
  console.log('Card numbers:', JSON.stringify(cardNumbers, null, 2));
  console.log('Called numbers:', calledNumbers);
  switch (winningPattern) {
    case 'All':
      return checkAllPatterns(cardNumbers, calledNumbers);
    case 'FullHouse':
      return checkFullHouse(cardNumbers, calledNumbers) ? ['FullHouse'] : false;
    case 'LShape':
      return checkLShape(cardNumbers, calledNumbers) ? ['LShape'] : false;
    case 'BothDiagonal':
      return checkBothDiagonals(cardNumbers, calledNumbers)
        ? ['BothDiagonal']
        : false;
    case 'OneDiagonal':
      const result = checkOneDiagonal(cardNumbers, calledNumbers);
      return result.isWinner
        ? { pattern: 'OneDiagonal', diagonal: result.diagonal }
        : false;

    case 'OneColumn':
      return checkOneColumn(cardNumbers, calledNumbers) ? ['OneColumn'] : false;
    case 'OneRow':
      return checkOneRow(cardNumbers, calledNumbers) ? ['OneRow'] : false;
    case 'Corner':
      return checkCorners(cardNumbers, calledNumbers) ? ['Corner'] : false;
    default:
      console.warn(`Unknown winning pattern: ${winningPattern}`);
      return false;
  }
}

function isCalled(num, letter, calledNumbers) {
  return calledNumbers.includes(`${letter}${num}`) || num === 'FREE';
}

function checkAllPatterns(cardNumbers, calledNumbers) {
  console.log('Checking all patterns');
  const patterns = [];
  // Check OneColumn
  const oneColumnResult = checkOneColumn(cardNumbers, calledNumbers);
  console.log('OneColumn result:', oneColumnResult);
  if (oneColumnResult) patterns.push('OneColumn');

  // Check OneRow
  const oneRowResult = checkOneRow(cardNumbers, calledNumbers);
  console.log('OneRow result:', oneRowResult);
  if (oneRowResult) patterns.push('OneRow');

  // Check OneDiagonal
  const diagonalResult = checkOneDiagonal(cardNumbers, calledNumbers);
  console.log('OneDiagonal result:', diagonalResult);
  if (diagonalResult.isWinner) patterns.push('OneDiagonal');

  // Check Corners
  const cornersResult = checkCorners(cardNumbers, calledNumbers);
  console.log('Corners result:', cornersResult);
  if (cornersResult) patterns.push('Corner');

  // Check SurroundingCenter
  const surroundingCenterResult = checkSurroundingCenter(
    cardNumbers,
    calledNumbers
  );
  console.log('SurroundingCenter result:', surroundingCenterResult);
  if (surroundingCenterResult) patterns.push('SurroundingCenter');

  // Check FullHouse
  const fullHouseResult = checkFullHouse(cardNumbers, calledNumbers);
  console.log('FullHouse result:', fullHouseResult);
  if (fullHouseResult) patterns.push('FullHouse');

  // Check LShape
  const lShapeResult = checkLShape(cardNumbers, calledNumbers);
  console.log('LShape result:', lShapeResult);
  if (lShapeResult) patterns.push('LShape');

  // Check BothDiagonals
  const bothDiagonalsResult = checkBothDiagonals(cardNumbers, calledNumbers);
  console.log('BothDiagonals result:', bothDiagonalsResult);
  if (bothDiagonalsResult) patterns.push('BothDiagonal');

  console.log('All patterns result:', patterns);
  return patterns;
}

function checkFullHouse(cardNumbers, calledNumbers) {
  console.log('Checking full house');
  return ['B', 'I', 'N', 'G', 'O'].every((column) =>
    cardNumbers[column].every((num) => isCalled(num, column, calledNumbers))
  );
}

function checkLShape(cardNumbers, calledNumbers) {
  const firstColumn = cardNumbers['B'].every((num) =>
    isCalled(num, 'B', calledNumbers)
  );
  const lastRow = ['B', 'I', 'N', 'G', 'O'].every((column) =>
    isCalled(cardNumbers[column][4], column, calledNumbers)
  );
  console.log(`First column: ${firstColumn}, Last row: ${lastRow}`);
  return firstColumn && lastRow;
}

function checkBothDiagonals(cardNumbers, calledNumbers) {
  const firstDiag = ['B0', 'I1', 'N2', 'G3', 'O4'].every((cell) => {
    const isCalled =
      calledNumbers.includes(
        `${cell[0]}${cardNumbers[cell[0]][parseInt(cell[1])]}`
      ) || cardNumbers[cell[0]][parseInt(cell[1])] === 'FREE';
    console.log(`Checking first diagonal cell ${cell}: ${isCalled}`);
    return isCalled;
  });
  const secondDiag = ['O0', 'G1', 'N2', 'I3', 'B4'].every((cell) => {
    const isCalled =
      calledNumbers.includes(
        `${cell[0]}${cardNumbers[cell[0]][parseInt(cell[1])]}`
      ) || cardNumbers[cell[0]][parseInt(cell[1])] === 'FREE';
    console.log(`Checking second diagonal cell ${cell}: ${isCalled}`);
    return isCalled;
  });
  console.log(
    `First diagonal complete: ${firstDiag}, Second diagonal complete: ${secondDiag}`
  );
  return firstDiag && secondDiag;
}

function checkCorners(cardNumbers, calledNumbers) {
  return ['B0', 'B4', 'O0', 'O4'].every((cell) =>
    isCalled(cardNumbers[cell[0]][parseInt(cell[1])], cell[0], calledNumbers)
  );
}

function checkSurroundingCenter(cardNumbers, calledNumbers) {
  return ['I1', 'I3', 'G1', 'G3'].every((cell) =>
    isCalled(cardNumbers[cell[0]][parseInt(cell[1])], cell[0], calledNumbers)
  );
}

function checkOneDiagonal(cardNumbers, calledNumbers) {
  const firstDiag = ['B0', 'I1', 'N2', 'G3', 'O4'].every((cell) =>
    isCalled(cardNumbers[cell[0]][parseInt(cell[1])], cell[0], calledNumbers)
  );
  const secondDiag = ['O0', 'G1', 'N2', 'I3', 'B4'].every((cell) =>
    isCalled(cardNumbers[cell[0]][parseInt(cell[1])], cell[0], calledNumbers)
  );
  console.log(
    `First diagonal complete: ${firstDiag}, Second diagonal complete: ${secondDiag}`
  );
  if (firstDiag) {
    return { isWinner: true, diagonal: 'first' };
  } else if (secondDiag) {
    return { isWinner: true, diagonal: 'second' };
  }
  return { isWinner: false, diagonal: null };
}

function checkOneColumn(cardNumbers, calledNumbers) {
  const result = ['B', 'I', 'N', 'G', 'O'].some((column) =>
    cardNumbers[column].every((num) => isCalled(num, column, calledNumbers))
  );
  console.log(`One column complete: ${result}`);
  return result;
}

function checkOneRow(cardNumbers, calledNumbers) {
  for (let i = 0; i < 5; i++) {
    if (
      ['B', 'I', 'N', 'G', 'O'].every((column) =>
        isCalled(cardNumbers[column][i], column, calledNumbers)
      )
    ) {
      console.log(`Row ${i + 1} complete`);
      return true;
    }
  }
  console.log('No complete rows');
  return false;
}

app.post('/api/game/:gameId/end', verifyToken, async (req, res) => {
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

// Update the admin signup endpoint
app.post(
  '/api/admin/signup/protected/hope',
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
    await addNotification(
      newAdmin._id,
      `New admin registered: ${username}`,
      'info'
    );

    res
      .status(201)
      .json({ message: 'User registered successfully', role: newAdmin.role });
  }
);

app.get('/api/admin/list/:subadminId', verifyToken, async (req, res) => {
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

// Fetch all admins
app.get('/api/admin/hope/all/protected', verifyToken, async (req, res) => {
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

    // Add ongoing profits to admin data
    const adminsWithOngoingProfits = admins.map((admin) => {
      const adminData = admin.toObject();
      adminData.ongoingProfit = adminOngoingProfits[admin._id.toString()] || 0;

      // Update statsByPeriod to include ongoing profits
      adminData.statsByPeriod = adminData.statsByPeriod.map((stat) => ({
        ...stat,
        totalProfit:
          stat.profit + (adminOngoingProfits[admin._id.toString()] || 0),
      }));

      return adminData;
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

// Endpoint to activate unlimited wallet
app.post(
  '/api/admin/:adminId/unlimited-wallet',
  verifyToken,
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

// Scheduled task to deactivate expired unlimited wallets
cron.schedule('0 0 * * *', async () => {
  try {
    const now = new Date();
    const expiredAdmins = await Admin.find({
      'unlimitedWallet.active': true,
      'unlimitedWallet.expiresAt': { $lte: now },
    });

    for (const admin of expiredAdmins) {
      admin.unlimitedWallet.active = false;
      await admin.save();
      console.log(`Deactivated unlimited wallet for admin: ${admin.username}`);
    }
  } catch (error) {
    console.error(
      'Error in scheduled task for deactivating unlimited wallets:',
      error
    );
  }
});

app.post(
  '/api/admin/:adminId/deactivate-unlimited-wallet',
  verifyToken,
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

app.get('/api/admin/dashboard-metrics', verifyToken, async (req, res) => {
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

// Update admin wallet
app.put('/api/admin/:adminId/wallet', async (req, res) => {
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

    // Add notification
    await addNotification(
      admin._id,
      `Wallet updated (${transactionType}): ${oldWallet} -> ${admin.wallet}`,
      'info'
    );

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

// Update subadmin wallet and it's admins wallet
app.put('/api/subadmin/:adminId/wallet', verifyToken, async (req, res) => {
  const { adminId } = req.params;
  const { wallet, amount } = req.body;
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
        monthlyBonus.walletTopUp += parseFloat(amount);
        await monthlyBonus.save();
      }
    }

    // Add notification
    await addNotification(
      admin._id,
      `Wallet updated: ${oldWallet} -> ${admin.wallet}`,
      'info'
    );

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

// Block/Unblock admin
app.post('/api/admin/:adminId/:action', async (req, res) => {
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

app.post(
  '/api/admin/:adminId/reverse-deposit/:transactionId',
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

      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
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

app.get(
  '/api/admin/:adminId/recent-deposits',
  verifyToken,
  async (req, res) => {
    try {
      const { adminId } = req.params;
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

      const recentDeposits = await Transaction.find({
        adminId: adminId,
        type: 'deposit',
        date: { $gte: threeDaysAgo },
      })
        .sort({ date: -1 })
        .limit(10); // Fetch last 10 deposits within 3 days

      res.json(recentDeposits);
    } catch (error) {
      console.error('Error fetching recent deposits:', error);
      res.status(500).json({ message: 'Failed to fetch recent deposits' });
    }
  }
);

// Change admin password
app.post('/api/admin/change-password', async (req, res) => {
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

// Endpoint to fetch admin stats

app.get('/api/admin/stats', verifyToken, async (req, res) => {
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

app.get('/api/admin/myGames', verifyToken, async (req, res) => {
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
    console.log('Calculated Admin Rank:', adminRank); // Add this log
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

app.get('/api/admin/exportGames', verifyToken, async (req, res) => {
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

app.get('/api/admin/transactions', verifyToken, async (req, res) => {
  try {
    console.log('Fetching transactions...');
    const transactions = await Transaction.find()
      .sort({ date: -1 })
      .limit(200)
      .populate('adminId', 'username');

    console.log('Raw transactions:', transactions.length);

    const formattedTransactions = transactions.map((transaction) => ({
      _id: transaction._id,
      date: transaction.date,
      admin: transaction.adminId ? transaction.adminId.username : 'Unknown',
      toAdmin: transaction.toAdmin ? transaction.toAdmin.username : 'N/A',
      amount: transaction.amount,
      type: transaction.type,
      description: transaction.description,
    }));

    console.log('Formatted transactions:', formattedTransactions.length);
    res.json(formattedTransactions);
  } catch (error) {
    console.error('Error fetching recent transactions:', error);
    res.status(500).json({
      message: 'An error occurred while fetching recent transactions',
      error: error.message,
    });
  }
});

// GET /api/admin/:adminId/last-games
app.get('/api/admin/:adminId/last-games', verifyToken, async (req, res) => {
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
      profitPercentage: game.profitPercentage, // new line
      status: game.status,
    }));

    res.json(formattedGames);
  } catch (error) {
    console.error('Error fetching last 10 games:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.get('/api/admin/last-games', verifyToken, async (req, res) => {
  try {
    console.log('Fetching last games for all admins');

    // Fetch all admins except the main admin (assuming main admin has a specific username)
    const subAdmins = await Admin.find({
      username: { $ne: 'main_admin_username' },
    });

    let allGames = [];

    for (let admin of subAdmins) {
      const adminGames = await Game.find({ adminId: admin._id })
        .sort({ createdAt: -1 })
        .limit(50) // Adjust this number as needed
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
// Fetch last 30 days profits
app.get('/api/admin/profits', verifyToken, async (req, res) => {
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

// Business Analytics Endpoint
app.get('/api/admin/business-analytics', verifyToken, async (req, res) => {
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

      // Add this calculation for total deposits
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

// Helper function to calculate monthly trend
function calculateMonthlyTrend(analytics) {
  const monthlyData = {};

  analytics.forEach((transaction) => {
    const date = new Date(transaction.date);
    const monthYear = `${date.getMonth() + 1}/${date.getFullYear()}`;

    if (!monthlyData[monthYear]) {
      monthlyData[monthYear] = {
        month: monthYear,
        profit: 0,
        transactions: 0,
      };
    }

    monthlyData[monthYear].profit += transaction.profitGenerated;
    monthlyData[monthYear].transactions += 1;
  });

  // Convert to array and sort by date
  return Object.values(monthlyData)
    .sort((a, b) => {
      const [aMonth, aYear] = a.month.split('/');
      const [bMonth, bYear] = b.month.split('/');
      return new Date(aYear, aMonth - 1) - new Date(bYear, bMonth - 1);
    })
    .slice(-12); // Last 12 months
}

//  endpoint to get checked tickets
app.get('/api/tickets/checked', async (req, res) => {
  try {
    const checkedTickets = await Ticket.find({ isChecked: true })
      .sort({ updatedAt: -1 }) // Sort by most recently checked
      .limit(100); // Limit to last 100 checked tickets

    res.json({ tickets: checkedTickets });
  } catch (error) {
    console.error('Error fetching checked tickets:', error);
    res.status(500).json({
      message: 'Error fetching checked tickets',
      error: error.message,
    });
  }
});

// Add this new endpoint
app.post('/api/admin/verify-password', async (req, res) => {
  const { password } = req.body;
  const correctPassword = process.env.ADMIN_PASSWORD; // Store this in your .env file

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

app.delete('/api/admin/:id', verifyToken, async (req, res) => {
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

// Add this new endpoint
app.put(
  '/api/admin/:adminId/toggle-profit-option',
  verifyToken,
  async (req, res) => {
    try {
      const { adminId } = req.params;
      const { allowProfitOption } = req.body;

      // Find the admin and update the allowProfitOption field
      const updatedAdmin = await Admin.findByIdAndUpdate(
        adminId,
        { allowProfitOption },
        { new: true } // This option returns the updated document
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

// Add this endpoint to fetch the profit option status for a specific admin
app.get('/api/admin/profit-option-status', verifyToken, async (req, res) => {
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

app.get(
  '/api/admin/:userId/spin-wheel-access',
  verifyToken,
  async (req, res) => {
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
        spinWheelEnabled: admin.spinWheelEnabled || false,
        message: `Spin wheel is ${
          admin.spinWheelEnabled ? 'enabled' : 'disabled'
        } for this admin`,
      });
    } catch (error) {
      console.error('Error checking spin wheel access:', error);
      res.status(500).json({
        success: false,
        message: 'Error checking access',
      });
    }
  }
);

app.post('/api/admin/billboard', verifyToken, async (req, res) => {
  console.log('Billboard update request received');
  console.log('Request body:', req.body);
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

    console.log('Billboard update result:', result);

    if (result.modifiedCount > 0) {
      console.log('Billboard updated successfully for all admins');
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

app.get('/api/admin/billboard', async (req, res) => {
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

// last update

app.post('/api/admin/verify-sub-admin', async (req, res) => {
  const { password } = req.body;
  const correctPassword = process.env.SUB_ADMIN_PASSWORD; // Store this in your .env file

  if (password === correctPassword) {
    // Generate a token
    const token = jwt.sign(
      { username: 'admin' }, // You can use a generic admin username
      process.env.JWT_SECRET,
      { expiresIn: '1h' } // Token expires in 1 hour
    );
    res.json({ success: true, token });
  } else {
    res.json({ success: false });
  }
});

app.post('/api/game/:gameId/recordWinner', verifyToken, async (req, res) => {
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

app.post(
  '/api/admin/:adminId/unlimited-wallet',
  verifyToken,
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

app.get('/api/bonus/participation-status', verifyToken, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id).populate('monthlyBonus');
    const isParticipating = !!admin.monthlyBonus;
    res.json({ isParticipating });
  } catch (error) {
    console.error('Error checking participation status:', error);
    res.status(500).json({ message: 'Error checking participation status' });
  }
});

app.post('/api/bonus/toggle-participation', verifyToken, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id).populate('monthlyBonus');
    const bonusConfig = await BonusConfig.findOne();

    if (!bonusConfig || !bonusConfig.active) {
      return res
        .status(400)
        .json({ message: 'Bonus system is currently inactive' });
    }

    if (admin.monthlyBonus) {
      // Leave the contest
      await Bonus.findByIdAndDelete(admin.monthlyBonus._id);
      admin.monthlyBonus = null;
      await admin.save();
      res.json({
        isParticipating: false,
        message: 'You have left the bonus contest',
      });
    } else {
      // Join the contest
      const currentDate = new Date();
      const monthStartDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
      );
      const monthEndDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        0
      );

      const newMonthlyBonus = new Bonus({
        adminId: admin._id,
        type: 'monthly',
        startDate: monthStartDate,
        endDate: monthEndDate,
        walletTopUp: 0,
        gamesPlayed: 0,
      });

      await newMonthlyBonus.save();
      admin.monthlyBonus = newMonthlyBonus._id;
      await admin.save();
      res.json({
        isParticipating: true,
        message: 'You have joined the bonus contest',
      });
    }
  } catch (error) {
    console.error('Error toggling participation:', error);
    res.status(500).json({ message: 'Error toggling participation' });
  }
});

// Scheduled job to fetch and broadcast notifications
const scheduledNotification = async () => {
  try {
    // Fetch today's profit
    const today = new Date().toISOString().split('T')[0];
    const todaysProfits = await Game.aggregate([
      { $match: { createdAt: { $gte: new Date(today) } } },
      { $group: { _id: null, totalProfit: { $sum: '$profit' } } },
    ]);
    const totalProfit =
      todaysProfits.length > 0 ? todaysProfits[0].totalProfit : 0;

    const admins = await Admin.find({});
    for (const admin of admins) {
      await addNotification(
        admin._id,
        `Today's total profit: ${totalProfit}`,
        'info'
      );
    }

    // ... other scheduled notifications ...
  } catch (error) {
    console.error('Error in scheduled notification:', error);
  }
};
// Schedule the job to run three times a day
schedule.scheduleJob('0 7,15,23 * * *', scheduledNotification);

app.post('/api/admin/bonus-system', verifyToken, async (req, res) => {
  try {
    const { active, rewards, rules, startDate, endDate } = req.body;

    let bonusConfig = await BonusConfig.findOne();
    if (!bonusConfig) {
      bonusConfig = new BonusConfig();
    }

    bonusConfig.active = active;
    bonusConfig.rewards = rewards;
    bonusConfig.rules = rules;

    if (startDate) bonusConfig.startDate = new Date(startDate);
    if (endDate) bonusConfig.endDate = new Date(endDate);

    await bonusConfig.save();

    res.json({
      success: true,
      message: 'Bonus system updated successfully',
      config: bonusConfig,
    });
  } catch (error) {
    console.error('Error updating bonus system:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update bonus system',
      error: error.message,
    });
  }
});

app.get('/api/admin/bonus-system', verifyToken, async (req, res) => {
  try {
    let bonusConfig = await BonusConfig.findOne();
    if (!bonusConfig) {
      bonusConfig = new BonusConfig();
      await bonusConfig.save();
    }
    res.json({
      success: true,
      config: {
        active: bonusConfig.active,
        rewards: bonusConfig.rewards,
        rules: bonusConfig.rules,
        startDate: bonusConfig.startDate,
        endDate: bonusConfig.endDate,
      },
    });
  } catch (error) {
    console.error('Error fetching bonus system config:', error);
    res
      .status(500)
      .json({ success: false, message: 'Failed to fetch bonus system config' });
  }
});

// Run daily at midnight
cron.schedule('0 0 * * *', async () => {
  try {
    const bonusConfig = await BonusConfig.findOne();
    if (!bonusConfig || !bonusConfig.active) {
      console.log('Bonus system is not active. Skipping reward distribution.');
      return;
    }

    const currentDate = new Date();

    // Check if the current bonus period has ended
    if (bonusConfig.endDate && currentDate >= bonusConfig.endDate) {
      const topPerformers = await Bonus.find({
        type: 'monthly',
        startDate: bonusConfig.startDate,
        endDate: bonusConfig.endDate,
      })
        .sort({ walletTopUp: -1, gamesPlayed: -1 })
        .limit(2);

      for (let i = 0; i < topPerformers.length; i++) {
        const bonus = topPerformers[i];
        const rewardAmount =
          i === 0
            ? bonusConfig.rewards.monthly.first
            : bonusConfig.rewards.monthly.second;

        bonus.bonusAmount = rewardAmount;
        await bonus.save();

        const admin = await Admin.findById(bonus.adminId);
        admin.wallet += rewardAmount;
        await admin.save();

        console.log(
          `Awarded ${rewardAmount} to admin ${admin.username} for rank ${i + 1}`
        );
      }

      console.log('Bonus rewards distributed successfully');

      // Reset the bonus period
      bonusConfig.active = false;
      bonusConfig.startDate = null;
      bonusConfig.endDate = null;
      await bonusConfig.save();

      console.log('Bonus period reset');
    } else {
      console.log(
        'Current bonus period has not ended yet. Skipping reward distribution.'
      );
    }
  } catch (error) {
    console.error('Error distributing bonus rewards:', error);
  }
});

// Update the bonus update cron job

cron.schedule('0 0 * * *', async () => {
  try {
    const bonusConfig = await BonusConfig.findOne();
    if (!bonusConfig || !bonusConfig.active) {
      console.log('Bonus system is not active. Skipping update.');
      return;
    }

    const currentDate = new Date();
    const admins = await Admin.find();
    console.log(`Checking bonus periods for ${admins.length} admins`);

    for (const admin of admins) {
      let monthlyBonus = await Bonus.findOne({
        adminId: admin._id,
        type: 'monthly',
        startDate: { $lte: currentDate },
        endDate: { $gte: currentDate },
      });

      if (!monthlyBonus) {
        // Create a new monthly bonus period
        const monthStartDate = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth(),
          1
        );
        const monthEndDate = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth() + 1,
          0
        );

        monthlyBonus = new Bonus({
          adminId: admin._id,
          type: 'monthly',
          startDate: monthStartDate,
          endDate: monthEndDate,
          walletTopUp: 0,
          gamesPlayed: 0,
        });

        await monthlyBonus.save();
        admin.monthlyBonus = monthlyBonus._id;
        await admin.save();

        console.log(`Created new monthly bonus for admin ${admin.username}`);
      }
    }

    console.log('Bonus periods checked and updated successfully');
  } catch (error) {
    console.error('Error updating bonus periods:', error);
  }
});

async function calculateRank(bonus) {
  console.log('Calculating rank for bonus:', bonus);

  const bonusConfig = await BonusConfig.findOne();
  if (!bonusConfig || !bonusConfig.active) {
    console.log('Bonus system is not active');
    return null;
  }

  const currentDate = new Date();
  const startDate = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1
  );
  const endDate = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth() + 1,
    0
  );

  const count = await Bonus.countDocuments({
    type: bonus.type,
    startDate: startDate,
    endDate: endDate,
    $or: [
      { walletTopUp: { $gt: bonus.walletTopUp } },
      {
        walletTopUp: bonus.walletTopUp,
        gamesPlayed: { $gt: bonus.gamesPlayed },
      },
      {
        walletTopUp: bonus.walletTopUp,
        gamesPlayed: bonus.gamesPlayed,
        _id: { $lt: bonus._id },
      },
    ],
  });
  console.log('Count of better performing bonuses:', count);
  return count + 1;
}
// Update the bonus announcement endpoint

app.get('/api/bonus/announcement', verifyToken, async (req, res) => {
  console.log('Announcement endpoint hit');
  try {
    const admin = await Admin.findById(req.admin.id).populate('monthlyBonus');
    console.log('Admin found:', admin);

    const bonusConfig = await BonusConfig.findOne();
    console.log('Bonus config:', bonusConfig);

    if (!bonusConfig || !bonusConfig.active) {
      console.log('Bonus system is inactive');
      return res.json({
        announcement: 'The bonus system is currently inactive.',
        isParticipating: false,
      });
    }

    const currentDate = new Date();
    let announcement = '';
    let isParticipating = false;

    if (admin.monthlyBonus && admin.monthlyBonus.endDate > currentDate) {
      console.log('Monthly bonus found:', admin.monthlyBonus);
      isParticipating = true;
      const rank = await calculateRank(admin.monthlyBonus, 'monthly');
      console.log('Calculated monthly rank:', rank);

      if (rank !== null) {
        announcement = `You're currently ranked #${rank} in the monthly bonus contest!`;
      } else {
        announcement =
          "You're participating in the monthly bonus contest, but ranking is not available.";
      }
    } else {
      console.log('No active monthly bonus found for admin');
      announcement =
        "You're not currently participating in the bonus contest. Join to compete for rewards!";
    }

    console.log('Final announcement:', announcement);
    res.json({ announcement, isParticipating });
  } catch (error) {
    console.error('Error fetching bonus announcement:', error);
    res.status(500).json({ message: 'Error fetching bonus announcement' });
  }
});

// Update the leaderboard endpoint

app.get('/api/bonus/leaderboard/:type', verifyToken, async (req, res) => {
  console.log('Leaderboard endpoint hit:', req.params.type);
  try {
    const { type } = req.params;
    if (type !== 'monthly') {
      return res.status(400).json({ message: 'Invalid bonus type' });
    }

    const currentDate = new Date();
    const startDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1
    );
    const endDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() + 1,
      0
    );

    const leaderboard = await Bonus.find({
      type,
      startDate: startDate,
      endDate: endDate,
    })
      .sort({ walletTopUp: -1, gamesPlayed: -1 })
      .populate('adminId', 'username')
      .limit(10);

    // Add rank to each entry
    const leaderboardWithRanks = leaderboard.map((entry, index) => ({
      rank: index + 1,
      username: entry.adminId ? entry.adminId.username : 'Unknown',
      walletTopUp: entry.walletTopUp,
      gamesPlayed: entry.gamesPlayed,
    }));

    res.json(leaderboardWithRanks);
  } catch (error) {
    console.error('Error fetching bonus leaderboard:', error);
    res.status(500).json({ message: 'Error fetching bonus leaderboard' });
  }
});

app.get('/api/bonus/winner-announcement', verifyToken, async (req, res) => {
  try {
    const bonusConfig = await BonusConfig.findOne();
    if (!bonusConfig || !bonusConfig.active) {
      return res.json({ announcement: null });
    }

    const currentDate = new Date();
    if (bonusConfig.endDate && currentDate >= bonusConfig.endDate) {
      // Fetch the top performers
      const topPerformers = await Bonus.find({
        type: 'monthly',
        startDate: bonusConfig.startDate,
        endDate: bonusConfig.endDate,
      })
        .sort({ walletTopUp: -1, gamesPlayed: -1 })
        .limit(2)
        .populate('adminId', 'username');

      if (topPerformers.length > 0) {
        const winnerAnnouncement = `Congratulations to our top performers!
          1st Place: ${topPerformers[0].adminId.username} (Reward: $${
          bonusConfig.rewards.monthly.first
        })
          2nd Place: ${topPerformers[1]?.adminId.username || 'N/A'} (Reward: $${
          bonusConfig.rewards.monthly.second
        })`;

        return res.json({ announcement: winnerAnnouncement });
      }
    }

    res.json({ announcement: null });
  } catch (error) {
    console.error('Error fetching winner announcement:', error);
    res.status(500).json({ message: 'Error fetching winner announcement' });
  }
});
app.get('/api/bonus/status', verifyToken, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id);
    const bonusConfig = await BonusConfig.findOne();

    if (!bonusConfig || !bonusConfig.active) {
      return res.json({ active: false });
    }

    const isParticipating =
      admin.monthlyBonus && admin.monthlyBonus.endDate > new Date();

    res.json({
      active: true,
      isParticipating,
      rewards: bonusConfig.rewards.monthly,
      endDate: bonusConfig.endDate,
    });
  } catch (error) {
    console.error('Error fetching bonus status:', error);
    res.status(500).json({ message: 'Error fetching bonus status' });
  }
});
// Fetch notifications
app.get('/api/admin/notifications', verifyToken, async (req, res) => {
  try {
    const notifications = await Notification.find({
      adminId: req.admin.id,
      read: false,
    })
      .sort({ createdAt: -1 })
      .limit(10);
    res.json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: 'Error fetching notifications' });
  }
});
// Mark notifications as read
app.post('/api/admin/notifications/read', verifyToken, async (req, res) => {
  try {
    const { notificationIds } = req.body;
    await Notification.updateMany(
      { _id: { $in: notificationIds }, adminId: req.admin.id },
      { $set: { read: true } }
    );
    res.json({ message: 'Notifications marked as read' });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ message: 'Error marking notifications as read' });
  }
});
// Get notification count
app.get('/api/admin/notifications/count', verifyToken, async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      adminId: req.admin.id,
      read: false,
    });
    res.json({ count });
  } catch (error) {
    console.error('Error fetching notification count:', error);
    res.status(500).json({ message: 'Error fetching notification count' });
  }
});
// SSE endpoint for real-time notifications
app.get('/api/admin/events', verifyToken, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  eventEmitter.on('newNotification', sendEvent);

  req.on('close', () => {
    eventEmitter.off('newNotification', sendEvent);
  });
});

// Helper function to add notifications
async function addNotification(adminId, message, type = 'info') {
  try {
    const notification = new Notification({
      message,
      type,
      adminId,
    });
    await notification.save();
    eventEmitter.emit('newNotification', { adminId, message, type });
  } catch (error) {
    console.error('Error adding notification:', error);
  }
}
// Endpoint to fetch admin name and wallet balance
app.get('/api/admin/name', verifyToken, async (req, res) => {
  try {
    // Find the admin in the database using the decoded token's admin ID
    const admin = await Admin.findOne({ username: req.admin.username });

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    // Send back the admin name and wallet balance
    res.json({
      adminName: admin.username,
      walletBalance: admin.wallet,
    });
  } catch (error) {
    console.error('Error fetching admin name and wallet:', error);
    res
      .status(500)
      .json({ message: 'An error occurred while fetching admin details' });
  }
});

// Update the request-otp endpoint (around line 2954)
app.post('/api/admin/request-otp', verifyToken, async (req, res) => {
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
    console.log('Mail options configured:', mailOptions);

    // Test email configuration
    await transporter.verify();
    console.log('Email transporter verified');

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
// Simplified verify OTP endpoint
app.post('/api/admin/verify-otp', verifyToken, async (req, res) => {
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

// Update the toggle-bonus endpoint
app.put('/api/admin/:adminId/toggle-bonus', verifyToken, async (req, res) => {
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

app.get('/api/admin/:userId/bonus-status', verifyToken, async (req, res) => {
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

// Bonus Management Routes
app.post('/api/bonus/set-passcode', verifyToken, async (req, res) => {
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

app.post('/api/bonus/verify-passcode', verifyToken, async (req, res) => {
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

app.get('/api/bonus/config', verifyToken, async (req, res) => {
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

app.post('/api/bonus/config', verifyToken, async (req, res) => {
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

// Update the claim endpoint
app.post('/api/bonus/claim', verifyToken, async (req, res) => {
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

// the claim history endpoint
app.get('/api/bonus/claim-history', verifyToken, async (req, res) => {
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

// endpoint for getting game count
app.get('/api/admin/:adminId/game-count', verifyToken, async (req, res) => {
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

// Update the clean history endpoint
app.delete(
  '/api/admin/:adminId/clean-history',
  verifyToken,
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

// Endpoint to generate a free ticket
app.post('/api/tickets', async (req, res) => {
  const { betAmount, startDate, endDate, address, passcode } = req.body;

  // Check if the passcode is correct
  if (passcode !== process.env.TICKET_GENERATION_PASSCODE) {
    return res
      .status(403)
      .json({ message: 'Invalid passcode for ticket generation' });
  }

  try {
    const uniqueTicketNumber = `TICKET-${Math.floor(Math.random() * 1000000)}`;
    const newTicket = new Ticket({
      ticketNumber: uniqueTicketNumber,
      betAmount,
      startDate,
      endDate,
      address,
    });

    await newTicket.save();
    res
      .status(201)
      .json({ message: 'Ticket generated successfully', ticket: newTicket });
  } catch (error) {
    console.error('Error generating ticket:', error);
    res
      .status(500)
      .json({ message: 'Error generating ticket', error: error.message });
  }
});

// Endpoint to check the status of a ticket
app.get('/api/tickets/:ticketNumber', async (req, res) => {
  const { ticketNumber } = req.params;

  try {
    const ticket = await Ticket.findOne({ ticketNumber });

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    if (ticket.isChecked) {
      return res
        .status(400)
        .json({ message: 'Ticket has already been checked' });
    }

    // Mark the ticket as checked
    ticket.isChecked = true;
    await ticket.save();

    res.json({ message: 'Ticket is valid', ticket });
  } catch (error) {
    console.error('Error checking ticket:', error);
    res
      .status(500)
      .json({ message: 'Error checking ticket', error: error.message });
  }
});

// verifying the passcode
app.post('/api/ticket-passcode', async (req, res) => {
  const { enteredPasscode } = req.body;

  // Get the passcode from the environment variable
  const storedPasscode = process.env.TICKET_PASSCODE;

  if (!enteredPasscode) {
    return res
      .status(400)
      .json({ success: false, message: 'Passcode is required' });
  }

  // Check if the entered passcode matches the stored passcode
  if (enteredPasscode === storedPasscode) {
    return res.json({
      success: true,
      message: 'Passcode verified successfully',
    });
  } else {
    return res
      .status(403)
      .json({ success: false, message: 'Invalid passcode' });
  }
});


// Global error handler
app.use((err, req, res, next) => {
  logger.error(err.stack);
  if (err.timeout) {
    res.status(503).json({
      message: 'Request timed out',
      error: 'The server took too long to respond',
    });
  } else {
    res.status(500).json({
      message: 'An unexpected error occurred',
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server is running on port ${PORT}`);
});
