// 抓取 Trump 在 Truth Social 的最新貼文
// Trump 的 Truth Social 帳號 ID（公開資訊）
const TRUMP_ID = '107780257626128497';
const TRUMP_API = `https://truthsocial.com/api/v1/accounts/${TRUMP_ID}/statuses?limit=20&exclude_replies=true`;

// 簡單的記憶體快取（每個函式實例獨立，避免短時間內重複請求被擋）
let cache = { data: null, fetchedAt: 0 };
const CACHE_TTL = 30 * 1000; // 30 秒

export default async (req, context) => {
  // 命中快取
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return Response.json(cache.data, {
      headers: { 'Cache-Control': 'public, max-age=30' },
    });
  }

  try {
    const res = await fetch(TRUMP_API, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Truth Social 回應狀態：${res.status}`);
    }

    const raw = await res.json();
    if (!Array.isArray(raw)) throw new Error('回應格式不符');

    const posts = raw.map((item) => ({
      id: item.id,
      created_at: item.created_at,
      content: item.content || '',
      url: item.url,
      media: (item.media_attachments || [])
        .filter((m) => m.type === 'image' && m.preview_url)
        .map((m) => m.preview_url),
    }));

    const payload = { posts, fetchedAt: new Date().toISOString() };
    cache = { data: payload, fetchedAt: Date.now() };

    return Response.json(payload, {
      headers: { 'Cache-Control': 'public, max-age=30' },
    });
  } catch (err) {
    // 失敗時若有舊快取就回舊資料，否則回錯誤訊息
    if (cache.data) {
      return Response.json(
        { ...cache.data, stale: true, error: err.message },
        { headers: { 'Cache-Control': 'public, max-age=10' } },
      );
    }
    return Response.json(
      { posts: [], error: '無法取得 Truth Social 資料：' + err.message },
      { status: 200 },
    );
  }
};

export const config = { path: '/.netlify/functions/trump-posts' };
