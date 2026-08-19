import { marketDataService } from '../services/marketDataService.js';
import { pivotService } from '../services/pivotService.js';
import { getDBStatus } from '../config/db.js';
import { telegramService } from '../services/telegramService.js';

export const getLiveTicker = (req, res) => {
  try {
    const market = marketDataService.getMarketData();
    const distances = pivotService.getDistances(market.price);
    res.json({
      success: true,
      data: {
        ...market,
        distances
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getKlines = (req, res) => {
  try {
    const count = parseInt(req.query.count || '100', 10);
    const klines = marketDataService.getKlines().slice(-count);
    res.json({
      success: true,
      count: klines.length,
      data: klines
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getSystemHealth = async (req, res) => {
  try {
    const market = marketDataService.getMarketData();
    const db = getDBStatus();
    const tg = await telegramService.testConnection();

    res.json({
      success: true,
      status: {
        marketFeed: {
          connected: market.connected,
          provider: market.provider,
          status: market.marketStatus,
          lastPrice: market.price
        },
        webSocket: {
          connected: marketDataService.isWsConnected
        },
        alertEngine: {
          running: true,
          monitoredLevels: pivotService.getConfig().monitoredLevels
        },
        telegram: {
          connected: tg.connected,
          botUsername: tg.botInfo?.username || 'MINITRADEZ_BOT',
          chatId: tg.chatId,
          error: tg.error
        },
        database: {
          connected: db.connected,
          host: db.host,
          isInMemory: db.isInMemory
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
