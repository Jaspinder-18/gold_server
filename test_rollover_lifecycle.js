import assert from 'assert';
import { pivotService } from './services/pivotService.js';
import { symbolService } from './services/symbolService.js';
import { alertService } from './services/alertService.js';

async function testRolloverLifecycle() {
  console.log('🧪 Starting Automated Pivot Rollover & Lifecycle Synchronization Test...\n');

  // Step 1: Initialize services
  console.log('Step 1: Initializing Symbol, Pivot, and Alert Services...');
  await symbolService.initialize();
  await symbolService.setActiveSymbol('XAUUSD');
  await alertService.initialize();
  const sym = 'XAUUSD';
  console.log('✅ Services initialized. Active Symbol:', sym);

  // Step 2: Calculate Period 1 (Day 1)
  console.log('\nStep 2: Calculating Initial Pivot State (Period 2026-08-20)...');
  
  // Mock completed OHLC for Period 1
  const period1OHLC = {
    high: 4400.00,
    low: 4300.00,
    close: 4350.00,
    open: 4320.00,
    periodStart: new Date('2026-08-19T22:00:00Z'),
    periodEnd: new Date('2026-08-20T22:00:00Z'),
    periodDateStr: '2026-08-19',
    dataSource: 'TradingView Scanner / Yahoo Finance'
  };

  // Override fetchPreviousCompletedOHLC for deterministic testing
  pivotService.fetchPreviousCompletedOHLC = async () => period1OHLC;
  pivotService.getCurrentPivotPeriod = () => '2026-08-20';

  const state1 = await pivotService.getOrCalculatePivotsForSymbol(sym, { pivotType: 'TRADITIONAL', force: true });
  assert.strictEqual(state1.pivotPeriod, '2026-08-20', 'Period 1 should be 2026-08-20');
  assert.strictEqual(state1.status, 'ACTIVE', 'Period 1 status should be ACTIVE');
  assert.strictEqual(state1.r3, 4500.00, 'Period 1 R3 should be 4500.00');
  assert.strictEqual(state1.r2, 4450.00, 'Period 1 R2 should be 4450.00');
  assert.strictEqual(state1.s2, 4250.00, 'Period 1 S2 should be 4250.00');
  assert.strictEqual(state1.s3, 4200.00, 'Period 1 S3 should be 4200.00');
  console.log(`✅ Period 1 State Active: R3=${state1.r3}, R2=${state1.r2}, S2=${state1.s2}, S3=${state1.s3}`);

  // Step 3: Trigger Alert in Period 1 (Mark R2 as TRIGGERED)
  console.log('\nStep 3: Simulating alert trigger on Period 1 R2 ($4450.00)...');
  const r2State = alertService.getLevelState(sym, 'R2');
  r2State.status = 'TRIGGERED';
  r2State.lastTriggerPrice = 4450.00;
  assert.strictEqual(alertService.getLevelState(sym, 'R2').status, 'TRIGGERED', 'R2 should be TRIGGERED in Period 1');
  console.log('✅ Level R2 is in TRIGGERED state.');

  // Step 4: Simulate Session Boundary Rollover to Period 2 (Day 2)
  console.log('\nStep 4: Simulating Session Boundary Rollover to Period 2026-08-21...');
  
  // Mock newly completed OHLC for Day 2:
  // High = 4550.00, Low = 4450.00, Close = 4500.00
  // Range = 100.00, P = (4550 + 4450 + 4500)/3 = 4500.00
  // R3 = 4550 + 2*(4500 - 4450) = 4650.00
  // R2 = 4500 + 100 = 4600.00
  // S2 = 4500 - 100 = 4400.00
  // S3 = 4450 - 2*(4550 - 4500) = 4350.00
  const period2OHLC = {
    high: 4550.00,
    low: 4450.00,
    close: 4500.00,
    open: 4480.00,
    periodStart: new Date('2026-08-20T22:00:00Z'),
    periodEnd: new Date('2026-08-21T22:00:00Z'),
    periodDateStr: '2026-08-20',
    dataSource: 'TradingView Scanner / Yahoo Finance'
  };

  pivotService.fetchPreviousCompletedOHLC = async () => period2OHLC;
  pivotService.getCurrentPivotPeriod = () => '2026-08-21';

  let pivotUpdatedEmitted = false;
  let pivotUpdatedPayload = null;

  // Intercept pivotUpdated broadcast
  pivotService.io = {
    emit: (event, payload) => {
      if (event === 'pivotUpdated') {
        pivotUpdatedEmitted = true;
        pivotUpdatedPayload = payload;
      }
    }
  };

  const state2 = await pivotService.getOrCalculatePivotsForSymbol(sym, { pivotType: 'TRADITIONAL', force: true });

  // Step 5: Verify Period 2 Calculations & Invariants
  console.log('\nStep 5: Verifying Period 2 Calculations and Replacement of Old Levels...');
  assert.strictEqual(state2.pivotPeriod, '2026-08-21', 'New Period should be 2026-08-21');
  assert.strictEqual(state2.status, 'ACTIVE', 'New Period status must be ACTIVE');
  assert.strictEqual(state2.r3, 4650.00, 'NEW R3 should be 4650.00 (was 4500.00)');
  assert.strictEqual(state2.r2, 4600.00, 'NEW R2 should be 4600.00 (was 4450.00)');
  assert.strictEqual(state2.s2, 4400.00, 'NEW S2 should be 4400.00 (was 4250.00)');
  assert.strictEqual(state2.s3, 4350.00, 'NEW S3 should be 4350.00 (was 4200.00)');
  console.log(`✅ Old levels successfully replaced by NEW levels:
     OLD: R3=4500.00, R2=4450.00, S2=4250.00, S3=4200.00
     NEW: R3=${state2.r3}, R2=${state2.r2}, S2=${state2.s2}, S3=${state2.s3}`);

  // Step 6: Verify Previous Levels Reference Retained
  console.log('\nStep 6: Verifying Previous Levels Audit Reference...');
  assert(state2.previousLevels != null, 'previousLevels reference must exist');
  assert.strictEqual(state2.previousLevels.r3, 4500.00, 'Previous R3 must match Period 1 R3');
  assert.strictEqual(state2.previousLevels.r2, 4450.00, 'Previous R2 must match Period 1 R2');
  console.log('✅ Previous Period reference levels retained for audit comparison.');

  // Step 7: Verify Socket.IO pivotUpdated Broadcast
  console.log('\nStep 7: Verifying Socket.IO pivotUpdated Broadcast Event...');
  assert(pivotUpdatedEmitted, 'pivotUpdated event MUST be emitted');
  assert.strictEqual(pivotUpdatedPayload.symbol, 'XAUUSD', 'Payload symbol must be XAUUSD');
  assert.strictEqual(pivotUpdatedPayload.pivotPeriod, '2026-08-21', 'Payload pivotPeriod must be 2026-08-21');
  assert.strictEqual(pivotUpdatedPayload.r3, 4650.00, 'Payload R3 must match new level');
  assert.strictEqual(pivotUpdatedPayload.status, 'ACTIVE', 'Payload status must be ACTIVE');
  console.log('✅ pivotUpdated Socket.IO payload fully verified.');

  // Step 8: Verify Alert Engine Reset & Re-binding
  console.log('\nStep 8: Verifying Alert Engine State Reset for New Period...');
  const resetR2State = alertService.getLevelState(sym, 'R2');
  assert.strictEqual(resetR2State.status, 'READY', 'R2 state MUST be automatically reset to READY for new period');
  assert.strictEqual(alertService.getLevelState(sym, 'R3').status, 'READY', 'R3 state must be READY');
  assert.strictEqual(alertService.getLevelState(sym, 'S2').status, 'READY', 'S2 state must be READY');
  assert.strictEqual(alertService.getLevelState(sym, 'S3').status, 'READY', 'S3 state must be READY');
  console.log('✅ Alert Engine successfully reset all level states to READY.');

  // Step 9: Verify Idempotent Manual Recalculate
  console.log('\nStep 9: Verifying Manual Recalculate Button Idempotency...');
  const state2Recheck = await pivotService.getOrCalculatePivotsForSymbol(sym, { pivotType: 'TRADITIONAL', force: false });
  assert.strictEqual(state2Recheck.pivotPeriod, '2026-08-21', 'Period should remain 2026-08-21');
  assert.strictEqual(state2Recheck.r3, 4650.00, 'R3 should remain 4650.00');
  console.log('✅ Manual recalculate safely preserves active period without duplicating.');

  console.log('\n🎉 ALL 9 PIVOT ROLLOVER & SYNCHRONIZATION TESTS PASSED (100%)!');
}

testRolloverLifecycle().catch(err => {
  console.error('❌ Rollover lifecycle test failed:', err);
  process.exit(1);
});
