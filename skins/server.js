// ─── skins/server.js — CS skin market tracker (server + dashboard host) ────
// Plain Node, zero dependencies — same discipline as h2h-server.js.
//
// What it is: a personal market-research tracker for Counter-Strike skins.
// It records price snapshots for a watchlist over time (JSONL on disk, so
// history ACCRUES the longer it runs), optionally bootstraps full multi-year
// history from Steam (login cookie) or a pasted pricehistory blob, and serves
// a dashboard (index.html) with charts, indicators, and portfolio P/L.
//
// Run:    node skins/server.js [port]   (or: npm run skins — default port 8790)
//         STEAM_COOKIE="steamLoginSecure=..."        unlocks full-history bootstrap
//         SKIN_DATA=/path                            data dir (default skins/data)
//         SKIN_SNAP_HOURS=6                          auto-snapshot cadence (0 = off)
// Test:   node skins/probe.js                       (hermetic — fixture transport)
//
// API (all JSON, USD):
//   GET  /api/skins/health
//   GET  /api/skins/search?q=redline      universe = cached Skinport dump ∪ seed list
//   GET  /api/skins/watchlist             names + latest quote + signal verdict
//   POST /api/skins/watch                 {name, remove?}
//   GET  /api/skins/item?name=            daily series + analytics + cross-market compare
//   POST /api/skins/refresh               {name?} snapshot now (omit name = whole watchlist)
//   POST /api/skins/bootstrap             {name} full Steam history via STEAM_COOKIE
//   POST /api/skins/import                {name, prices:[[dateStr,price,vol],...]} paste-in
//   GET  /api/skins/portfolio             lots valued at latest, net of sell fees
//   POST /api/skins/lot                   {name, qty, unitCost, note?} | {remove:id}
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const A = require("./analytics.js");
const M = require("./market.js");

const ROOT = __dirname; // static root = the skins/ dir itself — fully self-contained
const SNAP_DEDUPE_MS = 30 * 60 * 1000;      // skip snapshots <30min apart per source
const SALES_TTL_MS = 6 * 3600 * 1000;       // skinport per-item aggregates cache
const DUMP_TTL_MS = 12 * 3600 * 1000;       // skinport full-dump cache

function slug(name) {
  const h = crypto.createHash("sha1").update(name).digest("hex").slice(0, 8);
  return name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) + "-" + h;
}
function readJson(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function writeJson(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); }

function startServer(opts) {
  opts = opts || {};
  const PORT = opts.port != null ? opts.port : Number(process.argv[2] || process.env.SKIN_PORT || 8790);
  const DATA = opts.dataDir || process.env.SKIN_DATA || path.join(__dirname, "data");
  const COOKIE = opts.steamCookie != null ? opts.steamCookie : (process.env.STEAM_COOKIE || "");
  const SNAP_HOURS = opts.snapHours != null ? opts.snapHours
    : (process.env.SKIN_SNAP_HOURS != null ? Number(process.env.SKIN_SNAP_HOURS) : 6);
  fs.mkdirSync(path.join(DATA, "history"), { recursive: true });
  fs.mkdirSync(path.join(DATA, "import"), { recursive: true });
  fs.mkdirSync(path.join(DATA, "cache"), { recursive: true });

  // ── state (loaded fresh per instance — probe restarts must re-read disk) ──
  const wlFile = path.join(DATA, "watchlist.json");
  const pfFile = path.join(DATA, "portfolio.json");
  let watchlist = readJson(wlFile, null) || [];
  let portfolio = readJson(pfFile, null) || [];
  const histCache = new Map(); // slug → parsed snapshot lines

  const seed = readJson(path.join(__dirname, "seed.json"), { items: [] }).items;

  function histFile(name) { return path.join(DATA, "history", slug(name) + ".jsonl"); }
  function importFile(name) { return path.join(DATA, "import", slug(name) + ".json"); }

  function snaps(name) {
    const key = slug(name);
    if (!histCache.has(key)) {
      const lines = [];
      try {
        for (const ln of fs.readFileSync(histFile(name), "utf8").split("\n")) {
          if (!ln.trim()) continue;
          try { lines.push(JSON.parse(ln)); } catch { /* torn line — skip, keep the rest */ }
        }
      } catch { /* no file yet */ }
      histCache.set(key, lines);
    }
    return histCache.get(key);
  }
  function appendSnap(name, snap) {
    const list = snaps(name);
    const last = [...list].reverse().find((s) => s.src === snap.src);
    if (last && snap.t - last.t < SNAP_DEDUPE_MS) return false;
    list.push(snap);
    fs.mkdirSync(path.dirname(histFile(name)), { recursive: true });
    fs.appendFileSync(histFile(name), JSON.stringify(snap) + "\n");
    return true;
  }

  // ── series assembly ──────────────────────────────────────────────────────
  function dailyFor(name) {
    const imported = readJson(importFile(name), null);
    const importDaily = A.toDaily((imported && imported.rows) || [], { volMode: "sum" });
    const steamSnaps = snaps(name).filter((s) => s.src === "steam");
    const snapDaily = A.toDaily(steamSnaps, { volMode: "max" });
    return A.mergeDaily(importDaily, snapDaily); // import wins on collisions (richer)
  }
  function skinportDaily(name) {
    return A.toDaily(snaps(name).filter((s) => s.src === "skinport"), { volMode: "max" });
  }
  function latestSteam(name) {
    const s = snaps(name).filter((x) => x.src === "steam");
    return s.length ? s[s.length - 1] : null;
  }

  // ── skinport caches ──────────────────────────────────────────────────────
  const dumpFile = path.join(DATA, "cache", "skinport-items.json");
  function dumpCached() { return readJson(dumpFile, null); }
  async function refreshDumpIfStale() {
    const c = dumpCached();
    if (c && Date.now() - c.t < DUMP_TTL_MS) return c;
    try {
      const items = await M.skinportItems();
      const rec = { t: Date.now(), items };
      writeJson(dumpFile, rec);
      return rec;
    } catch (e) { return c; } // keep stale on failure
  }
  function salesFile(name) { return path.join(DATA, "cache", "skinport-sales-" + slug(name) + ".json"); }
  async function salesFor(name, allowFetch) {
    const c = readJson(salesFile(name), null);
    if (c && Date.now() - c.t < SALES_TTL_MS) return c.data;
    if (!allowFetch) return c ? c.data : null;
    try {
      const data = await M.skinportSalesHistory(name);
      writeJson(salesFile(name), { t: Date.now(), data });
      return data;
    } catch (e) { return c ? c.data : null; }
  }

  // ── snapshotting ─────────────────────────────────────────────────────────
  async function snapshotOne(name) {
    const out = { name, ok: false };
    try {
      const po = await M.steamPriceOverview(name, A);
      if (po) {
        out.appended = appendSnap(name, { t: po.t, src: "steam", price: po.price, lowest: po.lowest, vol: po.vol });
        out.steam = po; out.ok = true;
      } else out.error = "steam: item not found";
    } catch (e) { out.error = String(e.message || e); }
    try {
      const sales = await salesFor(name, true);
      if (sales && sales.last24h && sales.last24h.median != null) {
        appendSnap(name, { t: Date.now(), src: "skinport", price: sales.last24h.median, vol: sales.last24h.volume });
      }
      out.skinport = sales || null;
    } catch (e) { /* skinport optional */ }
    return out;
  }
  async function snapshotAll() {
    const results = [];
    for (const name of watchlist) results.push(await snapshotOne(name));
    return results;
  }

  let snapTimer = null;
  if (SNAP_HOURS > 0) {
    snapTimer = setInterval(() => {
      const newest = Math.max(0, ...watchlist.map((n) => { const l = latestSteam(n); return l ? l.t : 0; }));
      if (Date.now() - newest >= SNAP_HOURS * 3600 * 1000) snapshotAll().catch(() => {});
    }, 15 * 60 * 1000);
    snapTimer.unref();
  }

  // ── item report ──────────────────────────────────────────────────────────
  async function itemReport(name, allowFetch) {
    const daily = dailyFor(name);
    const analytics = A.analyze(daily);
    const last = latestSteam(name);
    const sales = await salesFor(name, false);
    const dump = dumpCached();
    const dumpRow = dump ? (dump.items || []).find((i) => i.name === name) : null;
    const steamGross = last ? last.price : analytics.latest;
    const spMedian = sales && sales.last24h && sales.last24h.median != null ? sales.last24h.median
      : sales && sales.last7d ? sales.last7d.median : null;
    return {
      name,
      daily,
      skinportDaily: skinportDaily(name),
      analytics,
      snapshots: snaps(name).length,
      imported: !!readJson(importFile(name), null),
      watched: watchlist.includes(name),
      quote: last ? { t: last.t, price: last.price, lowest: last.lowest, vol: last.vol } : null,
      skinport: { sales: sales || null, ask: dumpRow ? dumpRow.min : null, qty: dumpRow ? dumpRow.qty : null },
      compare: {
        steam: { gross: steamGross, net: A.netProceeds(steamGross, "steam"), cash: false },
        skinport: { gross: spMedian, net: A.netProceeds(spMedian, "skinport"), cash: true },
      },
    };
  }

  function watchSummary() {
    return watchlist.map((name) => {
      const daily = dailyFor(name);
      const an = A.analyze(daily);
      const last = latestSteam(name);
      return {
        name,
        latest: last ? last.price : an.latest,
        vol24h: last ? last.vol : null,
        t: last ? last.t : null,
        days: an.days,
        mom7: an.mom7, mom30: an.mom30,
        verdict: an.signal.verdict, score: an.signal.score,
      };
    });
  }

  function portfolioReport() {
    const lots = portfolio.map((lot) => {
      const last = latestSteam(lot.name);
      const daily = dailyFor(lot.name);
      const latest = last ? last.price : (daily.length ? daily[daily.length - 1].price : null);
      const cost = A.round2(lot.qty * lot.unitCost);
      const gross = latest != null ? A.round2(lot.qty * latest) : null;
      const netSteam = latest != null ? A.round2(lot.qty * A.netProceeds(latest, "steam")) : null;
      const netSkinport = latest != null ? A.round2(lot.qty * A.netProceeds(latest, "skinport")) : null;
      return Object.assign({}, lot, {
        latest, cost, gross, netSteam, netSkinport,
        pl: netSteam != null ? A.round2(netSteam - cost) : null,
        plPct: netSteam != null && cost > 0 ? A.round2((netSteam - cost) / cost * 100) : null,
      });
    });
    const sum = (k) => A.round2(lots.reduce((a, l) => a + (l[k] || 0), 0));
    return { lots, totals: { cost: sum("cost"), gross: sum("gross"), netSteam: sum("netSteam"), netSkinport: sum("netSkinport"), pl: sum("pl") } };
  }

  // ── search ───────────────────────────────────────────────────────────────
  function search(q) {
    q = String(q || "").trim().toLowerCase();
    const dump = dumpCached();
    const uni = new Map();
    for (const s of seed) uni.set(s.name, { name: s.name, cat: s.cat, price: null, qty: null });
    if (dump) for (const i of dump.items || []) {
      const prev = uni.get(i.name);
      uni.set(i.name, { name: i.name, cat: prev ? prev.cat : null, price: i.min, qty: i.qty });
    }
    const toks = q.split(/\s+/).filter(Boolean);
    const scored = [];
    for (const it of uni.values()) {
      const lo = it.name.toLowerCase();
      if (toks.length && !toks.every((t) => lo.includes(t))) continue;
      let sc = 0;
      if (toks.length && lo.startsWith(toks[0])) sc += 100;
      sc += Math.min(50, (it.qty || 0) / 20);
      if (watchlist.includes(it.name)) sc += 5;
      scored.push([sc, it]);
    }
    scored.sort((a, b) => b[0] - a[0] || (a[1].name < b[1].name ? -1 : 1));
    return scored.slice(0, 25).map(([, it]) => Object.assign({ watched: watchlist.includes(it.name) }, it));
  }

  // ── http plumbing ────────────────────────────────────────────────────────
  function sendJson(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    res.end(body);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > 4 * 1024 * 1024) { reject(new Error("body too large")); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => {
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
        catch (e) { reject(new Error("bad json")); }
      });
      req.on("error", reject);
    });
  }
  const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2" };
  function serveStatic(req, res, pathname) {
    if (pathname === "/") pathname = "/index.html";
    if (pathname.startsWith("/data/")) { res.writeHead(403); res.end(); return; } // never serve the data dir
    const fp = path.join(ROOT, path.normalize(pathname).replace(/^([.][.][/\\])+/, ""));
    if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fp, (err, buf) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
      res.end(buf);
    });
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const p = u.pathname;
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST", "Access-Control-Allow-Headers": "Content-Type" });
        return res.end();
      }
      if (p === "/api/skins/health") {
        return sendJson(res, 200, { ok: 1, watch: watchlist.length, lots: portfolio.length, port: PORT, steamCookie: !!COOKIE, snapHours: SNAP_HOURS, dumpCached: !!dumpCached() });
      }
      if (p === "/api/skins/search") return sendJson(res, 200, { results: search(u.searchParams.get("q")) });
      if (p === "/api/skins/watchlist") return sendJson(res, 200, { items: watchSummary() });
      if (p === "/api/skins/item") {
        const name = u.searchParams.get("name");
        if (!name) return sendJson(res, 400, { error: "name required" });
        return sendJson(res, 200, await itemReport(name));
      }
      if (p === "/api/skins/portfolio") return sendJson(res, 200, portfolioReport());

      if (req.method !== "POST") { serveStatic(req, res, p); return; }
      const body = await readBody(req);

      if (p === "/api/skins/watch") {
        const name = String(body.name || "").slice(0, 200);
        if (!name) return sendJson(res, 400, { error: "name required" });
        if (body.remove) watchlist = watchlist.filter((n) => n !== name);
        else if (!watchlist.includes(name)) {
          if (watchlist.length >= 200) return sendJson(res, 400, { error: "watchlist cap (200)" });
          watchlist.push(name);
        }
        writeJson(wlFile, watchlist);
        return sendJson(res, 200, { ok: 1, watchlist });
      }
      if (p === "/api/skins/refresh") {
        refreshDumpIfStale().catch(() => {});
        const name = body.name ? String(body.name) : null;
        if (name) return sendJson(res, 200, { results: [await snapshotOne(name)] });
        return sendJson(res, 200, { results: await snapshotAll() });
      }
      if (p === "/api/skins/bootstrap") {
        const name = String(body.name || "");
        if (!name) return sendJson(res, 400, { error: "name required" });
        if (!COOKIE) return sendJson(res, 400, { error: "no STEAM_COOKIE configured — use Import (paste) instead" });
        try {
          const rows = await M.steamPriceHistory(name, COOKIE);
          if (!rows || !rows.length) return sendJson(res, 502, { error: "steam returned no history (cookie valid?)" });
          writeJson(importFile(name), { t: Date.now(), source: "steam-cookie", rows });
          histCache.delete(slug(name));
          return sendJson(res, 200, { ok: 1, rows: rows.length, daily: dailyFor(name).length });
        } catch (e) { return sendJson(res, 502, { error: String(e.message || e) }); }
      }
      if (p === "/api/skins/import") {
        const name = String(body.name || "");
        if (!name) return sendJson(res, 400, { error: "name required" });
        const rows = M.normalizeHistoryRows(body.prices);
        if (!rows.length) return sendJson(res, 400, { error: "no parseable rows — expected [[\"Dec 06 2013 01: +0\", 4.29, \"117\"], ...]" });
        writeJson(importFile(name), { t: Date.now(), source: "paste", rows });
        return sendJson(res, 200, { ok: 1, rows: rows.length, daily: dailyFor(name).length });
      }
      if (p === "/api/skins/lot") {
        if (body.remove) {
          portfolio = portfolio.filter((l) => l.id !== body.remove);
        } else {
          const name = String(body.name || "").slice(0, 200);
          const qty = Number(body.qty), unitCost = Number(body.unitCost);
          if (!name || !isFinite(qty) || qty <= 0 || !isFinite(unitCost) || unitCost < 0)
            return sendJson(res, 400, { error: "need name, qty>0, unitCost>=0" });
          if (portfolio.length >= 500) return sendJson(res, 400, { error: "portfolio cap (500)" });
          portfolio.push({ id: crypto.randomBytes(6).toString("hex"), name, qty, unitCost, note: String(body.note || "").slice(0, 200), addedAt: Date.now() });
        }
        writeJson(pfFile, portfolio);
        return sendJson(res, 200, portfolioReport());
      }
      return sendJson(res, 404, { error: "unknown endpoint" });
    } catch (e) {
      return sendJson(res, 500, { error: String((e && e.message) || e) });
    }
  });

  server.listen(PORT);
  return {
    server,
    port: PORT,
    dataDir: DATA,
    close() { if (snapTimer) clearInterval(snapTimer); return new Promise((r) => server.close(r)); },
  };
}

if (require.main === module) {
  const inst = startServer();
  console.log("[skins] tracker on http://localhost:" + inst.port + "  (data: " + inst.dataDir + ")");
  console.log("[skins] STEAM_COOKIE " + (process.env.STEAM_COOKIE ? "set — full-history bootstrap enabled" : "not set — use paste-import for history"));
}

module.exports = { startServer, slug };
