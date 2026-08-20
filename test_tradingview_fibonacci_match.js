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

  console.log('\nStep 2: Feeding TradingView Completed Daily OHLC...');
  const tvOHLC = {
    high: 4557.02,
    low: 4357.36,
    close: 4457.69,
    open: 4430.50
  };
  console.log(`Inputs: High=${tvOHLC.high}, Low=${tvOHLC.low}, Close=${tvOHLC.close}`);

  const calculated = pivotService.calculatePivotsFromOHLC({
    high: tvOHLC.high,
    low: tvOHLC.low,
    close: tvOHLC.close,
    open: tvOHLC.open,
    pivotType: 'FIBONACCI',
    priceDecimals: 3
  });

  console.log('\nStep 3: Comparing Calculated Levels with TradingView Target Values:');
  console.log(`  P:   Calculated = ${calculated.p.toFixed(3)}  | TradingView Target = 4457.357`);
  console.log(`  R3:  Calculated = ${calculated.r3.toFixed(3)}  | TradingView Target = 4657.017`);
  console.log(`  R2:  Calculated = ${calculated.r2.toFixed(3)}  | TradingView Target = 4580.747`);
  console.log(`  S2:  Calculated = ${calculated.s2.toFixed(3)}  | TradingView Target = 4333.967`);
  console.log(`  S3:  Calculated = ${calculated.s3.toFixed(3)}  | TradingView Target = 4257.697`);

  const deltaR3 = Math.abs(calculated.r3 - 4657.017);
  const deltaR2 = Math.abs(calculated.r2 - 4580.747);
  const deltaS2 = Math.abs(calculated.s2 - 4333.967);
  const deltaS3 = Math.abs(calculated.s3 - 4257.697);

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
    periodDateStr: '2026-08-19',
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
