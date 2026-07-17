// party-probe.js — the one-command party launcher actually launches the party.
// Boots server/party.js on a throwaway port and proves the single-origin
// contract both clients rely on: merged discovery health, static game files,
// league API, h2h API, and SSE streaming through the proxy.
//
//   node server/party-probe.js        (exit 0 = all assertions pass)
"use strict";
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const PORT = 8971;
const DATA = path.join(os.tmpdir(), "hh-party-probe-" + Date.now());
let pass = 0, fail = 0;
const check = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: "127.0.0.1", port: PORT, path: p, method, headers: { "Content-Type": "application/json" } }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let parsed; try { parsed = JSON.parse(buf); } catch (_) { parsed = buf; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const party = spawn(process.execPath, [path.join(__dirname, "party.js"), String(PORT)], {
    env: { ...process.env, PARTY_DATA: DATA, PARTY_NO_TUNNEL: "1", HH_LEAGUE_TEST: "1" },
    stdio: "ignore",
  });
  const kill = () => { try { party.kill("SIGKILL"); } catch (_) {} };
  process.on("exit", kill);

  let health = null;
  for (let i = 0; i < 120; i++) {
    try {
      const h = await req("GET", "/api/health");
      if (h.status === 200 && h.body && h.body.h2h && "leagues" in h.body) { health = h.body; break; }
    } catch (_) {}
    await sleep(250);
  }
  check(!!health, "party server boots; merged /api/health serves BOTH discovery contracts");
  if (!health) { kill(); process.exit(1); }
  check(health.party === 1 && health.static === true && health.port === PORT && Array.isArray(health.lanHosts),
    "merged health advertises the FRONT port + LAN hosts (share links point at one origin)");

  const page = await req("GET", "/play.html");
  check(page.status === 200 && /hashmark|play-engine|<html/i.test(String(page.body).slice(0, 4000)),
    "game files served through the front origin");

  const lg = await req("POST", "/api/league", { name: "Party League", adminTeamId: 3, adminName: "Host" });
  check(lg.status === 200 && !!lg.body.leagueId, "league API reachable through the proxy (create works)");

  const m = await req("POST", "/api/match", { homeTeamId: 1, awayTeamId: 2, clockMs: 60000 });
  check(m.status === 200 && !!m.body.matchId, "h2h API reachable through the proxy (create works)");

  // SSE must STREAM through the proxy (headers + first frame, no buffering)
  const sseOk = await new Promise((resolve) => {
    const r = http.get({ host: "127.0.0.1", port: PORT, path: `/api/events/${m.body.matchId}?token=${m.body.token}` }, (res) => {
      if (res.statusCode !== 200 || !/text\/event-stream/.test(res.headers["content-type"] || "")) { r.destroy(); return resolve(false); }
      let buf = "";
      res.on("data", (c) => { buf += c; if (buf.length > 0) { r.destroy(); resolve(true); } });
    });
    r.on("error", () => resolve(false));
    setTimeout(() => { r.destroy(); resolve(false); }, 8000);
  });
  check(sseOk, "h2h SSE streams live through the proxy");

  const lgSse = await new Promise((resolve) => {
    const r = http.get({ host: "127.0.0.1", port: PORT, path: `/api/league/events/${lg.body.leagueId}?token=${lg.body.adminToken}` }, (res) => {
      if (res.statusCode !== 200 || !/text\/event-stream/.test(res.headers["content-type"] || "")) { r.destroy(); return resolve(false); }
      let buf = "";
      res.on("data", (c) => { buf += c; if (buf.length > 0) { r.destroy(); resolve(true); } });
    });
    r.on("error", () => resolve(false));
    setTimeout(() => { r.destroy(); resolve(false); }, 8000);
  });
  check(lgSse, "league SSE streams live through the proxy");

  kill();
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (_) {}
  console.log(fail ? `\n${fail} FAILURE(S)` : "\nALL PASS");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
