// ─── Headless fantasy-draft host (server-side) ──────────────────────────────
// Loads the roster GENERATOR + the fantasy-draft core into Node so the league
// server can be the draft authority: build the pool from a seed, validate
// picks (turn/availability/position-legality), auto-pick for AI teams and
// clock timeouts, and re-derive rosters from the tape for the artifact hash.
//
// Same loading technique + shims as server/engine-host.js (the audit-proven
// pattern), with two more files on top of the engine set:
//   play-franchise-core.js         genFranchiseRoster + assignTeamTiers/Ages/
//                                  DraftInfo (the pool build's dependencies)
//   play-franchise-fantasydraft.js the pure draft core (pool build, tape
//                                  applier, legality, auto-pick)
// Zero dependencies; CommonJS. Loaded LAZILY by league-server.js — a league
// server that never starts a fantasy draft never pays the bundle cost.
"use strict";
const fs = require("fs");
const path = require("path");

const FILES = [
  "play-data.js",
  "play-player.js",
  "play-render.js",
  "play-sim.js",
  "play-motion.js",
  "play-engine.js",
  "play-franchise-core.js",
  "play-franchise-fantasydraft.js",
];

function stripUiInit(code, file) {
  if (file !== "play-render.js") return code;
  return code.replace(/^buildOptions\([^)]*\);\s*$/gm, "// [draft-host] stripped")
             .replace(/^setupPreview\([^)]*\);\s*$/gm, "// [draft-host] stripped");
}

// Browser shims — identical in spirit to engine-host.js.
const SHIM = `
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

const EXPORT_HOOK = `
  ;__exports.TEAMS = TEAMS;
  __exports.FD_FLOORS = FD_FLOORS;
  __exports.FD_TARGET = FD_TARGET;
  __exports.FD_PICKS_PER_TEAM = FD_PICKS_PER_TEAM;
  __exports._fdBuildPool = _fdBuildPool;
  __exports._fdNewState = _fdNewState;
  __exports._fdApplyPick = _fdApplyPick;
  __exports._fdApplyTape = _fdApplyTape;
  __exports._fdOnClock = _fdOnClock;
  __exports._fdLegal = _fdLegal;
  __exports._fdAutoPick = _fdAutoPick;
  // League M2 (shared-season sim): canonical default-league gen, the RNG-free
  // schedule/standings builders, and the engine — the same bundle already
  // contains play-engine.js, so the league server sims weeks off THIS kit.
  __exports._fdBuildDefaultLeague = _fdBuildDefaultLeague;
  __exports._fdRosterIds = _fdRosterIds;
  __exports.generateFranchiseSchedule = generateFranchiseSchedule;
  __exports.initStandings = initStandings;
  __exports.GameSimulator = GameSimulator;
  __exports._setSimRng = _setSimRng;
  __exports._clearSimRng = _clearSimRng;
  __exports._setPortableMath = typeof _setPortableMath === "function" ? _setPortableMath : null;
`;

let _cached = null;
function loadDraftKit(rootDir) {
  if (_cached) return _cached;
  const root = rootDir || path.join(__dirname, "..");
  let bundle = SHIM;
  for (const f of FILES) {
    bundle += "\n;// ===== " + f + " =====\n"
            + stripUiInit(fs.readFileSync(path.join(root, f), "utf8"), f) + "\n";
  }
  const ex = {};
  new Function("__exports", bundle + EXPORT_HOOK)(ex);
  if (typeof ex._fdBuildPool !== "function" || typeof ex._fdAutoPick !== "function") {
    throw new Error("draft-host: bundle loaded but the draft kit is missing");
  }
  _cached = ex;
  return ex;
}

module.exports = { loadDraftKit };
