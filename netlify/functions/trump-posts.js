// Trump Truth Social 推文：多來源備援
//
// Truth Social 對伺服器 IP（特別是 AWS / Netlify）封鎖嚴格，
// 直接 API 呼叫常常 403。下方依序嘗試多種方案，第一個成功的就用：
//
//  1. 透過 CORS 代理（allorigins.win）轉接 Truth Social API
//  2. 透過第二個 CORS 代理（corsproxy.io）轉接
//  3. 多個 RSSHub 公開實例
//  4. trumpstruth.org 鏡像 HTML 解析
//  5. 直接打 Truth Social API（最差的情況）

const TRUMP_TS_ID = '107780257626128497';
const TS_API = `https://truthsocial.com/api/v1/accounts/${TRUMP_TS_ID}/statuses?limit=20&exclude_replies=true`;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,zh-TW;q=0.8',
};

let cache = { data: null, fetchedAt: 0, source: '' };
const CACHE_TTL = 60 * 1000;

function withTimeout(promise, ms = 7000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

function parseTSApiResponse(raw) {
  if (!Array.isArray(raw)) throw new Error('format');
  return raw.map((it) => ({
    id: it.id,
    created_at: it.created_at,
    content: it.content || '',
    url: it.url,
    media: (it.media_attachments || [])
      .filter((m) => m.type === 'image' && m.preview_url)
      .map((m) => m.preview_url),
  }));
}

// ===== 方案 1：AllOrigins 代理 =====
async function fromAllOrigins() {
  const url = `https://api.allorigins.win/raw?url=${encodeURIComponent(TS_API)}`;
  const res = await fetch(url, {
    headers: { ...HEADERS, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`allorigins ${res.status}`);
  const raw = await res.json();
  const posts = parseTSApiResponse(raw);
  return { posts, source: 'AllOrigins → Truth Social' };
}

// ===== 方案 2：corsproxy.io 代理 =====
async function fromCorsProxyIO() {
  const url = `https://corsproxy.io/?${encodeURIComponent(TS_API)}`;
  const res = await fetch(url, {
    headers: { ...HEADERS, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`corsproxy.io ${res.status}`);
  const raw = await res.json();
  const posts = parseTSApiResponse(raw);
  return { posts, source: 'CorsProxy.io → Truth Social' };
}

// ===== 方案 3：多個 RSSHub 實例 =====
async function fromRSSHub() {
  const endpoints = [
    'https://rsshub.app/truthsocial/user/realDonaldTrump',
    'https://rsshub.rssforever.com/truthsocial/user/realDonaldTrump',
    'https://rsshub.feeded.xyz/truthsocial/user/realDonaldTrump',
    'https://rss.shab.fun/truthsocial/user/realDonaldTrump',
  ];
  let lastErr;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { ...HEADERS, 'Accept': 'application/rss+xml,application/xml,text/xml' },
      });
      if (!res.ok) { lastErr = new Error(`${res.status}`); continue; }
      const xml = await res.text();
      if (!xml.includes('<item')) { lastErr = new Error('empty'); continue; }
      const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/g)].map((m) => m[0]).slice(0, 20);
      const posts = items.map((block, idx) => {
        const link = (block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '').trim();
        const desc = (block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '').trim();
        const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '').trim();
        const title = (block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').trim();
        const cleanCdata = (s) => s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
        const content = cleanCdata(desc) || cleanCdata(title);
        const media = [...content.matchAll(/<img[^>]+src=["']([^"']+)["']/g)].map((m) => m[1]);
        return {
          id: link || `rsshub-${idx}-${pubDate}`,
          content,
          url: link,
          created_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          media,
        };
      });
      return { posts, source: `RSSHub (${new URL(url).hostname})` };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('all rsshub failed');
}

// ===== 方案 4：trumpstruth.org 鏡像（更寬鬆的解析） =====
async function fromTrumpsTruth() {
  const res = await fetch('https://trumpstruth.org/', { headers: HEADERS });
  if (!res.ok) throw new Error(`mirror ${res.status}`);
  const html = await res.text();

  // 抓所有指向 truthsocial.com/.../statuses/ 的連結作為錨點
  const linkRegex = /<a[^>]+href="(https:\/\/truthsocial\.com\/[^"]+\/statuses\/\d+)"[^>]*>/g;
  const positions = [];
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    positions.push({ url: m[1], pos: m.index });
  }
  if (positions.length === 0) throw new Error('no status links');

  // 對每個連結往前後找一段文字（最多 2000 字元）
  const seen = new Set();
  const posts = [];
  for (const { url, pos } of positions) {
    if (seen.has(url)) continue;
    seen.add(url);
    const start = Math.max(0, pos - 1500);
    const end = Math.min(html.length, pos + 500);
    const slice = html.slice(start, end);
    // 抽出 datetime
    const timeMatch = slice.match(/<time[^>]*datetime="([^"]+)"/);
    // 抽出主要文字（移除 tags、合併空白）
    const text = slice
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // 取連結 URL 附近的關鍵句子（用 url 做切點）
    const around = text.length > 800 ? text.slice(-800) : text;
    const media = [...slice.matchAll(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/g)].map((m) => m[1]);
    posts.push({
      id: url,
      content: around,
      url,
      created_at: timeMatch?.[1] || new Date().toISOString(),
      media: media.slice(0, 4),
    });
    if (posts.length >= 20) break;
  }
  if (posts.length === 0) throw new Error('parse empty');
  return { posts, source: 'trumpstruth.org' };
}

// ===== 方案 5：直接打 Truth Social API =====
async function fromTruthSocialDirect() {
  const res = await fetch(TS_API, {
    headers: {
      ...HEADERS,
      'Accept': 'application/json',
      'Referer': 'https://truthsocial.com/@realDonaldTrump',
      'Origin': 'https://truthsocial.com',
    },
  });
  if (!res.ok) throw new Error(`api ${res.status}`);
  const raw = await res.json();
  const posts = parseTSApiResponse(raw);
  return { posts, source: 'Truth Social Direct' };
}

// ===== 主函式 =====
export default async (req, context) => {
  const url = new URL(req.url);
  const debug = url.searchParams.get('debug') === '1';

  if (!debug && cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return Response.json({ ...cache.data, cached: true });
  }

  const sources = [
    { name: 'AllOrigins', fn: fromAllOrigins },
    { name: 'CorsProxy.io', fn: fromCorsProxyIO },
    { name: 'RSSHub', fn: fromRSSHub },
    { name: 'TrumpsTruth Mirror', fn: fromTrumpsTruth },
    { name: 'TruthSocial Direct', fn: fromTruthSocialDirect },
  ];

  const errors = [];
  for (const src of sources) {
    try {
      const { posts, source } = await withTimeout(src.fn(), 7000);
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

  if (cache.data) {
    return Response.json({ ...cache.data, stale: true, errors });
  }

  return Response.json({
    posts: [],
    error: '所有來源皆失敗',
    errors,
    hint: '可在 URL 加 ?debug=1 看詳細錯誤；若全部失敗，建議切換為「嵌入官方 widget」模式（無翻譯）',
  }, { status: 200 });
};

export const config = { path: '/.netlify/functions/trump-posts' };
