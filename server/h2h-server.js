// ─── H2H authoritative match server (Workstream C.3, v1 scaffold) ──────────
// Plain Node, zero dependencies. HTTP + Server-Sent Events; no chain.
// See INGAME_CLOCK_AND_MULTIPLAYER.md §C.3 for the design record.
//
// Authority model: the server holds (seed, roster snapshots, input tape) per
// match and re-sims deterministically on every call — the interactive
// runner's tape mechanics, server-side. Clients only ever submit intent
// (their playcalls); outcomes, deadlines, and the play stream come back.
// Hidden information holds because calls are never broadcast: each side sees
// only its own decision prompts and the resolved plays.
//
// Run:    node server/h2h-server.js [port]     (default 8787)
// Test:   node server/h2h-probe.js             (two scripted clients, full match)
//
// API (all JSON; auth = per-side token issued at create/join):
//   POST /api/match  {homeTeamId, awayTeamId, clockMs?, defense?}
//        → { matchId, side:"home", token, joinCode }
//   POST /api/join   {matchId, joinCode}
//        → { side:"away", token }
//   GET  /api/events/:matchId?token=T&since=N      SSE stream, event ids = seq
//        events: hello | decision | waiting | plays | final | ping
//   POST /api/call   {matchId, token, seq, call}   answer the pending decision
//        ("call" may be null/"auto" = defer to the AI, same as the [O] key)
//   GET  /api/state/:matchId?token=T               reconnect snapshot
//   GET  /api/artifact/:matchId?token=T            {seed,teams,rosters,tape,result,hash}
//        (the deterministic match artifact — the future settlement object)
"use strict";
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./engine-host.js");

const PORT = Number(process.argv[2] || process.env.H2H_PORT || 8787);
const DATA_DIR = process.env.H2H_DATA || path.join(__dirname, "data");
const DEFAULT_CLOCK_MS = 20000;

const eng = loadEngine();
const matches = new Map();   // matchId → match

// ── helpers ────────────────────────────────────────────────────────────────
const rid = (n = 12) => crypto.randomBytes(n).toString("hex");
const clone = (o) => JSON.parse(JSON.stringify(o));
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const otherSide = (s) => (s === "home" ? "away" : "home");

function artifactOf(m) {
  return { v: 1, seed: m.seed, homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId,
           settings: m.settings, rosters: m.rosters, tape: m.tape };
}
function artifactHash(m) { return sha256(JSON.stringify(artifactOf(m))); }

// ── persistence: append-only JSONL per match ───────────────────────────────
// Header (seed/teams/rosters/settings/tokens) + one line per tape entry +
// footer (result + artifact hash). On boot, every unfinished match is
// reloaded and re-simmed back to its pending state — determinism IS the
// recovery mechanism.
function matchFile(id) { return path.join(DATA_DIR, id + ".jsonl"); }
function persistHeader(m) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(matchFile(m.id), JSON.stringify({
    t: "header", v: 1, id: m.id, seed: m.seed,
    homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId,
    settings: m.settings, tokens: m.tokens, joinCode: m.joinCode,
    joined: m.joined, rosters: m.rosters, created: Date.now(),
  }) + "\n");
}
function persistCall(m, entry) {
  fs.appendFileSync(matchFile(m.id), JSON.stringify({ t: "call", ...entry }) + "\n");
}
function persistJoin(m) {
  fs.appendFileSync(matchFile(m.id), JSON.stringify({ t: "join" }) + "\n");
}
function persistFinal(m) {
  fs.appendFileSync(matchFile(m.id), JSON.stringify({
    t: "final", result: m.result, hash: artifactHash(m), finished: Date.now(),
  }) + "\n");
}
function loadPersisted() {
  if (!fs.existsSync(DATA_DIR)) return;
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (!f.endsWith(".jsonl")) continue;
    try {
      const lines = fs.readFileSync(path.join(DATA_DIR, f), "utf8").trim().split("\n").map(l => JSON.parse(l));
      const h = lines.find(l => l.t === "header");
      if (!h) continue;
      const m = newMatchShell(h);
      for (const l of lines) {
        if (l.t === "call") m.tape.push(l.call);
        if (l.t === "join") m.joined = true;
        if (l.t === "final") { m.status = "final"; m.result = l.result; }
      }
      matches.set(m.id, m);
      if (m.status !== "final" && m.joined) step(m);   // re-sim back to the pending state
    } catch (e) { console.error("[h2h] failed to reload " + f + ":", e.message); }
  }
}

// ── match construction ─────────────────────────────────────────────────────
function newMatchShell(h) {
  return {
    id: h.id, seed: h.seed,
    homeTeamId: h.homeTeamId, awayTeamId: h.awayTeamId,
    settings: h.settings, tokens: h.tokens, joinCode: h.joinCode,
    joined: !!h.joined, rosters: h.rosters,
    tape: [], status: "lobby",       // lobby | pending | final
    pending: null,                   // {seq, side, kind, ctx, deadline}
    plays: [], score: { home: 0, away: 0 }, result: null,
    events: [], nextEventId: 1,      // replayable SSE log
    streams: { home: null, away: null },
    timer: null,
  };
}

function createMatch({ homeTeamId, awayTeamId, clockMs, defense }) {
  const home = eng.getTeam(homeTeamId), away = eng.getTeam(awayTeamId);
  if (!home || !away || homeTeamId === awayTeamId) throw new Error("bad team ids");
  const m = newMatchShell({
    id: rid(8), seed: (Math.random() * 0xFFFFFFFF) >>> 0,
    homeTeamId, awayTeamId,
    settings: {
      clockMs: Math.max(1000, Math.min(86400000, Number(clockMs) || DEFAULT_CLOCK_MS)),
      defense: defense !== false,    // defensive shell calls on by default
    },
    tokens: { home: rid(), away: rid() },
    joinCode: rid(4),
    // Roster snapshots are part of the artifact — generation entropy never
    // needs to be reproducible because the SNAPSHOT is the source of truth.
    rosters: null,
  });
  m.rosters = { home: eng.buildRoster(home), away: eng.buildRoster(away) };
  matches.set(m.id, m);
  persistHeader(m);
  return m;
}

// ── the decision loop: tape re-sim (the interactive runner, server-side) ───
// Fresh seeded sim; BOTH sides' coordinators answer from one flat tape in
// deterministic order; sentinel-pause at the first unanswered call.
function step(m) {
  if (m.status === "final") return;
  eng._setSimRng(m.seed);
  let sim = null, finished = false, result = null;
  let pendingCtx = null;
  try {
    const home = eng.getTeam(m.homeTeamId), away = eng.getTeam(m.awayTeamId);
    sim = new eng.GameSimulator(home, away, clone(m.rosters.home), clone(m.rosters.away));
    let di = 0;
    const coord = (ctx) => {
      if (di < m.tape.length) return m.tape[di++];
      pendingCtx = ctx;
      const e = new Error("h2h-pending");
      e._pending = true;
      throw e;
    };
    sim._coordinators = { home: coord, away: coord };
    result = sim.simulate();
    finished = true;
  } catch (e) {
    if (!e || !e._pending) throw e;
  } finally {
    eng._clearSimRng();
  }

  // Auto-answered kinds (defense calling disabled) never reach a client:
  // append the defer and re-step. Bounded by the tape length of one game.
  if (!finished && pendingCtx && pendingCtx.kind === "defense" && !m.settings.defense) {
    m.tape.push(null);
    persistCall(m, { i: m.tape.length - 1, side: pendingCtx.side, kind: pendingCtx.kind, call: null, auto: "off" });
    return step(m);
  }

  const prevPlayCount = m.plays.length;
  m.plays = finished ? result.plays : sim.plays;
  m.score = finished
    ? { home: result.homeScore, away: result.awayScore }
    : { home: sim.score.home, away: sim.score.away };

  // Stream newly resolved plays to both sides.
  if (m.plays.length > prevPlayCount) {
    pushEvent(m, "both", "plays", {
      from: prevPlayCount,
      plays: m.plays.slice(prevPlayCount),
      score: m.score,
    });
  }

  clearTimeout(m.timer);
  if (finished) {
    m.status = "final";
    m.pending = null;
    m.result = {
      homeScore: result.homeScore, awayScore: result.awayScore,
      winner: result.winner, plays: result.plays.length,
    };
    persistFinal(m);
    pushEvent(m, "both", "final", { result: m.result, artifactHash: artifactHash(m) });
    console.log(`[h2h] ${m.id} FINAL ${m.result.homeScore}-${m.result.awayScore} (${m.tape.length} calls, hash ${artifactHash(m).slice(0, 12)}…)`);
    return;
  }

  // Pause: route the pending decision to its owner, arm the play clock.
  const seq = m.tape.length;
  const deadline = Date.now() + m.settings.clockMs;
  m.status = "pending";
  m.pending = { seq, side: pendingCtx.side, kind: pendingCtx.kind, ctx: pendingCtx, deadline };
  pushEvent(m, pendingCtx.side, "decision", { seq, kind: pendingCtx.kind, ctx: pendingCtx, deadline });
  pushEvent(m, otherSide(pendingCtx.side), "waiting", { seq, deadline });
  m.timer = setTimeout(() => {
    // Clock expired — the AICoordinator answers (a recorded defer), exactly
    // like the single-player [O] key. AFK degrades to vs-AI gracefully.
    if (m.status !== "pending" || !m.pending || m.pending.seq !== seq) return;
    submitCall(m, m.pending.side, seq, null, "timeout");
  }, m.settings.clockMs + 25);
  m.timer.unref?.();
}

function submitCall(m, side, seq, call, auto) {
  if (m.status !== "pending" || !m.pending) return { error: "no pending decision" };
  if (m.pending.side !== side) return { error: "not your decision" };
  if (m.pending.seq !== seq) return { error: "stale seq" };
  const normalized = (call === "auto" || call == null) ? null : call;
  m.tape.push(normalized);
  persistCall(m, { i: seq, side, kind: m.pending.kind, call: normalized, ...(auto ? { auto } : {}) });
  m.pending = null;
  step(m);
  return { ok: true };
}

// ── SSE plumbing ───────────────────────────────────────────────────────────
// Every event is appended to a per-match log with a monotonically increasing
// id; connecting with ?since=N replays everything after N. "both" events are
// stored once and delivered to both sides; side-scoped events only reach
// their owner (hidden information lives here).
function pushEvent(m, to, type, data) {
  const ev = { id: m.nextEventId++, to, type, data };
  m.events.push(ev);
  for (const side of ["home", "away"]) {
    if (to !== "both" && to !== side) continue;
    const res = m.streams[side];
    if (res) writeSse(res, ev);
  }
}
function writeSse(res, ev) {
  try {
    res.write(`id: ${ev.id}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`);
  } catch (_) { /* dead socket — the close handler clears the slot */ }
}

// ── HTTP server ────────────────────────────────────────────────────────────
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", c => { buf += c; if (buf.length > 1e6) reject(new Error("body too large")); });
    req.on("end", () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
function authedMatch(id, token) {
  const m = matches.get(id);
  if (!m) return { error: "no such match" };
  const side = m.tokens.home === token ? "home" : m.tokens.away === token ? "away" : null;
  if (!side) return { error: "bad token" };
  return { m, side };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      return res.end();
    }

    if (req.method === "POST" && url.pathname === "/api/match") {
      const body = await readBody(req);
      const m = createMatch(body);
      return json(res, 200, { matchId: m.id, side: "home", token: m.tokens.home, joinCode: m.joinCode,
                              settings: m.settings });
    }

    if (req.method === "POST" && url.pathname === "/api/join") {
      const { matchId, joinCode } = await readBody(req);
      const m = matches.get(matchId);
      if (!m) return json(res, 404, { error: "no such match" });
      if (m.joinCode !== joinCode) return json(res, 403, { error: "bad join code" });
      if (!m.joined) {
        m.joined = true;
        persistJoin(m);
        // Both seats filled — kick the match off.
        if (m.status === "lobby") step(m);
      }
      return json(res, 200, { matchId: m.id, side: "away", token: m.tokens.away, settings: m.settings });
    }

    if (req.method === "POST" && url.pathname === "/api/call") {
      const { matchId, token, seq, call } = await readBody(req);
      const a = authedMatch(matchId, token);
      if (a.error) return json(res, 403, a);
      const r = submitCall(a.m, a.side, seq, call);
      return json(res, r.error ? 409 : 200, r);
    }

    const evMatch = url.pathname.match(/^\/api\/events\/([a-f0-9]+)$/);
    if (req.method === "GET" && evMatch) {
      const a = authedMatch(evMatch[1], url.searchParams.get("token"));
      if (a.error) return json(res, 403, a);
      const since = Number(url.searchParams.get("since") || req.headers["last-event-id"] || 0);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "access-control-allow-origin": "*",
        "connection": "keep-alive",
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ side: a.side, status: a.m.status })}\n\n`);
      for (const ev of a.m.events) {
        if (ev.id > since && (ev.to === "both" || ev.to === a.side)) writeSse(res, ev);
      }
      a.m.streams[a.side] = res;
      const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch (_) {} }, 15000);
      ping.unref?.();
      req.on("close", () => {
        clearInterval(ping);
        if (a.m.streams[a.side] === res) a.m.streams[a.side] = null;
      });
      return;
    }

    const stMatch = url.pathname.match(/^\/api\/state\/([a-f0-9]+)$/);
    if (req.method === "GET" && stMatch) {
      const a = authedMatch(stMatch[1], url.searchParams.get("token"));
      if (a.error) return json(res, 403, a);
      const m = a.m;
      return json(res, 200, {
        side: a.side, status: m.status, score: m.score,
        playCount: m.plays.length,
        settings: m.settings,
        pending: (m.pending && m.pending.side === a.side)
          ? { seq: m.pending.seq, kind: m.pending.kind, ctx: m.pending.ctx, deadline: m.pending.deadline }
          : null,
        waitingDeadline: (m.pending && m.pending.side !== a.side) ? m.pending.deadline : null,
        result: m.result,
        lastEventId: m.nextEventId - 1,
      });
    }

    // One-time match setup for the browser client: team ids + the roster
    // SNAPSHOTS (the client builds ratings/lookup locally from these — the
    // same objects the server sims, so names/jerseys/tooltips agree).
    const suMatch = url.pathname.match(/^\/api\/setup\/([a-f0-9]+)$/);
    if (req.method === "GET" && suMatch) {
      const a = authedMatch(suMatch[1], url.searchParams.get("token"));
      if (a.error) return json(res, 403, a);
      const m = a.m;
      return json(res, 200, {
        side: a.side, status: m.status, joined: m.joined,
        homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId,
        settings: m.settings, rosters: m.rosters,
        lastEventId: m.nextEventId - 1,
      });
    }

    const arMatch = url.pathname.match(/^\/api\/artifact\/([a-f0-9]+)$/);
    if (req.method === "GET" && arMatch) {
      const a = authedMatch(arMatch[1], url.searchParams.get("token"));
      if (a.error) return json(res, 403, a);
      return json(res, 200, { ...artifactOf(a.m), result: a.m.result, hash: artifactHash(a.m) });
    }

    json(res, 404, { error: "not found" });
  } catch (e) {
    console.error("[h2h]", req.method, url.pathname, e.message);
    json(res, 500, { error: "server error" });
  }
});

function start(port = PORT) {
  loadPersisted();
  return new Promise(resolve => {
    server.listen(port, () => {
      console.log(`[h2h] authoritative match server on :${port} (engine: ${eng.TEAMS.length} teams)`);
      resolve(server);
    });
  });
}

if (require.main === module) start();
module.exports = { start, server, matches, createMatch, _engine: eng };
