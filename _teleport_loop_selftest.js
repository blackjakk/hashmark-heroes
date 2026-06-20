// _teleport_loop_selftest.js — proves the LOOP path-shape classifier (the
// "#27 ran a big loop" detector wired into _teleport_gate.sh) actually fires on
// a circular defender path and rejects the look-alikes it must not flag.
//
// WHY a self-test: no defender loop reproduces in the seeded battery (the bug
// is real but rare — see the CLAUDE.md note), so the live gate can only show
// loop=0. That proves the detector doesn't FALSE-positive, not that it would
// CATCH the bug. This feeds synthetic chains through the identical math so the
// "would catch it" half is proven, not asserted.
//
//   node _teleport_loop_selftest.js     exit 0 = all cases pass, 1 = a failure
//
// KEEP IN SYNC: classifyLoop below mirrors the loop block in _teleport_detect.js
// (winding around the centroid + radius-of-gyration + minor principal axis +
// offense/defense side tag). If you change one, change the other.

const PX_PER_YARD = 15;
const LOOP_WIND_DEG = 330;   // ≈ one full revolution (330 catches a discretely-sampled single loop ~354°; route breaks wind ~180°)
const LOOP_MIN_PATH_YD = 12; // real traversal
const LOOP_MIN_RG_YD = 5;    // spans a real radius
const LOOP_MIN_MINOR_YD = 3; // FAT (round), not a thin out-and-back sliver

// chain: [{x,y}, ...] in PIXELS. offNames: Set of offensive-starter names.
// id: "P:<name>". Returns the loop record or null.
function classifyLoop(chain, id, offNames) {
  if (chain.length < 16) return null;
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
  if (moving.length < 6 || pathYd < LOOP_MIN_PATH_YD) return null;
  let cx = 0, cy = 0;
  for (const m of moving) { cx += m.x; cy += m.y; }
  cx /= moving.length; cy /= moving.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const m of moving) { const ux = m.x - cx, uy = m.y - cy; sxx += ux * ux; syy += uy * uy; sxy += ux * uy; }
  sxx /= moving.length; syy /= moving.length; sxy /= moving.length;
  const rgYd = Math.sqrt(sxx + syy) / PX_PER_YARD;
  const half = (sxx + syy) / 2;
  const disc = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
  const minorRgYd = Math.sqrt(Math.max(0, half - disc)) / PX_PER_YARD;
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
    const side = (offNames && offNames.has(id.replace(/^P:/, ""))) ? "off" : "def";
    return { id, side, windDeg: Math.round(windDeg), rgYd: +rgYd.toFixed(1),
             minorRgYd: +minorRgYd.toFixed(1), pathYd: +pathYd.toFixed(1) };
  }
  return null;
}

// ── Synthetic chains (in pixels). 60 samples each so length ≥ 16. ──
const N = 60;
const Y = PX_PER_YARD;
const circle = (rYd, cx = 800, cy = 360, turns = 1) =>
  Array.from({ length: N }, (_, i) => {
    const a = (i / (N - 1)) * turns * 2 * Math.PI;
    return { x: cx + rYd * Y * Math.cos(a), y: cy + rYd * Y * Math.sin(a) };
  });
const straight = (lenYd, cx = 400, cy = 360) =>
  Array.from({ length: N }, (_, i) => ({ x: cx + (i / (N - 1)) * lenYd * Y, y: cy }));
const outAndBack = (lenYd, cx = 400, cy = 360) =>   // thin: 2px lateral offset on return
  Array.from({ length: N }, (_, i) => {
    const h = i / (N - 1);
    return h < 0.5 ? { x: cx + (h / 0.5) * lenYd * Y, y: cy }
                   : { x: cx + ((1 - h) / 0.5) * lenYd * Y, y: cy + 2 };
  });
const jitter = (cx = 900, cy = 300) =>             // tight tackle-pile churn, ~2yd box
  Array.from({ length: N }, (_, i) => ({ x: cx + (i % 4) * 8 - 12, y: cy + ((i * 3) % 5) * 6 - 12 }));

const offNames = new Set(["Star Receiver"]);
const cases = [
  { name: "big circle (8yd), DEFENDER → flag as def", chain: circle(8), id: "P:Loopy Defender", expect: "def" },
  { name: "big circle (8yd), RECEIVER → flag as off", chain: circle(8), id: "P:Star Receiver", expect: "off" },
  { name: "tight circle (3yd) → reject (Rg too small)", chain: circle(3), id: "P:Mini", expect: null },
  { name: "straight 30yd run → reject (winds ~180°)", chain: straight(30), id: "P:Sprinter", expect: null },
  { name: "thin out-and-back 22yd → reject (minor axis ~0)", chain: outAndBack(22), id: "P:Comeback", expect: null },
  { name: "tackle-pile jitter → reject (path < 12yd)", chain: jitter(), id: "P:Piled", expect: null },
];

let pass = 0, fail = 0;
console.log("LOOP classifier self-test (synthetic paths)\n");
for (const c of cases) {
  const r = classifyLoop(c.chain, c.id, offNames);
  const got = r ? r.side : null;
  const ok = got === c.expect;
  ok ? pass++ : fail++;
  const detail = r ? `wind=${r.windDeg}° Rg=${r.rgYd}yd minor=${r.minorRgYd}yd path=${r.pathYd}yd side=${r.side}` : "no flag";
  console.log(`  ${ok ? "✓" : "✗ FAIL"} ${c.name}`);
  console.log(`       expect=${c.expect ?? "no flag"} · got=${got ?? "no flag"} · ${detail}`);
}
console.log(`\n${fail ? "✗ " + fail + " FAILURE(S)" : "ALL-PASS"} (${pass}/${cases.length})`);
process.exit(fail ? 1 : 0);
