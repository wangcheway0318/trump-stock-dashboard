// 大盤總覽：加權指數 + 類股漲跌 + 當日成交量前十
// 全部使用台灣證交所公開 API（免金鑰）

let cache = { data: null, fetchedAt: 0 };
const CACHE_TTL = 30 * 1000; // 30 秒

function fmtDate(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Dashboard',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-TW,zh;q=0.9',
  'Referer': 'https://www.twse.com.tw/',
};

// 真正的產業類股白名單（過濾掉「主題式指數」「兩倍槓桿指數」等）
const VALID_SECTORS = new Set([
  '水泥類', '食品類', '塑膠類', '紡織纖維類', '電機機械類', '電器電纜類',
  '化學類', '化學工業類', '生技醫療類', '生技類', '玻璃陶瓷類', '造紙類',
  '鋼鐵類', '橡膠類', '汽車類',
  '半導體業', '半導體類', '電腦及週邊設備業', '電腦及週邊類',
  '光電業', '光電類', '通信網路業', '通信網路類',
  '電子零組件業', '電子零組件類', '電子通路業', '電子通路類',
  '資訊服務業', '資訊服務類', '其他電子業', '其他電子類',
  '建材營造類', '航運類', '航運業', '觀光餐旅類', '觀光類', '觀光事業類',
  '金融保險類', '金融類', '貿易百貨類', '油電燃氣類', '其他類',
  '電子類', '電子工業類',
]);

function isValidSector(name) {
  if (!name) return false;
  if (VALID_SECTORS.has(name)) return true;
  // 排除已知不要的關鍵字
  const blacklist = ['兩倍', '反向', '槓桿', '主題', '50', '100', '高薪', '公司治理',
                      '寶島', '未含金融', '日報酬', 'ESG', '永續', '高息', '高股息',
                      '電動車', 'AI', '半導體 30', '臺指', '台指', '臺灣 50', '臺灣50'];
  if (blacklist.some((kw) => name.includes(kw))) return false;
  // 寬鬆規則：「XX 類」「XX 業」格式且名稱長度合理
  return /^[一-龥]{2,8}[類業]$/.test(name);
}

// 1) 加權指數即時值
async function fetchTaiex() {
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0&_=${Date.now()}`;
  try {
    const res = await fetch(url, { headers: COMMON_HEADERS });
    if (!res.ok) throw new Error(`mis ${res.status}`);
    const json = await res.json();
    const item = json?.msgArray?.[0];
    if (!item) throw new Error('no data');
    const last = parseFloat(item.z) || parseFloat(item.y) || 0;
    const yesterday = parseFloat(item.y) || 0;
    const change = last - yesterday;
    const changePercent = yesterday ? (change / yesterday) * 100 : 0;
    return { value: last, change, changePercent, time: item.t || null };
  } catch (err) {
    return null;
  }
}

// 2) 類股漲跌
async function fetchSectors(dateStr) {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${dateStr}&type=IND&response=json`;
  try {
    const res = await fetch(url, { headers: COMMON_HEADERS });
    if (!res.ok) throw new Error(`sectors ${res.status}`);
    const json = await res.json();
    if (json.stat !== 'OK') throw new Error(json.stat || 'no data');

    // 從所有 tables 裡掃描，把符合「真正類股」的列收集起來
    const collected = new Map(); // name -> entry
    for (const table of (json.tables || [])) {
      const data = table.data || [];
      for (const row of data) {
        const name = String(row[0] || '').trim();
        if (!isValidSector(name)) continue;
        // 嘗試解析欄位：通常為 [名稱, 收盤指數, 漲跌(±值), 漲跌百分比]
        // 但格式可能不同，用啟發式：找出包含 '%' 的欄位當百分比，以及 ▲/▽ 符號
        let change = 0;
        let changePercent = 0;
        for (let i = 1; i < row.length; i++) {
          const cell = String(row[i] || '');
          if (cell.includes('%')) {
            const num = parseFloat(cell.replace(/[%,+]/g, ''));
            if (!isNaN(num)) {
              const sign = cell.includes('▽') || cell.includes('-') ? -1 : 1;
              changePercent = num * sign;
            }
          } else if (cell.includes('▲') || cell.includes('▽')) {
            const num = parseFloat(cell.replace(/[▲▽,+]/g, ''));
            if (!isNaN(num)) {
              const sign = cell.includes('▽') ? -1 : 1;
              change = num * sign;
            }
          }
        }
        if (!collected.has(name) || Math.abs(changePercent) > Math.abs(collected.get(name).changePercent)) {
          collected.set(name, { name, change, changePercent });
        }
      }
    }
    return [...collected.values()];
  } catch {
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
  } catch {
    return [];
  }
}

export default async (req, context) => {
  if (cache.data && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return Response.json(cache.data, { headers: { 'Cache-Control': 'public, max-age=30' } });
  }

  const now = new Date();
  let sectors = [], topVolume = [], usedDate = null;

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
    taiex, sectors, topVolume, date: usedDate,
    fetchedAt: new Date().toISOString(),
  };

  if (taiex || sectors.length > 0 || topVolume.length > 0) {
    cache = { data: payload, fetchedAt: Date.now() };
  }

  return Response.json(payload, { headers: { 'Cache-Control': 'public, max-age=30' } });
};

export const config = { path: '/.netlify/functions/market-overview' };
