// _trace_play.js — targeted teleport tracer (promoted from /tmp during the
// post-Stage-11 tackle-snap re-diagnosis). Replays a SPECIFIC report play index and dumps a SPECIFIC
// player's pose+coords across a frame window. Replicates the detector's
// FIELD_KINDS filtering + game/play ordering so the index matches the report.
//   node /tmp/trace_play.js <reportIdx> <playerNameSubstr> [fromF] [toF]
const fs = require("fs");
const PW_LIB = process.env.PLAYWRIGHT_LIB || (()=>{ try{require.resolve("playwright");return "playwright";}catch(e){} return "/opt/node22/lib/node_modules/playwright"; })();
const { chromium } = require(PW_LIB);
const FIELD_KINDS = new Set(["run","complete","incomplete","int","sack","scramble","screen","fg_good","fg_miss","fg_blocked","punt","kickoff","fumble","score","two_point","kneel","spike"]);

const IDX = Number(process.argv[2]);
const NAME = process.argv[3] || "";
const FROM = process.argv[4] != null ? Number(process.argv[4]) : 0;
const TO = process.argv[5] != null ? Number(process.argv[5]) : 99999;

(async () => {
  const battery = JSON.parse(fs.readFileSync("/tmp/teleport_plays.json", "utf8"));
  const games = battery.games.map(g => ({ ...g, plays: g.plays.filter(p => FIELD_KINDS.has(p.kind)) })).filter(g => g.plays.length);
  // flatten to find idx -> {game, play, prevPlay}
  let count = 0, target = null;
  for (const g of games) {
    let prev = null;
    for (const p of g.plays) {
      if (count === IDX) { target = { game: g, play: p, prev }; }
      count++; prev = p;
    }
    if (target) break;
  }
  if (!target) { console.log("idx out of range (total", count, ")"); process.exit(1); }
  const { game, play, prev } = target;
  console.log("META play#" + IDX + ":", JSON.stringify({ kind: play.kind, slot: play.motion && play.motion.targetSlot, concept: play.concept, coverage: play.coverage, yards: play.yards, endYard: play.endYard, isTD: play.isTD, td: play.td, result: play.result, poss: play.poss }));

  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on("pageerror", e => console.error("PAGEERR", e.message.slice(0, 160)));
  await page.goto("http://localhost:5173/play.html", { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(400);

  const out = await page.evaluate(({ game, play, prev, NAME, FROM, TO }) => {
    const REC = { frame: 0, hits: [] };
    for (const n of ["drawField","drawRunTrail","drawBallTrail","drawGoalposts","drawStadiumGoalposts","drawSpriteList","drawCinemaField","drawFireworksShow","showCallout","clearCallout","drawTopDownGoalposts","drawPortraitPopup","drawGoalposts"]) window[n] = function(){};
    window.drawPlayer = function (...a) {
      const style = a[9] || {};
      const nm = style.name || style.role || "?";
      if ((style.name||"").includes(NAME) || (style.role||"").includes(NAME))
        REC.hits.push({ f: REC.frame, x: Math.round(a[1]), y: Math.round(a[2]), pose: a[6], role: style.role, name: style.name });
    };
    window.drawBall = function(){};
    gameResult = { homeTeam: game.homeTeam, awayTeam: game.awayTeam, homeRatings: game.homeRatings, awayRatings: game.awayRatings, playerLookup: new Map(game.lookupPairs), plays: game.plays };
    cameraMode = "tactical"; try { viewMode = "tactical"; } catch (e) {}
    const cctx = document.createElement("canvas").getContext("2d");
    const dtMs = 1000/60;
    const anim = buildAnimForPlay(play, prev);
    const N = Math.max(30, Math.min(900, Math.round((anim.duration||4000)/dtMs)));
    const _on = performance.now; let _c = 0; try { performance.now = () => _c; } catch(e){}
    for (let f=0; f<N; f++){ REC.frame=f; _c=f*dtMs; try{ anim.render(N>1?f/(N-1):0, cctx);}catch(e){ return {err:String(e).slice(0,120), N}; } }
    try{ performance.now=_on; }catch(e){}
    // chain by continuity per frame (player may be drawn twice)
    const byFrame = new Map();
    for (const h of REC.hits){ const a=byFrame.get(h.f)||[]; a.push(h); byFrame.set(h.f,a); }
    const frames = [...byFrame.keys()].sort((a,b)=>a-b);
    const series = []; let run=null;
    for (const f of frames){ const cands=byFrame.get(f); let pick=cands[0]; if(run){let bd=Infinity;for(const c of cands){const d=Math.hypot(c.x-run.x,c.y-run.y);if(d<bd){bd=d;pick=c;}}} series.push(pick); run=pick; }
    return { N, series: series.filter(h => h.f>=FROM && h.f<=TO) };
  }, { game, play, prev, NAME, FROM, TO });

  await browser.close();
  if (out.err) { console.log("RENDER ERR:", out.err, "N=", out.N); process.exit(0); }
  console.log("N=" + out.N + "  showing '" + NAME + "' f" + FROM + ".." + TO);
  let prevH = null;
  for (const h of out.series) {
    const jump = prevH ? Math.round(Math.hypot(h.x-prevH.x, h.y-prevH.y)) : 0;
    const flag = jump > 30 ? "  <== JUMP " + jump + "px (" + (jump/15).toFixed(1) + "yd)" : "";
    console.log(`  f${String(h.f).padStart(3)} pose=${String(h.pose).padEnd(10)} (${String(h.x).padStart(4)},${String(h.y).padStart(4)})${flag}`);
    prevH = h;
  }
})();
