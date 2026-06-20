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
// PATH-SHAPE LOOP class thresholds (the "#27 ran a big loop" family the
// magnitude/runaway classes miss). A real loop WINDS a full turn around its
// own centroid, spans a real radius, and is FAT (round, not a thin sliver).
// The DEFENSE-side count is the bug signal; offensive route+YAC loops are
// legit. See the loop block below for the full rationale.
const LOOP_WIND_DEG = +(process.env.LOOP_WIND ?? 330);   // ≈ one full revolution AROUND the path centroid (330 not 360: a genuine single loop sampled discretely lands ~354°, and a route break only winds ~180°, so 330 catches one full loop with margin while staying clear of breaks)
const LOOP_MIN_PATH_YD = 12;   // real traversal, so parked-pose jitter can't trip it
const LOOP_MIN_RG_YD = +(process.env.LOOP_MIN_RG ?? 5);  // loop spans a real area (Rg ≈ radius)
const LOOP_MIN_MINOR_YD = +(process.env.LOOP_MIN_MINOR ?? 3);  // loop is FAT (round), not a thin out-and-back sliver

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

  const report = await page.evaluate(async ({ games, cam, MAX_YPS, TOLERANCE, PX_PER_YARD, LOOP_WIND_DEG, LOOP_MIN_PATH_YD, LOOP_MIN_RG_YD, LOOP_MIN_MINOR_YD }) => {
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
                      poss: play.poss, error: null, teleports: [], nonFinite: [], oob: [], runaway: [], loop: [] };
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
          // Dead-ball spot for the RUNAWAY class = the ball's final draw.
          let ballEnd = null;
          {
            const ballArr = series.get("BALL");
            if (ballArr && ballArr.length) {
              ballEnd = ballArr.reduce((a, b) => (b.frame >= a.frame ? b : a));
            }
          }
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
            const chain = [];
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
              chain.push(pick);
            }
            if (worst) entry.teleports.push(worst);
            // RUNAWAY class (user screenshot: post-sack defender parked at
            // the far goal line): a player who keeps SPRINTING through the
            // back stretch of the play and finishes nowhere near the dead
            // ball. Per-frame steps stay under the speed cap, the position
            // stays in bounds — both older classes miss it. lateYd = ground
            // covered after t≈55%; fromBallYd = final distance to the
            // ball's last draw.
            if (!isBall && ballEnd && chain.length >= 12) {
              const p55 = chain[Math.floor(chain.length * 0.55)];
              const pEnd = chain[chain.length - 1];
              const lateYd = Math.hypot(pEnd.x - p55.x, pEnd.y - p55.y) / PX_PER_YARD;
              const fromBallYd = Math.hypot(pEnd.x - ballEnd.x, pEnd.y - ballEnd.y) / PX_PER_YARD;
              // ≥20yd late: receivers legitimately finish routes ~16-17yd
              // past the dead ball on long completions, and those sit at
              // the threshold (wall-clock pose-sim jitter flips them run
              // to run). The bug family this class exists for (post-sack
              // hold-base compounding) measured 40-87yd.
              if (lateYd >= 20 && fromBallYd >= 24) {
                entry.runaway.push({ id, lateYd: +lateYd.toFixed(1), fromBallYd: +fromBallYd.toFixed(1),
                                     end: [Math.round(pEnd.x), Math.round(pEnd.y)] });
              }
            }
            // PATH-SHAPE LOOP class (user-reported "#27 ran a big loop"): a
            // player who traces a circular/looping path. Every per-frame step
            // is small (under the teleport cap), the player stays in bounds,
            // and it can finish near the ball — so egregious / oob / runaway
            // ALL miss it. The signal is NET ROTATION: the SIGNED frame-to-
            // frame heading change, summed. A real loop keeps turning the SAME
            // way (|Σdθ| past a full turn); legit jukes / route breaks /
            // returner cuts ALTERNATE direction and cancel to ≈0 even when the
            // total turning is large — so signed accumulation cleanly separates
            // the bug from good motion. Require real ground covered so a parked
            // leg-cycle defender's sub-yard pose jitter (random-direction, ~0
            // path) can't trip it.
            if (!isBall && chain.length >= 16) {
              // Collect the MOVING points (translation ≥ a pose-noise floor) and
              // the path length. Bridging over near-stationary frames keeps the
              // tackle/celebration freeze from injecting heading noise.
              let pathPx = 0;
              const moving = [];
              const MIN_STEP_PX = 1.5;
              for (let i = 1; i < chain.length; i++) {
                const dx = chain[i].x - chain[i - 1].x, dy = chain[i].y - chain[i - 1].y;
                const step = Math.hypot(dx, dy);
                pathPx += step;
                if (step < MIN_STEP_PX) continue;
                moving.push(chain[i]);
              }
              const pathYd = pathPx / PX_PER_YARD;
              if (moving.length >= 6 && pathYd >= LOOP_MIN_PATH_YD) {
                // Centroid + radius of gyration of the moving points.
                let cx = 0, cy = 0;
                for (const m of moving) { cx += m.x; cy += m.y; }
                cx /= moving.length; cy /= moving.length;
                let sxx = 0, syy = 0, sxy = 0;
                for (const m of moving) { const ux = m.x - cx, uy = m.y - cy; sxx += ux * ux; syy += uy * uy; sxy += ux * uy; }
                sxx /= moving.length; syy /= moving.length; sxy /= moving.length;
                const rgYd = Math.sqrt(sxx + syy) / PX_PER_YARD;
                // MINOR principal axis (smaller covariance eigenvalue): a real
                // loop is FAT (round) — both axes substantial; a thin out-and-
                // back or a straight run is long in one axis but ~0 in the other,
                // so it can wind 360° around its centroid yet isn't a loop. The
                // minor radius rejects those degenerate slivers.
                const half = (sxx + syy) / 2;
                const disc = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
                const minorRgYd = Math.sqrt(Math.max(0, half - disc)) / PX_PER_YARD;
                // WINDING NUMBER around the centroid: sum the signed angle the
                // vector (P − centroid) sweeps. This is the jitter-robust loop
                // signal — a true loop winds a full turn (≥360°) around its
                // center; a STRAIGHT run winds only ~180° (the point passes the
                // centroid once); and end-of-play tackle JITTER sits FAR from the
                // centroid so it subtends a tiny angle and barely contributes.
                // (Raw heading-change accumulation, by contrast, let a few jitter
                // frames fake a loop on an otherwise straight path.)
                let wind = 0, prevA = null;
                for (const m of moving) {
                  const a = Math.atan2(m.y - cy, m.x - cx);
                  if (prevA !== null) {
                    let d = a - prevA;
                    while (d > Math.PI) d -= 2 * Math.PI;
                    while (d < -Math.PI) d += 2 * Math.PI;
                    wind += d;
                  }
                  prevA = a;
                }
                const windDeg = Math.abs(wind) * 180 / Math.PI;
                if (windDeg >= LOOP_WIND_DEG && rgYd >= LOOP_MIN_RG_YD && minorRgYd >= LOOP_MIN_MINOR_YD) {
                  const s = chain[0], e = chain[chain.length - 1];
                  // SIDE: a name in the possessing team's offensive starters is a
                  // receiver/carrier (legit route+YAC curve); anything else is a
                  // defender/lineman — the "#27 ran a big loop" bug is a DEFENDER
                  // looping in open space, so def-side loops are the real signal.
                  const offR = gameResult[play.poss === "home" ? "homeRatings" : "awayRatings"];
                  const offNames = (offR && offR.starters) ? new Set(Object.values(offR.starters)) : null;
                  const side = (offNames && offNames.has(id.replace(/^P:/, ""))) ? "off" : "def";
                  entry.loop.push({ id, side, windDeg: Math.round(windDeg),
                                    pathYd: +pathYd.toFixed(1), rgYd: +rgYd.toFixed(1), minorRgYd: +minorRgYd.toFixed(1),
                                    netDispYd: +(Math.hypot(e.x - s.x, e.y - s.y) / PX_PER_YARD).toFixed(1),
                                    end: [Math.round(e.x), Math.round(e.y)] });
                }
              }
            }
            // V5 — OUT-OF-BOUNDS class: any position beyond the back of an
            // end zone or far past a sideline is the "sprints into the
            // stadium wall" family (user-reported) — a defect even when
            // every per-frame step stays under the teleport speed cap.
            // (The renderer now clamps these visually; this class keeps the
            // CAUSE visible with a replayable play.)
            if (!isBall) {
              let oobWorst = null;
              for (const h of arr) {
                const ex = h.x < 5 ? 5 - h.x : h.x > 1695 ? h.x - 1695 : 0;
                const ey = h.y < 5 ? 5 - h.y : h.y > 715 ? h.y - 715 : 0;
                const e = Math.max(ex, ey);
                if (e > 0 && (!oobWorst || e > oobWorst.px)) {
                  oobWorst = { id, px: Math.round(e), at: [Math.round(h.x), Math.round(h.y)], frame: h.frame };
                }
              }
              if (oobWorst) entry.oob.push(oobWorst);
            }
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
  }, { games, cam: CAM, MAX_YPS, TOLERANCE, PX_PER_YARD, LOOP_WIND_DEG, LOOP_MIN_PATH_YD, LOOP_MIN_RG_YD, LOOP_MIN_MINOR_YD });

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
  const withOob      = report.filter(r => (r.oob || []).length);
  const withRunaway  = report.filter(r => (r.runaway || []).length);
  const withLoop     = report.filter(r => (r.loop || []).length);
  // DEFENSE-side loops are the bug signal ("#27 ran a big loop"); offense-side
  // loops are legit broken-play / scramble-drill YAC circles.
  for (const r of report) {
    r.loopDef = (r.loop || []).filter(l => l.side === "def");
    r.loopOff = (r.loop || []).filter(l => l.side === "off");
  }
  const withLoopDef  = report.filter(r => r.loopDef.length);
  const withLoopOff  = report.filter(r => r.loopOff.length);
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
  console.log(` Out-of-bounds (into-the-wall) draws: ${withOob.length} plays`);
  console.log(` Runaway players (sprint late, finish far from dead ball): ${withRunaway.length} plays`);
  console.log(` Loop DEF-side (big circular defender path ≥${LOOP_WIND_DEG}° wind): ${withLoopDef.length} plays  ← the bug signal`);
  console.log(` Loop off-side (legit broken-play / YAC circles): ${withLoopOff.length} plays  (informational)`);
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
  if (withOob.length) {
    console.log("");
    console.log(" ⚠ OUT-OF-BOUNDS classes (kind/targetSlot · count · worst overshoot px):");
    for (const [k, c] of classGroups(withOob, r => r.oob.map(o => ({ ...o, dYd: o.px })))) {
      const o = c.sample.oob[0];
      console.log(`   ${k.padEnd(22)} ×${String(c.n).padStart(3)}  worst ${String(c.worst).padStart(5)}px  e.g. ${o.id} at [${o.at}]`);
    }
  }
  if (withRunaway.length) {
    console.log("");
    console.log(" ⚠ RUNAWAY classes (kind/targetSlot · count · worst late-sprint yd):");
    for (const [k, c] of classGroups(withRunaway, r => r.runaway.map(o => ({ ...o, dYd: o.lateYd })))) {
      const o = c.sample.runaway[0];
      console.log(`   ${k.padEnd(22)} ×${String(c.n).padStart(3)}  worst ${String(c.worst).padStart(5)}yd late  e.g. ${o.id} ends [${o.end}] ${o.fromBallYd}yd from ball`);
    }
  }
  if (withLoopDef.length) {
    console.log("");
    console.log(" ⚠ LOOP (DEF) classes — the bug signal (kind/targetSlot · count · worst wind°):");
    for (const [k, c] of classGroups(withLoopDef, r => r.loopDef.map(o => ({ ...o, dYd: o.windDeg })))) {
      const o = c.sample.loopDef[0];
      console.log(`   ${k.padEnd(22)} ×${String(c.n).padStart(3)}  worst ${String(c.worst).padStart(5)}°  e.g. ${o.id} wind ${o.windDeg}° Rg ${o.rgYd}yd minor ${o.minorRgYd}yd path ${o.pathYd}yd ends [${o.end}]`);
    }
  }
  if (withLoopOff.length) {
    console.log("");
    console.log(" LOOP (off) classes — informational, legit YAC/broken-play circles:");
    for (const [k, c] of classGroups(withLoopOff, r => r.loopOff.map(o => ({ ...o, dYd: o.windDeg })))) {
      const o = c.sample.loopOff[0];
      console.log(`   ${k.padEnd(22)} ×${String(c.n).padStart(3)}  worst ${String(c.worst).padStart(5)}°  e.g. ${o.id} wind ${o.windDeg}° path ${o.pathYd}yd`);
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
