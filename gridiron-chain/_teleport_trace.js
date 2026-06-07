// One-off tracer: dump the per-frame (x,y) series for the RB target and the
// BALL on the first complete/rb play, so we can SEE where a discontinuity is.
const fs = require("fs");
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
(async () => {
  const battery = JSON.parse(fs.readFileSync("/tmp/teleport_plays.json", "utf8"));
  // Pick the worst-case rb checkdown: targetSlot=rb, low targetDepth (≤3 → the
  // wide-swing override path where the backfield-frame bug lives), max YAC.
  let game = null, play = null, best = -1;
  for (const g of battery.games) for (const p of g.plays) {
    if (p.kind === "complete" && p.motion && p.motion.targetSlot === "rb"
        && (p.targetDepth ?? 99) <= 3) {
      const yac = p.yac ?? ((p.yards ?? 0) - (p.catchDepth ?? 0));
      if (yac > best) { best = yac; game = g; play = p; }
    }
  }
  if (!play) {  // fallback: any rb completion with the most yards
    for (const g of battery.games) for (const p of g.plays) {
      if (p.kind === "complete" && p.motion && p.motion.targetSlot === "rb" && (p.yards ?? 0) > best) {
        best = p.yards ?? 0; game = g; play = p;
      }
    }
  }
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on("pageerror", e => console.error("PAGEERR", e.message.slice(0, 160)));
  await page.goto("http://localhost:5173/play.html", { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(500);
  // Also grab a wr1 completion from the same game to compare Y finiteness
  // (discriminates a real rb-only bug from a harness artifact).
  const wrPlay = game.plays.find(p => p.kind === "complete" && p.motion && p.motion.targetSlot === "wr1")
    || battery.games.flatMap(g => g.plays).find(p => p.kind === "complete" && p.motion && p.motion.targetSlot === "wr1");
  const series = await page.evaluate(({ game, play, wrPlay }) => {
    const rec = { frame: 0, rb: [], ball: [] };
    const origP = window.drawPlayer, origB = window.drawBall;
    window.drawField = window.drawRunTrail = window.drawBallTrail = window.drawGoalposts =
      window.drawStadiumGoalposts = window.drawSpriteList = window.drawFireworksShow =
      window.showCallout = window.clearCallout = function () {};
    const RBNAME = play.receiver;
    window.drawPlayer = function (...a) {
      const style = a[9] || {}; const id = style.name || style.role || "?";
      if (id === "RB" || id === RBNAME) rec.rb.push({ f: rec.frame, x: Math.round(a[1]), y: Math.round(a[2]), id, pose: a[6] });
    };
    window.drawBall = function (...a) { rec.ball.push({ f: rec.frame, x: Math.round(a[1]), y: Math.round(a[2]) }); };
    gameResult = { homeTeam: game.homeTeam, awayTeam: game.awayTeam, homeRatings: game.homeRatings, awayRatings: game.awayRatings, playerLookup: new Map(game.lookupPairs), plays: game.plays };
    cameraMode = "broadcast";
    const cctx = document.createElement("canvas").getContext("2d");
    const N = 48;
    const anim = buildAnimForPlay(play, null);
    for (let f = 0; f < N; f++) { rec.frame = f; try { anim.render(f / (N - 1), cctx); } catch (e) { rec.err = "f" + f + ":" + e.message; break; } }
    // wr1 comparison pass — count finite vs NaN y for the wr1 receiver.
    let wrFinite = 0, wrNaN = 0;
    if (wrPlay) {
      const WRN = wrPlay.receiver;
      window.drawPlayer = function (...a) {
        const style = a[9] || {}; const id = style.name || style.role || "?";
        if (id === WRN || id === "WR1") { if (isFinite(a[2])) wrFinite++; else wrNaN++; }
      };
      const anim2 = buildAnimForPlay(wrPlay, null);
      for (let f = 0; f < N; f++) { try { anim2.render(f / (N - 1), cctx); } catch (e) { break; } }
    }
    window.drawPlayer = origP; window.drawBall = origB;
    return { rec, wrFinite, wrNaN, wrName: wrPlay && wrPlay.receiver,
      meta: { kind: play.kind, slot: play.motion.targetSlot, targetDepth: play.targetDepth, catchDepth: play.catchDepth, yac: play.yac, yards: play.yards, startYard: play.startYard, endYard: play.endYard, throwT: play.motion.throwT, poss: play.poss } };
  }, { game, play, wrPlay });
  await browser.close();
  console.log("META:", JSON.stringify(series.meta));
  console.log(`WR1 compare (${series.wrName}): finite-y ${series.wrFinite}, NaN-y ${series.wrNaN}`);
  if (series.rec.err) console.log("ERR:", series.rec.err);
  // Collapse to one RB row per frame (last draw that frame).
  const byF = new Map(); for (const r of series.rec.rb) byF.set(r.f, r);
  const rows = [...byF.values()].sort((a, b) => a.f - b.f);
  console.log("\nRB target per-frame (id/pose, x, y, Δyd from prev):");
  let prev = null;
  for (const r of rows) {
    const d = prev ? (Math.hypot(r.x - prev.x, r.y - prev.y) / 15).toFixed(1) : "-";
    console.log(`  f${String(r.f).padStart(2)}  ${String(r.id).padEnd(6)} ${String(r.pose).padEnd(10)} (${String(r.x).padStart(5)},${String(r.y).padStart(4)})  Δ${d}`);
    prev = r;
  }
  // Ball jumps
  const bF = new Map(); for (const r of series.rec.ball) bF.set(r.f, r);
  const brows = [...bF.values()].sort((a, b) => a.f - b.f);
  let bprev = null, maxbd = 0, maxbf = -1;
  for (const r of brows) { if (bprev) { const d = Math.hypot(r.x - bprev.x, r.y - bprev.y) / 15; if (d > maxbd) { maxbd = d; maxbf = r.f; } } bprev = r; }
  console.log(`\nBALL: ${brows.length} frames drawn, max Δ ${maxbd.toFixed(1)}yd at f${maxbf}`);
})();
