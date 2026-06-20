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
//         H2H_STATIC=1 (or --static) also serves the game files from the
//         repo root — one process, one origin (see server/README.md).
// Test:   node server/h2h-probe.js             (two scripted clients, full match)
//
// API (all JSON; auth = per-side token issued at create/join):
//   POST /api/match  {homeTeamId, awayTeamId?, clockMs?, defense?, homeRoster?}
//        → { matchId, side:"home", token, joinCode }
//        homeRoster = bring-your-own (franchise) roster; awayTeamId is only
//        a fallback — the joiner picks their own seat.
//   POST /api/join   {matchId, joinCode, awayTeamId?, awayRoster?}
//        → { side:"away", token }   (finalizes the away seat, starts the match)
//   GET  /api/events/:matchId?token=T&since=N      SSE stream, event ids = seq
//        events: hello | start | decision | waiting | plays | final | ping
//        (decision windows for the same snap run in PARALLEL under one
//        shared clock — defense + offense both get prompts; see step())
//   POST /api/call   {matchId, token, seq, call}   answer the pending decision
//        ("call" may be null/"auto" = defer to the AI, same as the [O] key)
//   GET  /api/state/:matchId?token=T               reconnect snapshot
//   GET  /api/artifact/:matchId?token=T            {seed,teams,rosters,tape,result,hash,resultHash}
//        (the deterministic match artifact — the settlement object. `hash` binds
//        the INPUTS {seed,rosters,tape}; `resultHash` binds the OUTCOME, so a
//        challenger re-sims the inputs and disputes on a resultHash mismatch.)
"use strict";
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./engine-host.js");
const { resultHash } = require("./result-hash.js");

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
    t: "final", result: m.result, hash: artifactHash(m), resultHash: m.resultHash, finished: Date.now(),
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
        if (l.t === "final") { m.status = "final"; m.result = l.result; m.resultHash = l.resultHash || null; }
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
    outstanding: [],                 // [{seq, side, kind, ctx, deadline, call?}]
    plays: [], score: { home: 0, away: 0 }, result: null,
    events: [], nextEventId: 1,      // replayable SSE log
    streams: { home: null, away: null },
    timer: null,
  };
}

// A roster supplied by a client (franchise-roster matches) must at least
// look like a roster the engine can sim. The snapshot becomes part of the
// match artifact either way, so determinism is unaffected by its origin.
function validRoster(r) {
  return Array.isArray(r) && r.length >= 20 && r.length <= 90
    && r.every(p => p && typeof p === "object"
        && typeof p.name === "string" && typeof p.position === "string");
}

function createMatch({ homeTeamId, awayTeamId, clockMs, defense, homeRoster }) {
  const home = eng.getTeam(homeTeamId);
  if (!home) throw new Error("bad home team id");
  if (awayTeamId != null && (!eng.getTeam(awayTeamId) || awayTeamId === homeTeamId)) {
    throw new Error("bad away team id");
  }
  if (homeRoster != null && !validRoster(homeRoster)) throw new Error("bad home roster");
  const m = newMatchShell({
    id: rid(8), seed: (Math.random() * 0xFFFFFFFF) >>> 0,
    homeTeamId,
    awayTeamId: awayTeamId ?? null,    // finalized at join (the joiner may bring their own team)
    settings: {
      clockMs: Math.max(1000, Math.min(86400000, Number(clockMs) || DEFAULT_CLOCK_MS)),
      defense: defense !== false,      // defensive shell calls on by default
    },
    tokens: { home: rid(), away: rid() },
    joinCode: rid(4),
    rosters: null,
  });
  // Roster snapshots are part of the artifact — generation entropy never
  // needs to be reproducible because the SNAPSHOT is the source of truth.
  // The away roster is finalized at join (joiner's franchise roster, or
  // generated for whichever team they pick).
  m.rosters = { home: homeRoster || eng.buildRoster(home), away: null };
  matches.set(m.id, m);
  persistHeader(m);
  return m;
}

// Finalize the away seat (team + roster) and start the match. Pre-join the
// tape is empty, so rewriting the header is safe and keeps the artifact
// self-contained.
function finalizeJoin(m, { awayTeamId, awayRoster }) {
  if (m.joined) return;
  if (awayRoster != null && !validRoster(awayRoster)) throw new Error("bad away roster");
  let awayId = awayTeamId ?? m.awayTeamId;
  if (awayId == null || !eng.getTeam(awayId) || awayId === m.homeTeamId) {
    awayId = eng.TEAMS.find(t => t.id !== m.homeTeamId).id;
  }
  m.awayTeamId = awayId;
  m.rosters.away = awayRoster || eng.buildRoster(eng.getTeam(awayId));
  m.joined = true;
  persistHeader(m);
  persistJoin(m);
  // Tell the host which seat the joiner actually took (they may have
  // brought their own team/roster) — the client refetches setup on this.
  pushEvent(m, "both", "start", { homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId });
  if (m.status === "lobby") step(m);
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

  // Stream newly resolved plays to both sides (wire-slimmed; see
  // slimPlaysForWire).
  if (m.plays.length > prevPlayCount) {
    pushEvent(m, "both", "plays", {
      from: prevPlayCount,
      plays: slimPlaysForWire(m, m.plays.slice(prevPlayCount), finished),
      score: m.score,
    });
  }

  clearTimeout(m.timer);
  if (finished) {
    m.status = "final";
    m.outstanding = [];
    m.result = {
      homeScore: result.homeScore, awayScore: result.awayScore,
      winner: result.winner, plays: result.plays.length,
    };
    // Canonical OUTCOME hash (result-hash.js) computed from the FULL sim result
    // — the settlement object a challenger recomputes by re-simming the artifact
    // inputs. artifactHash binds the INPUTS; resultHash binds what HAPPENED.
    m.resultHash = resultHash(result);
    persistFinal(m);
    pushEvent(m, "both", "final", { result: m.result, artifactHash: artifactHash(m), resultHash: m.resultHash });
    console.log(`[h2h] ${m.id} FINAL ${m.result.homeScore}-${m.result.awayScore} (${m.tape.length} calls, in ${artifactHash(m).slice(0, 12)}… out ${m.resultHash.slice(0, 12)}…)`);
    return;
  }

  // ── Pause: open the snap's decision window(s) under ONE shared clock. ──
  // PARALLEL WINDOWS: the defensive shell fires at the snap top, and for
  // downs 1-3 the very next coordinator ask is guaranteed to be the same
  // snap's offensive playcall (the engine's seam order: defense → [4th-down
  // branch, down 4 only] → playcall). The offense's call can't depend on
  // the defense's (hidden information), so prompt BOTH sides now and feed
  // the answers to the tape in seam order — one window per snap instead of
  // two. The offense's pre-snap context is synthesized from the same snap
  // state (no AI passProb yet — the panel handles its absence). 4th downs
  // and PATs stay sequential so their prompts carry the real engine context
  // (fgDist, AI lean). Misprediction is structurally harmless: every seam
  // validates its answer and treats foreign values as a defer.
  m.status = "pending";
  const deadline = Date.now() + m.settings.clockMs;
  const baseSeq = m.tape.length;
  m.outstanding = [{ seq: baseSeq, side: pendingCtx.side, kind: pendingCtx.kind, ctx: pendingCtx, deadline }];
  if (pendingCtx.kind === "defense" && pendingCtx.down < 4) {
    const offSide = otherSide(pendingCtx.side);
    m.outstanding.push({
      seq: baseSeq + 1, side: offSide, kind: "playcall", deadline,
      ctx: {
        kind: "playcall", side: offSide, parallel: true,
        down: pendingCtx.down, ytg: pendingCtx.ytg, yardLine: pendingCtx.yardLine,
        quarter: pendingCtx.quarter, time: pendingCtx.time, score: pendingCtx.score,
      },
    });
  }
  for (const side of ["home", "away"]) {
    const mine = m.outstanding.find(o => o.side === side);
    if (mine) pushEvent(m, side, "decision", { seq: mine.seq, kind: mine.kind, ctx: mine.ctx, deadline });
    else pushEvent(m, side, "waiting", { seq: baseSeq, deadline });
  }
  m.timer = setTimeout(() => {
    // Clock expired — every unanswered window gets a recorded defer (the
    // AICoordinator answers, exactly like the single-player [O] key).
    if (m.status !== "pending" || !m.outstanding.length || m.outstanding[0].seq !== baseSeq) return;
    for (const o of m.outstanding) if (o.call === undefined) { o.call = null; o.auto = "timeout"; }
    resolveWindow(m);
  }, m.settings.clockMs + 25);
  m.timer.unref?.();
}

// All windows answered (or expired): commit calls to the tape in seq order
// and advance. ONE re-sim resolves the whole snap.
//
// DURABILITY BOUNDARY: calls are persisted here, at window resolution —
// atomically, in seq order. A call collected while the opponent is still
// on the clock is NOT yet durable; a server crash in that gap simply
// re-opens the window (both prompts re-arm). At-least-once prompting,
// never a divergent tape.
function resolveWindow(m) {
  const batch = m.outstanding.sort((a, b) => a.seq - b.seq);
  m.outstanding = [];
  for (const o of batch) {
    m.tape.push(o.call);
    persistCall(m, { i: o.seq, side: o.side, kind: o.kind, call: o.call, ...(o.auto ? { auto: o.auto } : {}) });
  }
  step(m);
}

function submitCall(m, side, seq, call, auto) {
  if (m.status !== "pending" || !m.outstanding.length) return { error: "no pending decision" };
  const o = m.outstanding.find(x => x.side === side);
  if (!o) return { error: "not your decision" };
  if (o.seq !== seq) return { error: "stale seq" };
  if (o.call !== undefined) return { error: "already answered" };
  o.call = (call === "auto" || call == null) ? null : call;
  if (auto) o.auto = auto;
  if (m.outstanding.every(x => x.call !== undefined)) {
    clearTimeout(m.timer);
    resolveWindow(m);
  } else {
    // You're in; the opponent is still on the (same) clock.
    pushEvent(m, side, "waiting", { seq, deadline: o.deadline });
  }
  return { ok: true };
}

// Wire slimming: statsSnap — the cumulative live box score the engine
// attaches to every visual (~45KB) — goes over the wire on a CADENCE, not
// per play: every ~8th carrier, plus score plays (so the box is exact after
// scores) and the game's final carrier (the FINAL-screen stars read it).
// The client's stats panels walk BACK to the most recent snapshot
// (currentStats), so sparser snapshots just mean stats-as-of a few plays
// ago between refreshes — invisible in practice, ~80% fewer wire bytes.
const SNAP_CADENCE = 8;
function slimPlaysForWire(m, slice, finished) {
  let lastCarrier = -1;
  if (finished) {
    for (let i = slice.length - 1; i >= 0; i--) {
      if (slice[i] && slice[i].statsSnap) { lastCarrier = i; break; }
    }
  }
  return slice.map((p, i) => {
    if (!p || typeof p !== "object" || !p.statsSnap) return p;
    m._sinceSnap = (m._sinceSnap || 0) + 1;
    if (m._sinceSnap >= SNAP_CADENCE || p.kind === "score" || i === lastCarrier) {
      m._sinceSnap = 0;
      return p;
    }
    const c = { ...p };
    delete c.statsSnap;
    return c;
  });
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
      const { matchId, joinCode, awayTeamId, awayRoster } = await readBody(req);
      const m = matches.get(matchId);
      if (!m) return json(res, 404, { error: "no such match" });
      if (m.joinCode !== joinCode) return json(res, 403, { error: "bad join code" });
      if (!m.joined) finalizeJoin(m, { awayTeamId, awayRoster });
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
      const mine = m.outstanding.find(o => o.side === a.side && o.call === undefined);
      const theirs = m.outstanding.find(o => o.side !== a.side && o.call === undefined);
      return json(res, 200, {
        side: a.side, status: m.status, score: m.score,
        playCount: m.plays.length,
        settings: m.settings,
        pending: mine
          ? { seq: mine.seq, kind: mine.kind, ctx: mine.ctx, deadline: mine.deadline }
          : null,
        waitingDeadline: (!mine && theirs) ? theirs.deadline : null,
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
      return json(res, 200, { ...artifactOf(a.m), result: a.m.result, hash: artifactHash(a.m), resultHash: a.m.resultHash || null });
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true, h2h: 1 });
    }

    // Static game files (deployment mode: H2H_STATIC=1 → one process serves
    // play.html AND the API on the same origin, so the client's server-base
    // field can stay empty and TLS terminates at one reverse proxy).
    if (STATIC_ROOT && req.method === "GET" && !url.pathname.startsWith("/api/")) {
      return serveStatic(url.pathname, res);
    }

    json(res, 404, { error: "not found" });
  } catch (e) {
    console.error("[h2h]", req.method, url.pathname, e.message);
    json(res, 500, { error: "server error" });
  }
});

// ── static file serving (deployment mode) ──────────────────────────────────
const STATIC_ROOT = (process.env.H2H_STATIC || process.argv.includes("--static"))
  ? path.resolve(__dirname, "..") : null;
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".woff2": "font/woff2", ".map": "application/json", ".md": "text/plain; charset=utf-8",
};
function serveStatic(pathname, res) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/play.html";
  const file = path.normalize(path.join(STATIC_ROOT, rel));
  // Path traversal guard: the resolved file must stay inside the root.
  if (!file.startsWith(STATIC_ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(buf);
  });
}

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
