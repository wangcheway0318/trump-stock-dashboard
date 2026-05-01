// 股票詳情：歷史 OHLC + 計算 KD 指標
// 資料來源：Yahoo Finance Chart API（公開、免金鑰、含台股）
//   範例：https://query1.finance.yahoo.com/v8/finance/chart/2330.TW?interval=1d&range=3mo

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// 計算 KD 指標（標準週期 9）
// RSV(t) = (close - lowestN) / (highestN - lowestN) * 100
// K(t)   = 2/3 * K(t-1) + 1/3 * RSV(t)
// D(t)   = 2/3 * D(t-1) + 1/3 * K(t)
function calculateKD(highs, lows, closes, n = 9) {
  const k = [], d = [];
  let prevK = 50, prevD = 50;

  for (let i = 0; i < closes.length; i++) {
    if (i < n - 1) {
      k.push(null);
      d.push(null);
      continue;
    }
    const periodHighs = highs.slice(i - n + 1, i + 1).filter((v) => v != null);
    const periodLows = lows.slice(i - n + 1, i + 1).filter((v) => v != null);
    if (periodHighs.length === 0 || periodLows.length === 0) {
      k.push(null); d.push(null); continue;
    }
    const highest = Math.max(...periodHighs);
    const lowest = Math.min(...periodLows);
    const rsv = highest === lowest ? 50 : ((closes[i] - lowest) / (highest - lowest)) * 100;
    const currK = (2 / 3) * prevK + (1 / 3) * rsv;
    const currD = (2 / 3) * prevD + (1 / 3) * currK;
    k.push(Math.round(currK * 100) / 100);
    d.push(Math.round(currD * 100) / 100);
    prevK = currK;
    prevD = currD;
  }
  return { k, d };
}

async function fetchYahooChart(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Yahoo chart ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('no chart data');

  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const meta = result.meta || {};

  return {
    timestamps: ts.map((t) => t * 1000),
    open: q.open || [],
    high: q.high || [],
    low: q.low || [],
    close: q.close || [],
    volume: q.volume || [],
    name: meta.shortName || meta.longName || '',
    currency: meta.currency || 'TWD',
    previousClose: meta.chartPreviousClose || meta.previousClose,
  };
}

export default async (req, context) => {
  const url = new URL(req.url);
  const symbolRaw = (url.searchParams.get('symbol') || '').trim();
  if (!symbolRaw) {
    return Response.json({ error: '缺少 symbol 參數' }, { status: 400 });
  }

  // 自動補上 .TW（台股代號 4 位數字）
  let symbol = symbolRaw;
  if (/^\d{4,6}$/.test(symbolRaw)) symbol = `${symbolRaw}.TW`;

  try {
    // 同步抓四個時間軸
    const [intraday, threeDay, fiveDay, fifteenDay] = await Promise.all([
      fetchYahooChart(symbol, '5m', '1d').catch(() => null),
      fetchYahooChart(symbol, '15m', '5d').catch(() => null),
      fetchYahooChart(symbol, '30m', '5d').catch(() => null),
      fetchYahooChart(symbol, '1d', '1mo').catch(() => null),
    ]);

    // 取最近 15 個交易日做 KD（KD 慣例用日線）
    const daily = fifteenDay;
    let kd = { k: [], d: [], lastK: null, lastD: null, alert: false };
    if (daily && daily.close.length >= 9) {
      const result = calculateKD(daily.high, daily.low, daily.close, 9);
      kd.k = result.k;
      kd.d = result.d;
      const lastIdx = daily.close.length - 1;
      kd.lastK = result.k[lastIdx];
      kd.lastD = result.d[lastIdx];
      // 進場提醒：K 在 20~35 之間（低檔可能反彈）
      kd.alert = kd.lastK !== null && kd.lastK >= 20 && kd.lastK <= 35;
    }

    // 縮小回傳體積：15日只取最後 15 筆
    function trim(data, n) {
      if (!data) return null;
      const len = data.timestamps.length;
      const start = Math.max(0, len - n);
      return {
        ...data,
        timestamps: data.timestamps.slice(start),
        open: data.open.slice(start),
        high: data.high.slice(start),
        low: data.low.slice(start),
        close: data.close.slice(start),
        volume: data.volume.slice(start),
      };
    }

    const last15 = trim(daily, 15);
    if (last15 && kd.k.length === daily.close.length) {
      kd.k = kd.k.slice(-15);
      kd.d = kd.d.slice(-15);
    }

    const meta = (intraday || threeDay || fiveDay || daily) || {};

    return Response.json({
      symbol,
      name: meta.name,
      currency: meta.currency,
      previousClose: meta.previousClose,
      intraday,                      // 1日 5 分線
      threeDay: trim(threeDay, 100),  // 3 日（用 5 日資料截）
      fiveDay,                       // 5 日
      fifteenDay: last15,            // 15 日
      kd,
      fetchedAt: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  } catch (err) {
    return Response.json({ error: err.message, symbol }, { status: 200 });
  }
};

export const config = { path: '/.netlify/functions/stock-detail' };
