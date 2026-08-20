import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import { logger } from '../utils/logger.js';

class TelegramService {
  constructor() {
    this.reloadConfig();
    this.retryQueue = [];
    this.isProcessingQueue = false;
  }

  reloadConfig() {
    const rawToken = process.env.TELEGRAM_BOT_TOKEN || '8843421319:AAF35e2UTsekXzjClYXvppH-8BHpn0EjC8k';
    const rawChatId = process.env.TELEGRAM_CHAT_ID || '-5428923029';
    this.botToken = (rawToken || '').trim();
    this.chatId = (rawChatId || '').trim();
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  formatAlertMessage(alertData) {
    const {
      symbol = 'XAU/USD',
      level = 'R2',
      levelPrice = 4442.28,
      currentPrice = 4442.30,
      tolerance = 0.20,
      previousPrice,
      timestamp = new Date(),
      isTest = false
    } = alertData;

    const dateObj = new Date(timestamp);
    const dateFormatted = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeFormatted = dateObj.toTimeString().split(' ')[0];

    const isResistance = level.startsWith('R');
    const actionEmoji = isResistance ? '📈' : '📉';
    const levelType = isResistance ? 'resistance' : 'support';
    const alertHeader = isTest ? '🧪 [TEST] GOLD MARKET ALERT' : '🚨 GOLD MARKET ALERT';

    return `${alertHeader}

📊 <b>${symbol}</b>

🎯 <b>Level Touched:</b> <code>${level}</code>
💰 <b>Current Price:</b> <code>$${Number(currentPrice).toFixed(2)}</code>
📌 <b>${level} Level:</b> <code>$${Number(levelPrice).toFixed(2)}</code>
📐 <b>Tolerance:</b> <code>±$${Number(tolerance).toFixed(2)}</code>
${previousPrice ? `🔄 <b>Prev Price:</b> <code>$${Number(previousPrice).toFixed(2)}</code>\n` : ''}
${actionEmoji} <b>Market Action:</b>
Price has touched the <b>${level} ${levelType}</b> level.

🕐 <b>Time:</b>
${dateFormatted} | ${timeFormatted} UTC

📸 <i>Live TradingView chart screenshot attached.</i>

⚠️ <i>This is an automated market-level alert, not financial advice.</i>`;
  }

  async sendAlertNotification(alertData, screenshotBufferOrPath) {
    const message = this.formatAlertMessage(alertData);
    logger.telegram(`Sending Telegram alert for ${alertData.level} to chat ${this.chatId}...`);

    try {
      if (screenshotBufferOrPath) {
        // Send Photo with Caption
        const result = await this.sendPhoto(screenshotBufferOrPath, message);
        logger.telegram(`Telegram photo alert sent successfully! Message ID: ${result?.message_id || 'OK'}`);
        return { success: true, messageId: result?.message_id, message };
      } else {
        // Send Text Only
        const result = await this.sendMessage(message);
        logger.telegram(`Telegram text alert sent successfully!`);
        return { success: true, messageId: result?.message_id, message };
      }
    } catch (err) {
      const statusCode = err.response?.status;
      const errorMsg = err.response?.data?.description || err.message;
      
      if (statusCode === 401) {
        logger.error(`Telegram Bot Token is UNAUTHORIZED / INVALID (401). Please verify TELEGRAM_BOT_TOKEN in server/.env or botFather.`);
      } else if (statusCode === 400 || statusCode === 403) {
        logger.error(`Telegram alert delivery failed (${statusCode}): ${errorMsg}. Please check TELEGRAM_CHAT_ID.`);
      } else {
        logger.error(`Telegram alert delivery failed: ${errorMsg}`);
        // Only queue for automatic retry if network or transient/rate-limit failure
        this.queueRetry({ alertData, screenshotBufferOrPath, attempts: 1 });
      }

      return { success: false, error: errorMsg, message };
    }
  }

  async sendPhoto(photoBufferOrPath, caption = '') {
    const formData = new FormData();
    formData.append('chat_id', this.chatId);
    formData.append('caption', caption);
    formData.append('parse_mode', 'HTML');

    if (Buffer.isBuffer(photoBufferOrPath)) {
      formData.append('photo', photoBufferOrPath, { filename: 'chart-alert.png', contentType: 'image/png' });
    } else if (typeof photoBufferOrPath === 'string' && fs.existsSync(photoBufferOrPath)) {
      formData.append('photo', fs.createReadStream(photoBufferOrPath));
    } else {
      throw new Error('Invalid photo buffer or file path.');
    }

    const response = await axios.post(`${this.baseUrl}/sendPhoto`, formData, {
      headers: formData.getHeaders(),
      timeout: 10000
    });

    return response.data?.result;
  }

  async sendMessage(text) {
    const response = await axios.post(
      `${this.baseUrl}/sendMessage`,
      {
        chat_id: this.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      },
      { timeout: 8000 }
    );
    return response.data?.result;
  }

  queueRetry(item) {
    if (item.attempts <= 3) {
      this.retryQueue.push(item);
      this.processRetryQueue();
    }
  }

  async processRetryQueue() {
    if (this.isProcessingQueue || this.retryQueue.length === 0) return;
    this.isProcessingQueue = true;

    while (this.retryQueue.length > 0) {
      const item = this.retryQueue.shift();
      await new Promise(r => setTimeout(r, 4000)); // wait 4 seconds before retry
      try {
        logger.telegram(`Retrying Telegram dispatch (attempt ${item.attempts + 1})...`);
        await this.sendAlertNotification(item.alertData, item.screenshotBufferOrPath);
      } catch (e) {
        if (item.attempts < 3) {
          item.attempts += 1;
          this.retryQueue.push(item);
        }
      }
    }
    this.isProcessingQueue = false;
  }

  async testConnection() {
    try {
      const res = await axios.get(`${this.baseUrl}/getMe`, { timeout: 4000 });
      return {
        connected: !!res.data?.ok,
        botInfo: res.data?.result,
        chatId: this.chatId
      };
    } catch (err) {
      return {
        connected: false,
        error: err.response?.data?.description || err.message,
        chatId: this.chatId
      };
    }
  }
}

export const telegramService = new TelegramService();
