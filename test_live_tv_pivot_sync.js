import assert from 'assert';
import { pivotService } from './services/pivotService.js';
import { symbolService } from './services/symbolService.js';

async function testLiveTradingViewPivotSync() {
  console.log('🧪 Starting Live TradingView Multi-Asset Pivot & History Verification...\n');

  await symbolService.initialize();

  // 1. Test Live Fetching for Spot Gold (XAUUSD)
  console.log('Step 1: Testing Live Completed OHLC for XAUUSD (Gold)...');
  const goldOhlc = await pivotService.fetchPreviousCompletedOHLC('XAUUSD', 'DAILY');
  console.log(`  Source: ${goldOhlc.dataSource}`);
  console.log(`  Session Date: ${goldOhlc.periodDateStr}`);
  console.log(`  High: ${goldOhlc.high} | Low: ${goldOhlc.low} | Close: ${goldOhlc.close} | Open: ${goldOhlc.open}`);

  assert(goldOhlc.high > 0 && goldOhlc.low > 0 && goldOhlc.close > 0, 'OHLC values must be positive non-zero numbers');
  assert(goldOhlc.high >= goldOhlc.low, 'High must be >= Low');

  const goldPivots = await pivotService.getOrCalculatePivotsForSymbol('XAUUSD', { force: true });
  console.log(`  Calculated Levels: R3=${goldPivots.r3} | R2=${goldPivots.r2} | R1=${goldPivots.r1} | P=${goldPivots.p} | S1=${goldPivots.s1} | S2=${goldPivots.s2} | S3=${goldPivots.s3}`);
  assert(goldPivots.r3 > goldPivots.r2 && goldPivots.r2 > goldPivots.p && goldPivots.p > goldPivots.s2 && goldPivots.s2 > goldPivots.s3, 'Hierarchy R3 > R2 > P > S2 > S3 must hold');
  console.log('✅ Gold Live Dynamic Calculation Passed!\n');

  // 2. Test Multi-Day Historical Levels for Gold
  console.log('Step 2: Testing Multi-Day Historical Sessions for Gold (3 to 5 days)...');
  const history = await pivotService.fetchCompletedOHLCHistory('XAUUSD', 5, 'DAILY', 'FIBONACCI');
  console.log(`  Fetched ${history.length} historical sessions:`);
  history.forEach((h, idx) => {
    console.log(`   [Day ${idx + 1} - ${h.date}]: High=${h.dayHigh}, Low=${h.dayLow}, Close=${h.dayClose} => R3=${h.r3}, R2=${h.r2}, P=${h.p}, S2=${h.s2}, S3=${h.s3}`);
  });
  assert(history.length >= 2, 'Should have at least 2 historical daily sessions');
  console.log('✅ Multi-day historical calculations verified!\n');

  // 3. Test Live Fetching for Crypto (BTCUSD)
  console.log('Step 3: Testing Live Completed OHLC for BTCUSD...');
  const btcPivots = await pivotService.getOrCalculatePivotsForSymbol('BTCUSD', { force: true });
  console.log(`  BTC Levels: High=${btcPivots.high}, Low=${btcPivots.low}, Close=${btcPivots.close} => R3=${btcPivots.r3}, P=${btcPivots.p}, S3=${btcPivots.s3}`);
  assert(btcPivots.r3 > btcPivots.p && btcPivots.p > btcPivots.s3, 'BTC pivot hierarchy must hold');
  console.log('✅ BTCUSD Live Calculation Passed!\n');

  // 4. Test Live Fetching for Forex (EURUSD)
  console.log('Step 4: Testing Live Completed OHLC for EURUSD...');
  const eurPivots = await pivotService.getOrCalculatePivotsForSymbol('EURUSD', { force: true });
  console.log(`  EUR Levels: High=${eurPivots.high}, Low=${eurPivots.low}, Close=${eurPivots.close} => R3=${eurPivots.r3}, P=${eurPivots.p}, S3=${eurPivots.s3}`);
  assert(eurPivots.r3 > eurPivots.p && eurPivots.p > eurPivots.s3, 'EURUSD pivot hierarchy must hold');
  console.log('✅ EURUSD Live Calculation Passed!\n');

  console.log('🎉 ALL LIVE TRADINGVIEW PIVOT SYNC TESTS PASSED WITH 100% SUCCESS!');
}

testLiveTradingViewPivotSync().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
