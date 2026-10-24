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
const SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP"], QUOTE = "USDT";
const HISTORY = { "1d": 2000, "4h": 6000 };
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
    if (side && w !== side) { const x = o[i]; trades.push({ side, r: (side > 0 ? x * (1 - SLIP) / e - 1 : 1 - x * (1 + SLIP) / e) - 2 * FEE - FUND * (i - eI) }); side = 0; }
    if (!side && w) { side = w; e = w > 0 ? o[i] * (1 + SLIP) : o[i] * (1 - SLIP); eI = i; } }
  const st = sd => { const t = trades.filter(x => x.side === sd); if (!t.length) return { n: 0 }; const w = t.filter(x => x.r > 0).length;
    return { n: t.length, w, win: Math.round(100 * w / t.length), avg: 100 * t.reduce((a, x) => a + x.r, 0) / t.length }; };
  const L = n - 1, now = want[L], prev = want[L - 1];
  let action = "观望", entry = null, sinceBars = null, phase = null;
  if (now && now !== prev) action = now > 0 ? "开多" : "开空";
  else if (now) { action = now > 0 ? "持多中" : "持空中"; let p = L; while (p > 0 && want[p - 1] === now) p--; entry = p + 1 <= L ? o[p + 1] : c[L]; sinceBars = L - p; }
  else if (prev) action = prev > 0 ? "平多" : "平空";
  else { const d = dir[L]; phase = !d ? "nodir" : (d < 0 ? c[L] > e200[L] : c[L] < e200[L]) ? "wrongside" : (d < 0 ? r[L] > 65 : r[L] < 35) ? "hot" : "wait"; }
  return { dir: dir[L], action, side: now, entry, sinceBars, phase, stop: e200[L], rsi: r[L], price: c[L], barTs: k4.ts[L], trades, stats: { L: st(1), S: st(-1) } };
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
  const dn = d => d > 0 ? "向上（只做多）" : d < 0 ? "向下（只做空）" : "不明（不做）";
  for (const b of SYMBOLS) {
    let v;
    try { const [r1, s1] = await klines(b, "1d"), [r4, s4] = await klines(b, "4h"); used.add(s1); used.add(s4); v = swingCalc(toK(r4, "4h"), toK(r1, "1d")); }
    catch (e) { console.log(b, "拉取失败：", e.message); continue; }
    summary.push(`${b} ${fmt(v.price)}：${v.action}，日线${dn(v.dir)}`);
    const prev = state.swing[b];
    if (!first && prev && prev.dir !== v.dir)
      events.push({ important: true, title: `${b} 日线方向变为${dn(v.dir)}`, body: `现在${v.dir > 0 ? "只找做多机会" : v.dir < 0 ? "只找做空机会" : "不做"}。现价 ${fmt(v.price)}。点开看详情。` });
    if (["开多", "开空", "平多", "平空"].includes(v.action)) {
      const key = `${b}|swing|${v.barTs}|${v.action}`;
      if (!sent.has(key)) { sent.add(key);
        if (!first) {
          const sd = v.action === "开多" ? 1 : v.action === "开空" ? -1 : 0, s = sd ? v.stats[sd > 0 ? "L" : "S"] : null;
          const body = sd
            ? `参考价 ${fmt(v.price)}。止损：4小时收盘${sd > 0 ? "跌破" : "站上"} ${fmt(v.stop)}。止盈：4小时 RSI ${sd > 0 ? "升到 65 以上" : "跌到 35 以下"}。${s && s.n ? `历史上这样做 ${s.n} 次，胜率 ${s.win}%，平均每次 ${sgn(s.avg)}。` : ""}每次最多亏本金 1%，杠杆不超过 2 倍。`
            : `${v.action === "平多" ? "多单" : "空单"}离场信号。现价 ${fmt(v.price)}。`;
          events.push({ important: true, title: `${b} ${v.action}`, body });
        } }
    }
    state.swing[b] = { dir: v.dir, action: v.action };
  }
  console.log("数据源：", [...used].join("、") || "全部失败");
  console.log(summary.join("\n"));
  if (!summary.length) { process.exitCode = 1; return; }
  if (first) await push("盯盘已升级：多空指令", summary.join("\n"), false);
  if (events.length > 6) await push(`${events.length} 条新提醒`, events.map(e => e.title).join("\n"), true);
  else for (const e of events) await push(e.title, e.body, e.important);
  if (!KEY) { console.log("没有设置 BARK_KEY：这次只是试运行，不保存状态。"); return; }
  state.sent = [...sent].slice(-300);
  fs.writeFileSync("state.json", JSON.stringify(state, null, 1) + "\n");
})();
})();
