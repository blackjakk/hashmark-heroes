#!/usr/bin/env node
// skins/probe.js — hermetic gate for the CS skin market tracker.
//
// NO network: market.js's transport is replaced with a fixture, the server
// runs in-process on an ephemeral port with a tmp data dir, timers off.
// Battery: analytics math pinned to hand-computed values, then the full HTTP
// flow (search → watch → snapshot/dedupe → paste-import → cookie-bootstrap →
// analytics report → cross-market compare → portfolio P/L → restart
// persistence). Exit 0 = all pass.
//
//   node skins/probe.js
"use strict";
const os = require("os");
const path = require("path");
const fs = require("fs");
const A = require("./analytics.js");
const M = require("./market.js");
const { startServer, slug } = require("./server.js");

let pass = 0, fail = 0;
const ok = (c, label) => { if (c) { pass++; console.log("  ✓ " + label); } else { fail++; console.log("  ✗ FAIL " + label); } };
const near = (a, b, eps) => a != null && Math.abs(a - b) <= (eps == null ? 1e-9 : eps);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── analytics units ────────────────────────────────────────────────────────
console.log("— analytics —");
ok(A.parseMoney("$43.80") === 43.8 && A.parseMoney("1,234.56 USD") === 1234.56, "parseMoney US formats");
ok(A.parseMoney("1.234,56€") === 1234.56 && A.parseMoney("43,80€") === 43.8, "parseMoney EU formats");
ok(A.parseMoney(null) === null && A.parseMoney("--") === null && A.parseMoney(7) === 7, "parseMoney junk/number");
ok(A.parseMoney("31,263") === 31263 && A.parseMoney("1,234") === 1234, "parseMoney: trailing 3-digit comma group = thousands (steam volume trap)");
ok(A.parseCount("31,263") === 31263 && A.parseCount("57") === 57 && A.parseCount("") === null, "parseCount: unit counts are digits-only");
ok(A.sma([1, 2, 3, 4, 5], 5) === 3 && A.sma([1, 2, 3, 4, 5], 2) === 4.5, "sma");
const trk = A.smaTrack([1, 2, 3, 4, 5], 3);
ok(trk[0] === null && trk[1] === null && trk[2] === 2 && trk[4] === 4, "smaTrack overlay");
ok(near(A.ema([1, 2, 3, 4, 5], 2), 4.5, 1e-12), "ema (SMA-seeded recursion)");
ok(A.rsi(Array.from({ length: 20 }, (_, i) => 10 + i), 14) === 100, "rsi all-gains = 100");
ok(A.rsi(Array.from({ length: 20 }, (_, i) => 40 - i), 14) < 1e-9, "rsi all-losses = 0");
const dd = A.maxDrawdown([10, 12, 6, 9]);
ok(near(dd.dd, 0.5) && dd.peakIdx === 1 && dd.troughIdx === 2, "maxDrawdown peak→trough");
ok(near(A.currentDrawdown([10, 12, 6, 9]), 0.25), "currentDrawdown vs all-time peak");
ok(A.volAnnualized([5, 5, 5, 5, 5, 5]) === 0, "volatility of constant series = 0");

const D = 86400000, T0 = Date.UTC(2026, 0, 1);
const expDaily = Array.from({ length: 30 }, (_, i) => ({ day: A.dayKey(T0 + i * D), t: T0 + i * D, price: 100 * Math.exp(0.01 * i), vol: 10 }));
ok(near(A.trendSlope(expDaily, 30), Math.exp(0.01) - 1, 1e-9), "trendSlope recovers exact exponential");
ok(near(A.momentum(expDaily, 7), Math.exp(0.01 * 7) - 1, 1e-9), "momentum 7d vs 7d-ago point");
ok(A.liquidity(expDaily, 30) === 10, "liquidity = median daily volume");

const hourly = [
  { t: T0 + 1 * 3600000, price: 10, vol: 5 },
  { t: T0 + 5 * 3600000, price: 14, vol: 7 },
  { t: T0 + 9 * 3600000, price: 12, vol: 3 },
  { t: T0, price: -1, vol: 1 },           // bad row dropped
  { t: NaN, price: 10, vol: 1 },           // bad row dropped
];
const dSum = A.toDaily(hourly, { volMode: "sum" });
ok(dSum.length === 1 && dSum[0].price === 12 && dSum[0].vol === 15, "toDaily: median price + summed vol (history mode)");
const dMax = A.toDaily(hourly, { volMode: "max" });
ok(dMax[0].vol === 7, "toDaily: max vol (trailing-24h snapshot mode)");
const merged = A.mergeDaily([{ day: "2026-01-01", t: T0, price: 1, vol: 1 }], [{ day: "2026-01-01", t: T0, price: 9, vol: 9 }, { day: "2026-01-02", t: T0 + D, price: 2, vol: 2 }]);
ok(merged.length === 2 && merged[0].price === 1 && merged[1].price === 2, "mergeDaily: primary wins collisions, gaps filled");
ok(A.netProceeds(11.5, "steam") === 10 && A.netProceeds(100, "skinport") === 88, "fee math (steam /1.15, skinport -12%)");
ok(M.parseSteamDate("Dec 06 2013 01: +0") === Date.UTC(2013, 11, 6, 1), "steam history date parse");

const up = A.signal({ mom7: 0.05, mom30: 0.25, slope30: 0.008, rsi14: 60, curDD: 0.1, vol30: 0.4, liq30: 50 });
ok(up.score > 12 && /BUY/.test(up.verdict), "signal: sustained uptrend → BUY (" + up.score + ")");
const crash = A.signal({ mom7: -0.1, mom30: -0.3, slope30: -0.01, rsi14: 40, curDD: 0.35, vol30: 0.4, liq30: 50 });
ok(crash.score < -12 && /SELL/.test(crash.verdict), "signal: downtrend → SELL (" + crash.score + ")");
const thin = A.signal({ mom7: 0.05, mom30: 0.25, slope30: 0.008, rsi14: 60, curDD: 0.1, vol30: 0.4, liq30: 1 });
ok(Math.abs(thin.score) < Math.abs(up.score) && thin.reasons.some((r) => /illiquid/.test(r)), "signal: illiquidity dampens score");
ok(up.reasons.length >= 2, "signal reasons itemized (transparent heuristic)");

// ── fixture transport ──────────────────────────────────────────────────────
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function steamDateStr(t) {
  const d = new Date(t);
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return MON[d.getUTCMonth()] + " " + p(d.getUTCDate()) + " " + d.getUTCFullYear() + " " + p(d.getUTCHours()) + ": +0";
}
const fixture = { steamPrice: "$23.00", steamLow: "$22.10", steamVol: "57" };
async function fixtureTransport(url, headers) {
  if (url.includes("/market/priceoverview/")) {
    return { status: 200, body: JSON.stringify({ success: true, lowest_price: fixture.steamLow, volume: fixture.steamVol, median_price: fixture.steamPrice }) };
  }
  if (url.includes("/market/pricehistory/")) {
    if (!headers || !headers.Cookie) return { status: 400, body: "" };
    const now = Date.now();
    const prices = Array.from({ length: 40 }, (_, i) => [steamDateStr(now - (40 - i) * D), 4 + i * 0.1, "" + (50 + i)]);
    return { status: 200, body: JSON.stringify({ success: true, price_prefix: "$", prices }) };
  }
  if (url.includes("api.skinport.com/v1/items")) {
    return { status: 200, body: JSON.stringify([
      { market_hash_name: "AWP | Dragon Lore (Factory New)", min_price: 12000, mean_price: 12500, max_price: 15000, quantity: 3 },
      { market_hash_name: "AK-47 | Redline (Field-Tested)", min_price: 20.5, mean_price: 24, max_price: 60, quantity: 400 },
    ]) };
  }
  if (url.includes("api.skinport.com/v1/sales/history")) {
    const agg = (mul) => ({ min: 18 * mul, max: 30 * mul, avg: 21 * mul, median: 20 * mul, volume: 21 });
    return { status: 200, body: JSON.stringify([{ market_hash_name: decodeURIComponent(/market_hash_name=([^&]+)/.exec(url)[1]), last_24_hours: agg(1), last_7_days: agg(1), last_30_days: agg(1), last_90_days: agg(1) }]) };
  }
  return { status: 404, body: "" };
}

// ── server flow ────────────────────────────────────────────────────────────
(async () => {
  console.log("— server —");
  M.setTransport(fixtureTransport);
  const DATA = path.join(os.tmpdir(), "hh-skin-probe-" + Date.now());
  const PORT = 5391;
  let inst = startServer({ port: PORT, dataDir: DATA, snapHours: 0, steamCookie: "steamLoginSecure=probe" });
  const api = async (p, body) => {
    // Connection:close — the probe restarts the server; pooled keep-alive
    // sockets to the dead instance would otherwise poison the next fetch.
    const opts = body
      ? { method: "POST", headers: { "Content-Type": "application/json", Connection: "close" }, body: JSON.stringify(body) }
      : { headers: { Connection: "close" } };
    const r = await fetch("http://localhost:" + PORT + p, opts);
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const NAME = "AK-47 | Redline (Field-Tested)";
  const KNIFE = "★ Karambit | Doppler (Factory New)";

  const h = await api("/api/skins/health");
  ok(h.status === 200 && h.body.ok === 1 && h.body.steamCookie === true, "health up (fixture cookie visible)");

  let s = await api("/api/skins/search?q=redline");
  ok(s.body.results.some((r) => r.name === NAME), "search finds seed item pre-dump");
  s = await api("/api/skins/search?q=bravo");
  ok(s.body.results.some((r) => r.name === "Operation Bravo Case"), "search: cases in the seed universe");

  let w = await api("/api/skins/watch", { name: NAME });
  ok(w.body.watchlist.includes(NAME), "watch add");
  await api("/api/skins/watch", { name: KNIFE });

  const r1 = await api("/api/skins/refresh", {});
  const mine = r1.body.results.find((x) => x.name === NAME);
  ok(r1.status === 200 && mine && mine.ok && mine.appended === true, "refresh snapshots the watchlist (fixture steam quote)");
  const r2 = await api("/api/skins/refresh", { name: NAME });
  ok(r2.body.results[0].appended === false, "snapshot dedupe (<30min apart is skipped)");
  const histLines = fs.readFileSync(path.join(DATA, "history", slug(NAME) + ".jsonl"), "utf8").trim().split("\n");
  ok(histLines.filter((l) => JSON.parse(l).src === "steam").length === 1, "exactly one steam line on disk after dedupe");
  ok(fs.existsSync(path.join(DATA, "history", slug(KNIFE) + ".jsonl")), "unicode/star name maps to a safe history file");

  await sleep(150); // dump refresh is fire-and-forget inside /refresh
  s = await api("/api/skins/search?q=dragon lore");
  const dl = s.body.results.find((r) => r.name === "AWP | Dragon Lore (Factory New)");
  ok(dl && dl.price === 12000, "search universe extends with the cached skinport dump");

  let it = await api("/api/skins/item?name=" + encodeURIComponent(NAME));
  ok(it.body.quote && it.body.quote.price === 23 && it.body.quote.vol === 57, "item quote = latest steam snapshot");
  ok(it.body.skinport.sales && it.body.skinport.sales.last24h.median === 20, "skinport sale aggregates cached on item");
  ok(it.body.compare.steam.net === 20 && it.body.compare.skinport.net === 17.6, "cross-market net proceeds (fees applied)");
  ok(it.body.skinportDaily.length === 1 && it.body.skinportDaily[0].price === 20, "skinport realized-price series accrues too");

  // paste-import a 60-day uptrend ending yesterday → real time-series analytics
  const now = Date.now();
  const paste = Array.from({ length: 60 }, (_, i) => [steamDateStr(now - (60 - i) * D), 10 * Math.exp(0.005 * i), "50"]);
  const imp = await api("/api/skins/import", { name: NAME, prices: paste });
  ok(imp.status === 200 && imp.body.rows === 60, "paste-import accepts steam pricehistory shape");
  it = await api("/api/skins/item?name=" + encodeURIComponent(NAME));
  ok(it.body.daily.length >= 61, "imported history + live snapshots merge into one series");
  ok(it.body.daily[it.body.daily.length - 1].price === 23, "today's point comes from the live snapshot");
  const an = it.body.analytics;
  ok(an.mom30 != null && an.mom30 > 0 && an.slope30 > 0, "analytics: momentum/trend computed over merged series");
  ok(an.signal && typeof an.signal.score === "number" && an.signal.reasons.length > 0, "analytics: signal + itemized reasons served");
  ok(an.rsi14 != null && an.vol30 != null && an.maxDD != null && an.liq30 === 50, "analytics: rsi/vol/drawdown/liquidity populated");

  const bs = await api("/api/skins/bootstrap", { name: KNIFE });
  ok(bs.status === 200 && bs.body.rows === 40, "cookie bootstrap pulls full steam history (fixture)");
  it = await api("/api/skins/item?name=" + encodeURIComponent(KNIFE));
  ok(it.body.imported === true && it.body.daily.length >= 40, "bootstrapped history feeds the series");

  const bad = await api("/api/skins/import", { name: NAME, prices: [["not a date", "x"]] });
  ok(bad.status === 400, "import rejects unparseable rows");

  // portfolio: 3 @ $10, latest 23 → net/unit 20 → netSteam 60, P/L +30 (+100%)
  let pf = await api("/api/skins/lot", { name: NAME, qty: 3, unitCost: 10 });
  const lot = pf.body.lots[0];
  ok(lot.cost === 30 && lot.netSteam === 60 && lot.pl === 30 && lot.plPct === 100, "portfolio P/L net of steam fees");
  ok(pf.body.totals.cost === 30 && pf.body.totals.pl === 30, "portfolio totals fold");
  ok((await api("/api/skins/lot", { name: NAME, qty: -1, unitCost: 5 })).status === 400, "lot validation rejects qty<=0");
  pf = await api("/api/skins/lot", { remove: lot.id });
  ok(pf.body.lots.length === 0, "lot remove");
  await api("/api/skins/lot", { name: NAME, qty: 2, unitCost: 15 });

  const wl = await api("/api/skins/watchlist");
  const row = wl.body.items.find((x) => x.name === NAME);
  ok(row && row.latest === 23 && row.verdict && row.days >= 61, "watchlist summary rows (latest/verdict/days)");

  // restart: everything must come back from disk
  await inst.close();
  inst = startServer({ port: PORT, dataDir: DATA, snapHours: 0, steamCookie: "" });
  await new Promise((r) => inst.server.once("listening", r));
  const h2 = await api("/api/skins/health");
  ok(h2.body.watch === 2 && h2.body.lots === 1 && h2.body.steamCookie === false, "restart: watchlist+portfolio reload from disk");
  it = await api("/api/skins/item?name=" + encodeURIComponent(NAME));
  ok(it.body.daily.length >= 61 && it.body.quote.price === 23, "restart: history + imports intact");
  const bs2 = await api("/api/skins/bootstrap", { name: NAME });
  ok(bs2.status === 400, "bootstrap without STEAM_COOKIE fails with guidance");

  await inst.close();
  M.setTransport(null);
  fs.rmSync(DATA, { recursive: true, force: true });

  console.log("\n" + (fail ? fail + " FAILURE(S)" : "ALL PASS (" + pass + " checks)"));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("PROBE CRASH:", e); process.exit(1); });
