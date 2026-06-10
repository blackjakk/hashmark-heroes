// ─── H2H server probe — two scripted clients play a full match ─────────────
// Boots the server in-process on a test port, then drives BOTH sides over
// the real HTTP/SSE wire: create → join → answer every decision (with a
// deliberate go-silent window to exercise the play-clock AI fallback) →
// final. Afterwards it fetches the deterministic artifact and INDEPENDENTLY
// re-sims the tape with a fresh engine load, asserting the same final score
// and artifact hash — the verifiability property the settlement hook rests on.
//
//   node server/h2h-probe.js          (exit 0 = all assertions pass)
"use strict";
process.env.H2H_DATA = require("os").tmpdir() + "/h2h-probe-data-" + Date.now();
const { start } = require("./h2h-server.js");
const { loadEngine } = require("./engine-host.js");
const crypto = require("crypto");

const PORT = 18787;
const BASE = `http://127.0.0.1:${PORT}`;
const CLOCK_MS = 1200;            // short clock so the silent window is quick
const SILENT_FROM = 20, SILENT_TO = 25;   // away ignores these decision seqs

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

// Minimal SSE client on global fetch — parses text/event-stream frames.
async function sse(url, onEvent) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("SSE connect failed: " + res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
          let type = "message", data = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event: ")) type = line.slice(7);
            else if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (data) onEvent(type, JSON.parse(data));
          else if (type !== "message") onEvent(type, null);
        }
      }
    } catch (_) { /* stream closed at match end */ }
  })();
  return () => reader.cancel().catch(() => {});
}

const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
};
const get = async (p) => (await fetch(BASE + p)).json();

// Scripted policies — deliberately different per side so the tape is varied.
function policy(side, kind, ctx) {
  if (kind === "defense")    return side === "home" ? "C0_BLITZ" : (ctx.down >= 3 ? "C2_ZONE" : "C3_ZONE");
  if (kind === "fourthDown") return side === "home" ? (ctx.inFGRange ? "fg" : "punt") : null; // away defers
  if (kind === "pat")        return "kick";
  /* playcall */             return side === "home" ? (ctx.down <= 1 ? "run" : "pass") : "auto";
}

(async () => {
  await start(PORT);

  // ── create + join ──
  const created = await post("/api/match", { homeTeamId: 1, awayTeamId: 2, clockMs: CLOCK_MS });
  check("create match", !!created.matchId && created.side === "home" && !!created.token);
  const badJoin = await post("/api/join", { matchId: created.matchId, joinCode: "nope" });
  check("bad join code rejected", badJoin.error === "bad join code");
  const joined = await post("/api/join", { matchId: created.matchId, joinCode: created.joinCode });
  check("join match", joined.side === "away" && !!joined.token);

  const id = created.matchId;
  const tokens = { home: created.token, away: joined.token };
  const seen = { home: { decisions: 0, plays: 0, kinds: new Set() },
                 away: { decisions: 0, plays: 0, kinds: new Set() } };
  let finalEv = null, timeoutsObserved = 0;
  const finishedPromise = {};
  const done = new Promise(r => { finishedPromise.resolve = r; });

  const mkClient = (side) => async (type, data) => {
    const s = seen[side];
    if (type === "plays") s.plays += data.plays.length;
    if (type === "final" && !finalEv) { finalEv = data; finishedPromise.resolve(); }
    if (type !== "decision") return;
    s.decisions++;
    s.kinds.add(data.kind);
    // The go-silent window: away ignores decisions, forcing the play clock
    // to expire and the AICoordinator fallback to answer.
    if (side === "away" && data.seq >= SILENT_FROM && data.seq < SILENT_TO) { timeoutsObserved++; return; }
    const call = policy(side, data.kind, data.ctx);
    const r = await post("/api/call", { matchId: id, token: tokens[side], seq: data.seq, call });
    if (r.error && r.error !== "stale seq") console.error("call rejected:", side, data.seq, r.error);
  };

  const closeH = await sse(`${BASE}/api/events/${id}?token=${tokens.home}`, mkClient("home"));
  const closeA = await sse(`${BASE}/api/events/${id}?token=${tokens.away}`, mkClient("away"));

  // Auth: a garbage token must not get a stream.
  const evil = await fetch(`${BASE}/api/events/${id}?token=deadbeef`);
  check("bad token rejected on events", evil.status === 403);

  const t0 = Date.now();
  await Promise.race([done, new Promise(r => setTimeout(r, 240000))]);
  // Let the slower stream drain its buffered frames before asserting —
  // "final" resolves on whichever side receives it first.
  await new Promise(r => setTimeout(r, 600));
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  check("match reached FINAL", !!finalEv, `${elapsed}s wall`);
  if (!finalEv) process.exit(1);

  check("both sides streamed the full game",
    seen.home.plays === finalEv.result.plays && seen.away.plays === finalEv.result.plays,
    `plays home=${seen.home.plays} away=${seen.away.plays} final=${finalEv.result.plays}`);
  check("both sides got decisions", seen.home.decisions > 20 && seen.away.decisions > 20,
    `home=${seen.home.decisions} away=${seen.away.decisions}`);
  check("all four kinds prompted somewhere",
    ["playcall", "defense"].every(k => seen.home.kinds.has(k) || seen.away.kinds.has(k))
    && (seen.home.kinds.has("fourthDown") || seen.away.kinds.has("fourthDown")),
    [...new Set([...seen.home.kinds, ...seen.away.kinds])].join(","));
  check("go-silent window exercised the play clock", timeoutsObserved >= 1, `ignored=${timeoutsObserved}`);

  // ── state snapshot (reconnect surface) ──
  const st = await get(`/api/state/${id}?token=${tokens.home}`);
  check("state snapshot final", st.status === "final" && st.result.plays === finalEv.result.plays);

  // ── the verifiability property: independent re-sim of the artifact ──
  const art = await get(`/api/artifact/${id}?token=${tokens.home}`);
  check("artifact served", Array.isArray(art.tape) && !!art.rosters && art.hash === finalEv.artifactHash);
  const eng = loadEngine();
  const clone = o => JSON.parse(JSON.stringify(o));
  eng._setSimRng(art.seed);
  let replay;
  try {
    const sim = new eng.GameSimulator(eng.getTeam(art.homeTeamId), eng.getTeam(art.awayTeamId),
      clone(art.rosters.home), clone(art.rosters.away));
    let di = 0;
    const coord = () => (di < art.tape.length ? art.tape[di++] : null);
    sim._coordinators = { home: coord, away: coord };
    replay = sim.simulate();
  } finally { eng._clearSimRng(); }
  check("independent re-sim reproduces the result",
    replay.homeScore === finalEv.result.homeScore && replay.awayScore === finalEv.result.awayScore
    && replay.plays.length === finalEv.result.plays,
    `replay ${replay.homeScore}-${replay.awayScore}/${replay.plays.length} vs server ${finalEv.result.homeScore}-${finalEv.result.awayScore}/${finalEv.result.plays}`);
  const localHash = crypto.createHash("sha256").update(JSON.stringify({
    v: 1, seed: art.seed, homeTeamId: art.homeTeamId, awayTeamId: art.awayTeamId,
    settings: art.settings, rosters: art.rosters, tape: art.tape,
  })).digest("hex");
  check("artifact hash recomputes identically", localHash === art.hash);

  closeH(); closeA();
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
