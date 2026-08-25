import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

let isConnected = false;
let memoryServerInstance = null;

export const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gold_alert_db';

  try {
    mongoose.set('strictQuery', false);
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 4000,
    });
    isConnected = true;
    logger.info(`MongoDB connected to external/local instance: ${conn.connection.host}/${conn.connection.name}`);

    // Drop legacy conflicting indexes on pivotstates if present
    try {
      const collections = await conn.connection.db.listCollections({ name: 'pivotstates' }).toArray();
      if (collections.length > 0) {
        await conn.connection.db.collection('pivotstates').dropIndex('symbol_1_pivotType_1_pivotTimeframe_1').catch(() => {});
      }
    } catch (idxErr) {
      // Non-critical index maintenance
    }

    return conn;
  } catch (err) {
    logger.warn(`Could not connect to MongoDB URI (${uri}). Initializing embedded in-memory database fallback...`);
    try {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServerInstance = await MongoMemoryServer.create();
      const memUri = memoryServerInstance.getUri();
      const conn = await mongoose.connect(memUri);
      isConnected = true;
      logger.info(`MongoDB connected via In-Memory Server at: ${memUri}`);
      return conn;
    } catch (memErr) {
      logger.error('Failed to initialize MongoDB In-Memory Server', memErr);
      throw memErr;
    }
  }
};

export const getDBStatus = () => {
  return {
    connected: mongoose.connection.readyState === 1,
    state: mongoose.connection.readyState, // 0: disconnected, 1: connected, 2: connecting, 3: disconnecting
    host: mongoose.connection.host || 'embedded-memory-db',
    name: mongoose.connection.name || 'gold_alert_db',
    isInMemory: !!memoryServerInstance
  };
};
