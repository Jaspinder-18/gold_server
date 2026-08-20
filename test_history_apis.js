import axios from 'axios';

async function testHistoryAPIs() {
  console.log('Testing historical daily bar endpoints for XAUUSD...\n');

  // 1. Investing.com / TVC endpoint for Gold (pair 68 / XAUUSD)
  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 86400 * 10;
    const tvcUrl = `https://tvc4.forexpros.com/7d23d8c1c5e93318b7eb32626e838b00/${to}/1/1/8/history?symbol=68&resolution=D&from=${from}&to=${to}`;
    const res = await axios.get(tvcUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 5000
    });
    if (res.data?.s === 'ok') {
      console.log('✅ Investing/TVC Gold Daily Bars:');
      const { t, o, h, l, c } = res.data;
      for (let i = 0; i < t.length; i++) {
        const d = new Date(t[i] * 1000).toISOString().split('T')[0];
        console.log(`   ${d}: O=${o[i]}, H=${h[i]}, L=${l[i]}, C=${c[i]}`);
      }
    }
  } catch (err) {
    console.log('Investing/TVC error:', err.message);
  }

  // 2. Stooq Historical Daily (XAUUSD)
  try {
    const stooqUrl = 'https://stooq.com/q/d/l/?s=xauusd&i=d';
    const res = await axios.get(stooqUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
    console.log('\n✅ Stooq XAUUSD Daily Lines (latest):');
    const lines = res.data.trim().split('\n');
    console.log(lines.slice(-4).join('\n'));
  } catch (err) {
    console.log('Stooq error:', err.message);
  }

  // 3. GoldAPI / MetalPrice free endpoints
  try {
    const goldUrl = 'https://api.metals.live/v1/spot/gold';
    const res = await axios.get(goldUrl, { timeout: 4000 });
    console.log('\n✅ Metals.live Gold:', res.data);
  } catch (err) {}
}

testHistoryAPIs();
