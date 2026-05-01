// 股票詳情：歷史 OHLC + KD 指標
// 資料來源：Yahoo Finance Chart API（公開、含台股 .TW / 上櫃 .TWO）

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
};

function calculateKD(highs, lows, closes, n = 9) {
  const k = [], d = [];
  let prevK = 50, prevD = 50;
  for (let i = 0; i < closes.length; i++) {
    if (i < n - 1) { k.push(null); d.push(null); continue; }
    const ph = highs.slice(i - n + 1, i + 1).filter((v) => v != null);
    const pl = lows.slice(i - n + 1, i + 1).filter((v) => v != null);
    if (ph.length === 0 || pl.length === 0) { k.push(null); d.push(null); continue; }
    const hi = Math.max(...ph), lo = Math.min(...pl);
    const rsv = hi === lo ? 50 : ((closes[i] - lo) / (hi - lo)) * 100;
    const ck = (2 / 3) * prevK + (1 / 3) * rsv;
    const cd = (2 / 3) * prevD + (1 / 3) * ck;
    k.push(Math.round(ck * 100) / 100);
    d.push(Math.round(cd * 100) / 100);
    prevK = ck; prevD = cd;
  }
  return { k, d };
}

async function fetchYahoo(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Yahoo ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) {
    const errMsg = json?.chart?.error?.description || 'no chart data';
    throw new Error(errMsg);
  }
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

// 試 .TW，失敗再試 .TWO
async function fetchWithFallback(rawSymbol, market, interval, range) {
  const isNumeric = /^\d{4,6}[A-Z]?$/.test(rawSymbol);
  const candidates = [];
  if (rawSymbol.includes('.')) {
    candidates.push(rawSymbol);
  } else if (isNumeric) {
    if (market === '上櫃') {
      candidates.push(`${rawSymbol}.TWO`, `${rawSymbol}.TW`);
    } else {
      candidates.push(`${rawSymbol}.TW`, `${rawSymbol}.TWO`);
    }
  } else {
    candidates.push(rawSymbol);
  }

  let lastErr;
  for (const sym of candidates) {
    try {
      const data = await fetchYahoo(sym, interval, range);
      return { data, symbol: sym };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('no candidate');
}

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

export default async (req, context) => {
  const url = new URL(req.url);
  const rawSymbol = (url.searchParams.get('symbol') || '').trim();
  const market = (url.searchParams.get('market') || '').trim();
  if (!rawSymbol) return Response.json({ error: '缺少 symbol' }, { status: 400 });

  try {
    // 先用一個請求試出正確的 symbol，後續沿用
    const probe = await fetchWithFallback(rawSymbol, market, '1d', '1mo');
    const symbol = probe.symbol;
    const fifteenDay = probe.data;

    const [intraday, fiveDay] = await Promise.all([
      fetchYahoo(symbol, '5m', '1d').catch(() => null),
      fetchYahoo(symbol, '30m', '5d').catch(() => null),
    ]);

    const threeDay = fiveDay ? trim(fiveDay, Math.ceil(fiveDay.timestamps.length * 0.6)) : null;

    let kd = { k: [], d: [], lastK: null, lastD: null, alert: false };
    if (fifteenDay && fifteenDay.close.length >= 9) {
      const result = calculateKD(fifteenDay.high, fifteenDay.low, fifteenDay.close, 9);
      const lastIdx = fifteenDay.close.length - 1;
      kd = {
        k: result.k,
        d: result.d,
        lastK: result.k[lastIdx],
        lastD: result.d[lastIdx],
        alert: result.k[lastIdx] !== null && result.k[lastIdx] >= 20 && result.k[lastIdx] <= 35,
      };
    }

    const last15 = trim(fifteenDay, 15);
    if (last15 && kd.k.length === fifteenDay.close.length) {
      kd.k = kd.k.slice(-15);
      kd.d = kd.d.slice(-15);
    }

    const meta = intraday || fiveDay || fifteenDay || {};
    return Response.json({
      symbol,
      name: meta.name,
      currency: meta.currency,
      previousClose: meta.previousClose,
      intraday,
      threeDay,
      fiveDay,
      fifteenDay: last15,
      kd,
      fetchedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (err) {
    return Response.json({
      error: err.message,
      symbol: rawSymbol,
      hint: '可能是 Yahoo Finance 沒有此股票的資料，或代號錯誤',
    }, { status: 200 });
  }
};

export const config = { path: '/.netlify/functions/stock-detail' };
