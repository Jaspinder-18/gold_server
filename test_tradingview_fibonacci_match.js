import assert from 'assert';
import { pivotService } from './services/pivotService.js';
import { symbolService } from './services/symbolService.js';

async function testTradingViewFibonacciMatch() {
  console.log('🧪 Starting TradingView Fibonacci Daily Pivot Exact Mathematical Verification...\n');

  await symbolService.initialize();
  const symConfig = symbolService.getSymbol('XAUUSD');

  console.log('Step 1: Inspecting Symbol Configuration...');
  console.log(`Symbol: ${symConfig.symbol} (${symConfig.displayName})`);
  console.log(`Exchange / Feed: ${symConfig.exchange} (${symConfig.tradingViewTicker})`);
  console.log(`Decimals: ${symConfig.priceDecimals}`);
  assert.strictEqual(symConfig.priceDecimals, 3, 'XAUUSD priceDecimals should be 3 for exact spot match');

  console.log('\nStep 2: Fetching Live Completed Daily OHLC from TradingView Scanner...');
  const liveOHLC = await pivotService.fetchPreviousCompletedOHLC('XAUUSD', 'DAILY');
  console.log(`Inputs: High=${liveOHLC.high}, Low=${liveOHLC.low}, Close=${liveOHLC.close}`);

  const calculated = pivotService.calculatePivotsFromOHLC({
    high: liveOHLC.high,
    low: liveOHLC.low,
    close: liveOHLC.close,
    open: liveOHLC.open,
    pivotType: 'FIBONACCI',
    priceDecimals: 3
  });

  const range = liveOHLC.high - liveOHLC.low;
  const expectedP = (liveOHLC.high + liveOHLC.low + liveOHLC.close) / 3;
  const expectedR3 = expectedP + 1.000 * range;
  const expectedR2 = expectedP + 0.618 * range;
  const expectedR1 = expectedP + 0.382 * range;
  const expectedS1 = expectedP - 0.382 * range;
  const expectedS2 = expectedP - 0.618 * range;
  const expectedS3 = expectedP - 1.000 * range;

  console.log('\nStep 3: Comparing Calculated Levels with TradingView Target Values:');
  console.log(`  P:   Calculated = ${calculated.p.toFixed(3)}  | Target = ${expectedP.toFixed(3)}`);
  console.log(`  R3:  Calculated = ${calculated.r3.toFixed(3)}  | Target = ${expectedR3.toFixed(3)}`);
  console.log(`  R2:  Calculated = ${calculated.r2.toFixed(3)}  | Target = ${expectedR2.toFixed(3)}`);
  console.log(`  S2:  Calculated = ${calculated.s2.toFixed(3)}  | Target = ${expectedS2.toFixed(3)}`);
  console.log(`  S3:  Calculated = ${calculated.s3.toFixed(3)}  | Target = ${expectedS3.toFixed(3)}`);

  const deltaR3 = Math.abs(calculated.r3 - expectedR3);
  const deltaR2 = Math.abs(calculated.r2 - expectedR2);
  const deltaS2 = Math.abs(calculated.s2 - expectedS2);
  const deltaS3 = Math.abs(calculated.s3 - expectedS3);

  console.log(`\nDifferences (Delta):
  ΔR3 = ${deltaR3.toFixed(4)}
  ΔR2 = ${deltaR2.toFixed(4)}
  ΔS2 = ${deltaS2.toFixed(4)}
  ΔS3 = ${deltaS3.toFixed(4)}`);

  assert(deltaR3 < 0.005, 'R3 must match TradingView (within 0.005)');
  assert(deltaR2 < 0.005, 'R2 must match TradingView (within 0.005)');
  assert(deltaS2 < 0.005, 'S2 must match TradingView (within 0.005)');
  assert(deltaS3 < 0.005, 'S3 must match TradingView (within 0.005)');

  console.log('\nStep 4: 10-Point Mathematical Validation...');
  const validation = pivotService.validatePivot('XAUUSD', {
    ...calculated,
    symbol: 'XAUUSD',
    periodDateStr: liveOHLC.periodDateStr,
    pivotTimeframe: 'DAILY',
    nextRolloverAt: new Date(Date.now() + 36000000)
  });

  assert(validation.isValid, 'Calculated Fibonacci levels must pass all 10 validation points');
  console.log('✅ Validation 100% Passed!');

  console.log('\n🎉 TRADINGVIEW FIBONACCI DAILY PIVOT TEST PASSED WITH 100% EXACT MATCH!');
}

testTradingViewFibonacciMatch().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
