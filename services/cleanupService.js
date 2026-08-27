import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { MarketEvent } from '../models/MarketEvent.js';
import { PivotState } from '../models/PivotState.js';
import { MarketSnapshot } from '../models/MarketSnapshot.js';
import { cloudinaryService } from './cloudinaryService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.join(__dirname, '../public/screenshots');

class CleanupService {
  constructor() {
    this.cleanupTimer = null;
    this.isCleaning = false;
  }

  /**
   * Initializes automatic 5-day cleanup worker
   */
  initialize(intervalHours = 6) {
    logger.info(`🧹 Initializing Automated 5-Day Data & Screenshot Cleanup Worker (Check Interval: ${intervalHours}h)...`);

    // Run initial cleanup 10 seconds after server startup
    setTimeout(() => {
      this.run5DayCleanup().catch(err => {
        logger.warn(`Startup 5-day cleanup notice: ${err.message}`);
      });
    }, 10000);

    // Schedule periodic recurring cleanup
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = setInterval(() => {
      this.run5DayCleanup().catch(err => {
        logger.error(`Periodic 5-day cleanup failed: ${err.message}`);
      });
    }, intervalHours * 60 * 60 * 1000);
  }

  /**
   * Core 5-Day Cleanup Pipeline:
   * 1. Deletes screenshots from Cloudinary older than 5 days
   * 2. Deletes expired MarketEvents, MarketSnapshots, and HISTORICAL PivotStates from MongoDB
   * 3. Deletes local disk screenshot PNGs older than 5 days
   */
  async run5DayCleanup(maxAgeDays = 5) {
    if (this.isCleaning) return { status: 'ALREADY_RUNNING' };
    this.isCleaning = true;

    const startTime = Date.now();
    const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const cutoffIso = cutoffDate.toISOString();

    logger.info(`=======================================================`);
    logger.info(`  🧹 AUTOMATED 5-DAY RETENTION CLEANUP RUNNING`);
    logger.info(`  Cutoff Date:   ${cutoffIso} (${maxAgeDays} days retention)`);
    logger.info(`=======================================================`);

    let mongoEventsDeleted = 0;
    let mongoSnapshotsDeleted = 0;
    let mongoPivotStatesDeleted = 0;
    let localFilesDeleted = 0;
    let cloudinaryDeleted = 0;

    try {
      // 1. Clean MongoDB Stale Data
      if (mongoose.connection.readyState === 1) {
        try {
          // Find old MarketEvents to identify any associated Cloudinary assets
          const oldEvents = await MarketEvent.find({ timestamp: { $lt: cutoffDate } }).lean();
          for (const ev of oldEvents) {
            if (ev.screenshotPath && ev.screenshotPath.includes('cloudinary.com')) {
              try {
                await cloudinaryService.deleteScreenshot(ev.screenshotPath);
              } catch (_) {}
            }
          }

          // Delete old MarketEvents
          const evRes = await MarketEvent.deleteMany({ timestamp: { $lt: cutoffDate } });
          mongoEventsDeleted = evRes.deletedCount || 0;

          // Delete old MarketSnapshots
          try {
            const snapRes = await MarketSnapshot.deleteMany({ timestamp: { $lt: cutoffDate } });
            mongoSnapshotsDeleted = snapRes.deletedCount || 0;
          } catch (_) {}

          // Delete old HISTORICAL PivotStates (keeps active period intact)
          const pivRes = await PivotState.deleteMany({
            status: 'HISTORICAL',
            calculatedAt: { $lt: cutoffDate }
          });
          mongoPivotStatesDeleted = pivRes.deletedCount || 0;

          logger.info(`🗑️ MongoDB Cleanup: Removed ${mongoEventsDeleted} old market events, ${mongoSnapshotsDeleted} snapshots, and ${mongoPivotStatesDeleted} historical pivot states.`);
        } catch (dbErr) {
          logger.warn(`MongoDB cleanup warning: ${dbErr.message}`);
        }
      }

      // 2. Clean Cloudinary Screenshots Older Than 5 Days
      if (cloudinaryService.isAvailable()) {
        try {
          const cldRes = await cloudinaryService.deleteScreenshotsOlderThan(maxAgeDays);
          cloudinaryDeleted = cldRes.deleted || 0;
        } catch (cldErr) {
          logger.warn(`Cloudinary cleanup warning: ${cldErr.message}`);
        }
      }

      // 3. Clean Local Screenshots on Disk Older Than 5 Days
      if (fs.existsSync(SCREENSHOTS_DIR)) {
        try {
          const files = fs.readdirSync(SCREENSHOTS_DIR);
          for (const file of files) {
            if (file === '.gitkeep') continue;
            const fullPath = path.join(SCREENSHOTS_DIR, file);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.mtime.getTime() < cutoffDate.getTime()) {
                fs.unlinkSync(fullPath);
                localFilesDeleted++;
              }
            } catch (_) {}
          }
          logger.info(`🗑️ Disk Cleanup: Removed ${localFilesDeleted} local screenshot files older than ${maxAgeDays} days.`);
        } catch (fsErr) {
          logger.warn(`Local screenshots disk cleanup warning: ${fsErr.message}`);
        }
      }

      const durationMs = Date.now() - startTime;
      logger.info(`=======================================================`);
      logger.info(`  ✅ 5-DAY CLEANUP FINISHED (${durationMs}ms)`);
      logger.info(`  MongoDB Events Removed:      ${mongoEventsDeleted}`);
      logger.info(`  MongoDB Historical Pivots:   ${mongoPivotStatesDeleted}`);
      logger.info(`  Cloudinary Images Purged:    ${cloudinaryDeleted}`);
      logger.info(`  Local Screenshots Removed:   ${localFilesDeleted}`);
      logger.info(`=======================================================`);

      return {
        success: true,
        maxAgeDays,
        cutoffDate: cutoffIso,
        mongoEventsDeleted,
        mongoSnapshotsDeleted,
        mongoPivotStatesDeleted,
        cloudinaryDeleted,
        localFilesDeleted,
        durationMs
      };
    } catch (err) {
      logger.error(`Fatal error during 5-day retention cleanup: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      this.isCleaning = false;
    }
  }

  stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

export const cleanupService = new CleanupService();
