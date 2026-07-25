#!/usr/bin/env node
// skins/client-probe.js — Skin Market Lab dashboard, end-to-end in a real
// browser. Hermetic: the tracker server runs IN-PROCESS with a fixture
// transport (no internet), pre-seeded with 120 days of history; Chromium
// then drives the actual UI: watchlist → item view → stat tiles → canvas
// chart actually painted → crosshair tooltip → portfolio lot add → P/L.
// Screenshot written to /tmp/skin_lab.png for visual QA.
//
//   node skins/client-probe.js
"use strict";
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const os = require("os");
const path = require("path");
const fs = require("fs");
const M = require(path.join(__dirname, "market.js"));
const { startServer } = require(path.join(__dirname, "server.js"));

let pass = 0, fail = 0;
const ok = (c, label) => { if (c) { pass++; console.log("  ✓ " + label); } else { fail++; console.log("  ✗ FAIL " + label); } };
const D = 86400000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n) => (n < 10 ? "0" + n : "" + n);
const steamDateStr = (t) => { const d = new Date(t); return MON[d.getUTCMonth()] + " " + p2(d.getUTCDate()) + " " + d.getUTCFullYear() + " " + p2(d.getUTCHours()) + ": +0"; };

M.setTransport(async (url) => {
  if (url.includes("/market/priceoverview/"))
    return { status: 200, body: JSON.stringify({ success: true, lowest_price: "$41.90", volume: "63", median_price: "$43.25" }) };
  if (url.includes("api.skinport.com/v1/items"))
    return { status: 200, body: JSON.stringify([{ market_hash_name: "AK-47 | Redline (Field-Tested)", min_price: 38.2, mean_price: 41, max_price: 90, quantity: 420 }]) };
  if (url.includes("api.skinport.com/v1/sales/history")) {
    const agg = { min: 35, max: 48, avg: 40.1, median: 39.5, volume: 34 };
    return { status: 200, body: JSON.stringify([{ market_hash_name: "AK-47 | Redline (Field-Tested)", last_24_hours: agg, last_7_days: agg, last_30_days: agg, last_90_days: agg }]) };
  }
  return { status: 404, body: "" };
});

(async () => {
  const PORT = 5392;
  const DATA = path.join(os.tmpdir(), "hh-skin-client-probe-" + Date.now());
  const inst = startServer({ port: PORT, dataDir: DATA, snapHours: 0, steamCookie: "" });
  await new Promise((r) => inst.server.once("listening", r));
  const NAME = "AK-47 | Redline (Field-Tested)";
  const api = async (p, body) => (await fetch("http://localhost:" + PORT + p, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined)).json();

  // seed: watch + 120-day wavy uptrend + one live snapshot
  await api("/api/skins/watch", { name: NAME });
  const now = Date.now();
  const paste = Array.from({ length: 120 }, (_, i) =>
    [steamDateStr(now - (120 - i) * D), 30 * Math.exp(0.003 * i) * (1 + 0.05 * Math.sin(i / 6)), "" + (40 + (i % 20))]);
  await api("/api/skins/import", { name: NAME, prices: paste });
  await api("/api/skins/refresh", { name: NAME });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://localhost:" + PORT + "/", { waitUntil: "networkidle" });

  await page.waitForSelector(".wrow", { timeout: 8000 });
  ok(true, "dashboard boots; watchlist row renders");
  ok((await page.textContent(".wrow .px")).includes("$43.25"), "watch row shows the live snapshot price");

  await page.waitForSelector("#chart");
  const painted = await page.evaluate(() => {
    const cv = document.getElementById("chart");
    const ctx = cv.getContext("2d");
    const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let lit = 0;
    for (let i = 3; i < img.length; i += 40) if (img[i] > 0) lit++;
    return lit;
  });
  ok(painted > 500, "canvas chart actually painted (" + painted + " sampled px)");

  const tiles = await page.$$eval(".tile .lb", (els) => els.map((e) => e.textContent));
  ok(tiles.some((t) => /30D/.test(t)) && tiles.some((t) => /RSI/.test(t)) && tiles.some((t) => /VOLATILITY/.test(t)),
    "stat tiles present (momentum / RSI / volatility)");
  const badge = await page.textContent(".sigBadge");
  ok(/BUY|HOLD|SELL/.test(badge), "signal verdict badge renders (" + badge.trim().split("\n").pop() + ")");
  ok((await page.$$eval(".sigReasons li", (els) => els.length)) > 0, "signal reasons itemized in UI");
  ok((await page.textContent("#itemView")).includes("Skinport"), "cross-market compare visible");

  // crosshair tooltip
  const box = await (await page.$("#chart")).boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + 100);
  await page.waitForSelector("#tooltip", { state: "visible", timeout: 4000 });
  const tip = await page.textContent("#tooltip");
  ok(/Steam/.test(tip) && /\$\d/.test(tip), "crosshair tooltip shows dated price row");
  ok(/SMA 7/.test(tip), "tooltip includes SMA overlay values");

  // range switch redraws
  await page.click(".ranges .btn[data-r='ALL']");
  await page.waitForTimeout(200);
  ok(await page.$eval(".ranges .btn[data-r='ALL']", (b) => b.classList.contains("on")), "range switch (ALL) takes");

  // portfolio flow through the real form
  await page.fill("#lotQty", "2");
  await page.fill("#lotCost", "30");
  await page.click("#lotForm button[type=submit]");
  await page.waitForSelector("table.pf td", { timeout: 4000 });
  const pfTxt = await page.textContent("#pfTotals");
  ok(/COST BASIS/.test(pfTxt) && /\$60\.00/.test(pfTxt), "portfolio cost basis folds ($60.00)");
  ok(/P\/L AFTER FEES/.test(pfTxt), "P/L tile present (fee-adjusted)");

  // data table view (accessibility fallback)
  ok((await page.$$eval("details.dataTable table.dt tr", (els) => els.length)) > 10, "data table view present under the chart");

  ok(errors.length === 0, "zero uncaught page errors" + (errors.length ? " — " + errors[0] : ""));

  await page.screenshot({ path: "/tmp/skin_lab.png", fullPage: true });
  console.log("  📸 /tmp/skin_lab.png");

  // ── static-host mode (the GitHub Pages scenario) ─────────────────────────
  // The dashboard is served by a bare file server with NO api; it must
  // DISCOVER the tracker cross-origin (saved address → CORS) and, with no
  // tracker anywhere, render the setup panel instead of a broken page.
  const http = require("http");
  const MIME2 = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
  const stat = http.createServer((req, res) => {
    const f = path.join(__dirname, req.url === "/" ? "index.html" : path.normalize(req.url).replace(/^([.][.][/\\])+/, ""));
    fs.readFile(f, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": MIME2[path.extname(f)] || "application/octet-stream" });
      res.end(buf);
    });
  }).listen(5393);
  const ctxB = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctxB.addInitScript(() => localStorage.setItem("skinlab_api", "http://localhost:" + 5392));
  const pageB = await ctxB.newPage();
  await pageB.goto("http://localhost:5393/", { waitUntil: "networkidle" });
  await pageB.waitForSelector(".wrow", { timeout: 8000 });
  ok(true, "static-host page discovers the tracker cross-origin (saved address + CORS)");
  ok((await pageB.textContent("#netStatus")).includes("5392"), "netStatus names the discovered tracker");
  await ctxB.close();

  // no tracker anywhere → setup panel (needs 8790 free to be deterministic:
  // occupy it with a dummy that fails health, skip if a real tracker owns it)
  let dummy = null;
  const free8790 = await new Promise((r) => {
    dummy = http.createServer((q, s) => { s.writeHead(404); s.end(); });
    dummy.once("error", () => r(false));
    dummy.listen(8790, () => r(true));
  });
  if (free8790) {
    const ctxC = await browser.newContext();
    const pageC = await ctxC.newPage();
    await pageC.goto("http://localhost:5393/", { waitUntil: "networkidle" });
    await pageC.waitForSelector("#retryBtn", { timeout: 10000 });
    ok((await pageC.textContent("#itemView")).includes("npm run skins"), "no tracker → setup panel with run instructions");
    await ctxC.close();
    dummy.close();
  } else { console.log("  ~ setup-panel check skipped (a real tracker owns :8790)"); }
  stat.close();

  await browser.close();
  await inst.close();
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log("\n" + (fail ? fail + " FAILURE(S)" : "ALL PASS (" + pass + " checks)"));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("PROBE CRASH:", e); process.exit(1); });
