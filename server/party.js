// party.js — ONE-COMMAND multiplayer test night.
//
//   node server/party.js            # or: npm run party      (default port 8790)
//   node server/party.js 9000       # custom front port
//
// Boots the H2H match server AND the league dynasty server as children, then
// fronts BOTH plus the game files behind a SINGLE origin:
//
//   /api/league/**  → league server (127.0.0.1:<front+2>)
//   /api/health     → MERGED health (h2h + league + this box's LAN hosts), so
//                     the h2h client (checks .h2h) and the league client
//                     (checks "leagues") both auto-discover the SAME origin —
//                     nobody types a server address, ever.
//   everything else → h2h server (127.0.0.1:<front+1>, static game files on)
//
// One origin means every share link (league invites, h2h fixtures) carries
// the same base, LAN links work from the merged health's lanHosts, and if
// `cloudflared` is installed a free quick tunnel gives you an HTTPS URL for
// REMOTE friends — which also keeps crypto.subtle (the per-call signature
// layer) available, since signatures need a secure context. No account, no
// config: the tunnel URL prints on boot. Opt out with PARTY_NO_TUNNEL=1.
//
// Zero npm dependencies, like every server in this repo. SSE streams pipe
// straight through the proxy. Data persists in server/data-party/ so you can
// Ctrl-C and relaunch without losing leagues or matches (determinism is the
// recovery mechanism underneath anyway).
"use strict";
const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const FRONT = Number(process.argv[2] || process.env.PARTY_PORT || 8790);
const H2H_PORT = FRONT + 1;
const LEAGUE_PORT = FRONT + 2;
const DATA_ROOT = process.env.PARTY_DATA || path.join(__dirname, "data-party");

const children = [];
function boot(name, file, port, env) {
  const c = spawn(process.execPath, [path.join(__dirname, file), String(port)], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  c.on("exit", (code) => {
    console.error(`[party] ${name} exited (${code}) — shutting down`);
    shutdown(1);
  });
  children.push(c);
  return c;
}
function shutdown(code) {
  for (const c of children) { try { c.kill("SIGKILL"); } catch (_) {} }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

fs.mkdirSync(DATA_ROOT, { recursive: true });
boot("h2h", "h2h-server.js", H2H_PORT, {
  H2H_STATIC: "1", H2H_DATA: path.join(DATA_ROOT, "h2h"),
});
boot("league", "league-server.js", LEAGUE_PORT, {
  HH_LEAGUE_DATA: path.join(DATA_ROOT, "league"),
});

function lanHosts() {
  const out = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === "IPv4" && !i.internal) out.push(i.address);
    }
  }
  return out;
}

// tiny JSON GET against an upstream (health merge)
function upstreamJson(port, p) {
  return new Promise((resolve) => {
    const r = http.get({ host: "127.0.0.1", port, path: p, timeout: 1500 }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => { try { resolve(JSON.parse(buf)); } catch (_) { resolve(null); } });
    });
    r.on("error", () => resolve(null));
    r.on("timeout", () => { r.destroy(); resolve(null); });
  });
}

// streaming pass-through proxy — piping both directions keeps SSE live
function proxy(req, res, port) {
  const up = http.request({
    host: "127.0.0.1", port,
    path: req.url, method: req.method, headers: { ...req.headers, host: "127.0.0.1:" + port },
  }, (ur) => {
    res.writeHead(ur.statusCode, ur.headers);
    ur.pipe(res);
  });
  up.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "upstream unavailable — still booting?" }));
  });
  req.pipe(up);
}

const front = http.createServer(async (req, res) => {
  const p = (req.url || "/").split("?")[0];
  if (p === "/api/health") {
    // MERGED health: both clients' discovery contracts on one origin, with
    // port/lanHosts rewritten to the FRONT so LAN share links point here.
    const [h2h, lg] = await Promise.all([
      upstreamJson(H2H_PORT, "/api/health"),
      upstreamJson(LEAGUE_PORT, "/api/health"),
    ]);
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify({
      ok: true, party: 1,
      ...(h2h ? { h2h: 1 } : {}),
      ...(lg ? { leagues: lg.leagues } : {}),
      static: true, port: FRONT, lanHosts: lanHosts(),
    }));
  }
  if (p.startsWith("/api/league")) return proxy(req, res, LEAGUE_PORT);
  return proxy(req, res, H2H_PORT);   // h2h API + the game's static files
});

// optional HTTPS quick tunnel for remote friends (cloudflared, no account).
// Secure context matters beyond convenience: crypto.subtle (the per-call
// signature layer) only exists on https/localhost, so a tunnel keeps remote
// seats SIGNING instead of degrading to legacy-unsigned.
function startTunnel() {
  if (process.env.PARTY_NO_TUNNEL) return;
  const probe = spawnSync("cloudflared", ["--version"], { stdio: "ignore" });
  if (probe.error) {
    console.log("[party] no `cloudflared` found — LAN/localhost only.");
    console.log("[party]   for a shareable HTTPS link: install cloudflared, then relaunch");
    console.log("[party]   (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)");
    return;
  }
  const t = spawn("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${FRONT}`], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(t);
  let announced = false;
  const scan = (chunk) => {
    if (announced) return;
    const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) {
      announced = true;
      console.log("");
      console.log("  🌍 REMOTE FRIENDS (HTTPS — share this):");
      console.log(`     ${m[0]}/play.html`);
      console.log("");
    }
  };
  t.stdout.on("data", scan);
  t.stderr.on("data", scan);
  t.on("exit", () => { if (!announced) console.log("[party] tunnel exited — LAN/localhost links still work"); });
}

async function waitUpstreams() {
  for (let i = 0; i < 80; i++) {
    const [a, b] = await Promise.all([
      upstreamJson(H2H_PORT, "/api/health"),
      upstreamJson(LEAGUE_PORT, "/api/health"),
    ]);
    if (a && b) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

front.listen(FRONT, async () => {
  const up = await waitUpstreams();
  if (!up) { console.error("[party] servers failed to boot"); shutdown(1); return; }
  console.log("");
  console.log("  🏈 HASHMARK PARTY SERVER — everything on one origin");
  console.log("  ───────────────────────────────────────────────────");
  console.log(`  you:          http://localhost:${FRONT}/play.html`);
  for (const h of lanHosts()) {
    console.log(`  same wi-fi:   http://${h}:${FRONT}/play.html`);
  }
  console.log("");
  console.log("  · ONLINE LEAGUE card → create → share the invite link");
  console.log("  · 🎮 Play a friend → share the match link");
  console.log("  · everything auto-discovers this origin — no server fields");
  console.log(`  · data persists in ${path.relative(process.cwd(), DATA_ROOT)}/ (Ctrl-C safe)`);
  startTunnel();
});
