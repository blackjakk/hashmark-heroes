#!/usr/bin/env node
// _league_client_probe.js — browser league client end-to-end (2 real browsers).
//
// Spawns ONE league-server in --static mode (it serves play.html AND the API on
// the same origin — the real single-process deploy) and drives two Chromium
// contexts through the whole flow:
//   A (commissioner): ONLINE LEAGUE card → create (fantasy draft, 12 rounds,
//     no clock) → lobby with invite link.
//   B (member): opens the #league= deep link → claims a team → both lobbies
//     show 2 GMs (B via response, A via SSE).
//   A: START → both clients land in the live draft room (SSE draft_started).
//   The on-clock human picks via the UI handler; the OTHER browser sees the
//   pick arrive over SSE. Commissioner then arms a tiny pick clock via the
//   settings endpoint → the draft runs to completion unattended.
//   Both clients reach DRAFT COMPLETE and independently VERIFY the result
//   hash (crypto.subtle re-derivation — the anti-cheat moment, in the UI).
//   Both click "Start my franchise" → both land in preseason, and a sample
//   team's roster pids MATCH ACROSS BROWSERS (cross-client determinism).
//
//   node tools/_league_client_probe.js     (server on :5219, test env)

"use strict";
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const PORT = 5219;
const DATA = path.join(os.tmpdir(), "hh-league-client-probe-" + Date.now());
const children = [];
process.on("exit", () => children.forEach((c) => { try { c.kill("SIGKILL"); } catch {} }));

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ FAIL " + label); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, step = 250) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(step);
  }
}

(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  children.push(spawn(process.execPath, [path.join(__dirname, "..", "server", "league-server.js"), String(PORT), "--static"],
    { env: { ...process.env, HH_LEAGUE_DATA: DATA, HH_LEAGUE_TEST: "1", HH_LEAGUE_PORT: String(PORT), HH_STATIC: "1" }, stdio: "ignore" }));
  await sleep(1200);

  const browser = await chromium.launch({ headless: true });
  children.push({ kill: () => browser.close().catch(() => {}) });
  const mk = async () => {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.on("dialog", d => d.dismiss().catch(() => {}));
    const errs = [];
    page.on("pageerror", e => errs.push(String(e.message).slice(0, 140)));
    return { page, errs };
  };
  const A = await mk(), B = await mk();

  // ── A: create the league through the UI ────────────────────────────────────
  console.log("— commissioner creates via the ONLINE LEAGUE card —");
  await A.page.goto(`http://127.0.0.1:${PORT}/play.html`, { waitUntil: "domcontentloaded" });
  await A.page.waitForTimeout(1400);
  await A.page.evaluate(() => { localStorage.clear(); renderFrnStartScreen(); });
  const cardUp = await A.page.evaluate(() => {
    const btn = [...document.querySelectorAll(".fps-start")].find(b => /ONLINE LEAGUE/.test(b.textContent));
    if (btn) btn.click();
    return !!btn;
  });
  ok(cardUp, "start screen offers the ONLINE LEAGUE card");
  await A.page.waitForTimeout(400);
  await A.page.evaluate((port) => {
    document.getElementById("lgName").value = "Probe Bowl";
    document.getElementById("lgGm").value = "Commish";
    document.getElementById("lgBase").value = `http://127.0.0.1:${port}`;
    document.getElementById("lgClock").value = "0";
    frnLeagueCreateSubmit();
  }, PORT);
  const lobbyA = await until(() => A.page.evaluate(() =>
    /LOBBY/.test(document.body.textContent) && !!document.getElementById("lgShare")), 8000);
  ok(!!lobbyA, "create → commissioner lands in the lobby");
  const invite = await A.page.evaluate(() => document.getElementById("lgShare").value);
  ok(/#league=[a-z0-9]+\./.test(invite), `lobby shows the invite link (${invite.slice(invite.indexOf("#"))})`);

  // ── B: join via the deep link ───────────────────────────────────────────────
  console.log("— member joins via the #league= deep link —");
  await B.page.goto(invite.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${PORT}`), { waitUntil: "domcontentloaded" });
  await B.page.waitForTimeout(1600);
  const joinUp = await until(() => B.page.evaluate(() =>
    /JOIN/.test(document.body.textContent) && document.querySelectorAll(".fps-start").length >= 30), 8000);
  ok(!!joinUp, "deep link opens the claim-a-team screen");
  await B.page.evaluate(() => {
    document.getElementById("lgGm").value = "GM Bo";
    const free = [...document.querySelectorAll(".fps-start")].find(b => !b.disabled && /Claim/.test(b.textContent));
    free.click();
  });
  const lobbyB = await until(() => B.page.evaluate(() => /LOBBY/.test(document.body.textContent)), 8000);
  ok(!!lobbyB, "member lands in the lobby after claiming a team");
  const sseSaw = await until(() => A.page.evaluate(() =>
    (document.body.textContent.match(/GM Bo/) || []).length > 0), 6000);
  ok(!!sseSaw, "commissioner's lobby shows the new GM live (SSE member_joined)");

  // ── A starts → both enter the draft room ───────────────────────────────────
  console.log("— commissioner starts draft night —");
  await A.page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(b => /Start the league/.test(b.textContent));
    btn.click();
  });
  const roomA = await until(() => A.page.evaluate(() => /DRAFT · ROUND/.test(document.body.textContent)), 15000);
  const roomB = await until(() => B.page.evaluate(() => /DRAFT · ROUND/.test(document.body.textContent)), 15000);
  ok(!!roomA, "commissioner's draft room is live");
  ok(!!roomB, "member's draft room is live (SSE draft_started)");

  // ── the on-clock human picks; the other browser sees it over SSE ───────────
  const who = await A.page.evaluate(() => ({ onClock: _fdOnClock(_lgSt, _lgSt.pickIdx), a: _lg.teamId }));
  const picker = who.onClock === who.a ? A : B;
  const watcher = picker === A ? B : A;
  const tapeBefore = await watcher.page.evaluate(() => _lgDraft.tape.length);
  const picked = await picker.page.evaluate(async () => {
    const st = _lgSt;
    const p = st.pool.find(q => !st.taken.has(q.pid) && _fdLegal(st, _lg.teamId, q.position));
    await frnLeaguePick(p.pid);
    return { pid: p.pid, name: p.name, mine: _lgSt.rosters[_lg.teamId].length };
  });
  ok(picked.mine >= 1, `on-clock GM drafted ${picked.name} through the UI`);
  const sawPick = await until(() => watcher.page.evaluate((n) => _lgDraft.tape.length > n, tapeBefore), 8000);
  ok(!!sawPick, "the OTHER browser received the pick over SSE");

  // ── commissioner arms a tiny clock → draft finishes unattended ─────────────
  console.log("— pick clock runs the rest of draft night —");
  await A.page.evaluate(async () => {
    await fetch(_lg.base + "/api/league/settings", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leagueId: _lg.leagueId, adminToken: _lg.adminToken, rosterMode: "fantasy_draft", draftRounds: 12, pickClockMs: 60 }) });
  });
  const doneA = await until(() => A.page.evaluate(() => /DRAFT COMPLETE/.test(document.body.textContent)), 60000, 500);
  const doneB = await until(() => B.page.evaluate(() => /DRAFT COMPLETE/.test(document.body.textContent)), 20000, 500);
  ok(!!doneA && !!doneB, "both clients reach DRAFT COMPLETE");
  const verA = await until(() => A.page.evaluate(() => /VERIFIED/.test(document.body.textContent)), 15000, 500);
  const verB = await until(() => B.page.evaluate(() => /VERIFIED/.test(document.body.textContent)), 15000, 500);
  ok(!!verA, "commissioner's client independently VERIFIED the result hash");
  ok(!!verB, "member's client independently VERIFIED the result hash");

  // ── both start local franchises → identical league across browsers ─────────
  console.log("— every member derives the identical league —");
  for (const C of [A, B]) {
    await C.page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find(b => /Start my franchise/.test(b.textContent));
      btn.click();
    });
  }
  const preA = await until(() => A.page.evaluate(() => typeof franchise !== "undefined" && franchise && franchise.phase === "preseason"), 30000, 500);
  const preB = await until(() => B.page.evaluate(() => typeof franchise !== "undefined" && franchise && franchise.phase === "preseason"), 30000, 500);
  ok(!!preA && !!preB, "both members land in preseason with a drafted franchise");
  const teams = await A.page.evaluate(() => ({ mine: franchise.chosenTeamId, sample: franchise.fantasyDraft.order[0] }));
  const rosterA = await A.page.evaluate((t) => (franchise.rosters[t] || []).map(p => p.pid).join(","), teams.sample);
  const rosterB = await B.page.evaluate((t) => (franchise.rosters[t] || []).map(p => p.pid).join(","), teams.sample);
  ok(rosterA.length > 0 && rosterA === rosterB, "sample team's roster is PID-IDENTICAL across both browsers");
  const sizesOk = await A.page.evaluate(() => Object.values(franchise.rosters).every(r => r.length >= 45));
  ok(sizesOk, "all 32 rosters populated (PS seeding may trim below 51)");
  const contractsOk = await A.page.evaluate(() =>
    Object.values(franchise.rosters).every(r => r.every(p => p.contract && p.contract.aav > 0)));
  ok(contractsOk, "every drafted player is signed");

  // ── M2: DEFAULT league — one shared, server-simmed season ─────────────────
  console.log("— default league: canonical rosters + the shared season —");
  await A.page.evaluate(() => { localStorage.clear(); renderFrnStartScreen(); });
  await A.page.evaluate((port) => {
    const btn = [...document.querySelectorAll(".fps-start")].find(b => /ONLINE LEAGUE/.test(b.textContent));
    btn.click();
  }, PORT);
  await A.page.waitForTimeout(400);
  await A.page.evaluate((port) => {
    _lgSetCreateFantasy(false);   // default rosters
    document.getElementById("lgName").value = "Season Bowl";
    document.getElementById("lgGm").value = "Commish";
    document.getElementById("lgBase").value = `http://127.0.0.1:${port}`;
    frnLeagueCreateSubmit();
  }, PORT);
  const lobby2 = await until(() => A.page.evaluate(() =>
    /LOBBY/.test(document.body.textContent) && !!document.getElementById("lgShare")), 8000);
  ok(!!lobby2, "default-league create → lobby");
  // M3: shrink the regular season to ONE week (test-gated setting, allowed
  // only while the lobby is open) so the scene reaches the playoffs fast.
  await A.page.evaluate(async () => {
    await fetch(_lg.base + "/api/league/settings", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leagueId: _lg.leagueId, adminToken: _lg.adminToken, seasonWeeks: 1 }) });
  });
  const invite2 = await A.page.evaluate(() => document.getElementById("lgShare").value);
  await B.page.evaluate(() => localStorage.clear());
  // B is already on play.html — a goto that only changes the #league= hash is
  // a same-document navigation (no reload, no boot join hook). Detour through
  // about:blank to force a REAL load of the invite link.
  await B.page.goto("about:blank");
  await B.page.goto(invite2.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${PORT}`), { waitUntil: "domcontentloaded" });
  await B.page.waitForTimeout(1600);
  await until(() => B.page.evaluate(() => document.querySelectorAll(".fps-start").length >= 30), 8000);
  await B.page.evaluate(() => {
    document.getElementById("lgGm").value = "GM Sky";
    [...document.querySelectorAll(".fps-start")].find(b => !b.disabled && /Claim/.test(b.textContent)).click();
  });
  await until(() => B.page.evaluate(() => /LOBBY/.test(document.body.textContent)), 8000);

  await A.page.evaluate(() => {
    [...document.querySelectorAll("button")].find(b => /Start the league/.test(b.textContent)).click();
  });
  const seasonA = await until(() => A.page.evaluate(() => /SEASON 1 · WEEK 1/.test(document.body.textContent)), 15000);
  const seasonB = await until(() => B.page.evaluate(() => /SEASON 1 · WEEK 1/.test(document.body.textContent)), 15000);
  ok(!!seasonA, "commissioner lands on the SEASON screen (default league goes straight to active)");
  ok(!!seasonB, "member follows over SSE 'started' into the season screen");
  const verSA = await until(() => A.page.evaluate(() => /ROSTERS VERIFIED/.test(document.body.textContent)), 20000, 500);
  const verSB = await until(() => B.page.evaluate(() => /ROSTERS VERIFIED/.test(document.body.textContent)), 20000, 500);
  ok(!!verSA, "commissioner's client re-derived the 32 canonical rosters → VERIFIED");
  ok(!!verSB, "member's client re-derived the 32 canonical rosters → VERIFIED");

  console.log("— commissioner advances: the server sims the week for everyone —");
  await A.page.evaluate(() => {
    [...document.querySelectorAll("button")].find(b => /Advance — sim week/.test(b.textContent)).click();
  });
  const resA = await until(() => A.page.evaluate(() => /WEEK 1 RESULTS/.test(document.body.textContent)), 25000, 500);
  const resB = await until(() => B.page.evaluate(() => /WEEK 1 RESULTS/.test(document.body.textContent)), 25000, 500);
  ok(!!resA, "results render for the commissioner after the sim");
  ok(!!resB, "results arrive at the member over SSE week_results");
  const standingsLive = await A.page.evaluate(() =>
    /REGULAR SEASON COMPLETE/.test(document.body.textContent) && /1-0/.test(document.body.textContent));
  ok(standingsLive, "1-week season completes with 1-0 standings (M3 fast path)");

  console.log("— M3: the commissioner drives the bracket to a champion —");
  for (const roundBtn of [/Seed the bracket/, /Sim the Divisional/, /Sim the Conference/, /Sim the Super Bowl/]) {
    const clicked = await until(() => A.page.evaluate((src) => {
      const b = [...document.querySelectorAll("button")].find(x => new RegExp(src).test(x.textContent) && !x.disabled);
      if (b) { b.click(); return true; }
      return false;
    }, roundBtn.source), 20000, 400);
    ok(!!clicked, `round button found + clicked (${roundBtn.source.slice(0, 24)}…)`);
  }
  const champA = await until(() => A.page.evaluate(() => /CHAMPIONS —/.test(document.body.textContent)), 25000, 500);
  const champB = await until(() => B.page.evaluate(() => /CHAMPIONS —/.test(document.body.textContent)), 25000, 500);
  ok(!!champA, "commissioner sees the champion banner");
  ok(!!champB, "member sees the champion over SSE playoff_results");
  const bracketB = await B.page.evaluate(() =>
    /Wild Card/.test(document.body.textContent) && /Super Bowl/.test(document.body.textContent));
  ok(bracketB, "member's bracket shows all four rounds");

  console.log("— M3: rollover into season 2 —");
  await A.page.evaluate(() => {
    [...document.querySelectorAll("button")].find(x => /Start season 2/.test(x.textContent)).click();
  });
  const s2A = await until(() => A.page.evaluate(() => /SEASON 2 · WEEK 1/.test(document.body.textContent)), 20000, 500);
  const s2B = await until(() => B.page.evaluate(() => /SEASON 2 · WEEK 1/.test(document.body.textContent)), 20000, 500);
  ok(!!s2A && !!s2B, "both browsers land in SEASON 2 · WEEK 1 (rollover over SSE)");
  const verStill = await A.page.evaluate(() => /ROSTERS VERIFIED/.test(document.body.textContent));
  ok(verStill, "roster genesis still VERIFIED after rollover (same leagueSeed)");

  console.log("— both members derive the identical default league locally —");
  for (const C of [A, B]) {
    await C.page.evaluate(() => {
      [...document.querySelectorAll("button")].find(b => /Start my franchise from this league/.test(b.textContent)).click();
    });
  }
  const preA2 = await until(() => A.page.evaluate(() => typeof franchise !== "undefined" && franchise && franchise.phase === "preseason"), 30000, 500);
  const preB2 = await until(() => B.page.evaluate(() => typeof franchise !== "undefined" && franchise && franchise.phase === "preseason"), 30000, 500);
  ok(!!preA2 && !!preB2, "both members land in preseason from the canonical league");
  const rosterA2 = await A.page.evaluate(() => (franchise.rosters[5] || []).map(p => p.pid).join(","));
  const rosterB2 = await B.page.evaluate(() => (franchise.rosters[5] || []).map(p => p.pid).join(","));
  ok(rosterA2.length > 0 && rosterA2 === rosterB2, "sample default-league roster is PID-IDENTICAL across both browsers");
  const signed2 = await A.page.evaluate(() =>
    Object.values(franchise.rosters).every(r => r.every(p => p.contract && p.contract.aav > 0)));
  ok(signed2, "every canonical-league player is signed (seeded contracts)");

  // ── M4: humanGamesH2H — a member fixture played LIVE through the real UI ──
  console.log("— M4: live league fixture — host, challenge, join, play, verified ingest —");
  const H2H_PORT = 5218;
  const H2H_DATA = path.join(os.tmpdir(), "hh-league-client-probe-h2h-" + Date.now());
  fs.mkdirSync(H2H_DATA, { recursive: true });
  children.push(spawn(process.execPath, [path.join(__dirname, "..", "server", "h2h-server.js"), String(H2H_PORT)],
    { env: { ...process.env, H2H_DATA }, stdio: "ignore" }));
  await sleep(900);
  // a fixture between the two members: the RNG-free schedule's first week-1 game
  const m4Fx = await A.page.evaluate(() => generateFranchiseSchedule().find(g => g.week === 1));
  await A.page.evaluate((port) => {
    localStorage.clear();
    localStorage.setItem("h2h_last_server", `http://127.0.0.1:${port}`);   // host-side discovery
    _lgLeaveScreens(); renderFrnStartScreen();
    [...document.querySelectorAll(".fps-start")].find(b => /ONLINE LEAGUE/.test(b.textContent)).click();
  }, H2H_PORT);
  await A.page.waitForTimeout(400);
  await A.page.evaluate(({ port, homeId }) => {
    _lgSetCreateFantasy(false);
    document.getElementById("lgName").value = "Live Fixture League";
    document.getElementById("lgGm").value = "Commish";
    document.getElementById("lgTeam").value = String(homeId);   // the fixture's HOME seat
    document.getElementById("lgH2H").checked = true;            // 🎮 head-to-head fixtures
    document.getElementById("lgBase").value = `http://127.0.0.1:${port}`;
    frnLeagueCreateSubmit();
  }, { port: PORT, homeId: m4Fx.homeId });
  ok(!!(await until(() => A.page.evaluate(() => /LOBBY/.test(document.body.textContent) && !!document.getElementById("lgShare")), 8000)),
    "h2h-fixtures league created (checkbox → settings)");
  const m4Invite = await A.page.evaluate(() => document.getElementById("lgShare").value);
  const m4AwayName = await A.page.evaluate((id) => { const t = TEAMS.find(x => x.id === id); return t.city + " " + t.name; }, m4Fx.awayId);
  await B.page.evaluate(() => localStorage.clear());
  await B.page.goto("about:blank");
  await B.page.goto(m4Invite.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${PORT}`), { waitUntil: "domcontentloaded" });
  await B.page.waitForTimeout(1600);
  await until(() => B.page.evaluate(() => document.querySelectorAll(".fps-start").length >= 30), 8000);
  await B.page.evaluate((teamName) => {
    document.getElementById("lgGm").value = "GM Rival";
    [...document.querySelectorAll(".fps-start")].find(b => !b.disabled && b.textContent.includes(teamName)).click();
  }, m4AwayName);
  await until(() => B.page.evaluate(() => /LOBBY/.test(document.body.textContent)), 8000);
  await A.page.evaluate(() => {
    [...document.querySelectorAll("button")].find(b => /Start the league/.test(b.textContent)).click();
  });
  await until(() => B.page.evaluate(() => /SEASON 1 · WEEK 1/.test(document.body.textContent)), 15000);
  await A.page.evaluate(() => {
    [...document.querySelectorAll("button")].find(b => /Advance — sim week/.test(b.textContent)).click();
  });
  const m4CardA = await until(() => A.page.evaluate(() =>
    /LIVE FIXTURES — WEEK 1/.test(document.body.textContent)
    && [...document.querySelectorAll("button")].some(b => /Host this fixture live/.test(b.textContent))), 30000, 500);
  ok(!!m4CardA, "advance holds the fixture: HOME member sees the host card");
  const m4CardB = await until(() => B.page.evaluate(() =>
    /LIVE FIXTURES — WEEK 1/.test(document.body.textContent) && /your opponent hosts/.test(document.body.textContent)), 15000, 500);
  ok(!!m4CardB, "AWAY member sees the fixture waiting on the host (over SSE week_partial)");
  await A.page.evaluate(() => {
    [...document.querySelectorAll("button")].find(b => /Host this fixture live/.test(b.textContent)).click();
  });
  const m4HostIn = await until(() => A.page.evaluate(() =>
    _h2h && _h2h.matchId && document.getElementById("playbackControls")?.style.display === "flex"), 20000, 500);
  ok(!!m4HostIn, "host lands in the live-game screen (match created, seed-bound)");
  await A.page.evaluate(() => { _ipc.coachMode = true; if (_ipc.pending) _h2hSubmitCall(null); });
  const m4JoinBtn = await until(() => B.page.evaluate(() =>
    [...document.querySelectorAll("button")].some(b => /Join the live match/.test(b.textContent))), 15000, 500);
  ok(!!m4JoinBtn, "opponent's JOIN button appears over league SSE h2h_challenge");
  await B.page.evaluate(() => {
    [...document.querySelectorAll("button")].find(b => /Join the live match/.test(b.textContent)).click();
  });
  const m4JoinIn = await until(() => B.page.evaluate(() =>
    _h2h && _h2h.matchId && document.getElementById("playbackControls")?.style.display === "flex"), 20000, 500);
  ok(!!m4JoinIn, "opponent joins with the canonical roster and enters the match");
  await B.page.evaluate(() => { _ipc.coachMode = true; if (_ipc.pending) _h2hSubmitCall(null); });
  // coach mode auto-answers every prompt — the match runs to FINAL unattended
  const m4FinA = await until(() => A.page.evaluate(() => _ipc && _ipc.status === "final"), 240000, 1000);
  const m4FinB = await until(() => B.page.evaluate(() => _ipc && _ipc.status === "final"), 30000, 1000);
  ok(!!m4FinA && !!m4FinB, "live match reaches FINAL in both browsers (coach-mode autoplay)");
  // at FINAL both clients auto-fetch the artifact and submit — propose + confirm
  const m4Closed = await until(() => A.page.evaluate(() =>
    _lgSeason && !_lgSeason.pendingWeek && (_lgSeason.results[1] || []).length === 16), 30000, 500);
  ok(!!m4Closed, "both submissions land (propose + confirm) → the week closes");
  const m4Entry = await A.page.evaluate(() => (_lgSeason.results[1] || []).find(g => g.h2h === true));
  ok(!!m4Entry && Array.isArray(m4Entry.by) && m4Entry.by.length === 2 && /^[0-9a-f]{64}$/.test(m4Entry.resultHash || ""),
    "ledger entry is the VERIFIED human result with both attesters");
  await A.page.evaluate(() => {
    const fh = document.getElementById("franchiseHome"); if (fh) fh.style.display = "";
    const pc = document.getElementById("playbackControls"); if (pc) pc.style.display = "none";
    _lgEnterSeason();
  });
  const m4Season = await until(() => A.page.evaluate(() => /WEEK 1 RESULTS/.test(document.body.textContent)), 15000, 500);
  ok(!!m4Season, "season screen shows the closed week with the live result");

  ok(A.errs.length === 0, A.errs.length ? "A page errors: " + A.errs.slice(0, 3).join(" | ") : "zero page errors (commissioner)");
  ok(B.errs.length === 0, B.errs.length ? "B page errors: " + B.errs.slice(0, 3).join(" | ") : "zero page errors (member)");

  console.log(fail === 0 ? `\nALL-PASS (${pass} checks)` : `\n${fail} FAILURES / ${pass + fail}`);
  await browser.close();
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("LEAGUE-CLIENT PROBE CRASH:", e); process.exit(2); });
