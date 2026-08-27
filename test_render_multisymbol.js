import assert from 'assert';
import fs from 'fs';
import { screenshotService } from './services/screenshotService.js';
import { symbolService } from './services/symbolService.js';

async function testRenderMultiSymbol() {
  console.log('🧪 Testing Playwright Screenshot Rendering for XAGUSD & BTCUSD...');
  await symbolService.initialize();
  await screenshotService.initialize();

  // Test 1: Capture for XAGUSD
  console.log('\n▶️ Generating screenshot for XAGUSD (Silver)...');
  const xagShot = await screenshotService.generateChartScreenshot({
    symbol: 'TVC:SILVER',
    level: 'MANUAL',
    currentPrice: 68.28,
    levelPrice: 68.28,
    tolerance: 0.05,
    timeframe: '15',
    range: '1D',
    barSpacing: 22,
    pivotConfig: { r3: 70.67, r2: 69.82, s2: 67.08, s3: 66.24 },
    isTest: true
  });
  console.log('✓ XAGUSD Screenshot generated:', xagShot.filename, `(${Math.round(xagShot.buffer.length / 1024)} KB)`);
  assert.ok(fs.existsSync(xagShot.fullPath), 'XAGUSD file must exist on disk');

  // Test 2: Capture for BTCUSD
  console.log('\n▶️ Generating screenshot for BTCUSD (Bitcoin)...');
  const btcShot = await screenshotService.generateChartScreenshot({
    symbol: 'BINANCE:BTCUSDT',
    level: 'MANUAL',
    currentPrice: 79636.92,
    levelPrice: 79636.92,
    tolerance: 15.00,
    timeframe: '15',
    range: '1D',
    barSpacing: 22,
    pivotConfig: { r3: 80247.08, r2: 79628.61, s2: 77627.51, s3: 77009.04 },
    isTest: true
  });
  console.log('✓ BTCUSD Screenshot generated:', btcShot.filename, `(${Math.round(btcShot.buffer.length / 1024)} KB)`);
  assert.ok(fs.existsSync(btcShot.fullPath), 'BTCUSD file must exist on disk');

  console.log('\n🎉 ALL MULTI-SYMBOL PLAYWRIGHT RENDERING TESTS PASSED!');
  process.exit(0);
}

testRenderMultiSymbol().catch(err => {
  console.error('❌ Render test failed:', err);
  process.exit(1);
});
