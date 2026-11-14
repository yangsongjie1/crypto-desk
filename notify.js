(function ENGINE() {
const TF_MS = { "1d": 86400000, "4h": 14400000, "30m": 1800000, "5m": 300000 };
const WARMUP = 200;
function ema(x, n) {
  const a = 2 / (n + 1), o = new Float64Array(x.length);
  o[0] = x[0];
  for (let i = 1; i < x.length; i++) o[i] = a * x[i] + (1 - a) * o[i - 1];
  return o;
}
function rsi(c, n = 14) {
  const L = c.length, o = new Float64Array(L).fill(50), a = 1 / n;
  let up = 0, dn = 0;
  for (let i = 1; i < L; i++) {
    const d = c[i] - c[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
    if (i === 1) { up = u; dn = w; } else { up = a * u + (1 - a) * up; dn = a * w + (1 - a) * dn; }
    o[i] = dn === 0 ? 50 : 100 - 100 / (1 + up / dn);
  }
  return o;
}
function atr(h, l, c, n = 14) {
  const L = c.length, o = new Float64Array(L), a = 1 / n;
  for (let i = 0; i < L; i++) {
    const tr = i === 0 ? h[0] - l[0]
      : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    o[i] = i === 0 ? tr : a * tr + (1 - a) * o[i - 1];
  }
  return o;
}
function rollPrev(x, n, fn) {
  const L = x.length, o = new Float64Array(L).fill(NaN);
  for (let i = n; i < L; i++) {
    let v = x[i - n];
    for (let j = i - n + 1; j < i; j++) v = fn(v, x[j]);
    o[i] = v;
  }
  return o;
}
function supertrend(h, l, c, n = 10, mult = 3) {
  const L = c.length, a = atr(h, l, c, n);
  const ub = new Float64Array(L), lb = new Float64Array(L), d = new Int8Array(L).fill(1);
  for (let i = 0; i < L; i++) { const m = (h[i] + l[i]) / 2; ub[i] = m + mult * a[i]; lb[i] = m - mult * a[i]; }
  const fub = Float64Array.from(ub), flb = Float64Array.from(lb);
  for (let i = 1; i < L; i++) {
    fub[i] = (ub[i] < fub[i - 1] || c[i - 1] > fub[i - 1]) ? ub[i] : fub[i - 1];
    flb[i] = (lb[i] > flb[i - 1] || c[i - 1] < flb[i - 1]) ? lb[i] : flb[i - 1];
    if (d[i - 1] === -1 && c[i] > fub[i - 1]) d[i] = 1;
    else if (d[i - 1] === 1 && c[i] < flb[i - 1]) d[i] = -1;
    else d[i] = d[i - 1];
  }
  return d;
}
function prepare(k) {
  const { h, l, c } = k;
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const m = e12.map((v, i) => v - e26[i]);
  const hh20 = rollPrev(h, 20, Math.max), ll10 = rollPrev(l, 10, Math.min), ll20 = rollPrev(l, 20, Math.min);
  return {
    ema20: ema(c, 20), ema50: ema(c, 50), ema200: ema(c, 200),
    rsi: rsi(c), atr: atr(h, l, c), hh20, ll10,
    mid20: hh20.map((v, i) => (v + ll20[i]) / 2),
    macd: m, macd_sig: ema(m, 9), st: supertrend(h, l, c),
  };
}
const STRATEGIES = [
  { id: "ema_trend",
    fn(c, I) {
      const L = c.length, pos = new Int8Array(L), bear = new Uint8Array(L);
      for (let i = 0; i < L; i++) {
        pos[i] = c[i] > I.ema200[i] && I.ema20[i] > I.ema50[i] ? 1 : 0;
        bear[i] = c[i] < I.ema200[i] && I.ema20[i] < I.ema50[i] ? 1 : 0;
      }
      return { pos, bear };
    } },
  { id: "donchian",
    fn(c, I) {
      const L = c.length, pos = new Int8Array(L), bear = new Uint8Array(L);
      let hold = 0;
      for (let i = 0; i < L; i++) {
        if (!hold && c[i] > I.hh20[i]) hold = 1;
        else if (hold && c[i] < I.ll10[i]) hold = 0;
        pos[i] = hold;
        bear[i] = !hold && c[i] < I.mid20[i] ? 1 : 0;
      }
      return { pos, bear };
    } },
  { id: "supertrend",
    fn(c, I) {
      const L = c.length, pos = new Int8Array(L), bear = new Uint8Array(L);
      for (let i = 0; i < L; i++) { pos[i] = I.st[i] === 1 ? 1 : 0; bear[i] = I.st[i] === -1 ? 1 : 0; }
      return { pos, bear };
    } },
  { id: "macd",
    fn(c, I) {
      const L = c.length, pos = new Int8Array(L), bear = new Uint8Array(L);
      for (let i = 0; i < L; i++) {
        pos[i] = I.macd[i] > I.macd_sig[i] && c[i] > I.ema200[i] ? 1 : 0;
        bear[i] = I.macd[i] < I.macd_sig[i] && c[i] < I.ema200[i] ? 1 : 0;
      }
      return { pos, bear };
    } },
  { id: "rsi_pullback",
    fn(c, I) {
      const L = c.length, pos = new Int8Array(L), bear = new Uint8Array(L), r = I.rsi, e = I.ema200;
      let hold = 0;
      for (let i = 0; i < L; i++) {
        if (i > 0) {
          if (!hold && c[i] > e[i] && r[i - 1] < 35 && r[i] >= 35) hold = 1;
          else if (hold && (r[i] > 65 || c[i] < e[i])) hold = 0;
        }
        pos[i] = hold;
        bear[i] = c[i] < e[i] ? 1 : 0;
      }
      return { pos, bear };
    } },
];
function backtest(k, pos, fee, slip, start = WARMUP) {
  const { o, c, ts } = k, n = c.length;
  if (n < start + 30) return null;
  let eq = 1, peak = 1, mdd = 0, units = 0, cost = 0, inpos = false, barsIn = 0;
  const trades = [];
  for (let i = start + 1; i < n; i++) {
    const want = pos[i - 1];
    if (want && !inpos) { const entry = o[i] * (1 + slip); units = eq * (1 - fee) / entry; cost = eq; inpos = true; }
    else if (!want && inpos) { eq = units * o[i] * (1 - slip) * (1 - fee); trades.push(eq / cost - 1); inpos = false; }
    const mark = inpos ? units * c[i] * (1 - fee) : eq;
    if (inpos) barsIn++;
    peak = Math.max(peak, mark);
    mdd = Math.min(mdd, mark / peak - 1);
  }
  const final = inpos ? units * c[n - 1] * (1 - fee) : eq;
  let wins = 0, losses = 0, nw = 0;
  for (const t of trades) { if (t > 0) { wins += t; nw++; } else losses -= t; }
  return {
    trades: trades.length, open: inpos,
    win_rate: trades.length ? nw / trades.length : null,
    pf: losses > 0 ? wins / losses : null,
    net: final - 1, buy_hold: c[n - 1] / o[start + 1] - 1,
    max_dd: mdd, exposure: barsIn / (n - start - 1), from: ts[start + 1],
  };
}
function grade(bt) {
  if (!bt || bt.trades < 8) return "样本不足";
  const pf = bt.pf ?? 99;
  if (pf < 1 || bt.net <= 0) return "回测亏损";
  if (pf >= 1.3) return "回测为正";
  return "接近打平";
}
function analyze(k, fee, slip) {
  const I = prepare(k), c = k.c, n = c.length;
  const strategies = STRATEGIES.map(S => {
    const { pos, bear } = S.fn(c, I);
    pos.fill(0, 0, WARMUP); bear.fill(0, 0, WARMUP);
    const bt = backtest(k, pos, fee, slip);
    const p1 = pos[n - 1], p0 = pos[n - 2];
    const action = p1 && !p0 ? "buy" : p0 && !p1 ? "sell" : p1 ? "hold" : bear[n - 1] ? "avoid" : "wait";
    return { id: S.id, action, long: !!p1, backtest: bt, grade: grade(bt) };
  });
  return { last_bar: k.ts[n - 1], last_close: c[n - 1], atr: I.atr[n - 1], bars: n, strategies };
}
Object.assign(globalThis, { TF_MS, WARMUP, STRATEGIES, analyze });
})();
(function MAIN() {
const fs = require("fs");
const KEY = (process.env.BARK_KEY || "").trim().replace(/^https?:\/\/api\.day\.app\//, "").replace(/\/.*$/, "");
const PAGE = "https://yangsongjie1.github.io/crypto-desk/";
// 4 小时做空：13 个主流币；日线趋势做多：38 个币（筛选规则见网页「设置 → 常见问题」）
const SHORT_SET = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "LTC", "DOT", "TRX", "BCH"], QUOTE = "USDT";
const SYMBOLS = [...SHORT_SET, "ZEC", "NEAR", "SUI", "PEPE", "WLD", "UNI", "QNT", "AAVE", "FET", "LIT", "INJ", "ARB", "FIL", "HBAR", "TIA", "XLM", "SAND", "APT", "GTC", "RLC", "ICP", "OP", "DASH", "OGN", "SEI"];
const HISTORY = { "1d": 1000, "4h": 2000 };
const STEP = { "1d": 86400000, "4h": 14400000 };
const fmt = p => p >= 1000 ? p.toFixed(2) : p >= 10 ? p.toFixed(3) : p >= 1 ? p.toFixed(4) : p.toFixed(5);
const sgn = x => (x >= 0 ? "+" : "") + x.toFixed(1) + "%";
async function getJSON(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "crypto-desk" } }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
const rows = (map, total) => [...map.values()].sort((a, b) => a[0] - b[0]).slice(-total);
async function binanceLike(host, b, tf, total) {
  const out = new Map(); let start = Date.now() - total * STEP[tf];
  for (let p = 0; p < 8; p++) {
    const j = await getJSON(`${host}/api/v3/klines?symbol=${b}${QUOTE}&interval=${tf}&startTime=${start}&limit=1000`);
    if (!Array.isArray(j)) throw new Error("bad response"); if (!j.length) break;
    for (const r of j) out.set(r[0], [r[0], +r[1], +r[2], +r[3], +r[4]]);
    if (j.length < 1000) break; start = j[j.length - 1][0] + 1;
  }
  return rows(out, total);
}
const SOURCES = [
  { name: "Bybit", async klines(b, tf, total) {
      const iv = { "1d": "D", "4h": "240" }[tf], out = new Map(); let end = Date.now();
      for (let p = 0; p < 8 && out.size < total; p++) {
        const j = await getJSON(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${b}${QUOTE}&interval=${iv}&end=${end}&limit=1000`);
        if (j.retCode !== 0) throw new Error(j.retMsg); const list = j.result.list; if (!list.length) break;
        for (const r of list) out.set(+r[0], [+r[0], +r[1], +r[2], +r[3], +r[4]]);
        if (list.length < 1000) break; end = +list[list.length - 1][0] - 1;
      }
      return rows(out, total);
    } },
  { name: "OKX", async klines(b, tf, total) {
      const bar = { "1d": "1Dutc", "4h": "4H" }[tf], out = new Map(); let after = "";
      for (let p = 0; p < Math.ceil(total / 100) + 2 && out.size < total; p++) {
        const j = await getJSON(`https://www.okx.com/api/v5/market/history-candles?instId=${b}-${QUOTE}&bar=${bar}&limit=100${after ? "&after=" + after : ""}`);
        if (j.code !== "0") throw new Error(j.msg); if (!j.data.length) break;
        for (const r of j.data) out.set(+r[0], [+r[0], +r[1], +r[2], +r[3], +r[4]]);
        after = j.data[j.data.length - 1][0]; if (j.data.length < 100) break;
      }
      return rows(out, total);
    } },
  { name: "Gate", async klines(b, tf, total) {
      const step = STEP[tf] / 1000, nowS = Math.floor(Date.now() / 1000), out = new Map(); let from = nowS - total * step;
      for (let p = 0; p < 8; p++) {
        const to = Math.min(nowS, from + 999 * step);
        const j = await getJSON(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${b}_${QUOTE}&interval=${tf}&from=${from}&to=${to}`);
        if (!Array.isArray(j)) throw new Error(j.message || "gate error");
        for (const r of j) { const t = +r[0] * 1000; out.set(t, [t, +r[5], +r[3], +r[4], +r[2]]); }
        if (to >= nowS) break; from = to + 1;
      }
      return rows(out, total);
    } },
  { name: "Binance", klines: (b, tf, total) => binanceLike("https://data-api.binance.vision", b, tf, total) },
  { name: "Binance.US", klines: (b, tf, total) => binanceLike("https://api.binance.us", b, tf, total) },
];
SOURCES.unshift(SOURCES.splice(SOURCES.findIndex(s => s.name === "Gate"), 1)[0]);
let preferred = 0;
async function klines(b, tf, total = HISTORY[tf]) {
  const order = [preferred, ...SOURCES.map((_, i) => i).filter(i => i !== preferred)], errs = [];
  for (const i of order) {
    try { const r = await SOURCES[i].klines(b, tf, total); if (r.length < Math.min(400, total - 1)) throw new Error("only " + r.length + " bars"); preferred = i; return [r, SOURCES[i].name]; }
    catch (e) { errs.push(SOURCES[i].name + ": " + e.message); }
  }
  throw new Error(errs.join("; "));
}
// 资金费率（2026-11-06 回测）：取过去 7 天的结算记录，依次试 Binance 合约、Gate、OKX
async function funding(b) {
  const since = Date.now() - 7 * 86400000, tries = [
    async () => (await getJSON(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${b}${QUOTE}&startTime=${since}&limit=100`)).map(x => [+x.fundingTime, +x.fundingRate]),
    async () => (await getJSON(`https://api.gateio.ws/api/v4/futures/usdt/funding_rate?contract=${b}_${QUOTE}&limit=60`)).map(x => [+x.t * 1000, +x.r]),
    async () => (await getJSON(`https://www.okx.com/api/v5/public/funding-rate-history?instId=${b}-${QUOTE}-SWAP&limit=60`)).data.map(x => [+x.fundingTime, +(x.realizedRate || x.fundingRate)]),
  ];
  for (const f of tries) {
    try {
      const r = (await f()).filter(x => x[0] >= since && isFinite(x[1])).sort((a, c) => a[0] - c[0]);
      if (r.length < 3) continue;
      const last3 = r.slice(-3), days = Math.max((Date.now() - r[0][0]) / 86400000, 1);
      // now：最近 3 次结算的平均（回测口径）；carry：买现货+等量空单的本金年化（一半现货一半保证金）
      return { now: last3.reduce((s, x) => s + x[1], 0) / 3, carry: r.reduce((s, x) => s + x[1], 0) / days * 365 * 0.5 };
    } catch (e) {}
  }
  return null;
}
function toK(arr, tf) {
  const now = Date.now(), r = arr.filter(x => x[0] + STEP[tf] <= now), k = { ts: r.map(x => x[0]) };
  ["o", "h", "l", "c"].forEach((f, i) => { k[f] = Float64Array.from(r, x => x[i + 1]); });
  return k;
}
// 做空反弹门槛（2026-11-14 回测，13 个币，A 级 + 资金费率 >0，真实资金费）：RSI 从 65 降到 60
//   近 1000 天：64 笔 → 114 笔，合计 +220% → +246%，PF 3.27 → 2.14，年化 7.8% → 8.3%，回撤 −6.6% → −8.2%
//   2018～2024-02：93 笔 → 179 笔，合计 +113% → +311%，PF 1.37 → 1.65，年化 1.4% → 4.5%，回撤 −12.0% → −11.4%
//   62 结果相近；55 明显变差（PF 1.31 / 1.14）。同时测过去掉资金费率条件、转空放宽到 45 天、日线方向只看 EMA200：多出来的单子老数据都亏，不采用
const SHORT_RSI_IN = 60;
function swingCalc(k4, k1) {
  const H = 14400000, D = 86400000, W = 200, FEE = 0.001, SLIP = 0.0005, FUND = 0.00005;
  const ema = (x, n) => { const a = 2 / (n + 1), o = new Float64Array(x.length); o[0] = x[0]; for (let i = 1; i < x.length; i++) o[i] = a * x[i] + (1 - a) * o[i - 1]; return o; };
  const rsiF = (c, n) => { const L = c.length, o = new Float64Array(L).fill(50), a = 1 / n; let up = 0, dn = 0;
    for (let i = 1; i < L; i++) { const d = c[i] - c[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
      if (i === 1) { up = u; dn = w; } else { up = a * u + (1 - a) * up; dn = a * w + (1 - a) * dn; } o[i] = dn === 0 ? 50 : 100 - 100 / (1 + up / dn); } return o; };
  const c = k4.c, o = k4.o, n = c.length, e200 = ema(c, 200), r = rsiF(c, 14);
  const c1 = k1.c, m = c1.length, d200 = ema(c1, 200), d20 = ema(c1, 20), d50 = ema(c1, 50);
  const dir = new Int8Array(n); let j = -1;
  for (let i = 0; i < n; i++) { const ct = k4.ts[i] + H; while (j + 1 < m && k1.ts[j + 1] + D <= ct) j++;
    dir[i] = j < W ? 0 : c1[j] > d200[j] && d20[j] > d50[j] ? 1 : c1[j] < d200[j] && d20[j] < d50[j] ? -1 : 0; }
  const dage = new Float64Array(n); for (let i = 1; i < n; i++) dage[i] = dir[i] === -1 ? dage[i - 1] + 1 : 0; // 日线连续向下的 4 小时根数
  const want = new Int8Array(n); let s = 0, l = 0;
  for (let i = 1; i < n; i++) {
    if (!s && c[i] < e200[i] && r[i - 1] > SHORT_RSI_IN && r[i] <= SHORT_RSI_IN) s = 1; else if (s && (r[i] < 35 || c[i] > e200[i])) s = 0;
    if (!l && c[i] > e200[i] && r[i - 1] < 35 && r[i] >= 35) l = 1; else if (l && (r[i] > 65 || c[i] < e200[i])) l = 0;
    want[i] = i < W ? 0 : l && dir[i] === 1 ? 1 : s && dir[i] === -1 ? -1 : 0;
  }
  const trades = []; let side = 0, e = 0, eI = 0;
  for (let i = W + 1; i < n; i++) { const w = want[i - 1];
    if (side && w !== side) { const x = o[i]; trades.push({ side, t0: k4.ts[eI], t1: k4.ts[i], r: (side > 0 ? x * (1 - SLIP) / e - 1 : 1 - x * (1 + SLIP) / e) - 2 * FEE - FUND * (i - eI) }); side = 0; }
    if (!side && w) { side = w; e = w > 0 ? o[i] * (1 + SLIP) : o[i] * (1 - SLIP); eI = i; } }
  const st = sd => { const t = trades.filter(x => x.side === sd); if (!t.length) return { n: 0 }; const w = t.filter(x => x.r > 0).length;
    return { n: t.length, w, win: Math.round(100 * w / t.length), avg: 100 * t.reduce((a, x) => a + x.r, 0) / t.length }; };
  const ev = [];
  for (let i = W + 1; i < n; i++) {
    if (want[i] === want[i - 1]) continue;
    if (want[i - 1] === -1) ev.push({ t: k4.ts[i], act: "平空", price: c[i], why: r[i] < 35 ? "止盈（RSI 跌到 35 以下）" : c[i] > e200[i] ? "止损（4小时收盘站上 200 均线）" : "日线不再向下" });
    if (want[i] === -1) ev.push({ t: k4.ts[i], act: "开空", price: c[i], age: dage[i] / 6, dist: e200[i] / c[i] - 1, rsi: r[i] });
  }
  const L = n - 1, now = want[L], prev = want[L - 1];
  let action = "观望", entry = null, sinceBars = null, phase = null, sigI = L;
  if (now && now !== prev) action = now > 0 ? "开多" : "开空";
  else if (now) { action = now > 0 ? "持多中" : "持空中"; let p = L; while (p > 0 && want[p - 1] === now) p--; entry = p + 1 <= L ? o[p + 1] : c[L]; sinceBars = L - p; sigI = p; }
  else if (prev) action = prev > 0 ? "平多" : "平空";
  else { const d = dir[L]; phase = !d ? "nodir" : (d < 0 ? c[L] > e200[L] : c[L] < e200[L]) ? "wrongside" : (d < 0 ? r[L] > SHORT_RSI_IN : r[L] < 35) ? "hot" : "wait"; }
  return { dir: dir[L], action, side: now, entry, sinceBars, phase, stop: e200[L], rsi: r[L], price: c[L], barTs: k4.ts[L], trades, ev, stats: { L: st(1), S: st(-1) },
    age: dage[sigI] / 6, sigDist: e200[sigI] / c[sigI] - 1, sigRsi: r[sigI] };
}
// ===== 共用计算：趋势跟踪 / 策略状态 / 止盈估算 / 仓位（网页和推送用同一份）=====
function trendCalc(k, longOnly = true) {
  // 日线唐奇安：收盘突破前 20 日最高价且在 200 日均线上方 → 开多（longOnly=false 时，跌破前 20 日最低价且在均线下方 → 开空）
  // 2018 年起回测：做多 335 次 PF 3.29；做空 390 次 PF 0.79（亏钱），所以默认只做多
  // 离场：收盘跌破前 10 日最低价（空单为突破前 10 日最高价），或触及开仓时的 2 倍 ATR 止损
  const D = 86400000, FEE = 0.001, SLIP = 0.0005, FUNDD = 0.0001, W = 200;
  const { o, h, l, c, ts } = k, n = c.length;
  if (n < W + 30) return null;
  const a2 = 2 / 201, e200 = new Float64Array(n), atr = new Float64Array(n);
  e200[0] = c[0];
  for (let i = 0; i < n; i++) {
    if (i) e200[i] = a2 * c[i] + (1 - a2) * e200[i - 1];
    const tr = i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    atr[i] = i === 0 ? tr : (tr + 19 * atr[i - 1]) / 20;
  }
  const hh = (i, m) => { let v = -Infinity; for (let j = i - m; j < i; j++) v = Math.max(v, h[j]); return v; };
  const ll = (i, m) => { let v = Infinity; for (let j = i - m; j < i; j++) v = Math.min(v, l[j]); return v; };
  const trades = [], ev = [];
  let pos = 0, ent = 0, eI = 0, stop = 0, risk = 0, exiting = null, fresh = null;
  for (let i = W; i < n; i++) {
    if (pos) {
      const lv = pos > 0 ? Math.max(ll(i, 10), stop) : Math.min(hh(i, 10), stop);
      if (pos > 0 ? c[i] < lv : c[i] > lv) {
        const why = (pos > 0 ? c[i] < stop : c[i] > stop) ? "sl" : "ch";
        ev.push({ t: ts[i] + D, act: pos > 0 ? "平多" : "平空", price: c[i], why });
        if (i + 1 < n) {
          const x = o[i + 1] * (1 - pos * SLIP);
          trades.push({ side: pos, t0: ts[eI], t1: ts[i + 1], p0: ent, p1: x, r: pos * (x / ent - 1) - 2 * FEE - FUNDD * (i + 1 - eI), bars: i + 1 - eI, risk, why });
          pos = 0;
        } else exiting = { side: pos, why, price: c[i] };
      }
    }
    if (!pos) {
      let s = c[i] > hh(i, 20) ? 1 : c[i] < ll(i, 20) ? -1 : 0;
      if (s && (s > 0 ? c[i] < e200[i] : c[i] > e200[i])) s = 0;
      if (longOnly && s < 0) s = 0;
      if (s) {
        ev.push({ t: ts[i] + D, act: s > 0 ? "开多" : "开空", price: c[i] });
        if (i + 1 < n) { pos = s; ent = o[i + 1] * (1 + s * SLIP); eI = i + 1; stop = c[i] - s * 2 * atr[i]; risk = 2 * atr[i] / c[i]; }
        else fresh = { side: s, price: c[i], stop: c[i] - s * 2 * atr[i] };
      }
    }
  }
  const L = n - 1, price = c[L];
  let action = "观望", open = null;
  if (exiting) { action = exiting.side > 0 ? "平多" : "平空"; open = { side: pos, t0: ts[eI], p0: ent, stop, exitLv: null, days: n - eI }; }
  else if (pos) { action = pos > 0 ? "持多中" : "持空中"; open = { side: pos, t0: ts[eI], p0: ent, stop, exitLv: pos > 0 ? Math.max(ll(n, 10), stop) : Math.min(hh(n, 10), stop), days: n - eI }; }
  if (fresh) { action = fresh.side > 0 ? "开多" : "开空"; open = { side: fresh.side, t0: ts[L] + D, p0: price, stop: fresh.stop, exitLv: fresh.stop, days: 0, fresh: true }; }
  // 过去 20 天日涨跌幅的标准差（趋势做多按波动率定仓位用）
  let vs = 0, vq = 0, vn = 0;
  for (let j = Math.max(1, L - 19); j <= L; j++) { const r = c[j] / c[j - 1] - 1; vs += r; vq += r * r; vn++; }
  const vol20 = vn ? Math.sqrt(Math.max(vq / vn - (vs / vn) ** 2, 0)) : null;
  return { action, open, exiting, trades, ev, price, barTs: ts[L], e200: e200[L], atr: atr[L], vol20,
    up: hh(n, 20), dn: ll(n, 20), side: price > e200[L] ? 1 : -1 };
}
// 策略状态灯（2026-11-11 起只作提示，不再影响仓位）：11-05 回测，灯对下一笔没有预测力，按灯减半 / 暂停反而少赚
// （趋势做多近 1000 天 +2866% → +485%）；11-11 组合回测里按"宽度"门控多头同样更差。factor 固定为 1。
const HEALTH_SIZING = false;
function healthOf(trades, N = 30) {
  const t = trades.slice().sort((x, y) => x.t1 - y.t1).slice(-N);
  if (t.length < 15) return { level: "gray", word: "样本不足", factor: 1, n: t.length };
  let gw = 0, gl = 0, s = 0; for (const x of t) { s += x.r; if (x.r > 0) gw += x.r; else gl -= x.r; }
  const pf = gl > 0 ? gw / gl : 9, avg = s / t.length, win = t.filter(x => x.r > 0).length / t.length;
  const level = pf >= 1.1 ? "green" : pf >= 0.8 ? "yellow" : "red";
  return { level, pf, avg, win, n: t.length, factor: HEALTH_SIZING ? { green: 1, yellow: 0.5, red: 0 }[level] : 1,
    word: HEALTH_SIZING ? { green: "正常", yellow: "变弱：仓位减半", red: "失灵：暂停新开仓" }[level] : { green: "正常", yellow: "最近偏弱（仅提示）", red: "最近很差（仅提示）" }[level] };
}
function rsiTarget(c, level, n = 14) {
  const a = 1 / n, L = c.length; let up = 0, dn = 0;
  for (let i = 1; i < L; i++) { const d = c[i] - c[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
    if (i === 1) { up = u; dn = w; } else { up = a * u + (1 - a) * up; dn = a * w + (1 - a) * dn; } }
  // 下一根收盘价 x = c[L-1] - drop 时，RSI 恰好降到 level
  const need = (1 - a) * up * (100 - level) / level, drop = (need - (1 - a) * dn) / a;
  const x = c[L - 1] - Math.max(drop, 0);
  return x > 0 ? x : null;
}
// 建议仓位占本金的比例：每笔最多亏 riskPct%，单币最多 capPct%，再乘策略状态系数
function sizePct(entry, stop, riskPct = 1, capPct = 40, factor = 1) {
  const dist = Math.abs(stop / entry - 1);
  if (!(dist > 0)) return null;
  return { pct: Math.min(riskPct / dist, capPct) * factor, dist, tight: dist < 0.02 };
}
// 日线趋势做多按波动率定仓位（2026-11-07 回测）：仓位% = 0.5% ÷ 过去 20 天日涨跌幅标准差，单币最多 capPct%
// 同样平均仓位下，近 1000 天回撤 −35% vs 按止损定仓 −43%，夏普 1.27 vs 1.16；老数据也更好
const VOL_TARGET = 0.5;
function sizeVol(vol, capPct = 40, factor = 1) {
  if (!(vol > 0)) return null;
  return { pct: Math.min(VOL_TARGET / (vol * 100) * 100, capPct) * factor, vol };
}
// 两套做多各用一半资金（2026-11-11 回测：日线趋势 + 4 小时双轨各一半，13 个币老数据夏普 1.60，好于单独任何一套；回撤更小）
const LONG_SPLIT = 0.5;
const mmFmt = v => v > 0 && v < 0.1 ? v.toFixed(2) : v.toFixed(1);   // 热力红柱显示（很小的红柱别显示成 0.0）
// 4 小时双轨 + 热力做多（2026-11-11 回测，13 个币，2018-06 起，已扣手续费和滑点）：
//   双轨 = 红 EMA5 / 黄 EMA34，差值超过 0.1×ATR14 才算金叉 / 死叉，同方向上一次交叉要隔 20 根以上才算（同使用者的 QX_STYLE_MAP_V4_2）
//   热力红柱 MM = 1.5×(RSI50−50)，限 0～20（同 AWR_LITE）；热度 HOT = 0.7×(RSI40−30)
//   金叉（含冷却）且有红柱（MM>0）→ 下一根开盘买；任何一次死叉（不看冷却）→ 下一根开盘卖；只做多（做空在所有周期都亏）
//   卖出不看冷却（11-11 回测，两段都更好，单笔最大亏损 −41% → −19%）。按波动率定仓、最多 5 个币：
//   近 1000 天 701 笔 PF 1.58、年化 60%、回撤 −34%；2018-06～2024-02 1187 笔 PF 2.08、年化 68%、回撤 −38%
function qxCalc(k) {
  const FEE = 0.001, SLIP = 0.0005, H4 = 14400000;
  const { o, h, l, c, ts } = k, n = c.length;
  if (n < 120) return null;
  const ema = (x, p) => { const a = 2 / (p + 1), r = new Float64Array(x.length); r[0] = x[0]; for (let i = 1; i < x.length; i++) r[i] = a * x[i] + (1 - a) * r[i - 1]; return r; };
  const sma1 = (x, p) => { const r = new Float64Array(x.length); r[0] = x[0]; for (let i = 1; i < x.length; i++) r[i] = (x[i] + (p - 1) * r[i - 1]) / p; return r; };
  const l1 = ema(c, 5), l2 = ema(c, 34), d = new Float64Array(n), buf = new Float64Array(n).fill(NaN);
  const tr = new Float64Array(n), up = new Float64Array(n), rng = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pc = i ? c[i - 1] : c[0]; d[i] = l1[i] - l2[i];
    tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc)); up[i] = Math.max(c[i] - pc, 0); rng[i] = Math.abs(c[i] - pc);
  }
  let s14 = 0; for (let i = 0; i < n; i++) { s14 += tr[i]; if (i >= 14) s14 -= tr[i - 14]; if (i >= 13) buf[i] = s14 / 14 * 0.10; }
  const u50 = sma1(up, 50), r50 = sma1(rng, 50), u40 = sma1(up, 40), r40 = sma1(rng, 40);
  const clip = x => Math.min(20, Math.max(0, x));
  const mmAt = i => clip(1.5 * ((r50[i] > 0 ? u50[i] / r50[i] * 100 : 50) - 50)), hotAt = i => clip(0.7 * ((r40[i] > 0 ? u40[i] / r40[i] * 100 : 50) - 30));
  const sb = new Uint8Array(n), ss = new Uint8Array(n), sr = new Uint8Array(n), st = new Int8Array(n); let lb = -1e9, ls = -1e9, s = 0;
  for (let i = 1; i < n; i++) {
    const rb = d[i] > buf[i] && d[i - 1] <= buf[i - 1], rs = -buf[i] > d[i] && -buf[i - 1] <= d[i - 1];
    if (rb) { sb[i] = i - lb > 21 ? 1 : 0; lb = i; }
    if (rs) { ss[i] = i - ls > 21 ? 1 : 0; ls = i; sr[i] = 1; }
    if (sb[i]) s = 1; else if (ss[i]) s = -1; st[i] = s;
  }
  const trades = [], ev = []; let pos = 0, ent = 0, eI = 0, sigP = 0, exiting = false, fresh = null;
  for (let i = 1; i < n; i++) {
    if (pos && sr[i]) {   // 卖出：任何一次死叉都卖，不看冷却
      ev.push({ t: ts[i] + H4, act: "平多", price: c[i] });
      if (i + 1 < n) { const x = o[i + 1] * (1 - SLIP); trades.push({ side: 1, t0: ts[eI], t1: ts[i + 1], p0: ent, p1: x, r: x / ent - 1 - 2 * FEE, bars: i + 1 - eI, why: "dead" }); pos = 0; }
      else exiting = true;
    }
    if (!pos && sb[i]) {
      const mm = mmAt(i);
      if (mm > 0) {
        ev.push({ t: ts[i] + H4, act: "开多", price: c[i], mm, hot: hotAt(i) });
        if (i + 1 < n) { pos = 1; ent = o[i + 1] * (1 + SLIP); eI = i + 1; sigP = c[i]; }
        else fresh = { price: c[i], mm };
      } else ev.push({ t: ts[i] + H4, act: "金叉无红柱", price: c[i], mm, hot: hotAt(i) });
    }
  }
  const L = n - 1; let action = "观望", open = null;
  if (fresh) { action = "开多"; open = { t0: ts[L] + H4, p0: c[L], sig: c[L], bars: 0, fresh: true }; }
  else if (pos) { action = exiting ? "平多" : "持多中"; open = { t0: ts[eI], p0: ent, sig: sigP, bars: n - eI }; }
  const phase = action !== "观望" ? null : st[L] > 0 ? (d[L] > 0 ? "bullwait" : "bullweak") : st[L] < 0 ? "bear" : "none";
  return { action, open, exiting, trades, ev, phase, state: st[L], mm: mmAt(L), hot: hotAt(L), l1: l1[L], l2: l2[L], price: c[L], barTs: ts[L] };
}
async function push(title, body, important) {
  if (!KEY) { console.log("  [试运行，不推送]", title, "|", body); return; }
  const url = `https://api.day.app/${KEY}/${encodeURIComponent(title)}/${encodeURIComponent(body)}?group=${encodeURIComponent("决策台")}&url=${encodeURIComponent(PAGE)}${important ? "&level=timeSensitive" : ""}`;
  try { const r = await fetch(url); console.log("  推送", r.status, title); } catch (e) { console.log("  推送失败", title, e.message); }
}
(async () => {
  let state = {};
  try { state = JSON.parse(fs.readFileSync("state.json", "utf8")); } catch (e) {}
  const first = !state.swing;
  state.swing = state.swing || {};
  const sent = new Set(state.sent || []), events = [], summary = [], used = new Set();
  const dn = d => d > 0 ? "向上（做空系统不做）" : d < 0 ? "向下（找做空机会）" : "不明（做空系统不做）";
  const SYSN = { short: "4小时做空", trend: "日线趋势做多", qx: "4小时双轨做多" };
  const pctS = x => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";
  // 做空只做 A 级（2026-11-11 组合回测，13 个币 2018-06 起，4 小时盯市）：
  //   A 级 = 止损距离 ≥2% 且日线转空 ≤30 天（资金费率 ≤0 的 A 级按 B 级算，同 11-06 规则）
  //   只做 A 级的做空腿三段都是正的：2018-06～2020 年化 +4.6%、2021～2023 +0.8%、2024～今 +5.6%，回撤 −5%～−15%
  //   A+B 都做（原规则）：+1.4% / −13.4% / −4.1%，2021～2023 把整个组合回撤从 −29% 拖到 −49%
  //   整个组合（唐奇安½ + 双轨½）：只做 A 级 + 空头合计 ≤40% 后，三段年化 58 / 48 / 44%，回撤 −18 / −28 / −15%；原规则 55 / 27 / 30%，回撤 −18 / −49 / −21%
  // 所以：B、C 级不再推送开空（网页上仍显示，标为"观察，不开"）；空头合计名义不超过本金 40%（原来 3 笔叠起来峰值到过 115%）
  const SHORT_CAP = 40;
  const isAGrade = (dist, age, f) => dist >= 0.02 && age <= 30 && !(f && f.now <= 0);
  // 1) 先算好每个币的两套系统
  const R = {};
  for (const b of SYMBOLS) {
    try {
      const short = SHORT_SET.includes(b);
      const [r1, s1] = await klines(b, "1d"), [r4, s4] = await klines(b, "4h", short ? HISTORY["4h"] : 3); used.add(s1); used.add(s4);
      const k1 = toK(r1, "1d"), price = +r4[r4.length - 1][4];
      let v = null, q = null;
      if (short) {
        const k4 = toK(r4, "4h"); v = swingCalc(k4, k1);
        if (v.dir > 0) Object.assign(v, { action: "观望", side: 0 });
        v.tp = rsiTarget(k4.c, 35);
        q = qxCalc(k4);   // 4 小时双轨做多（2026-11-11 起），只在 13 个主流币上跑
      }
      R[b] = { v, q, t: trendCalc(k1, true), price: v ? v.price : price, f: short ? await funding(b) : null };
    } catch (e) { console.log(b, "拉取失败：", e.message); }
  }
  // 2) 策略状态灯（最近 30 笔）
  const H = {
    short: healthOf(Object.values(R).flatMap(x => x.v ? x.v.trades.filter(t => t.side < 0) : [])),
    trend: healthOf(Object.values(R).flatMap(x => x.t ? x.t.trades : [])),
    qx: healthOf(Object.values(R).flatMap(x => x.q ? x.q.trades : [])),
  };
  const healthInit = !state.health;
  state.health = state.health || {};
  for (const sys of ["short", "trend", "qx"]) {
    const h = H[sys], prevL = state.health[sys];
    if (!healthInit && !first && prevL && prevL !== h.level && h.level !== "gray")
      events.push({ coin: null, kind: "health", sys, level: h.level, important: h.level !== "green", title: `${SYSN[sys]} 策略状态：${h.word}`,
        body: `最近 ${h.n} 笔模拟交易：胜率 ${Math.round(h.win * 100)}%，平均每笔 ${pctS(h.avg)}，赚亏比 ${h.pf.toFixed(2)}。${HEALTH_SIZING ? (h.level === "yellow" ? "之后的建议仓位自动减半。" : h.level === "red" ? "暂停新开仓，已有的单照常按规则离场。" : "恢复正常仓位。") : "只是提示，建议仓位不变（回测：按灯减仓反而少赚）。"}` });
    state.health[sys] = h.level;
  }
  // 模型里正在持有的 A 级空单各占本金多少（按开仓时的止损距离算，和当时推送的建议仓位一致）；合计不能超过 SHORT_CAP
  const openShorts = {};
  for (const b of SHORT_SET) {
    const v = R[b] && R[b].v;
    if (v && v.action === "持空中" && isAGrade(v.sigDist, v.age, R[b].f)) { const z = sizePct(1, 1 + v.sigDist, 1, SHORT_CAP); if (z) openShorts[b] = z.pct; }
  }
  const shortUsed = except => Object.entries(openShorts).filter(([c]) => c !== except).reduce((s, [, p]) => s + p, 0);
  const sizeLine = (sys, entry, stop, lev, vol, coin) => {
    const h = H[sys], side = sys === "short" ? -1 : 1, ok = side * (entry - stop) > 0;
    if (!ok && sys !== "qx") return "仓位：现价已越过止损线，不要开仓";
    if (h.factor === 0) return `仓位：策略状态红灯，暂停新开仓，只看不做`;
    if (sys === "short") {
      // 推送不知道你实际拿着哪几笔，所以写清规则 + 模型里还在持有的空单；网页「可以开仓」会按你标记的持仓精确算
      const z = sizePct(entry, stop, 1, SHORT_CAP, h.factor), others = Object.entries(openShorts).filter(([c]) => c !== coin), used = shortUsed(coin), room = Math.max(0, SHORT_CAP - used);
      const capTxt = !others.length ? `空头合计上限 ${SHORT_CAP}%`
        : room < 5 ? `空头合计上限 ${SHORT_CAP}%：模型里还持有 ${others.map(([c, p]) => `${c} ${p.toFixed(0)}%`).join("、")}，如果你也都拿着，这笔不开`
        : `空头合计上限 ${SHORT_CAP}%：模型里还持有 ${others.map(([c, p]) => `${c} ${p.toFixed(0)}%`).join("、")}，如果你也拿着，这笔最多 ${Math.min(z.pct, room).toFixed(0)}%`;
      return `仓位：本金的 ${z.pct.toFixed(0)}%（每笔最多亏 1%；${capTxt}），${lev}` +
        (z.tight ? `\n⚠ 止损只离 ${(z.dist * 100).toFixed(1)}%，历史上这类单胜率仅 18%，建议跳过或减半` : "");
    }
    if (sys === "trend" || sys === "qx") {
      // 2026-11-11：日线趋势、4 小时双轨两套做多各用一半资金
      const v = sizeVol(vol, 40, h.factor * LONG_SPLIT);
      if (v) { const loss = ok ? v.pct * (1 - stop / entry) : 0;
        return `仓位：本金的 ${v.pct.toFixed(0)}%（按波动率：0.5% ÷ 20日波动 ${(vol * 100).toFixed(1)}%，再 × 一半资金），${sys === "qx" ? (ok ? `跌到黄线约亏本金 ${loss.toFixed(1)}%` : "现价已在黄线下方，死叉随时可能出现") : `打到止损约亏本金 ${loss.toFixed(1)}%`}，${lev}；日线趋势、4小时双轨两套做多各用一半资金${h.factor < 1 ? `；策略${h.word}` : ""}`; }
    }
    const z = sizePct(entry, stop, 1, 40, h.factor);
    return `仓位：本金的 ${z.pct.toFixed(0)}%（每笔最多亏 1%），${lev}${h.factor < 1 ? `；策略${h.word}` : ""}`;
  };
  // 信号等级（2026-11-05 回测，和网页同一套）：止损距离 ≥2% + 日线转空 ≤30 天
  // 2026-11-06 加：资金费率 ≤0（空头在付钱）时 A 级降为 B 级。回测里这种 A 级只有 B 级的水平
  // 2026-11-06 加：开空时 4 小时 RSI <50 = 追跌信号（多是暴跌后日线刚转空触发），历史上不赚钱
  const gradeLine = (dist, age, f, rsi) => {
    const down = dist >= 0.02 && age <= 30 && f && f.now <= 0;
    const g = dist < 0.02 ? ["C 级（差）", "止损不到 2%，历史胜率约 2 成，建议跳过"]
      : down ? ["B 级（一般）", "本来是 A 级，但资金费率为负，历史上这种单胜率：近 1000 天 50%，2018–2024 年 44%，只有 B 级水平"]
      : age <= 30 ? ["A 级（好）", "历史胜率：近 1000 天 60%，2018–2024 年 64%"]
      : ["B 级（一般）", "历史胜率：近 1000 天 46%，2018–2024 年 38%（老数据整体亏）"];
    const fl = f ? `\n资金费率：${(f.now * 100).toFixed(4)}%（最近 3 次平均，${f.now > 0 ? "多头在付钱" : "空头在付钱"}）` : "";
    const ch = rsi != null && rsi < 50 ? `\n⚠ 追跌信号：开空时 4小时 RSI 只有 ${rsi.toFixed(0)}，是大跌后日线刚转空才触发的。历史上这类信号近 1000 天 19 笔平均 −0.3%，老数据 13 笔平均 −4.6%（正常信号近 1000 天 +2.2%）。建议不追，等反弹到 RSI 60 以上再回落再空` : "";
    return `等级：${g[0]}（日线转空 ${age < 1 ? "不到 1" : Math.round(age)} 天）· ${g[1]}${fl}${ch}`;
  };
  // 2026-11-09 推送格式：进场 / 止损 / 止盈参考 三行（只改文字，信号和仓位规则不变；止盈只写规则，不写目标价）
  const entryLine = (p, sigTxt, extra) => `进场：≈ ${fmt(p)}（下一根开盘参考价，按现价；${sigTxt}${extra || ""}）`;
  const shortPlan = (v, p, coin) => [
    `止损：${fmt(v.stop)}（${pctS(v.stop / p - 1)}）= 4小时 EMA200，4小时收盘站上就平；止损线跟着均线移动`,
    v.rsi != null && v.rsi < 35 ? `止盈参考：4小时 RSI 已在 35 以下，留意平空提示` : `止盈参考：4小时收盘 RSI 跌破 35 时平仓（看平空推送，不设目标价）`,
    sizeLine("short", p, v.stop, "杠杆≤2倍", null, coin),
  ].join("\n");
  const trendInit = !state.trendInit; state.trendInit = 1;
  const qxInit = !state.qxInit; state.qxInit = 1;   // 第一次跑 4 小时双轨：只记下历史信号，不补推
  // 3) 逐个币生成推送
  const trendKnown = new Set(state.trendCoins || (state.trendInit ? SHORT_SET : []));
  for (const b of SYMBOLS) {
    if (!R[b]) continue;
    const { v, t, price: px, f } = R[b], quietTrend = trendInit || !trendKnown.has(b);
    const sentBefore = new Set(sent);
    if (!v) summary.push(`${b} ${fmt(px)}：日线趋势${t ? t.action : "—"}`);
    if (v) {
      summary.push(`${b} ${fmt(v.price)}：做空系统${v.action}，日线${dn(v.dir)}${t ? `；趋势${t.action}` : ""}${R[b].q ? `；双轨${R[b].q.action}` : ""}`);
      const prev = state.swing[b];
      if (!first && prev && prev.dir !== v.dir)
        events.push({ coin: b, kind: "dir", dir: v.dir, price: v.price, important: true, title: `${b} 日线方向变为${dn(v.dir)}`, body: `${v.dir > 0 ? "做空系统不做（别逆势做空）" : v.dir < 0 ? "做空系统开始找机会：等 4 小时反弹过热再回落" : "做空系统不做"}。现价 ${fmt(v.price)}。` });
      // 开空/平空：查最近 24 小时内的所有翻转，不只看最新一根，GitHub 定时任务延迟也不会漏
      const H4 = 14400000, NOW = Date.now();
      v.ev.forEach((e, idx) => {
        const close = e.t + H4, key = `${b}|swing|${e.t}|${e.act}`;
        if (NOW - close > 86400000 || sent.has(key)) return;
        sent.add(key);
        if (first) return;
        const lateH = (NOW - close) / 3600000, late = lateH >= 1.5 ? `（延迟 ${Math.round(lateH)} 小时）` : "";
        if (e.act === "开空") {
          if (v.ev.slice(idx + 1).some(x => x.act === "平空")) return; // 提醒到达前已经平空：不再推送
          if (!isAGrade(e.dist, e.age, f)) {
            sent.add(`${b}|swing|${e.t}|skip`);
            // 2026-11-14：B / C 级改成发一条低优先级「观察」推送，让你知道系统看到了信号、为什么不建议开
            const why = e.dist < 0.02 ? `止损只离 ${(e.dist * 100).toFixed(1)}%（不到 2%），历史胜率约 2 成`
              : e.age > 30 ? `日线转空已经 ${Math.round(e.age)} 天（超过 30 天），历史上这类单老数据整体亏`
              : `资金费率为负（${(f.now * 100).toFixed(4)}%，空头在付钱），历史上这类单老数据平均 −1.6%`;
            events.push({ coin: b, kind: "watch", price: v.price, sigPrice: e.price, sig: close, important: false, title: `${b} 做空信号 · ${e.dist < 0.02 ? "C" : "B"} 级，只观察不开${late}`,
              body: `4小时收盘 ${fmt(e.price)} 出了做空信号，但不是 A 级：${why}。\n不建议开仓，也不给仓位；之后的平仓、跟进不再提醒。\n止损线（4小时 EMA200）${fmt(v.stop)}，现价 ${fmt(v.price)}。` });
            return;
          }
          const move = 1 - v.price / e.price;
          const body = `${entryLine(v.price, `信号收盘 ${fmt(e.price)}`, late ? `，${move >= 0 ? "已跌" : "已涨"} ${Math.abs(move * 100).toFixed(1)}%，2 天内仍可跟进` : "")}\n${shortPlan(v, v.price, b)}\n${gradeLine(e.dist, e.age, f, e.rsi)}`;
          events.push({ coin: b, kind: "open", price: v.price, sigPrice: e.price, stop: v.stop, tp: v.tp, sig: close, important: true, title: `${b} 开空 · 4小时做空${late}${e.rsi != null && e.rsi < 50 ? "（追跌，建议等反弹）" : ""}`, body });
          v.justOpened = true;
        } else {
          const opened = [...v.ev.slice(0, idx)].reverse().find(x => x.act === "开空");
          if (opened && sent.has(`${b}|swing|${opened.t}|skip`)) return; // 这笔是 B/C 级、没推过开空：也不推平空
          if (opened && NOW - (opened.t + H4) < 86400000 && !sentBefore.has(`${b}|swing|${opened.t}|开空`)) return; // 开空也没提醒过：用户没持仓，不推平空
          const gain = opened ? 1 - e.price / opened.price - 2 * 0.001 : null;
          events.push({ coin: b, kind: "close", price: v.price, sigPrice: e.price, sig: close, important: true, title: `${b} 平空 · 4小时做空${late}`,
            body: `离场原因：${e.why}\n离场价 ${fmt(e.price)}，现价 ${fmt(v.price)}${gain != null ? `\n这笔约 ${pctS(gain)}（已扣手续费，按信号价）` : ""}` });
        }
      });
      // 持仓守护提醒（2026-11-11）：空单按 4 小时收盘反向涨到 3.1% / 5% 各提醒一次，只提示、不叫操作
      // 依据：近 1000 天最后赚钱的空单，中途反向涨幅中位数 1.7%，1/4 超过 3.1%，1/10 超过 5%（11-06 统计）；
      //       中途减仓再加回回测更差（11-11：近 1000 天平均每笔 +1.9% → +1.2%）
      // 持仓中的空单是不是推过开空的 A 级单（B/C 级没推过开空，跟进、守护也都不推）
      const t0g = v.barTs - v.sinceBars * 14400000;
      const heldA = v.action === "持空中" && !sent.has(`${b}|swing|${t0g}|skip`) && isAGrade(v.sigDist, v.age, f);
      if (heldA && v.entry > 0 && v.stop > v.price && !v.justOpened) {
        const adv = v.price / v.entry - 1, toStop = v.stop / v.price - 1;
        const lvl = adv >= 0.05 ? 2 : adv >= 0.031 ? 1 : 0;
        for (let g = 1; g <= lvl; g++) {
          const key = `${b}|guard|${t0g}|${g}`; if (sent.has(key)) continue; sent.add(key);
          if (first || g < lvl) continue;   // 直接跳到第二档时，第一档不再补发
          events.push({ coin: b, kind: "guard", price: v.price, important: g === 2, title: `${b} 空单反向涨 ${(adv * 100).toFixed(1)}% · 持仓守护`,
            body: g === 1
              ? `4小时收盘 ${fmt(v.price)}，比开空价 ${fmt(v.entry)} 反向涨了 ${(adv * 100).toFixed(1)}%。\n历史上最后赚钱的空单，约 1/4 中途也反向涨过 3% 以上，这还算正常，按规则拿着。\n离止损还有 ${(toStop * 100).toFixed(1)}%：4小时收盘站上 ${fmt(v.stop)} 才平，盘中冲上去不算。\n不建议现在减仓再加回：回测里这样做，近 1000 天平均每笔从 +1.9% 降到 +1.2%。`
              : `4小时收盘 ${fmt(v.price)}，比开空价 ${fmt(v.entry)} 反向涨了 ${(adv * 100).toFixed(1)}%。\n只有约 1/10 的赚钱空单涨到这么多，开始少见了。\n盯一下 4小时收盘：站上 ${fmt(v.stop)}（还差 ${(toStop * 100).toFixed(1)}%）就按规则平；没站上就继续拿着，不要提前乱动。` });
        }
      }
      if (heldA && v.sinceBars >= 6 && v.sinceBars < 12 && !v.justOpened) {
        const key = `${b}|follow|${t0g}`;
        if (!sent.has(key)) { sent.add(key);
          if (!first) { const fell = 1 - v.price / v.entry;
            events.push({ coin: b, kind: "follow", price: v.price, stop: v.stop, tp: v.tp, important: true, title: `${b} 跟进提示：开空已满 1 天`,
              body: `${entryLine(v.price, `${(v.sinceBars * 4 / 24).toFixed(1)} 天前信号价 ${fmt(v.entry)}`, `，${fell >= 0 ? "已跌" : "已涨"} ${Math.abs(fell * 100).toFixed(1)}%`)}\n${shortPlan(v, v.price, b)}\n${gradeLine(v.sigDist, v.age, f, v.sigRsi)}\n历史上晚 1～2 天跟进：胜率 56%，平均每次 +1.1%` }); } }
      }
    }
    // 4 小时双轨做多（2026-11-11 起）：查最近 24 小时的信号
    const q = R[b].q;
    if (q) q.ev.forEach((e, idx) => {
      if (e.act === "金叉无红柱") return;
      const key = `${b}|qx|${e.t}|${e.act}`, NOW3 = Date.now();
      if (NOW3 - e.t > 86400000 || sent.has(key)) return;
      sent.add(key);
      if (first || qxInit) return;
      const lateH = (NOW3 - e.t) / 3600000, late = lateH >= 1.5 ? `（延迟 ${Math.round(lateH)} 小时）` : "", p = px;
      if (e.act === "开多") {
        if (q.ev.slice(idx + 1).some(x => x.act === "平多")) return;
        const moved = p / e.price - 1;
        events.push({ coin: b, kind: "qopen", price: p, sigPrice: e.price, sig: e.t, important: true, title: `${b} 开多 · 4小时双轨${late}`,
          body: `${entryLine(p, `4小时收盘 ${fmt(e.price)} 双轨金叉，热力红柱 ${mmFmt(e.mm)}`, late ? `，${moved >= 0 ? "已涨" : "已跌"} ${Math.abs(moved * 100).toFixed(1)}%，1 天内仍可跟进` : "")}\n止损：不设固定价；4小时双轨死叉就卖（红线跌破黄线超过 0.1 倍波动，每次死叉都卖，不看冷却）。黄线现在 ${fmt(q.l2)}（${pctS(q.l2 / p - 1)}），收盘跌到黄线附近要留意\n止盈参考：不设目标价，等死叉才卖，让利润跑\n${sizeLine("qx", p, q.l2, "现货或 1 倍", R[b].t ? R[b].t.vol20 : null)}\n历史（13 个币，2018-06 起）：胜率约 3 成，平均每笔 +2.5%，亏的单死叉很快就卖，靠少数大波段赚钱；只做多，死叉不要反手做空` });
      } else {
        const opened = [...q.ev.slice(0, idx)].reverse().find(x => x.act === "开多");
        if (opened && !sentBefore.has(`${b}|qx|${opened.t}|开多`) && NOW3 - opened.t < 86400000) return;
        const gain = opened ? e.price / opened.price - 1 - 2 * 0.001 : null;
        events.push({ coin: b, kind: "qclose", price: p, sigPrice: e.price, sig: e.t, important: true, title: `${b} 平多 · 4小时双轨${late}`,
          body: `离场原因：4小时双轨死叉\n离场价 ${fmt(e.price)}，现价 ${fmt(p)}${gain != null ? `\n这笔约 ${pctS(gain)}（已扣手续费，按信号价）` : ""}\n只平多，不要反手做空` });
      }
    });
    // 日线趋势做多：查最近 2 天的信号
    if (t) t.ev.forEach((e, idx) => {
      const key = `${b}|trend|${e.t}|${e.act}`, NOW2 = Date.now();
      if (NOW2 - e.t > 2 * 86400000 || sent.has(key)) return;
      sent.add(key);
      if (first || quietTrend) return;
      const lateH = (NOW2 - e.t) / 3600000, late = lateH >= 6 ? `（延迟 ${Math.round(lateH)} 小时）` : "";
      if (e.act === "开多") {
        if (t.ev.slice(idx + 1).some(x => x.act === "平多")) return;
        const p = px, stop = t.open && t.open.exitLv ? t.open.exitLv : (t.open ? t.open.stop : e.price - 2 * t.atr);
        const atrStop = t.open ? t.open.stop : e.price - 2 * t.atr;   // 开仓时定下的 2 倍 ATR 止损（仓位计算仍用原来的 stop，规则不变）
        events.push({ coin: b, kind: "topen", price: p, sigPrice: e.price, stop, sig: e.t, important: true, title: `${b} 开多 · 日线趋势${late}`,
          body: `${entryLine(p, `日线收盘 ${fmt(e.price)} 突破前 20 日最高价`)}\n止损：${fmt(atrStop)}（${pctS(atrStop / p - 1)}）= 2 倍 ATR，日线收盘跌破就平${stop > atrStop * 1.0001 ? `；前 10 日最低价已上移到 ${fmt(stop)}（${pctS(stop / p - 1)}），先跌破哪条按哪条` : ""}\n止盈参考：不设目标价；日线收盘跌破前 10 日最低价就离场（这条线每天上移，让利润跑）\n${sizeLine("trend", p, stop, "现货或 1 倍", t.vol20)}` });
      } else {
        const opened = [...t.ev.slice(0, idx)].reverse().find(x => x.act === "开多");
        if (opened && !sentBefore.has(`${b}|trend|${opened.t}|开多`) && NOW2 - opened.t < 2 * 86400000) return;
        const gain = opened ? e.price / opened.price - 1 - 2 * 0.001 : null;
        events.push({ coin: b, kind: "tclose", price: px, sigPrice: e.price, sig: e.t, important: true, title: `${b} 平多 · 日线趋势${late}`,
          body: `离场原因：${e.why === "sl" ? "日线收盘跌破初始止损" : "日线收盘跌破前 10 日最低价"}\n离场价 ${fmt(e.price)}，现价 ${fmt(px)}${gain != null ? `\n这笔约 ${pctS(gain)}（已扣手续费，按信号价）` : ""}` });
      }
    });
    if (v) state.swing[b] = { dir: v.dir, action: v.action };
  }
  // 资金费率套利（2026-11-06 回测）：BTC、ETH 过去 7 天的本金年化 ≥10% 提醒可以考虑，跌回 5% 以下提醒结束
  state.carry = state.carry || {};
  for (const b of ["BTC", "ETH"]) {
    const f = R[b] && R[b].f; if (!f) continue;
    const was = state.carry[b], on = was ? f.carry >= 0.05 : f.carry >= 0.10, yr = (f.carry * 100).toFixed(1) + "%";
    console.log(`${b} 资金费率 ${(f.now * 100).toFixed(4)}%，套利年化 ${yr}`);
    if (was !== undefined && on !== was && !first)
      events.push({ coin: b, kind: "carry", important: false, title: on ? `${b} 资金费率套利值得考虑` : `${b} 资金费率套利可以结束`,
        body: on ? `过去 7 天资金费率折算本金年化约 ${yr}（一半本金买现货、一半做保证金开等量空单，不管涨跌只收资金费）。历史上只有牛市过热时才这么高（2021 年全年平均 BTC 约 15%），通常维持不了太久。\n开仓：现货买入和合约开空同时下、数量一样，合约 1 倍。年化跌回 5% 以下会再提醒你结束。`
          : `过去 7 天资金费率折算本金年化只剩约 ${yr}，扣掉手续费已经不划算。现货卖出、合约空单平掉，两边同时操作。` });
    state.carry[b] = on;
  }
  // ===== 运行记录 + 每日状态（2026-11-14）=====
  // GitHub 的定时任务不保证准时（11 月中旬实际每 5～8 小时才跑一次）。这里记下每次运行时间（一小时最多记一次），
  // 每天第一次运行（UTC 0 点后 = 马尼拉早 8 点后）发一条「每日状态」：没信号也发，写清为什么没信号、程序跑了几次。
  // 哪天没收到这条 = 程序没在跑。中断超过 10 小时恢复时另外提醒一次。
  {
    const NOWD = Date.now(), runs = (state.runs || []).filter(x => NOWD - x < 3 * 86400000), lastRun = runs.length ? runs[runs.length - 1] : null;
    const gapH = lastRun ? (NOWD - lastRun) / 3600000 : 0;
    if (!first && lastRun && gapH >= 10)
      events.push({ coin: null, kind: "ops", important: true, title: `盯盘程序中断了 ${Math.round(gapH)} 小时，刚恢复`,
        body: `上一次成功运行是 ${Math.round(gapH)} 小时前。这段时间的 4 小时信号会在这次补发（标注"延迟"）；超过 24 小时的不补。\n原因多半是 GitHub 定时任务延迟，信号请以网页为准。` });
    if (!lastRun || NOWD - lastRun >= 55 * 60000) runs.push(NOWD);
    state.runs = runs;
    const day = new Date(NOWD).toISOString().slice(0, 10);
    if (!first && state.digestDay !== day) {
      const sw = SHORT_SET.map(b => [b, R[b] && R[b].v]).filter(x => x[1]);
      const down = sw.filter(x => x[1].dir < 0).length, up = sw.filter(x => x[1].dir > 0).length;
      const btc = R.BTC && R.BTC.v, dW = d => d < 0 ? "向下" : d > 0 ? "向上" : "不明";
      const heldS = sw.filter(x => x[1].action === "持空中"), heldA = heldS.filter(x => openShorts[x[0]] != null);
      const waiting = sw.filter(x => x[1].dir < 0 && x[1].action === "观望").sort((a, c) => c[1].rsi - a[1].rsi);
      const hot = waiting.filter(x => x[1].phase === "hot"), negF = SHORT_SET.filter(b => R[b] && R[b].f && R[b].f.now <= 0).length;
      const tOpen = SYMBOLS.filter(b => R[b] && R[b].t && R[b].t.open && !R[b].t.exiting).length, qOpen = SHORT_SET.filter(b => R[b] && R[b].q && R[b].q.action === "持多中").length;
      const r24 = runs.filter(x => NOWD - x < 86400000), gaps = r24.slice(1).map((x, i) => (x - r24[i]) / 3600000), maxGap = gaps.length ? Math.max(...gaps) : null;
      const mkt = btc && btc.dir < 0 || down >= Math.ceil(sw.length * 0.6) ? "下跌市" : btc && btc.dir > 0 && up >= Math.ceil(sw.length * 0.6) ? "上涨市" : "方向不明";
      const shortLine = heldA.length ? `做空：模型持有 A 级空单 ${heldA.map(x => x[0]).join("、")}，按规则拿着。`
        : !down ? `做空：没有日线向下的币，做空系统不做。`
        : hot.length ? `做空：${hot.map(x => `${x[0]}（RSI ${x[1].rsi.toFixed(0)}）`).join("、")} 反弹已过热，RSI 回落到 ${SHORT_RSI_IN} 以下就出信号。`
        : `做空：没有信号。${down} 个币日线向下，都在等 4 小时反弹到 RSI ${SHORT_RSI_IN} 以上再回落${waiting.length ? `；现在最高的是 ${waiting.slice(0, 3).map(x => `${x[0]} ${x[1].rsi.toFixed(0)}`).join("、")}` : ""}。一路下跌不反弹时不追空（回测：追跌是亏的）。`;
      const lines = [
        `${mkt}：BTC ${btc ? fmt(btc.price) : "—"}，日线${btc ? dW(btc.dir) : "—"}；13 个主流币里 ${down} 个日线向下、${up} 个向上。`,
        shortLine + (heldS.length > heldA.length ? `另有 ${heldS.length - heldA.length} 笔 B / C 级只观察。` : "") + (negF ? `${negF} 个币资金费率为负，这些币出信号也只算 B 级（观察）。` : ""),
        `做多：日线趋势持多 ${tOpen} 个，4 小时双轨持多 ${qOpen} 个${!tOpen && !qOpen ? "；等日线突破 20 日新高，或 4 小时双轨金叉 + 红柱" : ""}。`,
        (r24.length < 2 ? `程序：运行记录今天开始记，明天起这里会写过去 24 小时跑了几次。` : `程序：过去 24 小时跑了 ${r24.length} 次，最长间隔 ${maxGap.toFixed(1)} 小时${maxGap > 4.5 ? "（GitHub 延迟偏大，信号可能晚到，请以网页为准）" : ""}。`) + `哪天没收到这条，就是程序没在跑。`,
      ];
      events.push({ coin: null, kind: "digest", important: false, title: `每日状态 ${day.slice(5)}：${mkt}，${heldA.length ? `持有空单 ${heldA.length} 笔` : hot.length ? `${hot.length} 个币快出做空信号` : tOpen + qOpen ? `持多 ${tOpen + qOpen} 个` : "现在没有信号"}`, body: lines.join("\n") });
      state.digestDay = day;
    } else if (first) state.digestDay = day;
  }
  console.log("数据源：", [...used].join("、") || "全部失败");
  console.log(summary.join("\n"));
  if (!summary.length) { process.exitCode = 1; return; }
  if (first) await push("盯盘已升级：多空指令", summary.join("\n"), false);
  if (!first && !state.v4) await push("盯盘已升级：新增日线趋势做多 + 策略状态灯",
    `两套系统一起跑：4小时做空、日线趋势做多。\n策略状态：4小时做空 ${H.short.word}；日线趋势做多 ${H.trend.word}。\n每条开仓推送都会写清进场、止损、止盈和建议仓位。`, false);
  if (!first && state.v4 && !state.v5) await push("盯盘已升级：日线趋势做多扩大到 38 个币",
    `新加 25 个主流币（只跑日线趋势做多，4小时做空仍是原来 13 个币）。\n策略状态：4小时做空 ${H.short.word}；日线趋势做多 ${H.trend.word}。`, false);
  if (!first && state.v5 && !state.v6) await push("盯盘已升级：新增 4 小时双轨做多",
    `第三套系统：13 个主流币上，4小时双轨金叉（红线 EMA5 上穿黄线 EMA34）且热力图有红柱就买，死叉就卖（每次死叉都卖）；只做多。\n空单中途反向涨到 3% / 5% 会各提醒一次「持仓守护」，只提示、不叫你操作。\n日线趋势、4小时双轨两套做多各用一半资金，建议仓位已按一半算；4小时做空不变。\n策略状态：日线趋势做多 ${H.trend.word}；4小时双轨做多 ${H.qx.word}。`, false);
  if (!first && state.v6 && !state.v7) await push("盯盘已调整：做空只做 A 级 · 空头合计封顶 40%",
    `1）做空只推 A 级（止损 ≥2%、日线转空 ≤30 天、资金费率不为负）。B、C 级不再推送开空，网页上仍能看到、标为"观察，不开"。回测：A 级做空 2018 年起三段都赚；B 级是拖后腿的那部分。\n2）空单合计名义不超过本金 40%：开空推送里会列出模型里还持有的空单各占多少，网页「可以开仓」按你标记的持仓精确算，到上限就写"这笔不开"。\n3）策略状态灯只作提示，不再自动减半 / 暂停（回测：按灯减仓反而少赚）。\n做多两套不变。`, false);
  if (!first && state.v7 && !state.v8) await push("盯盘已调整：做空门槛放宽 + 每日状态",
    `1）做空反弹门槛从 RSI 65 放宽到 60：信号大约多八成，回测两段数据总收益都更高（单笔平均会低一些）。A 级的其他条件不变（止损 ≥2%、转空 ≤30 天、资金费率不为负）。\n2）B / C 级信号改成发一条普通提醒「只观察不开」，不再完全静音。\n3）每天第一次运行发一条「每日状态」：没信号也发，写清为什么没信号、程序跑了几次。哪天没收到，就是程序没在跑。\n4）程序中断超过 10 小时，恢复时会提醒。`, false);
  state.v3 = 1; state.v4 = 1; state.v5 = 1; state.v6 = 1; state.v7 = 1; state.v8 = 1; state.trendCoins = SYMBOLS;
  // 每日状态单独发（不并进汇总），其余超过 6 条才合并
  const dg = events.filter(e => e.kind === "digest"), rest = events.filter(e => e.kind !== "digest");
  if (rest.length > 6) await push(`${rest.length} 条新提醒`, rest.map(e => e.title).join("\n"), true);
  else for (const e of rest) await push(e.title, e.body, e.important);
  for (const e of dg) await push(e.title, e.body, false);
  if (!KEY) { console.log("没有设置 BARK_KEY：这次只是试运行，不保存状态。"); return; }
  // 推送记录：网页「消息」页读取 alerts.json
  if (events.length) {
    let alerts = [];
    try { alerts = JSON.parse(fs.readFileSync("alerts.json", "utf8")); } catch (e) {}
    const t = Date.now();
    for (const e of events) { const { important, ...rest } = e; alerts.push({ t, ...rest }); }
    fs.writeFileSync("alerts.json", JSON.stringify(alerts.slice(-400), null, 1) + "\n");
  }
  state.sent = [...sent].slice(-300);
  fs.writeFileSync("state.json", JSON.stringify(state, null, 1) + "\n");
})();
})();
