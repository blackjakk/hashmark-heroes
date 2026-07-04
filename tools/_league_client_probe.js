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

  ok(A.errs.length === 0, A.errs.length ? "A page errors: " + A.errs.slice(0, 3).join(" | ") : "zero page errors (commissioner)");
  ok(B.errs.length === 0, B.errs.length ? "B page errors: " + B.errs.slice(0, 3).join(" | ") : "zero page errors (member)");

  console.log(fail === 0 ? `\nALL-PASS (${pass} checks)` : `\n${fail} FAILURES / ${pass + fail}`);
  await browser.close();
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("LEAGUE-CLIENT PROBE CRASH:", e); process.exit(2); });
