import axios from 'axios';

async function testTvScannerColumns() {
  const testColumns = [
    'name',
    'open',
    'high',
    'low',
    'close',
    'Pivot.M.Fibonacci.R3',
    'Pivot.M.Fibonacci.R2',
    'Pivot.M.Fibonacci.R1',
    'Pivot.M.Fibonacci.P',
    'Pivot.M.Fibonacci.S1',
    'Pivot.M.Fibonacci.S2',
    'Pivot.M.Fibonacci.S3',
    'Pivot.M.Classic.R3',
    'Pivot.M.Classic.R2',
    'Pivot.M.Classic.P',
    'Pivot.M.Classic.S2',
    'Pivot.M.Classic.S3',
    'change',
    'change_abs',
    'Perf.D',
    'gap'
  ];

  try {
    const res = await axios.post(
      'https://scanner.tradingview.com/cfd/scan',
      {
        symbols: { tickers: ['OANDA:XAUUSD'] },
        columns: testColumns
      },
      { timeout: 5000 }
    );

    console.log('TV Scanner Columns Result:');
    if (res.data?.data?.[0]?.d) {
      const data = res.data.data[0].d;
      testColumns.forEach((col, idx) => {
        console.log(`  ${col}: ${data[idx]}`);
      });
    }
  } catch (err) {
    console.error('TV Scanner Error:', err.message);
  }
}

testTvScannerColumns();
