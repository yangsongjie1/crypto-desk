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
const SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "LTC", "DOT", "TRX", "BCH"], QUOTE = "USDT";
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
async function klines(b, tf) {
  const order = [preferred, ...SOURCES.map((_, i) => i).filter(i => i !== preferred)], errs = [];
  for (const i of order) {
    try { const r = await SOURCES[i].klines(b, tf, HISTORY[tf]); if (r.length < 400) throw new Error("only " + r.length + " bars"); preferred = i; return [r, SOURCES[i].name]; }
    catch (e) { errs.push(SOURCES[i].name + ": " + e.message); }
  }
  throw new Error(errs.join("; "));
}
function toK(arr, tf) {
  const now = Date.now(), r = arr.filter(x => x[0] + STEP[tf] <= now), k = { ts: r.map(x => x[0]) };
  ["o", "h", "l", "c"].forEach((f, i) => { k[f] = Float64Array.from(r, x => x[i + 1]); });
  return k;
}
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
  const want = new Int8Array(n); let s = 0, l = 0;
  for (let i = 1; i < n; i++) {
    if (!s && c[i] < e200[i] && r[i - 1] > 65 && r[i] <= 65) s = 1; else if (s && (r[i] < 35 || c[i] > e200[i])) s = 0;
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
    if (want[i] === -1) ev.push({ t: k4.ts[i], act: "开空", price: c[i] });
  }
  const L = n - 1, now = want[L], prev = want[L - 1];
  let action = "观望", entry = null, sinceBars = null, phase = null;
  if (now && now !== prev) action = now > 0 ? "开多" : "开空";
  else if (now) { action = now > 0 ? "持多中" : "持空中"; let p = L; while (p > 0 && want[p - 1] === now) p--; entry = p + 1 <= L ? o[p + 1] : c[L]; sinceBars = L - p; }
  else if (prev) action = prev > 0 ? "平多" : "平空";
  else { const d = dir[L]; phase = !d ? "nodir" : (d < 0 ? c[L] > e200[L] : c[L] < e200[L]) ? "wrongside" : (d < 0 ? r[L] > 65 : r[L] < 35) ? "hot" : "wait"; }
  return { dir: dir[L], action, side: now, entry, sinceBars, phase, stop: e200[L], rsi: r[L], price: c[L], barTs: k4.ts[L], trades, ev, stats: { L: st(1), S: st(-1) } };
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
  return { action, open, exiting, trades, ev, price, barTs: ts[L], e200: e200[L], atr: atr[L],
    up: hh(n, 20), dn: ll(n, 20), side: price > e200[L] ? 1 : -1 };
}
function healthOf(trades, N = 30) {
  const t = trades.slice().sort((x, y) => x.t1 - y.t1).slice(-N);
  if (t.length < 15) return { level: "gray", word: "样本不足", factor: 1, n: t.length };
  let gw = 0, gl = 0, s = 0; for (const x of t) { s += x.r; if (x.r > 0) gw += x.r; else gl -= x.r; }
  const pf = gl > 0 ? gw / gl : 9, avg = s / t.length, win = t.filter(x => x.r > 0).length / t.length;
  const level = pf >= 1.1 ? "green" : pf >= 0.8 ? "yellow" : "red";
  return { level, pf, avg, win, n: t.length, factor: { green: 1, yellow: 0.5, red: 0 }[level],
    word: { green: "正常", yellow: "变弱：仓位减半", red: "失灵：暂停新开仓" }[level] };
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
  const SYSN = { short: "4小时做空", trend: "日线趋势做多" };
  const pctS = x => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";
  // 1) 先算好每个币的两套系统
  const R = {};
  for (const b of SYMBOLS) {
    try {
      const [r1, s1] = await klines(b, "1d"), [r4, s4] = await klines(b, "4h"); used.add(s1); used.add(s4);
      const k4 = toK(r4, "4h"), k1 = toK(r1, "1d"), v = swingCalc(k4, k1);
      if (v.dir > 0) Object.assign(v, { action: "观望", side: 0 });
      v.tp = rsiTarget(k4.c, 35);
      R[b] = { v, t: trendCalc(k1, true) };
    } catch (e) { console.log(b, "拉取失败：", e.message); }
  }
  // 2) 策略状态灯（最近 30 笔）
  const H = {
    short: healthOf(Object.values(R).flatMap(x => x.v.trades.filter(t => t.side < 0))),
    trend: healthOf(Object.values(R).flatMap(x => x.t ? x.t.trades : [])),
  };
  const healthInit = !state.health;
  state.health = state.health || {};
  for (const sys of ["short", "trend"]) {
    const h = H[sys], prevL = state.health[sys];
    if (!healthInit && !first && prevL && prevL !== h.level && h.level !== "gray")
      events.push({ coin: null, kind: "health", sys, level: h.level, important: h.level !== "green", title: `${SYSN[sys]} 策略状态：${h.word}`,
        body: `最近 ${h.n} 笔模拟交易：胜率 ${Math.round(h.win * 100)}%，平均每笔 ${pctS(h.avg)}，赚亏比 ${h.pf.toFixed(2)}。${h.level === "yellow" ? "之后的建议仓位自动减半。" : h.level === "red" ? "暂停新开仓，已有的单照常按规则离场。" : "恢复正常仓位。"}` });
    state.health[sys] = h.level;
  }
  const sizeLine = (sys, entry, stop, lev) => {
    const h = H[sys], side = sys === "short" ? -1 : 1, z = side * (entry - stop) > 0 ? sizePct(entry, stop, 1, 40, h.factor) : null;
    if (!z) return "仓位：现价已越过止损线，不要开仓";
    if (h.factor === 0) return `仓位：策略状态红灯，暂停新开仓，只看不做`;
    return `仓位：本金的 ${z.pct.toFixed(0)}%（每笔最多亏 1%），${lev}${h.factor < 1 ? `；策略${h.word}` : ""}` +
      (sys === "short" && z.tight ? `\n⚠ 止损只离 ${(z.dist * 100).toFixed(1)}%，历史上这类单胜率仅 18%，建议跳过或减半` : "");
  };
  const shortPlan = (v, p) => [
    `止损：${fmt(v.stop)}（${pctS(v.stop / p - 1)}），4小时收盘站上就平`,
    v.tp && v.tp < p ? `止盈：约 ${fmt(v.tp)}（${pctS(v.tp / p - 1)}），以 4小时 RSI 跌破 35 为准` : `止盈：4小时 RSI 已在 35 以下，留意平空提示`,
    sizeLine("short", p, v.stop, "杠杆≤2倍"),
  ].join("\n");
  const trendInit = !state.trendInit; state.trendInit = 1;
  // 3) 逐个币生成推送
  for (const b of SYMBOLS) {
    if (!R[b]) continue;
    const { v, t } = R[b];
    summary.push(`${b} ${fmt(v.price)}：做空系统${v.action}，日线${dn(v.dir)}${t ? `；趋势${t.action}` : ""}`);
    const prev = state.swing[b];
    if (!first && prev && prev.dir !== v.dir)
      events.push({ coin: b, kind: "dir", dir: v.dir, price: v.price, important: true, title: `${b} 日线方向变为${dn(v.dir)}`, body: `${v.dir > 0 ? "做空系统不做（别逆势做空）" : v.dir < 0 ? "做空系统开始找机会：等 4 小时反弹过热再回落" : "做空系统不做"}。现价 ${fmt(v.price)}。` });
    // 开空/平空：查最近 24 小时内的所有翻转，不只看最新一根，GitHub 定时任务延迟也不会漏
    const sentBefore = new Set(sent), H4 = 14400000, NOW = Date.now();
    v.ev.forEach((e, idx) => {
      const close = e.t + H4, key = `${b}|swing|${e.t}|${e.act}`;
      if (NOW - close > 86400000 || sent.has(key)) return;
      sent.add(key);
      if (first) return;
      const lateH = (NOW - close) / 3600000, late = lateH >= 1.5 ? `（延迟 ${Math.round(lateH)} 小时）` : "";
      if (e.act === "开空") {
        if (v.ev.slice(idx + 1).some(x => x.act === "平空")) return; // 提醒到达前已经平空：不再推送
        const move = 1 - v.price / e.price;
        const body = `进场：现价 ${fmt(v.price)}（信号价 ${fmt(e.price)}${late ? `，${move >= 0 ? "已跌" : "已涨"} ${Math.abs(move * 100).toFixed(1)}%，2 天内仍可跟进` : ""}）\n${shortPlan(v, v.price)}`;
        events.push({ coin: b, kind: "open", price: v.price, sigPrice: e.price, stop: v.stop, tp: v.tp, sig: close, important: true, title: `${b} 开空 · 4小时做空${late}`, body });
        v.justOpened = true;
      } else {
        const opened = [...v.ev.slice(0, idx)].reverse().find(x => x.act === "开空");
        if (opened && NOW - (opened.t + H4) < 86400000 && !sentBefore.has(`${b}|swing|${opened.t}|开空`)) return; // 开空也没提醒过：用户没持仓，不推平空
        const gain = opened ? 1 - e.price / opened.price - 2 * 0.001 : null;
        events.push({ coin: b, kind: "close", price: v.price, sigPrice: e.price, sig: close, important: true, title: `${b} 平空 · 4小时做空${late}`,
          body: `离场原因：${e.why}\n离场价 ${fmt(e.price)}，现价 ${fmt(v.price)}${gain != null ? `\n这笔约 ${pctS(gain)}（已扣手续费，按信号价）` : ""}` });
      }
    });
    if (v.action === "持空中" && v.sinceBars >= 6 && v.sinceBars < 12 && !v.justOpened) {
      const key = `${b}|follow|${v.barTs - v.sinceBars * 14400000}`;
      if (!sent.has(key)) { sent.add(key);
        if (!first) { const fell = 1 - v.price / v.entry;
          events.push({ coin: b, kind: "follow", price: v.price, stop: v.stop, tp: v.tp, important: true, title: `${b} 跟进提示：开空已满 1 天`,
            body: `进场：现价 ${fmt(v.price)}（${(v.sinceBars * 4 / 24).toFixed(1)} 天前信号价 ${fmt(v.entry)}，${fell >= 0 ? "已跌" : "已涨"} ${Math.abs(fell * 100).toFixed(1)}%）\n${shortPlan(v, v.price)}\n历史上晚 1～2 天跟进：胜率 56%，平均每次 +1.1%` }); } }
    }
    // 日线趋势做多：查最近 2 天的信号
    if (t) t.ev.forEach((e, idx) => {
      const key = `${b}|trend|${e.t}|${e.act}`, NOW2 = Date.now();
      if (NOW2 - e.t > 2 * 86400000 || sent.has(key)) return;
      sent.add(key);
      if (first || trendInit) return;
      const lateH = (NOW2 - e.t) / 3600000, late = lateH >= 6 ? `（延迟 ${Math.round(lateH)} 小时）` : "";
      if (e.act === "开多") {
        if (t.ev.slice(idx + 1).some(x => x.act === "平多")) return;
        const p = v.price, stop = t.open && t.open.exitLv ? t.open.exitLv : (t.open ? t.open.stop : e.price - 2 * t.atr);
        events.push({ coin: b, kind: "topen", price: p, sigPrice: e.price, stop, sig: e.t, important: true, title: `${b} 开多 · 日线趋势${late}`,
          body: `进场：现价 ${fmt(p)}（日线收盘 ${fmt(e.price)} 突破前 20 日最高价）\n止损：${fmt(stop)}（${pctS(stop / p - 1)}），日线收盘跌破就平；之后平仓线每天上移（前 10 日最低价）\n止盈：不设固定止盈，让利润跑\n${sizeLine("trend", p, stop, "现货或 1 倍")}` });
      } else {
        const opened = [...t.ev.slice(0, idx)].reverse().find(x => x.act === "开多");
        if (opened && !sentBefore.has(`${b}|trend|${opened.t}|开多`) && NOW2 - opened.t < 2 * 86400000) return;
        const gain = opened ? e.price / opened.price - 1 - 2 * 0.001 : null;
        events.push({ coin: b, kind: "tclose", price: v.price, sigPrice: e.price, sig: e.t, important: true, title: `${b} 平多 · 日线趋势${late}`,
          body: `离场原因：${e.why === "sl" ? "日线收盘跌破初始止损" : "日线收盘跌破前 10 日最低价"}\n离场价 ${fmt(e.price)}，现价 ${fmt(v.price)}${gain != null ? `\n这笔约 ${pctS(gain)}（已扣手续费，按信号价）` : ""}` });
      }
    });
    state.swing[b] = { dir: v.dir, action: v.action };
  }
  console.log("数据源：", [...used].join("、") || "全部失败");
  console.log(summary.join("\n"));
  if (!summary.length) { process.exitCode = 1; return; }
  if (first) await push("盯盘已升级：多空指令", summary.join("\n"), false);
  if (!first && !state.v4) await push("盯盘已升级：新增日线趋势做多 + 策略状态灯",
    `两套系统一起跑：4小时做空、日线趋势做多。\n策略状态：4小时做空 ${H.short.word}；日线趋势做多 ${H.trend.word}。\n每条开仓推送都会写清进场、止损、止盈和建议仓位。`, false);
  state.v3 = 1; state.v4 = 1;
  if (events.length > 6) await push(`${events.length} 条新提醒`, events.map(e => e.title).join("\n"), true);
  else for (const e of events) await push(e.title, e.body, e.important);
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
