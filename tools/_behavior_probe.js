// _behavior_probe.js — quantify the user-reported behavior bugs:
//   A. lineup out of bounds (formation slots at/beyond the sidelines)
//   B. whole defense static through a live play
//   C. individual players frozen mid-play while the play is live
//   D. ball carrier sprite facing opposite his actual travel
//   E. mid-field bunching (many bodies inside a tight radius)
// Drives real seeded games through the broadcast renderer like the
// anim pose audit does.
//   node tools/_behavior_probe.js
const PW_LIB = process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);
const { spawn } = require("child_process");
const path = require("path");
const PORT = 5203;
const children = [];
process.on("exit", () => children.forEach(c => { try { c.kill("SIGKILL"); } catch {} }));

(async () => {
  children.push(spawn("npx", ["http-server", "-p", String(PORT), "-s", path.join(__dirname, "..")], { stdio: "ignore" }));
  await new Promise(r => setTimeout(r, 5000));
  const browser = await chromium.launch({ headless: true });
  children.push({ kill: () => browser.close().catch(() => {}) });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  page.on("pageerror", e => console.log("PAGEERR", String(e.message).slice(0, 140)));
  page.on("console", m => { const t = m.text(); if (t.startsWith("[probe]")) console.log(t); });
  await page.goto(`http://localhost:${PORT}/play.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1800);

  const report = await page.evaluate(`(async () => {
    let s = 0xBEEF;
    Math.random = function () { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    startFranchise(1);
    franchise.phase = "regular";
    const games = [];
    for (const pr of [[1, 2]]) {
      frnPlayGame(pr[0], pr[1]);
      playing = false; cancelAnimationFrame(rafId);
      games.push(gameResult);
    }
    // Hook drawPlayer to record world positions per frame.
    const rawDP = drawPlayer;
    let rec = null;
    drawPlayer = function (ctx, x, y, color, secondary, label, pose, t, facing, style) {
      if (rec && Number.isFinite(x) && Number.isFinite(y)) {
        const id = (style && style.name) || null;
        if (id) {
          let e = rec.players.get(id);
          if (!e) { e = { xs: [], ys: [], poses: [], team: color }; rec.players.set(id, e); }
          e.xs.push(x); e.ys.push(y); e.poses.push(pose || "");
        }
        rec.all.push([x, y]);
      }
      return rawDP(ctx, x, y, color, secondary, label, pose, t, facing, style);
    };
    // Hook drawPlayerSprite to catch carrier facing.
    const rawDPS = drawPlayerSprite;
    let faceRec = null;
    drawPlayerSprite = function (ctx, pose, t, vx, vy, teamPrimary, facing, label, secondary, style) {
      if (faceRec && style && style.name === faceRec.name
          && (pose === "carry" || pose === "run" || pose === "qb_scramble" || pose === "truck")) {
        faceRec.samples.push({ vx, vy, f: faceRec.frame });
      }
      return rawDPS(ctx, pose, t, vx, vy, teamPrimary, facing, label, secondary, style);
    };
    const out = { lineupOOB: [], defStatic: [], frozen: [], facing: [], bunching: [] };
    let plays = 0;
    for (let g = 0; g < games.length; g++) {
      gameResult = games[g];
      for (let i = 0; i < gameResult.plays.length; i++) {
        const play = gameResult.plays[i];
        if (play.kind === "kneel" || play.kind === "spike") continue;
        playHead = i;
        playing = true; startNextPlay();
        playing = false; cancelAnimationFrame(rafId);
        if (!animState || !animState.anim) continue;
        play._catchFlashFired = true; play._intFlashFired = true;
        const ctx = document.getElementById("field").getContext("2d");
        rec = { players: new Map(), all: [] };
        const carrierName = play.returner || play.rusher || play.receiver || null;
        faceRec = carrierName ? { name: carrierName, samples: [], frame: 0 } : null;
        const frames = [];
        let err = null;
        for (let f = 0.03; f <= 0.99; f += 0.08) {
          if (faceRec) faceRec.frame = frames.length;
          const mark = rec.all.length;
          try { _frameStartBroadcast(); animState.anim.render(f, ctx); _frameEndBroadcast(ctx); }
          catch (e) { err = e; break; }
          animState.slowMoUntil = 0;
          frames.push({ idx: frames.length, f, from: mark, to: rec.all.length });
          for (const [, e] of rec.players) {
            while (e.xs.length < frames.length) { e.xs.push(null); e.ys.push(null); e.poses.push(null); }
          }
        }
        if (err || frames.length < 8) { rec = null; faceRec = null; continue; }
        plays++;
        const tag = g + ":" + i + " " + play.kind + (play.runType ? "/" + play.runType : "") + " — " + (play.desc || "").slice(0, 44);
        // A. lineup OOB at the first frame
        let oobN = 0, minY = 1e9, maxY = -1e9;
        for (const [nm, e] of rec.players) {
          const y0 = e.ys.find(v => v != null);
          if (y0 == null) continue;
          minY = Math.min(minY, y0); maxY = Math.max(maxY, y0);
          if (y0 < FIELD.TOP + 10 || y0 > FIELD.BOT - 4) oobN++;
        }
        if (oobN >= 1) out.lineupOOB.push({ tag, oobN, minY: Math.round(minY), maxY: Math.round(maxY) });
        // B/C. movement analysis on the live window (skip first/last 15%)
        const lo = Math.floor(frames.length * 0.15), hi = Math.ceil(frames.length * 0.85);
        const isDef = (e) => e.team && gameResult && true; // team split below via color
        const teams = {};
        for (const [nm, e] of rec.players) (teams[e.team] = teams[e.team] || []).push([nm, e]);
        const colorKeys = Object.keys(teams);
        for (const ck of colorKeys) {
          let total = 0, n = 0;
          for (const [nm, e] of teams[ck]) {
            let d = 0;
            for (let k = lo + 1; k < hi; k++) {
              if (e.xs[k] != null && e.xs[k-1] != null) d += Math.hypot(e.xs[k]-e.xs[k-1], e.ys[k]-e.ys[k-1]);
            }
            total += d; n++;
          }
          if (n >= 8 && total / n < 6 && play.kind !== "fg_good" && play.kind !== "fg_miss") {
            out.defStatic.push({ tag, color: ck, bodies: n, avgMove: Math.round(total / n * 10) / 10 });
          }
        }
        // C. individual freezes: moving early, then dead-still ≥35% of the live window
        for (const [nm, e] of rec.players) {
          let early = 0;
          for (let k = 1; k < lo + 3 && k < e.xs.length; k++)
            if (e.xs[k] != null && e.xs[k-1] != null) early += Math.hypot(e.xs[k]-e.xs[k-1], e.ys[k]-e.ys[k-1]);
          if (early < 8) continue;        // never really moved — linemen etc.
          let still = 0, maxStill = 0;
          for (let k = lo + 1; k < hi; k++) {
            if (e.xs[k] != null && e.xs[k-1] != null) {
              const d = Math.hypot(e.xs[k]-e.xs[k-1], e.ys[k]-e.ys[k-1]);
              if (d < 0.6) { still++; maxStill = Math.max(maxStill, still); }
              else still = 0;
            }
          }
          if (maxStill >= (hi - lo) * 0.5 && ["complete","run","kickoff","punt","int","fumble"].includes(play.kind)) {
            out.frozen.push({ tag, nm, maxStillFrames: maxStill, of: hi - lo });
          }
        }
        // D. carrier facing vs travel
        if (faceRec && faceRec.samples.length >= 4) {
          const e = rec.players.get(faceRec.name);
          if (e) {
            let bad = 0, tot = 0;
            for (const sm of faceRec.samples) {
              const k = sm.f;
              if (k + 1 < e.xs.length && e.xs[k] != null && e.xs[k+1] != null) {
                const dx = e.xs[k+1] - e.xs[k];
                if (Math.abs(dx) > 2 && Math.abs(sm.vx) > 0.2) { tot++; if (Math.sign(dx) !== Math.sign(sm.vx)) bad++; }
              }
            }
            if (tot >= 4 && bad / tot > 0.4) out.facing.push({ tag, nm: faceRec.name, bad, tot });
          }
        }
        // E. bunching: ≥7 bodies within a 30px radius mid-play
        for (let k = lo; k < hi; k += 3) {
          const pts = [];
          for (const [, e] of rec.players) if (e.xs[k] != null) pts.push([e.xs[k], e.ys[k]]);
          for (const p of pts) {
            const close = pts.filter(q => Math.hypot(q[0]-p[0], q[1]-p[1]) < 30).length;
            if (close >= 7) { out.bunching.push({ tag, frame: k, close }); k = 1e9; break; }
          }
        }
        rec = null; faceRec = null;
        if (plays % 40 === 0) console.log("[probe] " + plays + " plays analyzed");
      }
    }
    out.plays = plays;
    return out;
  })()`);

  console.log("plays analyzed:", report.plays);
  const dump = (label, arr, n = 12) => {
    console.log("\\n== " + label + ": " + arr.length);
    for (const r of arr.slice(0, n)) console.log("  ", JSON.stringify(r));
  };
  dump("A lineup OOB", report.lineupOOB);
  dump("B team static", report.defStatic);
  dump("C frozen players", report.frozen);
  dump("D facing mismatch", report.facing);
  dump("E bunching", report.bunching, 8);
  process.exit(0);
})();
