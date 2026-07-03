// league-probe.js — full dynasty lifecycle over the real wire: create → invite
// (email + link) → members claim teams → snapshot → start → manual advance →
// scheduled advance → auth guards → restart recovery. Zero-dep; spawns the
// server on a throwaway port + data dir. Runs headless in CI like the H2H probes.
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");

const PORT = 8799;
const DATA = path.join(require("os").tmpdir(), "hh-league-probe-" + Date.now());
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.log("  ✗ " + m); };
const check = (c, m) => c ? ok(m) : bad(m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: "127.0.0.1", port: PORT, path: p, method, headers: { "Content-Type": "application/json" } }, res => {
      let buf = ""; res.on("data", c => buf += c); res.on("end", () => { try { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : {} }); } catch (e) { resolve({ status: res.statusCode, body: buf }); } });
    });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}
// collect SSE events for `ms`
function sse(p, ms) {
  return new Promise((resolve) => {
    const events = [];
    const r = http.get({ host: "127.0.0.1", port: PORT, path: p }, res => {
      let buf = "";
      res.on("data", c => { buf += c; let i; while ((i = buf.indexOf("\n\n")) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); const tl = blk.split("\n").find(l => l.startsWith("event: ")); const dl = blk.split("\n").find(l => l.startsWith("data: ")); if (tl) events.push({ type: tl.slice(7), data: dl ? JSON.parse(dl.slice(6)) : null }); } });
    });
    setTimeout(() => { r.destroy(); resolve(events); }, ms);
  });
}

function spawnServer() {
  const srv = spawn(process.execPath, [path.join(__dirname, "league-server.js"), String(PORT)],
    { env: { ...process.env, HH_LEAGUE_DATA: DATA, HH_LEAGUE_TEST: "1", HH_LEAGUE_PORT: String(PORT) }, stdio: "ignore" });
  return srv;
}
async function waitUp() { for (let i = 0; i < 40; i++) { try { const h = await req("GET", "/api/health"); if (h.status === 200) return true; } catch (_) {} await sleep(100); } return false; }

(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  let srv = spawnServer();
  if (!await waitUp()) { console.log("server didn't start"); process.exit(1); }

  console.log("[create dynasty]");
  const create = await req("POST", "/api/league", { name: "Probe Dynasty", adminTeamId: 1, adminName: "Commish", settings: { teamCount: 6, advanceMode: "manual" } });
  check(create.status === 200 && create.body.leagueId, "create returns leagueId");
  check(!!create.body.adminToken && !!create.body.memberToken, "create issues admin + member tokens");
  check(/^#league=/.test(create.body.link || ""), `share link minted (${create.body.link})`);
  const { leagueId, adminToken } = create.body;

  console.log("\n[invite by email + link]");
  const inv = await req("POST", "/api/league/invite", { leagueId, adminToken, emails: ["a@x.com", "b@x.com"] });
  check(inv.status === 200 && (inv.body.invites || []).length === 2, "invite returns one link per email");
  check(inv.body.invites.every(i => /^#league=/.test(i.link)), "each invite has a join link");
  check(inv.body.mailer === "links-only", "no mailer configured → links-only (admin sends them)");
  const inviteToken = inv.body.invites[0].token;

  console.log("\n[members claim teams]");
  const j1 = await req("POST", "/api/league/join", { leagueId, token: inviteToken, teamId: 2, displayName: "GM Ada" });
  check(j1.status === 200 && j1.body.memberToken, "join via EMAIL invite token works");
  const j2 = await req("POST", "/api/league/join", { leagueId, token: create.body.joinCode, teamId: 3, displayName: "GM Lin" });
  check(j2.status === 200 && j2.body.memberToken, "join via open LINK (joinCode) works");
  const jDup = await req("POST", "/api/league/join", { leagueId, token: create.body.joinCode, teamId: 2 });
  check(jDup.status === 400, "taken team is rejected");
  const jReuse = await req("POST", "/api/league/join", { leagueId, token: inviteToken, teamId: 4 });
  check(jReuse.status === 400, "single-use email invite can't be reused");

  console.log("\n[snapshot]");
  const snap = await req("GET", `/api/league/${leagueId}?token=${adminToken}`);
  check(snap.body.league.members.length === 3, `roster shows 3 members (admin + 2 joiners) — got ${snap.body.league?.members?.length}`);
  check(snap.body.league.phase === "lobby", "phase is lobby pre-start");

  console.log("\n[commissioner start + manual advance, watched over SSE]");
  const evP = sse(`/api/league/events/${leagueId}?token=${adminToken}`, 1500);
  await sleep(150);
  const start = await req("POST", "/api/league/start", { leagueId, adminToken });
  check(start.status === 200 && start.body.league.phase === "active", "admin starts the dynasty → active");
  const adv = await req("POST", "/api/league/advance", { leagueId, adminToken });
  check(adv.status === 200 && adv.body.week === 2, `manual advance → week 2 (got ${adv.body.week})`);
  const events = await evP;
  check(events.some(e => e.type === "started"), "SSE delivered 'started'");
  check(events.some(e => e.type === "advanced"), "SSE delivered 'advanced'");

  console.log("\n[auth guards]");
  const badStart = await req("POST", "/api/league/advance", { leagueId, adminToken: "WRONG" });
  check(badStart.status === 403, "non-commissioner cannot advance");

  console.log("\n[scheduled advance fires on its own]");
  await req("POST", "/api/league/settings", { leagueId, adminToken, advanceMode: "scheduled", advanceIntervalMs: 250 });
  const wk0 = (await req("GET", `/api/league/${leagueId}?token=${adminToken}`)).body.league.week;
  await sleep(700);
  const wk1 = (await req("GET", `/api/league/${leagueId}?token=${adminToken}`)).body.league.week;
  check(wk1 > wk0, `scheduled mode auto-advanced without input (${wk0} → ${wk1})`);

  console.log("\n[restart recovery — determinism is the recovery]");
  const before = (await req("GET", `/api/league/${leagueId}?token=${adminToken}`)).body.league;
  srv.kill("SIGKILL");
  await sleep(300);
  srv = spawnServer();
  if (!await waitUp()) { bad("server didn't respawn"); }
  const after = (await req("GET", `/api/league/${leagueId}?token=${adminToken}`)).body.league;
  check(after && after.members.length === before.members.length, "members survive a restart");
  check(after && after.phase === "active" && after.season === before.season, "phase/season survive a restart");

  // ── FANTASY DRAFT (FANTASY_DRAFT_DESIGN.md S2) ─────────────────────────────
  console.log("\n[fantasy draft — commissioner start → drafting phase]");
  const fdc = await req("POST", "/api/league", {
    name: "Draft Dynasty", adminTeamId: 5, adminName: "Commish",
    settings: { teamCount: 4, rosterMode: "fantasy_draft", draftRounds: 12, pickClockMs: 0 },
  });
  check(fdc.status === 200, "fantasy-draft league created");
  const fdId = fdc.body.leagueId, fdAdmin = fdc.body.adminToken, fdCommishTok = fdc.body.memberToken;
  const fdJoin = await req("POST", "/api/league/join", { leagueId: fdId, token: fdc.body.joinCode, teamId: 9, displayName: "GM Bo" });
  const fdBoTok = fdJoin.body.memberToken;
  const evDraft = sse(`/api/league/events/${fdId}?token=${fdAdmin}`, 2500);
  await sleep(150);
  const fdStart = await req("POST", "/api/league/start", { leagueId: fdId, adminToken: fdAdmin });
  check(fdStart.status === 200 && fdStart.body.league.phase === "drafting", "commissioner START enters the DRAFT, not active");
  const snap1 = await req("GET", `/api/league/${fdId}?token=${fdAdmin}`);
  check(snap1.body.league.phase === "drafting", "phase is drafting");
  check(snap1.body.league.draft && snap1.body.league.draft.poolSeed > 0, "draft summary carries the server-minted poolSeed");

  console.log("\n[draft state + validation guards]");
  const dst = await req("GET", `/api/league/draft/${fdId}?token=${fdCommishTok}`);
  check(dst.status === 200 && Array.isArray(dst.body.order) && dst.body.order.length === 32, "draft state: 32-team order");
  check(dst.body.tape.length > 0, `AI turns auto-picked up to the first human (${dst.body.tape.length} picks on the tape)`);
  check([5, 9].includes(dst.body.onClockTeamId), `a HUMAN team is on the clock (team ${dst.body.onClockTeamId})`);

  // Independent re-derivation — the client-side verification path: rebuild the
  // pool from (seed, year), replay the tape, and pick legally from the result.
  const kit = require("./draft-host.js").loadDraftKit();
  const built = kit._fdBuildPool(dst.body.poolSeed, dst.body.year);
  built.order = dst.body.order;
  let st = kit._fdApplyTape(built, dst.body.tape);
  check(st.pickIdx === dst.body.tape.length, "probe re-derived the draft state from (seed, tape)");
  const onClock = dst.body.onClockTeamId;
  const humanTok = onClock === 5 ? fdCommishTok : fdBoTok;
  const otherTok = onClock === 5 ? fdBoTok : fdCommishTok;
  const legalPick = st.pool.find(p => !st.taken.has(p.pid) && kit._fdLegal(st, onClock, p.position));
  const takenPid = dst.body.tape[0].pid;

  const wrongTurn = await req("POST", "/api/league/draft/pick", { leagueId: fdId, token: otherTok, pid: legalPick.pid });
  check(wrongTurn.status === 400 && /not your pick/.test(wrongTurn.body.error), "out-of-turn pick rejected");
  const dupPick = await req("POST", "/api/league/draft/pick", { leagueId: fdId, token: humanTok, pid: takenPid });
  check(dupPick.status === 400 && /already drafted/.test(dupPick.body.error), "already-drafted player rejected");
  const bogus = await req("POST", "/api/league/draft/pick", { leagueId: fdId, token: humanTok, pid: "nope" });
  check(bogus.status === 400, "bogus pid rejected");
  const badTok = await req("POST", "/api/league/draft/pick", { leagueId: fdId, token: "WRONG", pid: legalPick.pid });
  check(badTok.status === 403, "bad token rejected");
  const good = await req("POST", "/api/league/draft/pick", { leagueId: fdId, token: humanTok, pid: legalPick.pid });
  check(good.status === 200 && good.body.pid === legalPick.pid, `on-clock human pick accepted (${legalPick.position} ${legalPick.name})`);

  console.log("\n[mid-draft restart — the tape IS the recovery]");
  const preTape = (await req("GET", `/api/league/draft/${fdId}?token=${fdAdmin}`)).body.tape.length;
  srv.kill("SIGKILL");
  await sleep(300);
  srv = spawnServer();
  if (!await waitUp()) bad("server didn't respawn mid-draft");
  const postRestart = await req("GET", `/api/league/draft/${fdId}?token=${fdAdmin}`);
  check(postRestart.status === 200 && postRestart.body.tape.length >= preTape,
    `draft survives a restart (tape ${preTape} → ${postRestart.body.tape.length})`);
  check((await req("GET", `/api/league/${fdId}?token=${fdAdmin}`)).body.league.phase === "drafting", "phase still drafting after restart");

  console.log("\n[pick clock finishes the draft unattended]");
  const clk = await req("POST", "/api/league/settings", { leagueId: fdId, adminToken: fdAdmin, rosterMode: "fantasy_draft", draftRounds: 12, pickClockMs: 60 });
  check(clk.status === 200 && clk.body.settings.pickClockMs === 60, "commissioner arms a (test-floor) pick clock mid-draft");
  let fin = null;
  for (let i = 0; i < 120; i++) { // 24 human turns × 60ms + 1,600 auto picks
    await sleep(250);
    const s = await req("GET", `/api/league/${fdId}?token=${fdAdmin}`);
    if (s.body.league && s.body.league.phase === "active") { fin = s.body.league; break; }
  }
  check(!!fin, "draft ran to completion on the clock (phase → active)");
  check(fin && fin.draft.done && /^[0-9a-f]{64}$/.test(fin.draft.artifactHash || ""), `artifactHash minted (${(fin?.draft?.artifactHash || "").slice(0, 12)}…)`);

  console.log("\n[anti-cheat: independent verification of the artifact]");
  const final = (await req("GET", `/api/league/draft/${fdId}?token=${fdBoTok}`)).body;
  check(final.tape.length === 32 * kit.FD_PICKS_PER_TEAM, `full tape (${final.tape.length} = 32×${kit.FD_PICKS_PER_TEAM})`);
  st = kit._fdApplyTape(built, final.tape);
  const myResultHash = crypto.createHash("sha256")
    .update(JSON.stringify(final.order.map(t => [t, st.rosters[t].map(p => p.pid)])))
    .digest("hex");
  check(myResultHash === final.resultHash, "probe re-derived the rosters → resultHash MATCHES the server's");
  const floorsOk = final.order.every(t => {
    const c = {};
    for (const p of st.rosters[t]) c[p.position] = (c[p.position] || 0) + 1;
    return Object.entries(kit.FD_FLOORS).every(([q, m]) => (c[q] || 0) >= m);
  });
  check(floorsOk, "every drafted roster meets every position floor");
  const humanPicks = final.tape.filter(e => !e.auto).length;
  check(humanPicks >= 1, `human pick present on the tape (${humanPicks})`);

  srv.kill("SIGKILL");
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n──────────────────────────────────────\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
