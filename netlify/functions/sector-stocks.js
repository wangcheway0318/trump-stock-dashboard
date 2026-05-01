// 取得指定類股當日成交量前 5 名股票
// 用法：/.netlify/functions/sector-stocks?sector=食品類

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 Dashboard',
  'Accept': 'application/json',
  'Referer': 'https://www.twse.com.tw/',
};

// 類股名稱（MI_INDEX type=IND 回傳格式） → TWSE 類股代碼
const SECTOR_NAME_TO_CODE = {
  '水泥工業類指數': '01', '水泥類': '01', '水泥工業類': '01',
  '食品工業類指數': '02', '食品類': '02', '食品工業類': '02',
  '塑膠工業類指數': '03', '塑膠類': '03', '塑膠工業類': '03',
  '紡織纖維類指數': '04', '紡織纖維類': '04', '紡纖類': '04',
  '電機機械類指數': '05', '電機機械類': '05', '電機類': '05',
  '電器電纜類指數': '06', '電器電纜類': '06',
  '化學工業類指數': '21', '化學類': '21', '化學工業類': '21',
  '生技醫療類指數': '22', '生技醫療類': '22', '生醫類': '22',
  '玻璃陶瓷類指數': '08', '玻璃陶瓷類': '08', '玻陶類': '08',
  '造紙工業類指數': '09', '造紙類': '09', '造紙工業類': '09',
  '鋼鐵工業類指數': '10', '鋼鐵類': '10', '鋼鐵工業類': '10',
  '橡膠工業類指數': '11', '橡膠類': '11', '橡膠工業類': '11',
  '汽車工業類指數': '12', '汽車類': '12', '汽車工業類': '12',
  '半導體類指數': '24', '半導體業類': '24', '半導體類': '24', '半導體業': '24',
  '電腦及週邊設備類指數': '25', '電腦及週邊類': '25', '電腦及週邊設備業類': '25', '電腦及週邊設備業': '25',
  '光電類指數': '26', '光電業類': '26', '光電類': '26', '光電業': '26',
  '通信網路類指數': '27', '通信網路業類': '27', '通信網路類': '27', '通信網路業': '27',
  '電子零組件類指數': '28', '電子零組件業類': '28', '電子零組件類': '28', '電子零組件業': '28',
  '電子通路類指數': '29', '電子通路業類': '29', '電子通路類': '29', '電子通路業': '29',
  '資訊服務類指數': '30', '資訊服務業類': '30', '資訊服務類': '30', '資訊服務業': '30',
  '其他電子類指數': '31', '其他電子業類': '31', '其他電子類': '31', '其他電子業': '31',
  '建材營造類指數': '14', '建材營造類': '14',
  '航運業類指數': '15', '航運類': '15', '航運業類': '15',
  '觀光餐旅類指數': '16', '觀光類': '16', '觀光餐旅類': '16', '觀光事業類': '16',
  '金融保險類指數': '17', '金融類': '17', '金融保險類': '17', '金融保險': '17',
  '貿易百貨類指數': '18', '貿易百貨類': '18',
  '油電燃氣類指數': '23', '油電燃氣類': '23',
  '其他類指數': '20', '其他類': '20',
};

function fmtDate(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function findSectorCode(name) {
  if (!name) return null;
  // 直接命中
  if (SECTOR_NAME_TO_CODE[name]) return SECTOR_NAME_TO_CODE[name];
  // 模糊比對：去掉「類」「業」「指數」尾綴
  const norm = (s) => s.replace(/類指數$|類$|業$|工業$/g, '');
  const target = norm(name);
  for (const [key, code] of Object.entries(SECTOR_NAME_TO_CODE)) {
    if (norm(key) === target) return code;
  }
  return null;
}

async function fetchSectorStocks(code, dateStr) {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${dateStr}&type=${code}&response=json`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`twse ${res.status}`);
  const json = await res.json();
  if (json.stat !== 'OK') throw new Error(json.stat || 'no data');

  // tables 通常含「個股日成交資訊」表
  const tbl = (json.tables || []).find((t) =>
    (t.title || '').includes('個股') ||
    (t.fields || []).some((f) => f.includes('證券代號'))
  ) || json.tables?.[0];
  if (!tbl) return [];

  const fields = tbl.fields || [];
  const idx = {
    symbol: fields.findIndex((f) => f.includes('證券代號')),
    name: fields.findIndex((f) => f.includes('證券名稱')),
    volume: fields.findIndex((f) => f.includes('成交股數')),
    price: fields.findIndex((f) => f.includes('收盤價') || f.includes('成交價')),
    change: fields.findIndex((f) => f.includes('漲跌價差')),
  };

  const list = (tbl.data || []).map((row) => ({
    symbol: String(row[idx.symbol] || '').trim(),
    name: String(row[idx.name] || '').trim(),
    volume: parseInt(String(row[idx.volume] || '0').replace(/,/g, ''), 10) || 0,
    price: parseFloat(String(row[idx.price] || '0').replace(/,/g, '')) || 0,
    change: parseFloat(String(row[idx.change] || '0').replace(/[+,]/g, '')) || 0,
  })).filter((s) => s.symbol && /^\d{4,6}[A-Z]?$/.test(s.symbol));

  return list.sort((a, b) => b.volume - a.volume).slice(0, 5);
}

// 簡單記憶體快取，每個類股獨立快取
const cache = new Map(); // code -> { data, fetchedAt }
const TTL = 60 * 1000;

export default async (req, context) => {
  const url = new URL(req.url);
  const sector = (url.searchParams.get('sector') || '').trim();
  if (!sector) {
    return Response.json({ error: '缺少 sector 參數' }, { status: 400 });
  }

  const code = findSectorCode(sector);
  if (!code) {
    return Response.json({
      stocks: [],
      error: `無法對應類股「${sector}」到 TWSE 類股代碼`,
    });
  }

  const cached = cache.get(code);
  if (cached && Date.now() - cached.fetchedAt < TTL) {
    return Response.json(cached.data);
  }

  // 嘗試最近 7 天找有資料的交易日
  const now = new Date();
  let stocks = [];
  let usedDate = null;
  for (let i = 0; i < 7 && stocks.length === 0; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = fmtDate(d);
    try {
      stocks = await fetchSectorStocks(code, ds);
      if (stocks.length > 0) {
        usedDate = `${ds.slice(0,4)}/${ds.slice(4,6)}/${ds.slice(6,8)}`;
      }
    } catch {}
  }

  const payload = {
    sector,
    sectorCode: code,
    date: usedDate,
    stocks,
    fetchedAt: new Date().toISOString(),
  };

  if (stocks.length > 0) {
    cache.set(code, { data: payload, fetchedAt: Date.now() });
  }

  return Response.json(payload, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
};

export const config = { path: '/.netlify/functions/sector-stocks' };
