import axios from 'axios';

async function testFetchers() {
  console.log('Testing data providers for OANDA:XAUUSD completed daily candles...\n');

  // Test 1: Yahoo Finance Gold Spot / Futures variants
  const yfTickers = ['GC=F', 'XAUUSD=X', 'GOLD', 'GLD', '^XAU'];
  for (const t of yfTickers) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1d&range=5d`;
      const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
      const quote = res.data?.chart?.result?.[0];
      if (quote) {
        console.log(`[Yahoo Finance ${t}] SUCCESS: ${quote.meta.symbol}`);
        const timestamps = quote.timestamp || [];
        const quotes = quote.indicators.quote[0];
        for (let i = timestamps.length - 2; i < timestamps.length; i++) {
          if (i >= 0) {
            const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
            console.log(`   Bar ${date}: Open=${quotes.open[i]?.toFixed(2)}, High=${quotes.high[i]?.toFixed(2)}, Low=${quotes.low[i]?.toFixed(2)}, Close=${quotes.close[i]?.toFixed(2)}`);
          }
        }
      }
    } catch (err) {
      console.log(`[Yahoo Finance ${t}] FAILED: ${err.message}`);
    }
  }

  // Test 2: TradingView Scanner CFD with historical columns
  try {
    const tvRes = await axios.post(
      'https://scanner.tradingview.com/cfd/scan',
      {
        symbols: { tickers: ['OANDA:XAUUSD'] },
        columns: ['name', 'open', 'high', 'low', 'close', 'change', 'high_1D', 'low_1D', 'open_1D', 'close_1D', 'change_1D']
      },
      { timeout: 5000 }
    );
    console.log('\n[TradingView Scanner CFD]:', JSON.stringify(tvRes.data, null, 2));
  } catch (err) {
    console.log('[TradingView Scanner CFD] FAILED:', err.message);
  }

  // Test 3: Binance PAXG/USDT (Gold crypto spot equivalent)
  try {
    const bRes = await axios.get('https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=1d&limit=3');
    console.log('\n[Binance PAXGUSDT Daily]:');
    for (const k of bRes.data) {
      const d = new Date(k[0]).toISOString().split('T')[0];
      console.log(`   Bar ${d}: Open=${parseFloat(k[1]).toFixed(2)}, High=${parseFloat(k[2]).toFixed(2)}, Low=${parseFloat(k[3]).toFixed(2)}, Close=${parseFloat(k[4]).toFixed(2)}`);
    }
  } catch (err) {
    console.log('[Binance PAXGUSDT] FAILED:', err.message);
  }

  // Test 4: TradingView UDF / Widget feed
  try {
    const tvUdf = await axios.get('https://price-api.crypto.com/price/v1/exchange/instruments/XAU_USD/candlesticks?timeframe=1D&count=5');
    console.log('\n[Crypto.com XAU_USD]:', tvUdf.status);
  } catch (err) {}
}

testFetchers();
