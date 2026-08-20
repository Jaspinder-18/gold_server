import axios from 'axios';

async function testSessionAggregation() {
  console.log('Testing 22:00 UTC (17:00 NY) Session Candle Aggregation for Gold...\n');

  try {
    // Fetch last 48 hourly candles for PAXGUSDT
    const url = 'https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=1h&limit=48';
    const res = await axios.get(url);
    const klines = res.data;

    // Find the 24 candles corresponding to the previous completed 22:00 UTC to 22:00 UTC session
    // Find index of previous 22:00 UTC
    let endIdx = -1;
    for (let i = klines.length - 1; i >= 0; i--) {
      const d = new Date(klines[i][0]);
      if (d.getUTCHours() === 22) {
        endIdx = i;
        break;
      }
    }

    if (endIdx >= 24) {
      const sessionBars = klines.slice(endIdx - 24, endIdx);
      const highs = sessionBars.map(k => parseFloat(k[2]));
      const lows = sessionBars.map(k => parseFloat(k[3]));
      const sessionHigh = Math.max(...highs);
      const sessionLow = Math.min(...lows);
      const sessionOpen = parseFloat(sessionBars[0][1]);
      const sessionClose = parseFloat(sessionBars[sessionBars.length - 1][4]);

      console.log(`✅ Aggregated 22:00 UTC (17:00 NY) Session OHLC:
        Open:  ${sessionOpen.toFixed(3)}
        High:  ${sessionHigh.toFixed(3)}
        Low:   ${sessionLow.toFixed(3)}
        Close: ${sessionClose.toFixed(3)}
        Range: ${(sessionHigh - sessionLow).toFixed(3)}`);
    } else {
      console.log('Not enough hourly bars to reach 22:00 UTC boundary. Using reference session.');
    }
  } catch (err) {
    console.error('Aggregation error:', err.message);
  }
}

testSessionAggregation();
