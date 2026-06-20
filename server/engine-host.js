// ─── Headless engine host (server-side) ────────────────────────────────────
// Loads the DOM-free engine bundle in Node and returns its key globals.
// Same file list + shims as _sim_audit.js (the pattern the audit gate proves
// on every run) — keep the two in sync if the engine's file set changes.
// Zero dependencies; CommonJS.
//
// Unlike the audit, this does NOT seed global Math.random — the server needs
// real entropy for tokens, and sim determinism comes from _setSimRng around
// each re-sim (the interactive runner's discipline). Roster generation at
// match creation may use real entropy because rosters are persisted in the
// match artifact (the artifact, not the RNG, is the source of truth).
"use strict";
const fs = require("fs");
const path = require("path");

const FILES = [
  "play-data.js",     // TEAMS, PERSONNEL, playbooks, _setSimRng/_clearSimRng
  "play-player.js",   // genRoster, player gen + stat helpers
  "play-render.js",   // pickBodyType, gen helpers (UI-init lines stripped)
  "play-sim.js",      // SimPlayer, PassProSim, RunBlockSim
  "play-motion.js",   // MotionPlayback
  "play-engine.js",   // GameSimulator + the Coordinator seams
];

function stripUiInit(code, file) {
  if (file !== "play-render.js") return code;
  return code.replace(/^buildOptions\([^)]*\);\s*$/gm, "// [engine-host] stripped")
             .replace(/^setupPreview\([^)]*\);\s*$/gm, "// [engine-host] stripped");
}

// Minimal browser shims — identical in spirit to _sim_audit.js: DOM getters
// return a benign chainable stub so top-level UI init can't throw; the sim
// path never reads back from it.
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
  ;__exports.GameSimulator = GameSimulator;
  __exports.TEAMS = TEAMS;
  __exports.getPlaybook = getPlaybook;
  __exports.genRoster = genRoster;
  __exports.buildRatings = typeof buildRatings === "function" ? buildRatings : null;
  __exports._setSimRng = _setSimRng;
  __exports._clearSimRng = _clearSimRng;
  __exports._setPortableMath = typeof _setPortableMath === "function" ? _setPortableMath : null;
  __exports._isPortableMath  = typeof _isPortableMath  === "function" ? _isPortableMath  : null;
  __exports._plog = typeof _plog === "function" ? _plog : null;
  __exports._pcos = typeof _pcos === "function" ? _pcos : null;
`;

let _cached = null;
function loadEngine(rootDir) {
  if (_cached) return _cached;
  const root = rootDir || path.join(__dirname, "..");
  let bundle = SHIM;
  for (const f of FILES) {
    bundle += "\n;// ===== " + f + " =====\n"
            + stripUiInit(fs.readFileSync(path.join(root, f), "utf8"), f) + "\n";
  }
  const ex = {};
  // One sloppy-mode script so top-level const/class share lexical scope
  // (they don't attach to a VM global) — the audit's loading trick.
  new Function("__exports", bundle + EXPORT_HOOK)(ex);
  if (typeof ex.GameSimulator !== "function" || !Array.isArray(ex.TEAMS)) {
    throw new Error("engine-host: bundle loaded but GameSimulator/TEAMS missing");
  }
  ex.getTeam = (id) => ex.TEAMS.find(t => t.id === id) || null;
  ex.buildRoster = (team) => ex.genRoster(ex.getPlaybook(team), {}, null);
  _cached = ex;
  return ex;
}

module.exports = { loadEngine };
