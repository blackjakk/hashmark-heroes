// ─── Field rendering ───────────────────────────────────────────────────────
const FIELD = {
  // Bumped internal resolution: 1280x540 → 1700x720 (+33%) for sharper player
  // detail. CSS still scales to 100% of the container; the higher resolution
  // gives the player sprites more pixels to play with.
  W: 1700, H: 720,
  EZ_PX: 100,
  PX_PER_YARD: 15,   // 100 yd × 15 = 1500px playable (100 + 1500 + 100 = 1700 ✓)
  TOP: 50,
  BOT: 670,
};

// Convert yard line + possession to absolute X (0=home goal, 100=away goal)
function yardToAbsX(yardLine, poss) {
  // When home has ball: yardLine 0 = home's own goal (left); yardLine 100 = away goal (right)
  // When away has ball: yardLine 0 = away's own goal (right); yardLine 100 = home goal (left)
  const absYard = poss === "home" ? yardLine : 100 - yardLine;
  return FIELD.EZ_PX + absYard * FIELD.PX_PER_YARD;
}
function absYardToX(absYard) {
  return FIELD.EZ_PX + absYard * FIELD.PX_PER_YARD;
}

function drawField(ctx, homeTeam, awayTeam, ctx_state) {
  const W = FIELD.W, H = FIELD.H;
  // ── Phase 2A: PIXI field hand-off ──
  // When the WebGL field is active we render grass + mowing bands via
  // PIXI on a separate tilted canvas underneath. The canvas2D #field
  // becomes transparent for those layers but continues to render
  // everything else (sidelines, end zones, yard lines, players, ball,
  // LOS, FD line, weather) on top.
  const _pixiField = (typeof GCField !== "undefined") && GCField.active();
  if (_pixiField) {
    // Wipe the canvas2D layer every frame. PIXI handles the grass
    // underneath, but anything we paint here (ball trail, callout text,
    // weather streaks) needs a fresh canvas — without this it smears.
    ctx.clearRect(0, 0, W, H);
    GCField.draw(homeTeam, awayTeam);
    // Phase 3.1 — clear the per-frame player drop shadows here so each
    // drawPlayer call this frame can append fresh shadows.
    GCField.clearShadows();
    // Skip the base grass + mowing band fill — PIXI provides those.
  } else {
    // Base grass (slightly darker than mowing bands so sidelines read as a deeper green)
    ctx.fillStyle = "#1c5e2f";
    ctx.fillRect(0, 0, W, H);
  }
  // Painted sideline pad — the strip beyond the chalk where coaches, chain
  // crew, and out-of-bounds players land. Grounds the chalk so it reads as
  // the edge of a painted surface, not a line floating in space.
  // In broadcast cam, the top pad is skipped: the tilted field's far edge
  // is a straight horizontal line that doesn't meet the flat crowd
  // silhouette's bottom, so a bright top pad highlights the gap. Dark base
  // grass at the top blends seamlessly into the night-sky backdrop instead.
  {
    const isBroadcast = (typeof cameraMode !== "undefined" && cameraMode === "broadcast");
    ctx.fillStyle = "#d9cfb9";
    if (!isBroadcast) ctx.fillRect(0, 0, W, FIELD.TOP);
    ctx.fillRect(0, FIELD.BOT, W, H - FIELD.BOT);
    if (!isBroadcast) {
      const topGrad = ctx.createLinearGradient(0, 0, 0, FIELD.TOP);
      topGrad.addColorStop(0, "rgba(0,0,0,0.32)");
      topGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, W, FIELD.TOP);
    }
    const botGrad = ctx.createLinearGradient(0, FIELD.BOT, 0, H);
    botGrad.addColorStop(0, "rgba(0,0,0,0)");
    botGrad.addColorStop(1, "rgba(0,0,0,0.32)");
    ctx.fillStyle = botGrad;
    ctx.fillRect(0, FIELD.BOT, W, H - FIELD.BOT);
  }
  // Alternating mowed bands — stronger contrast so the grass texture reads
  // even at small sizes / with broadcast camera tilt. Skipped when the
  // PIXI field is active (rendered there instead).
  if (!_pixiField) {
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#2b7a40" : "#1d6232";
      const x = FIELD.EZ_PX + i * 10 * FIELD.PX_PER_YARD;
      ctx.fillRect(x, FIELD.TOP, 10 * FIELD.PX_PER_YARD, FIELD.BOT - FIELD.TOP);
    }
  }
  // Canvas2D field-wide vignette removed — it was compounding with the
  // PIXI overlay vignette (now also removed) to over-darken the field.
  // Broadcast atmosphere now comes from light beams + LED ribbon +
  // particle bloom only.
  // End zones + team text — PIXI when active (Phase 2A.2), canvas2D otherwise.
  if (!_pixiField) {
    ctx.fillStyle = homeTeam.primary;
    ctx.fillRect(0, FIELD.TOP, FIELD.EZ_PX, FIELD.BOT - FIELD.TOP);
    ctx.fillStyle = awayTeam.primary;
    ctx.fillRect(W - FIELD.EZ_PX, FIELD.TOP, FIELD.EZ_PX, FIELD.BOT - FIELD.TOP);

    // End zone team text — sized to FILL the endzone. Font size fills the
    // narrow dimension (EZ width = 100 px after rotation becomes text height),
    // then horizontally scaled to fit the long dimension (field height between
    // sidelines becomes text width).
    const ezSpan = FIELD.BOT - FIELD.TOP;
    const ezPad  = 8;   // tiny breathing room from the sidelines
    const ezTargetH = FIELD.EZ_PX * 0.78;          // text height (cap height) target
    const ezTargetW = ezSpan - ezPad * 2;          // available length along the field
    const hName = homeTeam.name.toUpperCase();
    const aName = awayTeam.name.toUpperCase();
    ctx.save();
    ctx.font = `900 ${ezTargetH}px monospace`;
    const hMeasure = ctx.measureText(hName).width || 1;
    const hScaleX  = ezTargetW / hMeasure;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(FIELD.EZ_PX / 2, (FIELD.TOP + FIELD.BOT) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.scale(hScaleX, 1);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.strokeText(hName, 0, 0);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(hName, 0, 0);
    ctx.restore();
    ctx.save();
    ctx.font = `900 ${ezTargetH}px monospace`;
    const aMeasure = ctx.measureText(aName).width || 1;
    const aScaleX  = ezTargetW / aMeasure;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(W - FIELD.EZ_PX / 2, (FIELD.TOP + FIELD.BOT) / 2);
    ctx.rotate(Math.PI / 2);
    ctx.scale(aScaleX, 1);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.strokeText(aName, 0, 0);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(aName, 0, 0);
    ctx.restore();
  }

  // Sidelines — PIXI when active, canvas2D otherwise.
  if (!_pixiField) {
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, FIELD.TOP); ctx.lineTo(W, FIELD.TOP);
    ctx.moveTo(0, FIELD.BOT); ctx.lineTo(W, FIELD.BOT);
    ctx.stroke();
  }

  // Yard lines + numbers + hash marks — PIXI when active (Phase 2A.3),
  // canvas2D otherwise.
  if (!_pixiField) {
    // yard lines (every 5 thin, every 10 thick + numbers)
    for (let yd = 0; yd <= 100; yd += 5) {
      const x = absYardToX(yd);
      const isMajor = yd % 10 === 0;
      ctx.strokeStyle = isMajor ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.4)";
      ctx.lineWidth = isMajor ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, FIELD.TOP);
      ctx.lineTo(x, FIELD.BOT);
      ctx.stroke();
    }

    // Yard numbers (10, 20, 30, 40, 50, 40, 30, 20, 10) — sized closer to
    // NFL scale (~6ft tall = ~2yd = ~30px at our 15px/yd) with a black
    // outline so they stay legible after the broadcast-cam perspective tilt
    // foreshortens them.
    ctx.font = "900 36px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.fillStyle   = "rgba(255,255,255,0.95)";
    for (let yd = 10; yd <= 90; yd += 10) {
      const x = absYardToX(yd);
      const num = yd <= 50 ? yd : 100 - yd;
      const topY = FIELD.TOP + 52;
      const botY = FIELD.BOT - 52;
      ctx.strokeText(num, x, topY);
      ctx.fillText  (num, x, topY);
      ctx.strokeText(num, x, botY);
      ctx.fillText  (num, x, botY);
    }
    ctx.textBaseline = "alphabetic";  // restore default for any later text

    // Hash marks (small ticks every yard)
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    for (let yd = 1; yd <= 99; yd++) {
      if (yd % 5 === 0) continue;
      const x = absYardToX(yd);
      // top hash
      ctx.beginPath();
      ctx.moveTo(x, FIELD.TOP + 75);
      ctx.lineTo(x, FIELD.TOP + 80);
      ctx.stroke();
      // bottom hash
      ctx.beginPath();
      ctx.moveTo(x, FIELD.BOT - 80);
      ctx.lineTo(x, FIELD.BOT - 75);
      ctx.stroke();
      // sideline ticks
      ctx.beginPath();
      ctx.moveTo(x, FIELD.TOP); ctx.lineTo(x, FIELD.TOP + 6);
      ctx.moveTo(x, FIELD.BOT); ctx.lineTo(x, FIELD.BOT - 6);
      ctx.stroke();
    }
  }

  // Midfield team-initial logo — PIXI when active (Phase 2B.1).
  if (!_pixiField) {
    const midX = absYardToX(50);
    const midY = (FIELD.TOP + FIELD.BOT) / 2;
    ctx.fillStyle = "rgba(200,169,0,0.14)";
    ctx.beginPath();
    ctx.arc(midX, midY, 56, 0, Math.PI * 2);
    ctx.fill();
    if (homeTeam) {
      const initial = (homeTeam.name || "?")[0].toUpperCase();
      ctx.save();
      ctx.fillStyle = homeTeam.primary;
      ctx.strokeStyle = homeTeam.secondary;
      ctx.lineWidth = 3;
      ctx.font = "900 88px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = 0.55;
      ctx.strokeText(initial, midX, midY);
      ctx.fillText(initial, midX, midY);
      ctx.restore();
    }
  }

  // LOS and first down marker — PIXI when active (Phase 2B.2), else canvas2D.
  if (_pixiField) {
    GCField.drawDynamic(ctx_state || {});
  } else if (ctx_state) {
    const { los, firstDownAbs, possColor } = ctx_state;
    if (los != null) {
      ctx.strokeStyle = possColor || "#4b9bd5";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(los, FIELD.TOP); ctx.lineTo(los, FIELD.BOT);
      ctx.stroke();
    }
    if (firstDownAbs != null) {
      ctx.strokeStyle = "#f0cc30";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(firstDownAbs, FIELD.TOP); ctx.lineTo(firstDownAbs, FIELD.BOT);
      ctx.stroke();
    }
  }

  // Goal line indicators — PIXI when active (Phase 2B.1).
  if (!_pixiField) {
    ctx.strokeStyle = "#f0cc30";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(FIELD.EZ_PX, FIELD.TOP); ctx.lineTo(FIELD.EZ_PX, FIELD.BOT);
    ctx.moveTo(W - FIELD.EZ_PX, FIELD.TOP); ctx.lineTo(W - FIELD.EZ_PX, FIELD.BOT);
    ctx.stroke();
  }
  // ── Weather effects: badge + particles ──
  const wx = (typeof gameResult !== "undefined") ? gameResult?.weather : null;
  if (wx && wx.label !== "CLEAR") {
    const time = Date.now() / 1000;
    const icon = wx.label === "WINDY" ? "💨"
               : wx.label === "RAIN"  ? "🌧"
               : wx.label === "SNOW"  ? "❄"
               : wx.label === "HOT"   ? "☀"
               : "";
    // Badge top-right
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(W - 110, 8, 102, 24);
    ctx.fillStyle = "#f1f1f1";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${icon} ${wx.label}`, W - 102, 20);
    ctx.restore();
    // Rain particles — diagonal streaks, fast
    if (wx.label === "RAIN" || wx.label === "SNOW") {
      ctx.save();
      ctx.strokeStyle = wx.label === "RAIN" ? "rgba(180,200,220,0.45)" : "rgba(255,255,255,0.75)";
      ctx.lineWidth = wx.label === "RAIN" ? 0.8 : 1.4;
      ctx.fillStyle = wx.label === "SNOW" ? "rgba(255,255,255,0.85)" : null;
      const driftX = wx.label === "RAIN" ? 6 : 1.5;     // rain falls more diagonally
      const dropY  = wx.label === "RAIN" ? 14 : 4;       // rain falls fast
      // Distribute ~140 particles deterministically across the field
      const N = wx.label === "RAIN" ? 180 : 140;
      const cycle = wx.label === "RAIN" ? 0.7 : 2.5;     // seconds per fall
      for (let i = 0; i < N; i++) {
        // Each particle has a fixed seed; its y wraps based on time
        const px = ((i * 73) % W);
        const baseY = ((i * 191) % (FIELD.BOT - FIELD.TOP));
        const fall = ((time / cycle) * (FIELD.BOT - FIELD.TOP)) + baseY + (i % 13) * 18;
        const py = FIELD.TOP + (fall % (FIELD.BOT - FIELD.TOP));
        if (wx.label === "RAIN") {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + driftX, py + dropY);
          ctx.stroke();
        } else {
          // Snowflake — tiny dot, drifts laterally
          const drift = Math.sin(time * 0.6 + i * 0.5) * 1.4;
          ctx.beginPath();
          ctx.arc(px + drift, py, 1.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
    // Wind: subtle horizontal streak indicators in the foreground
    if (wx.label === "WINDY") {
      ctx.save();
      ctx.strokeStyle = "rgba(220,230,240,0.20)";
      ctx.lineWidth = 1.2;
      const speed = wx.windStrength * 60;
      for (let i = 0; i < 14; i++) {
        const yLine = FIELD.TOP + 30 + (i * (FIELD.BOT - FIELD.TOP - 60)) / 14;
        const xStart = ((time * speed * wx.windDir + i * 87) % (W + 200)) - 100;
        ctx.beginPath();
        ctx.moveTo(xStart, yLine);
        ctx.lineTo(xStart + 24 * wx.windDir, yLine);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

// Stick-figure player: head (circle) + torso + 2 arms + 2 legs as articulated
// lines. `pose` drives limb angles; `t` is an animation phase 0..1 for run cycles.
// Backwards compatible — old calls without pose render as idle.
// Per-position default running style + signature celebration
const RUN_STYLES = {
  smooth:   { armAmp: 0.95, legAmp: 0.70, lean: 0.05, kneeBend: 0.55, bob: 1.0 },
  powerful: { armAmp: 1.20, legAmp: 0.95, lean: 0.10, kneeBend: 0.85, bob: 1.6 },  // RBs — high knees, churn
  loping:   { armAmp: 0.70, legAmp: 1.05, lean: 0.02, kneeBend: 0.30, bob: 1.2 },  // burners — long stride
  short:    { armAmp: 0.85, legAmp: 0.55, lean: 0.03, kneeBend: 0.65, bob: 0.7 },  // shifty — high turnover
  plodding: { armAmp: 0.55, legAmp: 0.45, lean: 0.06, kneeBend: 0.40, bob: 0.5 },  // OL/DL — big guys
  glider:   { armAmp: 0.80, legAmp: 0.80, lean: 0.0,  kneeBend: 0.35, bob: 0.4 },  // WR — smooth tempo
  scrambler:{ armAmp: 1.10, legAmp: 0.75, lean: 0.12, kneeBend: 0.70, bob: 1.0 },  // mobile QB — frantic
};
const CELEB_STYLES = ["fist_pump", "ref_signal", "spike", "first_down", "point_sky", "shimmy", "bow", "leap_yell", "kneel"];

// Body type profiles — drive shoulder width, torso shape, leg/arm length.
// BIG = upside-down triangle (massive shoulders, thick torso) — OL/DL/POWER RB
// BROAD = stocky triangle — default RBs, thumper LBs
// NORMAL = balanced — QB / DB
// LEAN = narrow shoulders, longer limbs — most WRs, shutdown CBs
// COMPACT = short and small — slot WR/CB, elusive RB
const BODY_TYPES = {
  //               padW   torsoLen  torsoBotW  legLen  armLen  helmH   scale  bulk
  // Proportions rebalanced toward NFL: longer torso, narrower pads, smaller
  // helmet (helmH reduced). Old proportions read as Lego bobblehead at all
  // viewing scales because the helmet was ~50% of body height; NFL ratio is
  // closer to 1:5. New torso also gives jersey real estate for hang.
  HUGE:        { padW: 13.5, torsoLen: 11.5, torsoBotW: 5.5, legLen: 10.0, armLen: 8.5, helmH: 4.6, scale: 1.45, bulk: 1.6 },
  BIG:         { padW: 11.5, torsoLen: 10.8, torsoBotW: 4.4, legLen: 9.8,  armLen: 8.2, helmH: 4.4, scale: 1.35, bulk: 1.0 },
  HEAVY_SHORT: { padW: 12.2, torsoLen: 9.5,  torsoBotW: 5.0, legLen: 8.5,  armLen: 7.7, helmH: 4.3, scale: 1.36, bulk: 1.4 },
  TALL_HEAVY:  { padW: 12.0, torsoLen: 12.0, torsoBotW: 4.8, legLen: 11.0, armLen: 8.9, helmH: 4.4, scale: 1.40, bulk: 1.2 },
  BROAD:       { padW: 10.2, torsoLen: 10.3, torsoBotW: 3.7, legLen: 10.0, armLen: 8.2, helmH: 4.2, scale: 1.30, bulk: 0.8 },
  NORMAL:      { padW: 8.6,  torsoLen: 10.3, torsoBotW: 3.2, legLen: 10.0, armLen: 8.2, helmH: 4.2, scale: 1.30, bulk: 0.5 },
  LEAN:        { padW: 7.8,  torsoLen: 11.2, torsoBotW: 2.4, legLen: 11.2, armLen: 9.0, helmH: 4.0, scale: 1.30, bulk: 0.2 },
  COMPACT:     { padW: 7.6,  torsoLen: 9.0,  torsoBotW: 2.8, legLen: 9.0,  armLen: 7.4, helmH: 4.0, scale: 1.24, bulk: 0.4 },
};
const LINE_BODY_POOL = ["HUGE", "BIG", "HEAVY_SHORT", "TALL_HEAVY", "BIG", "TALL_HEAVY"];
function pickBodyType(pos, archetype) {
  if (pos === "OL" || pos === "DL") {
    // Linemen come in different sizes — pick from a pool so a line is visually varied.
    // Archetype tilts toward specific looks: POWER → HUGE, SPEED → TALL_HEAVY/BIG, etc.
    if (pos === "DL") {
      if (archetype === "POWER")      return Math.random() < 0.55 ? "HUGE" : "BIG";
      if (archetype === "SPEED")      return Math.random() < 0.55 ? "TALL_HEAVY" : "BIG";
      if (archetype === "PENETRATOR") return Math.random() < 0.50 ? "BIG" : "TALL_HEAVY";
      if (archetype === "TWEENER")    return "BIG";
      return Math.random() < 0.45 ? "TALL_HEAVY" : "BIG";
    }
    // OL
    if (archetype === "ANCHOR")    return Math.random() < 0.55 ? "HUGE" : "HEAVY_SHORT";
    if (archetype === "MAULER")    return Math.random() < 0.55 ? "HUGE" : "BIG";
    if (archetype === "ATHLETIC")  return Math.random() < 0.6  ? "TALL_HEAVY" : "BIG";
    if (archetype === "PLUG")      return Math.random() < 0.65 ? "HEAVY_SHORT" : "HUGE";
    if (archetype === "TECHNICIAN")return Math.random() < 0.55 ? "BIG" : "TALL_HEAVY";
    return LINE_BODY_POOL[Math.floor(Math.random() * LINE_BODY_POOL.length)];
  }
  if (pos === "RB") {
    if (archetype === "POWER") return "BIG";
    if (archetype === "ELUSIVE") return "COMPACT";
    if (archetype === "SPEED") return "BROAD";
    return "BROAD";
  }
  if (pos === "WR") {
    if (archetype === "DEEP_THREAT" || archetype === "POSSESSION" || archetype === "ROUTE_RUNNER") return "LEAN";
    if (archetype === "RED_ZONE") return "BROAD";
    if (archetype === "SLOT") return "COMPACT";
    return Math.random() < 0.7 ? "LEAN" : "NORMAL";
  }
  if (pos === "TE") return archetype === "RECEIVING" ? "BROAD" : Math.random() < 0.5 ? "TALL_HEAVY" : "BIG";
  if (pos === "LB") return archetype === "THUMPER" ? "BIG" : "BROAD";
  if (pos === "CB") {
    if (archetype === "SHUTDOWN") return "LEAN";
    if (archetype === "SLOT_CB")  return "COMPACT";
    return "NORMAL";
  }
  if (pos === "S")  return archetype === "BOX" ? "BROAD" : "NORMAL";
  if (pos === "QB") return "NORMAL";
  if (pos === "K" || pos === "P") return "LEAN";
  return "NORMAL";
}

// ── LOCOMOTION-DRIVEN POSE-T + FACING ────────────────────────────────
// First-principles fix for "every play people freeze while their feet
// move" + "defenders running sideline to sideline always face the
// endzone." Both come from the same root: animation state was being
// set from things OTHER than the body's actual translation — wall-
// clock for legs, hand-picked direction for facing. Now both are
// derived from per-player position deltas:
//
//   distAcc → stride phase  (legs only cycle when the body translates)
//   sign(vx) → facing       (player faces where they're moving)
//
// Event-driven poses (throw, tackle, dive, jam, sack, kick_slide,
// drop_step, etc.) keep their explicit t/facing because those
// represent specific scripted motions, not general locomotion.
// Backpedal is locomotion-shaped but deliberately faces OPPOSITE its
// direction of travel — kept as caller-controlled.
const _LOCOMOTION_POSES = new Set(["run", "carry", "release", "scrape", "jog"]);
const _FACING_AUTO_POSES = new Set(["run", "carry", "release", "jog"]);   // scrape stays caller-set (LB faces offense), backpedal stays caller-set
const _locoCache = new Map();
// Last finite (x,y) drawn per player identity — recovery anchor for the
// non-finite position guard in drawPlayer (prevents one bad frame from
// permanently erasing a sprite).
const _lastGoodPos = new Map();
// Continuity-guard state per named entity — { errX, errY, lastX, lastY }.
// Absorbs phase-boundary teleports into a decaying error (see drawPlayer).
const _smoothPos = new Map();
function _locoState(x, y, pose, style, label, facing) {
  // Identity must be unique per rendered player. The old fallback
  // composite (`${role}|${label}|${facing}`) collided for any draw
  // path that issued multiple drawPlayer calls with the same role
  // (FG OL × 9, etc.) without a name — each call overwrote the prior
  // one's lastX/lastY in the cache, and vxEMA oscillated per slot,
  // making the sprite direction flicker between frames.
  //
  // Caching across frames REQUIRES a stable per-player name. Without
  // one, return a fresh zero-velocity state per call — locomotion
  // poses freeze at frame 0 for those callers (acceptable for static
  // formation roles), but no flicker. Callers that want a proper
  // locomotion cycle must pass style.name.
  if (!(style && style.name)) {
    return {
      state: { lastX: x, lastY: y, distAcc: 0, vxEMA: 0, vyEMA: 0, facing: facing },
      dist: 0, dx: 0, dy: 0, teleport: false,
    };
  }
  const id = style.name;
  let s = _locoCache.get(id);
  if (!s) { s = { lastX: x, lastY: y, distAcc: 0, vxEMA: 0, vyEMA: 0, facing: facing }; _locoCache.set(id, s); }
  const dx = x - s.lastX, dy = y - s.lastY;
  const dist = Math.hypot(dx, dy);
  // Teleport guard — between plays a player may jump huge distances
  // (formation reset). Don't accumulate those frames; reset the anchor.
  const teleport = dist > 80;
  if (teleport) {
    s.lastX = x; s.lastY = y;
    s.vxEMA = 0; s.vyEMA = 0;
    return { state: s, dist: 0, dx: 0, dy: 0, teleport: true };
  }
  s.distAcc += dist;
  // Velocity EMA — smooths frame-to-frame jitter so facing doesn't
  // flicker when a player oscillates around 0 lateral velocity.
  // Time constant ~3 frames at 60fps.
  const alpha = 0.35;
  s.vxEMA = s.vxEMA * (1 - alpha) + dx * alpha;
  s.vyEMA = s.vyEMA * (1 - alpha) + dy * alpha;
  s.lastX = x; s.lastY = y;
  return { state: s, dist, dx, dy, teleport: false };
}

function _locomotionT(loco, pose, style) {
  if (!_LOCOMOTION_POSES.has(pose)) return null;
  if (loco.teleport) return 0;
  // Stride length in pixels. Bigger bodies have longer strides.
  const bt = style && style.bodyType;
  const cyclePx = (bt === "HUGE") ? 56
                : (bt === "BIG" || bt === "TALL_HEAVY" || bt === "HEAVY_SHORT") ? 48
                : (bt === "BROAD" || bt === "COMPACT") ? 40
                :                                          38;   // NORMAL / LEAN
  return (loco.state.distAcc / cyclePx) % 1;
}

function _locomotionFacing(loco, pose, providedFacing) {
  if (!_FACING_AUTO_POSES.has(pose)) return providedFacing;
  // Use EMA'd horizontal velocity. Threshold avoids flicker when
  // mostly-lateral motion has a tiny x component.
  const vx = loco.state.vxEMA;
  if (Math.abs(vx) > 0.6) {
    loco.state.facing = vx > 0 ? 1 : -1;
  }
  return loco.state.facing;
}

// Drop shadow under a player. Drawn before the sprite/procedural body
// so they sit on top of it. Bulk + scale are bodyType-dependent so
// HUGE/BIG players cast a bigger shadow than LEAN/COMPACT.
//
// Ragdoll suppression: when the player is in physics-driven ragdoll
// (style._ragdoll), the shadow stays planted at the impact spot — it
// doesn't lift off the ground with the body. Mid-fall (rot > ~0.6 rad)
// we fade the shadow out a bit since the body is no longer planted.
function _drawPlayerShadow(ctx, x, y, style, pose) {
  if (typeof GCField !== "undefined" && GCField.active()) {
    const bt = (typeof BODY_TYPES !== "undefined")
      ? (BODY_TYPES[style && style.bodyType] || BODY_TYPES.NORMAL)
      : { scale: 1, bulk: 1 };
    GCField.addShadow(x, y, bt.bulk, (bt.scale || 1) * 1.55);
    return;
  }
  const bt = (typeof BODY_TYPES !== "undefined")
    ? (BODY_TYPES[style && style.bodyType] || BODY_TYPES.NORMAL)
    : { scale: 1, bulk: 1 };
  const totalScale = (bt.scale || 1) * 1.55;
  const bulk = bt.bulk || 1;
  // Fade shadow during ragdoll — body's airborne, less light occlusion.
  const rd = style && style._ragdoll;
  const alpha = rd ? Math.max(0.25, 1 - Math.abs(rd.rot || 0) / 2.5) : 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(totalScale, totalScale);
  const shR = 9.0 + bulk * 0.9;
  const shY = 0.5;  // just below the foot origin
  const grad = ctx.createRadialGradient(0, shY, 0.4, 0, shY, shR);
  grad.addColorStop(0,    `rgba(0,0,0,${0.55 * alpha})`);
  grad.addColorStop(0.55, `rgba(0,0,0,${0.30 * alpha})`);
  grad.addColorStop(1,    "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, shY, shR, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Relative luminance (0..1) of a CSS hex / rgb color — picks black vs white
// jersey-number text on a dot. Defaults dark on parse failure.
function _dotLum(c) {
  if (typeof c !== "string") return 0;
  let r = 0, g = 0, b = 0;
  const hex = c.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16); r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  } else {
    const m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
  }
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function drawPlayer(ctx, x, y, color, secondary, label, pose, t, facing, style = {}) {
  // Non-finite position guard. A bad x/y (NaN/Infinity from an
  // uninitialized velocity, a divide-by-zero, etc.) makes every draw
  // call below a silent no-op → the player VANISHES for the rest of
  // the play. Recover to the last-good position for this player so a
  // single bad frame can't erase a sprite. Keyed by the same identity
  // the locomotion cache uses.
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    const _id = (style && style.name) || `${(style && style.role) || "P"}|${label || ""}`;
    const _lg = _lastGoodPos.get(_id);
    if (_lg) { x = _lg.x; y = _lg.y; }
    else return;   // never had a good position — skip rather than crash
  } else {
    const _id = (style && style.name) || `${(style && style.role) || "P"}|${label || ""}`;
    _lastGoodPos.set(_id, { x, y });
  }
  // ── CONTINUITY GUARD (anti-teleport) ──────────────────────────────
  // First-principles backstop for the whole class of phase-boundary
  // teleports (catch frame, sim re-init, pursuit hand-off, etc.). The
  // animation is phase-scripted: each phase computes absolute positions
  // from its own basis, and when the bases disagree at a boundary the
  // sprite pops. Rather than patch every boundary, absorb the pop here.
  //
  // Model: track a decaying ERROR offset (renderedPos − rawPos), not a
  // lerp toward raw — so there's NO permanent lag during normal motion.
  //   • raw jump ≤ PASS (12px): real motion → no error added (top sprint
  //     is ~6px/frame at 60fps, so anything under 12 is legitimate).
  //   • PASS < jump < SNAP (80px): a phase teleport → freeze the sprite
  //     at its previous rendered spot (error = prevRendered − raw), then
  //     decay the error to 0 over ~8 frames so it glides to the true spot.
  //   • jump ≥ SNAP: a play/formation reset or a huge legit reposition →
  //     snap (clear error); easing a full-field jump would look worse.
  // Only applied to NAMED entities (skill players + ST units) — unnamed
  // linemen don't teleport and could collide on a shared key.
  const _gid = style && style.name;
  if (_gid) {
    const PASS = 12, SNAP = 80, DECAY = 0.78;
    let s = _smoothPos.get(_gid);
    if (!s) {
      s = { errX: 0, errY: 0, lastX: x, lastY: y };
      _smoothPos.set(_gid, s);
    } else {
      const jump = Math.hypot(x - s.lastX, y - s.lastY);
      // DIAGNOSTIC (toggle: window.GC_DEBUG_TELEPORT = true). Logs every
      // per-frame jump above the legit-motion threshold, with the branch
      // it takes (SNAP=hard teleport let through, glide=absorbed). Used to
      // pinpoint the receiver-catch teleport. Zero cost when flag is off.
      if (jump > PASS && typeof window !== "undefined" && window.GC_DEBUG_TELEPORT) {
        console.log(`[teleport] ${_gid} jump=${jump.toFixed(0)}px (${(jump / 15).toFixed(1)}yd) branch=${jump >= SNAP ? "SNAP-hard" : "glide"} pose=${pose} @(${x.toFixed(0)},${y.toFixed(0)})`);
      }
      if (jump >= SNAP) {
        s.errX = 0; s.errY = 0;                    // reset / huge → snap
      } else if (jump > PASS) {
        // Phase teleport: hold at the previous rendered spot, then glide.
        s.errX = (s.lastX + s.errX) - x;
        s.errY = (s.lastY + s.errY) - y;
      }
      s.lastX = x; s.lastY = y;
      s.errX *= DECAY; s.errY *= DECAY;
      x += s.errX; y += s.errY;
    }
  }
  // Normalize missing pose to "idle" up front. Without this, callers
  // that don't set p.pose (non-target WRs running routes, FB, etc.)
  // would pass undefined → drawPlayerSprite returns false ("unknown-
  // pose") → falls through to the suppressed procedural path →
  // player vanishes. Idle has a sprite for all 8 dirs.
  if (pose == null || pose === "") pose = "idle";
  // ── TOP-DOWN DOT MODE ─────────────────────────────────────────────────
  // In the flat top-down camera, draw each player as a simple dot instead
  // of the full sprite — a clean "tactical" read where you just track where
  // everyone is. Broadcast cam is unaffected (it routes players through PIXI,
  // not this canvas2D path). Kill-switch: window.GC_TOPDOWN_DOTS = false
  // restores the top-down sprites. x,y are already continuity-smoothed above.
  if ((typeof cameraMode !== "undefined" && cameraMode === "topdown")
      && (typeof window === "undefined" || window.GC_TOPDOWN_DOTS !== false)) {
    const dotR = 10;
    const fill = color || "#9aa0aa";
    ctx.save();
    // ground shadow
    ctx.beginPath();
    ctx.ellipse(x, y + dotR * 0.55, dotR * 0.95, dotR * 0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fill();
    // body dot
    ctx.beginPath(); ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = secondary || "rgba(0,0,0,.6)"; ctx.stroke();
    // jersey number (only short numeric labels — names would overflow)
    const txt = label != null ? String(label) : "";
    if (txt && txt.length <= 2 && /^[0-9]+$/.test(txt)) {
      ctx.fillStyle = _dotLum(fill) > 0.55 ? "#111" : "#fff";
      ctx.font = `bold ${Math.round(dotR * 1.1)}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(txt, x, y + 0.5);
    }
    ctx.restore();
    // Minimal carry sink so drawBall still finds the carrier and the ball
    // sits on the right dot (foot==center for a dot; no chest offset).
    drawPlayer._carryHandSink = drawPlayer._carryHandSink || {};
    drawPlayer._carryHandSink[style.name || ("p_" + label)] = {
      x, y, footX: x, footY: y, frameMs: performance.now(), pose,
    };
    return;
  }
  // Derive locomotion-driven pose-t and facing from per-player position
  // deltas. Caller's t and facing are used as fallback / for non-
  // locomotion poses. Cache update happens every frame (regardless of
  // pose) so velocity continuity is maintained across pose transitions.
  const loco = _locoState(x, y, pose, style, label, facing);
  const tOverride = _locomotionT(loco, pose, style);
  if (tOverride != null) t = tOverride;
  facing = _locomotionFacing(loco, pose, facing);
  // CARRY-HAND ESTIMATE — populated for every drawn player so the ball
  // can be positioned at the carrier's tuck hand instead of body center
  // when the sprite path skips _drawPlayerImpl. The procedural renderer
  // overwrites this with a more precise per-joint value if it runs
  // (line ~2290); drawBall reads from this either way.
  // World coords: foot at (x, y); ball tucked at chest height where
  // the carrier's hand cradles it. For a 104px PixelLab sprite at
  // scale 1.0 with feet at (x, y), chest sits around y-50 (visually).
  // -35 was at knee/hip per user feedback; -50 is chest. Live
  // override: window.GC_BALL_HAND_Y_OFFSET (default -50).
  const _ballHandY = (typeof window !== "undefined" && window.GC_BALL_HAND_Y_OFFSET != null)
    ? window.GC_BALL_HAND_Y_OFFSET : -50;
  const _ballHandX = (typeof window !== "undefined" && window.GC_BALL_HAND_X_OFFSET != null)
    ? window.GC_BALL_HAND_X_OFFSET : 4;
  drawPlayer._carryHandSink = drawPlayer._carryHandSink || {};
  drawPlayer._carryHandSink[style.name || ("p_" + label)] = {
    x: x + (facing >= 0 ? _ballHandX : -_ballHandX),
    y: y + _ballHandY,
    footX: x,
    footY: y,
    frameMs: performance.now(),
    pose,
  };
  // Drop shadow — runs BEFORE the sprite path so the sprite render
  // sits on top of its own shadow. Previously the shadow was only
  // drawn inside _drawPlayerImpl, which is now suppressed.
  _drawPlayerShadow(ctx, x, y, style, pose);
  // SPRITE FAST-PATH (top-down camera only for now). If a PixelLab
  // sprite is loaded for this pose + 8-direction, draw it and skip
  // the entire shape-math implementation. Broadcast camera falls
  // through to the existing projection/queue/pixi pipeline since the
  // sprite would need its own projection treatment.
  const _isBroadcast = typeof cameraMode !== "undefined" && cameraMode === "broadcast";
  if (!_isBroadcast && typeof drawPlayerSprite === "function") {
    ctx.save();
    ctx.translate(x, y);
    const vx = loco && loco.state ? loco.state.vxEMA : 0;
    const vy = loco && loco.state ? loco.state.vyEMA : 0;
    if (drawPlayerSprite(ctx, pose, t, vx, vy, color, facing, label, secondary, style)) {
      ctx.restore();
      return;
    }
    ctx.restore();
  }
  // Broadcast camera: queue the draw to the upright overlay so we can
  // depth-sort all sprites before flushing. The frame-end hook
  // (_frameEndBroadcast) sorts by projected-Y (smaller = further away)
  // then runs each queued draw — closer players naturally occlude
  // farther ones on pile-ups.
  if (typeof cameraMode !== "undefined" && cameraMode === "broadcast"
      && typeof _uprightCtx !== "undefined" && _uprightCtx
      && typeof _spriteQueue !== "undefined") {
    const proj = projectBroadcast(x, y);
    // Phase 3.2 — PIXI player route. When active, render to the WebGL
    // sprite atlas on the dedicated #player-pixi canvas. PIXI handles
    // depth sort via per-sprite zIndex (=screenY) on a sortableChildren
    // container, replacing the canvas2D _spriteQueue's manual sort.
    // EXCEPT for ragdoll: texture cache key is (pose, tBucket), so the
    // cached texture from the first ragdoll frame is reused for ALL
    // subsequent frames — physics rotation/Y offset don't apply on the
    // GPU sprite. Force ragdoll players through the canvas2D path so
    // each frame re-renders with the current physics state.
    if (typeof GCPlayer !== "undefined" && GCPlayer.active() && pose !== "ragdoll") {
      const playerKey = `${color}|${label}|${facing > 0 ? "R" : "L"}`;
      // World-coords planted scale (proj.scale ≈ 0.7..1.3 depending on
      // depth). Pass it as the per-sprite scale; the texture was rendered
      // at canvas2D world scale 1.0, so this scales the sprite to match
      // what the canvas2D path would have drawn at the same depth.
      const _gpVx = loco && loco.state ? loco.state.vxEMA : 0;
      const _gpVy = loco && loco.state ? loco.state.vyEMA : 0;
      GCPlayer.render(playerKey, proj.x, proj.y, proj.scale,
        color, secondary, label, pose, t, facing, style, _gpVx, _gpVy);
      return;
    }
    const qCtx = _uprightCtx;
    const qStyle = { ...style, _bcastRestore: true };
    const _qvx = loco && loco.state ? loco.state.vxEMA : 0;
    const _qvy = loco && loco.state ? loco.state.vyEMA : 0;
    _spriteQueue.push({
      screenY: proj.y,
      run: () => {
        qCtx.save();
        qCtx.translate(proj.x, proj.y);
        qCtx.scale(proj.scale, proj.scale);
        qCtx.translate(-proj.x, -proj.y);
        // Try the sprite path first (covers ragdoll-with-rotation and
        // any other pose stuck in procedural under broadcast camera
        // when PIXI is unavailable). Only fall through to the shape-
        // math renderer if no sprite is available for this pose+dir.
        let _drew = false;
        if (typeof drawPlayerSprite === "function") {
          qCtx.save();
          qCtx.translate(proj.x, proj.y);
          _drew = drawPlayerSprite(qCtx, pose, t, _qvx, _qvy, color, facing, label, secondary, qStyle);
          qCtx.restore();
        }
        if (!_drew) {
          _drawPlayerImpl(qCtx, proj.x, proj.y, color, secondary, label, pose, t, facing, qStyle);
        }
        qCtx.restore();
      },
    });
    return;
  }
  _drawPlayerImpl(ctx, x, y, color, secondary, label, pose, t, facing, style);
}

// Per-pose count of procedural draws that were suppressed. Read from
// devtools as `_proceduralSuppressed` to diagnose any remaining sprite
// gaps.
const _proceduralSuppressed = Object.create(null);

function _drawPlayerImpl(ctx, x, y, color, secondary, label, pose, t, facing, style = {}) {
  pose = pose || "idle";
  // Hard switch — suppress the shape-math fallback entirely. Set
  // window.GC_ALLOW_PROCEDURAL = true in devtools to re-enable for
  // debugging. With this on, any sprite gap renders as nothing
  // instead of as the procedural body, which is a strictly louder
  // signal that we have a sprite missing.
  const _allowProc = (typeof window !== "undefined") && window.GC_ALLOW_PROCEDURAL === true;
  if (!_allowProc) {
    _proceduralSuppressed[pose] = (_proceduralSuppressed[pose] || 0) + 1;
    return;
  }
  t = t || 0;
  facing = facing || 1;
  const runStyle = style.runStyle || "smooth";
  const celebStyle = style.celebStyle || "fist_pump";
  // Auto-stance for ALL roles when idle — keeps players in position-appropriate
  // pre-snap setups instead of standing flat-footed.
  if (pose === "idle" && style.role) pose = "stance";
  const rs = RUN_STYLES[runStyle] || RUN_STYLES.smooth;
  const bt = BODY_TYPES[style.bodyType] || BODY_TYPES.NORMAL;

  // Per-player phase offset + amplitude jitter — derived from the jersey/role
  // so the same player always animates the same way. Desynchronizes the squad
  // so they don't all swing arms in unison.
  let phaseHash = 0;
  const phaseStr = String(label || "") + String(style.role || "");
  for (let i = 0; i < phaseStr.length; i++) phaseHash = (phaseHash * 31 + phaseStr.charCodeAt(i)) >>> 0;
  const phaseOffset = ((phaseHash % 1000) / 1000);             // 0–1
  const ampJitter   = 0.78 + ((phaseHash >> 10) % 100) / 220;  // ~0.78–1.23
  // Equipment flags — deterministic per-player so a given player always
  // wears the same kit. Drives visor / towel / captain patch / sleeve
  // draws below.
  const _posStr = String(style.position || style.role || "").toUpperCase();
  const _skillPos = ["QB","WR","RB","TE","CB","S","FS","SS","LB","KR","PR"].includes(_posStr);
  const _linemanPos = ["C","G","T","OG","OT","OL","DE","DT","NT","DL"].includes(_posStr);
  const wearsVisor    = _skillPos && ((phaseHash >> 4) % 100) < 30;
  const wearsTowel    = ((phaseHash >> 6) % 100) < 55;
  const isCaptain     = !!style.nickname;
  // Linemen wear long sleeves (forearm covered by jersey color instead of
  // bare skin) for warmth and abrasion protection. A few skill players
  // (~15%) also opt for a long-sleeved compression shirt under the jersey.
  const longSleeves   = _linemanPos || (((phaseHash >> 8) % 100) < 15);
  // QBs typically don't wear gloves (throwing-hand grip on one side,
  // balance on the other). Suppress the glove draw for them.
  const wearsGloves   = _posStr !== "QB";
  // Knee braces on linemen — common protective gear in the trenches.
  // Add a slight per-player chance for other positions too (~8%).
  const wearsKneeBrace = _linemanPos || (((phaseHash >> 12) % 100) < 8);
  // Sock striping variant — picks a deterministic pattern based on the
  // jersey color hash so a given team's players share the same look but
  // it varies across the league. 0=single white ring (default), 1=double
  // band, 2=solid team color, 3=team-color ring on white sock.
  let _teamSeed = 0;
  const teamSeedSrc = String(color || "") + String(secondary || "");
  for (let i = 0; i < teamSeedSrc.length; i++) _teamSeed = (_teamSeed * 31 + teamSeedSrc.charCodeAt(i)) >>> 0;
  const sockStyle = _teamSeed % 4;
  const legAmp = rs.legAmp * ampJitter;
  const armAmp = rs.armAmp * ampJitter;
  // Shift t by per-player offset for run/carry/celebrate cycles
  if (pose === "run" || pose === "carry") {
    t = (t + phaseOffset) % 1;
  }

  // Shade helpers — multiply RGB by factor to get a darker / lighter variant
  // for shading the body parts. Falls back to the input on parse error.
  const tweakColor = (c, factor) => {
    if (!c || c[0] !== "#" || c.length !== 7) return c;
    const r = Math.min(255, Math.max(0, Math.round(parseInt(c.slice(1,3),16) * factor)));
    const g = Math.min(255, Math.max(0, Math.round(parseInt(c.slice(3,5),16) * factor)));
    const b = Math.min(255, Math.max(0, Math.round(parseInt(c.slice(5,7),16) * factor)));
    return `rgb(${r},${g},${b})`;
  };
  const shadeDark  = tweakColor(color, 0.62);
  const shadeMid   = tweakColor(color, 0.85);
  const shadeLight = tweakColor(color, 1.18);

  // Per-player skin tone — deterministic from the jersey label so the same
  // player always renders with the same complexion. Roblox-style chunky look
  // shows skin on forearms + hands (short-sleeved jersey) and on the face.
  // SKIN_TONES is shared with the portrait sampler at module level.
  // Skin tone preference order:
  //   1. Sampled from the player's actual AI portrait PNG (best match)
  //   2. Hash of name+position (deterministic, matches canvas-portrait fallback)
  //   3. Label+role hash (for unnamed kickoff coverage / dive piles)
  let skinIdx = -1;
  if (style.name && style.position) {
    const portraitFile = portraitFileForPlayer({ name: style.name, position: style.position, archetype: style.archetype });
    const sampled = getPortraitSkinIndex(portraitFile);
    if (sampled != null) skinIdx = sampled;
  }
  if (skinIdx < 0) {
    let skinSeed = 0;
    const skinSeedSrc = style.name
      ? (style.name + (style.position || ""))
      : (String(label || "") + (style.role || ""));
    for (let i = 0; i < skinSeedSrc.length; i++) skinSeed = (skinSeed * 31 + skinSeedSrc.charCodeAt(i)) >>> 0;
    skinIdx = skinSeed % SKIN_TONES.length;
  }
  const skin = SKIN_TONES[skinIdx];

  const headR = 4.2;
  const helmH = bt.helmH;
  const torsoLen = bt.torsoLen;
  const padW = bt.padW;
  const torsoBotW = bt.torsoBotW;
  const armLen = bt.armLen;
  const legLen = bt.legLen;
  const runPhase = Math.sin(t * Math.PI * 2);

  // Limb angles. 0 rad = pointing DOWN. Positive = swings FORWARD (in facing dir).
  let lArm = 0, rArm = 0, lLeg = 0, rLeg = 0;
  let lLegLift = 0, rLegLift = 0;   // vertical lift (foot off ground) for each leg
  let bodyRot = 0, bodyTilt = 0;
  let armReachY = 0, bodyDY = 0;
  // Y-axis spin (faked in 2D by scaling X to cos(angle) — at 90° the player
  // is edge-on / invisible; at 180° they're mirrored; at 360° back to start).
  let spinXScale = 1;
  let leftHandBall = false, rightHandBall = false;
  let cradleBall = false;        // carry pose — football tucked under one arm (NFL style)
  let cradleBallSide = -1;       // which hand wraps the ball: -1 = left, +1 = right
  let rForearmOverride = null;   // throw pose drives a custom forearm angle
  let lForearmOverride = null;   // for right-facing QB throw (left arm is throw arm)
  let exclaim = null;
  let drawGroundHand = false;   // for 3-point stance

  switch (pose) {
    case "idle":
      bodyDY = Math.sin(t * Math.PI * 1.5) * 0.4;
      break;
    case "run":
    case "carry": {
      const ph = runPhase;
      // Legs alternate, jittered amplitude per player so they don't all sync
      lLeg =  ph * legAmp;
      rLeg = -ph * legAmp;
      lLegLift = Math.max(0, -ph) * 7;
      rLegLift = Math.max(0,  ph) * 7;
      // Arms swing opposite to legs — but a sliver of players (notably some
      // pursuing defenders) hold one arm out steady as a "pointing/reaching"
      // gesture instead of pumping both. Looks more natural than perfect
      // metronome arms.
      const lockedArm = pose === "run" && (phaseHash % 9) === 0;
      if (lockedArm) {
        // One arm pointed forward in the facing direction (tracking the ball
        // carrier or QB), the other swings at half amplitude. Positive angle
        // is forward in player-local space; drawArm handles the facing flip.
        lArm = 0.6;
        rArm =  ph * armAmp * 0.4;
      } else {
        lArm = -ph * armAmp;
        rArm =  ph * armAmp;
      }
      bodyTilt = facing * rs.lean;
      bodyDY = -(Math.abs(ph) * 0.5 + 0.2) * rs.bob;
      if (pose === "carry") {
        if (style.role === "QB") {
          // QB pre-throw — ball cradled at the chest with BOTH hands while
          // dropping back / scanning. Override the run-phase arm swing.
          lArm = 1.3;
          rArm = 1.3;
          rightHandBall = true;
        } else {
          // Ball carrier in the open field — ball TUCKED UNDER one arm
          // (NFL style), not cradled at the chest. The carrying arm wraps
          // tight against the ribs/bicep; the OFF arm pumps with the run
          // cycle for balance. Carry arm = near-camera side so the ball
          // reads to the viewer; cradleBall flag drives the post-arm draw
          // to place the football at the wrapping hand position with a
          // slight inward offset (under the bicep, not in front of it).
          if (facing === 1) {
            // Right-facing → carry with LEFT (near) arm
            lArm = 0.4;
            lForearmOverride = 2.2 * facing;
            rArm = -ph * armAmp * 0.85;   // right arm pumps
            cradleBallSide = -1;
          } else {
            // Left-facing → carry with RIGHT (near) arm
            rArm = 0.4;
            rForearmOverride = -2.2 * facing;
            lArm =  ph * armAmp * 0.85;   // left arm pumps
            cradleBallSide = 1;
          }
          cradleBall = true;
        }
      }
      break;
    }
    case "point": {
      // Defender pointing at the offense pre-snap (calling out the back,
      // signaling coverage). Lead arm extended FORWARD at shoulder height,
      // body upright with slight forward lean.
      bodyDY = 0.6 + Math.sin(t * Math.PI * 1.2) * 0.4;
      bodyTilt = facing * 0.06;
      lArm = 1.45;   // pointing forward at the offense
      rArm = 0;
      break;
    }
    case "stance": {
      // Role-specific pre-snap stances. Kept clean and rigid — the trenches
      // have 9+ bodies clustered face-to-face, so arms and legs are forced
      // to neutral (hanging at sides, planted) to avoid a visual mess of
      // interlocking limbs. Body posture (crouch / lean) still differentiates
      // roles. On the snap they switch to the active poses with full motion.
      const sway = Math.sin(t * Math.PI * 0.8) * 0.4;
      const role = style.role || "";
      if (role === "OL" || role === "DL") {
        // 3-point stance — knees deeply bent (drawLeg adds ~31° bend),
        // body lowered, torso angled forward toward the line of
        // scrimmage. Legs no longer swing out from under the player
        // because drawLeg counter-rotates the leg frame to stay
        // vertical, so the forward lean can be aggressive.
        bodyDY = 1.5;
        bodyTilt = facing * 0.40;
        lArm = 0; rArm = 0;
        lLeg = 0; rLeg = 0;
      } else if (role === "WR1" || role === "WR2") {
        bodyDY = 0.5 + sway;
        bodyTilt = facing * 0.08;
      } else if (role === "TE") {
        bodyDY = 1.5;
        bodyTilt = facing * 0.10;
      } else if (role === "RB") {
        bodyDY = 1.8;
        bodyTilt = facing * 0.08;
      } else if (role === "QB") {
        // QB shotgun — only role that keeps arms out, since hands forward
        // is the visual cue that he's about to receive the snap.
        bodyDY = 0.8;
        bodyTilt = 0;
        lArm = 1.05; rArm = 1.05;
      } else if (role === "LB") {
        bodyDY = 1.2 + sway;
        bodyTilt = facing * 0.05;
      } else if (role === "CB") {
        bodyDY = 0.6 + sway;
        bodyTilt = facing * 0.05;
      } else if (role === "S") {
        bodyDY = 0.8 + sway;
        bodyTilt = facing * 0.05;
      } else {
        // Generic idle bob
        bodyDY = Math.sin(t * Math.PI * 1.5) * 0.4;
      }
      break;
    }
    case "throw": {
      // FOUR phases of a real football throw (not a volleyball windmill):
      //  CRADLE (0 - 0.18): both hands clutch the ball at chest
      //  COCK   (0.18 - 0.42): pull the ball back to the ear, elbow at ear height
      //  SNAP   (0.42 - 0.62): forearm WHIPS through release, ball comes out at 0.55
      //  FOLLOW (0.62 - 1.0): arm extends forward and slightly down
      // The bicep makes a SHORT 90° sweep — only the forearm whips long.
      // Per-QB throw-slot — hashes the player name into a release-point.
      //   ~12% sidearm specialists (Mahomes / Rivers style — low release)
      //   ~22% three-quarter
      //   ~55% standard over-the-top (elbow at ear, ball at head level)
      //   ~11% pure over-the-top high release (Marino)
      // Throw-slot release points. The bicep at peak is rotated FAR
      // back-and-up so the elbow rises ABOVE the shoulder — the classic
      // combine-photo cock pose where the arm is nearly vertical with
      // the ball held high-and-behind the head. (Earlier values put the
      // elbow only horizontally back, which read as "arm not going back".)
      // sin(bicepPeak) determines how far back the elbow goes;
      // cos(bicepPeak) determines how high. At -2.3, the elbow ends up
      // right at body centerline AND well above the shoulder.
      let bicepPeak = -2.30, forearmPeak = -2.45;
      if (style.name) {
        let _h = 0;
        for (let i = 0; i < style.name.length; i++) _h = (_h * 31 + style.name.charCodeAt(i)) >>> 0;
        const slot = (_h % 100) / 100;
        if      (slot < 0.12) { bicepPeak = -1.30; forearmPeak = -1.80; }   // sidearm — elbow stays low
        else if (slot < 0.34) { bicepPeak = -1.90; forearmPeak = -2.25; }   // three-quarter
        else if (slot < 0.89) { bicepPeak = -2.30; forearmPeak = -2.45; }   // standard over-the-top
        else                  { bicepPeak = -2.55; forearmPeak = -2.70; }   // very high slot
      }
      let bicepA, forearmA, leadA;
      if (t < 0.18) {
        const ph = t / 0.18;
        bicepA   = -0.15 + ph * (-0.25);  // -0.15 → -0.4 (elbow tucked at the side)
        forearmA =  0.5  + ph * (-0.2);   // 0.5 → 0.3 (forearm forward holding ball at chest)
        leadA    =  0.7;                   // lead hand on the ball at the chest, FORWARD
      } else if (t < 0.42) {
        const ph = (t - 0.18) / 0.24;
        const sm = ph * ph * (3 - 2 * ph);
        // Wind-up: elbow rises toward head level (overhand) — exact height
        // varies by per-QB throw slot above.
        bicepA   = -0.4  + sm * (bicepPeak - (-0.4));     // -0.4 → bicepPeak
        forearmA =  0.3  + sm * (forearmPeak - 0.3);      // 0.3 → forearmPeak
        leadA    =  0.7  + sm * 0.5;                       // off arm extends FORWARD at chest level (not raised to face — keeps it distinct from the cocked throw arm)
      } else if (t < 0.62) {
        const ph = (t - 0.42) / 0.20;
        const sm = ph * ph * (3 - 2 * ph);
        // SNAP: bicep STAYS at peak (elbow at ear height — frozen). Only the
        // forearm whips, but only as far as -0.4 (slightly forward of the
        // elbow at shoulder height) — NOT past straight-down, which would
        // sweep the ball through a "golf swing" arc below the elbow.
        // The ball releases with the hand still ABOVE/AT shoulder height.
        bicepA   = bicepPeak;                              // no change — stays high
        forearmA = forearmPeak + sm * (-0.4 - forearmPeak); // peak → -0.4 (release at front-of-elbow)
        leadA    =  1.2  - sm * 0.4;                       // off arm relaxes slightly as throw releases
      } else {
        const ph = (t - 0.62) / 0.38;
        // FOLLOW: arm drives forward AND down across the body — bicep finally
        // rotates from horizontal-back through straight-down to slight-forward,
        // forearm extends out front. This is when the visible "release" motion
        // happens; the ball is already gone but the arm follows through.
        bicepA   = bicepPeak + ph * (0.30 - bicepPeak);    // peak → +0.30
        forearmA = -0.4  + ph * 1.9;                        // -0.4 → +1.5 (full extension forward)
        leadA    =  0.8  - ph * 0.6;                       // off arm relaxes down (0.8 → 0.2)
      }
      // Mirrored throw — the arm is anchored on the BACK-side shoulder of
      // the player, so it cocks OUTWARD to the back without crossing the
      // body. For facing=-1 (left-facing), the back is screen-RIGHT, so
      // the throw arm is the rArm (side=+1). For facing=+1 (right-facing),
      // the back is screen-LEFT, so the throw arm is the lArm (side=-1).
      // Same bicepA / forearmA values — the * facing flip in drawArm and
      // the choice of shoulder mirror the motion automatically.
      if (facing === 1) {
        lArm = bicepA;
        rArm = leadA;
        lForearmOverride = forearmA;
        leftHandBall = t < 0.55;
      } else {
        rArm = bicepA;
        lArm = leadA;
        rForearmOverride = forearmA;
        rightHandBall = t < 0.55;
      }
      // Body / legs progress through CRADLE → COCK → SNAP → FOLLOW:
      //  CRADLE  — square stance, both feet on the ground, body neutral
      //  COCK    — lead foot strides forward, body rises slightly as the
      //            QB winds up onto the back foot
      //  SNAP    — feet PLANT firmly into the ground (bodyDY back to 0),
      //            weight transfers forward — this is the "throw stance"
      //  FOLLOW  — lead foot stays planted, back foot drags forward,
      //            body settles slightly forward as weight finishes the
      //            transfer
      // Previously these were all fixed (lLeg=0.45, bodyDY=-1) which made
      // the QB look like he was hovering off the ground for the whole
      // throw — read as "throwing off-balance".
      if (t < 0.18) {
        const ph = t / 0.18;
        lLeg = 0.10 + ph * 0.05;        // slight forward shift
        rLeg = -0.10 - ph * 0.05;
        bodyDY = 0;                      // feet flat on ground
        bodyTilt = facing * 0.02;
      } else if (t < 0.42) {
        const ph = (t - 0.18) / 0.24;
        const sm = ph * ph * (3 - 2 * ph);
        // Stride: lead foot reaches forward, back foot pushes off
        lLeg = 0.15 + sm * 0.40;         // 0.15 → 0.55 (lead leg strides out)
        rLeg = -0.15 - sm * 0.15;        // -0.15 → -0.30 (back leg pushing)
        bodyDY = -sm * 0.8;              // 0 → -0.8 (slight rise as winding)
        bodyTilt = facing * (0.02 + sm * 0.03);
      } else if (t < 0.62) {
        const ph = (t - 0.42) / 0.20;
        const sm = ph * ph * (3 - 2 * ph);
        // PLANT: feet are FIXED — no movement in the leg angles at all.
        // bodyDY descends back to 0 as the QB drives down into the plant.
        lLeg = 0.55;
        rLeg = -0.30;
        bodyDY = -0.8 + sm * 0.8;        // -0.8 → 0 (foot plant!)
        bodyTilt = facing * (0.05 + sm * 0.10);
      } else {
        const ph = (t - 0.62) / 0.38;
        // Lead foot stays planted; back foot drags forward as weight settles.
        lLeg = 0.55 - ph * 0.10;         // 0.55 → 0.45 (lead foot stays put)
        rLeg = -0.30 + ph * 0.25;        // -0.30 → -0.05 (back foot comes up)
        bodyDY = ph * 0.4;               // 0 → +0.4 (slight settle forward)
        bodyTilt = facing * 0.15;
      }
      break;
    }
    case "reach": case "catch": {
      // Hands EXTENDED UP for the ball — high-point catch. Legs keep
      // the run-cycle so the receiver doesn't visibly stop / glide for
      // the entire catch window. Was just arms-only, which froze the
      // legs for ~15% of action time = a clear "stop and float" frame.
      const ph = runPhase;
      lLeg =  ph * legAmp;
      rLeg = -ph * legAmp;
      lLegLift = Math.max(0, -ph) * 7;
      rLegLift = Math.max(0,  ph) * 7;
      lArm = -2.4;
      rArm = -2.4;
      armReachY = -3;
      bodyTilt = facing * rs.lean * 0.5;     // slight lean into the catch
      bodyDY = -(Math.abs(ph) * 0.4 + 0.2) * rs.bob;
      break;
    }
    case "handoff": {
      // Receiving a HANDOFF — arms in front at belly level, forming a
      // pocket for the ball. Distinct from "reach" (arms over head for
      // a high catch). Legs keep run-cycle.
      const ph = runPhase;
      lLeg =  ph * legAmp;
      rLeg = -ph * legAmp;
      lLegLift = Math.max(0, -ph) * 7;
      rLegLift = Math.max(0,  ph) * 7;
      // Arms ~45° forward of straight-down (-π/4 ≈ -0.78) — pocket at
      // belly level, palms-up implied.
      lArm = -0.95;
      rArm = -0.95;
      armReachY = 0;
      bodyTilt = facing * rs.lean * 0.4;
      bodyDY = -(Math.abs(ph) * 0.3 + 0.1) * rs.bob;
      break;
    }
    case "celebrate": {
      // celebStyle dispatches the celebration variant. Default = both
      // arms raised high with a slight wave / bounce.
      const cs = celebStyle;
      if (cs === "ref_signal") {
        lArm = -Math.PI; rArm = -Math.PI;
      } else if (cs === "spike") {
        const phase = (t * 1.2) % 1;
        const cock = phase < 0.4 ? phase / 0.4 : 1;
        const swing = phase < 0.4 ? 0 : (phase - 0.4) / 0.6;
        lArm = -Math.PI * (1 - swing * 0.7) + (1 - cock) * 0.6;
        rArm = 0.3;
        leftHandBall = phase < 0.55;
      } else if (cs === "fist_pump") {
        lArm = -Math.PI * 0.78 - Math.abs(Math.sin(t * Math.PI * 5)) * 0.25;
        rArm = 0.4;
      } else if (cs === "first_down") {
        // First-down signal — chopping arm motion in the play direction.
        // facing carries the offensive direction; the arm swings forward
        // (toward the line to gain) with a clear chop.
        const chop = Math.sin(t * Math.PI * 4);
        lArm = -Math.PI * 0.45 + chop * 0.55;   // chops between mostly-down and mostly-up-forward
        rArm = 0.3;
        bodyTilt = facing * 0.10;
        bodyDY = -1;
      } else if (cs === "point_sky") {
        lArm = -Math.PI; rArm = -Math.PI;
      } else if (cs === "shimmy") {
        bodyRot = Math.sin(t * Math.PI * 6) * 0.12;
        lArm = -0.4 + Math.sin(t * Math.PI * 5) * 0.6;
        rArm = 0.4 - Math.sin(t * Math.PI * 5) * 0.6;
      } else if (cs === "bow") {
        bodyTilt = facing * 0.6;
        lArm = -0.3; rArm = 0.3;
      } else if (cs === "leap_yell") {
        bodyDY = -Math.abs(Math.sin(t * Math.PI * 2)) * 5;
        lArm = -Math.PI * 0.8;
        rArm = -Math.PI * 0.8;
      } else if (cs === "kneel") {
        bodyDY = 4;
        lLeg = 0.9; rLeg = -0.3;
        lArm = -0.6; rArm = 0.2;
        bodyTilt = facing * 0.15;
      } else {
        // Default — both arms raised high, slight wave, body bouncing.
        lArm = -2.4 + Math.sin(t * Math.PI * 5) * 0.35;
        rArm = -2.4 + Math.sin(t * Math.PI * 5 + Math.PI * 0.5) * 0.35;
        armReachY = -4 + Math.sin(t * Math.PI * 4) * 1.2;
        bodyDY = -2 - Math.abs(Math.sin(t * Math.PI * 4)) * 2;
        bodyTilt = Math.sin(t * Math.PI * 6) * 0.04;
      }
      break;
    }
    case "leap": {
      // Spectacular full-extension diving catch — body airborne and angled
      // forward like Odell Beckham / DK Metcalf, one arm fully extended at
      // the ball, the other trailing back for balance, legs kicked back.
      // t goes 0→1 across the leap; peak extension around t=0.5.
      const leapPhase = Math.sin(Math.max(0.001, t) * Math.PI);   // 0→1→0
      // Airborne — peaks around 16 px above ground at apex
      bodyDY = -6 - leapPhase * 10;
      // Body angles forward in the direction of the catch (~35-45° lean)
      bodyTilt = facing * (0.30 + leapPhase * 0.45);
      // LEFT arm extended FULL toward the ball (lead hand). Positive angle
      // is forward in player-local space; drawArm handles the facing flip.
      lArm = 1.45;
      // Right arm trails behind for counterbalance
      rArm = -0.85;
      // Reach offset — pulls the hands up toward the ball during peak
      armReachY = -2 - leapPhase * 4;
      // Legs trail behind the body (kicked back like a layout dive)
      lLeg = -0.55;
      rLeg = -0.25;
      break;
    }
    // (second "celebrate" case merged into the first, above)
    case "juke":
      bodyRot = facing * 0.35;
      lArm = 0.4;  rArm = -0.4;
      lLeg = -0.7; rLeg = 0.3;
      break;
    case "spin": {
      // Real spin move: rotate around vertical axis. X-scale = cos(angle)
      // gives the 2D illusion of the body twisting (squishing to a line
      // when edge-on). Adding bodyRot wobble + Y bob so it reads as a
      // SPIN, not just a sprite mirror flip — user reported "the spin
      // move is just flipping the sprite over."
      const spinA = t * Math.PI * 2;
      spinXScale = Math.cos(spinA);
      // Body tilts side-to-side as it rotates — like a top wobbling
      bodyRot = Math.sin(spinA) * 0.18;
      // Slight vertical bob — player pushes off / lands
      bodyDY = -1.5 * Math.abs(Math.sin(spinA)) * (1 - Math.abs(Math.cos(spinA)));
      // Arms tucked tight against the chest — and pinwheel slightly
      // around the rotation so they're not static
      lArm = 0.45 + Math.sin(spinA) * 0.15;
      rArm = -0.45 + Math.sin(spinA) * 0.15;
      // Legs cross over as the body rotates
      lLeg = -0.15 + Math.cos(spinA + Math.PI) * 0.30;
      rLeg = 0.15 - Math.cos(spinA + Math.PI) * 0.30;
      rightHandBall = true;
      break;
    }
    case "hurdle":
      // Mid-air hurdle — both legs tucked up, body airborne
      bodyDY = -7;
      bodyTilt = facing * 0.3;
      lLeg = -1.3;  // back leg tucked up
      rLeg = -0.4;  // front leg slightly bent forward
      lArm = -0.3;
      rArm = 0.4;
      break;
    case "truck":
      // Truck stick — shoulder lowered, body driving forward, knees high
      bodyTilt = facing * 0.45;
      bodyDY = 1.5;
      lArm = -0.7;          // off arm cocked back
      rArm = -1.0;           // lead arm/shoulder driving forward
      lLeg = Math.abs(Math.sin(t * Math.PI * 4)) * 0.7;
      rLeg = -Math.abs(Math.sin(t * Math.PI * 4 + Math.PI)) * 0.7;
      break;
    case "ragdoll": {
      // PHYSICS-DRIVEN ragdoll — reads kinematic state from style._ragdoll
      // populated by play-animation.js. Differs from "tackled" (scripted
      // fall) in that body rotation and Y offset come from integration
      // of impact velocity + gravity, so EVERY tackle falls differently
      // based on the hit angle. Limbs flail by life-driven jitter that
      // damps to settled positions.
      const r = style._ragdoll || {};
      const life = Math.min(1, Math.max(0, r.life || 0));
      const wobble = 1 - life;
      bodyRot = r.rot || 0;
      bodyDY = r.dy || 0;
      bodyTilt = 0;
      // Arms flail outward by the hit + slight chaotic shake while airborne
      const flailL = -0.6 - life * 0.8 + Math.sin((r.life || 0) * 12) * 0.4 * wobble;
      const flailR =  0.6 + life * 0.8 + Math.cos((r.life || 0) * 12) * 0.4 * wobble;
      lArm = flailL;
      rArm = flailR;
      // Legs splay
      lLeg = -life * 0.8 + Math.sin((r.life || 0) * 14) * 0.25 * wobble;
      rLeg =  life * 0.8 + Math.cos((r.life || 0) * 14) * 0.25 * wobble;
      break;
    }
    case "tackled": {
      // Ragdoll fall: t is interpreted as fall progress (0=just hit, 1=flat on ground).
      // Body rotates from upright to horizontal, limbs splay outward, body bobs down
      // with a small upward bounce at impact.
      //
      // style.fallDir controls which direction the head goes:
      //   -1 (default): backward fall (head opposite of facing) — head-on hit,
      //      defender's force overpowers carrier's momentum (think: power runner
      //      stuffed at the line, or a head-on tackle of a stationary receiver).
      //   +1: forward fall (head in facing direction) — chase tackle / angle
      //      tackle where the carrier's momentum carries them forward through
      //      contact (think: WR caught in stride, RB hit from behind).
      //
      // Real NFL: most YAC and breakaway tackles are forward falls because
      // the carrier was running at speed when contact happened. Backward falls
      // are reserved for power-vs-power head-on collisions.
      const fallT = Math.min(1, Math.max(0, t));
      const fallEase = fallT * fallT * (3 - 2 * fallT);     // smoothstep
      // Default to FORWARD fall (+1). Most pass-catch tackles have
      // forward momentum (carrier was running at speed); backward only
      // when the combined-momentum model explicitly computes it.
      const fallDir = (style && style.fallDir) || 1;
      bodyRot = (Math.PI / 2) * facing * fallDir * fallEase;
      bodyDY = fallEase * 5 + Math.sin(fallT * Math.PI) * -2;// downward + small upward bump at peak
      // Arms flail outward as the body falls
      lArm = -0.4 - fallEase * 0.8;                          // -0.4 → -1.2
      rArm =  0.4 + fallEase * 0.8;                          //  0.4 →  1.2
      // Legs splay out
      lLeg = -fallEase * 0.85;
      rLeg =  fallEase * 0.85;
      // Slight body wobble while falling
      bodyTilt += Math.sin(fallT * Math.PI * 2.2) * 0.05 * (1 - fallEase);
      break;
    }
    case "tumble": {
      // BIG-IMPACT FALL — carrier rolls forward through contact instead
      // of just rotating to horizontal. Used for chase tackles after a
      // big YAC run, when the carrier's momentum was high and the hit
      // sends him head-over-heels. Rotation goes 270° (1.5x past
      // horizontal — head past the body, body past the legs) and the
      // body bobs to suggest the roll. Arms windmill, legs cycle.
      const ph = Math.min(1, Math.max(0, t));
      const fallEase = ph * ph * (3 - 2 * ph);
      const fallDir = (style && style.fallDir) || 1;
      // 270° rotation (1.5π rad). Past horizontal, head ends up behind.
      bodyRot = (Math.PI * 1.5) * facing * fallDir * fallEase;
      // Y bob — body lifts on contact, drops past horizontal, settles
      bodyDY = fallEase * 4 + Math.sin(ph * Math.PI) * -3;
      // Arms windmill outward
      lArm = -0.4 - fallEase * 0.9 + Math.sin(ph * Math.PI * 3) * 0.35;
      rArm =  0.4 + fallEase * 0.9 - Math.sin(ph * Math.PI * 3) * 0.35;
      // Legs cycle as the body rolls
      lLeg = -fallEase * 0.7 + Math.cos(ph * Math.PI * 2.5) * 0.45;
      rLeg =  fallEase * 0.7 - Math.cos(ph * Math.PI * 2.5) * 0.45;
      bodyTilt += Math.sin(ph * Math.PI * 3.0) * 0.10 * (1 - fallEase);
      break;
    }
    case "spin_fall": {
      // SIDE-HIT FALL — carrier spun off-axis by a lateral collision.
      // Used when the combined momentum at contact has a strong Y
      // component (side hit or angle tackle). Body rotates LATERAL
      // first (around a vertical axis — represented as bodyTilt wobble
      // + asymmetric leg lift), then collapses to horizontal.
      const ph = Math.min(1, Math.max(0, t));
      const fallEase = ph * ph * (3 - 2 * ph);
      const fallDir = (style && style.fallDir) || 1;
      const sideDir = (style && style.sideDir) || 1;   // +1 right, -1 left
      // Body rotates to horizontal with a side-component lean
      bodyRot = (Math.PI / 2) * facing * fallDir * fallEase;
      bodyTilt = sideDir * 0.40 * fallEase + Math.sin(ph * Math.PI * 4) * 0.08;
      bodyDY = fallEase * 6 + Math.sin(ph * Math.PI) * -1.5;
      // Arms whip to the side, away from the spin axis
      lArm = -0.4 - fallEase * 1.0 + sideDir * 0.30;
      rArm =  0.4 + fallEase * 1.0 + sideDir * 0.30;
      // Legs splay asymmetrically (one leg up, one out)
      lLeg = -fallEase * 0.90 + sideDir * 0.20;
      rLeg =  fallEase * 0.90 - sideDir * 0.20;
      break;
    }
    case "jam": {
      // Press-coverage JAM at the snap — CB punches both hands into the
      // WR's chest pads, body squared up, legs in a solid wide base.
      // Brief moment (~80-150ms of action time) before transitioning to
      // backpedal or chase. Both arms fully extended forward; body
      // squared to the LOS (no facing flip during the jam).
      const ph = Math.min(1, t);   // 0 → 1 across the jam window
      // Quick punch — arms thrust forward at jam peak, slight retract
      const punch = Math.sin(Math.min(1, ph * 2) * Math.PI);
      lArm = 1.10 + punch * 0.10;
      rArm = 1.10 + punch * 0.10;
      lForearmOverride = 0.25;
      rForearmOverride = 0.25;
      lLeg = 0.45; rLeg = -0.45;     // wide stable base
      bodyTilt = facing * 0.08;       // slight forward lean into contact
      bodyDY = -punch * 1.0;          // pop up at impact
      break;
    }
    case "stiff":
      lArm = Math.PI / 2;
      rArm = 0.4;
      lLeg = runPhase * 0.3; rLeg = -runPhase * 0.3;
      break;
    case "backpedal": {
      // Defender backpedal — body faces the offense (forward) but moves
      // BACKWARD by pushing off alternating feet. Legs cycle in the
      // OPPOSITE direction from run pose (small back stride instead of
      // forward stride). Body leans slightly back, arms loose at sides.
      // Used by CBs and Safeties at the snap before they turn and run
      // with the WR (man) or settle in their zone.
      const ph = runPhase;
      lLeg = -ph * 0.45;
      rLeg =  ph * 0.45;
      lLegLift = Math.max(0,  ph) * 3.5;
      rLegLift = Math.max(0, -ph) * 3.5;
      lArm = -0.15;
      rArm =  0.15;
      bodyTilt = facing * -0.10;       // lean AWAY from the offense
      bodyDY = Math.sin(t * Math.PI * 6) * 0.25;
      break;
    }
    case "churn": {
      // RB high-knee churn — ball carrier in the open field. Bigger
      // stride amplitude than steady run, HIGH knee lift for power-
      // running visual. One arm cradles the ball (handled by carry
      // logic upstream if cradleBall set); the other pumps.
      const ph = runPhase;
      lLeg =  ph * 1.05;
      rLeg = -ph * 1.05;
      lLegLift = Math.max(0, -ph) * 11;     // higher than run's 7
      rLegLift = Math.max(0,  ph) * 11;
      // Off-arm pumps; cradle arm wraps ball (cradleBall fires in carry
      // post-arm draw, this just sets the bicep angle.)
      if (facing === 1) {
        lArm = 0.4; lForearmOverride = 2.2;       // left wraps the ball
        rArm = -ph * 1.0;                          // right pumps
        cradleBallSide = -1;
      } else {
        rArm = 0.4; rForearmOverride = -2.2;
        lArm =  ph * 1.0;
        cradleBallSide = 1;
      }
      cradleBall = true;
      bodyTilt = facing * 0.07;
      bodyDY = -(Math.abs(ph) * 0.7 + 0.3);
      break;
    }
    case "release": {
      // WR first-step release at the LOS — explosive vertical push,
      // body leaned FORWARD harder than mid-route cruise, longer first
      // stride than a steady-state run. Distinguishes "exploding off
      // the LOS" from "cruising downfield".
      const ph = runPhase;
      lLeg =  ph * 0.85;          // bigger stride than run's legAmp
      rLeg = -ph * 0.85;
      lLegLift = Math.max(0, -ph) * 9;   // higher first step
      rLegLift = Math.max(0,  ph) * 9;
      lArm = -ph * 1.1;           // exaggerated arm pump
      rArm =  ph * 1.1;
      bodyTilt = facing * 0.18;   // hard forward lean
      bodyDY = -(Math.abs(ph) * 0.7 + 0.3);
      break;
    }
    case "scrape": {
      // LB read-step / scrape — body faces the offense, feet shuffle
      // laterally as the LB reads the run gap. Mid base, hands ready
      // at the chest. Differs from backpedal (which moves backward) —
      // scrape is mostly LATERAL with a slight forward lean (LB
      // reading downhill, ready to fill).
      const ph = runPhase;
      lLeg =  0.35;            // mid base, planted
      rLeg = -0.35;
      lLegLift = Math.max(0,  ph) * 2.2;   // tiny lateral lift
      rLegLift = Math.max(0, -ph) * 2.2;
      lArm =  0.20;            // hands at chest, ready to engage
      rArm = -0.20;
      bodyTilt = facing * 0.06;    // slight forward lean (downhill)
      bodyDY = Math.sin(t * Math.PI * 6) * 0.20;
      break;
    }
    case "drop_step": {
      // QB drop-back footwork — turns body partially sideways (open hip),
      // crosses one foot behind the other as he retreats. Carries the
      // ball at the chest with both hands (cradled). Legs bigger arc
      // than backpedal (real strides, not shuffles) but body still
      // faces the LOS direction. Was rendered as generic "carry" which
      // looked like the QB was just standing while moving back.
      const ph = runPhase;
      // Reverse stride — legs swing back-and-forth, but the BACK leg
      // crosses further (drop steps lead with the back foot).
      lLeg = -ph * 0.55;
      rLeg =  ph * 0.55;
      lLegLift = Math.max(0,  ph) * 5;
      rLegLift = Math.max(0, -ph) * 5;
      // Arms cradled — both forearms wrapped to the chest (ball in hand)
      lArm = 1.3;
      rArm = 1.3;
      rightHandBall = true;
      bodyTilt = facing * -0.06;       // slight backward weight
      bodyDY = Math.sin(t * Math.PI * 5) * 0.35;
      break;
    }
    case "kick_slide": {
      // OL pass-protection footwork — wide stable base, body squatted
      // low, arms PUNCHED forward to meet the rusher, feet shuffling
      // laterally (not striding). Legs stay spread WIDE the whole time;
      // small alternating lift to suggest the slide. Body upright with
      // slight backward weight transfer.
      const ph = runPhase;
      lLeg =  0.50;                                    // wide planted base
      rLeg = -0.50;
      lLegLift = Math.max(0, -ph) * 1.6;               // tiny shuffle lift
      rLegLift = Math.max(0,  ph) * 1.6;
      // Arms PUNCHED out — engagement-style hand placement
      lArm = 0.85;
      rArm = 0.85;
      lForearmOverride = 0.10;
      rForearmOverride = 0.10;
      bodyTilt = facing * -0.05;       // weight slightly back, anchored
      bodyDY = Math.sin(t * Math.PI * 5) * 0.30;       // controlled bob
      break;
    }
    case "hit": {
      // Tackler driving INTO the ball carrier and FOLLOWING THROUGH to
      // a FALLEN position on top of the pile. Previous version ended
      // upright-but-hunched (bodyTilt only), which the user called out
      // as "guys standing there mid tackle" — the tackler made contact
      // and then just stood there. Now during the FOLLOW phase the
      // body rotates to horizontal, matching the carrier's fall.
      //   0.0 - 0.5  IMPACT     — drive through, arms wrap, body rises
      //   0.5 - 1.0  FOLLOW     — body crumples and ROTATES to horizontal
      //
      // style.fallDir controls which way the head goes (forward / back).
      // Default +1 (head in facing direction); the pass-play tackler
      // code sets it to match the combined-momentum direction so both
      // tackler and carrier fall the same physical way.
      // IMPACT is brief — first ~15% of the window. FOLLOW starts at
      // ph=0.18 and reaches full horizontal by ph=1.0. Previously the
      // fall didn't start until ph=0.5 and capped at 81% rotation, so
      // a defender at play-end was still mostly upright — the user's
      // "never seen a defender fall" was largely this.
      const ph = Math.min(1, Math.max(0, t));
      const impact = Math.sin(Math.min(1, ph * 3.3) * Math.PI);   // bell peaks ph≈0.15
      const followT = Math.max(0, ph - 0.18) / 0.82;              // 0→1 across follow
      const followEase = followT * followT * (3 - 2 * followT);
      const fallDir = (style && style.fallDir) || 1;
      lArm = -1.6 + ph * 0.5;
      rArm = -1.6 + ph * 0.5;
      // Legs drive then fold under as the tackler crumples forward
      lLeg =  0.55 + impact * 0.25 - followEase * 0.40;
      rLeg = -0.40 - impact * 0.20 + followEase * 0.40;
      // bodyTilt = impact lean. Fades out during follow as bodyRot takes
      // over and the body rotates to horizontal.
      bodyTilt = facing * (0.25 + impact * 0.20) * (1 - followEase);
      // bodyRot rotates to full horizontal during the follow phase.
      bodyRot = (Math.PI / 2) * facing * fallDir * followEase;
      // Pop up at impact peak, then drop ALL THE WAY DOWN onto the pile.
      bodyDY = -0.5 - impact * 1.4 + followEase * 5.0;
      break;
    }
    case "dive": {
      // Diving tackle attempt — body launches HORIZONTAL through the
      // air with arms extended forward (Superman). t 0→1 across the
      // dive arc; lands flat at t=1 (the "splat").
      const ph = Math.min(1, Math.max(0, t));
      const airT = Math.min(1, ph * 1.4);
      const arc = Math.sin(airT * Math.PI);
      bodyRot = -Math.PI / 2 * facing * Math.min(1, ph * 1.3);   // rotate to horizontal
      bodyDY = -arc * 7 + Math.max(0, ph - 0.78) * 35;           // hang time, then plant
      bodyTilt = facing * 0.45;
      lArm = -2.4;    // both arms reaching forward
      rArm = -2.4;
      lLeg = 0.6;     // legs trailing back
      rLeg = -0.6;
      break;
    }
    case "block":
      lArm = -0.5; rArm = 0.5;
      lLeg = 0.1;  rLeg = -0.1;
      bodyTilt = facing * 0.15;
      break;
    case "engage": {
      // Engagement varies by lineman archetype. style.archetype is set
      // upstream from per-formation hash (or play.dlType for the sack
      // play's breaking rusher). Each archetype tweaks bicep, forearm,
      // leg spread, body tilt, and jitter rate so each lineman has a
      // visible "stance signature" instead of all linemen looking
      // identical.
      const arch = (style && style.archetype) || "";
      let bicep = 0.8, forearm = 0.20, tilt = 0.18, legSpread = 0.4, dyMul = 1.0;
      // DL archetypes
      if      (arch === "POWER")      { bicep = 0.70; forearm = 0.12; tilt = 0.28; legSpread = 0.55; dyMul = 0.6; }
      else if (arch === "SPEED")      { bicep = 1.00; forearm = 0.35; tilt = 0.10; legSpread = 0.30; dyMul = 1.4; }
      else if (arch === "TWEENER")    { bicep = 0.90; forearm = 0.30; tilt = 0.16; legSpread = 0.42; dyMul = 1.8; }
      else if (arch === "PENETRATOR") { bicep = 0.85; forearm = 0.25; tilt = 0.32; legSpread = 0.50; dyMul = 0.8; }
      // OL archetypes (TECHNICIAN exists in both — defaults are close to it)
      else if (arch === "ANCHOR")     { bicep = 0.60; forearm = 0.10; tilt = 0.12; legSpread = 0.60; dyMul = 0.4; }
      else if (arch === "ATHLETIC")   { bicep = 0.85; forearm = 0.25; tilt = 0.18; legSpread = 0.35; dyMul = 1.0; }
      else if (arch === "PLUG")       { bicep = 0.55; forearm = 0.10; tilt = 0.10; legSpread = 0.55; dyMul = 0.5; }
      else if (arch === "MAULER")     { bicep = 0.75; forearm = 0.15; tilt = 0.32; legSpread = 0.50; dyMul = 0.8; }
      lArm = bicep; rArm = bicep;
      lForearmOverride = forearm;
      rForearmOverride = forearm;
      lLeg = legSpread; rLeg = -legSpread;
      bodyTilt = facing * tilt;
      bodyDY = Math.sin(t * Math.PI * 6 * dyMul) * 0.4;
      break;
    }
    case "sack": {
      // Sacker driving QB down. Like "hit", body rotates to horizontal
      // during follow-through — defender ends up on the ground with the
      // QB. Previously sack pose was a static "stand and wrap" stance,
      // which the user called out: "never seen a defender fall on the
      // ground ever".
      const ph = Math.min(1, Math.max(0, t));
      const fallEase = ph * ph * (3 - 2 * ph);
      const fallDir = (style && style.fallDir) || 1;
      lArm = -0.6;
      rArm = -0.6;
      lLeg = -0.5 - fallEase * 0.3;
      rLeg = 0.5 + fallEase * 0.3;
      // bodyTilt fades during follow as bodyRot takes over (horizontal).
      bodyTilt = facing * 0.25 * (1 - fallEase);
      bodyRot = (Math.PI / 2) * facing * fallDir * fallEase * 0.85;
      bodyDY = fallEase * 4;
      break;
    }
    case "kick":
      lArm = -0.4; rArm = -0.8;
      lLeg = -1.4;
      rLeg = facing * (1.1 - Math.abs(t - 0.5) * 1.5);
      bodyTilt = facing * -0.15;
      break;
    case "lateral":
      lArm = -Math.PI * 0.7;
      rArm = 0.3;
      bodyRot = facing * -0.2;
      leftHandBall = t < 0.5;
      break;
  }
  // Players are scaled by their body-type scale × a global multiplier.
  // Bumped to make them look meatier against the larger 1280-wide field.
  const PLAYER_SCALE_MUL = 1.55;
  const totalScale = (bt.scale || 1) * PLAYER_SCALE_MUL;
  // Foot Y in local coords (used by the shadow + seal so they sit at the
  // cleats regardless of body animation). Computed up front so both the
  // ground-decal pass and the body pass agree on it.
  const footYLocal = (-headR + 1) + torsoLen + legLen * 1.05;

  // ── GROUND DECALS — drawn at the player's planted (x, y) WITHOUT bodyDY or
  // body rotation, so they stay flat on the field even when the player ragdolls
  // on a tackle. Like Madden's star marker that acts as a ground shadow.
  // Phase 3.1 — when PIXI field is active, drop shadow is batched into a
  // single PIXI Graphics by GCField.addShadow (one WebGL draw call for all
  // 22 players instead of 22 canvas2D radial gradients).
  const _shadowToPixi = (typeof GCField !== "undefined") && GCField.active();
  if (_shadowToPixi) {
    // Pass the world-space planted position + bulk/scale; PIXI draws
    // the ellipse in the same coord system as the static field.
    const footWorldY = y + (footYLocal + 0.8) * totalScale;
    GCField.addShadow(x, footWorldY, bt.bulk, totalScale);
  } else {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(totalScale, totalScale);
    {
      const shR = 9.0 + bt.bulk * 0.9;            // horizontal radius
      const shY = footYLocal + 0.8;
      const shadowGrad = ctx.createRadialGradient(0, shY, 0.4, 0, shY, shR);
      shadowGrad.addColorStop(0,    "rgba(0,0,0,0.55)");
      shadowGrad.addColorStop(0.55, "rgba(0,0,0,0.30)");
      shadowGrad.addColorStop(1,    "rgba(0,0,0,0)");
      ctx.fillStyle = shadowGrad;
      ctx.beginPath();
      ctx.ellipse(0, shY, shR, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── BODY — animated/rotated/translated as before.
  ctx.save();
  ctx.translate(x, y + bodyDY);
  if (bodyTilt !== 0) ctx.rotate(bodyTilt);
  if (bodyRot !== 0) ctx.rotate(bodyRot);
  ctx.scale(totalScale, totalScale);
  // Y-axis spin: squash X to fake the body twisting around the vertical
  // axis. Don't let the scale hit exactly zero or a sliver of mesh remains.
  if (spinXScale !== 1) ctx.scale(Math.max(0.05, Math.abs(spinXScale)) * Math.sign(spinXScale || 1), 1);
  ctx.lineCap = "round";

  const shoulderY = -headR + 1;
  const hipY = shoulderY + torsoLen;

  // ── Blocky limb helper: a rectangular segment (no round end caps) with a
  // dark side shadow + bright lit edge. x1,y1 → x2,y2 is the centerline; w is
  // half-width perpendicular to it. Roblox-style flat ends.
  function drawSegment(x1, y1, x2, y2, w, baseColor, darkColor, lightColor) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 0.001;
    const nx = -dy / len, ny = dx / len;   // perpendicular (across)
    const tx = dx / len,  ty = dy / len;   // along centerline
    // Extend caps slightly past endpoints so joints don't show gaps
    const ex = tx * w * 0.15, ey = ty * w * 0.15;
    const ax = x1 - ex, ay = y1 - ey;
    const bx = x2 + ex, by = y2 + ey;
    // Filled rectangle (square ends)
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.moveTo(ax + nx * w, ay + ny * w);
    ctx.lineTo(bx + nx * w, by + ny * w);
    ctx.lineTo(bx - nx * w, by - ny * w);
    ctx.lineTo(ax - nx * w, ay - ny * w);
    ctx.closePath();
    ctx.fill();
    // Solid dark outline — gives every limb a hard block edge
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // Dark side (shadow on one face)
    ctx.fillStyle = darkColor;
    ctx.beginPath();
    ctx.moveTo(ax - nx * w,         ay - ny * w);
    ctx.lineTo(bx - nx * w,         by - ny * w);
    ctx.lineTo(bx - nx * w * 0.55,  by - ny * w * 0.55);
    ctx.lineTo(ax - nx * w * 0.55,  ay - ny * w * 0.55);
    ctx.closePath();
    ctx.fill();
    // Lit edge (highlight on opposite face)
    if (lightColor) {
      ctx.fillStyle = lightColor;
      ctx.beginPath();
      ctx.moveTo(ax + nx * w,         ay + ny * w);
      ctx.lineTo(bx + nx * w,         by + ny * w);
      ctx.lineTo(bx + nx * w * 0.7,   by + ny * w * 0.7);
      ctx.lineTo(ax + nx * w * 0.7,   ay + ny * w * 0.7);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ── Legs — chunky Lego-style blocks with knee bend.
  // Thick rectangular thighs/shins. Non-running poses get a small natural
  // athletic-stance bend so legs aren't stilts. OL/DL three-point stance
  // deepens this into a real crouch.
  const thighW = 2.6 + bt.bulk * 0.55;
  const shinW  = 2.4 + bt.bulk * 0.45;
  const drawLeg = (side, angle, lift) => {
    const a = angle * facing;
    const sx = side * 2.6;
    // Counter-rotate the leg's local frame so legs hang VERTICAL from the
    // hip joint regardless of body tilt — pivots inverse-rotation around
    // the hip point so the hip itself stays attached to the rotated
    // torso while the thigh+shin go straight down. Fixes the OL/DL
    // three-point stance where lean was swinging the feet sideways out
    // from under the player.
    ctx.save();
    if (bodyTilt !== 0) {
      ctx.translate(sx, hipY);
      ctx.rotate(-bodyTilt);
      ctx.translate(-sx, -hipY);
    }
    const upperLen = legLen * 0.52;
    const lowerLen = legLen * 0.52;
    const bending = pose === "run" || pose === "carry";
    // Natural stance knee bend — thigh angles forward, shin angles back
    // by the same amount so the foot lands roughly under the hip with
    // the knee out front. Deeper for line stance (three-point crouch).
    let idleBend = 0;
    if (!bending && lift === 0) {
      const isLineStance = pose === "stance" && (style.role === "OL" || style.role === "DL");
      idleBend = isLineStance ? 0.55 : 0.18;
    }
    const upperA = a + facing * idleBend;
    const bendBase = bending ? rs.kneeBend * Math.abs(Math.sin(a)) : 0;
    const bend = bendBase + (lift / 7) * 0.8;
    const kneeX = sx + Math.sin(upperA) * upperLen;
    const kneeY = hipY + Math.cos(upperA) * upperLen - lift * 0.55;
    // Knee flexion bends the SHIN BACK toward vertical from whichever side
    // the thigh is on. Old formula was `a + facing * bend * sign(a)`,
    // which for right-facing forward-planted legs gave shin = thigh + bend
    // — i.e. the shin tilted MORE forward than the thigh (knee bending
    // backward, bird-leg). Now lowerA = a - sign(a) * bend, which always
    // pulls the shin toward 0 (straight down), so the knee bends the
    // correct anatomical direction regardless of facing.
    const lowerA = bending
      ? a - bend * (a >= 0 ? 1 : -1)
      : a - facing * idleBend;
    const footX = kneeX + Math.sin(lowerA) * lowerLen;
    const footY = kneeY + Math.cos(lowerA) * lowerLen - lift * 0.35;
    // White pants (thigh)
    drawSegment(sx, hipY, kneeX, kneeY, thighW, "#f1f1f1", "#bcbcbc", "#ffffff");
    // Team-color pant stripe on the OUTSIDE of the thigh
    const stripeDX = side * (thighW * 0.6);
    drawSegment(sx + stripeDX * 0.55, hipY + 0.5, kneeX + stripeDX * 0.55, kneeY,
                thighW * 0.28, color, shadeDark, shadeLight);
    // Knee brace — small white wrap around the knee, worn by linemen +
    // a small share of other players. Drawn before the sock so the sock
    // overlaps it cleanly at the bottom.
    if (wearsKneeBrace) {
      ctx.fillStyle = "#e8e8e8";
      ctx.beginPath();
      ctx.ellipse(kneeX, kneeY, thighW * 0.85, 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.lineWidth = 0.25;
      ctx.stroke();
    }
    // Sock — base color depends on team's sock style. The sockStyle picks
    // which color is the base and which is the accent: 0/1=team base
    // w/ white accent (single or double band), 2=solid team color, 3=
    // white sock with team-color accent ring.
    const sockEndX = kneeX + Math.sin(lowerA) * lowerLen * 0.55;
    const sockEndY = kneeY + Math.cos(lowerA) * lowerLen * 0.55 - lift * 0.20;
    const whiteBase = sockStyle === 3;
    const baseCol  = whiteBase ? "#f1f1f1" : color;
    const baseDk   = whiteBase ? "#c8c8c8" : shadeDark;
    const baseLt   = whiteBase ? "#ffffff" : shadeLight;
    const accentCol = whiteBase ? color : "#f1f1f1";
    const accentDk  = whiteBase ? shadeDark : "#c8c8c8";
    const accentLt  = whiteBase ? shadeLight : "#ffffff";
    drawSegment(kneeX, kneeY, sockEndX, sockEndY, shinW, baseCol, baseDk, baseLt);
    if (sockStyle !== 2) {
      // Single accent ring (default look + reverse). Double-band variant
      // adds a second, thinner band higher up.
      const ringStartX = kneeX + Math.sin(lowerA) * lowerLen * 0.48;
      const ringStartY = kneeY + Math.cos(lowerA) * lowerLen * 0.48 - lift * 0.16;
      drawSegment(ringStartX, ringStartY, sockEndX, sockEndY, shinW * 0.95,
                  accentCol, accentDk, accentLt);
      if (sockStyle === 1) {
        const band2StartX = kneeX + Math.sin(lowerA) * lowerLen * 0.20;
        const band2StartY = kneeY + Math.cos(lowerA) * lowerLen * 0.20 - lift * 0.08;
        const band2EndX   = kneeX + Math.sin(lowerA) * lowerLen * 0.28;
        const band2EndY   = kneeY + Math.cos(lowerA) * lowerLen * 0.28 - lift * 0.11;
        drawSegment(band2StartX, band2StartY, band2EndX, band2EndY,
                    shinW * 0.92, accentCol, accentDk, accentLt);
      }
    }
    // Extend the sock down past the ankle so there's no gap between the
    // sock and the cleat (the original cleat segment was the leg's
    // bottom-half, but the new horizontal cleat needs a sock to land on).
    const ankleX = kneeX + Math.sin(lowerA) * lowerLen * 0.92;
    const ankleY = kneeY + Math.cos(lowerA) * lowerLen * 0.92 - lift * 0.32;
    drawSegment(sockEndX, sockEndY, ankleX, ankleY, shinW, baseCol, baseDk, baseLt);
    // Cleat — HORIZONTAL shoe shape at ground level, toe pulled forward
    // in the facing direction. Replaces the old "segment along the leg
    // direction" which made cleats look like a stubby continuation of
    // the shin. Real cleats are low, flat, and toe-pointed.
    const cleatColor = secondary || "#1e1e26";
    const cleatDark  = tweakColor(cleatColor, 0.55) || "#000000";
    const cleatLight = tweakColor(cleatColor, 1.15) || "#3a3a44";
    const toeFwd = facing * shinW * 0.95;     // toe juts forward
    const heelBack = -facing * shinW * 0.45;  // heel slightly back
    const cleatTop = footY - shinW * 0.35;
    const cleatBot = footY + shinW * 0.30;
    ctx.fillStyle = cleatColor;
    ctx.beginPath();
    ctx.moveTo(footX + heelBack, cleatTop + 0.2);
    ctx.quadraticCurveTo(footX + heelBack * 0.5, cleatTop - 0.2,
                          footX + toeFwd * 0.4, cleatTop);
    ctx.quadraticCurveTo(footX + toeFwd * 0.85, cleatTop + 0.1,
                          footX + toeFwd, cleatTop + (cleatBot - cleatTop) * 0.55);
    ctx.lineTo(footX + toeFwd * 0.8, cleatBot);
    ctx.lineTo(footX + heelBack,     cleatBot);
    ctx.closePath();
    ctx.fill();
    // Lit side of the cleat — small highlight across the upper toe-cap
    ctx.fillStyle = cleatLight;
    ctx.beginPath();
    ctx.moveTo(footX + toeFwd * 0.05, cleatTop + 0.1);
    ctx.quadraticCurveTo(footX + toeFwd * 0.55, cleatTop - 0.15,
                          footX + toeFwd * 0.85, cleatTop + 0.25);
    ctx.lineTo(footX + toeFwd * 0.85, cleatTop + 0.55);
    ctx.lineTo(footX + toeFwd * 0.05, cleatTop + 0.55);
    ctx.closePath();
    ctx.fill();
    // Dark sole stripe along the bottom — ground contact line
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(footX + heelBack, cleatBot - 0.35,
                 (toeFwd * 0.8) - heelBack, 0.5);
    // Outline
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(footX + heelBack, cleatTop + 0.2);
    ctx.quadraticCurveTo(footX + heelBack * 0.5, cleatTop - 0.2,
                          footX + toeFwd * 0.4, cleatTop);
    ctx.quadraticCurveTo(footX + toeFwd * 0.85, cleatTop + 0.1,
                          footX + toeFwd, cleatTop + (cleatBot - cleatTop) * 0.55);
    ctx.lineTo(footX + toeFwd * 0.8, cleatBot);
    ctx.lineTo(footX + heelBack,     cleatBot);
    ctx.closePath();
    ctx.stroke();
    // Foot dust — small light-tan puff behind the trailing foot during
    // run/carry. The leg with the LARGER lift is mid-swing (in the air),
    // so we kick up dust from the OTHER (planted, pushing-off) foot.
    if ((pose === "run" || pose === "carry") && lift < 2) {
      ctx.fillStyle = "rgba(190,170,130,0.32)";
      const dustX = footX - facing * 1.2;
      const dustY = footY + 0.6;
      ctx.beginPath();
      ctx.ellipse(dustX, dustY, 2.4, 1.0, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(190,170,130,0.18)";
      ctx.beginPath();
      ctx.ellipse(dustX - facing * 0.8, dustY - 0.1, 1.6, 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();    // close the leg-vertical inverse-tilt save
  };
  // ── Arms — Lego-style chunky tubes. Bicep = sleeve, forearm = skin.
  // Nearly as wide as the helmet (helmRx≈6.4 → arm half-width ~2.7) and
  // attached right at the outer shoulder pad edge.
  const bicepW   = 2.7 + bt.bulk * 0.55;
  const forearmW = 2.5 + bt.bulk * 0.45;
  const drawArm = (side, angle, holdsBall, forearmOverride) => {
    const a = angle * facing;
    const sx = side * (padW/2 + 0.1);
    const upper = armLen * 0.55;
    const lower = armLen * 0.55;
    const elbowX = sx + Math.sin(a) * upper;
    const elbowY = shoulderY + Math.cos(a) * upper + armReachY * 0.4;
    // Forearm angle: caller can override (used for throwing whip).
    const lowerA = forearmOverride != null
      ? forearmOverride * facing
      : a - facing * 0.35 * Math.sign(Math.cos(a));
    const handX = elbowX + Math.sin(lowerA) * lower;
    const handY = elbowY + Math.cos(lowerA) * lower + armReachY * 0.6;
    // Jersey sleeve (bicep) — team color, very thick
    drawSegment(sx, shoulderY, elbowX, elbowY, bicepW, color, shadeDark, shadeLight);
    // Forearm — bare skin (short sleeves) or team color (long sleeves /
    // compression layer); linemen + ~15% of skill players wear long sleeves.
    if (longSleeves) {
      drawSegment(elbowX, elbowY, handX, handY, forearmW, color, shadeDark, shadeLight);
    } else {
      drawSegment(elbowX, elbowY, handX, handY, forearmW, skin.base, skin.dark, skin.light);
    }
    // Wristband — thin white band at the wrist
    const wbX = elbowX + (handX - elbowX) * 0.82;
    const wbY = elbowY + (handY - elbowY) * 0.82;
    drawSegment(wbX, wbY, handX, handY, forearmW * 1.08, "#f1f1f1", "#bcbcbc", "#ffffff");
    // Glove — team-secondary color block covering the hand. QBs skip it
    // (throwing-hand grip + balance-hand bare). The bare-hand fallback
    // keeps the original skin-tone knuckle so QB hands still read.
    const tipDX = Math.sin(lowerA) * forearmW * 0.25;
    const tipDY = Math.cos(lowerA) * forearmW * 0.25;
    if (wearsGloves) {
      const gloveColor = secondary || "#222";
      const gloveDark  = tweakColor(gloveColor, 0.6) || "#000";
      const gloveLight = tweakColor(gloveColor, 1.15) || "#fff";
      const gloveStartX = wbX + (handX - wbX) * 0.55;
      const gloveStartY = wbY + (handY - wbY) * 0.55;
      drawSegment(gloveStartX, gloveStartY, handX, handY, forearmW * 1.18,
                  gloveColor, gloveDark, gloveLight);
      ctx.fillStyle = gloveLight;
      ctx.beginPath();
      ctx.arc(handX - tipDX * 0.4, handY - tipDY * 0.4, forearmW * 0.3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = skin.light;
      ctx.beginPath();
      ctx.arc(handX - tipDX * 0.4, handY - tipDY * 0.4, forearmW * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    if (holdsBall) {
      // Brown football — leather oval with white laces. Was a black
      // isometric cube which had nothing to do with a football. The
      // ball tilts in the carry direction (facing) so it points the
      // way the player is moving, like a real tucked-in carry.
      ctx.save();
      ctx.translate(handX, handY + 0.4);
      const tilt = -0.30 * facing;
      ctx.rotate(tilt);
      const rx = 3.6, ry = 1.8;        // oval radii
      // Leather base — radial gradient for a slight 3D bulge
      const ballGrad = ctx.createRadialGradient(-rx * 0.3, -ry * 0.5, 0.2,
                                                 0, 0, rx * 1.2);
      ballGrad.addColorStop(0,    "#a86a3a");
      ballGrad.addColorStop(0.55, "#7a4a26");
      ballGrad.addColorStop(1,    "#4a2c14");
      ctx.fillStyle = ballGrad;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      // White laces — three small bars across the top center
      ctx.fillStyle = "#f5f5f0";
      ctx.fillRect(-0.9, -0.35, 1.8, 0.55);
      ctx.strokeStyle = "rgba(40,30,20,0.7)";
      ctx.lineWidth = 0.18;
      for (let i = 0; i < 4; i++) {
        const lx = -0.7 + i * 0.46;
        ctx.beginPath();
        ctx.moveTo(lx, -0.45);
        ctx.lineTo(lx,  0.30);
        ctx.stroke();
      }
      // White ring stripes at each end (NFL ball has them; college doesn't,
      // but stylized white stripes help the ball read at small scales)
      ctx.fillStyle = "rgba(245,245,240,0.85)";
      ctx.fillRect( rx * 0.55, -ry * 0.7, 0.35, ry * 1.4);
      ctx.fillRect(-rx * 0.55 - 0.35, -ry * 0.7, 0.35, ry * 1.4);
      // Outline
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      // Fingers wrapping the near end of the ball — small glove/skin
      // bumps sticking out from behind the ball at the carry-side end.
      const wrapColor = wearsGloves ? (secondary || "#222") : skin.dark;
      ctx.fillStyle = wrapColor;
      ctx.beginPath();
      ctx.ellipse(handX - facing * 2.4, handY + 0.6, 0.9, 1.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 0.3;
      ctx.stroke();
    }
    return { handX, handY };
  };
  // ── Z-ordered limb draw — FAR limbs (away from the camera) go BEHIND
  // the body, NEAR limbs go IN FRONT, so arms and the front leg never
  // visually overlap the torso in an awkward way.
  // Camera is looking at the player from his FRONT-near-side, which means
  // the side OPPOSITE the facing direction is the NEAR side:
  //   facing=+1 (right-facing) → NEAR = left side (side=-1)
  //   facing=-1 (left-facing)  → NEAR = right side (side=+1)
  const farSide  = facing;       // the side AWAY from the camera
  const nearSide = -facing;
  // FAR leg first (gets covered by the torso where they overlap)
  if (farSide === 1) drawLeg(1, rLeg, rLegLift);
  else               drawLeg(-1, lLeg, lLegLift);
  // FAR arm — drawn behind the body, before the shoulder pads
  const farHand = farSide === 1
    ? drawArm(1, rArm, rightHandBall, rForearmOverride)
    : drawArm(-1, lArm, leftHandBall, lForearmOverride);

  // ── Shoulder pads — curved deltoid crowns with a center neck dip.
  // Replaced the old flat slab: NFL pads have two raised lobes over the
  // deltoids and a lower scoop in the middle where the jersey collar
  // shows through. The helmet sits in that scoop, which both reveals a
  // bit of neck and makes the silhouette read like a player not a brick.
  const padTopY  = shoulderY - 1.8;       // crest of the deltoid lobes
  const padDipY  = shoulderY - 0.6;       // bottom of the center neck scoop
  const padBotY  = shoulderY + 2.2;
  const padHalfW = padW / 2;
  const padGrad = ctx.createLinearGradient(0, padTopY, 0, padBotY);
  padGrad.addColorStop(0,    shadeLight);
  padGrad.addColorStop(0.55, color);
  padGrad.addColorStop(1,    shadeDark);
  ctx.fillStyle = padGrad;
  ctx.beginPath();
  ctx.moveTo(-padHalfW, padBotY);
  ctx.lineTo(-padHalfW, padTopY + 0.4);
  // left deltoid lobe
  ctx.quadraticCurveTo(-padHalfW * 0.85, padTopY - 0.2, -padHalfW * 0.55, padTopY);
  // dip toward neck
  ctx.quadraticCurveTo(-padHalfW * 0.20, padDipY,        0,                  padDipY);
  ctx.quadraticCurveTo( padHalfW * 0.20, padDipY,        padHalfW * 0.55,    padTopY);
  // right deltoid lobe
  ctx.quadraticCurveTo( padHalfW * 0.85, padTopY - 0.2,  padHalfW,           padTopY + 0.4);
  ctx.lineTo(padHalfW, padBotY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.lineWidth = 1.0;
  ctx.stroke();
  // Rim light on each deltoid crest
  ctx.strokeStyle = "rgba(255,240,205,0.55)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-padHalfW * 0.92, padTopY + 0.3);
  ctx.quadraticCurveTo(-padHalfW * 0.80, padTopY - 0.05, -padHalfW * 0.55, padTopY + 0.15);
  ctx.moveTo( padHalfW * 0.92, padTopY + 0.3);
  ctx.quadraticCurveTo( padHalfW * 0.80, padTopY - 0.05,  padHalfW * 0.55, padTopY + 0.15);
  ctx.stroke();
  // Pad lip — dark shadow line under the pad (ambient occlusion at the
  // pad-to-torso seam). Slightly deeper than before so the pad reads as
  // a separate piece of equipment resting on the jersey.
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(-padW/2 + 0.3, padBotY - 0.6, padW - 0.6, 0.5);
  // Armhole AO — small dark wedges where the bicep meets the pad, so the
  // arm reads as inset into the shoulder pad rather than glued on top.
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(-padW/2 + 0.4, padBotY - 0.5, 1.4, 1.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse( padW/2 - 0.4, padBotY - 0.5, 1.4, 1.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Torso — TAPERED trapezoid (wider at chest, narrower at waist).
  // Was a flat rectangle, which made every player look like a block of
  // cheese. Real shoulder-pad silhouette tapers ~20-30% from pad width
  // down to the waist; torsoBotW (per body type) drives the waist width
  // so HUGE keeps a barrel torso and LEAN tapers to a wedge.
  const torsoTopW = (padW - 1.6);
  const torsoBotWAdj = Math.max(torsoBotW, torsoTopW * 0.55);
  const torsoTop = shoulderY + 2;
  const torsoH = hipY - torsoTop;
  const ttHalf = torsoTopW / 2;
  const tbHalf = torsoBotWAdj / 2;
  const torsoGradH = ctx.createLinearGradient(-ttHalf, 0, ttHalf, 0);
  torsoGradH.addColorStop(0,    shadeDark);
  torsoGradH.addColorStop(0.30, color);
  torsoGradH.addColorStop(0.70, color);
  torsoGradH.addColorStop(1,    shadeMid);
  ctx.fillStyle = torsoGradH;
  ctx.beginPath();
  ctx.moveTo(-ttHalf, torsoTop);
  ctx.lineTo( ttHalf, torsoTop);
  ctx.lineTo( tbHalf, hipY);
  ctx.lineTo(-tbHalf, hipY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.lineWidth = 1.0;
  ctx.stroke();
  // Secondary-color side stripes — follow the taper so they read as part
  // of the jersey, not stickers on a box.
  ctx.fillStyle = secondary || "#fff";
  const stripeW = 0.9;
  ctx.beginPath();
  ctx.moveTo(-ttHalf,           torsoTop);
  ctx.lineTo(-ttHalf + stripeW, torsoTop);
  ctx.lineTo(-tbHalf + stripeW, hipY);
  ctx.lineTo(-tbHalf,           hipY);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo( ttHalf,           torsoTop);
  ctx.lineTo( ttHalf - stripeW, torsoTop);
  ctx.lineTo( tbHalf - stripeW, hipY);
  ctx.lineTo( tbHalf,           hipY);
  ctx.closePath();
  ctx.fill();
  // Belt — dark band at the bottom, follows the waist width
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(-tbHalf, hipY - 1.2, torsoBotWAdj, 1.2);
  // Subtle vertical chest highlight on the LIT side
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.fillRect(ttHalf * 0.30, torsoTop + 0.5, ttHalf * 0.18, torsoH - 1.5);
  // Aliases for downstream (captain patch / towel) that were written
  // against the old rectangle origin.
  const torsoW = torsoTopW;
  const torsoX = -ttHalf;

  if (label && /^\d{1,2}$/.test(label)) {
    // Last-name strip — small uppercase nameplate above the jersey number,
    // truncated to 7 chars so long names still fit on the small torso.
    if (style.name) {
      const lastName = String(style.name).split(/\s+/).pop().toUpperCase().slice(0, 7);
      ctx.font = "bold 2.4px Impact, Arial Black, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const namY = shoulderY + torsoLen * 0.22;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(lastName, 0.15, namY + 0.15);
      ctx.fillStyle = secondary || "#fff";
      ctx.fillText(lastName, 0, namY);
    }
    // Big, block-style jersey number with a dark drop shadow
    ctx.font = "bold 8.5px Impact, Arial Black, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const ny = shoulderY + torsoLen * 0.55;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(label, 0.6, ny + 0.6);
    ctx.fillStyle = secondary || "#fff";
    ctx.fillText(label, 0, ny);
    // Thin dark outline so the number reads cleanly over any jersey
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 0.4;
    ctx.strokeText(label, 0, ny);
  }
  // Captain "C" patch — small gold square with a black "C" on the upper
  // chest, near the front of the jersey. Only nicknamed (elite) players
  // wear it. Sits on the lit side of the torso so it catches the eye.
  if (isCaptain) {
    const cx = torsoX + torsoW * 0.78;
    const cy = torsoTop + 1.6;
    ctx.fillStyle = "#f5c542";          // gold patch
    ctx.fillRect(cx - 1.1, cy - 1.1, 2.2, 2.2);
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 0.3;
    ctx.strokeRect(cx - 1.1, cy - 1.1, 2.2, 2.2);
    ctx.fillStyle = "#0a0a0a";
    ctx.font = "bold 1.9px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("C", cx, cy + 0.1);
  }
  // Towel — small white rectangle hanging from the belt with a per-player
  // sway driven by the run cycle. ~55% of players have one (deterministic
  // from phaseHash).
  if (wearsTowel) {
    const twHangX = torsoX + torsoW * 0.30;
    const twHangY = hipY - 0.4;
    const sway = (pose === "run" || pose === "carry")
      ? Math.sin(t * Math.PI * 2 + phaseOffset * 4) * 0.6
      : 0;
    ctx.fillStyle = "rgba(245,245,240,0.92)";
    ctx.beginPath();
    ctx.moveTo(twHangX - 0.7,        twHangY);
    ctx.lineTo(twHangX + 0.7,        twHangY);
    ctx.lineTo(twHangX + 0.5 + sway, twHangY + 2.4);
    ctx.lineTo(twHangX - 0.5 + sway, twHangY + 2.4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 0.2;
    ctx.stroke();
  }

  // ── Arms — Lego-style chunky tubes. Bicep = sleeve, forearm = skin.
  // Nearly as wide as the helmet (helmRx≈6.4 → arm half-width ~2.7) and
  // attached right at the outer shoulder pad edge.
  // (drawArm function + bicepW/forearmW were moved up to before the FAR
  // leg/arm draws — see the z-ordered limb section.)

  // NEAR leg — drawn AFTER the torso so the front-of-body leg correctly
  // overlaps the lower torso (instead of disappearing behind it).
  if (nearSide === 1) drawLeg(1, rLeg, rLegLift);
  else                drawLeg(-1, lLeg, lLegLift);

  // ── Helmet — NFL silhouette (path-based). Taller than wide, tapered jaw,
  // pronounced forward overhang at the brow where the facemask attaches.
  // From a side view: bulged crown, curve down the back to the earhole, jaw-
  // guard tapers IN sharply below ear, front juts forward at brow level.
  const helmRx = headR * 0.85 + 0.2;     // smaller relative to body
  const helmRy = helmH + 1.3;             // proportionally shorter (helmH itself was reduced)
  const helmY  = shoulderY - helmRy - 1.4; // lifted to expose a visible neck above the pads
  // facing-aware front/back x signs
  const fF =  facing;   // +1 = front
  const fB = -facing;
  // Visible neck — skin-toned wedge filling the gap between the helmet
  // jaw and the shoulder-pad scoop. Was previously implicit (helmet
  // overlapped the pads with no neck at all), which made the helmet look
  // bolted directly to the torso.
  const neckTopY = helmY + helmRy * 0.78;
  const neckBotY = padDipY + 0.2;
  const neckHalfW = helmRx * 0.42;
  ctx.fillStyle = skin.dark;
  ctx.beginPath();
  ctx.moveTo(-neckHalfW * 0.85, neckTopY);
  ctx.lineTo( neckHalfW * 0.85, neckTopY);
  ctx.lineTo( neckHalfW,        neckBotY);
  ctx.lineTo(-neckHalfW,        neckBotY);
  ctx.closePath();
  ctx.fill();
  // Neck shadow — dark crescent on the pad scoop just under the chin
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.ellipse(0, padDipY + 0.1, helmRx * 0.50, 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  // Visible chin/jaw — skin sliver below the helmet jaw guard
  ctx.fillStyle = skin.base;
  ctx.beginPath();
  ctx.ellipse(fF * 0.4, helmY + helmRy * 0.92, helmRx * 0.50, helmRy * 0.20, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = skin.dark;
  ctx.lineWidth = 0.5;
  ctx.stroke();
  // Helmet body — custom path: crown bulge → front overhang at brow → jaw taper → back curve
  // Path points (relative to center, facing-aware):
  const _crownT  = { x: fF * 0.2,         y: helmY - helmRy * 0.95 };  // top of crown
  const _frontT  = { x: fF * helmRx * 0.85, y: helmY - helmRy * 0.55 };  // upper front
  const _brow    = { x: fF * helmRx * 1.02, y: helmY - helmRy * 0.10 };  // brow jut (widest in front)
  const _frontM  = { x: fF * helmRx * 0.90, y: helmY + helmRy * 0.30 };  // mid front
  const _jawF    = { x: fF * helmRx * 0.55, y: helmY + helmRy * 0.78 };  // jaw front
  const _chin    = { x: fF * 0.0,           y: helmY + helmRy * 0.92 };  // chin bottom
  const _jawB    = { x: fB * helmRx * 0.65, y: helmY + helmRy * 0.75 };  // jaw back
  const _backM   = { x: fB * helmRx * 0.95, y: helmY + helmRy * 0.10 };  // mid back (widest back)
  const _backT   = { x: fB * helmRx * 0.75, y: helmY - helmRy * 0.55 };  // upper back
  const helmGrad = ctx.createRadialGradient(fF * 1.8, helmY - helmRy * 0.45, 0.5,
                                            0, helmY, helmRx + 1.6);
  helmGrad.addColorStop(0,    shadeLight);
  helmGrad.addColorStop(0.4,  color);
  helmGrad.addColorStop(1,    shadeDark);
  ctx.fillStyle = helmGrad;
  ctx.beginPath();
  ctx.moveTo(_crownT.x, _crownT.y);
  // Crown → front upper (gentle outward arc)
  ctx.bezierCurveTo(fF * helmRx * 0.55, helmY - helmRy * 1.00,
                    fF * helmRx * 0.85, helmY - helmRy * 0.85,
                    _frontT.x, _frontT.y);
  // Front upper → brow (forward jut)
  ctx.bezierCurveTo(fF * helmRx * 1.00, helmY - helmRy * 0.40,
                    fF * helmRx * 1.05, helmY - helmRy * 0.25,
                    _brow.x, _brow.y);
  // Brow → mid front (slight retreat)
  ctx.bezierCurveTo(fF * helmRx * 1.02, helmY + helmRy * 0.10,
                    fF * helmRx * 0.98, helmY + helmRy * 0.20,
                    _frontM.x, _frontM.y);
  // Mid front → jaw front (taper in)
  ctx.bezierCurveTo(fF * helmRx * 0.82, helmY + helmRy * 0.55,
                    fF * helmRx * 0.70, helmY + helmRy * 0.72,
                    _jawF.x, _jawF.y);
  // Jaw front → chin (narrow underside)
  ctx.bezierCurveTo(fF * helmRx * 0.30, helmY + helmRy * 0.95,
                    fF * helmRx * 0.10, helmY + helmRy * 0.98,
                    _chin.x, _chin.y);
  // Chin → jaw back
  ctx.bezierCurveTo(fB * helmRx * 0.20, helmY + helmRy * 0.95,
                    fB * helmRx * 0.40, helmY + helmRy * 0.85,
                    _jawB.x, _jawB.y);
  // Jaw back → mid back (gentle outward arc)
  ctx.bezierCurveTo(fB * helmRx * 0.90, helmY + helmRy * 0.55,
                    fB * helmRx * 1.00, helmY + helmRy * 0.30,
                    _backM.x, _backM.y);
  // Mid back → upper back
  ctx.bezierCurveTo(fB * helmRx * 0.95, helmY - helmRy * 0.20,
                    fB * helmRx * 0.88, helmY - helmRy * 0.40,
                    _backT.x, _backT.y);
  // Upper back → crown (closing arc)
  ctx.bezierCurveTo(fB * helmRx * 0.55, helmY - helmRy * 0.90,
                    fB * helmRx * 0.30, helmY - helmRy * 1.00,
                    _crownT.x, _crownT.y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // Center stripe — mohawk along the crown. Bezier traces the top of the
  // new helmet path so the stripe sits ON the helmet, not floating above it.
  ctx.strokeStyle = secondary || "#fff";
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(fB * helmRx * 0.55, helmY - helmRy * 0.78);
  ctx.bezierCurveTo(fB * helmRx * 0.30, helmY - helmRy * 0.97,
                    fF * helmRx * 0.20, helmY - helmRy * 0.97,
                    fF * helmRx * 0.55, helmY - helmRy * 0.78);
  ctx.stroke();
  // Top-front highlight — bright reflection on the upper-front dome
  ctx.strokeStyle = "rgba(255,255,255,0.40)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(fF * helmRx * 0.30, helmY - helmRy * 0.88);
  ctx.bezierCurveTo(fF * helmRx * 0.75, helmY - helmRy * 0.70,
                    fF * helmRx * 0.95, helmY - helmRy * 0.40,
                    fF * helmRx * 0.95, helmY - helmRy * 0.10);
  ctx.stroke();
  // Ear hole — small dark dot on the back side, positioned mid-helmet
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.beginPath();
  ctx.arc(fB * helmRx * 0.50, helmY + helmRy * 0.10, 1.0, 0, Math.PI * 2);
  ctx.fill();
  // ── Team logo decal on the side of the helmet (small badge with team's
  // secondary color outline, primary fill) ─────
  const logoX = facing * helmRx * 0.05;
  const logoY = helmY + helmRy * 0.05;
  ctx.fillStyle = secondary || "#fff";
  ctx.beginPath();
  ctx.ellipse(logoX, logoY, 2.2, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(logoX, logoY, 1.5, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Tiny highlight on logo
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath();
  ctx.arc(logoX - 0.3, logoY - 0.4, 0.5, 0, Math.PI * 2);
  ctx.fill();
  // ── Facemask cage — chrome bars protruding from the brow → chin. Attaches
  // at the brow's forward jut point (helmRx * 1.02) and extends to chin guard.
  const fxOuter = facing * (helmRx + 0.5);
  const fxInner = facing * (helmRx * 0.30);
  const cageTop = helmY - helmRy * 0.05;
  const cageBot = helmY + helmRy * 0.58;
  // Vertical "nose" bar curving slightly outward
  ctx.strokeStyle = "#2c2c34";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(fxOuter - facing * 0.3, cageTop);
  ctx.quadraticCurveTo(fxOuter + facing * 0.4, (cageTop + cageBot) / 2,
                       fxOuter - facing * 0.4, cageBot);
  ctx.stroke();
  // Horizontal cage bars (4 rows, slight downward sweep toward the front)
  ctx.lineWidth = 1.3;
  const cageHeights = [cageTop + 0.4, cageTop + (cageBot - cageTop) * 0.34,
                       cageTop + (cageBot - cageTop) * 0.62, cageBot - 0.2];
  for (const cy of cageHeights) {
    ctx.beginPath();
    ctx.moveTo(fxOuter - facing * 0.3, cy);
    ctx.lineTo(fxInner, cy);
    ctx.stroke();
  }
  // Chrome highlight on top of each bar
  ctx.strokeStyle = "#b8b8c0";
  ctx.lineWidth = 0.5;
  for (const cy of cageHeights) {
    ctx.beginPath();
    ctx.moveTo(fxOuter - facing * 0.4, cy - 0.45);
    ctx.lineTo(fxInner * 0.7, cy - 0.45);
    ctx.stroke();
  }
  // Chinstrap — white band under the jaw
  ctx.fillStyle = "#f1f1f1";
  ctx.fillRect(-helmRx * 0.7, helmY + helmRy * 0.95, helmRx * 1.4, 0.9);
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 0.3;
  ctx.strokeRect(-helmRx * 0.7, helmY + helmRy * 0.95, helmRx * 1.4, 0.9);
  // Stadium rim light — warm white arc traced along the upper rim of the
  // helmet, suggesting overhead floodlights catching the top of the dome.
  // Ties the player to the stadium-light bloom in the wrap backdrop.
  ctx.strokeStyle = "rgba(255,240,205,0.55)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(0, helmY + 0.2, helmRx * 0.96, helmRy * 0.96, 0,
              Math.PI * 1.12, Math.PI * 1.88);
  ctx.stroke();
  // Helmet number — small jersey number on the BACK side of the helmet
  // (behind the ear hole, opposite the facemask). Reads as a player
  // identifier when the helmet is rotated away from camera.
  if (label && /^\d{1,2}$/.test(label)) {
    ctx.font = "bold 2.4px Impact, Arial Black, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillText(label, -facing * helmRx * 0.58 + 0.1, helmY + 0.65);
    ctx.fillStyle = secondary || "#fff";
    ctx.fillText(label, -facing * helmRx * 0.58,        helmY + 0.55);
  }
  // Visor — chrome reflective arc across the front of the facemask area,
  // worn by ~30% of skill-position players. Sits inside the cage.
  if (wearsVisor) {
    const visGrad = ctx.createLinearGradient(
      facing * helmRx * 0.3,  cageTop,
      facing * helmRx * 0.85, cageBot
    );
    visGrad.addColorStop(0,   "rgba(120,160,200,0.85)");
    visGrad.addColorStop(0.5, "rgba(40,60,90,0.85)");
    visGrad.addColorStop(1,   "rgba(20,30,55,0.9)");
    ctx.fillStyle = visGrad;
    ctx.beginPath();
    ctx.moveTo(fxInner * 0.9,    cageTop + 0.4);
    ctx.quadraticCurveTo(
      facing * (helmRx + 0.15), (cageTop + cageBot) / 2,
      fxInner * 0.9,            cageBot - 0.4);
    ctx.lineTo(fxInner * 0.6,    cageBot - 0.6);
    ctx.quadraticCurveTo(
      facing * helmRx * 0.7,    (cageTop + cageBot) / 2,
      fxInner * 0.6,             cageTop + 0.6);
    ctx.closePath();
    ctx.fill();
    // Sharp specular streak across the visor
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(facing * helmRx * 0.7,  cageTop + 0.9);
    ctx.lineTo(facing * helmRx * 0.95, cageBot - 1.2);
    ctx.stroke();
  }

  // NEAR arm — drawn LAST, after both the body AND the helmet, so it
  // appears in front of everything else. The arm on the camera-near side
  // is the one visually closest to the viewer, and the throw cock-pose's
  // raised arm will end up here too (eliminating the old behind-helmet
  // disappear bug without needing a special-case defer).
  const nearHand = nearSide === 1
    ? drawArm(1, rArm, rightHandBall, rForearmOverride)
    : drawArm(-1, lArm, leftHandBall, lForearmOverride);
  // lHand / rHand for any downstream consumers (3-point ground-hand decal).
  const lHand = farSide === -1 ? farHand : nearHand;
  const rHand = farSide === 1  ? farHand : nearHand;
  // CRADLE BALL — football held with BOTH hands at chest. Drawn at the
  // midpoint of the two hands so it reads as "tucked between hands"
  // instead of clutched off to one side. Wrap fingers protrude from
  // behind each end of the ball.
  if (cradleBall) {
    // Tucked under the carrying arm — position at the wrapping hand,
    // then pull INWARD toward the body center so the ball sits between
    // the bicep and the ribs (under the armpit), not floating in front
    // of the chest. The carry hand is on one side per cradleBallSide.
    const carryHand = cradleBallSide === 1 ? rHand : lHand;
    const bx = carryHand.handX + cradleBallSide * -1.2;   // inward toward body
    const by = carryHand.handY + 0.6;                      // slightly below the hand
    // ── HANDS-TRACK-BALL ──────────────────────────────────────────────
    // Stash the world-space position of this carry hand so the caller
    // can draw the standalone ball AT THE HAND instead of at body
    // center. Per-player keyed by name so multiple carriers in the
    // same frame (rare — handoff transitions) don't overwrite each
    // other; consumer looks up by carrier name.
    const _localToWorld = (lx, ly) => ({
      x: x + lx * totalScale,
      y: y + ly * totalScale,
    });
    const _w = _localToWorld(bx, by);
    drawPlayer._carryHandSink = drawPlayer._carryHandSink || {};
    drawPlayer._carryHandSink[style.name || ("p_" + label)] = { x: _w.x, y: _w.y, frameMs: performance.now() };
    ctx.save();
    ctx.translate(bx, by);
    // Tilt the ball so the nose points slightly forward in the run
    // direction (facing-dependent) — a tucked ball usually points
    // forward, not perpendicular.
    ctx.rotate(-0.20 * facing);
    const rx = 3.6, ry = 1.8;
    const ballGrad = ctx.createRadialGradient(-rx * 0.3, -ry * 0.5, 0.2, 0, 0, rx * 1.2);
    ballGrad.addColorStop(0,    "#a86a3a");
    ballGrad.addColorStop(0.55, "#7a4a26");
    ballGrad.addColorStop(1,    "#4a2c14");
    ctx.fillStyle = ballGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f5f5f0";
    ctx.fillRect(-0.9, -0.35, 1.8, 0.55);
    ctx.strokeStyle = "rgba(40,30,20,0.7)";
    ctx.lineWidth = 0.18;
    for (let i = 0; i < 4; i++) {
      const lx = -0.7 + i * 0.46;
      ctx.beginPath();
      ctx.moveTo(lx, -0.45);
      ctx.lineTo(lx,  0.30);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(245,245,240,0.85)";
    ctx.fillRect( rx * 0.55, -ry * 0.7, 0.35, ry * 1.4);
    ctx.fillRect(-rx * 0.55 - 0.35, -ry * 0.7, 0.35, ry * 1.4);
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // Fingers — small thumb-tip bumps poking over the ball ends. Sized
    // so they READ as fingers gripping a ball, not as flanking blobs.
    const wrapColor = wearsGloves ? (secondary || "#222") : skin.dark;
    ctx.fillStyle = wrapColor;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 0.25;
    // Place the finger nub slightly INWARD from each hand so it overlaps
    // the ball end rather than sitting away from it. Direction = from
    // hand toward ball center, capped at a small offset.
    const fingerNub = (hx, hy) => {
      const dx = bx - hx, dy = by - hy;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      const fx = hx + ux * 1.4;        // small inward offset onto ball edge
      const fy = hy + uy * 1.4;
      ctx.beginPath();
      ctx.ellipse(fx, fy, 0.55, 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    // Only the CARRYING hand grips the ball — the other arm is pumping.
    fingerNub(carryHand.handX, carryHand.handY);
  }
  // ── HANDS-TRACK-BALL for THROW and REACH/CATCH poses ──────────────
  // The carry case (cradleBall) is handled above. For throw, the ball-
  // hand is whichever arm holds the ball (leftHandBall / rightHandBall
  // flags set in the pose). For reach/catch, both hands are extended
  // up — stash the midpoint so the ball arrives between them.
  if ((pose === "throw" || pose === "reach" || pose === "catch") && style && (style.name || label != null)) {
    let handX_local = null, handY_local = null;
    if (pose === "throw") {
      const ballHand = rightHandBall ? rHand : leftHandBall ? lHand : null;
      if (ballHand) { handX_local = ballHand.handX; handY_local = ballHand.handY; }
    } else {
      // reach / catch — midpoint of the two raised hands
      if (lHand && rHand) {
        handX_local = (lHand.handX + rHand.handX) * 0.5;
        handY_local = (lHand.handY + rHand.handY) * 0.5;
      }
    }
    if (handX_local != null) {
      const wx = x + handX_local * totalScale;
      const wy = y + handY_local * totalScale;
      drawPlayer._carryHandSink = drawPlayer._carryHandSink || {};
      drawPlayer._carryHandSink[style.name || ("p_" + label)] = { x: wx, y: wy, frameMs: performance.now(), pose };
    }
  }
  // For 3-point stance, draw a ground line where the lead hand plants.
  if (drawGroundHand) {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(lHand.handX, lHand.handY + 0.5, 3, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (exclaim) {
    ctx.fillStyle = "#f0cc30";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(exclaim, 0, helmY - helmH - 4);
  }

  ctx.restore();
  // Broadcast scale wrapper restore (set at the top of drawPlayer)
  if (style._bcastRestore) ctx.restore();
}

// Goalpost (Y-shape, tall yellow uprights) at (cx, cy) — used in tactical view
function drawGoalposts(ctx, cx, cy) {
  const POST_HALF = 40;     // distance from center to each upright
  const POST_TOP  = FIELD.TOP - 4;
  const POST_BOT  = cy + 22;
  ctx.save();
  ctx.strokeStyle = "#ffe048";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  // Crossbar
  ctx.beginPath();
  ctx.moveTo(cx - POST_HALF, cy);
  ctx.lineTo(cx + POST_HALF, cy);
  ctx.stroke();
  // Uprights
  ctx.beginPath();
  ctx.moveTo(cx - POST_HALF, cy);
  ctx.lineTo(cx - POST_HALF, POST_TOP);
  ctx.moveTo(cx + POST_HALF, cy);
  ctx.lineTo(cx + POST_HALF, POST_TOP);
  ctx.stroke();
  // Center support down to ground
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, POST_BOT);
  ctx.stroke();
  // Base
  ctx.fillStyle = "#ffe048";
  ctx.beginPath();
  ctx.ellipse(cx, POST_BOT, 6, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBall(ctx, x, y, scale = 1, opts = {}) {
  // CARRIER FOOT → HAND auto-shift. If (x, y) is within ~half a sprite
  // width/height of an active carrier's foot position (set within the
  // last 100 ms), assume the ball is being carried and shift to that
  // carrier's hand position. Lets ball-render call sites that pass the
  // engine's (ballX, ballY) approximation get the right visual without
  // each site needing to do the sink lookup itself.
  //
  // Pose gate: ONLY shift when the closest player is in an active pose.
  // Pre-snap everyone is in stance/idle (nobody's holding anything yet)
  // — without this gate, the auto-shift treats the center as a carrier
  // and lifts the ball to his chest height, making it appear to float
  // in the offensive backfield instead of sitting at the LOS.
  if (!opts.skipCarryShift && drawPlayer._carryHandSink) {
    const now = performance.now();
    let bestDist = Infinity, bestE = null;
    for (const k in drawPlayer._carryHandSink) {
      const e = drawPlayer._carryHandSink[k];
      if (!e || e.footX == null || (now - e.frameMs) > 100) continue;
      const dx = x - e.footX, dy = y - e.footY;
      const d = Math.hypot(dx, dy);
      if (d < bestDist) { bestDist = d; bestE = e; }
    }
    // Settled poses indicate the player is set in formation, not
    // carrying — skip the shift. Active poses (carry/run/throw/reach/
    // dive/tackled/etc.) indicate the player may have the ball.
    const _settled = bestE && (bestE.pose === "stance" || bestE.pose === "idle" || bestE.pose === "point");
    if (bestE && bestDist < 24 && !_settled) {
      x = bestE.x;
      y = bestE.y;
      // Ball is being tucked under the arm — should read as parallel
      // to the ground (horizontal in top-down view), not at the
      // default in-flight tilt (-0.35 rad). Override unless caller
      // explicitly set an angle.
      if (opts.angle == null) opts = { ...opts, angle: 0 };
    }
  }
  // Broadcast camera: queue the ball draw to the upright overlay with
  // depth scaling. Sorted alongside player sprites in _frameEndBroadcast.
  if (typeof cameraMode !== "undefined" && cameraMode === "broadcast"
      && typeof _uprightCtx !== "undefined" && _uprightCtx
      && typeof _spriteQueue !== "undefined") {
    const proj = projectBroadcast(x, y);
    // Phase 3.3 — route ball to PIXI when player atlas is active so the
    // ball depth-sorts WITH PIXI player sprites via shared zIndex.
    if (typeof GCPlayer !== "undefined" && GCPlayer.active()) {
      GCPlayer.renderBall(proj.x, proj.y, scale * proj.scale, opts && opts.angle, opts);
      return;
    }
    const qCtx = _uprightCtx;
    const finalScale = scale * proj.scale;
    _spriteQueue.push({
      screenY: proj.y,
      run: () => _drawBallImpl(qCtx, proj.x, proj.y, finalScale, opts),
    });
    return;
  }
  _drawBallImpl(ctx, x, y, scale, opts);
}

function _drawBallImpl(ctx, x, y, scale = 1, opts = {}) {
  // Real football — brown leather oval with white laces. Sized to be
  // legible on a 1700-px-wide field while staying proportional to the
  // ~32px-tall player sprites: ~18px tall at scale 1 (was 28). Pulsing
  // yellow halo (opts.glow !== false) makes the ball trivially trackable
  // against player sprites.
  ctx.save();
  ctx.translate(x, y);
  // Visibility halo first (drawn under the ball). Catch-flash uses a
  // bigger green halo to celebrate the reception moment.
  if (opts.glow !== false) {
    const _catchFlash = opts.highlight === "catch";
    const haloRadius = (_catchFlash ? 22 : 12) * scale;
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloRadius);
    if (_catchFlash) {
      halo.addColorStop(0,    "rgba(120,255,120,0.85)");
      halo.addColorStop(0.45, "rgba(80,220,80,0.45)");
      halo.addColorStop(1,    "rgba(80,220,80,0)");
    } else {
      halo.addColorStop(0,    "rgba(255,225,90,0.55)");
      halo.addColorStop(0.45, "rgba(255,200,40,0.28)");
      halo.addColorStop(1,    "rgba(255,200,40,0)");
    }
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, haloRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  const angle = opts.angle != null ? opts.angle : -0.35;
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  // Drop shadow for grounding
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  // Body — radial gradient for that leather sheen
  const grad = ctx.createRadialGradient(-1.3, -2.5, 1.5, 0, 0, 10);
  grad.addColorStop(0, "#b86838");
  grad.addColorStop(0.55, "#7a3f1a");
  grad.addColorStop(1, "#3a1a08");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 0, 5, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Dark seam outline
  ctx.strokeStyle = "rgba(15,8,3,0.95)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(0, 0, 5, 9, 0, 0, Math.PI * 2);
  ctx.stroke();
  // White laces — five short cross-stripes near the center
  ctx.strokeStyle = "#fbf7ea";
  ctx.lineWidth = 1.0;
  ctx.lineCap = "round";
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(-1.6, i * 1.2);
    ctx.lineTo(1.6,  i * 1.2);
    ctx.stroke();
  }
  // Spine running through the laces
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, -3.0);
  ctx.lineTo(0,  3.0);
  ctx.stroke();
  // Highlight pip — top-left to give a "leather caught the light" pop
  ctx.fillStyle = "rgba(255,220,180,0.4)";
  ctx.beginPath();
  ctx.ellipse(-1.8, -3.2, 1.5, 0.7, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Pass-trail polyline: glowing dotted parabolic arc from release to
// current ball position. Sampled in 24 points for a smooth arc, with
// a soft yellow glow + warm white core so the throw path reads at a
// glance even amongst player sprites.
function drawBallTrail(ctx, fromX, fromY, toX, toY, t, opts = {}) {
  const arcHeight = opts.arcHeight ?? Math.min(140, Math.hypot(toX - fromX, toY - fromY) * 0.22);
  const samples = Math.max(8, Math.floor(t * 24));
  ctx.save();
  ctx.shadowColor = "rgba(255,210,80,0.6)";
  ctx.shadowBlur = 5;
  for (let i = 1; i < samples; i++) {
    const tt = (i / samples) * t;
    const lx = fromX + (toX - fromX) * tt;
    const ly = fromY + (toY - fromY) * tt - Math.sin(tt * Math.PI) * arcHeight;
    const age = (t - tt) / Math.max(0.001, t);  // 0 = freshest
    const fade = 1 - age;
    ctx.fillStyle = `rgba(255,240,180,${0.85 * fade})`;
    ctx.beginPath();
    ctx.arc(lx, ly, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Run-trail polyline: dotted line from snap point to current carrier
// position. Reads as a path stripe; fades from team color into bright
// behind the carrier so the route they ran is visible.
function drawRunTrail(ctx, fromX, fromY, toX, toY, t, color = "rgba(245,197,66,0.9)") {
  if (Math.hypot(toX - fromX, toY - fromY) < 12) return; // too short to read
  const samples = 18;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 4;
  for (let i = 1; i < samples; i++) {
    const tt = (i / samples) * t;
    const lx = fromX + (toX - fromX) * tt;
    const ly = fromY + (toY - fromY) * tt;
    const age = (t - tt) / Math.max(0.001, t);
    const fade = 1 - age;
    ctx.fillStyle = color.replace(/[\d.]+\)$/, `${0.85 * fade})`);
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ─── Formation & animation ────────────────────────────────────────────────
// Generate 11 offensive + 11 defensive player positions for a given LOS (abs X)
// poss = "home" | "away" → home offense moves left→right, away moves right→left
function makeFormation(losX, poss, opts = {}) {
  const dir = poss === "home" ? 1 : -1;  // direction offense moves (positive = right)
  const cy = (FIELD.TOP + FIELD.BOT) / 2;
  const PX = FIELD.PX_PER_YARD;
  // Goal-line: offense inside the opp 5 (yardLine >= 95). Compresses both
  // sides — defense crashes the box, offense uses a heavy front. Wide
  // receivers come tight, safeties walk down, LBs press to the LOS.
  const isGL = !!opts.isGoalLine;

  // Personnel grouping — defaults to BASE (legacy 1RB/1TE/2WR). twoBack
  // legacy flag forces I_FORM. Defensive package matches the WR count.
  let personnel = opts.personnel || (opts.twoBack ? "I_FORM" : "BASE");
  if (!PERSONNEL[personnel]) personnel = "BASE";
  const personDef = PERSONNEL[personnel];
  const defPackage = opts.defPackage || packageForPersonnel(personnel);
  const dpDef = DEF_PACKAGE[defPackage] || DEF_PACKAGE.BASE_43;

  // Offensive line (5) along LOS — wider gaps so the middle of the field
  // isn't visually cramped at the bigger field resolution. Goal-line:
  // tighter splits to give a heavier wall.
  const oline = [];
  const olGap = isGL ? 26 : 32;
  for (let i = -2; i <= 2; i++) {
    oline.push({ x: losX - dir * 2, y: cy + i * olGap, role: "OL" });
  }

  // ── WIDE RECEIVERS (1-5 depending on personnel) ──
  // wr1/wr2: outside on the numbers. wr3 in slot left. wr4 in slot right
  // (or trips bunch on the wr1 side). 5th WR (00 personnel) inside slot.
  // Normal-down split widths derive from FORMATION_DEPTHS (single source);
  // goal-line keeps its tighter literals. These widths also align the CBs
  // below, so a WR edit in the table moves its corner too.
  const wrSplit  = isGL ? 110 : Math.abs(FORMATION_DEPTHS.wr1.latYd) * PX;
  const slotWide = isGL ? 70  : Math.abs(FORMATION_DEPTHS.wr3.latYd) * PX;
  const slotInner = isGL ? 40 : FORMATION_DEPTHS.wr5.latYd * PX;
  const wrSlots = [];
  if (personDef.wr >= 1) wrSlots.push({ x: losX, y: cy - wrSplit, role: "WR1" });
  if (personDef.wr >= 2) wrSlots.push({ x: losX, y: cy + wrSplit, role: "WR2" });
  if (personDef.wr >= 3) wrSlots.push({ x: losX, y: cy - slotWide, role: "WR3" }); // slot left
  if (personDef.wr >= 4) wrSlots.push({ x: losX, y: cy + slotWide, role: "WR4" }); // slot right
  if (personDef.wr >= 5) wrSlots.push({ x: losX, y: cy + slotInner, role: "WR5" }); // tight slot

  // ── TIGHT ENDS (0-2) ──
  // TE1 outside RT; TE2 (HEAVY personnel) on the opposite side as a Y-flex.
  const teSlots = [];
  if (personDef.te >= 1) teSlots.push({ x: losX - dir * FORMATION_DEPTHS.te1.backYd * PX, y: cy + (isGL ? 60 : FORMATION_DEPTHS.te1.latYd * PX), role: "TE1" });
  if (personDef.te >= 2) teSlots.push({ x: losX - dir * FORMATION_DEPTHS.te2.backYd * PX, y: cy + (isGL ? -60 : FORMATION_DEPTHS.te2.latYd * PX), role: "TE2" });

  // QB — goal-line, QB is closer to the LOS (no deep dropback needed)
  const qb = { x: losX - dir * (isGL ? 3 : FORMATION_DEPTHS.qb.backYd) * PX, y: cy + FORMATION_DEPTHS.qb.latYd * PX, role: "QB" };

  // ── RUNNING BACKS (0-2) ──
  // 0 RB = empty backfield (00/01 personnel). 1 RB = standard. 2 RB = I-form
  // (FB stacked behind QB) or pro-set (side-by-side).
  let rb = null, fb = null;
  if (personDef.rb >= 1) {
    rb = { x: losX - dir * (isGL ? 6 : FORMATION_DEPTHS.rb.backYd) * PX, y: cy + (isGL ? 18 : FORMATION_DEPTHS.rb.latYd * PX), role: "RB" };
  }
  if (personDef.rb >= 2) {
    const style = opts.twoBackStyle || (Math.random() < 0.5 ? "I" : "PRO");
    if (style === "I") {
      // I-Form: FB and RB stacked behind QB on the midline. QB is at backYd=6
      // (FORMATION_DEPTHS — engine doesn't model under-center). Old spacing
      // put FB only 1 yd behind QB at cy+4 and RB 4 yd behind QB at cy+6 —
      // sprites (~30 px) pixel-overlapped with the QB and read as a duplicate
      // RB. Now FB sits 3 yd deeper than QB, RB another 3 yd behind FB, all
      // axis-aligned at cy (real I-Form is a centered column). Goal-line
      // keeps tighter splits so the heavy set still feels compressed.
      fb = { x: losX - dir * (isGL ? 6 : 9)  * PX, y: cy, role: "FB" };
      rb = { x: losX - dir * (isGL ? 9 : 12) * PX, y: cy, role: "RB" };
    } else {
      fb = { x: losX - dir * (isGL ? 6 : 8) * PX, y: cy - (isGL ? 14 : 22), role: "FB" };
      rb = { x: losX - dir * (isGL ? 6 : 8) * PX, y: cy + (isGL ? 18 : 28), role: "RB" };
    }
  }

  // ── FRONT-SEVEN STACK ──────────────────────────────────────────────
  // DL and LB depths are MECHANICALLY COUPLED — LBs play "behind the
  // front" in real football and need physical separation from the DL
  // row in sprite space (~30px width means we need ~3yd between row
  // centers to avoid visible clipping). Encoded as relative offset so
  // bumping DL depth automatically pushes LBs back too (the bug that
  // shipped before this refactor: bumped DL_DEPTH 1.5→2.5 but forgot
  // to bump lbDepth, so LBs visibly touched the DL).
  // Secondary (CB/S) depths are NOT in this stack — they're scheme-
  // driven (press vs off coverage, single-high vs split safety) and
  // change with the coverage call, not with the front depth.
  // NOTE: engine motion tracks (_buildPassZoneDrops in play-engine.js,
  // sacker starts, run blockers) hardcode matching depths. If you
  // change DL_DEPTH_YD or LB_BEHIND_DL_YD, also update those.
  //
  // 2.5yd separation = ~37.5px gap given PX_PER_YARD=15. With ~20px
  // body half-width, OL and DL bodies just kiss at the LOS pre-snap
  // — legal formation (neither offsides nor in the neutral zone).
  // Engagement happens POST-SNAP via animation pushes (see OL drive
  // in play-animation.js run/pass branches) — real football: stay on
  // your side until the ball moves.
  const DL_DEPTH_YD     = isGL ? 1.0 : 2.5;     // DL on the ball
  const LB_BEHIND_DL_YD = isGL ? 1.5 : 3.0;     // gap-fill depth behind front
  // 3RD-AND-LONG (and PREVENT package) defensive depth rotation. Real
  // long-yardage defenses retreat the second level into intermediate
  // zones so nothing breaks past the sticks: LBs to "depth of marker",
  // safeties to deep halves, CBs to off coverage. Without this every
  // down looked the same. Triggered on (3rd/4th + 8yds+) or absurd
  // distance (15+ regardless of down), or when engine calls PREVENT.
  const _down = opts.down ?? 0;
  const _ytg  = opts.ytg ?? 10;
  const _defPkg = opts.defPackage || "";
  const _isLongYd = !isGL && (
    (_down >= 3 && _ytg >= 8) ||
    _ytg >= 15 ||
    _defPkg === "PREVENT"
  );
  // Base LB depth = front stack + buffer. Long-yardage pushes LBs to
  // around the first-down marker (-2 yds so they're not chasing on the
  // catch). Clamp to a sane intermediate (max 18yd — past that you're
  // playing safety, not LB).
  const _lbBase = DL_DEPTH_YD + LB_BEHIND_DL_YD;
  const lbDepth = _isLongYd ? Math.min(18, Math.max(_lbBase, _ytg - 2))
                            : _lbBase;

  // Defensive line (4) — wider stance to match the OL spread.
  // Goal-line: tighter and crashing harder.
  const dline = [];
  const dlGap = isGL ? 26 : 34;
  for (let i = -1.5; i <= 1.5; i += 1) {
    dline.push({ x: losX + dir * DL_DEPTH_YD * PX, y: cy + i * dlGap, role: "DL" });
  }

  // ── LINEBACKERS (0-3 by package) ──
  // BASE_43: 3 LBs (W/M/S). NICKEL: 2 LBs (W/M, drop SAM). DIME: 1 LB (M).
  // QUARTER: 0 LBs (5-DB look vs empty/00).
  // Long-yardage: LBs widen the splits so the seams aren't open.
  // Default Y offsets ~44px; long-yd ~62px.
  const _lbYSpread = _isLongYd ? 62 : (isGL ? 28 : 44);
  const _lbYNickel = _isLongYd ? 30 : 22;
  const lbs = [];
  if (dpDef.lb === 3) {
    lbs.push({ x: losX + dir * lbDepth * PX, y: cy - _lbYSpread, role: "LB" });
    lbs.push({ x: losX + dir * lbDepth * PX, y: cy,              role: "LB" });
    lbs.push({ x: losX + dir * lbDepth * PX, y: cy + _lbYSpread, role: "LB" });
  } else if (dpDef.lb === 2) {
    lbs.push({ x: losX + dir * lbDepth * PX, y: cy - _lbYNickel, role: "LB" });
    lbs.push({ x: losX + dir * lbDepth * PX, y: cy + _lbYNickel, role: "LB" });
  } else if (dpDef.lb === 1) {
    lbs.push({ x: losX + dir * lbDepth * PX, y: cy, role: "LB" });
  }

  // ── CORNERBACKS / NICKEL DBs (2-5 by package) ──
  // cb1 / cb2 press the outside WRs. cb3 (nickel) covers the slot WR3.
  // cb4 (dime) covers WR4. cb5 covers WR5 in QUARTER.
  // Long-yardage: corners bail to off coverage (9yd) so no quick out
  // takes the marker. Goal-line and standard down keep the press look.
  const cbWide = isGL ? 110 : 240;
  const _cbDepth = isGL ? 3 : (_isLongYd ? 9 : 7);
  const _nbDepth = isGL ? 3 : (_isLongYd ? 8 : 5);
  const cbs = [];
  if (dpDef.cb >= 1) cbs.push({ x: losX + dir * _cbDepth * PX, y: cy - cbWide, role: "CB" });
  if (dpDef.cb >= 2) cbs.push({ x: losX + dir * _cbDepth * PX, y: cy + cbWide, role: "CB" });
  // Nickel back over the slot WR3 (left-slot)
  if (dpDef.cb >= 3) cbs.push({ x: losX + dir * _nbDepth * PX, y: cy - slotWide - 6, role: "NB" });
  // Dime back over WR4 (right-slot) — sits a tick deeper
  if (dpDef.cb >= 4) cbs.push({ x: losX + dir * _nbDepth * PX, y: cy + slotWide - 6, role: "DB" });
  // QUARTER: 5th DB in the middle of the field (covers WR5 / acts as deep MIKE)
  if (dpDef.cb >= 5) cbs.push({ x: losX + dir * 7 * PX, y: cy + slotInner, role: "DB" });

  // 2 Safeties — goal-line: walk them into the box (single-high replaced
  // by two-deep loaded). Long-yardage: drop to deep halves so nothing
  // breaks over the top (~18-20yd vs the standard 14yd).
  const sDepth = isGL ? 4 : (_isLongYd ? Math.min(20, Math.max(16, _ytg + 4)) : 14);
  const s1 = { x: losX + dir * sDepth * PX, y: cy - (isGL ? 30 : 56), role: "S" };
  const s2 = { x: losX + dir * sDepth * PX, y: cy + (isGL ? 30 : 56), role: "S" };

  // Backwards-compat slot keys (wr1/wr2/te/cb1/cb2) for existing callers,
  // plus new wr3/wr4/wr5/te2/cb3/cb4 slots that may be null in BASE personnel.
  const wr1 = wrSlots[0] || null;
  const wr2 = wrSlots[1] || null;
  const wr3 = wrSlots[2] || null;
  const wr4 = wrSlots[3] || null;
  const wr5 = wrSlots[4] || null;
  const te  = teSlots[0] || null;
  const te2 = teSlots[1] || null;
  const cb1 = cbs[0] || null;
  const cb2 = cbs[1] || null;
  const cb3 = cbs[2] || null;
  const cb4 = cbs[3] || null;
  const cb5 = cbs[4] || null;

  // Build the offense / defense lists from whichever slots actually exist
  const offenseSlots = [...oline, ...teSlots, ...wrSlots, qb];
  if (rb) offenseSlots.push(rb);
  if (fb) offenseSlots.push(fb);

  // Animation-safety phantoms — when personnel has no RB/TE on the field
  // (EMPTY / SPREAD), code that reads formation.rb/.te for fallback positions
  // (screen flares, designed QB runs) gets a non-null reference. Phantoms
  // are NOT added to offenseSlots so they don't render as extra sprites.
  const rbSlot = rb || { x: qb.x - dir * 2 * PX, y: qb.y, role: "RB", phantom: true };
  const teSlot = teSlots[0] || (wrSlots[2] ? { ...wrSlots[2], role: "TE", phantom: true } : { x: qb.x, y: qb.y + 60, role: "TE", phantom: true });

  return {
    offense: offenseSlots,
    defense: [...dline, ...lbs, ...cbs, s1, s2],
    qb, rb: rbSlot, fb,
    wr1, wr2, wr3, wr4, wr5,
    te: teSlot, te2,
    dline, lbs,
    cb1, cb2, cb3, cb4, cb5,
    s1, s2,
    oline, // expose for style attachment
    personnel,
    defPackage,
    // Long-yardage flag + computed depths. Exposed so the per-play
    // renderer can shift engine-emitted zone-drop tracks to match
    // the deeper formation pre-snap (engine emits tracks starting at
    // dxYd=5.5 / fixed baselines; without a shift the LB/CB/S would
    // snap back to standard depth on the first post-snap frame).
    isLongYd: _isLongYd,
    lbDepthYd: lbDepth,
    sDepthYd:  sDepth,
    cbDepthYd: _cbDepth,
    // Real (non-phantom) handles for code that needs to know if the slot is
    // actually on the field for this personnel (e.g., target picker).
    realRb: rb,
    realTe: teSlots[0] || null,
  };
}

// Map each formation slot to a real roster player so drawPlayer can use
// their personal running style + signature celebration. Mutates the passed
// formation in place — attaches `runStyle`, `celebStyle`, and `label` (jersey #).
const JERSEYS_BY_POS = {
  QB: ["1","7","9","10","12","17"],  RB: ["20","21","22","23","26","28","32"],
  WR: ["10","11","13","14","17","18","19","80","81","84","87","88"],
  TE: ["44","82","83","85","86","89"],
  OL: ["50","53","60","61","65","66","68","70","72","74","76","77","79"],
  DL: ["52","55","58","69","73","75","90","91","92","93","94","95","97","98","99"],
  LB: ["40","42","43","45","48","51","54","56","57","59"],
  CB: ["21","22","23","24","25","27","29","31"],
  S:  ["20","26","30","32","33","36","37","38","39"],
  K:  ["2","3","4","5","6","8"], P: ["2","3","4","5","6","8"],
};

// Legend numbers by position — iconic NFL/college players whose number a
// rookie might adopt as a tribute. ~12% of players are tagged with a tribute
// at gen time; `p.numberTribute` is surfaced in the tooltip ("in honor of …").
const LEGEND_NUMBERS = {
  QB: [
    ["12","Tom Brady"],["12","Aaron Rodgers"],["12","Roger Staubach"],["12","Terry Bradshaw"],
    ["16","Joe Montana"],["19","Johnny Unitas"],["7","John Elway"],["7","Michael Vick"],["7","Ben Roethlisberger"],
    ["9","Drew Brees"],["8","Troy Aikman"],["8","Steve Young"],["10","Fran Tarkenton"],["10","Eli Manning"],
    ["15","Bart Starr"],["15","Patrick Mahomes"],["17","Doug Williams"],["17","Josh Allen"],
    ["14","Otto Graham"],["14","Dan Fouts"],["11","Phil Simms"],["11","Drew Bledsoe"],
    ["4","Brett Favre"],["5","Donovan McNabb"],["5","Paul Hornung"],["1","Cam Newton"],["2","Matt Ryan"],
  ],
  RB: [
    ["20","Barry Sanders"],["21","LaDainian Tomlinson"],["21","Tiki Barber"],
    ["22","Emmitt Smith"],["23","Devin Hester"],["24","Marshawn Lynch"],
    ["25","LeSean McCoy"],["26","Saquon Barkley"],["26","Le'Veon Bell"],
    ["27","Eddie George"],["28","Adrian Peterson"],["28","Curtis Martin"],
    ["29","Eric Dickerson"],["30","Terrell Davis"],
    ["32","Jim Brown"],["32","Marcus Allen"],["32","O.J. Simpson"],
    ["33","Tony Dorsett"],["34","Walter Payton"],["34","Earl Campbell"],["34","Bo Jackson"],
    ["44","John Riggins"],
  ],
  WR: [
    ["80","Jerry Rice"],["80","Steve Largent"],["81","Terrell Owens"],["81","Tim Brown"],["81","Anquan Boldin"],
    ["82","Raymond Berry"],["83","Andre Reed"],["83","Wes Welker"],
    ["84","Randy Moss"],["84","Antonio Brown"],["85","Chad Johnson"],
    ["87","Sterling Sharpe"],["88","Lynn Swann"],["88","Michael Irvin"],["88","Drew Pearson"],["88","Mike Evans"],
    ["89","Steve Smith"],["11","Larry Fitzgerald"],["13","Odell Beckham Jr."],["13","Keenan Allen"],
    ["17","Davante Adams"],["18","Justin Jefferson"],["10","DeSean Jackson"],["10","Tyreek Hill"],
  ],
  TE: [
    ["80","Kellen Winslow"],["82","Jason Witten"],["82","Ozzie Newsome"],
    ["83","Mark Bavaro"],["85","Antonio Gates"],
    ["87","Rob Gronkowski"],["87","Travis Kelce"],["87","Dave Casper"],
    ["88","Tony Gonzalez"],["88","Jackie Smith"],["44","John Mackey"],
  ],
  OL: [
    ["63","Gene Upshaw"],["64","Jerry Kramer"],["65","Tom Mack"],
    ["68","Larry Allen"],["70","Sam Huff"],["70","Art Donovan"],["71","Walter Jones"],
    ["73","Joe Klecko"],["74","Bob Lilly"],["75","Forrest Gregg"],
    ["76","Lou Groza"],["77","Anthony Munoz"],["77","Red Grange"],
    ["78","Bruce Smith"],["79","Bob Brown"],["60","Chuck Bednarik"],
  ],
  DL: [
    ["72","Joe Greene"],["75","Reggie White"],["78","Bruce Smith"],
    ["90","Julius Peppers"],["90","Jadeveon Clowney"],["91","Tamba Hali"],
    ["92","Michael Strahan"],["93","Kevin Greene"],["93","John Randle"],
    ["94","Charles Haley"],["94","DeMarcus Ware"],["95","Richard Dent"],
    ["97","Cornelius Bennett"],["98","Aaron Donald"],
    ["99","J.J. Watt"],["99","Jerome Brown"],["99","Mark Gastineau"],
  ],
  LB: [
    ["52","Patrick Willis"],["52","Khalil Mack"],["52","Ray Lewis"],
    ["54","Bobby Wagner"],["54","Brian Urlacher"],
    ["55","Junior Seau"],["55","Derrick Brooks"],
    ["56","Lawrence Taylor"],["57","Rickey Jackson"],
    ["58","Derrick Thomas"],["58","Wilber Marshall"],
    ["59","Jack Ham"],["59","London Fletcher"],
    ["50","Mike Singletary"],["51","Sam Mills"],["53","Harry Carson"],
  ],
  CB: [
    ["21","Deion Sanders"],["22","Asante Samuel"],["23","Champ Bailey"],
    ["24","Charles Woodson"],["24","Darrelle Revis"],["25","Tyrann Mathieu"],
    ["26","Rod Woodson"],["28","Marcus Peters"],["32","Jack Tatum"],
  ],
  S: [
    ["20","Ed Reed"],["20","Brian Dawkins"],["21","Sean Taylor"],
    ["24","Eric Berry"],["27","Earl Thomas"],["29","Tyrann Mathieu"],
    ["31","Antrel Rolle"],["32","Eric Weddle"],["33","Sammy Baugh"],
    ["42","Ronnie Lott"],["42","Charles Tillman"],
  ],
  K: [["1","Jan Stenerud"],["2","Adam Vinatieri"],["2","Justin Tucker"],["3","Stephen Gostkowski"],["5","Morten Andersen"],["8","Jason Hanson"],["9","Sebastian Janikowski"]],
  P: [["4","Pat McAfee"],["5","Bryan Anger"],["6","Sam Koch"],["7","Donnie Jones"],["8","Andy Lee"]],
};

// Assign the player a "college number" — what they wore at the college level
// and would prefer to wear in the pros. Most pick from a realistic
// position-based pool; ~12% adopt a legend's number as a tribute.
function assignCollegeNumber(p) {
  const pos = p.position;
  const legends = LEGEND_NUMBERS[pos];
  if (legends && legends.length && Math.random() < 0.12) {
    const t = legends[Math.floor(Math.random() * legends.length)];
    p.collegeNumber = t[0];
    p.numberTribute = t[1];
    return;
  }
  const pool = JERSEYS_BY_POS[pos] || ["00"];
  p.collegeNumber = pool[Math.floor(Math.random() * pool.length)];
}

// Resolve final per-team jersey numbers. NFL rule: no two players on the same
// team share a number. Best players (by overall) claim first — rookies and
// scrubs whose preferred number is taken switch to an alternate from their
// position pool. Sets p.number on every player; p.collegeNumberLost flags
// anyone who had to give up their preferred digit.
function assignTeamJerseyNumbers(roster) {
  const sorted = roster.slice().sort((a, b) => (b.overall || 0) - (a.overall || 0));
  const taken = new Set();
  for (const p of sorted) {
    if (!p.collegeNumber) assignCollegeNumber(p);
    if (p.collegeNumber && !taken.has(p.collegeNumber)) {
      p.number = p.collegeNumber;
      taken.add(p.number);
      continue;
    }
    p.collegeNumberLost = true;
    const pool = (JERSEYS_BY_POS[p.position] || ["00"]).slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let picked = pool.find(n => !taken.has(n));
    if (!picked) {
      for (let i = 1; i <= 99 && !picked; i++) {
        const s = String(i);
        if (!taken.has(s)) picked = s;
      }
    }
    p.number = picked || "00";
    taken.add(p.number);
  }
}

function jerseyForPlayer(p) {
  // Deterministic jersey: prefer the persistent p.number assigned at roster
  // build time; fall back to a name-hash pick for any legacy code path.
  if (!p) return "";
  if (p.number) return p.number;
  const pool = JERSEYS_BY_POS[p.position] || ["00"];
  let hash = 0;
  for (let i = 0; i < p.name.length; i++) hash = (hash * 31 + p.name.charCodeAt(i)) >>> 0;
  return pool[hash % pool.length];
}
function attachPlayerStyles(formation, offStarters, defStarters, lookup) {
  if (!lookup) return;
  const pickup = (name) => name ? lookup.get(name) : null;
  const decorate = (slot, p) => {
    if (!slot) return;
    if (p) {
      slot.runStyle = p.runStyle;
      slot.celebStyle = p.celebStyle;
      slot.bodyType = p.bodyType;
      slot.label = jerseyForPlayer(p);
      slot.archetype = p.archetype;
      slot.position = p.position;
      slot.elite = !!p.nickname;
      slot.nickname = p.nickname;
      // Pass the player's NAME through so the in-game model's skin tone can
      // be seeded from the same hash the portrait uses, keeping them
      // visually consistent.
      slot.name = p.name;
    }
  };
  if (offStarters) {
    decorate(formation.qb,  pickup(offStarters.qb));
    if (formation.rb)  decorate(formation.rb,  pickup(offStarters.rb));
    if (formation.wr1) decorate(formation.wr1, pickup(offStarters.wr1));
    if (formation.wr2) decorate(formation.wr2, pickup(offStarters.wr2));
    if (formation.wr3) decorate(formation.wr3, pickup(offStarters.wr3));
    if (formation.wr4) decorate(formation.wr4, pickup(offStarters.wr4));
    // wr5 (5th WR) would require personnel.wr >= 5, but PERSONNEL caps at
    // wr=4 — the slot is never created, so no decorate is needed.
    if (formation.te)  decorate(formation.te,  pickup(offStarters.te));
    if (formation.te2) decorate(formation.te2, pickup(offStarters.te2));
    if (formation.fb)  decorate(formation.fb,  pickup(offStarters.rb2));
  }
  // OL slots (5) are created in Y order top→bottom = LT/LG/C/RG/RT. Map
  // each to its real roster player (ol1..ol5) so the jersey on a given
  // OL position stays the SAME across plays. Was re-rolled randomly each
  // formation build — the same OL slot read as a different person every
  // snap, pure visual noise. decorate() pulls bodyType from the player;
  // OL-specific runStyle is set after so a real OL's stored "explosive"
  // / "smooth" style doesn't override the lineman jog.
  if (formation.oline) formation.oline.forEach((ol, i) => {
    const p = offStarters ? pickup(offStarters[`ol${i + 1}`]) : null;
    decorate(ol, p);
    ol.runStyle = "plodding";
    if (!ol.bodyType) ol.bodyType = "BIG";
    // Fallback when the starter resolves to a placeholder name (no player
    // in the lookup): pick a stable, per-slot label from the OL pool so
    // the number STILL doesn't drift across plays (was Math.random()).
    if (!ol.label) ol.label = JERSEYS_BY_POS.OL[i % JERSEYS_BY_POS.OL.length];
  });
  if (defStarters) {
    const dl = [defStarters.de1, defStarters.dt1, defStarters.dt2, defStarters.de2];
    const lb = [defStarters.lb1, defStarters.lb2, defStarters.lb3];
    formation.dline.forEach((slot, i) => decorate(slot, pickup(dl[i])));
    formation.lbs.forEach((slot, i) => decorate(slot, pickup(lb[i])));
    if (formation.cb1) decorate(formation.cb1, pickup(defStarters.cb1));
    if (formation.cb2) decorate(formation.cb2, pickup(defStarters.cb2));
    if (formation.cb3) decorate(formation.cb3, pickup(defStarters.cb3));   // nickel back
    if (formation.cb4) decorate(formation.cb4, pickup(defStarters.cb4));   // dime back
    if (formation.cb5) decorate(formation.cb5, pickup(defStarters.cb4));   // 5th DB reuses dime
    decorate(formation.s1,  pickup(defStarters.fs));
    decorate(formation.s2,  pickup(defStarters.ss));
  }
}

// Easing functions
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3) / 2;

// ─── UI / playback ────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const homeSel  = $("homeTeam"), awaySel  = $("awayTeam");
const simBtn   = $("simBtn"),   playBtn  = $("playBtn");
const pauseBtn = $("pauseBtn"), endBtn   = $("endBtn");
const speedSlider = $("speedSlider"), speedLabel = $("speedLabel");
const gameArea = $("gameArea");

let gameResult = null, playHead = 0, playing = false;

// ─── Player hover tooltip ─────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function nameSpan(name) {
  if (!name) return "";
  const safe = escapeHtml(name);
  return `<span class="player-name" data-player="${safe}">${safe}</span>`;
}
function playerTier(ovr) {
  if (ovr >= 85) return "elite";
  if (ovr >= 75) return "good";
  if (ovr >= 60) return "average";
  return "poor";
}
function buildPlayerTooltip(p) {
  const [spd, str, agi, awr, thr, cat, blk, prs, cov, tck, kpw] = p.stats;
  const keys = {
    QB: [["SPD",spd],["AGI",agi],["AWR",awr],["THR",thr]],
    RB: [["SPD",spd],["STR",str],["AGI",agi],["CAT",cat]],
    WR: [["SPD",spd],["AGI",agi],["CAT",cat],["AWR",awr]],
    TE: [["CAT",cat],["BLK",blk],["STR",str],["SPD",spd]],
    OL: [["STR",str],["BLK",blk],["AGI",agi],["AWR",awr]],
    DL: [["STR",str],["PRS",prs],["SPD",spd],["TCK",tck]],
    LB: [["PRS",prs],["COV",cov],["TCK",tck],["SPD",spd]],
    CB: [["SPD",spd],["AGI",agi],["COV",cov],["AWR",awr]],
    S:  [["SPD",spd],["COV",cov],["TCK",tck],["AWR",awr]],
    K:  [["KPW",kpw],["AWR",awr]],
    P:  [["KPW",kpw],["AWR",awr]],
  }[p.position] || [];
  const tier = playerTier(p.overall);
  const teamLabel = p.team === "home"
    ? (gameResult ? gameResult.homeTeam.name : "")
    : (gameResult ? gameResult.awayTeam.name : "");
  const statRows = keys.map(([k, v]) => `
    <div class="tt-stat">
      <span class="tt-key">${k}</span><span class="tt-val">${v}</span>
    </div>`).join("");
  // Archetype block — every position with archetypes shows label + blurb
  // (DL also gets a moves bar)
  const ARCHETYPE_BY_POS = {
    QB: QB_ARCHETYPES, DL: DL_ARCHETYPES, OL: OL_ARCHETYPES, RB: RB_ARCHETYPES,
    WR: WR_ARCHETYPES, TE: TE_ARCHETYPES, LB: LB_ARCHETYPES, CB: CB_ARCHETYPES, S: S_ARCHETYPES,
    K: K_ARCHETYPES, P: P_ARCHETYPES,
  };
  let archHtml = "";
  if (p.archetype) {
    const a = (ARCHETYPE_BY_POS[p.position] || {})[p.archetype];
    if (a) {
      const movesBar = a.moves
        ? `<div class="tt-arch-moves">${a.moves.map(m => `<span class="tt-move">${m}</span>`).join("")}</div>`
        : "";
      const anomalies = (p.anomalies || []).map(x => `<div class="tt-anomaly">~ ${escapeHtml(x)}</div>`).join("");
      archHtml = `<div class="tt-arch">
        <div class="tt-arch-name">${a.label.toUpperCase()}</div>
        <div class="tt-arch-blurb">${a.blurb}</div>
        ${anomalies}
        ${movesBar}
      </div>`;
    }
  }
  const flav = p.flavor && PLAYER_FLAVORS[p.flavor]
    ? `<div class="tt-flavor"><b>${PLAYER_FLAVORS[p.flavor].label}</b> — ${PLAYER_FLAVORS[p.flavor].blurb}</div>`
    : "";
  // Display name — fold the nickname in subtly if the player has one. If the
  // player's display name is the initials version ("T.J. Watt"), show the
  // full legal name underneath. Madonna/Pelé tier players (goesByNicknameOnly)
  // display only their nickname here; the legal name appears below.
  const nameDisplay = p.goesByNicknameOnly && p.nickname
    ? `<span class="tt-nick">${escapeHtml(p.nickname)}</span>`
    : p.nickname
      ? `${escapeHtml(p.name.split(" ")[0])} <span class="tt-nick">"${escapeHtml(p.nickname)}"</span> ${escapeHtml(p.name.split(" ").slice(1).join(" "))}`
      : escapeHtml(p.name);
  // Legal name line — only shown when the display name differs (initials,
  // "goes by middle", or Madonna/Pelé nickname-only style).
  let legalName = null;
  if (p.goesByNicknameOnly && p.name) {
    legalName = p.name;
  } else if (p.firstName && p.lastName) {
    const fullLegal = p.middleName
      ? `${p.firstName} ${p.middleName} ${p.lastName}`
      : `${p.firstName} ${p.lastName}`;
    if (fullLegal !== p.name) legalName = fullLegal;
  }
  const legalHtml = legalName
    ? `<div class="tt-legal">${escapeHtml(legalName)}</div>` : "";
  const collegeHtml = p.collegeNickname
    ? `<div class="tt-college">★ Earned in college</div>` : "";
  const tributeHtml = p.numberTribute && !p.collegeNumberLost
    ? `<div class="tt-tribute">#${p.number} — in honor of ${escapeHtml(p.numberTribute)}</div>`
    : "";
  const jerseyTag = p.number ? `#${p.number} · ` : "";
  // ── PROFILE PAGE EXTENSIONS — mugshot, career stats, trophy case ──
  // Try the AI-generated portrait first (deterministic by name+pos hash); if
  // that file is missing the <img> onerror falls back to the canvas portrait.
  const portraitFile = portraitFileForPlayer(p);
  let fallbackUrl;
  try { fallbackUrl = generateMugshotDataUrl(p); }
  catch (e) { console.warn("[tooltip] mugshot fallback failed for", p.name, e); fallbackUrl = ""; }
  // Encode each path segment so folder names containing spaces/commas
  // ("DE, rushers", "Oline and DTs", "WRs and DBs") become valid URLs.
  const safePath = portraitFile.split("/").map(encodeURIComponent).join("/");
  const mugshotImg = `<img class="tt-mugshot" src="portraits/${safePath}" width="128" height="144" alt="mugshot" onerror="this.onerror=null;this.src='${fallbackUrl}'">`;
  const careerHtml = buildCareerTable(p);
  const trophyHtml = buildTrophyShelf(p);
  return `
    <div class="tt-header">
      ${mugshotImg}
      <div class="tt-header-body">
        <div class="tt-name">${nameDisplay}</div>
        ${legalHtml}
        <div class="tt-sub">${jerseyTag}${p.position} · ${teamLabel.toUpperCase()} · AGE ${p.age}</div>
        ${p.height ? `<div class="tt-hw">${formatHeight(p.height)} · ${p.weight} lbs</div>` : ""}
        <div><span class="tt-ovr tier-${tier}">${p.overall} OVR</span></div>
        <div class="tt-bar"><div class="tt-bar-fill" style="width:${p.overall}%"></div></div>
      </div>
    </div>
    <div class="tt-stats">${statRows}</div>
    ${collegeHtml}
    ${tributeHtml}
    ${flav}
    ${archHtml}
    ${trophyHtml}
    ${careerHtml}
  `;
}

// ─── PROFILE-PAGE HELPERS ──────────────────────────────────────────────────
// Map a player to a portrait filename in /portraits. Deterministic by name+
// position so the same player always gets the same face. We assume the pool
// is `p001.png ... pNNN.png` zero-padded 3 digits; PORTRAIT_POOL_SIZE caps
// the hash so we don't reach for files that don't exist. If the <img> 404s,
// the onerror handler in buildPlayerTooltip falls back to the canvas portrait.
// Portraits live in /portraits/Characters/<GROUP>/pNNN.png. Folders are
// grouped by visual body-type rather than strict NFL position, so:
//   Characters/Qbs              → QB, K, P
//   Characters/RBs              → RB, TE
//   Characters/WRs and DBs      → WR, CB, S
//   Characters/Oline and DTs    → OL, plus interior DL (POWER / PENETRATOR)
//   Characters/DE, rushers      → edge DL (SPEED / TWEENER / TECHNICIAN)
//   Characters/LBs              → LB
// The hash uses the player name only so a player keeps the same face even
// if their game position changes. PORTRAIT_COUNTS holds the actual number of
// portraits available per folder — UPDATE THIS when you add more files,
// otherwise hashes will land on missing pNNN.png and fall back to the
// canvas-drawn portrait.
const PORTRAIT_COUNTS = {
  "Characters/Qbs":           10,
  "Characters/RBs":           10,
  "Characters/WRs and DBs":   30,
  "Characters/Oline and DTs": 10,
  "Characters/DE, rushers":   10,
  "Characters/LBs":           10,
};
function portraitFolderFor(p) {
  const pos = p.position;
  if (pos === "QB" || pos === "K" || pos === "P") return "Characters/Qbs";
  if (pos === "RB" || pos === "TE") return "Characters/RBs";
  if (pos === "WR" || pos === "CB" || pos === "S") return "Characters/WRs and DBs";
  if (pos === "OL") return "Characters/Oline and DTs";
  if (pos === "LB") return "Characters/LBs";
  if (pos === "DL") {
    const a = p.archetype;
    if (a === "POWER" || a === "PENETRATOR") return "Characters/Oline and DTs";
    return "Characters/DE, rushers";
  }
  return "Characters/Qbs";
}
function portraitFileForPlayer(p) {
  let hash = 0;
  const seedStr = p.name || "";
  for (let i = 0; i < seedStr.length; i++) hash = (hash * 31 + seedStr.charCodeAt(i)) >>> 0;
  const folder = portraitFolderFor(p);
  const count = PORTRAIT_COUNTS[folder] || 1;
  const n = (hash % count) + 1;
  return `${folder}/p${String(n).padStart(3, "0")}.png`;
}

// Skin-tone palette used by the on-field player models. Lifted to module
// scope so the portrait sampler can map sampled face pixels back to one of
// these five buckets for matching color.
const SKIN_TONES = [
  { base: "#eccaa3", dark: "#b08966", light: "#fce0bd" }, // light
  { base: "#d6a878", dark: "#9b7448", light: "#ecc69a" }, // tan
  { base: "#b4805a", dark: "#7e553a", light: "#d6a17c" }, // medium
  { base: "#8a5d3a", dark: "#5d3d22", light: "#a87a52" }, // dark
  { base: "#6b4128", dark: "#42271a", light: "#8a5a3a" }, // very dark
];

// Per-portrait skin-tone cache. Keyed by portrait filename ("Characters/
// Qbs/p003.png" etc.). Values are an integer index into SKIN_TONES (0-4)
// that's the closest match to the average face pixel sampled from the
// portrait PNG. Resolves asynchronously — first call kicks off the load
// and returns null; subsequent calls return the cached index. While null
// the player model falls back to its hash-based skin tone.
const _portraitSkinCache = new Map();
const _portraitSkinLoading = new Set();
function getPortraitSkinIndex(filename) {
  if (!filename) return null;
  if (_portraitSkinCache.has(filename)) return _portraitSkinCache.get(filename);
  if (_portraitSkinLoading.has(filename)) return null;
  _portraitSkinLoading.add(filename);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    try {
      const W = img.naturalWidth || img.width;
      const H = img.naturalHeight || img.height;
      if (!W || !H) { _portraitSkinCache.set(filename, null); return; }
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const cx = c.getContext("2d");
      cx.drawImage(img, 0, 0);
      // Sample a grid of pixels in the center face area, skipping pixels
      // that look like hair (very dark) or background/highlight (very light
      // or highly desaturated cool tones). Average the survivors.
      let totR = 0, totG = 0, totB = 0, n = 0;
      const xs = [0.42, 0.50, 0.58];
      const ys = [0.48, 0.55, 0.62];
      let pixels;
      try { pixels = cx.getImageData(0, 0, W, H).data; }
      catch (e) { _portraitSkinCache.set(filename, null); return; }
      for (const fx of xs) for (const fy of ys) {
        const px = (Math.floor(fy * H) * W + Math.floor(fx * W)) * 4;
        const r = pixels[px], g = pixels[px+1], b = pixels[px+2], a = pixels[px+3];
        if (a < 200) continue;
        const lum = (r + g + b) / 3;
        if (lum < 35 || lum > 240) continue;
        // Skin requires R >= G >= B-ish. Filter out blues/greens.
        if (b > r || g > r + 10) continue;
        totR += r; totG += g; totB += b; n++;
      }
      if (n === 0) { _portraitSkinCache.set(filename, null); return; }
      const avgR = totR / n, avgG = totG / n, avgB = totB / n;
      let bestIdx = 0, bestDist = Infinity;
      for (let i = 0; i < SKIN_TONES.length; i++) {
        const sc = SKIN_TONES[i].base;
        const sr = parseInt(sc.slice(1,3),16);
        const sg = parseInt(sc.slice(3,5),16);
        const sb = parseInt(sc.slice(5,7),16);
        const d = (sr-avgR)*(sr-avgR) + (sg-avgG)*(sg-avgG) + (sb-avgB)*(sb-avgB);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      _portraitSkinCache.set(filename, bestIdx);
    } catch (e) {
      _portraitSkinCache.set(filename, null);
    }
  };
  img.onerror = () => _portraitSkinCache.set(filename, null);
  const safe = filename.split("/").map(encodeURIComponent).join("/");
  img.src = `portraits/${safe}`;
  return null;
}

// Helper to shade a hex color by a factor
function _shadeColor(c, f) {
  if (!c || c[0] !== "#" || c.length !== 7) return c;
  const r = Math.min(255, Math.max(0, Math.round(parseInt(c.slice(1,3),16) * f)));
  const g = Math.min(255, Math.max(0, Math.round(parseInt(c.slice(3,5),16) * f)));
  const b = Math.min(255, Math.max(0, Math.round(parseInt(c.slice(5,7),16) * f)));
  return `rgb(${r},${g},${b})`;
}
function generateMugshotDataUrl(p) {
  // Anime/manga-style portrait with a military-uniform high collar (gakuran
  // descended from 19th-century Prussian military dress). Stylized hair,
  // sharp features, stoic expression that varies by archetype.
  const W = 78, H = 88;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const team = p.team === "home" ? (gameResult && gameResult.homeTeam) : (gameResult && gameResult.awayTeam);
  const primary = team?.primary || "#1a1a24";
  const secondary = team?.secondary || "#c8a040";
  // Deterministic per-player traits
  let hash = 0;
  const seedStr = (p.name || "") + (p.position || "");
  for (let i = 0; i < seedStr.length; i++) hash = (hash * 31 + seedStr.charCodeAt(i)) >>> 0;
  // Skin tones
  const SKIN_TONES = [
    { base: "#eccaa3", dark: "#b08966", light: "#fce0bd" },
    { base: "#d6a878", dark: "#9b7448", light: "#ecc69a" },
    { base: "#b4805a", dark: "#7e553a", light: "#d6a17c" },
    { base: "#8a5d3a", dark: "#5d3d22", light: "#a87a52" },
    { base: "#6b4128", dark: "#42271a", light: "#8a5a3a" },
  ];
  const skin = SKIN_TONES[hash % SKIN_TONES.length];
  // Hair colors — black-dominant, with rarer alternates
  const HAIR = [
    { base: "#1a1a1f", shade: "#08080c", hi: "#3a3a44" },
    { base: "#1a1a1f", shade: "#08080c", hi: "#3a3a44" },
    { base: "#1a1a1f", shade: "#08080c", hi: "#3a3a44" },
    { base: "#1a1a1f", shade: "#08080c", hi: "#3a3a44" },
    { base: "#2a1a10", shade: "#160e08", hi: "#4a2e1c" },
    { base: "#3a2510", shade: "#1f1305", hi: "#5a3a18" },
    { base: "#5a3a1c", shade: "#3a2510", hi: "#7c5530" },
    { base: "#a07050", shade: "#705038", hi: "#c08868" },
    { base: "#c8a060", shade: "#806040", hi: "#e0c080" },
    { base: "#a02020", shade: "#601010", hi: "#d04040" },
    { base: "#d0d0d8", shade: "#a0a0a8", hi: "#ffffff" },
  ];
  const hair = HAIR[(hash >>> 7) % HAIR.length];
  // Hair style index — 6 different silhouettes
  const hairStyle = (hash >>> 13) % 6;
  // Eye style — narrow/sharp vs rounded
  const isAggressive = ["POWER","THUMPER","GUNSLINGER","PENETRATOR","SHUTDOWN","SPEED"].includes(p.archetype);
  const isWise = ["GAME_MANAGER","POCKET","POSSESSION","ROUTE_RUNNER","TECHNICIAN","BALLHAWK"].includes(p.archetype);

  // ── BACKDROP ──
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1a1a22");
  bg.addColorStop(0.6, _shadeColor(primary, 0.45));
  bg.addColorStop(1, _shadeColor(primary, 0.30));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // Vignette
  const vig = ctx.createRadialGradient(W/2, H/2, 20, W/2, H/2, 60);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // ── MILITARY UNIFORM (drawn first, head sits on top) ──
  const collarTop = H - 28;
  // Shoulder block — full-width dark slab at the bottom
  ctx.fillStyle = _shadeColor(primary, 0.35);
  ctx.beginPath();
  ctx.moveTo(-2, H);
  ctx.lineTo(-2, collarTop + 2);
  ctx.lineTo(8, collarTop - 6);
  ctx.lineTo(W - 8, collarTop - 6);
  ctx.lineTo(W + 2, collarTop + 2);
  ctx.lineTo(W + 2, H);
  ctx.closePath();
  ctx.fill();
  // Uniform body — slightly lighter than the shoulders so the silhouette reads
  ctx.fillStyle = _shadeColor(primary, 0.50);
  ctx.fillRect(8, collarTop - 4, W - 16, H - collarTop + 4);
  // Top piping stripe (secondary color band along the shoulders)
  ctx.fillStyle = secondary;
  ctx.fillRect(10, collarTop - 4, W - 20, 1.2);
  // Shoulder boards / epaulets — small rectangles at each shoulder
  ctx.fillStyle = secondary;
  ctx.fillRect(W * 0.13, collarTop - 3, W * 0.16, 3);
  ctx.fillRect(W * 0.71, collarTop - 3, W * 0.16, 3);
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(W * 0.13, collarTop - 3, W * 0.16, 3);
  ctx.strokeRect(W * 0.71, collarTop - 3, W * 0.16, 3);
  // Center button strip — dark vertical band down the middle
  const cx = W / 2;
  const stripeY = collarTop + 5;
  ctx.fillStyle = _shadeColor(primary, 0.25);
  ctx.fillRect(cx - 4, stripeY, 8, H - stripeY);
  // Buttons — 2-3 small metal discs down the strip
  ctx.fillStyle = secondary;
  for (let i = 0; i < 3; i++) {
    const by = stripeY + 4 + i * 6;
    if (by > H - 4) break;
    ctx.beginPath();
    ctx.arc(cx, by, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 0.4;
    ctx.stroke();
    // Tiny highlight on button
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(cx - 0.6, by - 0.6, 0.5, 0.5);
    ctx.fillStyle = secondary;
  }
  // Jersey number — small at the very bottom corner (military rank patch feel)
  const num = p.label || p.jersey || "";
  if (num) {
    ctx.font = "900 8px Impact, Arial Black, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillText(num, cx + 0.4, H - 4.5);
    ctx.fillStyle = secondary;
    ctx.fillText(num, cx, H - 5);
  }
  // ── HIGH STAND COLLAR (the gakuran/military hallmark) ──
  const neckW = 18;
  const collarH = 14;
  // Neck (skin) showing inside the collar
  ctx.fillStyle = skin.base;
  ctx.fillRect(cx - 6, collarTop - 12, 12, 14);
  ctx.fillStyle = skin.dark;
  ctx.fillRect(cx - 6, collarTop - 5, 12, 3);   // jaw shadow
  // Stand collar itself — high stiff vertical band
  ctx.fillStyle = _shadeColor(primary, 0.30);
  ctx.beginPath();
  ctx.moveTo(cx - neckW/2, collarTop);
  ctx.lineTo(cx - neckW/2 - 2, collarTop - collarH + 2);
  ctx.lineTo(cx - 3, collarTop - collarH);
  ctx.lineTo(cx + 3, collarTop - collarH);
  ctx.lineTo(cx + neckW/2 + 2, collarTop - collarH + 2);
  ctx.lineTo(cx + neckW/2, collarTop);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // Collar piping (secondary color trim along the top edge)
  ctx.strokeStyle = secondary;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(cx - neckW/2 - 2, collarTop - collarH + 2);
  ctx.lineTo(cx - 3, collarTop - collarH);
  ctx.lineTo(cx + 3, collarTop - collarH);
  ctx.lineTo(cx + neckW/2 + 2, collarTop - collarH + 2);
  ctx.stroke();
  // Collar tabs / pins — small badges on each side of the throat opening
  ctx.fillStyle = secondary;
  ctx.beginPath();
  ctx.moveTo(cx - 3, collarTop - 4);
  ctx.lineTo(cx - 1, collarTop - 1);
  ctx.lineTo(cx - 3, collarTop - 1);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + 3, collarTop - 4);
  ctx.lineTo(cx + 1, collarTop - 1);
  ctx.lineTo(cx + 3, collarTop - 1);
  ctx.closePath();
  ctx.fill();

  // ── HEAD / FACE ──
  // Face shape — slightly elongated oval with sharper chin
  const faceCy = H * 0.40;
  const faceW = 38;
  const faceH = 44;
  // Chin/jaw — pointed
  ctx.fillStyle = skin.base;
  ctx.beginPath();
  ctx.moveTo(cx - faceW/2, faceCy - 4);
  ctx.quadraticCurveTo(cx - faceW/2 - 1, faceCy + faceH/3, cx - 6, faceCy + faceH/2 + 1);
  ctx.lineTo(cx - 3, faceCy + faceH/2 + 4);
  ctx.lineTo(cx + 3, faceCy + faceH/2 + 4);
  ctx.lineTo(cx + 6, faceCy + faceH/2 + 1);
  ctx.quadraticCurveTo(cx + faceW/2 + 1, faceCy + faceH/3, cx + faceW/2, faceCy - 4);
  ctx.quadraticCurveTo(cx + faceW/2 + 1, faceCy - faceH/2, cx, faceCy - faceH/2 - 1);
  ctx.quadraticCurveTo(cx - faceW/2 - 1, faceCy - faceH/2, cx - faceW/2, faceCy - 4);
  ctx.closePath();
  ctx.fill();
  // Anime cheek shadow — soft on the right side
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = skin.dark;
  ctx.beginPath();
  ctx.moveTo(cx + 4, faceCy + 4);
  ctx.quadraticCurveTo(cx + faceW/2 + 1, faceCy + faceH/3, cx + 5, faceCy + faceH/2 + 1);
  ctx.lineTo(cx + 3, faceCy + faceH/2 + 4);
  ctx.lineTo(cx + 1, faceCy + faceH/2 - 2);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  // Jaw shading line — subtle definition
  ctx.strokeStyle = _shadeColor(skin.base, 0.75);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - 6, faceCy + faceH/2 + 1);
  ctx.quadraticCurveTo(cx, faceCy + faceH/2 + 4, cx + 6, faceCy + faceH/2 + 1);
  ctx.stroke();
  // Ear hints — small skin protrusions on the sides
  ctx.fillStyle = skin.dark;
  ctx.beginPath();
  ctx.ellipse(cx - faceW/2 - 1, faceCy + 4, 2, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + faceW/2 + 1, faceCy + 4, 2, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── HAIR BACK LAYER (silhouette behind the face) ──
  ctx.fillStyle = hair.base;
  if (hairStyle === 0 || hairStyle === 1) {
    // Medium — flows down past ears
    ctx.beginPath();
    ctx.moveTo(cx - faceW/2 - 3, faceCy - 4);
    ctx.quadraticCurveTo(cx - faceW/2 - 5, faceCy - faceH/2 - 6, cx, faceCy - faceH/2 - 8);
    ctx.quadraticCurveTo(cx + faceW/2 + 5, faceCy - faceH/2 - 6, cx + faceW/2 + 3, faceCy - 4);
    ctx.quadraticCurveTo(cx + faceW/2 + 4, faceCy + faceH/3, cx + faceW/2, faceCy + faceH/2);
    ctx.lineTo(cx + faceW/2 - 2, faceCy + faceH/2);
    ctx.quadraticCurveTo(cx + faceW/2 + 1, faceCy + faceH/3, cx + faceW/2, faceCy + 2);
    ctx.lineTo(cx + faceW/2, faceCy - 4);
    ctx.quadraticCurveTo(cx + faceW/2 + 1, faceCy - faceH/2, cx, faceCy - faceH/2);
    ctx.quadraticCurveTo(cx - faceW/2 - 1, faceCy - faceH/2, cx - faceW/2, faceCy - 4);
    ctx.lineTo(cx - faceW/2, faceCy + 2);
    ctx.quadraticCurveTo(cx - faceW/2 - 1, faceCy + faceH/3, cx - faceW/2 + 2, faceCy + faceH/2);
    ctx.lineTo(cx - faceW/2, faceCy + faceH/2);
    ctx.quadraticCurveTo(cx - faceW/2 - 4, faceCy + faceH/3, cx - faceW/2 - 3, faceCy - 4);
    ctx.closePath();
    ctx.fill();
  } else {
    // Short — only top of head
    ctx.beginPath();
    ctx.moveTo(cx - faceW/2 - 1, faceCy - 4);
    ctx.quadraticCurveTo(cx - faceW/2 - 3, faceCy - faceH/2 - 4, cx, faceCy - faceH/2 - 6);
    ctx.quadraticCurveTo(cx + faceW/2 + 3, faceCy - faceH/2 - 4, cx + faceW/2 + 1, faceCy - 4);
    ctx.quadraticCurveTo(cx + faceW/2, faceCy - faceH/2 + 2, cx, faceCy - faceH/2 + 1);
    ctx.quadraticCurveTo(cx - faceW/2, faceCy - faceH/2 + 2, cx - faceW/2 - 1, faceCy - 4);
    ctx.closePath();
    ctx.fill();
  }

  // ── EYEBROWS ──
  const browY = faceCy - 6;
  ctx.strokeStyle = hair.shade;
  ctx.lineCap = "round";
  ctx.lineWidth = 2.2;
  if (isAggressive) {
    // V-shape angry brows
    ctx.beginPath();
    ctx.moveTo(cx - 11, browY - 2);
    ctx.lineTo(cx - 3, browY + 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 11, browY - 2);
    ctx.lineTo(cx + 3, browY + 1);
    ctx.stroke();
  } else if (isWise) {
    // Calm slightly raised brows
    ctx.beginPath();
    ctx.moveTo(cx - 11, browY);
    ctx.lineTo(cx - 3, browY - 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 11, browY);
    ctx.lineTo(cx + 3, browY - 2);
    ctx.stroke();
  } else {
    // Standard horizontal brows
    ctx.beginPath();
    ctx.moveTo(cx - 11, browY - 0.5);
    ctx.lineTo(cx - 3, browY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 11, browY - 0.5);
    ctx.lineTo(cx + 3, browY);
    ctx.stroke();
  }

  // ── EYES — anime style, narrow for stoic male leads ──
  const eyeY = faceCy - 1;
  const eyeColors = ["#1a1a1f","#2a1a10","#3a4a1a","#1a3a5a"];
  const eyeColor = eyeColors[(hash >>> 19) % eyeColors.length];
  // Eye whites — long ovals
  ctx.fillStyle = "#fff8f0";
  ctx.beginPath();
  ctx.ellipse(cx - 7, eyeY, 3.5, isAggressive ? 1.6 : 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + 7, eyeY, 3.5, isAggressive ? 1.6 : 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Top eyelid — heavy dark line
  ctx.strokeStyle = hair.shade;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - 10.5, eyeY - 1.6);
  ctx.quadraticCurveTo(cx - 7, eyeY - 2.5, cx - 3.5, eyeY - 1.4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 3.5, eyeY - 1.4);
  ctx.quadraticCurveTo(cx + 7, eyeY - 2.5, cx + 10.5, eyeY - 1.6);
  ctx.stroke();
  // Iris — large dark with the chosen eye color visible at the edge
  ctx.fillStyle = eyeColor;
  ctx.beginPath();
  ctx.ellipse(cx - 7, eyeY, 2.0, 2.0, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + 7, eyeY, 2.0, 2.0, 0, 0, Math.PI * 2);
  ctx.fill();
  // Pupil
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(cx - 7, eyeY, 1.0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + 7, eyeY, 1.0, 0, Math.PI * 2);
  ctx.fill();
  // Highlight (catchlight) — small white pixel
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(cx - 7.8, eyeY - 1.3, 1.0, 1.0);
  ctx.fillRect(cx + 6.2, eyeY - 1.3, 1.0, 1.0);

  // ── NOSE — minimal anime indication ──
  ctx.strokeStyle = _shadeColor(skin.base, 0.72);
  ctx.lineWidth = 0.8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx + 0.5, faceCy + 2);
  ctx.lineTo(cx + 1.5, faceCy + 6);
  ctx.stroke();
  // Subtle nostril shadow
  ctx.fillStyle = _shadeColor(skin.base, 0.65);
  ctx.fillRect(cx - 1.2, faceCy + 6.5, 0.8, 0.6);
  ctx.fillRect(cx + 0.6, faceCy + 6.5, 0.8, 0.6);

  // ── MOUTH ──
  ctx.strokeStyle = "#3a1a14";
  ctx.lineWidth = 1.1;
  ctx.lineCap = "round";
  const mouthY = faceCy + 11;
  ctx.beginPath();
  if (isAggressive) {
    // Firm flat scowl
    ctx.moveTo(cx - 4, mouthY);
    ctx.lineTo(cx + 4, mouthY);
  } else if (isWise) {
    // Subtle smirk
    ctx.moveTo(cx - 4, mouthY + 0.5);
    ctx.quadraticCurveTo(cx, mouthY - 0.5, cx + 4, mouthY + 0.5);
  } else {
    // Neutral slight curve
    ctx.moveTo(cx - 4, mouthY);
    ctx.quadraticCurveTo(cx, mouthY + 1, cx + 4, mouthY);
  }
  ctx.stroke();

  // ── HAIR FRONT LAYER (bangs over forehead) — varies by hairStyle ──
  ctx.fillStyle = hair.base;
  if (hairStyle === 0) {
    // Center-parted bangs (reference image style)
    ctx.beginPath();
    ctx.moveTo(cx - faceW/2 + 2, faceCy - 4);
    ctx.quadraticCurveTo(cx - faceW/2 - 2, faceCy - faceH/2, cx - 4, faceCy - faceH/2 + 4);
    ctx.lineTo(cx - 1, faceCy - 9);
    ctx.lineTo(cx, faceCy - 11);
    ctx.lineTo(cx + 1, faceCy - 9);
    ctx.lineTo(cx + 4, faceCy - faceH/2 + 4);
    ctx.quadraticCurveTo(cx + faceW/2 + 2, faceCy - faceH/2, cx + faceW/2 - 2, faceCy - 4);
    ctx.quadraticCurveTo(cx + faceW/2, faceCy - 10, cx + 3, faceCy - 9);
    ctx.lineTo(cx + 1, faceCy - 11);
    ctx.lineTo(cx - 1, faceCy - 11);
    ctx.lineTo(cx - 3, faceCy - 9);
    ctx.quadraticCurveTo(cx - faceW/2, faceCy - 10, cx - faceW/2 + 2, faceCy - 4);
    ctx.closePath();
    ctx.fill();
  } else if (hairStyle === 1) {
    // Side-swept (covers left, forehead exposed on right)
    ctx.beginPath();
    ctx.moveTo(cx - faceW/2 + 1, faceCy - 4);
    ctx.quadraticCurveTo(cx - faceW/2 - 2, faceCy - faceH/2, cx - 2, faceCy - faceH/2 + 2);
    ctx.quadraticCurveTo(cx + 8, faceCy - 12, cx + 12, faceCy - 4);
    ctx.quadraticCurveTo(cx + faceW/2, faceCy - 6, cx + faceW/2 + 1, faceCy - 8);
    ctx.lineTo(cx + faceW/2 + 1, faceCy - faceH/2);
    ctx.quadraticCurveTo(cx, faceCy - faceH/2 - 3, cx - faceW/2 - 1, faceCy - faceH/2);
    ctx.closePath();
    ctx.fill();
  } else if (hairStyle === 2) {
    // Spiky — sharp upward tufts (aggressive look)
    ctx.beginPath();
    ctx.moveTo(cx - faceW/2 - 1, faceCy - 2);
    ctx.lineTo(cx - 12, faceCy - faceH/2 - 3);
    ctx.lineTo(cx - 7, faceCy - faceH/2 + 1);
    ctx.lineTo(cx - 4, faceCy - faceH/2 - 5);
    ctx.lineTo(cx, faceCy - faceH/2 + 1);
    ctx.lineTo(cx + 4, faceCy - faceH/2 - 5);
    ctx.lineTo(cx + 7, faceCy - faceH/2 + 1);
    ctx.lineTo(cx + 12, faceCy - faceH/2 - 3);
    ctx.lineTo(cx + faceW/2 + 1, faceCy - 2);
    ctx.quadraticCurveTo(cx + faceW/2, faceCy - 6, cx + 8, faceCy - 8);
    ctx.lineTo(cx - 8, faceCy - 8);
    ctx.quadraticCurveTo(cx - faceW/2, faceCy - 6, cx - faceW/2 - 1, faceCy - 2);
    ctx.closePath();
    ctx.fill();
  } else if (hairStyle === 3) {
    // Slick back — minimal forehead coverage
    ctx.beginPath();
    ctx.moveTo(cx - faceW/2 - 1, faceCy - 4);
    ctx.quadraticCurveTo(cx - faceW/2 - 3, faceCy - faceH/2 - 1, cx, faceCy - faceH/2 - 3);
    ctx.quadraticCurveTo(cx + faceW/2 + 3, faceCy - faceH/2 - 1, cx + faceW/2 + 1, faceCy - 4);
    ctx.quadraticCurveTo(cx + faceW/2 - 2, faceCy - faceH/2 + 4, cx, faceCy - faceH/2 + 4);
    ctx.quadraticCurveTo(cx - faceW/2 + 2, faceCy - faceH/2 + 4, cx - faceW/2 - 1, faceCy - 4);
    ctx.closePath();
    ctx.fill();
  } else if (hairStyle === 4) {
    // Long bangs covering most of forehead
    ctx.beginPath();
    ctx.moveTo(cx - faceW/2 - 1, faceCy - 4);
    ctx.quadraticCurveTo(cx - faceW/2 - 3, faceCy - faceH/2 - 2, cx, faceCy - faceH/2 - 4);
    ctx.quadraticCurveTo(cx + faceW/2 + 3, faceCy - faceH/2 - 2, cx + faceW/2 + 1, faceCy - 4);
    ctx.quadraticCurveTo(cx + faceW/2 - 2, faceCy - 4, cx + 6, faceCy - 4);
    ctx.lineTo(cx + 4, faceCy - 2);
    ctx.lineTo(cx - 4, faceCy - 2);
    ctx.lineTo(cx - 6, faceCy - 4);
    ctx.quadraticCurveTo(cx - faceW/2 + 2, faceCy - 4, cx - faceW/2 - 1, faceCy - 4);
    ctx.closePath();
    ctx.fill();
  } else {
    // Buzz cut — barely-there hair
    ctx.beginPath();
    ctx.moveTo(cx - faceW/2 + 2, faceCy - 5);
    ctx.quadraticCurveTo(cx - faceW/2, faceCy - faceH/2 + 1, cx, faceCy - faceH/2 + 2);
    ctx.quadraticCurveTo(cx + faceW/2, faceCy - faceH/2 + 1, cx + faceW/2 - 2, faceCy - 5);
    ctx.lineTo(cx + faceW/2 - 4, faceCy - 5);
    ctx.quadraticCurveTo(cx, faceCy - faceH/2 + 5, cx - faceW/2 + 4, faceCy - 5);
    ctx.closePath();
    ctx.fill();
  }
  // Hair highlight strands
  ctx.strokeStyle = hair.hi;
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    const sx = cx - 14 + i * 9;
    ctx.moveTo(sx, faceCy - faceH/2 + 2);
    ctx.lineTo(sx + 1.5, faceCy - faceH/2 + 7);
    ctx.stroke();
  }

  return canvas.toDataURL();
}
function buildTrophyShelf(p) {
  const trophies = [];
  if (p.sbRings) trophies.push({ icon: "🏆", count: p.sbRings, label: "SB", color: "#f0cc30" });
  if (p.mvps)    trophies.push({ icon: "🏅", count: p.mvps,    label: "MVP", color: "#c890ff" });
  if (p.opoys)   trophies.push({ icon: "⚡", count: p.opoys,   label: "OPOY", color: "#ffb060" });
  if (p.dpoys)   trophies.push({ icon: "💀", count: p.dpoys,   label: "DPOY", color: "#ff7070" });
  if (p.roys)    trophies.push({ icon: "🌱", count: p.roys,    label: "ROY", color: "#9be09b" });
  if (p.allPros) trophies.push({ icon: "★",  count: p.allPros, label: "All-Pro", color: "#f0cc30" });
  if (p.proBowls)trophies.push({ icon: "✦",  count: p.proBowls,label: "Pro Bowls", color: "#9bd0ff" });
  if (!trophies.length && !(p.records && p.records.length)) return "";
  const trophyChips = trophies.map(t => `
    <span class="tt-trophy" style="border-color:${t.color}">
      <span style="color:${t.color}">${t.icon}</span>
      <span class="tt-trophy-count">${t.count}</span>
      <span class="tt-trophy-label">${t.label}</span>
    </span>`).join("");
  const recordsHtml = p.records && p.records.length
    ? `<div class="tt-records-list">${p.records.map(r => `<div class="tt-record">📜 ${r}</div>`).join("")}</div>`
    : "";
  return `<div class="tt-trophies">
    <div class="tt-section-title">Trophy Case</div>
    <div class="tt-trophy-row">${trophyChips || '<span class="tt-empty">No accolades yet</span>'}</div>
    ${recordsHtml}
  </div>`;
}

function buildCareerTable(p) {
  if (!p.career || !p.career.length) return "";
  const pos = p.position;
  // Stat columns per position
  const colsByPos = {
    QB: [["YDS","pass_yds"],["TD","pass_td"],["INT","pass_int"],["CMP%","__cmpPct"]],
    RB: [["ATT","rush_att"],["YDS","rush_yds"],["TD","rush_td"],["REC","rec"]],
    WR: [["REC","rec"],["YDS","rec_yds"],["TD","rec_td"],["TGT","rec_tgt"]],
    TE: [["REC","rec"],["YDS","rec_yds"],["TD","rec_td"],["TGT","rec_tgt"]],
    DL: [["SK","sk"],["TKL","tkl"],["FF","ff"],["PD","pd"]],
    LB: [["TKL","tkl"],["SK","sk"],["INT","int_made"],["FF","ff"]],
    CB: [["INT","int_made"],["PD","pd"],["TKL","tkl"],["",""]],
    S:  [["TKL","tkl"],["INT","int_made"],["PD","pd"],["SK","sk"]],
    OL: [["GS","gs"],["SK ALLOW","sacks_allowed"],["PEN","penalties"],["",""]],
  };
  const cols = colsByPos[pos] || [["GP","gp"],["",""],["",""],["",""]];
  const validCols = cols.filter(c => c[0]);
  const headerCells = validCols.map(c => `<th>${c[0]}</th>`).join("");
  const fmtVal = (s, k) => {
    if (k === "__cmpPct" && s.pass_att) return ((s.pass_comp / s.pass_att) * 100).toFixed(1) + "%";
    if (s[k] == null) return "—";
    return s[k];
  };
  const accBadge = (a) => {
    const colorMap = { MVP: "#c890ff", "All-Pro": "#f0cc30", "Pro Bowl": "#9bd0ff",
                       OPOY: "#ffb060", DPOY: "#ff7070", ROY: "#9be09b", "Super Bowl": "#f0cc30" };
    const c = colorMap[a] || "#888";
    return `<span class="tt-acc-badge" style="color:${c};border-color:${c}" title="${a}">${a === "Super Bowl" ? "🏆" : a === "MVP" ? "🏅" : a.split(" ").map(w => w[0]).join("")}</span>`;
  };
  const rows = p.career.map(s => {
    const cells = validCols.map(([_, k]) => `<td>${fmtVal(s, k)}</td>`).join("");
    const accs = (s.accolades || []).map(accBadge).join("");
    return `<tr><td class="tt-yr">${s.year}</td><td class="tt-age">${s.age}</td>${cells}<td class="tt-honors">${accs}</td></tr>`;
  }).join("");
  // Totals row
  const tot = p.careerTotals || {};
  const totalCells = validCols.map(([_, k]) => {
    let v;
    if (k === "__cmpPct" && tot.pass_att) v = ((tot.pass_comp / tot.pass_att) * 100).toFixed(1) + "%";
    else v = tot[k] != null ? tot[k] : "";
    return `<td><b>${v}</b></td>`;
  }).join("");
  return `<div class="tt-career">
    <div class="tt-section-title">Career Stats</div>
    <table class="tt-career-table">
      <thead><tr><th>YR</th><th>AGE</th>${headerCells}<th>HONORS</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="2"><b>TOTAL</b></td>${totalCells}<td></td></tr></tfoot>
    </table>
  </div>`;
}
let _playerTooltipEl = null;
function ensureTooltipEl() {
  if (_playerTooltipEl) return _playerTooltipEl;
  _playerTooltipEl = document.createElement("div");
  _playerTooltipEl.className = "player-tooltip";
  document.body.appendChild(_playerTooltipEl);
  return _playerTooltipEl;
}
document.addEventListener("mouseover", e => {
  const el = e.target.closest && e.target.closest(".player-name[data-player]");
  if (!el) return;
  const name = el.dataset.player;
  const p = gameResult && gameResult.playerLookup && gameResult.playerLookup.get(name);
  if (!p) return;
  const tt = ensureTooltipEl();
  tt.innerHTML = buildPlayerTooltip(p);
  tt.classList.add("show");
});
document.addEventListener("mousemove", e => {
  if (!_playerTooltipEl || !_playerTooltipEl.classList.contains("show")) return;
  const tt = _playerTooltipEl;
  const pad = 16;
  const rect = tt.getBoundingClientRect();
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + rect.width > window.innerWidth - 8) x = e.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = e.clientY - rect.height - pad;
  tt.style.left = Math.max(8, x) + "px";
  tt.style.top  = Math.max(8, y) + "px";
});
document.addEventListener("mouseout", e => {
  const el = e.target.closest && e.target.closest(".player-name[data-player]");
  if (!el) return;
  if (_playerTooltipEl) _playerTooltipEl.classList.remove("show");
});
let speedMul = 1.0; // 1.0 = normal
let animState = null; // current play animation state
let rafId = null;

function buildOptions(sel, defaultId) {
  sel.innerHTML = "";
  for (const conf of ["AFC", "NFC"]) {
    const og = document.createElement("optgroup");
    og.label = conf;
    for (const t of TEAMS.filter(x => x.conference === conf)) {
      const o = document.createElement("option");
      o.value = t.id;
      const pb = getPlaybook(t);
      const pbTag = pb.id !== "BALANCED" ? ` · ${pb.badge}` : "";
      o.textContent = `${teamAscii(t)} ${t.city} ${t.name} (${t.division})${pbTag}`;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  sel.value = defaultId;
}
buildOptions(homeSel, 1);
buildOptions(awaySel, 14);

// ─── Depth chart preview ─────────────────────────────────────────────────
// Each slot: {pos, idx, label, group}. Label is the visual position name.
const DEPTH_SLOTS = [
  { pos: "QB", idx: 0, label: "QB",  group: "OFFENSE" },
  { pos: "RB", idx: 0, label: "RB",  group: "OFFENSE" },
  { pos: "WR", idx: 0, label: "WR1", group: "OFFENSE" },
  { pos: "WR", idx: 1, label: "WR2", group: "OFFENSE" },
  { pos: "TE", idx: 0, label: "TE",  group: "OFFENSE" },
  { pos: "OL", idx: 0, label: "LT",  group: "O-LINE" },
  { pos: "OL", idx: 1, label: "LG",  group: "O-LINE" },
  { pos: "OL", idx: 2, label: "C",   group: "O-LINE" },
  { pos: "OL", idx: 3, label: "RG",  group: "O-LINE" },
  { pos: "OL", idx: 4, label: "RT",  group: "O-LINE" },
  { pos: "DL", idx: 0, label: "LDE", group: "DEFENSE" },
  { pos: "DL", idx: 1, label: "LDT", group: "DEFENSE" },
  { pos: "DL", idx: 2, label: "RDT", group: "DEFENSE" },
  { pos: "DL", idx: 3, label: "RDE", group: "DEFENSE" },
  { pos: "LB", idx: 0, label: "WLB", group: "DEFENSE" },
  { pos: "LB", idx: 1, label: "MLB", group: "DEFENSE" },
  { pos: "LB", idx: 2, label: "SLB", group: "DEFENSE" },
  { pos: "CB", idx: 0, label: "CB1", group: "DEFENSE" },
  { pos: "CB", idx: 1, label: "CB2", group: "DEFENSE" },
  { pos: "S",  idx: 0, label: "FS",  group: "DEFENSE" },
  { pos: "S",  idx: 1, label: "SS",  group: "DEFENSE" },
  { pos: "K",  idx: 0, label: "K",   group: "SPECIAL" },
  { pos: "P",  idx: 0, label: "P",   group: "SPECIAL" },
];
// Absolute index of (pos, idx) within a roster array.
function rosterSlotAbs(pos, idx) {
  let abs = 0;
  for (const [p, count] of Object.entries(ROSTER_SLOTS)) {
    if (p === pos) return idx < count ? abs + idx : -1;
    abs += count;
  }
  return -1;
}
function defaultTierFor(pos, idx, playbook) {
  if (idx === 0) return playbook.tierBias[pos] || "good";
  if (idx === 1) return "average";
  return "poor";
}
function tierClassFor(ovr) {
  if (ovr >= 85) return "elite";
  if (ovr >= 75) return "good";
  if (ovr >= 60) return "average";
  return "poor";
}
// Side state — keyed roster + per-slot overrides
const preview = {
  home: { id: null, roster: null, overrides: {} },
  away: { id: null, roster: null, overrides: {} },
};
function regenerateFullRoster(team, overrides, blockNames = null) {
  const pb = getPlaybook(team);
  const r = genRoster(pb, {}, blockNames);
  for (const [key, tier] of Object.entries(overrides)) {
    const [pos, idxStr] = key.split(":");
    const abs = rosterSlotAbs(pos, +idxStr);
    if (abs >= 0) {
      // Block all CURRENT names in this roster (except the slot being replaced) + cross-team
      const block = new Set([
        ...r.filter((_, i) => i !== abs).map(p => p.name),
        ...(blockNames || []),
      ]);
      r[abs] = genUniquePlayer(pos, tier, block);
    }
  }
  return r;
}
// Collect the OTHER side's player names so the team we're regenerating
// doesn't accidentally produce duplicates that break the hover lookup.
function otherSideNames(side) {
  const other = side === "home" ? "away" : "home";
  const otherRoster = preview[other].roster;
  return new Set((otherRoster || []).map(p => p.name));
}
function setupPreview(side, force = false) {
  const state = preview[side];
  const sel = side === "home" ? homeSel : awaySel;
  const newId = +sel.value;
  if (state.id !== newId || force) {
    state.id = newId;
    state.overrides = {};
    state.roster = regenerateFullRoster(getTeam(newId), {}, otherSideNames(side));
  }
  renderDepthChart(side);
}
function toggleSlotBoost(side, pos, idx, checked) {
  const state = preview[side];
  if (!state.roster) return;
  const key = `${pos}:${idx}`;
  if (checked) state.overrides[key] = "elite";
  else delete state.overrides[key];
  const team = getTeam(state.id);
  const pb = getPlaybook(team);
  const tier = state.overrides[key] || defaultTierFor(pos, idx, pb);
  const abs = rosterSlotAbs(pos, idx);
  if (abs >= 0) {
    // Avoid name collisions with the rest of the roster + the other team
    const block = new Set([
      ...state.roster.filter((_, i) => i !== abs).map(p => p.name),
      ...otherSideNames(side),
    ]);
    state.roster[abs] = genUniquePlayer(pos, tier, block);
  }
  renderDepthChart(side);
}
function renderDepthChart(side) {
  const state = preview[side];
  const el = $(`${side}Depth`);
  if (!el || !state.roster) return;
  const team = getTeam(state.id);
  const pb = getPlaybook(team);
  // Group slots by display group
  const groups = {};
  for (const slot of DEPTH_SLOTS) {
    (groups[slot.group] = groups[slot.group] || []).push(slot);
  }
  let html = "";
  for (const groupName of Object.keys(groups)) {
    html += `<div class="depth-section">
      <div class="depth-section-title">${groupName}${groupName === "OFFENSE" ? ` <span class="pb-tag">${pb.name}</span>` : ""}</div>`;
    for (const slot of groups[groupName]) {
      const abs = rosterSlotAbs(slot.pos, slot.idx);
      if (abs < 0) continue;
      const p = state.roster[abs];
      if (!p) continue;
      // Update the lookup map so the hover tooltip sees the latest player
      const key = `${slot.pos}:${slot.idx}`;
      const isBoosted = !!state.overrides[key];
      const tier = tierClassFor(p.overall);
      // Archetype mini-tag — all positions with archetypes
      const ARCH_BY_POS = {
        DL: DL_ARCHETYPES, OL: OL_ARCHETYPES, RB: RB_ARCHETYPES, WR: WR_ARCHETYPES,
        TE: TE_ARCHETYPES, LB: LB_ARCHETYPES, CB: CB_ARCHETYPES, S: S_ARCHETYPES,
        K: K_ARCHETYPES, P: P_ARCHETYPES,
      };
      const archTag = p.archetype
        ? `<span class="depth-arch arch-${p.position.toLowerCase()}">${(ARCH_BY_POS[p.position] || {})[p.archetype]?.label || p.archetype}</span>`
        : "";
      html += `<div class="depth-row${isBoosted ? " boosted" : ""}">
        <span class="depth-slot">${slot.label}</span>
        <span class="depth-name">${nameSpan(p.name)}${archTag}</span>
        <span class="depth-ovr tier-${tier}">${p.overall}</span>
        <input type="checkbox" class="depth-boost" data-side="${side}" data-pos="${slot.pos}" data-idx="${slot.idx}"${isBoosted ? " checked" : ""} title="Force elite tier" />
      </div>`;
    }
    html += `</div>`;
  }
  el.innerHTML = html;
  // Keep a local lookup so hover tooltips work pre-game
  if (!window._pregameLookup) window._pregameLookup = new Map();
  for (const p of state.roster) window._pregameLookup.set(p.name, { ...p, team: side });
}
// Boost checkbox event delegation
document.addEventListener("change", e => {
  const cb = e.target.closest && e.target.closest(".depth-boost");
  if (!cb) return;
  toggleSlotBoost(cb.dataset.side, cb.dataset.pos, +cb.dataset.idx, cb.checked);
});
// Re-render previews when team selection changes
homeSel.addEventListener("change", () => setupPreview("home"));
awaySel.addEventListener("change", () => setupPreview("away"));

// Pre-game hover lookup: when no game is active, use _pregameLookup
const _origLookupGet = (name) => {
  if (gameResult && gameResult.playerLookup) {
    const p = gameResult.playerLookup.get(name);
    if (p) return p;
  }
  return window._pregameLookup && window._pregameLookup.get(name);
};
// Patch the hover handler to use our combined lookup
document.addEventListener("mouseover", e => {
  const el = e.target.closest && e.target.closest(".player-name[data-player]");
  if (!el) return;
  const name = el.dataset.player;
  const p = _origLookupGet(name);
  if (!p) {
    console.warn("[tooltip] No player found for name:", JSON.stringify(name));
    return;
  }
  const tt = ensureTooltipEl();
  try {
    tt.innerHTML = buildPlayerTooltip(p);
    tt.classList.add("show");
  } catch (err) {
    console.error("[tooltip] buildPlayerTooltip threw for player:", p, err);
  }
}, true);

// Initial depth charts
setupPreview("home", true);
setupPreview("away", true);

speedSlider.addEventListener("input", e => {
  const v = +e.target.value; // 1-10
  // 1 → 0.25× (very slow), 5 → 1×, 10 → 3× (fast)
  speedMul = v <= 5 ? (0.25 + (v - 1) * 0.1875) : (1 + (v - 5) * 0.4);
  speedLabel.textContent = `${speedMul.toFixed(2)}×`;
});

// Lazy-cached "rest of the league" — the other 30 team rosters. Generated
// once per session and reused so career nicknames stay stable across games.
let _otherLeagueRosters = null;
function ensureLeague(homeId, awayId, homeRoster, awayRoster) {
  if (!_otherLeagueRosters) {
    _otherLeagueRosters = {};
    for (const t of TEAMS) {
      if (t.id === homeId || t.id === awayId) continue;
      _otherLeagueRosters[t.id] = regenerateFullRoster(t, {});
    }
  }
  // Build a combined rosters dict including the user's current home/away
  const rosters = { ..._otherLeagueRosters, [homeId]: homeRoster, [awayId]: awayRoster };
  assignLeagueNicknames(rosters);
}

simBtn.addEventListener("click", () => {
  const homeId = +homeSel.value, awayId = +awaySel.value;
  if (homeId === awayId) { alert("Pick two different teams!"); return; }
  const home = getTeam(homeId), away = getTeam(awayId);
  // Use the previewed rosters (with any per-slot elite overrides applied)
  const homeRoster = (preview.home.id === homeId && preview.home.roster)
    ? preview.home.roster
    : regenerateFullRoster(home, {});
  const homeBlock = new Set(homeRoster.map(p => p.name));
  const awayRoster = (preview.away.id === awayId && preview.away.roster)
    ? preview.away.roster
    : regenerateFullRoster(away, {}, homeBlock);
  // Sanity check: if any duplicates slipped through, rename them
  const allNames = new Set();
  for (const roster of [homeRoster, awayRoster]) {
    for (const p of roster) {
      if (allNames.has(p.name)) {
        for (const s of ["II","III","IV","V","VI"]) {
          const candidate = `${p.name} ${s}`;
          if (!allNames.has(candidate)) { p.name = candidate; break; }
        }
      }
      allNames.add(p.name);
    }
  }
  // Grant career nicknames to the league's top 10 per position. Done before
  // the game so the names show up in tooltips, play logs, and the field.
  ensureLeague(homeId, awayId, homeRoster, awayRoster);
  const sim = new GameSimulator(home, away, homeRoster, awayRoster);
  gameResult = sim.simulate();
  playHead = 0;
  $("playbackControls").style.display = "flex";
  renderGameLayout();
  startNextPlay();
  playing = true;
  updateButtons();
});

