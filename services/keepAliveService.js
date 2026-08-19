import { logger } from '../utils/logger.js';

class KeepAliveService {
  constructor() {
    this.intervalId = null;
    this.intervalMs = 13 * 60 * 1000; // Exactly 13 minutes (780,000 ms)
    this.isRunning = false;
  }

  /**
   * Resolve target ping URL using environment variable BACKEND_URL,
   * RENDER_EXTERNAL_URL (standard on Render), or fallback to local address.
   */
  getTargetUrl(port = 5001) {
    const rawUrl = process.env.BACKEND_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
    const cleanUrl = rawUrl.replace(/\/+$/, '');
    return `${cleanUrl}/api/health`;
  }

  /**
   * Execute lightweight keep-alive ping
   */
  async ping(port) {
    const url = this.getTargetUrl(port);
    try {
      logger.info(`Keep-alive request sent: ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15-second safety timeout

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Render-KeepAlive-Worker/1.0',
          'Accept': 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        logger.info(`Keep-alive response: ${response.status}`);
      } else {
        logger.warn(`Keep-alive response: ${response.status}`);
      }
    } catch (err) {
      // Log error safely without crashing or restarting the application
      logger.error(`Keep-alive request failed: ${err.message}`);
    }
  }

  /**
   * Start keep-alive scheduler
   */
  start(port = 5001) {
    if (this.isRunning) return;
    this.isRunning = true;

    const url = this.getTargetUrl(port);
    logger.info(`🕒 Keep-alive service active. Automatically pinging every 13 minutes: ${url}`);

    // Schedule automated periodic ping every 13 minutes
    this.intervalId = setInterval(() => {
      this.ping(port);
    }, this.intervalMs);

    // Initial check after 30 seconds to verify server readiness
    setTimeout(() => {
      this.ping(port);
    }, 30000);
  }

  /**
   * Stop keep-alive scheduler gracefully
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Keep-alive service stopped.');
  }
}

export const keepAliveService = new KeepAliveService();
