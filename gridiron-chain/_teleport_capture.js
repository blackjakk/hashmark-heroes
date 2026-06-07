// _teleport_capture.js — Stage 0 (capture phase) of the position-contract
// refactor. Runs the engine headlessly (NO browser), collects REAL play-visual
// objects across a battery of games, samples them to cover every play kind ×
// target slot × coverage, and writes them to /tmp/teleport_plays.json for the
// detector (_teleport_detect.js) to replay through the renderer.
//
//   Usage:  node _teleport_capture.js [games] [seed]   (default 6, seed 1337)
//   Output: /tmp/teleport_plays.json
//             { homeTeam, awayTeam, plays: [ <play-visual>, ... ] }
//
// DETERMINISM: the engine draws from Math.random in ~142 sites, so an unseeded
// capture produces a DIFFERENT battery every run — which makes the teleport
// count wobble run-to-run (e.g. 4–13 egregious on identical code) and any
// regression gate built on it unreliable. We override Math.random with a seeded
// mulberry32 PRNG *inside this harness's eval scope only*, so the same seed
// always yields the byte-identical battery. The shipped game engine is
// untouched and stays fully stochastic for real players.
//
// Dev/audit tool only — ignored by the build. Mirrors _sim_audit.js's loader so
// top-level const/class declarations share one lexical scope.
const fs = require("fs");
const path = require("path");

const files = [
  "play-data.js", "play-player.js", "play-render.js",
  "play-sim.js", "play-motion.js", "play-engine.js",
];

// play-render.js runs UI-init at load that touches real DOM — strip those.
function stripUiInit(code, file) {
  if (file !== "play-render.js") return code;
  return code.replace(/^buildOptions\([^)]*\);\s*$/gm, "// [capture] stripped")
             .replace(/^setupPreview\([^)]*\);\s*$/gm, "// [capture] stripped");
}

const shim = `
  var _stub = new Proxy(function(){}, {
    get(t, k) { if (k === "style" || k === "classList" || k === "dataset") return _stub;
                if (k === "length") return 0;
                if (k === Symbol.iterator) return function*(){};
                return _stub; },
    set() { return true; }, apply() { return _stub; }, construct() { return _stub; },
  });
  var document = {
    createElement: () => _stub, getElementById: () => _stub,
    querySelector: () => _stub, querySelectorAll: () => [],
    addEventListener: () => {}, body: _stub, documentElement: _stub,
  };
  var window = (typeof globalThis !== "undefined" ? globalThis : this);
  window.addEventListener = () => {};
  if (typeof performance === "undefined") var performance = { now: () => Date.now() };
  var requestAnimationFrame = () => 0;
  var localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
`;

const GAMES = Number(process.argv[2] || 6);
// Default seed is fixed so the bare `node _teleport_capture.js 4` invocation
// (used by the teleport-check skill and the CI gate) is reproducible. Pass a
// second arg to capture a different — but still fixed — battery.
const SEED = (process.argv[3] != null ? Number(process.argv[3]) : 1337) >>> 0;

// Seeded RNG prelude — prepended to the eval blob so EVERY engine Math.random()
// call (load-time tables + per-play sim) draws from one deterministic stream.
// mulberry32: tiny, fast, good distribution; ample for sim variety.
const seedPrelude = `
  (function () {
    var __a = ${SEED} >>> 0;
    Math.random = function () {
      __a |= 0; __a = (__a + 0x6D2B79F5) | 0;
      var t = Math.imul(__a ^ (__a >>> 15), 1 | __a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
`;

const capture = `
;(function runCapture() {
  if (typeof TEAMS === "undefined" || typeof GameSimulator === "undefined") {
    console.error("Missing TEAMS or GameSimulator after load"); process.exit(1);
  }
  console.error("Loaded OK — " + TEAMS.length + " teams. Capturing " + ${GAMES} + " games.");
  const buildRoster = (team) => genRoster(getPlaybook(team), {}, null);

  // Slim a team object to what the renderer reads (colors, names, abbr).
  const slimTeam = (t) => ({
    id: t.id, city: t.city, name: t.name, abbr: t.abbr,
    primary: t.primary, secondary: t.secondary,
  });

  // Bucket key: the variety axes that exercise different render paths. Bucketing
  // is GLOBAL across games so we don't over-collect the common buckets, but each
  // kept play stays tied to its source game's context (ratings + lookup) because
  // those resolve the named participants.
  const keyOf = (p) => [p.kind, p.concept || "-", p.coverage || "-",
                        (p.motion && p.motion.targetSlot) || "-", p.poss].join("|");
  const PER_BUCKET = 3;
  const bucketCount = new Map();
  const games = [];
  let totalSeen = 0, totalKept = 0;

  for (let g = 0; g < ${GAMES}; g++) {
    const h = TEAMS[g % TEAMS.length], a = TEAMS[(g + 5) % TEAMS.length];
    const sim = new GameSimulator(h, a, buildRoster(h), buildRoster(a));
    const r = sim.simulate();
    const kept = [];
    for (const p of (r.plays || [])) {
      totalSeen++;
      if (!p.kind || ["momentum","substitution","news","drive_summary"].includes(p.kind)) continue;
      const k = keyOf(p);
      const c = bucketCount.get(k) || 0;
      if (c >= PER_BUCKET) continue;
      bucketCount.set(k, c + 1);
      kept.push(p);
      totalKept++;
    }
    if (!kept.length) continue;
    games.push({
      homeTeam: slimTeam(r.homeTeam), awayTeam: slimTeam(r.awayTeam),
      homeRatings: r.homeRatings, awayRatings: r.awayRatings,
      // playerLookup is a Map — serialize as entry pairs, rebuilt in the detector.
      lookupPairs: [...(r.playerLookup || new Map()).entries()],
      plays: kept,
    });
  }

  window.__captureResult = { games };
  console.error("Captured " + totalKept + " plays across " + games.length +
                " games / " + bucketCount.size + " buckets (" + totalSeen + " seen).");
})();
`;

let blob = seedPrelude + "\n" + shim + "\n";
for (const f of files) {
  let code = fs.readFileSync(path.join(__dirname, f), "utf8");
  code = stripUiInit(code, f);
  blob += "\n;// ==== " + f + " ====\n" + code + "\n";
}
blob += capture;

try {
  (0, eval)(blob);
} catch (e) {
  console.error("Capture failed: " + (e && e.stack || e));
  process.exit(1);
}
const result = globalThis.__captureResult;
if (!result) { console.error("No capture result produced."); process.exit(1); }
fs.writeFileSync("/tmp/teleport_plays.json", JSON.stringify(result));
const allPlays = result.games.flatMap(g => g.plays);
const byKind = {};
for (const p of allPlays) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
console.error("Wrote " + allPlays.length + " plays / " + result.games.length +
  " games → /tmp/teleport_plays.json  (seed=" + SEED + ", deterministic)");
console.error("By kind: " + Object.entries(byKind).sort((a, b) => b[1] - a[1])
  .map(([k, c]) => k + ":" + c).join("  "));
