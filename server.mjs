import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import mongoose from "mongoose";
import Admin from "./models/Admin.js";
import helmet from "helmet";
import { Server } from "socket.io";
import http from "http";
import cron from "node-cron";
import timeout from "connect-timeout";
import paymentRoutes from "./Routes/paymentRoutes.mjs";
import depositRoutes from './Routes/depositRoutes.mjs';
import adminRoutes from "./Routes/adminRoutes.mjs";
import cardRoutes from "./Routes/cardRoutes.mjs";
import bounsRoutes from "./Routes/bonusRoutes.mjs";
import  gameRoutes from "./Routes/gameRoutes.mjs";
import subAdminRoutes from "./Routes/subAdminRoutes.mjs"
import { globalLimiter } from "./services/globalLimiter.mjs";
import { logger } from "./utils/loggerUtils.mjs";


dotenv.config();

const app = express();
const server = http.createServer(app);
const mongoURI = process.env.MONGO_URI;
const db = mongoose.connection;
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);
app.use(timeout('60s'));
app.use(haltOnTimedout);
app.use(globalLimiter);
app.options('*', cors());
function haltOnTimedout(req, res, next) {
  if (!req.timedout) next();
}


export const io = new Server(server, {
  cors: {
    origin: ['https://powerbetbingo.vercel.app', 'https://admin.arifbingo.com'],
    methods: ['GET', 'POST'],
  },
});
io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

      app.use(express.json());
      app.use(
        cors({
          origin: ['https://powerbetbingo.vercel.app', 'https://admin.arifbingo.com'],
          methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
          allowedHeaders: ['Content-Type', 'Authorization'],
        })
      );

    app.use(
      helmet({
        contentSecurityPolicy: true, 
        frameguard: { action: 'deny' },
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
        xssFilter: true,
        noSniff: true,
        ieNoOpen: true,
        referrerPolicy: { policy: 'no-referrer' },
      })
    );


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

    app.use('/api/admin', adminRoutes)
    app.use('/api/card', cardRoutes);
    app.use('/api', paymentRoutes);
    app.use('/api/deposit', depositRoutes);
    app.use('/api/game', gameRoutes);
    app.use('api/bonus', bounsRoutes);
    app.use('/api/subadmin', subAdminRoutes)

    app.get("/api/server/health", (req, res) => {
      try {
        res.status(200).json({ status: "OK", message: "Server is healthy" });
      } catch (error) {
        res.status(500).json({ status: "ERROR", message: "Server is not healthy" });
      }
    });

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