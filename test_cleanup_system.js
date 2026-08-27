import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cleanupService } from './services/cleanupService.js';
import { cloudinaryService } from './services/cloudinaryService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.join(__dirname, 'public/screenshots');

async function testCleanupSystem() {
  console.log('====================================================');
  console.log('🧪 RUNNING AUTOMATED 5-DAY CLEANUP RETENTION TEST');
  console.log('====================================================\n');

  // 1. Create a dummy expired local screenshot (>5 days old)
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  const dummyOldFile = path.join(SCREENSHOTS_DIR, 'test_old_dummy_screenshot_5d.png');
  fs.writeFileSync(dummyOldFile, Buffer.from('FAKE_PNG_DATA'));
  
  // Set mtime to 6 days in the past
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  fs.utimesSync(dummyOldFile, sixDaysAgo, sixDaysAgo);
  console.log(`✓ Created test screenshot with simulated 6-day old timestamp.`);

  // 2. Create a fresh screenshot (<1 day old)
  const dummyNewFile = path.join(SCREENSHOTS_DIR, 'test_new_dummy_screenshot.png');
  fs.writeFileSync(dummyNewFile, Buffer.from('FRESH_PNG_DATA'));
  console.log(`✓ Created test screenshot with fresh timestamp.`);

  // 3. Execute 5-day cleanup
  console.log(`\n▶️ Executing cleanupService.run5DayCleanup(5)...`);
  const result = await cleanupService.run5DayCleanup(5);
  console.log('Result:', JSON.stringify(result, null, 2));

  assert.strictEqual(result.success, true, 'Cleanup should report success');
  assert.ok(result.cutoffDate, 'Cutoff date must be defined');

  // 4. Verify old dummy file was deleted and fresh file was kept
  assert.strictEqual(fs.existsSync(dummyOldFile), false, 'Old screenshot (>5 days) must be deleted');
  assert.strictEqual(fs.existsSync(dummyNewFile), true, 'Fresh screenshot (<5 days) must be preserved');

  // Cleanup dummy fresh file
  try {
    fs.unlinkSync(dummyNewFile);
  } catch (_) {}

  console.log(`✓ Verified: 6-day old file was automatically purged, fresh file was safely preserved.`);

  // 5. Verify Cloudinary delete method exists and handles edge cases gracefully
  console.log(`\n▶️ Verifying Cloudinary service method contract...`);
  assert.strictEqual(typeof cloudinaryService.deleteScreenshotsOlderThan, 'function');
  const cldRes = await cloudinaryService.deleteScreenshotsOlderThan(5);
  console.log('Cloudinary query result:', cldRes);
  assert.ok(typeof cldRes.deleted === 'number', 'Cloudinary result should return number of deleted assets');

  console.log('\n====================================================');
  console.log('🎉 ALL 5-DAY RETENTION CLEANUP TESTS PASSED 100%!');
  console.log('====================================================');
}

testCleanupSystem().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
