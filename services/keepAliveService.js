import { logger } from '../utils/logger.js';

class KeepAliveService {
  constructor() {
    this.intervalId = null;
    this.intervalMs = 5 * 60 * 1000; // 5 minutes (prevents 15m Render free-tier idle sleep)
    this.isRunning = false;
  }

  /**
   * Resolve target ping URLs for both Backend API and Frontend Client
   */
  getTargetUrls(port = 5001) {
    const defaultBackend = 'https://gold-server-dbbq.onrender.com';
    const rawBackendUrl = process.env.BACKEND_URL || process.env.RENDER_EXTERNAL_URL || defaultBackend;
    const cleanBackend = rawBackendUrl.replace(/\/+$/, '');

    const defaultFrontend = 'https://gold-client.onrender.com';
    const rawFrontendUrl = process.env.FRONTEND_URL || defaultFrontend;
    const cleanFrontend = rawFrontendUrl.replace(/\/+$/, '');

    return [
      `${cleanBackend}/api/health`,
      cleanFrontend.startsWith('http') ? cleanFrontend : null
    ].filter(Boolean);
  }

  /**
   * Execute lightweight keep-alive ping to keep Render services awake
   */
  async ping(port) {
    const urls = this.getTargetUrls(port);
    for (const url of urls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000); // 12-second safety timeout

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Render-KeepAlive-Worker/2.0',
            'Accept': 'application/json, text/html'
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          logger.info(`⚡ Keep-alive ping OK (${response.status}): ${url}`);
        } else {
          logger.warn(`Keep-alive ping returned ${response.status}: ${url}`);
        }
      } catch (err) {
        // Log safely without interrupting server operation
        logger.warn(`Keep-alive ping notice for ${url}: ${err.message}`);
      }
    }
  }

  /**
   * Start keep-alive scheduler
   */
  start(port = 5001) {
    if (this.isRunning) return;
    this.isRunning = true;

    const urls = this.getTargetUrls(port);
    logger.info(`🕒 Keep-alive service active. Automatically pinging every 5 minutes: ${urls.join(' & ')}`);

    // Schedule automated periodic ping every 5 minutes
    this.intervalId = setInterval(() => {
      this.ping(port);
    }, this.intervalMs);

    // Initial ping after 15 seconds to establish connection
    setTimeout(() => {
      this.ping(port);
    }, 15000);
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

