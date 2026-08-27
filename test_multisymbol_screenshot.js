import assert from 'assert';
import { screenshotService } from './services/screenshotService.js';
import { symbolService } from './services/symbolService.js';

async function testMultiSymbolScreenshots() {
  console.log('====================================================');
  console.log('🧪 TESTING MULTI-SYMBOL CANDLE & SCREENSHOT ENGINE');
  console.log('====================================================\n');

  await symbolService.initialize();

  // Test 1: Fetch Candlesticks for BTCUSD
  console.log('▶️ Test 1: Fetching session candles for BTCUSD...');
  const btcCandles = await screenshotService.fetchCandlesForSession('BTCUSD', '15', '1D', 79636.00);
  console.log(`✓ BTCUSD candles received: ${btcCandles ? btcCandles.length : 0} bars.`);
  assert.ok(btcCandles && btcCandles.length > 0, 'BTCUSD should return candles');
  const btcLast = btcCandles[btcCandles.length - 1];
  console.log(`  Sample BTC candle price: High=${btcLast.high}, Low=${btcLast.low}, Close=${btcLast.close}`);
  assert.ok(btcLast.close > 10000, `BTC price must be in tens of thousands, not Gold price: ${btcLast.close}`);

  // Test 2: Fetch Candlesticks for XAGUSD (Silver)
  console.log('\n▶️ Test 2: Fetching session candles for XAGUSD (Silver)...');
  const xagCandles = await screenshotService.fetchCandlesForSession('XAGUSD', '15', '1D', 68.28);
  console.log(`✓ XAGUSD candles received: ${xagCandles ? xagCandles.length : 0} bars.`);
  assert.ok(xagCandles && xagCandles.length > 0, 'XAGUSD should return candles');
  const xagLast = xagCandles[xagCandles.length - 1];
  console.log(`  Sample Silver candle price: High=${xagLast.high}, Low=${xagLast.low}, Close=${xagLast.close}`);
  assert.ok(xagLast.close < 200, `Silver price must be around double digits, not Gold price: ${xagLast.close}`);

  // Test 3: Fetch Candlesticks for EURUSD (Forex)
  console.log('\n▶️ Test 3: Fetching session candles for EURUSD (Forex)...');
  const eurCandles = await screenshotService.fetchCandlesForSession('EURUSD', '15', '1D', 1.0850);
  console.log(`✓ EURUSD candles received: ${eurCandles ? eurCandles.length : 0} bars.`);
  assert.ok(eurCandles && eurCandles.length > 0, 'EURUSD should return candles');
  const eurLast = eurCandles[eurCandles.length - 1];
  console.log(`  Sample EURUSD candle price: High=${eurLast.high}, Low=${eurLast.low}, Close=${eurLast.close}`);
  assert.ok(eurLast.close < 2.0 && eurLast.close > 0.5, `EURUSD price must be around 1.0x, not Gold price: ${eurLast.close}`);

  // Test 4: Fetch Candlesticks for XAUUSD (Gold)
  console.log('\n▶️ Test 4: Fetching session candles for XAUUSD (Gold)...');
  const xauCandles = await screenshotService.fetchCandlesForSession('XAUUSD', '15', '1D', 4480.00);
  console.log(`✓ XAUUSD candles received: ${xauCandles ? xauCandles.length : 0} bars.`);
  assert.ok(xauCandles && xauCandles.length > 0, 'XAUUSD should return candles');
  const xauLast = xauCandles[xauCandles.length - 1];
  console.log(`  Sample Gold candle price: High=${xauLast.high}, Low=${xauLast.low}, Close=${xauLast.close}`);
  assert.ok(xauLast.close > 2000, `Gold price must be in thousands: ${xauLast.close}`);

  console.log('\n====================================================');
  console.log('🎉 ALL MULTI-SYMBOL CANDLE TESTS PASSED 100%!');
  console.log('====================================================');
}

testMultiSymbolScreenshots().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
