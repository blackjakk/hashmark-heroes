// _teleport_detect.js — Stage 0 (detect phase) of the position-contract
// refactor. Loads the REAL renderer in headless Chromium, replays each captured
// play through buildAnimForPlay, and flags any player whose per-frame position
// jump exceeds a physical speed cap — i.e. a teleport. Converts "found by user
// report" into "found by tooling."
//
//   Prereq: capture battery + dev server on :5173
//     node _teleport_capture.js 6
//     nohup npx http-server -p 5173 -c-1 -s . > /tmp/dev-server.log 2>&1 &
//
//   Usage:  node _teleport_detect.js [cam]      cam = broadcast (default) | tactical
//   Output: console report; /tmp/teleport_report.json
//
// Method: scripts load as classic <script> (no modules), so buildAnimForPlay /
// drawPlayer / drawBall are global functions. We monkeypatch the two draws to
// record (entity, x, y) per frame, stub the visual-only draws to no-ops, then
// step render(t) over a frame grid. Real render path, no canvas-stub drift.
const fs = require("fs");
// Resolve Playwright portably: explicit env override (CI) → normal module
// resolution (local/global install) → this environment's hardcoded path
// (kept as the fallback so nothing changes here).
const PW_LIB = (() => {
  if (process.env.PLAYWRIGHT_LIB) return process.env.PLAYWRIGHT_LIB;
  try { require.resolve("playwright"); return "playwright"; } catch (e) {}
  return "/opt/node22/lib/node_modules/playwright";
})();
const { chromium } = require(PW_LIB);

const URL = "http://localhost:5173/play.html";
const CAM = process.argv[2] || "broadcast";
// Sampling is native 60fps per play (computed per-play from anim.duration).
const MAX_YPS = 13;            // visual top speed in the engine (10.5–13)
const TOLERANCE = 1.7;        // slack so legit cuts/accel don't false-positive
const PX_PER_YARD = 15;

// Field-action kinds that drive the main field render. Non-field UI plays
// (penalty cards, clock stoppages, HC decisions) have no player motion.
const FIELD_KINDS = new Set([
  "run", "complete", "incomplete", "int", "sack", "scramble", "screen",
  "fg_good", "fg_miss", "fg_blocked", "punt", "kickoff", "fumble", "score",
  "two_point", "kneel", "spike",
]);

(async () => {
  const battery = JSON.parse(fs.readFileSync("/tmp/teleport_plays.json", "utf8"));
  // Keep field-action plays; carry each play's source-game context with it.
  const games = battery.games.map(g => ({
    ...g, plays: g.plays.filter(p => FIELD_KINDS.has(p.kind)),
  })).filter(g => g.plays.length);
  const totalPlays = games.reduce((n, g) => n + g.plays.length, 0);
  console.log(`Replaying ${totalPlays} field-action plays across ${games.length} games · cam=${CAM} · native 60fps sampling`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(e.message.slice(0, 160)));
  await page.goto(URL, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(600);

  const report = await page.evaluate(async ({ games, cam, MAX_YPS, TOLERANCE, PX_PER_YARD }) => {
    // ── Install instrumentation. drawPlayer/drawBall are global functions;
    // reassigning the global is picked up by buildAnimForPlay's by-name calls. ──
    const REC = { frame: 0, hits: [], nonFinite: new Set() };   // hits: {id,x,y,frame}; nonFinite: ids drawn at NaN/∞
    const ORIG = {};
    const NAMES = ["drawPlayer", "drawBall", "drawField", "drawPlayers",
      "drawRunTrail", "drawBallTrail", "drawGoalposts", "drawStadiumGoalposts",
      "drawSpriteList", "drawCinemaField", "drawTopDownGoalposts",
      "drawFireworksShow", "showCallout", "clearCallout", "drawPortraitPopup"];
    for (const n of NAMES) ORIG[n] = (typeof window[n] === "function") ? window[n] : null;

    const recordPlayer = (args) => {
      // drawPlayer(ctx, x, y, color, secondary, label, pose, t, facing, style)
      //            args[0] args[1] args[2] ...                        args[9]
      const x = args[1], y = args[2], style = args[9] || {};
      const id = style.name || style.role || "?";
      if (typeof x === "number" && typeof y === "number" && isFinite(x) && isFinite(y))
        REC.hits.push({ id: "P:" + id, x, y, frame: REC.frame });
      else
        // A non-finite position vanishes the sprite (or pins it to the origin) —
        // as much a defect as a teleport. Track it as a first-class failure.
        REC.nonFinite.add("P:" + id);
    };
    const recordBall = (args) => {
      const x = args[1], y = args[2];
      if (typeof x === "number" && typeof y === "number" && isFinite(x) && isFinite(y))
        REC.hits.push({ id: "BALL", x, y, frame: REC.frame });
    };

    const install = () => {
      // Stub the visual-only draws to no-ops to avoid missing-global errors,
      // but keep drawPlayer/drawBall as RECORDERS. drawPlayers is left as the
      // original so it still calls (our patched) drawPlayer internally.
      window.drawPlayer = function (...a) { recordPlayer(a); };
      window.drawBall = function (...a) { recordBall(a); };
      for (const n of NAMES) {
        if (n === "drawPlayer" || n === "drawBall" || n === "drawPlayers") continue;
        window[n] = function () {};
      }
    };
    const restore = () => { for (const n of NAMES) if (ORIG[n]) window[n] = ORIG[n]; };

    // cameraMode / viewMode are top-level `let`s in script scope (NOT on
    // window) — assign by BARE NAME so it resolves up the scope chain to the
    // let binding (same gotcha as `franchise`). window.x = … silently misses.
    cameraMode = cam;
    try { viewMode = "tactical"; } catch (e) {}

    // Offscreen canvas — drawPlayer/drawBall are stubbed so ctx is barely used,
    // but buildAnimForPlay's render(t, ctx) signature needs one.
    const cv = document.createElement("canvas"); cv.width = 1700; cv.height = 720;
    const cctx = cv.getContext("2d");

    const out = [];
    for (const game of games) {
     // gameResult is a script-scoped `let` — assign by bare name. Rebuild the
     // playerLookup Map from the serialized entry pairs.
     gameResult = {
       homeTeam: game.homeTeam, awayTeam: game.awayTeam,
       homeRatings: game.homeRatings, awayRatings: game.awayRatings,
       playerLookup: new Map(game.lookupPairs),
       plays: game.plays,
     };
     let prevPlay = null;
     for (const play of game.plays) {
      const entry = { kind: play.kind, slot: (play.motion && play.motion.targetSlot) || null,
                      concept: play.concept || null, coverage: play.coverage || null,
                      poss: play.poss, error: null, teleports: [], nonFinite: [] };
      install();
      REC.hits.length = 0;
      REC.nonFinite.clear();
      try {
        const anim = (typeof buildAnimForPlay === "function")
          ? buildAnimForPlay(play, prevPlay) : null;
        if (!anim || typeof anim.render !== "function") { entry.error = "no-render"; }
        else {
          const dur = anim.duration || 3000;
          // FIDELITY: sample at native ~60fps (the real raf cadence), NOT a few
          // coarse steps — coarse sampling turns continuous fast motion into
          // fake "jumps". AND drive a CONTROLLED CLOCK: the post-catch sims
          // (_wrSim, pursuit) integrate on performance.now() wall-clock; in a
          // tight replay loop that's ~0 so they'd freeze, and a frozen sim
          // handing off to a moving branch manufactures a phantom teleport.
          // Advancing performance.now() by the play-time dt makes them step
          // exactly as they do live.
          const dtMs = 1000 / 60;
          const N = Math.max(30, Math.min(900, Math.round(dur / dtMs)));
          const _origNow = performance.now;
          let _clock = 0;
          try { performance.now = () => _clock; } catch (e) {}
          for (let f = 0; f < N; f++) {
            REC.frame = f;
            _clock = f * dtMs;
            const t = N > 1 ? f / (N - 1) : 0;
            try { anim.render(t, cctx); }
            catch (e) { entry.error = "render@" + f + ":" + (e.message || e).slice(0, 80); break; }
          }
          try { performance.now = _origNow; } catch (e) {}
          entry.frames = N;
          // Build per-entity series.
          const series = new Map();
          for (const h of REC.hits) {
            const arr = series.get(h.id) || []; arr.push(h); series.set(h.id, arr);
          }
          // Player cap at native dt; the BALL flies fast (own high cap). Add an
          // absolute floor so micro easing-glitches don't register — a true
          // teleport is a discontinuity of several yards in one ~16ms frame.
          const playerCap = Math.max(MAX_YPS * (dtMs / 1000) * TOLERANCE, 0);
          const ballCap   = 90 * (dtMs / 1000);
          const ABS_FLOOR_YD = 2.0;
          for (const [id, arr] of series) {
            const isBall = id === "BALL";
            const cap = isBall ? ballCap : playerCap;
            // Multi-draw-per-frame: an entity can be drawn more than once a
            // frame (carrier + celebrant). Chain by CONTINUITY — each frame pick
            // the draw closest to the running position — so a transient 2nd draw
            // doesn't fake an oscillation. Also note the max intra-frame spread.
            const byFrame = new Map();
            for (const h of arr) { const a = byFrame.get(h.frame) || []; a.push(h); byFrame.set(h.frame, a); }
            const frames = [...byFrame.keys()].sort((a, b) => a - b);
            let worst = null, running = null;
            for (let i = 0; i < frames.length; i++) {
              const cands = byFrame.get(frames[i]);
              let pick = cands[0];
              if (running) {
                let bd = Infinity;
                for (const c of cands) { const d = Math.hypot(c.x - running.x, c.y - running.y); if (d < bd) { bd = d; pick = c; } }
              }
              if (running) {
                const gap = frames[i] - frames[i - 1];
                const dYd = Math.hypot(pick.x - running.x, pick.y - running.y) / PX_PER_YARD;
                const allow = Math.max(cap * gap, ABS_FLOOR_YD);
                if (dYd > allow && (!worst || dYd > worst.dYd)) {
                  worst = { id, isBall, fromFrame: frames[i - 1], toFrame: frames[i],
                            dYd: +dYd.toFixed(1), allowYd: +allow.toFixed(1),
                            from: [Math.round(running.x), Math.round(running.y)],
                            to: [Math.round(pick.x), Math.round(pick.y)] };
                }
              }
              running = pick;
            }
            if (worst) entry.teleports.push(worst);
          }
          entry.teleports.sort((a, b) => b.dYd - a.dYd);
          entry.nonFinite = [...REC.nonFinite];
        }
      } catch (e) {
        entry.error = "build:" + (e.message || e).slice(0, 100);
      } finally {
        restore();
      }
      out.push(entry);
      prevPlay = play;
     }
    }
    return out;
  }, { games, cam: CAM, MAX_YPS, TOLERANCE, PX_PER_YARD });

  await browser.close();

  // ── Report ── PLAYER teleports are the headline (the bug family we're
  // closing); BALL jumps are tracked separately under a high flight cap.
  const EGREGIOUS_YD = 6;   // a true teleport is several yards in one ~16ms frame
  for (const r of report) {
    r.playerTp = r.teleports.filter(t => !t.isBall);
    r.ballTp   = r.teleports.filter(t => t.isBall);
    r.egregious = r.playerTp.filter(t => t.dYd >= EGREGIOUS_YD);
  }
  const withEgregious = report.filter(r => r.egregious.length);
  const withPlayerTp = report.filter(r => r.playerTp.length);
  const withBallTp   = report.filter(r => r.ballTp.length);
  const withNonFin   = report.filter(r => (r.nonFinite || []).length);
  const withErr      = report.filter(r => r.error);
  fs.writeFileSync("/tmp/teleport_report.json", JSON.stringify(report, null, 1));

  const classGroups = (rows, pick) => {
    const m = new Map();
    for (const r of rows) {
      const k = `${r.kind}/${r.slot || "-"}`;
      const c = m.get(k) || { n: 0, worst: 0, sample: null };
      c.n++;
      const w = pick(r)[0].dYd;
      if (w > c.worst) { c.worst = w; c.sample = r; }
      m.set(k, c);
    }
    return [...m.entries()].sort((a, b) => b[1].worst - a[1].worst);
  };

  console.log("");
  console.log("════════════════════════════════════════════════════════════");
  console.log(` TELEPORT DETECTOR — ${report.length} plays · cam=${CAM}`);
  console.log("════════════════════════════════════════════════════════════");
  console.log(` EGREGIOUS player teleports (≥${EGREGIOUS_YD}yd/frame): ${withEgregious.length} plays  ← the real signal`);
  console.log(` All player flags (incl. borderline near cap):        ${withPlayerTp.length} plays`);
  console.log(` Non-finite (vanished) player draws: ${withNonFin.length} plays`);
  console.log(` Ball anomalies:   ${withBallTp.length} plays  (>90yps flight cap)`);
  console.log(` Render/build errors: ${withErr.length} plays`);
  if (pageErrors.length) console.log(` Page errors: ${pageErrors.length} (e.g. ${pageErrors[0]})`);
  console.log("");

  if (withEgregious.length) {
    console.log(` ⚠ EGREGIOUS teleport classes (kind/targetSlot · count · worst jump):`);
    for (const [k, c] of classGroups(withEgregious, r => r.egregious)) {
      const t = c.sample.egregious[0];
      console.log(`   ${k.padEnd(22)} ×${String(c.n).padStart(3)}  worst ${String(c.worst).padStart(5)}yd ` +
        `(${t.id} f${t.fromFrame}→${t.toFrame}: ${t.from}→${t.to}, allowed ${t.allowYd}yd)`);
    }
  } else {
    console.log(" ✓ No EGREGIOUS player teleports.");
  }
  if (withPlayerTp.length > withEgregious.length) {
    console.log("");
    console.log(` Borderline player-flag classes (just over cap — likely fast legit motion):`);
    const borderline = report.filter(r => r.playerTp.length && !r.egregious.length);
    for (const [k, c] of classGroups(borderline, r => r.playerTp).slice(0, 8)) {
      console.log(`   ${k.padEnd(22)} ×${String(c.n).padStart(3)}  worst ${String(c.worst).padStart(5)}yd`);
    }
  }

  if (withBallTp.length) {
    console.log("");
    console.log(" Ball anomaly classes (informational — flight is legitimately fast):");
    for (const [k, c] of classGroups(withBallTp, r => r.ballTp).slice(0, 8)) {
      const t = c.sample.ballTp[0];
      console.log(`   ${k.padEnd(22)} ×${String(c.n).padStart(3)}  worst ${String(c.worst).padStart(5)}yd`);
    }
  }
  if (withErr.length) {
    console.log("");
    console.log(" Render/build errors (first 10):");
    for (const r of withErr.slice(0, 10))
      console.log(`   ${r.kind}/${r.slot || "-"}: ${r.error}`);
  }
  console.log("");
  console.log(" Full detail → /tmp/teleport_report.json");
})();
