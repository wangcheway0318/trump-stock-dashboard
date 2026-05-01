// 大盤總覽：加權指數 + 類股漲跌 + 當日成交量前十
// 全部使用台灣證交所公開 API（免金鑰）

let cache = { data: null, fetchedAt: 0 };
const CACHE_TTL = 30 * 1000; // 30 秒

function fmtDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Dashboard',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-TW,zh;q=0.9',
  'Referer': 'https://www.twse.com.tw/',
};

// 1) 加權指數即時值
async function fetchTaiex() {
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0&_=${Date.now()}`;
  try {
    const res = await fetch(url, { headers: COMMON_HEADERS });
    if (!res.ok) throw new Error(`mis ${res.status}`);
    const json = await res.json();
    const item = json?.msgArray?.[0];
    if (!item) throw new Error('no data');
    const last = parseFloat(item.z) || parseFloat(item.y) || 0;     // 最新價
    const yesterday = parseFloat(item.y) || 0;                       // 昨收
    const change = last - yesterday;
    const changePercent = yesterday ? (change / yesterday) * 100 : 0;
    return {
      value: last,
      change,
      changePercent,
      time: item.t || null,
    };
  } catch (err) {
    return null;
  }
}

// 2) 類股漲跌（透過當日報表）
async function fetchSectors(dateStr) {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${dateStr}&type=IND&response=json`;
  try {
    const res = await fetch(url, { headers: COMMON_HEADERS });
    if (!res.ok) throw new Error(`sectors ${res.status}`);
    const json = await res.json();
    if (json.stat !== 'OK') throw new Error(json.stat || 'no data');

    // tables[0] 通常是「漲跌價及百分比」
    const table = (json.tables || []).find((t) => t.title?.includes('漲跌'))
      || json.tables?.[0];
    if (!table) throw new Error('no table');

    const sectors = (table.data || [])
      .map((row) => {
        const name = String(row[0] || '').trim();
        const direction = String(row[1] || '').trim(); // ▲ or ▽
        const change = parseFloat(String(row[2] || '0').replace(/,/g, '')) || 0;
        const changePercent = parseFloat(String(row[3] || '0').replace(/[%,]/g, '')) || 0;
        const sign = direction.includes('▽') || direction === '-' ? -1 : 1;
        return {
          name,
          change: change * sign,
          changePercent: changePercent * sign,
        };
      })
      .filter((s) => s.name && s.name !== '發行量加權股價指數');

    return sectors;
  } catch (err) {
    return [];
  }
}

// 3) 成交量前十名
async function fetchTopVolume(dateStr) {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX20?date=${dateStr}&response=json`;
  try {
    const res = await fetch(url, { headers: COMMON_HEADERS });
    if (!res.ok) throw new Error(`vol ${res.status}`);
    const json = await res.json();
    if (json.stat !== 'OK') throw new Error(json.stat || 'no data');

    const fields = json.fields || [];
    const volIdx = fields.findIndex((f) => f.includes('成交股數'));
    const priceIdx = fields.findIndex((f) => f.includes('成交價') || f.includes('收盤'));
    const changeIdx = fields.findIndex((f) => f.includes('漲跌'));

    const list = (json.data || []).map((row) => {
      const symbol = String(row[1] || '').trim();
      const name = String(row[2] || '').trim();
      const volume = parseInt(String(row[volIdx >= 0 ? volIdx : 3] || '0').replace(/,/g, ''), 10) || 0;
      const price = parseFloat(String(row[priceIdx >= 0 ? priceIdx : 7] || '0').replace(/,/g, '')) || 0;
      const changeRaw = String(row[changeIdx >= 0 ? changeIdx : 9] || '0');
      const change = parseFloat(changeRaw.replace(/[+,]/g, '')) || 0;
      return { symbol, name, volume, price, change };
    });

    return list.slice(0, 10);
  } catch (err) {
    return [];
  }
}

export default async (req, context) => {
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return Response.json(cache.data, {
      headers: { 'Cache-Control': 'public, max-age=30' },
    });
  }

  // 試最近 7 天，找有資料的交易日
  const now = new Date();
  let dateStr = fmtDate(now);
  let sectors = [];
  let topVolume = [];
  let usedDate = null;

  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = fmtDate(d);
    const [s, v] = await Promise.all([fetchSectors(ds), fetchTopVolume(ds)]);
    if (s.length > 0 || v.length > 0) {
      sectors = s;
      topVolume = v;
      usedDate = `${ds.slice(0,4)}/${ds.slice(4,6)}/${ds.slice(6,8)}`;
      break;
    }
  }

  const taiex = await fetchTaiex();

  const payload = {
    taiex,
    sectors,
    topVolume,
    date: usedDate,
    fetchedAt: new Date().toISOString(),
  };

  if (taiex || sectors.length > 0 || topVolume.length > 0) {
    cache = { data: payload, fetchedAt: Date.now() };
  }

  return Response.json(payload, {
    headers: { 'Cache-Control': 'public, max-age=30' },
  });
};

export const config = { path: '/.netlify/functions/market-overview' };
