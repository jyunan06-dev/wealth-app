// api/stock.js  — Vercel Serverless Function
// 台股：台灣證交所 + 櫃買中心官方 API（免費，無需 Key）
// 美股：Yahoo Finance v8（無需 Key）

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbol, market } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  try {
    if (market === "TW") {
      const data = await fetchTW(symbol);
      return res.status(200).json(data);
    } else {
      const data = await fetchUS(symbol);
      return res.status(200).json(data);
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── 台股：證交所 + 櫃買 ──────────────────────────────────────────────────────
async function fetchTW(symbol) {
  // 先試證交所（上市）
  try {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_${symbol}.tw&json=1&delay=0`;
    const r = await fetch(url, { headers: { "Referer": "https://mis.twse.com.tw/" } });
    const d = await r.json();
    const item = d?.msgArray?.[0];
    if (item && item.z !== "-") {
      const price  = parseFloat(item.z || item.y);   // z=現價, y=昨收
      const prev   = parseFloat(item.y);
      const open   = parseFloat(item.o);
      const high   = parseFloat(item.h);
      const low    = parseFloat(item.l);
      const vol    = parseInt(item.v || 0);
      const name   = item.n || symbol;
      return { symbol, market:"TW", name, price, prev, open, high, low, vol,
               change: price - prev, changePct: (price-prev)/prev*100,
               source: "TWSE", time: new Date().toISOString() };
    }
  } catch {}

  // 試櫃買（上櫃）
  try {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=otc_${symbol}.tw&json=1&delay=0`;
    const r = await fetch(url, { headers: { "Referer": "https://mis.twse.com.tw/" } });
    const d = await r.json();
    const item = d?.msgArray?.[0];
    if (item && item.z !== "-") {
      const price = parseFloat(item.z || item.y);
      const prev  = parseFloat(item.y);
      return { symbol, market:"TW", name: item.n||symbol, price, prev,
               open: parseFloat(item.o), high: parseFloat(item.h), low: parseFloat(item.l),
               vol: parseInt(item.v||0), change: price-prev, changePct: (price-prev)/prev*100,
               source: "TPEx", time: new Date().toISOString() };
    }
  } catch {}

  // Fallback: Yahoo Finance for TW
  return await fetchUS(symbol + ".TW");
}

// ── 美股：Yahoo Finance v8 ────────────────────────────────────────────────────
async function fetchUS(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; WealthApp/1.0)",
      "Accept": "application/json",
    }
  });
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
  const d = await r.json();
  const result = d?.chart?.result?.[0];
  if (!result) throw new Error("No data from Yahoo");

  const meta   = result.meta;
  const closes = result.indicators?.quote?.[0]?.close?.filter(Boolean) || [];
  const price  = meta.regularMarketPrice || closes[closes.length-1];
  const prev   = meta.previousClose || closes[closes.length-2] || price;

  return {
    symbol: meta.symbol,
    market: symbol.endsWith(".TW") ? "TW" : "US",
    name:   meta.shortName || symbol,
    price:  +price.toFixed(2),
    prev:   +prev.toFixed(2),
    open:   +(meta.regularMarketOpen||price).toFixed(2),
    high:   +(meta.regularMarketDayHigh||price).toFixed(2),
    low:    +(meta.regularMarketDayLow||price).toFixed(2),
    vol:    meta.regularMarketVolume || 0,
    change: +(price-prev).toFixed(2),
    changePct: +((price-prev)/prev*100).toFixed(3),
    source: "Yahoo",
    time:   new Date().toISOString(),
  };
}
