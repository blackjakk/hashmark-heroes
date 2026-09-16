#!/usr/bin/env node
"use strict";
// _analytics_probe.js — behavior test for the LaunchFury Analytics integration.
//
// Drives the real analytics-init.js wiring against the real vendored
// @launchfury/analytics build with a stubbed browser environment, asserting:
//   - inert (no key, no network) until a browser write key is supplied
//   - init once with the canonical ingest host https://launchfury.com
//   - the browser key rides the Authorization header + write_key body field
//   - pageview autocapture + meaningful product events reach the ingest call
//   - opt-out suppresses capture; reset() is safe
//
// Usage: node tools/_analytics_probe.js   (exit 0 = pass, 1 = fail)

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "analytics-init.js");
const VENDOR = path.join(ROOT, "vendor", "launchfury-analytics.js");
const HOST = "https://launchfury.com";
const INGEST = HOST + "/api/analytics/e";

let requests = [];

function freshModule() {
  delete require.cache[require.resolve(SRC)];
  return require(SRC);
}

function stubBrowser(writeKey) {
  requests = [];
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  global.window = {
    location: { pathname: "/play.html", hostname: "example.test", search: "" },
    localStorage,
    addEventListener() {},
    removeEventListener() {},
  };
  if (writeKey) global.window.LF_ANALYTICS_WRITE_KEY = writeKey;
  global.document = {
    referrer: "",
    readyState: "complete",
    documentElement: { dataset: { surface: "game" } },
    addEventListener() {},
    querySelector() { return null; },
  };
  global.fetch = async (url, opts) => {
    let body = null;
    try { body = JSON.parse(opts.body); } catch (_e) {}
    requests.push({ url: String(url), headers: opts.headers, body });
    return {
      ok: true,
      status: 200,
      clone() { return this; },
      json: async () => ({}),
    };
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sentEvents() {
  const out = [];
  for (const r of requests) {
    if (r.body && Array.isArray(r.body.batch)) {
      for (const e of r.body.batch) out.push(e.event);
    }
  }
  return out;
}

(async function main() {
  let checks = 0;
  const sdkUrl = "data:text/javascript;base64," +
    Buffer.from(fs.readFileSync(VENDOR, "utf8")).toString("base64");

  // 1 — inert without a key: no fabricated key, no network.
  stubBrowser("");
  let mod = freshModule();
  const noKey = await mod.initLaunchFuryAnalytics({ sdkUrl });
  assert.strictEqual(noKey, null, "must not initialize without a write key");
  assert.strictEqual(requests.length, 0, "must not send without a write key");
  checks += 2;

  // 2 — initializes with the canonical host + browser key, auto-captures.
  mod = freshModule();
  stubBrowser("lf_write_test_browser_key");
  const sdk = await mod.bootLaunchFuryAnalytics({ sdkUrl, maxBatchSize: 1 });
  assert.ok(sdk, "initializes when a write key is supplied");
  assert.strictEqual(global.window.HHAnalytics.ready, true, "exposes the ready event API");
  await wait(60);
  assert.ok(requests.length > 0, "sends events after init");
  assert.strictEqual(requests[0].url, INGEST, "posts to the canonical ingest host");
  assert.strictEqual(requests[0].body.write_key, "lf_write_test_browser_key", "sends the browser write key");
  assert.strictEqual(requests[0].headers.Authorization, "Bearer lf_write_test_browser_key", "authorizes with the write key");
  assert.ok(sentEvents().includes("app_loaded"), "captures app_loaded on boot");
  checks += 6;

  // 3 — init is idempotent.
  const again = await mod.initLaunchFuryAnalytics({ sdkUrl, writeKey: "lf_write_other" });
  assert.strictEqual(again, sdk, "init runs exactly once");
  checks += 1;

  // 4 — meaningful product events forward to the SDK.
  global.window.HHAnalytics.capture("franchise_started", { teamId: 7, season: 1 });
  global.window.HHAnalytics.capture("game_simmed", { week: 1, season: 1 });
  await wait(60);
  const evs = sentEvents();
  assert.ok(evs.includes("franchise_started"), "captures franchise_started");
  assert.ok(evs.includes("game_simmed"), "captures game_simmed");
  checks += 2;

  // 5 — opt-out suppresses capture; hasOptedOut reflects it.
  global.window.HHAnalytics.optOut();
  assert.strictEqual(global.window.HHAnalytics.hasOptedOut(), true, "opt-out is recorded");
  const before = requests.length;
  global.window.HHAnalytics.capture("should_not_send", {});
  await wait(60);
  assert.strictEqual(requests.length, before, "opt-out suppresses further capture");
  checks += 2;

  // 6 — reset() is safe (anonymous product: no identity token to clear).
  global.window.HHAnalytics.reset();
  checks += 1;

  console.log("analytics probe: " + checks + " checks passed");
  process.exit(0);
})().catch((err) => {
  console.error("analytics probe: FAIL — " + (err && err.message ? err.message : err));
  process.exit(1);
});
