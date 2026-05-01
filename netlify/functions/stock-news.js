// 抓取台股相關新聞 — 來源：鉅亨網（cnyes.com）公開 JSON API
// 該 API 為公開資料、免金鑰

const CNYES_API = 'https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?limit=30';

let cache = { data: null, fetchedAt: 0 };
const CACHE_TTL = 60 * 1000; // 60 秒

export default async (req, context) => {
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return Response.json(cache.data, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  }

  try {
    const res = await fetch(CNYES_API, {
      headers: {
        'User-Agent': 'Mozilla/5.0 Dashboard',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`鉅亨網回應 ${res.status}`);

    const json = await res.json();
    const items = json?.items?.data || [];

    const news = items.map((it) => ({
      title: it.title,
      summary: it.summary || '',
      url: `https://news.cnyes.com/news/id/${it.newsId}`,
      publishedAt: new Date(it.publishAt * 1000).toISOString(),
      source: '鉅亨網',
    }));

    const payload = { news, fetchedAt: new Date().toISOString() };
    cache = { data: payload, fetchedAt: Date.now() };

    return Response.json(payload, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  } catch (err) {
    if (cache.data) {
      return Response.json(
        { ...cache.data, stale: true, error: err.message },
        { headers: { 'Cache-Control': 'public, max-age=30' } },
      );
    }
    return Response.json(
      { news: [], error: '無法取得新聞：' + err.message },
      { status: 200 },
    );
  }
};

export const config = { path: '/.netlify/functions/stock-news' };
