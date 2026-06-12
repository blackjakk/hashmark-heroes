// _catch_matrix_probe.js — catch-variant detector (animation Phase 2).
// Loads real seeded games, finds an exemplar completion for each catch
// variant, locates the true ball-arrival tick (the catch-flash one-shot),
// and asserts the receiver's POSE TIMELINE around it via the GC_POSE_PROBE
// instrumentation in drawPlayer:
//   in_stride  — still RUNNING 3% before arrival; hands up on the final beat
//   standard   — already reaching 2.5% before arrival (the old behavior)
//   dive       — dive_forward at arrival on a zero-YAC downfield grab
//   high_point — leap pose inside the engine-flagged jump-ball window
// Also asserts the QB throw timeline (Phase 1): cocked just before release,
// EMPTY-HANDED (idle) right after — the painted-ball-through-flight bug.
//
//   node tools/_catch_matrix_probe.js        (starts its own server :5196)
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const path = require("path");
const PORT = 5196;
const children = [];
process.on("exit", () => children.forEach(c => { try { c.kill("SIGKILL"); } catch {} }));
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log("  ✓ " + l); } else { fail++; console.log("  ✗ FAIL " + l); } };
(async () => {
  children.push(spawn("npx", ["http-server", "-p", String(PORT), "-s", path.join(__dirname, "..")], { stdio: "ignore" }));
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ headless: true });
  children.push({ kill: () => browser.close().catch(() => {}) });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message).slice(0, 140)));
  await page.goto(`http://localhost:${PORT}/play.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    let s = 0xBEEF;
    Math.random = function () { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    startFranchise(1);
    franchise.phase = "regular";
    window.GC_POSE_PROBE = true;
    window._games = [];
    for (const pr of [[1, 2], [3, 4], [5, 6]]) {
      frnPlayGame(pr[0], pr[1]);
      playing = false; cancelAnimationFrame(rafId);
      window._games.push(gameResult);
    }
    // Probe helper: load play (g,i), find the arrival tick via the catch-
    // flash one-shot, then sample the named player's drawn pose at offsets.
    window._probePoses = (g, i, who, offs) => {
      gameResult = window._games[g];
      playHead = i;
      playing = true; startNextPlay();
      playing = false; cancelAnimationFrame(rafId);
      const play = gameResult.plays[i];
      const ctx = document.getElementById("field").getContext("2d");
      const renderAt = (f) => {
        window._posesThisFrame = {};
        _frameStartBroadcast(); animState.anim.render(f, ctx); _frameEndBroadcast(ctx);
        animState.slowMoUntil = 0;
      };
      let arrive = -1;
      for (let f = 0.30; f <= 0.97; f += 0.005) {
        play._catchFlashFired = false;
        renderAt(f);
        if (play._catchFlashFired) { arrive = f; break; }
      }
      play._catchFlashFired = true;
      const name = who === "receiver" ? play.receiver : play.passer;
      const out = { arrive, poses: {} };
      for (const o of offs) {
        renderAt(arrive + o);
        out.poses[o] = window._posesThisFrame[name] || "(not-drawn)";
      }
      return out;
    };
    window._findPlay = (fnSrc) => {
      const fn = eval(fnSrc);
      for (let g = 0; g < window._games.length; g++) {
        const i = window._games[g].plays.findIndex(fn);
        if (i >= 0) return { g, i, desc: window._games[g].plays[i].desc.slice(0, 58) };
      }
      return null;
    };
  });
  const probe = (pick, who, offs) => page.evaluate(
    ({ g, i, who, offs }) => window._probePoses(g, i, who, offs), { ...pick, who, offs });
  const find = (src) => page.evaluate((s) => window._findPlay(s), src);

  // ── IN-STRIDE — run until the final beat ─────────────────────────────
  const st = await find(`p => p.kind === "complete" && (p.yac ?? 0) >= 6 && !p.isLeapingCatch && !p.isScreen && (p.targetDepth ?? 0) >= 8`);
  if (st) {
    const r = await probe(st, "receiver", [-0.030, -0.002]);
    ok(r.arrive > 0, `in-stride arrival at t=${r.arrive.toFixed(2)} — ${st.desc}`);
    ok(/run|release|carry/.test(r.poses["-0.03"]), `in-stride: still RUNNING 3% out (${r.poses["-0.03"]})`);
    ok(/reach|catch|leap/.test(r.poses["-0.002"]), `in-stride: hands up on the final beat (${r.poses["-0.002"]})`);
  } else ok(false, "no in-stride exemplar in 3 games");

  // ── STANDARD — the earlier reach lead ────────────────────────────────
  const sd = await find(`p => p.kind === "complete" && (p.yac ?? 0) > 0 && (p.yac ?? 0) < 4 && !p.isLeapingCatch && !p.isScreen && (p.targetDepth ?? 0) < 18`);
  if (sd) {
    const r = await probe(sd, "receiver", [-0.020, -0.002]);
    ok(/reach|catch/.test(r.poses["-0.02"]) || /reach|catch/.test(r.poses["-0.002"]),
       `standard: reaching into arrival (${r.poses["-0.02"]} → ${r.poses["-0.002"]}) — ${sd.desc}`);
  } else ok(false, "no standard exemplar in 3 games");

  // ── DIVE — zero-YAC downfield grab lays out ──────────────────────────
  const dv = await find(`p => p.kind === "complete" && (p.yac ?? 99) === 0 && (p.targetDepth ?? 0) >= 8 && !p.isScreen && !p.isLeapingCatch`);
  if (dv) {
    const r = await probe(dv, "receiver", [-0.008]);
    // Hash-thinned to ~45% of the pool — accept dive OR reach but PRINT it.
    ok(/dive|reach|catch/.test(r.poses["-0.008"]),
       `zero-YAC arrival pose = ${r.poses["-0.008"]} — ${dv.desc}`);
  } else ok(false, "no zero-YAC exemplar in 3 games");

  // ── HIGH POINT — engine jump ball gets the leap ──────────────────────
  const hp = await find(`p => p.kind === "complete" && p.isLeapingCatch`);
  if (hp) {
    const r = await probe(hp, "receiver", [-0.020]);
    ok(/leap|reach|catch/.test(r.poses["-0.02"]), `high-point: airborne in the window (${r.poses["-0.02"]}) — ${hp.desc}`);
  } else ok(false, "no high-point exemplar in 3 games");

  // ── PHASE-1 THROW TIMELINE — cocked into release, empty after ────────
  const th = await find(`p => p.kind === "complete" && !p.isScreen && (p.targetDepth ?? 0) >= 10`);
  if (th) {
    // Release sits at tf*0.55 of action; sample QB pose well before arrival
    // (mid-windup) and just after release via a scan for the throw→idle flip.
    const flip = await page.evaluate(({ g, i }) => {
      gameResult = window._games[g];
      playHead = i;
      playing = true; startNextPlay();
      playing = false; cancelAnimationFrame(rafId);
      const play = gameResult.plays[i];
      play._catchFlashFired = true;
      const ctx = document.getElementById("field").getContext("2d");
      let sawThrow = false, flipAt = -1, after = null;
      for (let f = 0.20; f <= 0.92; f += 0.01) {
        window._posesThisFrame = {};
        _frameStartBroadcast(); animState.anim.render(f, ctx); _frameEndBroadcast(ctx);
        animState.slowMoUntil = 0;
        const qp = window._posesThisFrame[play.passer];
        if (qp === "throw") sawThrow = true;
        else if (sawThrow && flipAt < 0) { flipAt = f; after = qp; }
      }
      return { sawThrow, flipAt, after };
    }, th);
    ok(flip.sawThrow, `QB winds up in the throw pose — ${th.desc}`);
    // After release the QB is EMPTY-HANDED: either the idle fallback or
    // the dedicated throw_release art (upgrade pack / v2 manifest).
    ok(flip.flipAt > 0 && (flip.after === "idle" || flip.after === "throw_release"),
       `QB EMPTY-HANDED after release (throw → ${flip.after} at t=${flip.flipAt > 0 ? flip.flipAt.toFixed(2) : "?"}) — no painted ball through flight`);
  } else ok(false, "no throw exemplar");

  ok(errors.length === 0, errors.length ? "page errors: " + errors.join(" | ") : "zero page errors");
  console.log(fail === 0 ? `ALL-PASS (${pass} checks)` : `${fail} FAILURES`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("PROBE CRASH:", e); process.exit(2); });
