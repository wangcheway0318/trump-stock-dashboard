// 提供台股股票清單給前端做模糊搜尋
// 同時包含上市股票、上櫃股票與 ETF
// 來源：證交所 ISIN 公開檔（HTML，需簡單剖析）
//   上市：https://isin.twse.com.tw/isin/C_public.jsp?strMode=2
//   上櫃：https://isin.twse.com.tw/isin/C_public.jsp?strMode=4

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'text/html',
};

// 一天快取一次（清單變動很慢）
let cache = { data: null, fetchedAt: 0 };
const CACHE_TTL = 24 * 60 * 60 * 1000;

async function fetchIsin(mode) {
  const url = `https://isin.twse.com.tw/isin/C_public.jsp?strMode=${mode}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`ISIN ${res.status}`);
  // 證交所網頁是 Big5/MS950 編碼，需要轉碼
  const buf = await res.arrayBuffer();
  let html;
  try {
    const decoder = new TextDecoder('big5');
    html = decoder.decode(buf);
  } catch {
    html = new TextDecoder('utf-8').decode(buf);
  }
  return html;
}

function parseIsin(html, market) {
  // 表格結構：第一欄為「代號 名稱」，例：1101 台泥
  const rows = [];
  const trMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  for (const tr of trMatches) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim(),
    );
    if (tds.length < 5) continue;
    const codeName = tds[0];
    const m = codeName.match(/^(\S+)\s+(.+)$/);
    if (!m) continue;
    const symbol = m[1].trim();
    const name = m[2].trim();
    const type = tds[3] || '';
    // 只收常見的：上市/上櫃股票、ETF、ETN
    if (!/股票|ETF|ETN|受益憑證/.test(type)) continue;
    if (!/^\d{4,6}[A-Z]?$/.test(symbol)) continue;
    rows.push({ symbol, name, market, type });
  }
  return rows;
}

export default async (req, context) => {
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return Response.json(cache.data, {
      headers: { 'Cache-Control': 'public, max-age=86400' },
    });
  }

  try {
    const [tseHtml, otcHtml] = await Promise.all([
      fetchIsin(2).catch(() => ''),
      fetchIsin(4).catch(() => ''),
    ]);

    const tse = tseHtml ? parseIsin(tseHtml, '上市') : [];
    const otc = otcHtml ? parseIsin(otcHtml, '上櫃') : [];
    const all = [...tse, ...otc];

    if (all.length === 0) throw new Error('無法解析股票清單');

    const payload = { stocks: all, count: all.length, fetchedAt: new Date().toISOString() };
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
