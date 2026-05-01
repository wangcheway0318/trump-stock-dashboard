// 抓取台灣證券交易所「三大法人買賣超」資料
// 官方公開 API，免註冊、免金鑰
// https://www.twse.com.tw/zh/page/trading/fund/BFI82U.html

let cache = { data: null, fetchedAt: 0 };
const CACHE_TTL = 30 * 1000; // 30 秒

function fmtDate(d) {
  // 西元日期 → YYYYMMDD
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

async function fetchTwse(dateStr) {
  const url = `https://www.twse.com.tw/rwd/zh/fund/BFI82U?dayDate=${dateStr}&type=day&response=json`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 Dashboard',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`TWSE 回應 ${res.status}`);
  return res.json();
}

function parseTwse(json) {
  // 回應格式：{ stat: 'OK', date: 'YYYYMMDD', fields: [...], data: [[...], ...] }
  if (!json || json.stat !== 'OK' || !Array.isArray(json.data)) return null;

  const investors = [];
  for (const row of json.data) {
    // row: [單位, 買進金額, 賣出金額, 買賣差額]
    const name = row[0]?.trim();
    const buy = parseFloat(String(row[1]).replace(/,/g, '')) || 0;
    const sell = parseFloat(String(row[2]).replace(/,/g, '')) || 0;
    const net = parseFloat(String(row[3]).replace(/,/g, '')) || 0;

    // 篩選三大法人主類別
    if (name && (name.includes('外資') || name.includes('投信') || name.includes('自營商'))) {
      // 只取「合計」類，避免重複（外資及陸資 = 外資及陸資（不含外資自營商) + 外資自營商）
      // 自營商也分「自營商(自行買賣)」與「自營商(避險)」，TWSE 直接回傳細項
      investors.push({ name, buy, sell, netBuySell: net });
    }
  }

  // 將同類合併（依名稱開頭分組）
  const grouped = {};
  for (const inv of investors) {
    let key = '其他';
    if (inv.name.includes('外資')) key = '外資';
    else if (inv.name.includes('投信')) key = '投信';
    else if (inv.name.includes('自營商')) key = '自營商';

    if (!grouped[key]) grouped[key] = { name: key, buy: 0, sell: 0, netBuySell: 0 };
    grouped[key].buy += inv.buy;
    grouped[key].sell += inv.sell;
    grouped[key].netBuySell += inv.netBuySell;
  }

  const order = ['外資', '投信', '自營商'];
  const result = order.map((k) => grouped[k]).filter(Boolean);

  // 格式化日期
  let dateLabel = json.date;
  if (dateLabel && dateLabel.length === 8) {
    dateLabel = `${dateLabel.slice(0,4)}/${dateLabel.slice(4,6)}/${dateLabel.slice(6,8)}`;
  }

  return { date: dateLabel, investors: result };
}

export default async (req, context) => {
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return Response.json(cache.data, {
      headers: { 'Cache-Control': 'public, max-age=30' },
    });
  }

  try {
    // 從今天往前找最近一個有資料的交易日（最多回溯 7 天）
    let result = null;
    const now = new Date();
    for (let i = 0; i < 7 && !result; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const json = await fetchTwse(fmtDate(d));
      const parsed = parseTwse(json);
      if (parsed && parsed.investors.length > 0) result = parsed;
    }

    if (!result) throw new Error('近 7 日皆無資料');

    const payload = { ...result, fetchedAt: new Date().toISOString() };
    cache = { data: payload, fetchedAt: Date.now() };

    return Response.json(payload, {
      headers: { 'Cache-Control': 'public, max-age=30' },
    });
  } catch (err) {
    if (cache.data) {
      return Response.json(
        { ...cache.data, stale: true, error: err.message },
        { headers: { 'Cache-Control': 'public, max-age=10' } },
      );
    }
    return Response.json(
      { investors: [], error: '無法取得三大法人資料：' + err.message },
      { status: 200 },
    );
  }
};

export const config = { path: '/.netlify/functions/institutional-investors' };
