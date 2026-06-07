// ─── Sprite atlas (optional skin for drawPlayer) ────────────────────────
//
// Drop-in sprite rendering on top of the existing pose-math drawPlayer.
// If sprites are loaded for a given pose + direction, the sprite is drawn
// and the shape-math is skipped. If not, drawPlayer falls back to the
// hand-tuned body-part rendering. Mix and match as you generate assets.
//
// PIXELLAB ASSET LAYOUT
// ─────────────────────
//
// Each pose lives in its own folder:
//
//   sprites/<pose>/<direction>.png         (single-frame poses)
//   sprites/<pose>/<direction>_<frame>.png (animation cycles)
//
// Directions match PixelLab's "low top-down" 8-direction output:
//   south, south-east, east, north-east, north, north-west, west, south-west
//
// Examples:
//   sprites/idle/south.png                 (mannequin idle, facing camera)
//   sprites/run/east_0.png ... east_3.png  (4-frame run cycle, facing right)
//   sprites/tackled/south.png              (single fallen frame)
//
// The atlas auto-loads any matching files at page load. Files that 404
// are silently treated as "not authored yet" — drawPlayer falls back to
// canvas pose math for those (pose, direction) combinations.
//
// TEAM COLORS
// ───────────
// PixelLab characters are generated in white/grey so we can tint at
// runtime. Each sprite is recolored once per (pose, direction, color)
// via multiply blend, then cached.
//
// FACING → DIRECTION
// ──────────────────
// The game uses ±1 facing + (vx, vy) locomotion velocity. We pick the
// 8-direction sprite that best matches the player's heading angle.

const _SPRITE_BASE_URL = "sprites/";
const _SPRITE_FRAME_SIZE = 92;   // PixelLab default; tracks generator output
// Multiplier applied to native sprite pixel size when drawing on field.
// 104px PixelLab sprite at 1.0 = native size. Tune live via
// window.GC_SPRITE_SCALE.
const _SPRITE_SCALE = 1.0;
// Procedural _drawPlayerImpl renders with FEET at the (x, y) point and
// the body extending up. Our sprite has its visual center near the chest,
// so we offset the draw downward by half a sprite height to align feet.
// PixelLab "low top-down" sprites have feet at ~85% Y, so offset = 0.35.
const _SPRITE_FOOT_OFFSET_Y = 0.35;

// Direction order matches PixelLab's rotation set.
const _DIRECTIONS = [
  "east", "north-east", "north", "north-west",
  "west", "south-west", "south", "south-east",
];
// Kick has no head-on/away frames (leg swing doesn't read top-down).
const _KICK_DIRS = [
  "south-east", "east", "north-east",
  "north-west", "west", "south-west",
];
// Hurdle: north-west generation failed on PixelLab; other 7 dirs landed.
const _HURDLE_DIRS = [
  "south", "south-east", "east", "north-east",
  "north", "west", "south-west",
];

// Pose-key → { folder, frames, dirs }. `folder` is the on-disk directory;
// multiple pose keys can point at the same folder (aliasing). Pose keys
// MUST match what the engine emits (see grep `.pose =` in play-animation).
const _SPRITE_POSES = {
  // Direct matches (key == folder)
  idle:      { folder: "idle",      frames: 1, dirs: _DIRECTIONS },
  stance:    { folder: "stance",    frames: 4, dirs: _DIRECTIONS },
  run:       { folder: "run",       frames: 4, dirs: _DIRECTIONS },
  celebrate: { folder: "celebrate", frames: 4, dirs: _DIRECTIONS },

  // Engine-emitted poses → closest existing folder
  // NEW dedicated sprites (PixelLab v3, 8 directions × 4 frames):
  carry:     { folder: "carry",        frames: 4, dirs: _DIRECTIONS },  // ball tucked under arm — every RB carry, post-catch WR
  kick_slide:{ folder: "kick_slide",   frames: 4, dirs: _DIRECTIONS },  // OL pass-pro slide
  backpedal: { folder: "backpedal",    frames: 4, dirs: _DIRECTIONS },  // DB cover (now faces correctly)
  dive_forward:{ folder: "dive_forward", frames: 4, dirs: _DIRECTIONS },// horizontal lay-out dive
  // Aliases — engine pose names that map to the new dedicated sprites.
  // The dive/fumble-recovery/goal-line dive poses all use dive_forward.
  dive:      { folder: "dive_forward", frames: 4, dirs: _DIRECTIONS },  // diving forward

  // Existing aliased folders (no dedicated sprite yet, share base art):
  tackled:   { folder: "fall",      frames: 4, dirs: _DIRECTIONS },  // on the ground (defenders, QBs — no ball)
  tackled_carry: { folder: "tackled_carry", frames: 4, dirs: _DIRECTIONS },  // ballcarrier prone, arms wrapping ball
  engage:    { folder: "block",     frames: 4, dirs: _DIRECTIONS },  // OL/DL clash
  block:     { folder: "block",     frames: 4, dirs: _DIRECTIONS },  // direct
  reach:     { folder: "catch",     frames: 4, dirs: _DIRECTIONS },  // receiver reach
  catch:     { folder: "catch",     frames: 4, dirs: _DIRECTIONS },  // alt key (engine uses both)
  leap:      { folder: "catch",     frames: 4, dirs: _DIRECTIONS },  // leaping catch — arms up
  hit:       { folder: "tackle",    frames: 4, dirs: _DIRECTIONS },  // contact moment
  sack:      { folder: "fall",      frames: 4, dirs: _DIRECTIONS },  // QB sacked
  ragdoll:   { folder: "ragdoll",   frames: 4, dirs: _DIRECTIONS },  // tossed body — dedicated mid-air tumble
  tumble:    { folder: "tumble",    frames: 4, dirs: _DIRECTIONS },  // post-contact end-over-end roll (ball in hand)
  spin_fall: { folder: "spin_fall", frames: 4, dirs: _DIRECTIONS },  // mid-air corkscrew off a side hit (ball in hand)
  point:     { folder: "stance",    frames: 4, dirs: _DIRECTIONS },  // DB pre-snap pointing
  throw:     { folder: "pass",      frames: 4, dirs: _DIRECTIONS },  // QB throw motion
  juke:      { folder: "juke",      frames: 4, dirs: _DIRECTIONS },  // RB juke (ball in hand)
  spin:      { folder: "spin",      frames: 8, dirs: _DIRECTIONS },  // RB 360 spin (ball in hand) — 8 frames for smooth rotation
  jam:       { folder: "jam",       frames: 4, dirs: _DIRECTIONS },  // DB press at line — dedicated
  // Ball-in-hand poses — all use a football-tucked-under sprite.
  // Per user direction: "for the carry, or any animation with ball in
  // hand, please use 'football tucked under' sprite."
  truck:     { folder: "truck",     frames: 4, dirs: _DIRECTIONS },  // running through hit (ball in hand)
  churn:     { folder: "carry",     frames: 4, dirs: _DIRECTIONS },  // legs churning (ball in hand)
  stiff:     { folder: "stiff_arm", frames: 4, dirs: _DIRECTIONS },  // RB stiff-arm (ball in hand, free arm extended)
  stiff_arm: { folder: "stiff_arm", frames: 4, dirs: _DIRECTIONS },  // alt key
  release:   { folder: "release",   frames: 4, dirs: _DIRECTIONS },  // WR release off line — dedicated
  scrape:    { folder: "scrape",    frames: 4, dirs: _DIRECTIONS },  // LB lateral shuffle pursuit — dedicated
  // QB ball-in-hand poses — chest cradle (pocket) and 2-handed scramble.
  qb_carry:   { folder: "qb_carry",    frames: 4, dirs: _DIRECTIONS },  // QB ball at chest, ready to throw
  qb_scramble:{ folder: "qb_scramble", frames: 4, dirs: _DIRECTIONS },  // QB sprinting with ball
  // Strip / swat — DB punch-out arm chop.
  strip_swat: { folder: "strip_swat", frames: 4, dirs: _DIRECTIONS },
  strip:      { folder: "strip_swat", frames: 4, dirs: _DIRECTIONS },  // alias
  swat:       { folder: "strip_swat", frames: 4, dirs: _DIRECTIONS },  // alias (PD arm chop)
  // QB dropback only ever reads well as a 3/4-view diagonal — body
  // faces downfield (E or W on the field) while stepping backward, so
  // only SE (east-facing offense) and SW (west-facing offense) are
  // used. The facing-only direction picker maps facing → SE/SW below.
  drop_step: { folder: "drop_step", frames: 4, dirs: ["south-east", "south-west"] },
  handoff:   { folder: "handoff",   frames: 4, dirs: _DIRECTIONS },  // QB→RB exchange
  hurdle:    { folder: "hurdle",    frames: 4, dirs: _DIRECTIONS },  // RB jump over defender (ball in hand, all 8 dirs now)

  // Referee poses — prereq for the penalty feature. Not currently
  // emitted by the engine; rendered when penalty plays land.
  ref_idle:       { folder: "ref_idle",       frames: 4, dirs: _DIRECTIONS },
  ref_td_signal:  { folder: "ref_td_signal",  frames: 4, dirs: _DIRECTIONS },
  ref_first_down: { folder: "ref_first_down", frames: 4, dirs: _DIRECTIONS },
  ref_flag:       { folder: "ref_flag",       frames: 4, dirs: _DIRECTIONS },
  ref_whistle:    { folder: "ref_whistle",    frames: 4, dirs: _DIRECTIONS },

  // Newer folders for poses the engine doesn't emit yet (ready when it does)
  pass:      { folder: "pass",      frames: 4, dirs: _DIRECTIONS },
  kick:      { folder: "kick",      frames: 4, dirs: _KICK_DIRS  },
  dodge:     { folder: "dodge",     frames: 4, dirs: _DIRECTIONS },

  // Still fall through to shape math (no good alias):
  // (nothing critical — all engine-emitted poses are now mapped)
};

// Per-(pose,dir,frame) raw image cache. Keyed "pose|dir|frame".
const _spriteCache = {};
// Per-(pose,dir,frame,color) tinted canvas cache.
const _tintCache = new Map();
// Per-sprite body-center cache. Computed ONCE per unique image by scanning
// opaque pixels to find the bounding box. Used to anchor the jersey number
// at the actual back-of-jersey position in EACH POSE, instead of a fixed
// y-offset that only worked for upright poses.
const _bodyCenterCache = new WeakMap();
let _spritesEnabled = false;

// Scan opaque pixels in the image to find body extents. The number sits
// at ~40% from top of the body bbox — that's where the jersey number
// usually lands between the shoulder blades on an upright player, and
// rotates correctly to the upper-torso area when the body is tilted,
// horizontal, or extended (tackled, dive, hurdle).
// Anatomy-based jersey number anchor. Bbox-percentage was a hack —
// the actual jersey number sits between the shoulder blades, just
// below the shoulders. Anatomy is consistent across poses: shoulders
// are always wider than the neck/helmet above them. Scan the sprite
// to find the SHOULDER LINE (first row from top whose width is ≥75%
// of the max row width), then anchor the number a few pixels below.
//
// Properties:
//   - Pose-independent (run/stance/carry/tackled all detect correctly)
//   - Robust to arm swings (a single arm doesn't make a row 75% wide)
//   - Robust to bbox stretch (uses absolute pixel offset from
//     shoulders, not a ratio of bbox height)
//
// Live-tunable: window.GC_NUM_BACK_OFFSET_PX (default 6) — pixels
// below shoulder line in IMAGE coords.
function _computeBodyCenter(img) {
  const cached = _bodyCenterCache.get(img);
  if (cached) return cached;
  const w = img.width, h = img.height;
  const off = document.createElement("canvas");
  off.width = w; off.height = h;
  const c = off.getContext("2d");
  c.drawImage(img, 0, 0);
  let data;
  try { data = c.getImageData(0, 0, w, h).data; }
  catch (_) { return { centerX: w / 2, shoulderY: Math.round(h * 0.28), bboxTop: 0, bboxBottom: h }; }
  // Single pass: bbox + per-row widths + per-row min/max X. Use
  // alpha > 64 to ignore semi-transparent AA edges that would
  // otherwise inflate widths.
  const rowWidths = new Int16Array(h);
  const rowMinXs = new Int16Array(h);
  const rowMaxXs = new Int16Array(h);
  for (let i = 0; i < h; i++) { rowMinXs[i] = -1; rowMaxXs[i] = -1; }
  let minX = w, maxX = 0, minY = h, maxY = 0, count = 0;
  let maxRowWidth = 0;
  for (let y = 0; y < h; y++) {
    let rMinX = w, rMaxX = -1;
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 64) {
        if (x < rMinX) rMinX = x;
        if (x > rMaxX) rMaxX = x;
      }
    }
    if (rMaxX >= 0) {
      const rw = rMaxX - rMinX;
      rowWidths[y] = rw;
      rowMinXs[y] = rMinX;
      rowMaxXs[y] = rMaxX;
      if (rMinX < minX) minX = rMinX;
      if (rMaxX > maxX) maxX = rMaxX;
      if (y < minY) minY = y;
      maxY = y;
      if (rw > maxRowWidth) maxRowWidth = rw;
      count++;
    }
  }
  if (count === 0) return { centerX: w / 2, shoulderY: Math.round(h * 0.28), bboxTop: 0, bboxBottom: h };
  // SHOULDER LINE detection — RESTRICTED TO UPPER HALF of bbox.
  // Anatomy guarantees shoulders sit in the upper portion of any pose
  // (run, stance, tackled-prone — head end is always near the bbox
  // top). Restricting the search avoids being misled by:
  //   - Legs spreading wide in mid-stride (would otherwise inflate
  //     maxRowWidth → threshold never met at actual shoulders)
  //   - Hips wider than shoulders (uncommon but possible)
  //   - Arms extending sideways in catch/dive (low arm-spread)
  // Compute max within the upper half, then scan only the upper half.
  const upperEnd = minY + Math.round((maxY - minY) * 0.55);
  let upperMaxWidth = 0;
  for (let y = minY; y <= upperEnd; y++) {
    if (rowWidths[y] > upperMaxWidth) upperMaxWidth = rowWidths[y];
  }
  const widthThreshold = upperMaxWidth * 0.75;
  let shoulderY = minY;
  for (let y = minY; y <= upperEnd; y++) {
    if (rowWidths[y] >= widthThreshold) {
      shoulderY = y;
      break;
    }
  }
  // TORSO CENTER X at shoulder level. Bbox center X is pulled by
  // swung arms / diagonal body extent — for a body even slightly
  // angled, bbox-center sits off the actual back surface. Average
  // the row-centers across a few rows just below the shoulder line
  // for the true torso/back center at the right Y.
  let torsoCenterX = (minX + maxX) / 2;
  let cxSum = 0, cxCount = 0;
  const sampleEnd = Math.min(maxY, shoulderY + 10);
  for (let y = shoulderY; y <= sampleEnd; y++) {
    if (rowMaxXs[y] >= 0) {
      cxSum += (rowMinXs[y] + rowMaxXs[y]) / 2;
      cxCount++;
    }
  }
  if (cxCount > 0) torsoCenterX = cxSum / cxCount;

  const result = {
    centerX: torsoCenterX,
    bboxCenterX: (minX + maxX) / 2,
    shoulderY,
    bboxTop: minY,
    bboxBottom: maxY,
  };
  _bodyCenterCache.set(img, result);
  return result;
}

function _loadSprite(pose, dir, frame) {
  const def = _SPRITE_POSES[pose];
  if (!def) return;
  const folder = def.folder || pose;
  // Match the lookup key format in drawPlayerSprite: empty string for
  // single-frame (frame=null), numeric for multi-frame. Previously stored
  // as the literal "null" via template-literal stringification — that
  // mismatch caused all 1-frame poses (idle) to 404 at draw time.
  const key = `${pose}|${dir}|${frame == null ? "" : frame}`;
  if (_spriteCache[key] !== undefined) return;
  const fname = frame == null
    ? `${dir}.png`
    : `${dir}_${frame}.png`;
  const url = `${_SPRITE_BASE_URL}${folder}/${fname}`;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload  = () => { _spriteCache[key] = img; _spritesEnabled = true; };
  img.onerror = () => { _spriteCache[key] = null; };
  img.src = url;
  _spriteCache[key] = "loading";
}

function _preloadAllSprites() {
  for (const pose of Object.keys(_SPRITE_POSES)) {
    const def = _SPRITE_POSES[pose];
    for (const dir of def.dirs) {
      if (def.frames === 1) {
        _loadSprite(pose, dir, null);
      } else {
        for (let f = 0; f < def.frames; f++) _loadSprite(pose, dir, f);
      }
    }
  }
}

// Last-call diagnostic — populated by drawPlayerSprite for debug.
const _lastMiss = { pose: null, dir: null, reason: null, count: 0 };
// Per-pose hit/miss histogram. Cleared via SpriteAtlas.resetCounters().
const _hits = Object.create(null);
const _misses = Object.create(null);
function _bumpHit(pose)   { _hits[pose] = (_hits[pose] || 0) + 1; }
function _bumpMiss(pose, reason) {
  const key = `${pose}::${reason}`;
  _misses[key] = (_misses[key] || 0) + 1;
}

// Public API
const SpriteAtlas = {
  preload: _preloadAllSprites,
  anyLoaded: () => _spritesEnabled,
  // Diagnostic — report what's loaded and what's not. Call from devtools:
  //   SpriteAtlas.stats()
  stats: () => {
    let loaded = 0, loading = 0, missing = 0;
    for (const k in _spriteCache) {
      const v = _spriteCache[k];
      if (v === "loading") loading++;
      else if (v == null) missing++;
      else loaded++;
    }
    return {
      enabled: _spritesEnabled,
      total: Object.keys(_spriteCache).length,
      loaded, loading, missing,
      lastMiss: { ..._lastMiss },
      poseKeys: Object.keys(_SPRITE_POSES),
    };
  },
  // Inspect a specific cache entry. e.g. SpriteAtlas.peek('run','south',0)
  peek: (pose, dir, frame) => {
    const key = `${pose}|${dir}|${frame == null ? "" : frame}`;
    return { key, value: _spriteCache[key] };
  },
  // Per-pose hit/miss histogram. Counts since page load (or since reset).
  counters: () => ({ hits: { ..._hits }, misses: { ..._misses } }),
  resetCounters: () => {
    for (const k in _hits) delete _hits[k];
    for (const k in _misses) delete _misses[k];
  },
};

// Pixel-precise tint: replace WHITE pixels only with team color, preserve
// dark detail (visor, gloves, outline) so the sprite doesn't go uniformly
// blue/dark under multiply blend. Cached per (sprite, color).
function _tintedSprite(srcImg, key, hexColor) {
  let cached = _tintCache.get(key);
  if (cached) return cached;
  // Parse hex color
  const c = hexColor.replace("#", "");
  const cr = parseInt(c.slice(0, 2), 16);
  const cg = parseInt(c.slice(2, 4), 16);
  const cb = parseInt(c.slice(4, 6), 16);
  const off = document.createElement("canvas");
  off.width = srcImg.width;
  off.height = srcImg.height;
  const octx = off.getContext("2d");
  octx.drawImage(srcImg, 0, 0);
  // Read pixels and selectively tint white-ish ones
  try {
    const img = octx.getImageData(0, 0, srcImg.width, srcImg.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
      if (a === 0) continue;
      // Treat near-white (R,G,B all > 180 AND all within 30 of each other) as jersey/pad surface.
      // Replace with tint color but preserve relative brightness.
      if (r > 180 && g > 180 && b > 180 &&
          Math.abs(r - g) < 30 && Math.abs(g - b) < 30 && Math.abs(r - b) < 30) {
        // Brightness factor: 1.0 for pure white, ~0.72 for the darkest "white" (180/255).
        const brightness = (r + g + b) / (3 * 255);
        d[i]   = Math.round(cr * brightness);
        d[i+1] = Math.round(cg * brightness);
        d[i+2] = Math.round(cb * brightness);
      }
      // else: preserve original pixel (visor, gloves, outline, etc.)
    }
    octx.putImageData(img, 0, 0);
  } catch (e) {
    // CORS or other error → fall back to multiply tint
    octx.globalCompositeOperation = "multiply";
    octx.fillStyle = hexColor;
    octx.fillRect(0, 0, srcImg.width, srcImg.height);
    octx.globalCompositeOperation = "destination-in";
    octx.drawImage(srcImg, 0, 0);
  }
  _tintCache.set(key, off);
  return off;
}

// Settled poses: instead of cycling through all animation frames on the
// engine's free-running clock (which makes every player visibly "get into
// stance" over and over), pick a role-appropriate hold frame and keep it.
// PixelLab stance frame layout (verified per south_*.png):
//   0: upright (WR/QB/RB/DB resting)
//   1: slight crouch (almost identical to 0)
//   2: 3-point stance — hand down, lineman set
//   3: 2-point stance — medium crouch, LB-style set
const _SETTLED_POSES = new Set(["stance", "idle", "point"]);

// Role → category. Linemen always hold the line stance; LBs hold a
// 2-point set except when actively pointing pre-snap.
const _LINE_ROLES = new Set([
  "OL","C","G","T","LG","RG","LT","RT",
  "DL","DE","DT","NT",
  "TE","TE1","TE2",
]);
const _LB_ROLES = new Set([
  "LB","MLB","OLB","ILB","ROLB","LOLB","WLB","SLB",
]);

function _stableHash(s) {
  let h = 2166136261;
  if (!s) return 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

function _settledFrame(pose, label, frames, role) {
  if (!frames || frames <= 1) return 0;
  // Linemen are at the LOS in their stance regardless of which settled
  // pose the engine emits — run plays use "stance" for OL pre-snap, pass
  // plays fall through to "idle". Both should render the 3-point set.
  if (_LINE_ROLES.has(role)) return 2;
  // LBs hold a 2-point crouch unless they're the pre-snap pointer
  // (pose="point" → upright, mimicking the call-out).
  if (_LB_ROLES.has(role)) return pose === "point" ? 0 : 3;
  // Skill players: frame 0 with a sparse, deterministic twitch so the
  // pre-snap shot isn't perfectly still. ~18% of players twitch briefly
  // (8% of a 2.0–5.5s period) to a random non-zero frame.
  const h = _stableHash((label || "") + "|" + pose);
  if ((h % 100) >= 18) return 0;
  const periodMs = 2000 + (h % 3500);
  const offsetMs = h % periodMs;
  const phase = ((performance.now() + offsetMs) % periodMs) / periodMs;
  if (phase < 0.08) return 1 + ((h >>> 8) % (frames - 1));
  return 0;
}

// Poses where the sprite direction should come from FACING, not
// velocity. Used for "moving backward but facing forward" actions:
// QB dropping back from the snap, DB backpedaling into coverage. Real
// motion is opposite the facing — using velocity here would render
// the player turned around ("looking away from the play"), and small
// EMA fluctuations would flip the sprite each frame = visible spasms.
const _FACING_ONLY_POSES = new Set(["drop_step", "backpedal"]);

// Map (vx, vy, facing) → 8-direction string. Velocity wins if moving;
// otherwise fall back to facing (±1 = east/west — matches the L/R axis
// the engine uses for facing).
function _velocityToDirection(vx, vy, facing) {
  if (Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) {
    return (facing == null || facing >= 0) ? "east" : "west";
  }
  // atan2 returns (-π, π] with 0 = east; map to 8 octants.
  // +y is DOWN (south) on canvas, so negate vy for CCW math-angle.
  const ang = Math.atan2(-vy, vx);   // -π..π, CCW from east
  let octant = Math.round((ang / (Math.PI / 4)) + 8) % 8;
  // _DIRECTIONS index order: 0=east, 1=NE, 2=N, 3=NW, 4=W, 5=SW, 6=S, 7=SE
  return _DIRECTIONS[octant];
}

// Draw the player using a sprite if available. Returns true if drawn,
// false if the caller should fall back to shape rendering.
// `ctx` must already be translated to the player's local origin.
// `vx`, `vy` are recent velocity (used to pick the 8-direction sprite).
// `facing` is the L/R heading sign (used when stationary).
// `t` is the pose-internal time (0..1 for animation cycles).
function drawPlayerSprite(ctx, pose, t, vx, vy, teamPrimary, facing, label, secondary, style) {
  if (!_spritesEnabled) { _lastMiss.pose=pose; _lastMiss.reason="atlas-disabled"; _lastMiss.count++; _bumpMiss(pose,"atlas-disabled"); return false; }
  // Lineman/LB pose re-bucketing — the engine emits "idle" for OL pre-snap
  // on pass plays (line 4359 in play-animation.js, default catch-all), but
  // a lineman is never truly "idle"; they're set at the LOS. Reroute to
  // the multi-frame "stance" folder so _settledFrame can pick the
  // position-appropriate frame (3-point / 2-point).
  const _role = style && style.role;
  if (pose === "idle" && (_LINE_ROLES.has(_role) || _LB_ROLES.has(_role))) {
    pose = "stance";
  }
  const def = _SPRITE_POSES[pose];
  if (!def) { _lastMiss.pose=pose; _lastMiss.reason="unknown-pose"; _lastMiss.count++; _bumpMiss(pose,"unknown-pose"); return false; }
  const dir = pose === "drop_step"
    ? (facing == null || facing >= 0 ? "south-east" : "south-west")
    : _FACING_ONLY_POSES.has(pose)
      ? (facing == null || facing >= 0 ? "east" : "west")
      : _velocityToDirection(vx || 0, vy || 0, facing);
  if (!def.dirs.includes(dir)) { _lastMiss.pose=pose; _lastMiss.dir=dir; _lastMiss.reason="dir-not-in-pose"; _lastMiss.count++; _bumpMiss(pose,"dir-not-in-pose"); return false; }
  const frameIdx = def.frames > 1
    ? (_SETTLED_POSES.has(pose)
        ? _settledFrame(pose, label, def.frames, style && style.role)
        : Math.floor(Math.max(0, Math.min(0.999, t)) * def.frames))
    : null;
  const key = `${pose}|${dir}|${frameIdx == null ? "" : frameIdx}`;
  const src = _spriteCache[key];
  if (!src || src === "loading") { _lastMiss.pose=pose; _lastMiss.dir=dir; _lastMiss.reason=src==="loading"?"still-loading":"404-or-missing"; _lastMiss.count++; _bumpMiss(pose,src==="loading"?"still-loading":"404-or-missing"); return false; }
  _bumpHit(pose);
  const tinted = teamPrimary
    ? _tintedSprite(src, `${key}|${teamPrimary}`, teamPrimary)
    : src;
  const scale = (typeof window !== "undefined" && window.GC_SPRITE_SCALE)
    ? window.GC_SPRITE_SCALE
    : _SPRITE_SCALE;
  const fw = src.width * scale;
  const fh = src.height * scale;
  // Draw with feet at the local origin (procedural _drawPlayerImpl puts
  // feet at (x,y)). PixelLab sprites have head at top, feet near bottom,
  // so the foot is at ~+_SPRITE_FOOT_OFFSET_Y * sprite_height from center.
  const foot = (typeof window !== "undefined" && window.GC_SPRITE_FOOT_OFFSET_Y != null)
    ? window.GC_SPRITE_FOOT_OFFSET_Y
    : _SPRITE_FOOT_OFFSET_Y;
  // Draw position: sprite occupies ctx [-fw/2, top] to [fw/2, top+fh],
  // where top = -fh/2 - fh*foot. We need this to convert image-space
  // jersey position to ctx coordinates.
  const top = -fh / 2 - fh * foot;
  // Ragdoll rotation + Y offset come from physics integration on
  // style._ragdoll (populated by play-animation.js initRagdoll +
  // stepRagdoll). Apply the rotation around the body center so the
  // sprite tumbles with the physics. _ragdoll.rot is radians;
  // _ragdoll.dy is the downward drop from impact + gravity.
  const _rd = (pose === "ragdoll") ? (style && style._ragdoll) : null;
  if (_rd) {
    ctx.save();
    ctx.translate(0, _rd.dy || 0);
    ctx.rotate(_rd.rot || 0);
    ctx.drawImage(tinted, -fw / 2, top, fw, fh);
    ctx.restore();
  } else {
    ctx.drawImage(tinted, -fw / 2, top, fw, fh);
  }
  // ── Jersey-number overlay at the ACTUAL back-of-jersey position ──
  // Sample the source image to find where the body sits in THIS frame,
  // then place the number at the upper-back point of the body bbox.
  // Adapts to every pose: standing puts number ~upper back, tackled
  // puts it low on the horizontal body, dive puts it on mid-torso.
  //
  // Skip in pure profile (east/west) — the jersey number lives on the
  // BACK and CHEST of the jersey, not on the side. Showing it in profile
  // makes it read as a floating sticker rather than stitched fabric.
  // Diagonals (NE/NW/SE/SW) still show some of the back or chest, so
  // we keep the number there.
  // Only show the jersey number when the BACK is visible to the
  // camera. That's north (back facing camera), NE, and NW (back
  // partially visible at angle). South, SE, SW have the chest facing
  // camera — back is hidden, so a number painted on the chest reads
  // as a floating sticker (especially on top-down sprites where the
  // visible chest area is mostly helmet). East/west are pure profile.
  const _backVisible = (dir === "north" || dir === "north-east" || dir === "north-west");
  if (_backVisible && label != null && label !== "") {
    // Reference shoulder Y from south frame 0 (consistent across all
    // directions/frames of a pose; avoids cluster-of-players Y drift).
    const _refKey = `${pose}|south|${def.frames > 1 ? "0" : ""}`;
    const _refImg = _spriteCache[_refKey];
    const _refSrc = (_refImg && _refImg !== "loading") ? _refImg : src;
    const bcRef = _computeBodyCenter(_refSrc);
    const bcCurrent = (_refSrc === src) ? bcRef : _computeBodyCenter(src);
    const _backOffset = (typeof window !== "undefined" && window.GC_NUM_BACK_OFFSET_PX != null)
      ? window.GC_NUM_BACK_OFFSET_PX : 6;
    // Per-direction BACK position offset. The back surface sits
    // OPPOSITE the facing direction. For NE-facing (body angled
    // upper-right), back is at SW (lower-left of body), so shift the
    // anchor LEFT + DOWN. For NW (body upper-left), back is at SE
    // (lower-right), shift RIGHT + DOWN. N has back directly behind
    // the body — no offset.
    //
    // Previously used torsoCenterX (avg of row centers below shoulderY)
    // which sampled the UPPER body. For diagonals the upper body sits
    // on the FRONT-shoulder side (opposite the back), so torsoCenterX
    // pulled the number ONTO a shoulder pad. Use bboxCenterX as the
    // base + explicit per-direction shift toward the actual back.
    // Live-tunable via window.GC_NUM_DIAG_BACK_DX / _DY.
    const _diagDx = (typeof window !== "undefined" && window.GC_NUM_DIAG_BACK_DX != null) ? window.GC_NUM_DIAG_BACK_DX : 5;
    const _diagDy = (typeof window !== "undefined" && window.GC_NUM_DIAG_BACK_DY != null) ? window.GC_NUM_DIAG_BACK_DY : 3;
    let dxOff = 0, dyOff = 0;
    if (dir === "north-east")      { dxOff = -_diagDx; dyOff = _diagDy; }
    else if (dir === "north-west") { dxOff =  _diagDx; dyOff = _diagDy; }
    const upperBackY_img = bcRef.shoulderY + _backOffset + dyOff;
    const cx = (bcCurrent.bboxCenterX - src.width / 2 + dxOff) * scale;
    const cy = top + (upperBackY_img / src.height) * fh;
    _drawJerseyNumber(ctx, String(label), secondary, cx, cy, scale, dir);
  }
  return true;
}

// Per-direction perspective transform — text follows body angle instead
// of staying axis-aligned. Tuned for the PixelLab "low top-down" view
// where diagonals tilt the body ~30° and compress horizontal width.
//
//   E/W: skipped above (no jersey number on a profile view)
//   N:   no transform (back facing camera, flat)
//   S:   no transform (chest facing camera, flat)
//   NE:  body tilts so back-right is closest to camera — number leans
//        right; horizontal compressed to ~0.75 (foreshortened back)
//   NW:  mirror of NE — leans left
//   SE:  body tilts so chest-right is closest — number leans right too
//   SW:  mirror of SE — leans left
// Live-tunable via window.GC_NUM_DIAG_ROT / window.GC_NUM_DIAG_SX so
// the diagonal perspective can be iterated without a redeploy. Defaults
// reflect PixelLab's "low top-down" camera, which projects a 45° body
// rotation as ~26° of visible shoulder tilt (more aggressive than the
// previous 18° — user reported the diagonals "look too flat").
function _diagTx() {
  // Subtle perspective. Aggressive values (rot 0.45, sx 0.70) made
  // numbers look like they were "peeling off the bottom of the
  // jersey" — too much tilt + too much horizontal squish reads as
  // deformed cloth, not as a stitched number on an angled surface.
  const rot = (typeof window !== "undefined" && window.GC_NUM_DIAG_ROT != null) ? window.GC_NUM_DIAG_ROT : 0.22;
  const sx  = (typeof window !== "undefined" && window.GC_NUM_DIAG_SX  != null) ? window.GC_NUM_DIAG_SX  : 0.88;
  return { rot, sx };
}
const _NUM_TX_BY_DIR = {
  "north":      { sx: 1.00, rot:  0.00 },
  "south":      { sx: 1.00, rot:  0.00 },
  "north-east": null,   // back tilted away from camera — leans right
  "north-west": null,   // mirror of NE — leans left
  "south-east": null,   // chest tilted toward camera — leans right
  "south-west": null,   // mirror of SE — leans left
};

// Render a chunky pixel-art-style jersey number at (cx, cy) in ctx
// local coords. 3-layer stitched look: black outline → main color → 1-px
// inner shadow. Pixel-aligned positions. Font size scales with sprite scale.
// Applies per-direction skew/scale so text follows the body's perspective.
function _drawJerseyNumber(ctx, label, secondary, cx, cy, scale, dir) {
  const numSize = (typeof window !== "undefined" && window.GC_SPRITE_TEXT_SIZE != null)
    ? window.GC_SPRITE_TEXT_SIZE : Math.round(13 * scale);
  const x = Math.round(cx);
  const y = Math.round(cy);
  // Diagonal directions read the live-tunable transform; cardinals use
  // their constant entries (no tilt for N/S, no number for E/W).
  // Rotation sign derived from each direction's shoulder line:
  //   - Body's "right" axis is 90° CW from its facing direction.
  //   - The shoulder line in the sprite connects left shoulder to
  //     right shoulder. Its slope determines the rotation needed for
  //     the number on the back/chest to align with the body.
  //   - Canvas positive rotation = CW visually → text top edge gets
  //     positive slope (goes down as we go right).
  //
  // Signs from the shoulder-line geometric derivation. The opposite
  // signs (NE=-1, NW=+1) made the numbers visually "peel off the
  // bottom of the jersey" — the tilt angled them off the back surface
  // instead of along it.
  const _DIAG_ROT_SIGN = {
    "north-east": +1, "north-west": -1,
    "south-east": -1, "south-west": +1,
  };
  let tx = _NUM_TX_BY_DIR[dir];
  if (tx === null) {
    const d = _diagTx();
    tx = { sx: d.sx, rot: d.rot * (_DIAG_ROT_SIGN[dir] || 0) };
  }
  if (!tx) tx = { sx: 1.00, rot: 0.00 };
  ctx.save();
  // Per-direction transform: translate to the text anchor, rotate to
  // match the body's tilt, scale-X to foreshorten on diagonals.
  ctx.translate(x, y);
  ctx.rotate(tx.rot);
  ctx.scale(tx.sx, 1);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${numSize}px "Courier New", monospace`;
  // 1. Black stroke outline ("thread border")
  ctx.lineWidth = Math.max(1, 1.4 * scale);
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(label, 0, 0);
  // 2. Main color fill (jersey-stitch color)
  ctx.fillStyle = secondary || "#fff";
  ctx.fillText(label, 0, 0);
  // 3. 1-pixel inner shadow + repaint (embossed look)
  ctx.fillStyle = "rgba(0,0,0,0.30)";
  ctx.fillText(label, 1, 1);
  ctx.fillStyle = secondary || "#fff";
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

// Auto-preload at module load.
if (typeof window !== "undefined") {
  setTimeout(_preloadAllSprites, 0);
  window.SpriteAtlas = SpriteAtlas;
  window.drawPlayerSprite = drawPlayerSprite;
}
