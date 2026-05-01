// 翻譯函式：英文 → 繁體中文
// 使用 Google Translate 公開（非官方）端點，免金鑰
// 注意：這是非官方端點，偶爾會有限制；若失敗會直接回傳原文

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

// 多筆請求合併到一個函式呼叫（用 \n\n 分隔）
export default async (req, context) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const texts = Array.isArray(body.texts) ? body.texts : [];
  const target = body.target || 'zh-TW';
  if (texts.length === 0) {
    return Response.json({ translations: [] });
  }

  // 移除 HTML tag 後翻譯，避免機器翻譯亂掉
  const stripped = texts.map((t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

  // 用罕見分隔符把多筆合併，一次請求即可
  const SEP = '\n@@@\n';
  const joined = stripped.join(SEP);

  try {
    const url = `${ENDPOINT}?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(joined)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 Dashboard',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`translate ${res.status}`);
    const json = await res.json();
    // 回應格式：[[[translatedSegment, original, ...], ...], ...]
    const segments = (json[0] || []).map((seg) => seg[0]).join('');
    const parts = segments.split(/@@@/g).map((s) => s.trim());

    // 若分割後筆數對不上，回傳原文
    const translations = stripped.map((orig, i) => parts[i] || orig);

    return Response.json({ translations }, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (err) {
    return Response.json({
      translations: stripped,
      error: err.message,
    }, { status: 200 });
  }
};

export const config = { path: '/.netlify/functions/translate' };
