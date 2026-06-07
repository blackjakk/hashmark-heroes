// ─── Player physics simulation primitives ───────────────────────────────
//
// Used by play-animation.js to replace the per-defender tween model with
// actual physics. Each SimPlayer has position, velocity, max speed, and
// acceleration. Defenders pursue a moving carrier by computing INTERCEPT
// points (where the carrier WILL be when the defender can reach them)
// rather than chasing the carrier's current spot — produces realistic
// angles where a defender cuts across the field rather than chasing in
// a straight line.
//
// Engine outcomes (yards, named tackler) still drive the play; the sim
// is the visual layer that makes those outcomes look like real football.

// All constants in PIXELS (matches FIELD coords). 1 yard = 15 px.
const SIM_DEFAULT_MAX_SPEED = 9.5 * 15;     // ≈ 142 px/s — top NFL DB speed
// Lower default accel so the spool-up from rest is VISIBLE in the
// animation (was 18 yd/s² which hit top speed in 0.53s — looked nearly
// instant). 10 yd/s² hits top in ~1s — clear "build-up" motion.
const SIM_DEFAULT_ACCEL     = 10.0 * 15;    // ≈ 150 px/s²
const SIM_CONTACT_RADIUS    = 12;           // ≈ 0.8 yd — circle radius for collision

function _len(x, y) { return Math.sqrt(x * x + y * y); }

class SimPlayer {
  constructor(x, y, opts = {}) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.maxSpeed = opts.maxSpeed != null ? opts.maxSpeed : SIM_DEFAULT_MAX_SPEED;
    this.accel    = opts.accel    != null ? opts.accel    : SIM_DEFAULT_ACCEL;
    this.radius   = opts.radius   != null ? opts.radius   : SIM_CONTACT_RADIUS;
    this._lastMs  = null;
  }

  // Accelerate toward (tx, ty) and integrate by dt seconds. Cap velocity
  // at maxSpeed. dt is in SECONDS, not ms.
  stepToward(tx, ty, dt) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = _len(dx, dy);
    if (d > 0.001) {
      // Apply acceleration along the direction to target
      this.vx += (dx / d) * this.accel * dt;
      this.vy += (dy / d) * this.accel * dt;
    }
    // Cap speed
    const speed = _len(this.vx, this.vy);
    if (speed > this.maxSpeed) {
      this.vx = (this.vx / speed) * this.maxSpeed;
      this.vy = (this.vy / speed) * this.maxSpeed;
    }
    // Integrate position
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  // Step using a wall-clock timestamp (ms). Returns the dt actually
  // integrated so callers can detect skipped frames.
  stepTowardAt(tx, ty, nowMs) {
    if (this._lastMs == null) { this._lastMs = nowMs; return 0; }
    const dt = Math.min(0.05, Math.max(0, (nowMs - this._lastMs) / 1000));
    this._lastMs = nowMs;
    if (dt > 0) this.stepToward(tx, ty, dt);
    return dt;
  }

  // Distance to another SimPlayer (or {x,y} point) in yards.
  distanceTo(other) {
    return _len(other.x - this.x, other.y - this.y);
  }

  // Circle-vs-circle collision check. Returns true if our radii overlap.
  collides(other) {
    const r = (this.radius + (other.radius || SIM_CONTACT_RADIUS));
    return this.distanceTo(other) < r;
  }
}

// Compute the intercept point — where the defender should AIM to catch
// the carrier given the carrier's current velocity. Uses an iterative
// solution since the closed-form is gnarly. ~3 iterations converges.
//
// carrier: { x, y, vx, vy } — units in yards / yards-per-second
// defender: SimPlayer
// Returns: { x, y, t } — the intercept point and time-to-intercept.
//   If no intercept is possible (carrier outruns defender), returns the
//   carrier's CURRENT position with t = Infinity, so the defender just
//   chases directly (best-effort).
function simIntercept(defender, carrier, opts) {
  const cs = _len(carrier.vx || 0, carrier.vy || 0);
  // No intercept needed if carrier is stationary
  if (cs < 0.1) return { x: carrier.x, y: carrier.y, t: 0 };
  // Carrier outruns defender — chase the current spot
  if (cs >= defender.maxSpeed) return { x: carrier.x, y: carrier.y, t: Infinity };
  // Iterative solve — start with time-to-current-position, then update
  let t = defender.distanceTo(carrier) / defender.maxSpeed;
  for (let i = 0; i < 4; i++) {
    const tx = carrier.x + (carrier.vx || 0) * t;
    const ty = carrier.y + (carrier.vy || 0) * t;
    const d = _len(tx - defender.x, ty - defender.y);
    const newT = d / defender.maxSpeed;
    if (Math.abs(newT - t) < 0.02) { t = newT; break; }
    t = newT;
  }
  // CAP THE LEAD. The solve assumes CONSTANT carrier velocity, so for a far
  // defender t can be 2-3s and the aim projects WAY down the current heading.
  // If the carrier cuts back, that lead is stale and the defender overshoots
  // to empty grass. A real defender reads ~0.5-0.8s ahead, then re-reads each
  // frame (this is re-solved every frame). Clamp t so the lead is bounded;
  // the per-frame re-solve still converges the angle without chasing a phantom
  // far-downfield point. Default 0.8s; caller can override via opts.maxLeadT.
  const maxLeadT = (opts && opts.maxLeadT != null) ? opts.maxLeadT : 0.8;
  if (t > maxLeadT) t = maxLeadT;
  return {
    x: carrier.x + (carrier.vx || 0) * t,
    y: carrier.y + (carrier.vy || 0) * t,
    t,
  };
}

// Convert pixel positions to yard-space and back. The sim works in
// yards so physics constants are intuitive (NFL speeds are quoted in
// yards/sec). Pixel coords come from FIELD.PX_PER_YARD.
function pxToYards(px, pxPerYard) { return px / pxPerYard; }
function yardsToPx(yd, pxPerYard) { return yd * pxPerYard; }

// ─── Trench engagement primitives ──────────────────────────────────────
//
// Phase-1 first-principles rebuild of OL/DL line play. The trench is no
// longer scripted (OL drop with a wobble, DL "barely move"). Each pair
// of contacting bodies becomes one Engagement: blocker + defender locked
// to a moving anchor, with a leverage scalar that drifts the anchor
// along the defender's attack axis. The pocket on pass plays emerges
// from the centroid of held anchors — it isn't a fixed spot.
//
// IMPORTANT: Engagement owns ITS OWN copy of each body's x/y. Caller
// reads engagement.blockerX/Y and .defenderX/Y to drive rendering.
// This avoids mutating formation-shared player objects.
class Engagement {
  // blockerKey/defenderKey are opaque identity tokens — typically the
  // formation player reference. The Engagement only uses them for
  // lookup (engagementFor); positions are stored on the Engagement.
  //
  // BLOCKER-ANCHORED model (forms a pocket cup):
  //   The blocker rides toward (home + setback + pressureDrift). The
  //   defender stays locked a short depth on the DEFENSE side of the
  //   blocker. So the pocket shape comes from per-blocker setbacks
  //   (tackles deep + wide, center shallow) and compresses under
  //   pressure as the drift grows. The DL follows its man — it doesn't
  //   independently bull a shared midpoint (which produced a flat wall).
  //
  // opts:
  //   axisX, axisY: unit vector — defender's attack direction (toward QB)
  //   leverage:    -1..+1 — negative = defender winning → blocker driven
  //                back toward the QB.
  //   homeX/Y:     blocker's pre-snap spot (the cup is built off this)
  //   setbackX/Y:  resting offset from home that shapes the pocket cup
  //   defX/Y:      defender's pre-snap spot (start position only)
  //   lockDepth:   px the defender sits on the defense side of the blocker
  //   driftPx:     px/frame the pressure drift grows at full |leverage|
  //   pull:        EMA strength toward targets
  //   wobble:      lateral jitter so the lock-up reads alive
  constructor(blockerKey, defenderKey, opts = {}) {
    this.blockerKey = blockerKey;
    this.defenderKey = defenderKey;
    this.axisX = opts.axisX != null ? opts.axisX : -1;
    this.axisY = opts.axisY != null ? opts.axisY :  0;
    this.leverage = opts.leverage || 0;
    this.shed = false;
    this.startMs = null;
    this.homeX = opts.homeX;
    this.homeY = opts.homeY;
    this.setbackX = opts.setbackX || 0;
    this.setbackY = opts.setbackY || 0;
    this.lockDepth = opts.lockDepth != null ? opts.lockDepth : 8;
    this.driftPx  = opts.driftPx  != null ? opts.driftPx  : 0.95;
    this.pull     = opts.pull     != null ? opts.pull     : 0.30;
    this.wobble   = opts.wobble   != null ? opts.wobble   : 1.0;
    this.wobblePhase = Math.random() * Math.PI * 2;
    // Accumulated pressure drift (grows along axis toward the QB).
    this.driftX = 0;
    this.driftY = 0;
    // Position state.
    this.blockerX = opts.homeX;
    this.blockerY = opts.homeY;
    this.defenderX = opts.defX != null ? opts.defX : opts.homeX;
    this.defenderY = opts.defY != null ? opts.defY : opts.homeY;
    // Anchor exposed for pocketCenter() — tracks the blocker.
    this.anchorX = this.blockerX;
    this.anchorY = this.blockerY;
  }

  step(nowMs) {
    if (this.shed) return;
    if (this.startMs == null) this.startMs = nowMs;
    const elapsed = nowMs - this.startMs;
    // Frame-time factor — normalize drift accumulation to a 60fps step
    // so the pocket collapses at the same RATE regardless of display
    // refresh (a 120Hz monitor stepped twice as often and caved the
    // pocket twice as fast). Clamped 0..3 so a long stall between
    // frames can't lurch the drift.
    const _gcSlow = (typeof window !== "undefined" && window._GC_SLOWF != null) ? window._GC_SLOWF : 1;
    const dtF = (this._lastStepMs == null ? 1
              : Math.max(0, Math.min(3, (nowMs - this._lastStepMs) / 16.67))) * _gcSlow;
    this._lastStepMs = nowMs;
    // Pressure drift accumulates along the defender's attack axis when
    // leverage is negative (rush winning) → blocker pushed toward QB.
    // Capped so a long rep can't collapse the pocket to absurd depth
    // (the QB is ~5yd back; ~3.5yd of give reads as a caved pocket
    // without the line sliding into the backfield).
    const MAX_DRIFT = 52;   // px ≈ 3.5yd
    this.driftX += this.axisX * this.driftPx * -this.leverage * dtF;
    this.driftY += this.axisY * this.driftPx * -this.leverage * dtF;
    const _dmag = Math.hypot(this.driftX, this.driftY);
    if (_dmag > MAX_DRIFT) {
      this.driftX = (this.driftX / _dmag) * MAX_DRIFT;
      this.driftY = (this.driftY / _dmag) * MAX_DRIFT;
    }
    const w = Math.sin((elapsed / 220) + this.wobblePhase) * this.wobble;
    const perpX = -this.axisY;
    const perpY =  this.axisX;
    // Blocker rides to home + setback (the cup shape) + accumulated drift.
    const bTx = this.homeX + this.setbackX + this.driftX + perpX * w;
    const bTy = this.homeY + this.setbackY + this.driftY + perpY * w;
    this.blockerX += (bTx - this.blockerX) * this.pull;
    this.blockerY += (bTy - this.blockerY) * this.pull;
    // Defender locks a short depth on the DEFENSE side of the blocker
    // (−axis = away from QB = downfield). Stays glued to its man.
    const dTx = this.blockerX - this.axisX * this.lockDepth + perpX * w * -0.6;
    const dTy = this.blockerY - this.axisY * this.lockDepth + perpY * w * -0.6;
    this.defenderX += (dTx - this.defenderX) * this.pull;
    this.defenderY += (dTy - this.defenderY) * this.pull;
    this.anchorX = this.blockerX;
    this.anchorY = this.blockerY;
  }

  releaseShed() { this.shed = true; }
}

// PassProSim — owner of the pass-protection engagement set + pocket calc.
//
// One per pass play. Construct after formation is built, add OL↔DL pairs,
// step each render frame, query for positions and pocket center.
class PassProSim {
  constructor(opts = {}) {
    this.engagements = [];
    this.dir = opts.dir || 1;          // offense direction (+1 = +X)
    this.losX = opts.losX || 0;
  }

  // Add a blocker↔defender engagement. `lanePx` is the blocker's Y
  // offset from the pocket center (0 = center, ±32 = guard, ±64 = tackle).
  // It shapes the cup: tackles set deepest and widen outward, the center
  // holds firmest. Defender attacks toward -dir (toward QB) by default.
  addPair(blocker, defender, opts = {}) {
    const lanePx = opts.lanePx || 0;
    const absLane = Math.abs(lanePx);
    // Pocket cup. setbackX is along -dir (retreat); deeper for wider OL
    // so tackles sit ~2yd behind the center → backward-bowing arc.
    // setbackY widens the cup mouth (tackles kick outward).
    const setbackX = -this.dir * (6 + absLane * 0.45);   // center ~6px, tackle ~35px (~2.3yd)
    const setbackY = (lanePx === 0 ? 0 : Math.sign(lanePx)) * absLane * 0.18;
    const eng = new Engagement(blocker, defender, {
      axisX: -this.dir,
      axisY: 0,
      homeX: blocker.x, homeY: blocker.y,
      defX: defender.x, defY: defender.y,
      setbackX, setbackY,
      leverage: opts.leverage || 0,
      lockDepth: opts.lockDepth,
      driftPx:  opts.driftPx,
      pull:     opts.pull,
      wobble:   opts.wobble,
    });
    this.engagements.push(eng);
    return eng;
  }

  step(nowMs) {
    for (const e of this.engagements) e.step(nowMs);
  }

  // Engagement that holds this player as blocker or defender, or null.
  engagementFor(player) {
    for (const e of this.engagements) {
      if (e.blockerKey === player || e.defenderKey === player) return e;
    }
    return null;
  }

  // Pocket centroid — average of held-block ANCHORS, shifted ~1 yd behind
  // (on the QB side of the LOS). Excludes shed engagements. Returns null
  // when nothing's holding (rare but possible if every DL sheds).
  pocketCenter(pxPerYard) {
    const yd = pxPerYard || 15;
    let sx = 0, sy = 0, n = 0;
    for (const e of this.engagements) {
      if (e.shed) continue;
      sx += e.blockerX - this.dir * yd;   // ~1yd behind blocker
      sy += e.blockerY;
      n++;
    }
    return n === 0 ? null : { x: sx / n, y: sy / n };
  }
}

// ─── Run-blocking engagement primitives ────────────────────────────────
//
// First-principles run trench: every engaged OL↔DL pair is a rep with a
// WIN factor. A winning OL (win>0) drives his DL downfield (+dir) AND
// laterally OUT of the hole — that lateral SEAL is what opens the lane the
// carrier runs through. A holding rep (small win) just locks up at the LOS.
// The one DL that beats his block ("penetrator") is NOT added to the sim —
// the animation drives his pursuit of the carrier. So the hole the carrier
// hits is the negative space left by the winning seals, not a scripted lane.
//
// Like Engagement, each pair owns its own copy of the OL/DL positions; the
// caller reads pair.olX/olY and .dlX/.dlY. dt-scaled so the drive rate is
// refresh-independent.
class RunBlockEngagement {
  constructor(ol, dl, opts = {}) {
    this.olKey = ol;
    this.dlKey = dl;
    this.dir = opts.dir || 1;
    this.win = opts.win || 0;                       // -1..+1, + = OL wins the rep
    this.contactX = opts.contactX;                  // engagement-line X (downfield of LOS)
    this.contactY = opts.contactY != null ? opts.contactY : dl.y;  // OL slides to the DL's lane
    this.sealSign = opts.sealSign || 0;             // lateral push of the DL AWAY from the hole (±1)
    this.lockDepth = opts.lockDepth != null ? opts.lockDepth : 12;
    this.pull     = opts.pull     != null ? opts.pull     : 0.16;
    this.driftPx  = opts.driftPx  != null ? opts.driftPx  : 0.6;
    this.shed = false;
    this.olX = ol.x; this.olY = ol.y;
    this.dlX = dl.x; this.dlY = dl.y;
    this.dlHomeX = dl.x; this.dlHomeY = dl.y;        // DL's pre-snap anchor
    this.driveX = 0; this.driveY = 0;
    this.startMs = null; this._lastMs = null;
    this.wobblePhase = Math.random() * Math.PI * 2;
  }
  step(nowMs) {
    if (this.startMs == null) this.startMs = nowMs;
    const _gcSlow = (typeof window !== "undefined" && window._GC_SLOWF != null) ? window._GC_SLOWF : 1;
    const dtF = (this._lastMs == null ? 1
              : Math.max(0, Math.min(3, (nowMs - this._lastMs) / 16.67))) * _gcSlow;
    this._lastMs = nowMs;
    const elapsed = nowMs - this.startMs;
    // Drive along the LOS axis: a winning OL drives the DL DOWNFIELD (+dir);
    // a losing OL is driven back toward the backfield (and may shed).
    const DRIVE_MAX_X = 22;    // ~1.5yd of give either way
    const SEAL_MAX_Y  = 28;    // ~1.9yd lateral seal
    this.driveX += this.dir * this.driftPx * this.win * dtF;
    this.driveX = Math.max(-DRIVE_MAX_X, Math.min(DRIVE_MAX_X, this.driveX));
    // Lateral SEAL — only a winning OL shoves the DL off the hole lane.
    this.driveY += this.sealSign * this.driftPx * Math.max(0, this.win) * 0.85 * dtF;
    this.driveY = Math.max(-SEAL_MAX_Y, Math.min(SEAL_MAX_Y, this.driveY));
    // A clearly-losing rep pops free after a beat — the DL sheds the block.
    if (!this.shed && this.win < -0.15 && elapsed > 220) this.shed = true;
    const w = Math.sin(elapsed / 200 + this.wobblePhase);
    // OL rides (EMA) to the contact point + accumulated drive + a little wobble.
    const olTx = this.contactX + this.driveX + w * 0.6;
    const olTy = this.contactY + this.driveY + w;
    this.olX += (olTx - this.olX) * this.pull;
    this.olY += (olTy - this.olY) * this.pull;
    if (this.shed) return;   // DL freed — the caller drives his pursuit
    // DL HOLDS its ground until the OL drives PAST the rest contact point;
    // then it's pushed downfield by the overage. The OL never pulls the DL
    // back toward the offense (that would be the DL penetrating, which is
    // the penetrator's job, not an engaged rep). The fire-out (OL easing up
    // from formation) therefore leaves the DL planted, not yanked backward.
    const driveBeyond = Math.max(0, (this.olX - this.contactX) * this.dir);
    const dlTx = this.dlHomeX + this.dir * driveBeyond;
    const dlTy = this.olY + w * -0.4;   // sealed laterally to the OL
    this.dlX += (dlTx - this.dlX) * this.pull;
    this.dlY += (dlTy - this.dlY) * this.pull;
  }
}

// RunBlockSim — owns the run-blocking engagement set for one run play.
// Construct after the formation is built, addPair() each engaged OL↔DL,
// step() every render frame, read positions via pairFor().
class RunBlockSim {
  constructor(opts = {}) {
    this.dir = opts.dir || 1;
    this.losX = opts.losX || 0;
    this.holeY = opts.holeY != null ? opts.holeY : 0;
    this.pairs = [];
  }
  addPair(ol, dl, opts = {}) {
    const eng = new RunBlockEngagement(ol, dl, { dir: this.dir, ...opts });
    this.pairs.push(eng);
    return eng;
  }
  step(nowMs) { for (const e of this.pairs) e.step(nowMs); }
  pairFor(player) {
    for (const e of this.pairs) {
      if (e.olKey === player || e.dlKey === player) return e;
    }
    return null;
  }
}

// Exported globals (this file is loaded as a plain script, not a module).
window.SimPlayer = SimPlayer;
window.simIntercept = simIntercept;
window.Engagement = Engagement;
window.PassProSim = PassProSim;
window.RunBlockEngagement = RunBlockEngagement;
window.RunBlockSim = RunBlockSim;
window.simPxToYards = pxToYards;
window.simYardsToPx = yardsToPx;
window.SIM_DEFAULTS = {
  MAX_SPEED: SIM_DEFAULT_MAX_SPEED,
  ACCEL:     SIM_DEFAULT_ACCEL,
  CONTACT_RADIUS: SIM_CONTACT_RADIUS,
};
