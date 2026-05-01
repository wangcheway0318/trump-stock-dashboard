// 提供台股股票清單給前端做模糊搜尋
// 改用 TWSE / TPEx 的 OpenAPI（JSON 格式），比原本的 Big5 HTML 解析穩定很多

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 Dashboard',
  'Accept': 'application/json',
};

// 一天快取一次
let cache = { data: null, fetchedAt: 0 };
const CACHE_TTL = 24 * 60 * 60 * 1000;

// 上市股票（含 ETF）
async function fetchTSE() {
  const url = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`tse ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error('tse format');
  return json
    .filter((it) => it.Code && it.Name)
    .map((it) => ({
      symbol: String(it.Code).trim(),
      name: String(it.Name).trim(),
      market: '上市',
    }));
}

// 上櫃股票
async function fetchOTC() {
  const url = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes';
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`otc ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error('otc format');
  return json
    .filter((it) => (it.SecuritiesCompanyCode || it.Code) && (it.CompanyName || it.Name))
    .map((it) => ({
      symbol: String(it.SecuritiesCompanyCode || it.Code).trim(),
      name: String(it.CompanyName || it.Name).trim(),
      market: '上櫃',
    }));
}

export default async (req, context) => {
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return Response.json(cache.data, { headers: { 'Cache-Control': 'public, max-age=86400' } });
  }

  try {
    const [tse, otc] = await Promise.all([
      fetchTSE().catch((err) => { console.warn('TSE fetch failed:', err.message); return []; }),
      fetchOTC().catch((err) => { console.warn('OTC fetch failed:', err.message); return []; }),
    ]);

    const all = [...tse, ...otc];
    if (all.length === 0) throw new Error('TSE 與 OTC 都無資料');

    // 去重（同代號保留 上市 優先）
    const dedup = new Map();
    for (const s of all) {
      if (!dedup.has(s.symbol)) dedup.set(s.symbol, s);
    }
    const stocks = [...dedup.values()];

    const payload = {
      stocks,
      count: stocks.length,
      tseCount: tse.length,
      otcCount: otc.length,
      fetchedAt: new Date().toISOString(),
    };
    cache = { data: payload, fetchedAt: Date.now() };

    return Response.json(payload, {
      headers: { 'Cache-Control': 'public, max-age=86400' },
    });
  } catch (err) {
    if (cache.data) {
      return Response.json({ ...cache.data, stale: true }, { status: 200 });
    }
    return Response.json({ stocks: [], error: err.message }, { status: 200 });
  }
};

export const config = { path: '/.netlify/functions/stock-list' };
