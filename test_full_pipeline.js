import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import { alertService } from './services/alertService.js';
import { pivotService } from './services/pivotService.js';
import { screenshotService } from './services/screenshotService.js';
import { telegramService } from './services/telegramService.js';
import { MarketEvent } from './models/MarketEvent.js';
import { logger } from './utils/logger.js';
import fs from 'fs';

async function runEndToEndVerification() {
  console.log('=== STARTING END-TO-END SYSTEM VERIFICATION ===');
  
  try {
    await connectDB();
    console.log('MongoDB connection established.');

    // 1. Initialize services
    console.log('\n[1/5] Initializing Pivot & Screenshot Engines...');
    await pivotService.initialize();
    await screenshotService.initialize();
    await alertService.initialize(null);

    const config = pivotService.getConfig();
    console.log(`Pivots Loaded -> R3: ${config.r3}, R2: ${config.r2}, S2: ${config.s2}, S3: ${config.s3}`);

    // 2. Test S2 Alert Trigger Pipeline
    console.log('\n[2/5] Testing S2 Level Touch Alert Pipeline...');
    const s2Event = await alertService.triggerAlertPipeline({
      symbol: 'XAU/USD',
      level: 'S2',
      levelPrice: config.s2,
      currentPrice: config.s2 - 0.05,
      previousPrice: config.s2 + 0.30,
      direction: 'CROSS_DOWN',
      tolerance: config.tolerance,
      triggerReason: `Gold touched S2 support at ${config.s2}. Trigger price: ${(config.s2 - 0.05).toFixed(2)}`,
      isTest: true
    });

    console.log('S2 Alert Result:', {
      id: s2Event._id,
      level: s2Event.level,
      price: s2Event.currentPrice,
      screenshotPath: s2Event.screenshotPath,
      telegramStatus: s2Event.telegramStatus
    });

    // Check screenshot file on disk
    const s2ScreenshotDiskPath = `./public${s2Event.screenshotPath}`;
    if (fs.existsSync(s2ScreenshotDiskPath)) {
      const stats = fs.statSync(s2ScreenshotDiskPath);
      console.log(`Verified S2 Screenshot file on disk: ${s2ScreenshotDiskPath} (${Math.round(stats.size / 1024)} KB)`);
    } else {
      throw new Error(`Screenshot file not found on disk: ${s2ScreenshotDiskPath}`);
    }

    // 3. Test Anti-Duplicate Protection
    console.log('\n[3/5] Testing Anti-Duplicate Level Protection...');
    const states = alertService.getAllLevelStates('XAUUSD');
    console.log('Current Level State for S2:', states.S2);
    if (states.S2.status !== 'TRIGGERED') {
      throw new Error('Expected S2 status to be TRIGGERED to prevent duplicate alerts!');
    }
    console.log('✓ Anti-duplicate lock verified (S2 is TRIGGERED). Duplicate ticks will not re-alert.');

    // Simulate price moving away by > retriggerDistance
    console.log('\n[4/5] Testing Retrigger Re-Arming Condition...');
    const newPriceAway = config.s2 + config.retriggerDistance + 0.50;
    alertService.evaluateMarketPrice({
      rawSymbol: 'XAUUSD',
      price: newPriceAway,
      previousPrice: newPriceAway - 0.10
    });
    const updatedStates = alertService.getAllLevelStates('XAUUSD');
    console.log(`Price moved to $${newPriceAway.toFixed(2)}. Updated S2 State:`, updatedStates.S2);
    if (updatedStates.S2.status !== 'PREVIOUSLY_TOUCHED' && updatedStates.S2.status !== 'READY') {
      throw new Error('Expected S2 status to transition to PREVIOUSLY_TOUCHED/READY after price moved away!');
    }
    console.log('✓ Retrigger reset verified (S2 is transition active).');


    // 4. Test R3 Alert Trigger Pipeline
    console.log('\n[5/5] Testing R3 Level Touch Alert Pipeline...');
    const r3Event = await alertService.triggerAlertPipeline({
      symbol: 'XAU/USD',
      level: 'R3',
      levelPrice: config.r3,
      currentPrice: config.r3 + 0.05,
      previousPrice: config.r3 - 0.25,
      direction: 'CROSS_UP',
      tolerance: config.tolerance,
      triggerReason: `Gold touched R3 resistance at ${config.r3}. Trigger price: ${(config.r3 + 0.05).toFixed(2)}`,
      isTest: true
    });

    console.log('R3 Alert Result:', {
      id: r3Event._id,
      level: r3Event.level,
      screenshotPath: r3Event.screenshotPath,
      telegramStatus: r3Event.telegramStatus
    });

    const totalEventsInDb = await MarketEvent.countDocuments();
    console.log(`\nTotal Market Events persisted in DB: ${totalEventsInDb}`);

    console.log('\n=== ALL END-TO-END VERIFICATION CHECKS PASSED PERFECTLY ===');
  } catch (err) {
    console.error('Verification failed with error:', err);
    process.exit(1);
  } finally {
    await screenshotService.shutdown();
    await mongoose.disconnect();
    process.exit(0);
  }
}

runEndToEndVerification();
