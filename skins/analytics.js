// ─── skins/analytics.js — CS skin market analytics (pure functions) ────────
// Shared by skins/server.js (Node require) and skins/index.html (browser
// global `SkinAnalytics`). NO side effects, NO network, NO Math.random —
// every function is deterministic on its inputs, so the probe can pin exact
// values. All prices are USD numbers; all timestamps are ms epoch (UTC).
//
// Series shapes:
//   point  = { t, price, vol }            one observation (vol may be null)
//   daily  = { day:"YYYY-MM-DD", t, price, vol }   one bucket per UTC day
//
// NOT FINANCIAL ADVICE: signal() is a transparent heuristic — every point of
// its score is itemized in `reasons` so the user can judge the inputs.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SkinAnalytics = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── money parsing ────────────────────────────────────────────────────────
  // Steam returns localized strings ("$43.80", "43,80€", "1,234.56 USD").
  function parseMoney(s) {
    if (typeof s === "number") return isFinite(s) ? s : null;
    if (typeof s !== "string") return null;
    let t = s.replace(/[^0-9.,-]/g, "");
    if (!t) return null;
    const lastDot = t.lastIndexOf("."), lastCom = t.lastIndexOf(",");
    if (lastCom > lastDot) {
      // Trailing comma group of exactly 3 digits reads as a THOUSANDS
      // separator ("31,263" = 31263); any other width is an EU decimal
      // ("43,80" = 43.80). Steam's en-US volume strings hit the first case.
      if (t.length - lastCom - 1 === 3) t = t.replace(/[.,]/g, "");
      else t = t.replace(/\./g, "").replace(",", ".");
    } else {
      t = t.replace(/,/g, "");
    }
    const v = parseFloat(t);
    return isFinite(v) ? v : null;
  }

  // Unit counts (sales volume): digits only, never a decimal.
  function parseCount(s) {
    if (typeof s === "number") return isFinite(s) ? Math.round(s) : null;
    if (typeof s !== "string") return null;
    const t = s.replace(/[^0-9]/g, "");
    return t ? parseInt(t, 10) : null;
  }

  function dayKey(t) {
    const d = new Date(t);
    const p = (n) => (n < 10 ? "0" + n : "" + n);
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
  }

  function median(vals) {
    if (!vals.length) return null;
    const s = vals.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // ── daily bucketing ──────────────────────────────────────────────────────
  // points → one bucket per UTC day. price = median of the day's readings.
  // volMode:
  //   "sum" — entries are per-interval sales counts (Steam price history:
  //           old rows daily, recent rows hourly → summing is correct)
  //   "max" — entries are trailing-24h readings (priceoverview snapshots:
  //           summing would double-count; max is the best daily estimate)
  function toDaily(points, opts) {
    const volMode = (opts && opts.volMode) || "sum";
    const buckets = new Map();
    for (const p of points || []) {
      if (!p || !isFinite(p.t) || !isFinite(p.price) || p.price <= 0) continue;
      const k = dayKey(p.t);
      let b = buckets.get(k);
      if (!b) { b = { day: k, t: 0, prices: [], vol: null }; buckets.set(k, b); }
      b.t = Math.max(b.t, p.t);
      b.prices.push(p.price);
      const v = p.vol == null ? null : Number(p.vol);
      if (v != null && isFinite(v)) {
        if (b.vol == null) b.vol = v;
        else b.vol = volMode === "max" ? Math.max(b.vol, v) : b.vol + v;
      }
    }
    return Array.from(buckets.values())
      .map((b) => ({ day: b.day, t: b.t, price: round2(median(b.prices)), vol: b.vol }))
      .sort((a, b) => (a.day < b.day ? -1 : 1));
  }

  // Merge daily series; on a day collision the EARLIER argument wins
  // (call as mergeDaily(richSource, fallbackSource)).
  function mergeDaily(primary, secondary) {
    const seen = new Map();
    for (const d of primary || []) seen.set(d.day, d);
    for (const d of secondary || []) if (!seen.has(d.day)) seen.set(d.day, d);
    return Array.from(seen.values()).sort((a, b) => (a.day < b.day ? -1 : 1));
  }

  function round2(v) { return v == null ? null : Math.round(v * 100) / 100; }

  // ── indicators ───────────────────────────────────────────────────────────
  function sma(vals, n) {
    if (!vals.length || n <= 0) return null;
    const w = vals.slice(-n);
    return w.reduce((a, b) => a + b, 0) / w.length;
  }

  // Full SMA overlay track (null until n points exist) — for charting.
  function smaTrack(vals, n) {
    const out = new Array(vals.length).fill(null);
    let sum = 0;
    for (let i = 0; i < vals.length; i++) {
      sum += vals[i];
      if (i >= n) sum -= vals[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  function ema(vals, n) {
    if (vals.length < n || n <= 0) return null;
    const k = 2 / (n + 1);
    let e = vals.slice(0, n).reduce((a, b) => a + b, 0) / n; // SMA seed
    for (let i = n; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
    return e;
  }

  // Wilder RSI. All-gains series → 100; all-losses → 0.
  function rsi(vals, n) {
    n = n || 14;
    if (vals.length < n + 1) return null;
    let gain = 0, loss = 0;
    for (let i = 1; i <= n; i++) {
      const d = vals[i] - vals[i - 1];
      if (d > 0) gain += d; else loss -= d;
    }
    gain /= n; loss /= n;
    for (let i = n + 1; i < vals.length; i++) {
      const d = vals[i] - vals[i - 1];
      gain = (gain * (n - 1) + (d > 0 ? d : 0)) / n;
      loss = (loss * (n - 1) + (d < 0 ? -d : 0)) / n;
    }
    if (loss === 0) return 100;
    return 100 - 100 / (1 + gain / loss);
  }

  function logReturns(prices) {
    const out = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i] > 0 && prices[i - 1] > 0) out.push(Math.log(prices[i] / prices[i - 1]));
    }
    return out;
  }

  // Annualized volatility (σ of daily log returns × √365), as a FRACTION
  // (0.5 = 50%/yr). Constant series → 0.
  function volAnnualized(prices) {
    const r = logReturns(prices);
    if (r.length < 2) return null;
    const mu = r.reduce((a, b) => a + b, 0) / r.length;
    const varr = r.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (r.length - 1);
    return Math.sqrt(varr) * Math.sqrt(365);
  }

  // Max peak-to-trough drawdown over the series, as a FRACTION of the peak.
  function maxDrawdown(prices) {
    let peak = -Infinity, dd = 0, peakIdx = -1, curPeakIdx = -1, troughIdx = -1;
    for (let i = 0; i < prices.length; i++) {
      if (prices[i] > peak) { peak = prices[i]; curPeakIdx = i; }
      const d = (peak - prices[i]) / peak;
      if (d > dd) { dd = d; peakIdx = curPeakIdx; troughIdx = i; }
    }
    return { dd: dd, peakIdx: peakIdx, troughIdx: troughIdx };
  }

  // Drawdown from the ALL-TIME peak to the LATEST price.
  function currentDrawdown(prices) {
    if (!prices.length) return null;
    const peak = Math.max.apply(null, prices);
    return (peak - prices[prices.length - 1]) / peak;
  }

  // OLS slope of log(price) on day index over the trailing window →
  // fractional %/day (0.01 = +1%/day). Needs ≥5 points.
  function trendSlope(daily, windowDays) {
    const w = daily.slice(-(windowDays || 30)).filter((d) => d.price > 0);
    if (w.length < 5) return null;
    const n = w.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      const y = Math.log(w[i].price);
      sx += i; sy += y; sxx += i * i; sxy += i * y;
    }
    const denom = n * sxx - sx * sx;
    if (!denom) return null;
    const b = (n * sxy - sx * sy) / denom; // log-units per day
    return Math.exp(b) - 1;
  }

  // % change vs the closest daily point at least `days` before the latest.
  function momentum(daily, days) {
    if (daily.length < 2) return null;
    const last = daily[daily.length - 1];
    const cutoff = last.t - days * 86400000;
    let base = null;
    for (let i = daily.length - 2; i >= 0; i--) {
      base = daily[i];
      if (daily[i].t <= cutoff) break;
    }
    if (!base || base.price <= 0) return null;
    return (last.price - base.price) / base.price;
  }

  // Median daily units sold over the trailing window (null-vol days skipped).
  function liquidity(daily, windowDays) {
    const w = daily.slice(-(windowDays || 30)).map((d) => d.vol).filter((v) => v != null);
    return w.length ? median(w) : null;
  }

  // ── marketplace fees ─────────────────────────────────────────────────────
  // Steam: buyer pays P, seller receives P/1.15 (5% Steam + 10% CS), and the
  // proceeds are WALLET-LOCKED (never cash). Skinport: ~12% seller fee, cash.
  const FEES = { steam: { div: 1.15, cash: false }, skinport: { rate: 0.12, cash: true } };
  function netProceeds(price, market) {
    if (price == null || !isFinite(price)) return null;
    if (market === "steam") return round2(price / FEES.steam.div);
    if (market === "skinport") return round2(price * (1 - FEES.skinport.rate));
    return null;
  }

  // ── composite signal ─────────────────────────────────────────────────────
  // Transparent additive score in roughly [-100, 100]; every contribution is
  // pushed to `reasons`. A heuristic to organize the numbers — not advice.
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function signal(m) {
    // m = { mom7, mom30, slope30, rsi14, curDD, vol30, liq30 } (nullables)
    let score = 0;
    const reasons = [];
    const add = (pts, why) => { score += pts; reasons.push((pts >= 0 ? "+" : "") + Math.round(pts) + " " + why); };
    if (m.mom30 != null) add(clamp(m.mom30 * 100, -30, 30) * 1.1, "30d momentum " + pct(m.mom30));
    if (m.slope30 != null) add(clamp(m.slope30 * 100 * 300, -25, 25) / 10, "30d trend " + pct(m.slope30) + "/day");
    if (m.rsi14 != null) {
      if (m.rsi14 >= 75) add(-15, "RSI " + Math.round(m.rsi14) + " overbought");
      else if (m.rsi14 <= 30) add(12, "RSI " + Math.round(m.rsi14) + " oversold");
    }
    if (m.curDD != null && m.curDD > 0.25 && m.mom7 != null && m.mom7 > 0)
      add(10, "recovering, " + pct(m.curDD) + " below peak");
    if (m.curDD != null && m.curDD < 0.03 && m.rsi14 != null && m.rsi14 > 70)
      add(-8, "at highs and hot");
    if (m.vol30 != null && m.vol30 > 1.0) add(-10, "high volatility " + pct(m.vol30) + "/yr");
    if (m.liq30 != null && m.liq30 < 3) { score *= 0.6; reasons.push("×0.6 illiquid (~" + m.liq30 + "/day)"); }
    score = clamp(score, -100, 100);
    const verdict = score >= 30 ? "STRONG BUY" : score >= 12 ? "BUY"
      : score > -12 ? "HOLD" : score > -30 ? "SELL" : "STRONG SELL";
    return { score: Math.round(score), verdict: verdict, reasons: reasons };
  }
  function pct(v) { return (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%"; }

  // ── full report over a daily series ──────────────────────────────────────
  function analyze(daily) {
    const prices = daily.map((d) => d.price);
    const last = daily.length ? daily[daily.length - 1] : null;
    const m = {
      days: daily.length,
      latest: last ? last.price : null,
      latestDay: last ? last.day : null,
      sma7: round2(sma(prices, 7)),
      sma30: round2(sma(prices, 30)),
      mom7: momentum(daily, 7),
      mom30: momentum(daily, 30),
      mom90: momentum(daily, 90),
      slope30: trendSlope(daily, 30),
      rsi14: rsi(prices.slice(-90), 14),
      vol30: volAnnualized(prices.slice(-31)),
      curDD: currentDrawdown(prices),
      maxDD: maxDrawdown(prices).dd,
      liq30: liquidity(daily, 30),
    };
    m.signal = signal(m);
    return m;
  }

  return {
    parseMoney: parseMoney, parseCount: parseCount, dayKey: dayKey, median: median, toDaily: toDaily,
    mergeDaily: mergeDaily, round2: round2, sma: sma, smaTrack: smaTrack,
    ema: ema, rsi: rsi, logReturns: logReturns, volAnnualized: volAnnualized,
    maxDrawdown: maxDrawdown, currentDrawdown: currentDrawdown,
    trendSlope: trendSlope, momentum: momentum, liquidity: liquidity,
    netProceeds: netProceeds, signal: signal, analyze: analyze, FEES: FEES,
  };
});
