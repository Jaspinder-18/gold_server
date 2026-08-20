import assert from 'assert';
import { alertService } from './services/alertService.js';
import { symbolService } from './services/symbolService.js';
import { pivotService } from './services/pivotService.js';

async function testTouchEngine() {
  console.log('🧪 Starting Level Touch & Anti-Duplicate Alert Debounce Test...\n');

  await symbolService.initialize();
  await symbolService.setActiveSymbol('XAUUSD');

  // Manually register pivot levels for testing:
  // S2 = 4300.00, tolerance = 0.20, retriggerDistance = 1.00
  const sym = 'XAUUSD';
  pivotService.pivotStates.set(sym, {
    symbol: sym,
    pivotType: 'TRADITIONAL',
    pivotTimeframe: 'DAILY',
    p: 4350.00,
    r3: 4500.00,
    r2: 4450.00,
    r1: 4400.00,
    s1: 4350.00,
    s2: 4300.00,
    s3: 4250.00,
    isValid: true
  });

  // Reset alert states
  alertService.resetLevelState(sym, 'S2');
  assert.strictEqual(alertService.getLevelState(sym, 'S2').status, 'READY', 'S2 should start in READY state');
  console.log('Step 1: S2 initialized in READY (gold) state.');

  // Simulate tick touching S2 (Price = 4300.10, diff = 0.10 <= 0.20 tolerance)
  console.log('Step 2: Simulating market tick touching S2 @ $4300.10...');
  
  let alertTriggeredCount = 0;
  // Intercept triggerAlertPipeline for testing
  const originalTrigger = alertService.triggerAlertPipeline.bind(alertService);
  alertService.triggerAlertPipeline = async (params) => {
    alertTriggeredCount++;
    alertService.getLevelState(sym, params.level).status = 'TRIGGERED';
    alertService.getLevelState(sym, params.level).lastTriggerPrice = params.currentPrice;
  };

  alertService.evaluateMarketPrice({
    rawSymbol: 'XAUUSD',
    price: 4300.10,
    previousPrice: 4302.00
  });

  assert.strictEqual(alertTriggeredCount, 1, 'Alert should trigger once on touch');
  assert.strictEqual(alertService.getLevelState(sym, 'S2').status, 'TRIGGERED', 'S2 state should be TRIGGERED (red)');
  console.log('✅ Level touch detected and transitioned to TRIGGERED (red). Alert fired.\n');

  // Step 3: Simulate price remaining around S2 (Price = 4300.05, 4299.95, 4300.15 for next 10 ticks)
  console.log('Step 3: Simulating 10 consecutive ticks lingering at S2...');
  for (let i = 0; i < 10; i++) {
    alertService.evaluateMarketPrice({
      rawSymbol: 'XAUUSD',
      price: 4300.00 + (i % 2 === 0 ? 0.05 : -0.05),
      previousPrice: 4300.10
    });
  }

  assert.strictEqual(alertTriggeredCount, 1, 'Duplicate alerts must be strictly blocked while in TRIGGERED state');
  console.log('✅ Anti-Spam Lock: 0 duplicate alerts sent while price hovered at level.\n');

  // Step 4: Move price away by >= retriggerDistance (Price = 4301.50, diff = 1.40 >= 1.00)
  console.log('Step 4: Price moves away to $4301.50 (distance 1.40 >= 1.00)...');
  alertService.evaluateMarketPrice({
    rawSymbol: 'XAUUSD',
    price: 4301.50,
    previousPrice: 4300.00
  });

  assert.strictEqual(alertService.getLevelState(sym, 'S2').status, 'PREVIOUSLY_TOUCHED', 'S2 should transition to PREVIOUSLY_TOUCHED (blue)');
  console.log('✅ Hysteresis: Level transitioned to PREVIOUSLY_TOUCHED (blue).\n');

  // Step 5: Price moves further away (Price = 4302.50, diff = 2.40 >= 2.00)
  console.log('Step 5: Price moves further away to $4302.50 (distance 2.40 >= 2.00)...');
  alertService.evaluateMarketPrice({
    rawSymbol: 'XAUUSD',
    price: 4302.50,
    previousPrice: 4301.50
  });

  assert.strictEqual(alertService.getLevelState(sym, 'S2').status, 'READY', 'S2 should reset to READY (gold)');
  console.log('✅ Full Reset: Level fully reset to READY (gold). Ready for fresh touch alerts.\n');

  // Step 6: Price returns to S2
  console.log('Step 6: Price returns to S2 @ $4300.00...');
  alertService.evaluateMarketPrice({
    rawSymbol: 'XAUUSD',
    price: 4300.00,
    previousPrice: 4302.50
  });

  assert.strictEqual(alertTriggeredCount, 2, 'Fresh alert should trigger now that level is reset');
  console.log('✅ Fresh alert successfully triggered on return to S2!\n');

  console.log('🎉 TOUCH DETECTION & ANTI-DUPLICATE HYSTERESIS TEST PASSED (100%)!');
}

testTouchEngine().catch(err => {
  console.error('❌ Touch engine test failed:', err);
  process.exit(1);
});
