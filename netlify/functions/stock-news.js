// 抓取台股相關新聞
// 不帶 symbol 時：抓鉅亨網台股大盤新聞
// 帶 symbol 時：抓 Yahoo 股市該股票相關新聞，失敗則用鉅亨網搜尋名稱

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
};

let generalCache = { data: null, fetchedAt: 0 };
const symbolCache = new Map(); // symbol -> { data, fetchedAt }
const CACHE_TTL = 60 * 1000;
const SYMBOL_CACHE_TTL = 5 * 60 * 1000;

// 大盤新聞（鉅亨網）
async function fetchGeneralNews() {
  const url = 'https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?limit=30';
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`cnyes ${res.status}`);
  const json = await res.json();
  const items = json?.items?.data || [];
  return items.map((it) => ({
    title: it.title,
    summary: it.summary || '',
    url: `https://news.cnyes.com/news/id/${it.newsId}`,
    publishedAt: new Date(it.publishAt * 1000).toISOString(),
    source: '鉅亨網',
  }));
}

// 個股新聞（Yahoo 股市）
async function fetchStockNewsYahoo(symbol) {
  // Yahoo 內部 API（公開可調用）
  const sym = /^\d{4,6}$/.test(symbol) ? `${symbol}.TW` : symbol;
  const url = `https://tw.stock.yahoo.com/_td-stock/api/resource/StockServices.news;limit=20;symbols=%5B%22${encodeURIComponent(sym)}%22%5D`;
  const res = await fetch(url, {
    headers: {
      ...HEADERS,
      'Referer': `https://tw.stock.yahoo.com/quote/${sym}`,
    },
  });
  if (!res.ok) throw new Error(`yahoo news ${res.status}`);
  const json = await res.json();
  const items = json?.items || json || [];
  return items.map((it) => ({
    title: it.title,
    summary: it.summary || '',
    url: it.url || (it.id ? `https://tw.stock.yahoo.com/news/${it.id}.html` : '#'),
    publishedAt: it.pubDate || it.publishedAt || new Date().toISOString(),
    source: 'Yahoo 股市',
  }));
}

// Fallback：用鉅亨網搜尋
async function fetchCnyesSearch(keyword) {
  const url = `https://api.cnyes.com/media/api/v1/search?q=${encodeURIComponent(keyword)}&limit=20`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`cnyes search ${res.status}`);
  const json = await res.json();
  const items = json?.items?.data || [];
  return items.map((it) => ({
    title: it.title,
    summary: it.summary || '',
    url: `https://news.cnyes.com/news/id/${it.newsId}`,
    publishedAt: new Date(it.publishAt * 1000).toISOString(),
    source: '鉅亨網',
  }));
}

export default async (req, context) => {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') || '').trim();
  const name = (url.searchParams.get('name') || '').trim();

  // 個股新聞
  if (symbol) {
    const cached = symbolCache.get(symbol);
    if (cached && Date.now() - cached.fetchedAt < SYMBOL_CACHE_TTL) {
      return Response.json(cached.data);
    }
    let news = [];
    try {
      news = await fetchStockNewsYahoo(symbol);
    } catch (err) {
      // fallback to cnyes search
      try {
        news = await fetchCnyesSearch(name || symbol);
      } catch {}
    }
    const payload = { news, symbol, fetchedAt: new Date().toISOString() };
    symbolCache.set(symbol, { data: payload, fetchedAt: Date.now() });
    return Response.json(payload);
  }

  // 大盤新聞
  if (generalCache.data && Date.now() - generalCache.fetchedAt < CACHE_TTL) {
    return Response.json(generalCache.data);
  }

  try {
    const news = await fetchGeneralNews();
    const payload = { news, fetchedAt: new Date().toISOString() };
    generalCache = { data: payload, fetchedAt: Date.now() };
    return Response.json(payload);
  } catch (err) {
    if (generalCache.data) {
      return Response.json({ ...generalCache.data, stale: true });
    }
    return Response.json({ news: [], error: err.message });
  }
};

export const config = { path: '/.netlify/functions/stock-news' };
