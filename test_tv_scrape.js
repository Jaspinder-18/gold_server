import { chromium } from 'playwright';

async function extractFromTradingView() {
  console.log('Launching headless browser to extract exact TradingView chart values...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  try {
    const url = 'https://www.tradingview.com/chart/?symbol=OANDA%3AXAUUSD';
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    // Look for legend text or canvas values
    const legendText = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('[data-name="legend-series-item"], [class*="legend"], [class*="valuesWrapper"]'));
      return elements.map(el => el.innerText).join('\n---\n');
    });

    console.log('Legend Text Found:\n', legendText);
  } catch (err) {
    console.error('Playwright extraction error:', err.message);
  } finally {
    await browser.close();
  }
}

extractFromTradingView();
