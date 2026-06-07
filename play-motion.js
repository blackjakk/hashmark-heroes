// ─── Motion playback (Path B Phase 2) ────────────────────────────────────
//
// Engine-owned motion schema + a playback utility. The engine knows the
// outcome of a play AND has all the context (formation, assignments,
// archetype matchups). It should emit motion intent for every player
// involved, then the animation layer is a pure renderer — no more
// hash-based tackler picks, lerp inventions, rubber-bands, or state
// syncs.
//
// SCHEMA — play.motion (when populated by engine):
// {
//   // Per-actor motion track, keyed by role / formation slot label.
//   // Roles match formation.* names: "QB", "RB", "WR1", "WR2", "TE",
//   // "OL0"..."OL4", "DL0"..."DL3", "LB0"..., "CB1", "CB2", "S1", "S2".
//   tracks: {
//     [role: string]: {
//       // Time-keyed waypoints (t in 0..1 of action time).
//       // Linear interpolation between consecutive waypoints.
//       // Sort by t ascending. First t should be 0 (formation pos);
//       // last t should be 1 (post-play resting pos).
//       //
//       // Coordinates: dxYd / dyYd are YARDS relative to a chosen
//       // ORIGIN. Default origin = (LOS, cy):
//       //   px = losX + dir * dxYd * FIELD.PX_PER_YARD
//       //   py = cy + dyYd * FIELD.PX_PER_YARD
//       //
//       // Optional `origin` field anchors waypoints to a formation
//       // slot's spot instead (so route tracks for WRs can be emitted
//       // without the engine knowing pixel coords):
//       //   origin: { slot: "wr1" | "wr2" | "te" | "rb" | ... }
//       //   px = formation[slot].x + dir * dxYd * FIELD.PX_PER_YARD
//       //   py = formation[slot].y + dyYd * FIELD.PX_PER_YARD
//       waypoints: Array<{
//         t:        number,    // 0..1
//         dxYd:     number,    // yards downfield from origin
//         dyYd:     number,    // yards lateral from origin
//         pose?:    string,    // optional pose override; persists from prev wp
//         facing?:  number,    // -1 or +1; persists
//         poseT?:   number,    // optional internal pose t (0..1)
//       }>,
//       origin?: { slot: string },   // optional; defaults to (LOS, cy)
//     },
//   },
//   // Ball track (separate from any single player — could be in flight)
//   ball: Array<{ t, dxYd, dyYd, scale?, angle? }>,
//   // Discrete events that fire AT specific t values (banners, hit fx,
//   // pose triggers that aren't pose-transitions).
//   events: Array<{ t, kind, ...payload }>,
// }
//
// Phase 2 implementation: just the playback primitive. Emission +
// consumption hooks come in subsequent commits.

const MotionPlayback = (() => {
  // Linear interpolate between two waypoints. Pose / facing persist from
  // the EARLIER waypoint (they "latch" until the next explicit change).
  function _lerpWp(a, b, t) {
    if (b == null) return { dxYd: a.dxYd, dyYd: a.dyYd, pose: a.pose, facing: a.facing, poseT: a.poseT };
    if (a == null) return { dxYd: b.dxYd, dyYd: b.dyYd, pose: b.pose, facing: b.facing, poseT: b.poseT };
    const span = b.t - a.t;
    const f = span > 0.0001 ? (t - a.t) / span : 0;
    const ff = Math.max(0, Math.min(1, f));
    return {
      dxYd: a.dxYd + (b.dxYd - a.dxYd) * ff,
      dyYd: a.dyYd + (b.dyYd - a.dyYd) * ff,
      // Pose latches — keep a's pose until t crosses INTO b's window.
      // This means the pose set at waypoint N is in effect from t=N
      // until t=N+1 (when N+1's pose takes over).
      pose: a.pose,
      facing: a.facing != null ? a.facing : (b.facing != null ? b.facing : 1),
      poseT: a.poseT != null
        ? (b.poseT != null ? a.poseT + (b.poseT - a.poseT) * ff : a.poseT)
        : b.poseT,
    };
  }

  // Query a track at time t. Returns the interpolated waypoint state.
  function sampleTrack(track, t) {
    if (!track || !track.waypoints || !track.waypoints.length) return null;
    const wps = track.waypoints;
    if (t <= wps[0].t) return _lerpWp(wps[0], wps[0], wps[0].t);
    if (t >= wps[wps.length - 1].t) {
      const last = wps[wps.length - 1];
      return _lerpWp(last, last, last.t);
    }
    // Binary search for the bracketing pair
    let lo = 0, hi = wps.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (wps[mid].t <= t) lo = mid; else hi = mid;
    }
    return _lerpWp(wps[lo], wps[hi], t);
  }

  // Sample the ball track. Same interpolation semantics.
  function sampleBall(ballTrack, t) {
    if (!ballTrack || !ballTrack.length) return null;
    if (t <= ballTrack[0].t) return { ...ballTrack[0] };
    if (t >= ballTrack[ballTrack.length - 1].t) return { ...ballTrack[ballTrack.length - 1] };
    let lo = 0, hi = ballTrack.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ballTrack[mid].t <= t) lo = mid; else hi = mid;
    }
    const a = ballTrack[lo], b = ballTrack[hi];
    const span = b.t - a.t;
    const f = span > 0.0001 ? (t - a.t) / span : 0;
    return {
      dxYd: a.dxYd + (b.dxYd - a.dxYd) * f,
      dyYd: a.dyYd + (b.dyYd - a.dyYd) * f,
      scale: (a.scale ?? 1) + ((b.scale ?? 1) - (a.scale ?? 1)) * f,
      angle: a.angle ?? b.angle ?? 0,
    };
  }

  // Return events that fired SINCE the last sampled t. Useful for
  // edge-triggered hooks (sounds, banners, fx). Caller tracks lastT.
  function eventsBetween(events, lastT, nowT) {
    if (!events || !events.length) return [];
    return events.filter(e => e.t > lastT && e.t <= nowT);
  }

  // Velocity check — returns true when the track has meaningful motion
  // at time t. Used by animation to freeze the leg cycle when a player
  // is parked in a hold segment (e.g., LB sitting in his hook zone,
  // CB shadowing a WR who's settled at the catch spot). Without this,
  // players "freeze while their feet move" because the default leg
  // animation runs off wall-clock regardless of body translation.
  function isMoving(track, t, minDeltaYd = 0.05) {
    if (!track || !track.waypoints || !track.waypoints.length) return false;
    const a = sampleTrack(track, Math.max(0, t - 0.02));
    const b = sampleTrack(track, t);
    if (!a || !b) return false;
    const dx = (b.dxYd || 0) - (a.dxYd || 0);
    const dy = (b.dyYd || 0) - (a.dyYd || 0);
    return Math.hypot(dx, dy) >= minDeltaYd;
  }

  return { sampleTrack, sampleBall, eventsBetween, isMoving };
})();

// Module-level export — referenced by play-animation.js
window.MotionPlayback = MotionPlayback;
