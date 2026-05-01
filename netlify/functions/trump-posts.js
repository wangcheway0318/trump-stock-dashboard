// Trump Truth Social 推文：多來源備援
// 來源優先序：
//   1. RSSHub 公開實例（社群維護的 RSS 代理，最常工作）
//   2. Truth Social 官方 API（偶爾有效，常被擋）
//   3. trumpstruth.org HTML 鏡像（最後備援）
//
// 任一來源成功就回傳；全部失敗時回傳清楚的錯誤資訊（含每個來源失敗原因）

const TRUMP_TS_ID = '107780257626128497';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,zh-TW;q=0.8',
};

let cache = { data: null, fetchedAt: 0, source: '' };
const CACHE_TTL = 60 * 1000; // 60 秒

function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

// ===== 來源 1：RSSHub =====
async function fromRSSHub() {
  const endpoints = [
    'https://rsshub.app/truthsocial/user/realDonaldTrump',
    'https://rss.shab.fun/truthsocial/user/realDonaldTrump',
  ];
  let lastErr;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: { ...HEADERS, 'Accept': 'application/rss+xml,application/xml,text/xml' } });
      if (!res.ok) { lastErr = new Error(`${res.status}`); continue; }
      const xml = await res.text();
      if (!xml.includes('<item')) { lastErr = new Error('empty rss'); continue; }
      const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/g)].map((m) => m[0]).slice(0, 20);
      const posts = items.map((block, idx) => {
        const link = (block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '').trim();
        const desc = (block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '').trim();
        const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '').trim();
        const title = (block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').trim();
        const cleanCdata = (s) => s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
        let content = cleanCdata(desc) || cleanCdata(title);
        // 抓出 description 內的圖片 URL
        const media = [...content.matchAll(/<img[^>]+src=["']([^"']+)["']/g)].map((m) => m[1]);
        return {
          id: link || `rsshub-${idx}-${pubDate}`,
          content,
          url: link,
          created_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          media,
        };
      });
      return { posts, source: 'RSSHub' };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('rsshub all failed');
}

// ===== 來源 2：Truth Social 官方 API =====
async function fromTruthSocialAPI() {
  const url = `https://truthsocial.com/api/v1/accounts/${TRUMP_TS_ID}/statuses?limit=20&exclude_replies=true&_=${Date.now()}`;
  const res = await fetch(url, {
    headers: {
      ...HEADERS,
      'Accept': 'application/json',
      'Referer': 'https://truthsocial.com/@realDonaldTrump',
      'Origin': 'https://truthsocial.com',
    },
  });
  if (!res.ok) throw new Error(`api ${res.status}`);
  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error('format');
  const posts = raw.map((it) => ({
    id: it.id,
    created_at: it.created_at,
    content: it.content || '',
    url: it.url,
    media: (it.media_attachments || [])
      .filter((m) => m.type === 'image' && m.preview_url)
      .map((m) => m.preview_url),
  }));
  return { posts, source: 'Truth Social API' };
}

// ===== 來源 3：trumpstruth.org HTML 鏡像 =====
async function fromTrumpsTruth() {
  const res = await fetch('https://trumpstruth.org/', { headers: HEADERS });
  if (!res.ok) throw new Error(`mirror ${res.status}`);
  const html = await res.text();

  // 該站每篇貼文用 <article> 或 <div class="status"> 包起來，內含 .status-body 與時間
  // 為求穩定，使用較寬鬆的正則：找出所有 <a href*="truthsocial.com/...statuses/..."> 與其周邊文字
  const blocks = [...html.matchAll(/<article[\s\S]*?<\/article>/g)].map((m) => m[0]);
  if (blocks.length === 0) throw new Error('no article tags');

  const posts = blocks.slice(0, 20).map((block, idx) => {
    const linkMatch = block.match(/href="(https:\/\/truthsocial\.com\/[^"]+\/statuses\/\d+)"/);
    const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
    // 取主要文字段：移除標籤、合併空白
    const textRaw = block
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<style[\s\S]*?<\/style>/g, '');
    const bodyMatch = textRaw.match(/<div[^>]*class="[^"]*status-body[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const body = (bodyMatch?.[1] || textRaw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const media = [...block.matchAll(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/g)].map((m) => m[1]);
    return {
      id: linkMatch?.[1] || `mirror-${idx}`,
      content: body,
      url: linkMatch?.[1] || 'https://trumpstruth.org/',
      created_at: timeMatch?.[1] || new Date().toISOString(),
      media,
    };
  }).filter((p) => p.content);

  if (posts.length === 0) throw new Error('parse empty');
  return { posts, source: 'trumpstruth.org' };
}

// ===== 主函式 =====
export default async (req, context) => {
  const url = new URL(req.url);
  const debug = url.searchParams.get('debug') === '1';

  // 命中快取
  if (!debug && cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return Response.json({ ...cache.data, cached: true, source: cache.source });
  }

  const sources = [
    { name: 'RSSHub', fn: fromRSSHub },
    { name: 'TruthSocial API', fn: fromTruthSocialAPI },
    { name: 'TrumpsTruth Mirror', fn: fromTrumpsTruth },
  ];

  const errors = [];
  for (const src of sources) {
    try {
      const { posts, source } = await withTimeout(src.fn(), 8000);
      if (posts && posts.length > 0) {
        const payload = { posts, source, fetchedAt: new Date().toISOString() };
        cache = { data: payload, fetchedAt: Date.now(), source };
        return Response.json(debug ? { ...payload, errors } : payload, {
          headers: { 'Cache-Control': 'public, max-age=60' },
        });
      }
      errors.push(`${src.name}: empty`);
    } catch (err) {
      errors.push(`${src.name}: ${err.message}`);
    }
  }

  // 全部來源都失敗，嘗試回傳舊快取
  if (cache.data) {
    return Response.json({ ...cache.data, stale: true, errors });
  }

  return Response.json({
    posts: [],
    error: '所有來源皆失敗',
    errors,
    hint: '可在 URL 加 ?debug=1 看詳細錯誤',
  }, { status: 200 });
};

export const config = { path: '/.netlify/functions/trump-posts' };
