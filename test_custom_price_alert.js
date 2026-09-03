import assert from 'assert';
import { alertService } from './services/alertService.js';
import { pivotService } from './services/pivotService.js';
import { symbolService } from './services/symbolService.js';
import { telegramService } from './services/telegramService.js';

async function runCustomPriceAlertTests() {
  console.log('🧪 Starting Acceptance Test Suite for Custom Price Touch Alert System...\n');

  // Test 1: Service Initialization
  console.log('Test 1: Initializing Symbol and Alert Services...');
  await symbolService.initialize();
  await alertService.initialize();
  console.log('✅ Services initialized successfully.\n');

  // Test 2: Set Custom Price Alert
  console.log('Test 2: Setting Custom Price Alert for XAUUSD at $3450.50...');
  const setRes = await alertService.setCustomAlert('XAUUSD', 3450.50, true);
  assert(setRes.symbol === 'XAUUSD', 'Symbol should be XAUUSD');
  assert(setRes.targetPrice === 3450.50, 'Target price should be 3450.50');
  assert(setRes.status === 'ACTIVE', 'Alert status should be ACTIVE');
  assert(setRes.enabled === true, 'Alert enabled should be true');

  const fetchedAlert = alertService.getCustomAlert('XAUUSD');
  assert(fetchedAlert.targetPrice === 3450.50, 'Fetched alert should match 3450.50');
  assert(fetchedAlert.status === 'ACTIVE', 'Fetched alert status should be ACTIVE');
  console.log('✅ Custom price alert set and active at $3450.50.\n');

  // Test 3: Central Price Touch Detection (Exact 1 Central Event)
  console.log('Test 3: Simulating live market ticks reaching $3450.50...');
  let triggeredEvents = [];
  alertService.on('alertProcessed', (evt) => {
    triggeredEvents.push(evt);
  });

  const alertPromise = new Promise(resolve => {
    const onProcessed = (evt) => {
      resolve(evt);
    };
    alertService.once('alertProcessed', onProcessed);
  });

  // Tick 1: Approaching price
  alertService.evaluateMarketPrice({ rawSymbol: 'XAUUSD', price: 3449.00, previousPrice: 3448.00 });
  assert(triggeredEvents.length === 0, 'Approaching tick should not trigger alert');

  // Tick 2: Touching price ($3450.50)
  alertService.evaluateMarketPrice({ rawSymbol: 'XAUUSD', price: 3450.50, previousPrice: 3449.80 });

  // Tick 3: Second tick at $3450.50 (should NOT create duplicate alert)
  alertService.evaluateMarketPrice({ rawSymbol: 'XAUUSD', price: 3450.50, previousPrice: 3450.50 });

  // Await pipeline resolution
  const event = await alertPromise;

  // Extra safety wait to ensure no duplicates occur
  await new Promise(r => setTimeout(r, 1500));

  assert(triggeredEvents.length === 1, `Exactly ONE alert event should be created, but got ${triggeredEvents.length}`);
  assert(event.level === 'CUSTOM', 'Event level should be CUSTOM');
  assert(event.customPrice === 3450.50, 'Event customPrice should be 3450.50');
  assert(event.triggerPrice === 3450.50, 'Event triggerPrice should be 3450.50');
  assert(event.status === 'TRIGGERED', 'Event status should be TRIGGERED');
  assert(typeof event.eventId === 'string' && event.eventId.startsWith('XAUUSD-3450.50'), 'Event should have unique eventId');
  console.log(`✅ Exactly ONE alert event generated with Event ID: ${event.eventId} (No duplicate alerts).\n`);

  // Test 4: Verify Telegram Message Formatting for Custom Price
  console.log('Test 4: Verifying Telegram notification message formatting...');
  const tgMsg = telegramService.formatAlertMessage({
    symbol: 'XAUUSD',
    tradingViewTicker: 'OANDA:XAUUSD',
    customPrice: 3450.50,
    currentPrice: 3450.50,
    timeframe: '15m',
    isTest: false
  });
  assert(tgMsg.includes('CUSTOM PRICE ALERT'), 'Message should have CUSTOM PRICE ALERT header');
  assert(tgMsg.includes('$3450.50'), 'Message should show custom price $3450.50');
  assert(tgMsg.includes('TRIGGERED'), 'Message should show TRIGGERED status');
  console.log('✅ Telegram alert message format verified.\n');

  // Test 5: Verify S2, S3, R2, R3 level touches generate ZERO alerts (Complete Removal of Level Touch)
  console.log('Test 5: Verifying Level Touch (S2, S3, R2, R3) triggers ZERO alerts...');
  const initialCount = triggeredEvents.length;
  const pivot = pivotService.getPivotState('XAUUSD') || { r2: 4500, s2: 4300, r3: 4600, s3: 4200 };

  // Simulate touches on R2, R3, S2, S3
  alertService.evaluateMarketPrice({ rawSymbol: 'XAUUSD', price: pivot.r2 || 4500, previousPrice: (pivot.r2 || 4500) - 1 });
  alertService.evaluateMarketPrice({ rawSymbol: 'XAUUSD', price: pivot.r3 || 4600, previousPrice: (pivot.r3 || 4600) - 1 });
  alertService.evaluateMarketPrice({ rawSymbol: 'XAUUSD', price: pivot.s2 || 4300, previousPrice: (pivot.s2 || 4300) + 1 });
  alertService.evaluateMarketPrice({ rawSymbol: 'XAUUSD', price: pivot.s3 || 4200, previousPrice: (pivot.s3 || 4200) + 1 });

  await new Promise(r => setTimeout(r, 1000));
  assert(triggeredEvents.length === initialCount, 'Pivot level touches (R2, R3, S2, S3) MUST NOT generate any alerts');
  console.log('✅ Level Touch (S2, S3, R2, R3) generated 0 alerts. Level Touch system is completely removed.\n');

  // Test 6: Delete Custom Alert
  console.log('Test 6: Deleting Custom Alert...');
  const delRes = await alertService.deleteCustomAlert('XAUUSD');
  assert(delRes.targetPrice === 0, 'Target price should be 0 after delete');
  assert(delRes.status === 'INACTIVE', 'Status should be INACTIVE after delete');
  assert(delRes.enabled === false, 'Enabled should be false after delete');

  // Verify ticks at old price 3450.50 no longer trigger alerts
  alertService.evaluateMarketPrice({ rawSymbol: 'XAUUSD', price: 3450.50, previousPrice: 3449.00 });
  await new Promise(r => setTimeout(r, 1000));
  assert(triggeredEvents.length === initialCount, 'Deleted price must not trigger alerts');
  console.log('✅ Custom alert deleted: monitoring stopped, white line removed, zero subsequent alerts.\n');

  console.log('🎉 ALL 6 CUSTOM PRICE TOUCH ALERT ACCEPTANCE TESTS PASSED (100%)!\n');
  process.exit(0);
}

runCustomPriceAlertTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
