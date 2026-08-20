import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { connectDB } from './config/db.js';
import { logger } from './utils/logger.js';
import { marketDataService } from './services/marketDataService.js';
import { pivotService } from './services/pivotService.js';
import { alertService } from './services/alertService.js';
import { screenshotService } from './services/screenshotService.js';
import { keepAliveService } from './services/keepAliveService.js';

// Route imports
import marketRoutes from './routes/marketRoutes.js';
import alertRoutes from './routes/alertRoutes.js';
import configRoutes from './routes/configRoutes.js';
import testRoutes from './routes/testRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Enable trust proxy for Render / Cloud reverse proxies
app.set('trust proxy', 1);

// Socket.IO Setup
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT']
  }
});

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Generated Real TradingView Chart Screenshots
app.use('/screenshots', express.static(path.join(__dirname, 'public/screenshots')));

// Rate Limiter for general endpoints
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { success: false, error: 'Too many requests, please slow down.' }
});
app.use('/api/', apiLimiter);

// API Routes
app.use('/api/market', marketRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/config', configRoutes);
app.use('/api/test', testRoutes);

// Lightweight Health Check endpoint (no DB queries or heavy processing)
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Root route & Service status
app.get('/api', (req, res) => {
  res.json({
    service: 'Gold (XAU/USD) TradingView Market Alert Engine',
    version: '1.0.0',
    status: 'ONLINE',
    screenshotEngine: screenshotService.getStatus(),
    timestamp: new Date()
  });
});

// Socket.IO Connection Handler
io.on('connection', (socket) => {
  logger.info(`Dashboard Client connected [Socket ID: ${socket.id}]`);

  // Send immediate initial state
  const market = marketDataService.getMarketData();
  const config = pivotService.getConfig();
  const distances = pivotService.getDistances(market.price);
  const states = alertService.getAlertStates();
  const screenshotStatus = screenshotService.getStatus();

  socket.emit('initial_state', {
    market,
    config,
    distances,
    alertStates: states,
    screenshotStatus
  });

  socket.on('disconnect', () => {
    // Client disconnected
  });
});

// Relay Market Ticks to Socket.IO Clients
marketDataService.on('tick', (data) => {
  const distances = pivotService.getDistances(data.price);
  io.emit('market_tick', {
    ...data,
    distances
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Unhandled Error: ${err.message}`, err.stack);
  res.status(500).json({ success: false, error: 'Internal Server Error', details: err.message });
});

// Bootstrap Server
const PORT = process.env.PORT || 5001;

const startServer = async () => {
  try {
    // 1. Connect MongoDB
    await connectDB();

    // 2. Initialize Pivot Calculation Engine
    await pivotService.initialize(io);

    // 3. Initialize Alert Service
    await alertService.initialize(io);

    // 4. Initialize Isolated Playwright TradingView Screenshot Worker
    try {
      await screenshotService.initialize();
    } catch (screenErr) {
      logger.warn(`Screenshot service init deferred: ${screenErr.message}`);
    }

    // 5. Initialize Market Data Live Feed
    await marketDataService.initialize();

    // 6. Start HTTP & WebSocket Server
    server.listen(PORT, () => {
      logger.info(`=======================================================`);
      logger.info(`  GOLD (XAU/USD) TRADINGVIEW ALERT ENGINE RUNNING      `);
      logger.info(`  HTTP Port: http://localhost:${PORT}                 `);
      logger.info(`  WebSocket: ws://localhost:${PORT}                   `);
      logger.info(`  TradingView Browser Engine: READY                   `);
      logger.info(`  Telegram Bot: Active [Chat: ${process.env.TELEGRAM_CHAT_ID}]`);
      logger.info(`=======================================================`);

      // 7. Start Automatic Keep-Alive Service (Pings /api/health every 13 minutes)
      keepAliveService.start(PORT);
    });
  } catch (err) {
    logger.error('Fatal Startup Error', err);
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Shutting down server gracefully...');
  keepAliveService.stop();
  await screenshotService.shutdown();
  server.close(() => {
    logger.info('Server closed.');
    process.exit(0);
  });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

startServer();
