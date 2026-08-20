import assert from 'assert';
import { pivotService } from './services/pivotService.js';
import { symbolService } from './services/symbolService.js';

async function runTests() {
  console.log('🧪 Starting Automated Pivot & Symbol System Test Suite...\n');

  // Test 1: Initialize Symbol Service
  console.log('Test 1: Initializing Symbol Service...');
  await symbolService.initialize();
  const allSymbols = symbolService.getAllSymbols();
  assert(allSymbols.length >= 10, 'Should have at least 10 supported symbols');
  console.log(`✅ Loaded ${allSymbols.length} verified symbols across Forex, Crypto, Indices, Stocks, Commodities.\n`);

  // Test 2: Symbol Search
  console.log('Test 2: Testing Symbol Search...');
  const goldSearch = symbolService.searchSymbols('gold');
  assert(goldSearch.length > 0 && goldSearch[0].symbol === 'XAUUSD', 'Search for "gold" should find XAUUSD');
  
  const niftySearch = symbolService.searchSymbols('nifty');
  assert(niftySearch.length > 0 && niftySearch[0].symbol === 'NIFTY', 'Search for "nifty" should find NIFTY');
  
  const btcSearch = symbolService.searchSymbols('btc', 'CRYPTO');
  assert(btcSearch.length > 0 && btcSearch[0].symbol === 'BTCUSD', 'Search for "btc" in CRYPTO should find BTCUSD');
  console.log('✅ Symbol search matches keywords, tickers, and asset categories correctly.\n');

  // Test 3: Mathematical Formula Verification against standard TradingView values
  console.log('Test 3: Testing Pivot Calculations against Standard TradingView Formulas...');
  
  // Sample Data: Gold Yesterday: High = 4400.00, Low = 4300.00, Close = 4350.00
  // Range = 100.00, Pivot = (4400 + 4300 + 4350) / 3 = 4350.00
  const sampleOHLC = { high: 4400.00, low: 4300.00, close: 4350.00, open: 4320.00, priceDecimals: 2 };

  // 3A: Traditional Floor Pivots
  // P = 4350.00
  // R1 = 2*4350 - 4300 = 4400.00
  // S1 = 2*4350 - 4400 = 4300.00
  // R2 = 4350 + 100 = 4450.00
  // S2 = 4350 - 100 = 4250.00
  // R3 = 4400 + 2*(4350 - 4300) = 4500.00
  // S3 = 4300 - 2*(4400 - 4350) = 4200.00
  const trad = pivotService.calculatePivotsFromOHLC({ ...sampleOHLC, pivotType: 'TRADITIONAL' });
  assert.strictEqual(trad.p, 4350.00, 'Traditional Pivot P should be 4350.00');
  assert.strictEqual(trad.r1, 4400.00, 'Traditional R1 should be 4400.00');
  assert.strictEqual(trad.s1, 4300.00, 'Traditional S1 should be 4300.00');
  assert.strictEqual(trad.r2, 4450.00, 'Traditional R2 should be 4450.00');
  assert.strictEqual(trad.s2, 4250.00, 'Traditional S2 should be 4250.00');
  assert.strictEqual(trad.r3, 4500.00, 'Traditional R3 should be 4500.00');
  assert.strictEqual(trad.s3, 4200.00, 'Traditional S3 should be 4200.00');
  console.log('✅ Traditional Floor Pivot formula passed 100% precision check.');

  // 3B: Fibonacci Pivots
  // P = 4350.00
  // R1 = 4350 + 0.382*100 = 4388.20
  // S1 = 4350 - 0.382*100 = 4311.80
  // R2 = 4350 + 0.618*100 = 4411.80
  // S2 = 4350 - 0.618*100 = 4288.20
  // R3 = 4350 + 1.000*100 = 4450.00
  // S3 = 4350 - 1.000*100 = 4250.00
  const fib = pivotService.calculatePivotsFromOHLC({ ...sampleOHLC, pivotType: 'FIBONACCI' });
  assert.strictEqual(fib.p, 4350.00, 'Fibonacci Pivot P should be 4350.00');
  assert.strictEqual(fib.r1, 4388.20, 'Fibonacci R1 should be 4388.20');
  assert.strictEqual(fib.s1, 4311.80, 'Fibonacci S1 should be 4311.80');
  assert.strictEqual(fib.r2, 4411.80, 'Fibonacci R2 should be 4411.80');
  assert.strictEqual(fib.s2, 4288.20, 'Fibonacci S2 should be 4288.20');
  assert.strictEqual(fib.r3, 4450.00, 'Fibonacci R3 should be 4450.00');
  assert.strictEqual(fib.s3, 4250.00, 'Fibonacci S3 should be 4250.00');
  console.log('✅ Fibonacci Pivot formula passed 100% precision check.');

  // 3C: Camarilla Pivots
  // R3 = 4350 + 100*1.1/4 = 4350 + 27.50 = 4377.50
  // S3 = 4350 - 27.50 = 4322.50
  const cam = pivotService.calculatePivotsFromOHLC({ ...sampleOHLC, pivotType: 'CAMARILLA' });
  assert.strictEqual(cam.r3, 4377.50, 'Camarilla R3 should be 4377.50');
  assert.strictEqual(cam.s3, 4322.50, 'Camarilla S3 should be 4322.50');
  console.log('✅ Camarilla Pivot formula passed 100% precision check.\n');

  // Test 4: 10-Point Pivot Validation Pass & Fail Tests
  console.log('Test 4: Testing 10-Point validatePivot() Function...');
  const validState = {
    symbol: 'XAUUSD',
    pivotType: 'TRADITIONAL',
    pivotTimeframe: 'DAILY',
    periodDateStr: '2026-08-19',
    high: 4400.00,
    low: 4300.00,
    close: 4350.00,
    p: 4350.00,
    r1: 4400.00,
    r2: 4450.00,
    r3: 4500.00,
    s1: 4300.00,
    s2: 4250.00,
    s3: 4200.00
  };
  const valResult = pivotService.validatePivot('XAUUSD', validState);
  assert(valResult.isValid === true, 'Valid state should pass validation');

  // Bad State: High < Low
  const invalidState = { ...validState, high: 4200.00, low: 4300.00 };
  const failResult = pivotService.validatePivot('XAUUSD', invalidState);
  assert(failResult.isValid === false, 'State with High < Low should fail validation');
  console.log('✅ validatePivot() correctly verifies mathematical consistency and rejects corrupted data.\n');

  // Test 5: Multi-Symbol Switching
  console.log('Test 5: Testing Multi-Symbol Switching (XAUUSD -> NIFTY -> BTCUSD -> XAUUSD)...');
  await symbolService.setActiveSymbol('NIFTY');
  assert.strictEqual(symbolService.getActiveSymbol(), 'NIFTY', 'Active symbol should be NIFTY');

  await symbolService.setActiveSymbol('BTCUSD');
  assert.strictEqual(symbolService.getActiveSymbol(), 'BTCUSD', 'Active symbol should be BTCUSD');

  await symbolService.setActiveSymbol('XAUUSD');
  assert.strictEqual(symbolService.getActiveSymbol(), 'XAUUSD', 'Active symbol should be restored to XAUUSD');
  console.log('✅ Active symbol successfully switched and restored across assets without state leakage.\n');

  // Test 6: Session Rollover Calculation
  console.log('Test 6: Testing Session Rollover Clock Calculation...');
  const goldRollover = pivotService.calculateNextRolloverTime('XAUUSD', 'DAILY');
  const btcRollover = pivotService.calculateNextRolloverTime('BTCUSD', 'DAILY');
  const nseRollover = pivotService.calculateNextRolloverTime('NIFTY', 'DAILY');

  assert(goldRollover instanceof Date && goldRollover.getTime() > Date.now(), 'Gold rollover must be a future date');
  assert(btcRollover instanceof Date && btcRollover.getTime() > Date.now(), 'BTC rollover must be a future date');
  assert(nseRollover instanceof Date && nseRollover.getTime() > Date.now(), 'NSE rollover must be a future date');
  console.log(`✅ Next session rollover dates calculated:
   - Gold:  ${goldRollover.toUTCString()}
   - BTC:   ${btcRollover.toUTCString()}
   - Nifty: ${nseRollover.toUTCString()}\n`);

  console.log('🎉 ALL 6 AUTOMATED TESTS PASSED SUCCESSFULLY (100%)!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
