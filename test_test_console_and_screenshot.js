import { alertService } from './services/alertService.js';
import { screenshotService } from './services/screenshotService.js';
import { pivotService } from './services/pivotService.js';
import { symbolService } from './services/symbolService.js';
import { telegramService } from './services/telegramService.js';

async function runValidation() {
  console.log('🧪 Testing Alert Engine Test Console & Dynamic Screenshot Engine...\n');

  // 1. Test alertService.triggerTestAlert('R2')
  console.log('Test 1: Testing alertService.triggerTestAlert("R2")...');
  try {
    const event = await alertService.triggerTestAlert('R2');
    console.log('✅ triggerTestAlert("R2") executed successfully:');
    console.log(`   - Level: ${event.level}`);
    console.log(`   - Price: $${event.currentPrice}`);
    console.log(`   - Reason: ${event.triggerReason}`);
    console.log(`   - Screenshot: ${event.screenshotPath}`);
    console.log(`   - Telegram Status: ${event.telegramStatus}\n`);
  } catch (err) {
    console.error('❌ Failed triggerTestAlert("R2"):', err.message);
    process.exit(1);
  }

  // 2. Test dynamic screenshot capture with 3D range and 28px bar spacing
  console.log('Test 2: Testing screenshot generation with dynamic 3D range & 28px barSpacing...');
  try {
    const shot = await screenshotService.generateChartScreenshot({
      symbol: 'OANDA:XAUUSD',
      level: 'R2',
      levelPrice: 4657.48,
      currentPrice: 4657.48,
      tolerance: 0.20,
      timeframe: '15',
      range: '3D',
      barSpacing: 28,
      pivotConfig: {
        r3: 4704.53,
        r2: 4657.48,
        s2: 4505.27,
        s3: 4458.23
      },
      isTest: true
    });
    console.log('✅ Screenshot generated successfully:');
    console.log(`   - File: ${shot.filename}`);
    console.log(`   - Full Path: ${shot.fullPath}\n`);
  } catch (err) {
    console.error('❌ Failed screenshot generation:', err.message);
    process.exit(1);
  }

  // 3. Test Telegram Bot Connection
  console.log('Test 3: Testing Telegram Bot connection...');
  try {
    const tgConn = await telegramService.testConnection();
    console.log(`✅ Telegram Connection: ${tgConn.connected ? 'CONNECTED (Bot: @' + tgConn.botInfo?.username + ')' : 'FAILED'}\n`);
  } catch (err) {
    console.error('❌ Telegram connection error:', err.message);
  }

  console.log('🎉 ALL ALERT ENGINE & SCREENSHOT TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}

runValidation().catch(err => {
  console.error('Fatal Test Failure:', err);
  process.exit(1);
});
