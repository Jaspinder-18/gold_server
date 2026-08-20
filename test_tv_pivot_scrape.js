import { chromium } from 'playwright';

async function extractTradingViewPivots() {
  console.log('Extracting exact TradingView Pivot Points levels from chart...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });

  try {
    const url = 'https://www.tradingview.com/chart/?symbol=OANDA%3AXAUUSD';
    await page.goto(url, { waitUntil: 'networkidle', timeout: 35000 });
    await page.waitForTimeout(3000);

    // Click indicators button and add Pivot Points Standard
    const indicatorsBtn = await page.$('button[id="header-toolbar-indicators"], button[data-name="indicators"]');
    if (indicatorsBtn) {
      await indicatorsBtn.click();
      await page.waitForTimeout(1000);
      await page.keyboard.type('Pivot Points Standard');
      await page.waitForTimeout(1500);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(2000);
    }

    // Capture legend items
    const legendTexts = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('[data-name="legend-series-item"], [data-name="legend-source-item"], [class*="valuesWrapper"]'));
      return elements.map(el => el.innerText);
    });

    console.log('Legend Data from TradingView with Indicator:\n', legendTexts.join('\n---\n'));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
}

extractTradingViewPivots();
