// Trace an incomplete pass — find the player who jumps at f270 and
// dump their per-frame position + role/name across the late window.
const fs = require("fs");
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
(async () => {
  const battery = JSON.parse(fs.readFileSync("/tmp/teleport_plays.json", "utf8"));
  // Pick complete/wr1 TD play — late-action jump pattern
  let game = null, play = null;
  for (const g of battery.games) for (const p of g.plays) {
    if (p.kind === "complete" && p.motion && p.motion.targetSlot === "wr1"
        && (p.endYard ?? 0) >= 100 && !play) {
      game = g; play = p;
    }
  }
  if (!play) {
    for (const g of battery.games) for (const p of g.plays) {
      if (p.kind === "complete" && p.motion && p.motion.targetSlot === "wr1" && (p.yards ?? 0) > 15) {
        game = g; play = p; break;
      }
    }
  }
  if (!play) { console.log("no incomplete play"); process.exit(1); }
  console.log("META:", JSON.stringify({ kind: play.kind, incReason: play.incReason, coverage: play.coverage, depth: play.targetDepth, yards: play.yards, poss: play.poss }));

  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on("pageerror", e => console.error("PAGEERR", e.message.slice(0, 160)));
  await page.goto("http://localhost:5173/play.html", { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(500);

  const out = await page.evaluate(({ game, play }) => {
    const REC = { frame: 0, hits: [] };
    window.drawField = window.drawRunTrail = window.drawBallTrail = window.drawGoalposts =
      window.drawStadiumGoalposts = window.drawSpriteList = window.drawFireworksShow =
      window.showCallout = window.clearCallout = window.drawTopDownGoalposts = function () {};
    window.drawPlayer = function (...a) {
      const style = a[9] || {};
      REC.hits.push({
        f: REC.frame,
        x: Math.round(a[1]), y: Math.round(a[2]),
        role: style.role, name: style.name, pose: a[6],
      });
    };
    window.drawBall = function () {};
    gameResult = {
      homeTeam: game.homeTeam, awayTeam: game.awayTeam,
      homeRatings: game.homeRatings, awayRatings: game.awayRatings,
      playerLookup: new Map(game.lookupPairs), plays: game.plays,
    };
    cameraMode = "tactical"; try { viewMode = "tactical"; } catch (e) {}
    const cctx = document.createElement("canvas").getContext("2d");
    const dtMs = 1000 / 60;
    const anim = buildAnimForPlay(play, null);
    const dur = anim.duration || 4000;
    const N = Math.max(30, Math.min(900, Math.round(dur / dtMs)));
    const _origNow = performance.now;
    let _clock = 0;
    try { performance.now = () => _clock; } catch (e) {}
    for (let f = 0; f < N; f++) {
      REC.frame = f;
      _clock = f * dtMs;
      try { anim.render(N > 1 ? f / (N - 1) : 0, cctx); } catch (e) { break; }
    }
    try { performance.now = _origNow; } catch (e) {}

    // Find largest per-frame jump across players (by name or role+x_seed)
    const byId = new Map();
    for (const h of REC.hits) {
      const id = h.name || `R:${h.role}@${h.f}`;
      const arr = byId.get(id) || [];
      arr.push(h);
      byId.set(id, arr);
    }
    let worst = null;
    for (const [id, arr] of byId) {
      const byFrame = new Map();
      for (const h of arr) { const a = byFrame.get(h.f) || []; a.push(h); byFrame.set(h.f, a); }
      const fs2 = [...byFrame.keys()].sort((a, b) => a - b);
      let prev = null;
      for (const fi of fs2) {
        const here = byFrame.get(fi);
        let pick = here[0];
        if (prev) {
          let bd = Infinity;
          for (const h of here) { const d = Math.hypot(h.x - prev.x, h.y - prev.y); if (d < bd) { bd = d; pick = h; } }
        }
        if (prev) {
          const d = Math.hypot(pick.x - prev.x, pick.y - prev.y);
          if (d > 15 && (!worst || d > worst.d)) {
            worst = { id, role: pick.role, fromF: prev.f, toF: pick.f, from: [prev.x, prev.y], to: [pick.x, pick.y], d: Math.round(d) };
          }
        }
        prev = pick;
      }
    }

    // Dump frame-by-frame around the worst jump for that player
    let trace = [];
    if (worst) {
      const arr = byId.get(worst.id);
      const span = arr.filter(h => h.f >= Math.max(0, worst.fromF - 3) && h.f <= worst.toF + 3);
      trace = span.map(h => ({ f: h.f, x: h.x, y: h.y, pose: h.pose }));
    }
    return { worst, trace, N };
  }, { game, play });

  await browser.close();

  if (!out.worst) { console.log("No worst jump found (N=" + out.N + ")"); process.exit(0); }
  console.log("WORST jump:", JSON.stringify(out.worst));
  console.log("\nframes around the jump for that player:");
  for (const t of out.trace) {
    console.log(`  f${String(t.f).padStart(3)}  pose=${t.pose}  (${t.x}, ${t.y})`);
  }
})();
