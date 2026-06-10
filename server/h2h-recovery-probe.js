// ─── H2H restart-recovery probe ─────────────────────────────────────────────
// Validates the headline persistence claim: the authoritative state is
// (seed, rosters, tape), so a SIGKILLed server recovers any in-flight match
// by re-simming the tape. Spawns the server as a child process, plays part
// of a match, kills it mid-decision, respawns on the same data dir, asserts
// the match resumes at the same play count, then finishes it to FINAL.
// Uses /api/state polling (no SSE) — also exercises the reconnect surface.
//
//   node server/h2h-recovery-probe.js     (exit 0 = pass)
"use strict";
const { spawn } = require("child_process");
const os = require("os");
const path = require("path");

const PORT = 18788;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = path.join(os.tmpdir(), "h2h-recovery-" + Date.now());

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};
const post = async (p, body) => (await fetch(BASE + p, { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
const get = async (p) => (await fetch(BASE + p)).json();

function bootServer() {
  const child = spawn(process.execPath, [path.join(__dirname, "h2h-server.js"), String(PORT)],
    { env: { ...process.env, H2H_DATA: DATA }, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("server boot timeout")), 15000);
    child.stdout.on("data", d => {
      if (String(d).includes("authoritative match server")) { clearTimeout(to); resolve(child); }
    });
    child.stderr.on("data", d => process.stderr.write("[server] " + d));
    child.on("exit", c => { /* expected on kill */ });
  });
}

// Answer pending decisions for both sides by polling state. Returns when
// `untilCalls` tape entries exist (seq reached) or the match is final.
async function playUntil(id, tokens, untilCalls) {
  for (;;) {
    let acted = false;
    for (const side of ["home", "away"]) {
      const st = await get(`/api/state/${id}?token=${tokens[side]}`);
      if (st.status === "final") return st;
      if (st.pending) {
        if (untilCalls != null && st.pending.seq >= untilCalls) return st;
        const k = st.pending.kind;
        const call = k === "defense" ? "C1_MAN" : k === "pat" ? "kick"
                   : k === "fourthDown" ? null : (st.pending.seq % 2 ? "run" : "pass");
        await post("/api/call", { matchId: id, token: tokens[side], seq: st.pending.seq, call });
        acted = true;
      }
    }
    if (!acted) await new Promise(r => setTimeout(r, 60));
  }
}

(async () => {
  let server = await bootServer();

  const created = await post("/api/match", { homeTeamId: 3, awayTeamId: 4, clockMs: 60000 });
  const id = created.matchId;
  const joined = await post("/api/join", { matchId: id, joinCode: created.joinCode });
  const tokens = { home: created.token, away: joined.token };

  // Play 30 decisions, snapshot, then SIGKILL mid-match.
  const before = await playUntil(id, tokens, 30);
  check("mid-match state reached", before.status === "pending" && before.playCount > 0,
    `plays=${before.playCount} pendingSeq=${before.pending?.seq}`);
  server.kill("SIGKILL");
  await new Promise(r => setTimeout(r, 300));

  // Respawn on the same data dir — the match must come back, re-simmed.
  server = await bootServer();
  const after = await get(`/api/state/${id}?token=${tokens.home}`);
  const afterAway = await get(`/api/state/${id}?token=${tokens.away}`);
  const pendingSeq = after.pending?.seq ?? afterAway.pending?.seq;
  check("match survived SIGKILL", after.status === "pending",
    `status=${after.status}`);
  check("re-sim restored the exact play count", after.playCount === before.playCount,
    `before=${before.playCount} after=${after.playCount}`);
  // With parallel windows the pending seq may legitimately step back to the
  // window base: calls collected while the opponent was still on the clock
  // aren't durable until the window RESOLVES (see resolveWindow's durability
  // boundary) — a crash in that gap re-opens the whole window.
  const beforeSeq = before.pending?.seq ?? -1;
  check("pending decision re-armed within the same window",
    pendingSeq === beforeSeq || pendingSeq === beforeSeq - 1,
    `before seq=${beforeSeq} after seq=${pendingSeq}`);

  // Finish the match across the restart boundary.
  const fin = await playUntil(id, tokens, null);
  check("match finished after recovery", fin.status === "final",
    fin.result ? `${fin.result.homeScore}-${fin.result.awayScore} in ${fin.result.plays} plays` : "");

  // The artifact is restart-independent: hash recomputes over seed+rosters+tape.
  const art = await get(`/api/artifact/${id}?token=${tokens.home}`);
  check("artifact intact across restart", !!art.hash && art.tape.length > 30,
    `tape=${art.tape.length} hash=${String(art.hash).slice(0, 12)}…`);

  server.kill("SIGKILL");
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
