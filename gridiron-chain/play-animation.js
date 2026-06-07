// Cinematic big-hit / ejection overlay. AAA-style — letterbox bars,
const _bigHitCinema = (() => {
  let activeId = null;
  function _mechLabel(m) {
    return m === "head_on" ? "HEAD-ON COLLISION"
         : m === "high"    ? "HIGH HIT"
         : m === "low"     ? "LOW HIT"
         : m === "side"    ? "SIDE HIT"
         : m === "behind"  ? "BLINDSIDE"
         : (m || "CONTACT").toUpperCase();
  }
  function _toneFor(force, isEject) {
    if (isEject) return { accent: "#ff3a3a", glow: "rgba(255,40,40,.55)", label: "EJECTION" };
    if (force >= 1.85) return { accent: "#ff2a2a", glow: "rgba(255,40,40,.50)", label: "💥 MASSIVE HIT" };
    if (force >= 1.65) return { accent: "#ff5a2a", glow: "rgba(255,100,40,.45)", label: "💥 HEAVY HIT" };
    return { accent: "#ffa83a", glow: "rgba(255,180,60,.35)", label: "💥 BIG HIT" };
  }
  function _bodyRegion(mech, eventType) {
    if (eventType === "sack") return "back";
    if (mech === "high" || mech === "head_on") return "head";
    if (mech === "low") return "knee";
    if (mech === "side") return "shoulder";
    if (mech === "behind") return "back";
    return "torso";
  }
  function _bodySVG(region, accent) {
    const REGIONS = {
      head:     { cx: 60, cy: 22,  r: 14 },
      torso:    { cx: 60, cy: 60,  r: 18 },
      shoulder: { cx: 78, cy: 44,  r: 8  },
      knee:     { cx: 54, cy: 108, r: 7  },
      back:     { cx: 60, cy: 60,  r: 18 },
    };
    const r = REGIONS[region] || REGIONS.torso;
    return `<svg viewBox="0 0 120 140" width="100" height="120" style="display:block">
      <ellipse cx="60" cy="22" rx="14" ry="16" fill="#222" stroke="#555" stroke-width="1.5"/>
      <path d="M44,40 L76,40 L82,72 L74,108 L78,135 L70,135 L62,108 L58,108 L50,135 L42,135 L46,108 L38,72 Z"
            fill="#222" stroke="#555" stroke-width="1.5"/>
      <path d="M44,40 L26,80" stroke="#555" stroke-width="6" fill="none" stroke-linecap="round"/>
      <path d="M76,40 L94,80" stroke="#555" stroke-width="6" fill="none" stroke-linecap="round"/>
      <circle cx="${r.cx}" cy="${r.cy}" r="${r.r + 4}" fill="${accent}" opacity="0.25"/>
      <circle cx="${r.cx}" cy="${r.cy}" r="${r.r}" fill="${accent}" opacity="0.45">
        <animate attributeName="opacity" values="0.3;0.85;0.3" dur="0.9s" repeatCount="indefinite"/>
      </circle>
      <circle cx="${r.cx}" cy="${r.cy}" r="${Math.max(2, r.r - 4)}" fill="none" stroke="${accent}" stroke-width="2"/>
    </svg>`;
  }
  function _attackerArch(play) {
    if (typeof franchise === "undefined" || !play.tackler) return "";
    for (const tid in (franchise.rosters || {})) {
      const p = franchise.rosters[tid].find(x => x.name === play.tackler);
      if (p) return p.archetype || "";
    }
    return "";
  }
  return {
    show(play, isEject) {
      const playId = `${play.kind}-${play.tackler || ""}-${play.carrier || play.victim || ""}-${play.force || 0}`;
      const fieldWrap = document.querySelector(".bspnlive-field-wrap")
                     || document.querySelector(".field-wrap")
                     || document.getElementById("field")?.parentElement;
      if (!fieldWrap) return;
      if (activeId !== playId) {
        this.clear();
        activeId = playId;
        const tone = _toneFor(play.force, isEject);
        const mech = _mechLabel(play.mechanism);
        const force = Number(play.force);
        const arch = _attackerArch(play);
        const region = _bodyRegion(play.mechanism, play.eventType);
        const attacker = play.tackler || play.offender || "Defender";
        const victim = play.carrier || play.victim || "Player";
        const el = document.createElement("div");
        el.className = "bighit-cinema";
        el.id = "bighit-cinema-overlay";
        el.style.setProperty("--accent", tone.accent);
        el.style.setProperty("--glow", tone.glow);
        el.innerHTML = `
          <div class="bighit-letter top"></div>
          <div class="bighit-letter bottom"></div>
          <div class="bighit-content">
            <div class="bighit-body-col">
              ${_bodySVG(region, tone.accent)}
              <div class="bighit-region-lbl">${region.toUpperCase()}</div>
            </div>
            <div class="bighit-text-col">
              <div class="bighit-eyebrow">${tone.label}</div>
              ${isEject ? "" : `<div class="bighit-force">${(force || 0).toFixed(2)}</div><div class="bighit-force-lbl">FORCE</div>`}
              <div class="bighit-mech">${mech}</div>
              <div class="bighit-players">
                <span class="bighit-attacker">${attacker}${arch ? ` <span class="bighit-arch">${arch.replace(/_/g," ")}</span>` : ""}</span>
                <span class="bighit-arrow">→</span>
                <span class="bighit-victim">${victim}</span>
              </div>
              ${isEject ? `<div class="bighit-ejection">🚫 DISQUALIFIED — REST OF GAME</div>` : ""}
            </div>
          </div>`;
        const cs = getComputedStyle(fieldWrap);
        if (cs.position === "static") fieldWrap.style.position = "relative";
        fieldWrap.appendChild(el);
      }
    },
    clear() {
      const el = document.getElementById("bighit-cinema-overlay");
      if (el) el.remove();
      activeId = null;
    },
  };
})();

// Substitution ticker — a stack of chips in the upper-right of the
// field-wrap. Each chip slides in, sits 4s, slides out. Adds idempotency
// so re-renders during the same animation don't duplicate.
const _subTicker = (() => {
  const seen = new Set();
  function _wrap() {
    return document.querySelector(".bspnlive-field-wrap")
        || document.querySelector(".field-wrap")
        || document.getElementById("field")?.parentElement;
  }
  function _container() {
    const wrap = _wrap();
    if (!wrap) return null;
    let c = wrap.querySelector(".sub-ticker");
    if (!c) {
      c = document.createElement("div");
      c.className = "sub-ticker";
      const cs = getComputedStyle(wrap);
      if (cs.position === "static") wrap.style.position = "relative";
      wrap.appendChild(c);
    }
    return c;
  }
  return {
    add(play) {
      const key = `${play.side || ""}:${play.out || ""}:${play.in || ""}:${play.reason || ""}:${play.time || play.quarter || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (seen.size > 200) {
        // Trim — keep it small
        const arr = [...seen]; for (let i = 0; i < 100; i++) seen.delete(arr[i]);
      }
      const c = _container();
      if (!c) return;
      const teamColor = play.side === "home"
        ? (gameResult?.homeTeam?.primary || "#888")
        : (gameResult?.awayTeam?.primary || "#888");
      const reasonStyle = {
        injury:   { color: "#ff5050", icon: "🩹", label: "INJURY"   },
        fatigue:  { color: "#e8a000", icon: "💨", label: "FATIGUE"  },
        snap_plan:{ color: "#7ec8e3", icon: "📋", label: "SNAP PLAN"},
      }[play.reason] || { color: "#aaa", icon: "↺", label: "SUB" };
      const chip = document.createElement("div");
      chip.className = "sub-ticker-chip";
      chip.style.setProperty("--accent", reasonStyle.color);
      chip.style.setProperty("--team", teamColor);
      const sevTag = play.catastrophic ? `<span class="sub-chip-cata">SEASON-END</span>` : "";
      chip.innerHTML = `
        <div class="sub-chip-eyebrow"><span style="background:var(--team)"></span>${reasonStyle.icon} ${reasonStyle.label}${sevTag}</div>
        <div class="sub-chip-body">
          <div class="sub-chip-out">
            <span class="sub-chip-role">${(play.position || "").toUpperCase()}</span>
            <span class="sub-chip-name out">${play.out || "—"}</span>
            ${play.injuryLabel ? `<span class="sub-chip-injury">${play.injuryLabel}</span>` : ""}
          </div>
          <div class="sub-chip-arrow">↓</div>
          <div class="sub-chip-in">
            <span class="sub-chip-role-in">IN</span>
            <span class="sub-chip-name in">${play.in || "—"}</span>
          </div>
        </div>`;
      c.appendChild(chip);
      // Trim oldest if too many stacked
      while (c.children.length > 3) c.removeChild(c.firstChild);
      // Auto-remove after 4s (CSS handles the slide-out animation)
      setTimeout(() => {
        chip.classList.add("leaving");
        setTimeout(() => chip.remove(), 420);
      }, 4000);
    },
    clearAll() {
      const c = _wrap()?.querySelector(".sub-ticker");
      if (c) c.innerHTML = "";
      seen.clear();
    },
  };
})();

// Touchdown cinematic — full-field team-color flood + giant TOUCHDOWN
// text + scorer chip. Fires when the play hold begins on a TD.
// Auto-clears at next play start. The existing canvas-drawn TOUCHDOWN
// text remains as a sub-element; this overlay layers above it.
const _touchdownCinema = (() => {
  let activeId = null;
  function _wrap() {
    return document.querySelector(".bspnlive-field-wrap")
        || document.querySelector(".field-wrap")
        || document.getElementById("field")?.parentElement;
  }
  return {
    show(play) {
      const id = `${play.kind}-${play.endYard}-${play.receiver || play.rusher}-${play.startYard}`;
      if (activeId === id) return;
      this.clear();
      activeId = id;
      const wrap = _wrap();
      if (!wrap) return;
      const cs = getComputedStyle(wrap);
      if (cs.position === "static") wrap.style.position = "relative";
      // Determine scoring team — poss is on the play, gameResult has teams.
      const poss = play.poss;
      const team = (poss === "home" ? gameResult?.homeTeam : gameResult?.awayTeam)
                || (poss === "away" ? gameResult?.awayTeam : gameResult?.homeTeam);
      const teamColor = team?.primary || "#f5c542";
      const teamSec   = team?.secondary || "#fff";
      const scorer = play.receiver || play.rusher || play.passer || "—";
      const passer = play.kind === "complete" ? play.passer : null;
      const yds = play.yards ?? 0;
      const playLabel = play.kind === "complete"
        ? `${yds}-YD CATCH${passer ? ` · ${passer} → ${scorer}` : ""}`
        : play.isScramble
        ? `${yds}-YD SCRAMBLE · ${scorer}`
        : `${yds}-YD RUSH · ${scorer}`;
      const el = document.createElement("div");
      el.className = "td-cinema";
      el.id = "td-cinema-overlay";
      el.style.setProperty("--team", teamColor);
      el.style.setProperty("--team-sec", teamSec);
      el.innerHTML = `
        <div class="td-flood"></div>
        <div class="td-bars">
          <div class="td-bar top"></div>
          <div class="td-bar bot"></div>
        </div>
        <div class="td-content">
          <div class="td-eyebrow">${team?.city || ""} ${team?.name || ""}</div>
          <div class="td-headline">TOUCHDOWN</div>
          <div class="td-scorer">${scorer}</div>
          <div class="td-detail">${playLabel}</div>
          <div class="td-sparks">
            ${Array.from({length: 12}).map((_,i) =>
              `<span class="td-spark" style="--n:${i}"></span>`).join("")}
          </div>
        </div>`;
      wrap.appendChild(el);
    },
    clear() {
      const el = document.getElementById("td-cinema-overlay");
      if (el) el.remove();
      activeId = null;
    },
  };
})();

// HC decision overlay — fires on engine-emitted hc_decision plays
// (4th-down go-for-it, 2-pt try). Coach name + trait badge + decision
// + rationale, slide-in from bottom of the field. ~1.6s beat.
const _hcDecisionCinema = (() => {
  let activeId = null;
  function _wrap() {
    return document.querySelector(".bspnlive-field-wrap")
        || document.querySelector(".field-wrap")
        || document.getElementById("field")?.parentElement;
  }
  function _traitColor(trait) {
    return trait === "Riverboat Gambler" ? "#ff8c4d"
         : trait === "Conservative"      ? "#7ec8e3"
         : trait === "Game Manager"      ? "#9bd0ff"
         : trait === "Motivator"         ? "#e8a000"
         : "#f5c542";
  }
  function _traitIcon(trait) {
    return trait === "Riverboat Gambler" ? "🎲"
         : trait === "Conservative"      ? "🛡"
         : trait === "Game Manager"      ? "📋"
         : trait === "Motivator"         ? "🔥"
         : "🎩";
  }
  return {
    show(play) {
      const id = `${play.coachName}-${play.decision}-${play.ytg}-${play.fieldPos}`;
      if (activeId === id) return;
      this.clear();
      activeId = id;
      const wrap = _wrap();
      if (!wrap) return;
      const cs = getComputedStyle(wrap);
      if (cs.position === "static") wrap.style.position = "relative";
      const accent = _traitColor(play.trait);
      const icon = _traitIcon(play.trait);
      const headline = play.decision === "go_4th" ? "GOING FOR IT" : (play.decision || "DECISION").toUpperCase();
      const el = document.createElement("div");
      el.className = "hc-cinema";
      el.id = "hc-cinema-overlay";
      el.style.setProperty("--accent", accent);
      el.innerHTML = `
        <div class="hc-card">
          <div class="hc-icon">${icon}</div>
          <div class="hc-body">
            <div class="hc-eyebrow">HEAD COACH${play.trait ? ` · ${play.trait.toUpperCase()}` : ""}</div>
            <div class="hc-name">${play.coachName || "—"}</div>
            <div class="hc-decision">${headline}</div>
            <div class="hc-detail">
              <span class="hc-meta">4TH &amp; ${play.ytg ?? "?"}</span>
              ${play.inFGRange ? `<span class="hc-meta hc-fg">FG range — passing on the kick</span>` : ""}
            </div>
            ${play.rationale ? `<div class="hc-rationale">"${play.rationale}"</div>` : ""}
          </div>
        </div>`;
      wrap.appendChild(el);
    },
    clear() {
      const el = document.getElementById("hc-cinema-overlay");
      if (el) el.remove();
      activeId = null;
    },
  };
})();

// Segment cinema — full-screen card for end-of-quarter / halftime /
// overtime / two-minute warning. Replaces the old plain-text canvas
// overlay. Score-by-quarter table on halftime + EOQ. ~2s beat,
// auto-fades. (Timeouts kept on the simple canvas treatment — less
// disruptive, more frequent.)
const _segmentCinema = (() => {
  let activeId = null;
  function _wrap() {
    return document.querySelector(".bspnlive-field-wrap")
        || document.querySelector(".field-wrap")
        || document.getElementById("field")?.parentElement;
  }
  function _meta(play) {
    if (play.kind === "halftime")        return { headline: "HALFTIME", sub: "End of 2nd Quarter", accent: "#f5c542" };
    if (play.kind === "ot")              return { headline: "OVERTIME", sub: "Tied — sudden death", accent: "#ff5a4a" };
    if (play.kind === "two_min_warning") return { headline: "2-MINUTE WARNING", sub: "", accent: "#e8a000" };
    if (play.kind === "quarter") {
      // play.desc has the "End of Q1" type info. Try to parse.
      const m = /Q(\d)/i.exec(play.desc || "");
      const q = m ? Number(m[1]) : null;
      return {
        headline: q ? `END OF Q${q}` : "QUARTER",
        sub: q === 1 ? "1st quarter complete"
            : q === 2 ? "Half time approaching"
            : q === 3 ? "Final quarter begins"
            : "Quarter complete",
        accent: "#9bd0ff",
      };
    }
    return null;
  }
  function _quarterScoresHTML(play) {
    // Walk back through plays to compute Q1..Q4 running scores.
    if (!gameResult?.plays) return "";
    const qScores = { 1:{h:0,a:0}, 2:{h:0,a:0}, 3:{h:0,a:0}, 4:{h:0,a:0} };
    const playIdx = gameResult.plays.indexOf(play);
    const upto = playIdx >= 0 ? playIdx + 1 : gameResult.plays.length;
    for (let i = 0; i < upto; i++) {
      const p = gameResult.plays[i];
      if (p?.kind === "score" && p.pts && p.poss) {
        const q = Math.min(4, Math.max(1, p.quarter || 1));
        const side = p.poss === "home" ? "h" : "a";
        qScores[q][side] += p.pts;
      }
    }
    const homeT = gameResult?.homeTeam, awayT = gameResult?.awayTeam;
    const homeTotal = qScores[1].h + qScores[2].h + qScores[3].h + qScores[4].h;
    const awayTotal = qScores[1].a + qScores[2].a + qScores[3].a + qScores[4].a;
    return `<table class="seg-qtable">
      <thead><tr>
        <th></th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th class="seg-qtotal">T</th>
      </tr></thead>
      <tbody>
        <tr style="--team:${awayT?.primary || "#fff"}">
          <td class="seg-qabbr">${awayT?.abbr || "A"}</td>
          <td>${qScores[1].a}</td><td>${qScores[2].a}</td><td>${qScores[3].a}</td><td>${qScores[4].a}</td>
          <td class="seg-qtotal">${awayTotal}</td>
        </tr>
        <tr style="--team:${homeT?.primary || "#fff"}">
          <td class="seg-qabbr">${homeT?.abbr || "H"}</td>
          <td>${qScores[1].h}</td><td>${qScores[2].h}</td><td>${qScores[3].h}</td><td>${qScores[4].h}</td>
          <td class="seg-qtotal">${homeTotal}</td>
        </tr>
      </tbody>
    </table>`;
  }
  return {
    show(play) {
      const meta = _meta(play);
      if (!meta) return;
      const id = `${play.kind}-${play.quarter || 0}-${play.time || 0}`;
      if (activeId === id) return;
      this.clear();
      activeId = id;
      const wrap = _wrap();
      if (!wrap) return;
      const cs = getComputedStyle(wrap);
      if (cs.position === "static") wrap.style.position = "relative";
      const showTable = play.kind === "halftime" || play.kind === "quarter";
      const el = document.createElement("div");
      el.className = "seg-cinema";
      el.id = "seg-cinema-overlay";
      el.style.setProperty("--accent", meta.accent);
      el.innerHTML = `
        <div class="seg-flood"></div>
        <div class="seg-content">
          <div class="seg-eyebrow">${play.kind === "halftime" ? "GRIDIRON CHAIN" : ""}</div>
          <div class="seg-headline">${meta.headline}</div>
          ${meta.sub ? `<div class="seg-sub">${meta.sub}</div>` : ""}
          ${showTable ? `<div class="seg-table-wrap">${_quarterScoresHTML(play)}</div>` : ""}
        </div>`;
      wrap.appendChild(el);
    },
    clear() {
      const el = document.getElementById("seg-cinema-overlay");
      if (el) el.remove();
      activeId = null;
    },
  };
})();

// Big-play moment cinemas — INT (incl. PICK SIX), FUMBLE RECOVERY,
// SACK (force ≥ 1.5). Card slides up from field bottom on the play
// hold, ~1.4s beat, auto-clear on next play.
const _momentCinema = (() => {
  let activeId = null;
  function _wrap() {
    return document.querySelector(".bspnlive-field-wrap")
        || document.querySelector(".field-wrap")
        || document.getElementById("field")?.parentElement;
  }
  function _kindMeta(play) {
    if (play.kind === "int") {
      if (play.isPickSix) return {
        headline: "PICK SIX",  icon: "🚀", accent: "#ffd54d",
        sub: `${play.defender || "Defender"} returns ${play.intReturnYds || 0} yds for SIX`,
      };
      if (play.isTouchback) return {
        headline: "INTERCEPTION", icon: "🦅", accent: "#9bd0ff",
        sub: `${play.defender || "Defender"} picks it off — touchback`,
      };
      return {
        headline: "INTERCEPTION", icon: "🦅", accent: "#9bd0ff",
        sub: `${play.defender || "Defender"} picks off ${play.passer || "QB"}${play.intReturnYds ? ` · ${play.intReturnYds}-yd return` : ""}`,
      };
    }
    if (play.kind === "fumble") {
      const isDefRecov = play.recoveredBy === "def";
      const isReturnTD = play.isReturnTD;
      if (isReturnTD) return {
        headline: "FUMBLE-SIX", icon: "💥", accent: "#ffd54d",
        sub: `${play.defender || "Defender"} scoops it up — TOUCHDOWN`,
      };
      if (isDefRecov) return {
        headline: "TURNOVER", icon: "🔄", accent: "#ff8a4a",
        sub: `Fumble recovered by ${play.defender || "the defense"}${play.forcedBy ? ` · forced by ${play.forcedBy}` : ""}`,
      };
      return {
        headline: "FUMBLE RECOVERY", icon: "🤲", accent: "#9be09b",
        sub: `Offense recovers their own${play.forcedBy ? ` · forced by ${play.forcedBy}` : ""}`,
      };
    }
    return null;
  }
  return {
    show(play) {
      const meta = _kindMeta(play);
      if (!meta) return;
      const id = `${play.kind}-${play.startYard}-${play.defender || play.recoveredBy}-${play.intReturnYds || 0}`;
      if (activeId === id) return;
      this.clear();
      activeId = id;
      const wrap = _wrap();
      if (!wrap) return;
      const cs = getComputedStyle(wrap);
      if (cs.position === "static") wrap.style.position = "relative";
      const el = document.createElement("div");
      el.className = "moment-cinema";
      el.id = "moment-cinema-overlay";
      el.style.setProperty("--accent", meta.accent);
      el.innerHTML = `
        <div class="moment-card">
          <div class="moment-icon">${meta.icon}</div>
          <div class="moment-body">
            <div class="moment-eyebrow">BIG PLAY</div>
            <div class="moment-headline">${meta.headline}</div>
            <div class="moment-sub">${meta.sub}</div>
          </div>
        </div>`;
      wrap.appendChild(el);
    },
    clear() {
      const el = document.getElementById("moment-cinema-overlay");
      if (el) el.remove();
      activeId = null;
    },
  };
})();

// ── UNIFIED ST DURATION FORMULA (module scope so kickoff/punt/FG can
//    call it before reaching the original in-function declarations) ──
// First-principles fix for the "every play kind invents its own
// duration formula" drift that caused the kickoff timing bug + the
// "ball flies too fast" complaints that had to be patched per-kind.
//
// ONE knob (ST_YPS_VISUAL) tunes how fast ball+return reads on
// screen across kickoff/punt/FG. Bump it down → everything slower,
// up → everything faster. No more poking three different constants
// to keep ST plays consistent.
//
// Returns { duration, presnapT, flightT, returnT } where each *T is
// the end-fraction of that phase (0..1). Animation uses these
// instead of hard-coded constants so the ball-flight + return ratios
// automatically scale with the play's actual yardage.
// Ball travels FAST on ST plays (real kickoff ~20-25 yps horizontal,
// hangs in the air). Players move at real-football top speed (~14 yps).
// Separating these matters because:
//   - Ball must arrive faster than coverage can converge (otherwise
//     cov beats the ball to the catch point = unrealistic)
//   - Returner running back the ball does so at NORMAL human speed
const ST_BALL_YPS    = 24;
// Returner sprint — was 14 yps (47% over NFL elite). 10.5 yps matches
// the top-end Devin Hester / Cordarrelle Patterson return speed.
const ST_PLAYER_YPS  = 10.5;
// Legacy alias — anything outside the ST timing function still uses
// this as a single "speed" knob; tune player speed via ST_PLAYER_YPS.
const ST_YPS_VISUAL  = ST_PLAYER_YPS;
function _stPlayTiming(opts) {
  const {
    ballYds        = 0,
    runYds         = 0,
    presnapMs      = 0,
    payoffMs       = 700,
    minActionMs    = 1400,
    maxActionMs    = 8000,
  } = opts || {};
  // Ball and player phases use DIFFERENT speeds. Ball travels fast
  // (hangtime + arc), players move at real-football speed during the
  // run-back. Defenders are therefore slower than the ball (correct).
  const rawBallMs   = Math.abs(ballYds) / ST_BALL_YPS   * 1000;
  const rawRunMs    = Math.abs(runYds)  / ST_PLAYER_YPS * 1000;
  const rawAction   = rawBallMs + rawRunMs;
  const actionMs    = clamp(rawAction, minActionMs, maxActionMs);
  const scale       = rawAction > 0 ? actionMs / rawAction : 1;
  const ballMs      = rawBallMs * scale;
  const runMs       = rawRunMs  * scale;
  const duration  = Math.round(presnapMs + actionMs + payoffMs);
  return {
    duration,
    presnapT: presnapMs / duration,
    flightT:  (presnapMs + ballMs) / duration,
    returnT:  (presnapMs + ballMs + runMs) / duration,
  };
}
function _stPlayDuration(opts) { return _stPlayTiming(opts).duration; }

// ─── KICKOFF / PUNT-RETURN AGENT SIM ──────────────────────────────────
// Forward-physics simulation for special-teams returns. Each player has
// position + role, accelerates toward a role-specific target, and moves
// at a capped speed. The tackle EMERGES when the primary cover catches
// the returner — there's no predetermined tackle layout to snap to.
//
// Called ONCE at play creation, returns a frame-indexed trajectory cache
// that the per-frame render samples in O(1). This is what replaced the
// old phase-based scripts where flight/return/tackle each had their own
// position formulas and the boundaries between them were where bugs lived.
//
// Speeds are tuned so:
//   - Cover gunners move at ~16 yps (≈32 mph after the 2x time
//     compression — realistic NFL gunner speed).
//   - Blockers a touch slower at ~13 yps.
//   - Returner speed is auto-tuned per-play so he arrives at finalX
//     (= the engine's tackle spot, derived from play.endYard) exactly
//     at the return-phase end, matching the engine's yardage outcome.
//   - Primary cover's speed is ALSO auto-tuned so he arrives at the
//     same place at the same time — that's how the visual matches
//     the engine's emitted tackler without snapping anyone.
// Agent-based KR sim. One role: every blocker is a LEAD paired 1-to-1
// with a cov by index — same Y lane, no cross-field traversal. After
// engagement, the pair pins at midfield-ish (drifts slowly upfield with
// the play). Only the primary tackler (exempted from engagement) breaks
// through to the returner — exactly one defender by design.
//
// Speeds tuned so the ball clearly arrives BEFORE the cov:
//   COVER_BASE_YPS  = 12  (non-primary cov)
//   BLOCKER_BASE_YPS = 15 (leads close on cov at midfield)
// In a ~2.7s flight, cov covers ~32 yd from the kicker line — landing
// at the recv 33 area, well short of the catch at recv 15. The primary
// tackler is auto-scaled to arrive at the tackle spot at returnT.
//
// First-principles rule: every blocker's target is another agent, never
// a static coordinate. As long as some agent is moving, every blocker
// has something to chase.
function _simulateKickoffAgents(opts) {
  const {
    duration_ms, flightT, returnT,
    kickerLineX, catchX, finalX, cy, recvDir,
    NUM_COVER, NUM_BLOCKERS,
    coverLanes, blockerLanes, blockerStartX,
    primaryTacklerIdx, secondaryTacklerIdx,
    tackleStyle, blockerAssignments,
    PX_PER_YD,
  } = opts;
  const DT_MS = 16;
  const NUM_FRAMES = Math.ceil(duration_ms / DT_MS) + 1;
  const COVER_BASE_YPS   = 10;     // kickoff coverage — top elite gunner speed
  const BLOCKER_BASE_YPS = 9;      // was 15 (58% over NFL top) — lead blocker isn't faster than the returner
  const ENGAGED_MULT     = 0.30;   // lead's own speed while engaged
  const ENGAGE_DRIFT_YPS = 6;      // engaged pair drifts upfield together
  const COV_PINNED_MULT  = 0.05;   // engaged cov is nearly stopped (was 0.15 — bled through)
  // Per-play primary-cover speed: distance/time so primary arrives at finalX at returnT.
  const _primaryDistX = Math.abs(finalX - kickerLineX);
  const _primaryDistY = Math.abs(coverLanes[primaryTacklerIdx] - cy);
  const _primaryTotalDistPx = Math.sqrt(_primaryDistX * _primaryDistX + _primaryDistY * _primaryDistY);
  const _arriveMs = Math.max(200, duration_ms * returnT);
  const PRIMARY_PX_F = (_primaryTotalDistPx / _arriveMs) * DT_MS;
  const _retDistPx = Math.abs(finalX - catchX);
  const _retDurMs  = Math.max(200, duration_ms * (returnT - flightT));
  const RETURNER_PX_F = (_retDistPx / _retDurMs) * DT_MS;
  const COVER_BASE_PX_F    = COVER_BASE_YPS    * PX_PER_YD * DT_MS / 1000;
  const BLOCKER_BASE_PX_F  = BLOCKER_BASE_YPS  * PX_PER_YD * DT_MS / 1000;
  const ENGAGE_DRIFT_PX_F  = ENGAGE_DRIFT_YPS  * PX_PER_YD * DT_MS / 1000;
  // Initial state
  const cover = [];
  for (let i = 0; i < NUM_COVER; i++) {
    cover.push({ x: kickerLineX, y: coverLanes[i], engaged: false, engagedBy: -1 });
  }
  // 1-to-1 lead↔cov pairing for ALL 10 blockers. Every cov gets a lead;
  // no one runs free past the blockers (the prior split with 4 unblocked
  // interior cov was the "defenders walk into the returner" bug). Only
  // the primary tackler (exempted from engagement, below) breaks through.
  //
  // _engaged is a per-blocker STICKY flag. Initial contact requires
  // distance + leverage, but once latched on the pair stays locked even
  // as drift shuffles their relative positions — the old leverage check
  // broke engagement after ~10 frames because |covToBlockerX| crossed
  // 3 px once drift pushed the lead upfield of the cov, and the cov
  // sprinted free.
  const blockers = [];
  for (let i = 0; i < NUM_BLOCKERS; i++) {
    blockers.push({
      x: blockerStartX, y: blockerLanes[i],
      role: "lead",
      targetCov: i,
      _engaged: false,
    });
  }
  const returner = { x: catchX, y: cy };
  const frames = [];
  for (let frame = 0; frame < NUM_FRAMES; frame++) {
    const t = Math.min(1, (frame * DT_MS) / duration_ms);
    // === RETURNER ===
    if (t < flightT) {
      returner.x = catchX;
      returner.y = cy;
    } else if (t < returnT) {
      const dx = finalX - returner.x;
      const dy = cy - returner.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1) {
        returner.x += (dx / d) * RETURNER_PX_F;
        returner.y += (dy / d) * RETURNER_PX_F;
      }
      returner.y += Math.sin(frame * 0.18) * 0.4;
    }
    // === COVER === pursues returner, slows when engaged.
    for (let i = 0; i < NUM_COVER; i++) {
      const c = cover[i];
      const isPrimary   = i === primaryTacklerIdx;
      const isSecondary = i === secondaryTacklerIdx;
      let targetX, targetY;
      if (isPrimary) {
        targetX = returner.x;
        targetY = returner.y;
      } else if (isSecondary && tackleStyle >= 1) {
        targetX = returner.x + recvDir * 5;
        targetY = returner.y + (i % 2 === 0 ? 8 : -8);
      } else {
        targetX = returner.x + recvDir * (12 + (i % 4) * 6);
        targetY = c.y + (returner.y - c.y) * 0.15;
      }
      const dx = targetX - c.x;
      const dy = targetY - c.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1) {
        const baseSpeed = isPrimary ? PRIMARY_PX_F : COVER_BASE_PX_F;
        // Engaged cov is essentially pinned by their blocker — drag-toward-
        // blocker (12% per frame in the drag loop) supplies any residual
        // motion. Old multiplier 0.15 = 1.8 yps allowed cov to bleed
        // through and reach the returner over a 3s return.
        const speed = c.engaged ? baseSpeed * COV_PINNED_MULT : baseSpeed;
        c.x += (dx / d) * speed;
        c.y += (dy / d) * speed;
      }
    }
    // Field-of-play clamp for cov — keep them inbounds even when
    // pursuing past the goal line on a TD return.
    for (let i = 0; i < NUM_COVER; i++) {
      const c = cover[i];
      c.x = Math.max(FIELD.EZ_PX * 0.5, Math.min(FIELD.W - FIELD.EZ_PX * 0.5, c.x));
      c.y = Math.max(FIELD.TOP + 10, Math.min(FIELD.BOT - 10, c.y));
    }
    // === BLOCKERS — SPREAD-POCKET MODEL + ENGAGEMENT ===
    // Real KR blocking: blockers SPREAD ACROSS the field in front of
    // and around the returner, each covering a lateral lane. Each
    // maintains their FORMATION LATERAL OFFSET (blockerLanes[i]
    // relative to cy) anchored to the returner. Forward distance
    // varies by slot — center blockers tight (4yd), edge blockers
    // wider lead (10-12yd). When cov breaches the pocket, blocker
    // pivots in to engage.
    const aheadSign = Math.sign(kickerLineX - catchX) || 1;
    // Field-of-play bounds — blockers and cov clamped to keep them
    // ON THE FIELD even on TD returns (returner finishes at the goal
    // line; blockers ahead by 6-10yd would otherwise be OUT THE BACK
    // of the endzone).
    const _fieldMinX = FIELD.EZ_PX * 0.5;             // tiny buffer in endzone
    const _fieldMaxX = FIELD.W - FIELD.EZ_PX * 0.5;
    const _fieldMinY = FIELD.TOP + 10;
    const _fieldMaxY = FIELD.BOT - 10;
    for (let i = 0; i < NUM_COVER; i++) { cover[i].engaged = false; cover[i].engagedBy = -1; }
    for (let i = 0; i < NUM_BLOCKERS; i++) {
      const b = blockers[i];
      const a = blockerAssignments[i];
      const cov = cover[b.targetCov];
      let isEngaged = false;
      // SPREAD TARGET — lateral lane offset preserved, forward lead
      // varies. Returner runs toward kicker side; "ahead" = aheadSign.
      const laneOffsetY = blockerLanes[i] - cy;
      const midSlot = (NUM_BLOCKERS - 1) / 2;
      const edgeFactor = Math.abs(i - midSlot) / Math.max(1, midSlot);   // 0=center, 1=edge
      const leadYd = 4 + edgeFactor * 6;   // 4-10yd lead, edges further out
      let targetX = returner.x + aheadSign * leadYd * PX_PER_YD;
      let targetY = returner.y + laneOffsetY * 0.8;   // 80% of original lateral spread
      // If cov is closing on returner, blocker pivots to interpose
      const dxRC = cov.x - returner.x;
      const dyRC = cov.y - returner.y;
      const distRC = Math.hypot(dxRC, dyRC);
      const POCKET_CLOSE_PX = 10 * PX_PER_YD;
      if (distRC < POCKET_CLOSE_PX) {
        // Cov inside pocket area — close on cov directly to engage
        targetX = cov.x;
        targetY = cov.y;
      }
      // The blocker who "fails" is already excluded from engagement below
      // (his cover man slips past) — so he doesn't ALSO need to crawl. 0.4x
      // made one blocker jog the whole way back ("one guy super slow"); 0.85
      // is just a step slow, reads as beaten, not broken.
      const speedCap = a.fails ? BLOCKER_BASE_PX_F * 0.85 : BLOCKER_BASE_PX_F;
      if (!a.fails && b.targetCov !== primaryTacklerIdx) {
        // Contact check uses blocker-to-cov distance
        const dxBC = b.x - cov.x;
        const dyBC = b.y - cov.y;
        const distBCSq = dxBC * dxBC + dyBC * dyBC;
        if (b._engaged) {
          const distToReturner = Math.hypot(b.x - returner.x, b.y - returner.y);
          const RELEASE_DIST = 35 * PX_PER_YD;
          if (distBCSq < 36 * 36 && distToReturner < RELEASE_DIST) {
            isEngaged = true;
            cov.engaged = true;
            cov.engagedBy = i;
          } else {
            b._engaged = false;
          }
        } else if (distBCSq < 22 * 22) {
          // First contact — leverage check: cov is on the returner side
          // of blocker (blocker successfully interposed)
          const covToReturnerX = returner.x - cov.x;
          const covToBlockerX  = b.x - cov.x;
          if (covToReturnerX * covToBlockerX > 0
              || Math.abs(covToReturnerX) < 4
              || Math.abs(covToBlockerX)  < 3) {
            isEngaged = true;
            cov.engaged = true;
            cov.engagedBy = i;
            b._engaged = true;
          }
        }
      }
      const speed = isEngaged ? speedCap * ENGAGED_MULT : speedCap;
      const dx = targetX - b.x;
      const dy = targetY - b.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1) {
        b._vx = (dx / d) * speed;   // record X-velocity for facing/pose
        b.x += b._vx;
        b.y += (dy / d) * speed;
      } else {
        b._vx = 0;
      }
      // Engagement drift — engaged pair gets shoved by the play.
      if (isEngaged) {
        b.x += recvDir * ENGAGE_DRIFT_PX_F;
      }
      // Field-of-play clamp — keep blockers on the field, especially
      // during TD returns where returner ends at the goal line.
      b.x = Math.max(_fieldMinX, Math.min(_fieldMaxX, b.x));
      b.y = Math.max(_fieldMinY, Math.min(_fieldMaxY, b.y));
    }
    // Cov drag — engaged cov gets pulled toward its lead each frame.
    for (let i = 0; i < NUM_COVER; i++) {
      const c = cover[i];
      if (!c.engaged) continue;
      const eb = blockers[c.engagedBy];
      c.x += (eb.x - c.x) * 0.12;
      c.y += (eb.y - c.y) * 0.12;
    }
    // Snapshot
    frames.push({
      returner: { x: returner.x, y: returner.y },
      cover: cover.map(c => ({ x: c.x, y: c.y, engaged: c.engaged, engagedBy: c.engagedBy })),
      blockers: blockers.map(b => ({ x: b.x, y: b.y, role: b.role, vx: b._vx || 0 })),
    });
  }
  return { frames, NUM_FRAMES, DT_MS, duration_ms };
}
function _sampleAgentSim(sim, t) {
  const f = Math.min(sim.NUM_FRAMES - 1, Math.max(0, Math.floor(t * sim.NUM_FRAMES)));
  return sim.frames[f];
}

// ─── Per-play animation engine ─────────────────────────────────────────────
function buildAnimForPlay(play, prevPlay) {
  // Returns { duration, render(t01) }
  // t01 = 0..1 progress
  const homeTeam = gameResult.homeTeam, awayTeam = gameResult.awayTeam;

  // ── SUBSTITUTION TICKER ─────────────────────────────────────────
  // Injured-starter swaps fire as their own visual plays. Short duration
  // (800ms), no field action — the ticker chip slides in and stacks
  // alongside any prior subs. Auto-fades after 4s.
  if (play.kind === "substitution") {
    // Injury subs now show the OUTGOING player on the field, clutching
    // the affected body part. Catastrophic injuries get a stretcher
    // overlay. play.injuryLabel + play.catastrophic drove only the
    // ticker text before — now drive an actual on-field visual.
    const isInjury = play.reason === "injury";
    const duration = isInjury ? (play.catastrophic ? 1800 : 1400) : 700;
    return { duration, kind: "substitution", render: (t, ctx) => {
      drawField(ctx, homeTeam, awayTeam, null);
      _subTicker.add(play);
      if (isInjury) {
        const isHome = play.side === "home";
        const teamColor = isHome ? (homeTeam.primary || "#502c80") : (awayTeam.primary || "#a01818");
        const teamSec = isHome ? (homeTeam.secondary || "#f5c542") : (awayTeam.secondary || "#ffffff");
        // Position the player at midfield-ish, just below the LOS line
        const px = FIELD.W * 0.45;
        const py = (FIELD.TOP + FIELD.BOT) / 2 + 30;
        // Clutch the affected body part — pose driven by injury label.
        // Labels like "concussion", "shoulder", "knee", "ankle", "ribs"
        // mostly map to "tackled" with extra arm/head emphasis. Use the
        // existing tackled pose as the base — already shows clutching.
        drawPlayer(ctx, px, py, teamColor, teamSec, "", "tackled", Math.min(1, t * 1.5), 1, {
          role: play.position || "RB",
        });
        // Body-part label
        const label = (play.injuryLabel || "DOWN").toUpperCase();
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "bold 14px monospace";
        ctx.fillStyle = "rgba(255,170,80,0.95)";
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.lineWidth = 3;
        ctx.strokeText(label, px, py - 38);
        ctx.fillText(label, px, py - 38);
        // Catastrophic — stretcher cart icon (chevron + cross)
        if (play.catastrophic) {
          ctx.font = "bold 18px monospace";
          ctx.fillStyle = "rgba(255,80,80,0.95)";
          ctx.strokeText("🚑 CART", px, py + 38);
          ctx.fillText("🚑 CART", px, py + 38);
        }
        ctx.restore();
      }
    }};
  }

  // ── HC DECISION CALLOUT ────────────────────────────────────────
  // Engine emits kind:"hc_decision" when the coach defies the analytics
  // chart (Riverboat Gambler 4th-down go, Conservative HC desperation
  // go, etc.). Renders a coach card with trait + rationale.
  if (play.kind === "hc_decision") {
    return { duration: 1600, kind: "hc_decision", render: (t, ctx) => {
      drawField(ctx, homeTeam, awayTeam, null);
      _hcDecisionCinema.show(play);
    }};
  }

  // ── CINEMATIC BIG-HIT TREATMENT ─────────────────────────────────
  // big_hit (and ejection) plays get a 2-second AAA-style overlay
  // injected over the field. Force value, mechanism, attacker/victim,
  // archetype chip, body-part hit indicator. Field stays as backdrop.
  if (play.kind === "big_hit" || play.kind === "ejection") {
    const isEject = play.kind === "ejection";
    const force = Number(play.force) || 1.4;
    const dur = isEject ? 2400 : 2000;
    return { duration: dur, kind: play.kind, render: (t, ctx) => {
      drawField(ctx, homeTeam, awayTeam, null);
      // Maintain a single DOM overlay; create on first frame, refresh
      // content if missing, remove when play exits.
      _bigHitCinema.show(play, isEject);
    }};
  }

  if (["halftime", "ot", "quarter", "two_min_warning", "timeout"].includes(play.kind)) {
    const isTimeout = play.kind === "timeout";
    // Timeouts stay on the simple canvas treatment (frequent, less major).
    // Quarter ends / halftime / OT / 2-min warning get the cinematic.
    if (isTimeout) {
      const dur = 1400;
      return { duration: dur, kind: play.kind, render: (t, ctx) => {
        drawField(ctx, homeTeam, awayTeam, null);
        ctx.fillStyle = "rgba(20,30,50,0.65)";
        ctx.fillRect(0, 0, FIELD.W, FIELD.H);
        ctx.fillStyle = "#9bd0ff";
        ctx.font = "bold 36px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(play.desc, FIELD.W / 2, FIELD.H / 2);
        if (play.timeoutsRemaining) {
          ctx.font = "bold 14px sans-serif";
          ctx.fillStyle = "#cccccc";
          const h = play.timeoutsRemaining.home, a = play.timeoutsRemaining.away;
          ctx.fillText(`${homeTeam.name} ${h} TO  ·  ${awayTeam.name} ${a} TO`, FIELD.W / 2, FIELD.H / 2 + 40);
        }
      }};
    }
    const dur = play.kind === "halftime" ? 2400 : play.kind === "ot" ? 2200 : 1800;
    return { duration: dur, kind: play.kind, render: (t, ctx) => {
      drawField(ctx, homeTeam, awayTeam, null);
      _segmentCinema.show(play);
    }};
  }

  if (play.kind === "kickoff") {
    // Receiving team derived from the next play's poss
    const kickoffIdx = gameResult.plays.indexOf(play);
    let recvPoss = "home";
    for (let i = kickoffIdx + 1; i < gameResult.plays.length; i++) {
      if (gameResult.plays[i].poss != null) { recvPoss = gameResult.plays[i].poss; break; }
    }
    const recvTeam = recvPoss === "home" ? homeTeam : awayTeam;
    const kickTeam = recvPoss === "home" ? awayTeam : homeTeam;
    const kickPoss = recvPoss === "home" ? "away" : "home";
    const recvDir  = recvPoss === "home" ? 1 : -1;   // direction returner runs
    // Key x coordinates
    const kickerLineX = yardToAbsX(35, kickPoss);   // kicking team at their own 35
    const catchX     = yardToAbsX(15, recvPoss);    // returner catches at his 15
    // Tackle spot uses the engine's actual endYard, not a hardcoded 25.
    // The old animation always tackled at the receiver's 25 even when the
    // engine said the return went for 35 yards — that mismatch is half of
    // why the play looked scripted.
    const _koEndYard = (play.endYard != null) ? play.endYard : 25;
    const finalX = yardToAbsX(_koEndYard, recvPoss);
    const cy = (FIELD.TOP + FIELD.BOT) / 2;
    // Lane positions for 10 kicking-team coverage players (skipping kicker).
    // Spread vertically across the field.
    const NUM_COVER = 10;
    const coverLanes = [];
    for (let i = 0; i < NUM_COVER; i++) {
      coverLanes.push(cy + ((i - (NUM_COVER - 1) / 2) * (FIELD.BOT - FIELD.TOP - 80) / NUM_COVER));
    }
    // Lane positions for 10 receiving-team blockers (returner is the 11th, deeper).
    const NUM_BLOCKERS = 10;
    const blockerLanes = [];
    for (let i = 0; i < NUM_BLOCKERS; i++) {
      blockerLanes.push(cy + ((i - (NUM_BLOCKERS - 1) / 2) * (FIELD.BOT - FIELD.TOP - 100) / NUM_BLOCKERS));
    }
    // Blockers start ~20 yds in front of the returner, spread across.
    const blockerStartX = yardToAbsX(40, recvPoss);   // receiving team's 40
    // Per-kickoff deterministic hash — drives all the "this kickoff is
    // different from the last one" variation (which coverage player makes
    // the tackle, blocker assignments, tackle style, final-point jitter).
    const ksHash = ((kickoffIdx + 1) * 2654435761) >>> 0;
    const tackleStyle = ksHash % 5;
    // Jitter the final tackle point so the returner doesn't always go
    // down at the exact same spot (±20 px ≈ ±1.3 yds).
    // Note: use >>> (unsigned shift) — `>>` would interpret ksHash as
    // signed when the high bit is set, producing negative array indices.
    const tackleJitter = (((ksHash >>> 4) % 11) - 5) * 4;
    const localFinalX = finalX + tackleJitter;
    // The primary tackler — coverage player who arrives at the returner
    // first and makes the hit. Other coverage players support / pile in
    // based on the tackle style.
    const primaryTacklerIdx = (ksHash >>> 8) % NUM_COVER;
    // Secondary tackler (used for two-man / pile-up styles).
    const secondaryTacklerIdx = (primaryTacklerIdx + 1 + ((ksHash >>> 11) % (NUM_COVER - 1))) % NUM_COVER;
    // Blocker assignments — each receiving-team blocker is paired with
    // the cover gunner in the same lane (small ±1 offset for variety),
    // not a random-offset matchup. Random pairing sent blocker 0 (top
    // of field) chasing cover 5 (middle), across 100+ px of Y — blocker
    // never caught the gunner and the block whiffed visually. Same-lane
    // matchup means blockers actually stand in their gunner's lane.
    //
    // Failure rate: 12.5% (was 25%). The earlier rate plus my too-fast
    // gunner speed meant ~4 cover players ran past blocks every kickoff.
    const blockerAssignments = [];
    const _bOffset = (ksHash >>> 14) & 1;   // 0 or 1 — slight lane skew
    for (let i = 0; i < NUM_BLOCKERS; i++) {
      const targetCov = Math.max(0, Math.min(NUM_COVER - 1, i + _bOffset));
      const fails = ((ksHash >>> (16 + i)) & 7) === 0;   // ~12.5% whiff
      blockerAssignments.push({ targetCov, fails });
    }
    // Unified ST timing — phases derived from actual yardage.
    const _koReturnYds = Math.max(8, Math.abs(_koEndYard - 25));
    const _koTiming = _stPlayTiming({
      ballYds: 65, runYds: _koReturnYds, presnapMs: 0, payoffMs: 700,
    });
    // Agent sim — run ONCE at play creation. Forward physics, constant
    // speeds, no phase-script. Trajectory cached for the render fn.
    const _agentSim = _simulateKickoffAgents({
      duration_ms: _koTiming.duration,
      flightT: _koTiming.flightT, returnT: _koTiming.returnT,
      kickerLineX, catchX, finalX, cy, recvDir,
      NUM_COVER, NUM_BLOCKERS,
      coverLanes, blockerLanes, blockerStartX,
      primaryTacklerIdx, secondaryTacklerIdx,
      tackleStyle, blockerAssignments,
      PX_PER_YD: FIELD.PX_PER_YARD,
    });
    return { duration: _koTiming.duration, kind: "kickoff", render: (t, ctx) => {
      drawField(ctx, homeTeam, awayTeam, null);
      const FLIGHT_END = _koTiming.flightT;
      const RETURN_END = _koTiming.returnT;
      const snap = _sampleAgentSim(_agentSim, t);
      // Ball arc is independent of agent positions — the ball follows
      // a parabolic trajectory during flight, then sits with the carrier.
      const returnerX = snap.returner.x;
      const returnerY = snap.returner.y;
      let ballX, ballY;
      let returnerPose = "stance";
      let returnerT = (t < 0.95 ? ((performance.now() / 333)) % 1 : 0);
      let returnerFacing = recvDir;
      // Ball stays at the kicker's foot until the contact frame, then
      // launches. Synchronized with the kicker's "kick" pose window
      // (t < FLIGHT_END * 0.08 above) — pose's contact frame and ball
      // release happen at the same t. Old code launched the ball at
      // t=0 while the kicker was still in his wind-up, so the leg
      // swing trailed the ball through the air.
      const KICK_CONTACT_T = FLIGHT_END * 0.08;
      if (t < KICK_CONTACT_T) {
        // Wind-up: ball at kicker's foot, still on the ground.
        ballX = kickerLineX;
        ballY = cy + 4;
        returnerPose = "stance";
      } else if (t < FLIGHT_END) {
        const ft = (t - KICK_CONTACT_T) / (FLIGHT_END - KICK_CONTACT_T);
        ballX = kickerLineX + (catchX - kickerLineX) * ft;
        ballY = cy - Math.sin(ft * Math.PI) * 130;
        returnerPose = ft > 0.85 ? "reach" : "stance";
      } else if (t < RETURN_END) {
        ballX = returnerX;
        ballY = returnerY;
        returnerPose = "carry";
      } else {
        ballX = returnerX;
        ballY = returnerY;
        returnerPose = "tackled_carry";  // KR/PR has the ball
        returnerT = Math.min(1, (t - RETURN_END) / (1 - RETURN_END));
        if (tackleStyle === 2) returnerFacing = -recvDir;
      }

      // ── Draw coverage ──
      for (let i = 0; i < NUM_COVER; i++) {
        const cpos = snap.cover[i];
        let cPose, cT;
        if (t < FLIGHT_END * 0.05) {
          cPose = "stance";
          cT = 0;
        } else if (cpos.engaged) {
          cPose = "engage";
          cT = (t < 0.95 ? ((performance.now() / 333) + i * 0.13) % 1 : 0);
        } else if (t >= RETURN_END) {
          const isPrimary   = i === primaryTacklerIdx;
          const isSecondary = i === secondaryTacklerIdx;
          const closeEnough = Math.hypot(cpos.x - returnerX, cpos.y - returnerY) < 18;
          const tackles =
            isPrimary ||
            (isSecondary && tackleStyle >= 1) ||
            (tackleStyle === 3 && closeEnough);
          if (tackles) {
            cPose = "tackled";
            cT = Math.min(1, (t - RETURN_END) / (1 - RETURN_END));
          } else if (closeEnough) {
            cPose = "engage";
            cT = (t < 0.95 ? ((performance.now() / 333) + i * 0.13) % 1 : 0);
          } else {
            cPose = "run";
            cT = (t < 0.95 ? ((performance.now() / 333) + i * 0.11) % 1 : 0);
          }
        } else {
          cPose = "run";
          cT = (t < 0.95 ? ((performance.now() / 333) + i * 0.11) % 1 : 0);
        }
        drawPlayer(ctx, cpos.x, cpos.y, kickTeam.primary, kickTeam.secondary, "",
                   cPose, cT, -recvDir, { name: "ko-cov-" + i });
      }

      // ── Kicker — stays back near his 35 throughout the play ──
      // Kick pose is the CONTACT frame; ball departs at t=0, so the
      // pose must hit its contact frame at t=0 too. Old window was 40%
      // of FLIGHT_END so the leg was still swinging when the ball was
      // already 30% downfield. Now the kick spans the first 8% of
      // flight only (~contact + brief follow-through), then idle.
      drawPlayer(ctx, kickerLineX - recvDir * 4, cy, kickTeam.primary, kickTeam.secondary,
                 "K", t < FLIGHT_END * 0.08 ? "kick" : "idle",
                 t < FLIGHT_END * 0.08 ? Math.min(1, t / (FLIGHT_END * 0.08)) : 0, -recvDir,
                 { name: "ko-kicker" });

      // ── Draw blockers ──
      // Pose by role + engagement (engagement = "is some cov tagged with
      // engagedBy === me"). Engagement state in snap.cover is computed in
      // the SAME frame as the blocker positions, so the pose matches the
      // motion (no one-frame lag).
      //   LEAD pre-contact: "run" — sprinting upfield to meet cov.
      //   LEAD engaged:     "engage" — wrestling cov, drifting upfield.
      //   ESCORT pre-snap:  "backpedal" — settling into escort slot
      //                     without auto-facing the deeper returner.
      //   ESCORT in motion: "run" — leading the carrier upfield.
      // All facing = recvDir. "engage" / "backpedal" don't auto-face, so
      // the explicit facing sticks.
      for (let i = 0; i < NUM_BLOCKERS; i++) {
        const bpos = snap.blockers[i];
        const isEngaged = !!snap.cover.find(c => c.engagedBy === i);
        // A KR blocker ALWAYS faces downfield (recvDir) — he's blocking the
        // coverage coming from that way. While he RETREATS to set the pocket
        // (moving back toward the returner, vx opposite recvDir), use the
        // "backpedal" pose: it's facing-locked, so he keeps facing the
        // coverage instead of flipping to face the returner. "run" auto-faces
        // by velocity, which is why he looked like he was sprinting AT the
        // returner while backing up. Forward (leading the return) stays "run".
        const _retreating = (bpos.vx || 0) * recvDir < -0.1;
        const bPose = (t < FLIGHT_END * 0.05) ? "stance"
                    : isEngaged                 ? "engage"
                    : _retreating               ? "backpedal"
                    :                             "run";
        const bT = (t < 0.95 ? ((performance.now() / 333) + i * 0.17) % 1 : 0);
        const bFacing = recvDir;
        drawPlayer(ctx, bpos.x, bpos.y, recvTeam.primary, recvTeam.secondary, "",
                   bPose, bT, bFacing, { name: "ko-blocker-" + i });
      }

      // ── Returner (last so he draws on top) ──
      drawPlayer(ctx, returnerX, returnerY, recvTeam.primary, recvTeam.secondary,
                 "", returnerPose, returnerT, returnerFacing, { name: "ko-returner" });

      // Ball — only show if not held by the returner pose
      drawBall(ctx, ballX, ballY, 1 + (t < FLIGHT_END ? Math.sin((t/FLIGHT_END) * Math.PI) * 0.3 : 0));
    }};
  }

  if (!play.startYard && play.startYard !== 0) {
    // Score-only play (extra point, etc.) - just hold
    return { duration: 600, kind: play.kind, render: (t, ctx) => {
      drawField(ctx, homeTeam, awayTeam, null);
    }};
  }

  const poss = play.poss;
  const dir = poss === "home" ? 1 : -1; // offense moves direction
  const losX = yardToAbsX(play.startYard, poss);
  const cy = (FIELD.TOP + FIELD.BOT) / 2;
  const formation = makeFormation(losX, poss, {
    twoBack: !!play.isTwoBack,
    // Engine picks the 2-back style (I vs PRO) deterministically per snap
    // and emits it so the renderer doesn't re-roll and misalign with the
    // carrier track's t=0 waypoint. Falls back to renderer-random when the
    // engine doesn't emit (pass plays, legacy).
    twoBackStyle: play.twoBackStyle || null,
    isGoalLine: (play.startYard ?? 0) >= 95,
    personnel: play.personnel,
    defPackage: play.defPackage,
    down: play.down,
    ytg: play.ytg,
  });
  const team = poss === "home" ? homeTeam : awayTeam;
  const oppTeam = poss === "home" ? awayTeam : homeTeam;
  const possColor = team.primary;
  const oppColor = oppTeam.primary;
  // Attach per-player runStyle + celebStyle + jersey# from both rosters
  const offStarters = poss === "home" ? gameResult.homeRatings.starters : gameResult.awayRatings.starters;
  const defStarters = poss === "home" ? gameResult.awayRatings.starters : gameResult.homeRatings.starters;
  attachPlayerStyles(formation, offStarters, defStarters, gameResult.playerLookup);

  // ── DEFENDER INDEX HELPERS ──
  // The defense array is [...DL, ...LB, ...CB(+nickel+dime), S1, S2]. With
  // personnel-based subs (NICKEL drops 1 LB for a CB, DIME drops 2 LBs for
  // 2 DBs, QUARTER drops all 3 LBs), the indices for the safeties / corners
  // shift. Compute them once so pass-rush / coverage / pick logic works
  // regardless of defensive package.
  const _dlN = formation.dline.length;
  const _lbN = formation.lbs.length;
  const _cbN = (formation.cb1 ? 1 : 0) + (formation.cb2 ? 1 : 0) + (formation.cb3 ? 1 : 0) + (formation.cb4 ? 1 : 0) + (formation.cb5 ? 1 : 0);
  const idxLB1   = _dlN;
  const idxLBmid = _dlN + Math.floor(_lbN / 2);
  const idxLB3   = _dlN + Math.max(0, _lbN - 1);
  const idxCB1   = _dlN + _lbN;
  const idxCB2   = idxCB1 + 1;
  const idxNB    = idxCB1 + 2;
  const idxS1    = idxCB1 + _cbN;
  const idxS2    = idxS1 + 1;

  // First down marker abs X
  let firstDownAbs = null;
  if (play.down > 0) {
    const fdYard = clamp(play.startYard + play.ytg, 0, 100);
    firstDownAbs = yardToAbsX(fdYard, poss);
  }

  const fieldState = { los: losX, firstDownAbs, possColor };

  // Poses where players are SUPPOSED to be tight (tackle pile, block
  // scrum, contact) — exempt from the separation pass so real piles
  // stay dense. Everyone else gets pushed apart when they overlap.
  const _PILE_POSES = new Set([
    "tackled", "tackled_carry", "ragdoll", "hit", "tumble", "spin_fall",
    "sack", "dive", "dive_forward", "engage", "block", "jam",
  ]);
  function _separatePlayers(all) {
    // Light pairwise push-apart so convergent players don't render
    // stacked on one point (the post-catch "clump"). Pursuers separate
    // from the carrier but not from each other; this is the missing
    // mutual spacing. Pile poses are skipped (contact is meant to be
    // tight). 2 relaxation iterations, half-overlap push per pair.
    const MIN_SEP = 15;            // ~1 yd center-to-center
    const MIN_SEP2 = MIN_SEP * MIN_SEP;
    for (let iter = 0; iter < 2; iter++) {
      for (let a = 0; a < all.length; a++) {
        const pa = all[a];
        if (_PILE_POSES.has(pa.pose)) continue;
        for (let b = a + 1; b < all.length; b++) {
          const pb = all[b];
          if (_PILE_POSES.has(pb.pose)) continue;
          let dx = pb.x - pa.x, dy = pb.y - pa.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= MIN_SEP2 || d2 < 0.0001) continue;
          const d = Math.sqrt(d2);
          const push = (MIN_SEP - d) * 0.5;
          const ux = dx / d, uy = dy / d;
          pa.x -= ux * push; pa.y -= uy * push;
          pb.x += ux * push; pb.y += uy * push;
        }
      }
    }
  }
  function drawPlayers(off, def) {
    const all = [...off, ...def];
    _separatePlayers(all);
    // Field-bounds clamp — keep every body inside the back lines and
    // sidelines. Players were rendering in the black void past the back
    // of the endzone (deep TDs, the celebration cluster, or the
    // separation push near an edge). Clamp the sprite CENTER to a small
    // margin inside x∈[0,W] (endzone back lines) and y∈[TOP,BOT]
    // (sidelines). Runs after separation so a push can't escape bounds.
    const _BX = 12, _BY = 6;
    for (const p of all) {
      const _cx = Math.max(_BX, Math.min(FIELD.W - _BX, p.x));
      const _cy = Math.max(FIELD.TOP + _BY, Math.min(FIELD.BOT - _BY, p.y));
      // If clamped against an endzone BACK line, turn the player to face
      // back toward the field — a body pinned at the back wall can't run
      // through it, and leaving the velocity/facing pointing into the
      // wall left defenders "staring at the back of the endzone when
      // there's no room". Only override on an actual X-clamp; the sprite
      // direction picker uses this facing once the body is stopped.
      if (_cx !== p.x) p.facing = (_cx < FIELD.W / 2) ? 1 : -1;
      p.x = _cx;
      p.y = _cy;
    }
    for (const p of off) drawPlayer(ctx, p.x, p.y, possColor, team.secondary, p.label, p.pose, p.t, p.facing ?? (dir), p);
    for (const p of def) drawPlayer(ctx, p.x, p.y, oppColor, oppTeam.secondary, p.label, p.pose, p.t, p.facing ?? (-dir), p);
  }

  let ctx = null;

  // Audible — smart QBs (high AWR) sometimes change the play pre-snap.
  // Deterministic per play so the playback doesn't flicker on rewind.
  const qbPlayer = gameResult.playerLookup && offStarters ? gameResult.playerLookup.get(offStarters.qb) : null;
  const qbAwr = qbPlayer?.stats?.[3] ?? 70;   // index 3 = AWR
  // Inline aggression (mirrors _qbAggression — can't call Sim method here).
  const _qbThrAud = qbPlayer?.stats?.[4] ?? 70;
  const _qbArchAud = qbPlayer?.archetype;
  const _qbArchModAud = _qbArchAud === "GUNSLINGER" ? 20 : _qbArchAud === "DUAL_THREAT" ? 10 : _qbArchAud === "GAME_MANAGER" ? -15 : 0;
  const qbAgg = clamp(_qbThrAud * 0.40 + qbAwr * 0.30 + _qbArchModAud, 20, 99);
  // Aggressive QBs audible more often — cap raised to 0.38 for high-agg QBs.
  const audibleChance = clamp(((qbAwr - 60) / 180) * (1 + (qbAgg - 50) / 100), 0, 0.38);
  const audibleSeed = (((play.startYard * 31) ^ ((play.time || 0) * 7)) >>> 0) % 1000 / 1000;
  const isAudible = audibleSeed < audibleChance;
  // Extra pre-snap time when audibling (gives the play call space to breathe)
  // PRE will be computed per-play once dur is known (PRE = PRE_MS / dur)
  let PRE = 0.24;

  // ── PRE-SNAP MOTION ──
  // ~22% of plays put a receiver/TE in motion across the formation. Motion
  // takes place in the back half of pre-snap; the player settles into a new
  // y-coordinate by the snap. Routes start from the post-motion position.
  const motionSeed = (((play.startYard * 23) ^ ((play.targetDepth || 0) * 13) ^ ((play.time || 0) * 11)) >>> 0) % 1000 / 1000;
  const hasMotion  = motionSeed < 0.22 && play.kind !== "kickoff";
  let motionRole = null, motionStartY = 0, motionEndY = 0;
  if (hasMotion) {
    // Pick from receivers actually on the field for this personnel.
    const motionPool = [];
    if (formation.wr1) motionPool.push("wr1");
    if (formation.wr2) motionPool.push("wr2");
    if (formation.wr3) motionPool.push("wr3");
    if (formation.wr4) motionPool.push("wr4");
    if (formation.te)  motionPool.push("te");
    if (motionPool.length) {
      motionRole = motionPool[Math.floor(motionSeed * 9999) % motionPool.length];
      const target = motionRole === "wr1" ? formation.wr1
                   : motionRole === "wr2" ? formation.wr2
                   : motionRole === "wr3" ? formation.wr3
                   : motionRole === "wr4" ? formation.wr4
                   :                        formation.te;
      motionStartY = target.y;
      // Motion lands at a REAL football alignment — well clear of the
      // OL Y-range (the line spans cy ± 64px). Old endpoints (cy±50,
      // cy±30) put motion-WRs literally INSIDE the OL stack at the snap
      // — a slot WR rendering between the right guard and tackle in the
      // dots view (the "#10 in the middle of the line" report). New:
      //   wr1/wr2: motion IN to slot (90px / ~6yd, jog pace)
      //   wr3/wr4: motion TIGHTEN to tight-slot position (cy±95, where
      //            wr5 sits in 5WR personnel) — football "tighten the
      //            split" / "stack" motion, ~55px / 3.7yd at jog pace.
      //            Outside the OL by 31px center / 11px edge — clearly
      //            distinct dots, no overlap with the right tackle.
      //   te:     motion across to the opposite-side in-line TE (cy-78)
      //           — already clear, unchanged.
      motionEndY = motionRole === "wr1" ? cy - 150
                : motionRole === "wr2" ? cy + 150
                : motionRole === "wr3" ? cy - 95
                : motionRole === "wr4" ? cy + 95
                :                        cy - 78;
      target.y = motionEndY;
    }
  }
  // Returns the y-offset to apply to the motion player vs his post-motion home.
  // 0 means he's at his new home y. Positive/negative means he's still
  // traveling there during the motion window.
  const motionYOffset = (tNow) => {
    if (!hasMotion || tNow >= PRE) return 0;
    const preT = tNow / PRE;
    if (preT < 0.40) return (motionStartY - motionEndY);
    if (preT < 0.88) {
      const mp = (preT - 0.40) / 0.48;
      const sm = mp * mp * (3 - 2 * mp);
      return (motionStartY - motionEndY) * (1 - sm);
    }
    return 0;
  };
  // Returns true when the motion player is actively jogging across.
  const isInMotionNow = (tNow) => {
    if (!hasMotion || tNow >= PRE) return false;
    const preT = tNow / PRE;
    return preT >= 0.40 && preT < 0.88;
  };
  // Smoothed X depth for the motion player. He drops ~2.5yd (38px) behind
  // the LOS while jogging — clearly behind the OL row (OL sits at LOS−2px,
  // so 38px puts the motion path 36px past the line, ~16px between dot
  // edges in the top-down view) — then returns to set. Was 20px (~1.3yd):
  // the dot grazed the OL stack during the cross. Easing in/out is
  // essential — a binary `moving ? -38 : 0` jumps at the motion boundaries
  // and the render continuity guard smears each jump into a fast slide
  // ("super speed at the snap"). At set (preT ≥ 0.88) X returns to 0 so
  // the WR is back at his motionEndY home (well clear of OL Y-range, see
  // motionEndY above — no overlap to worry about at the snap frame).
  const motionXOffset = (tNow) => {
    if (!hasMotion || tNow >= PRE) return 0;
    const preT = tNow / PRE;
    if (preT < 0.40 || preT >= 0.88) return 0;
    const env = preT < 0.50 ? (preT - 0.40) / 0.10      // ease in
              : preT > 0.80 ? (0.88 - preT) / 0.08      // ease out (set)
              : 1;
    const sm = env * env * (3 - 2 * env);               // smoothstep
    return -dir * 38 * sm;
  };

  // ── DEFENSIVE PRE-SNAP MOVEMENT ─────────────────────────────────────
  // ~35% of plays, one defender shifts pre-snap (LB walks up to show blitz,
  // safety rotates from deep, DL slides). Picks an index 0-10 (defense
  // array) deterministically per play.
  // ~55% of plays, one defender (usually a LB or S) is the "POINTER" —
  // pre-snap point pose calling out the offense. Different player than
  // the shifter to avoid stacking.
  const defShiftSeed = (((play.startYard * 31) ^ ((play.targetDepth || 0) * 19) ^ ((play.time || 0) * 7)) >>> 0) % 1000 / 1000;
  const hasDefShift  = defShiftSeed < 0.35;
  // LB indices in formation.defense are 4,5,6 (after 4 DL); S are 9,10
  const shiftIdx = hasDefShift
    ? [4, 5, 6, 9, 10][Math.floor(defShiftSeed * 999) % 5]
    : -1;
  // Shift offsets — small position deltas applied during pre-snap window
  const shiftDX = hasDefShift ? (Math.floor(defShiftSeed * 999 + 7) % 2 ? -1 : 1) * (10 + (Math.floor(defShiftSeed * 999) % 12)) : 0;
  const shiftDY = hasDefShift ? (Math.floor(defShiftSeed * 999 + 11) % 2 ? -1 : 1) * (8 + (Math.floor(defShiftSeed * 999) % 10)) : 0;
  const defShiftXY = (idx, tNow) => {
    if (idx !== shiftIdx || tNow >= PRE) return { dx: 0, dy: 0 };
    const preT = tNow / PRE;
    if (preT < 0.30) return { dx: 0, dy: 0 };
    if (preT < 0.78) {
      const mp = (preT - 0.30) / 0.48;
      const sm = mp * mp * (3 - 2 * mp);
      return { dx: shiftDX * sm, dy: shiftDY * sm };
    }
    return { dx: shiftDX, dy: shiftDY };
  };
  const isDefShifting = (idx, tNow) => {
    if (idx !== shiftIdx || tNow >= PRE) return false;
    const preT = tNow / PRE;
    return preT >= 0.30 && preT < 0.78;
  };

  const defPointSeed = (((play.startYard * 13) ^ ((play.time || 0) * 23)) >>> 0) % 1000 / 1000;
  const hasDefPoint  = defPointSeed < 0.55;
  // Pointer is usually MLB (5) or SS/FS (9 or 10) — defenders in coverage
  // calling out the offense
  const pointerIdx = hasDefPoint
    ? [5, 5, 5, 9, 10][Math.floor(defPointSeed * 999) % 5]
    : -1;
  const isDefPointer = (idx) => idx === pointerIdx && idx !== shiftIdx;

  // Estimate carrier velocity from tween end-point. Used as input to
  // simIntercept so defenders aim at where the carrier WILL BE.
  function carrierVelocityToward(rbX, rbY, endX, endY, speedPxPerSec) {
    const dx = endX - rbX, dy = endY - rbY;
    const d = Math.hypot(dx, dy);
    if (d < 0.5) return { vx: 0, vy: 0 };
    return { vx: (dx / d) * speedPxPerSec, vy: (dy / d) * speedPxPerSec };
  }
  // Lineman archetype tagging — deterministic by slot so each OL/DL has
  // a consistent visual signature across plays. play.dlType (sack play)
  // takes precedence for the breaking rusher; everyone else hashes off
  // their formation position. Drives the "engage" pose variants in
  // play-render.js.
  const _DL_ARCH = ["POWER", "SPEED", "TWEENER", "PENETRATOR", "TECHNICIAN"];
  const _OL_ARCH = ["ANCHOR", "ATHLETIC", "TECHNICIAN", "PLUG", "MAULER"];
  function _archForLineman(p, role) {
    const pool = (role === "DL") ? _DL_ARCH : _OL_ARCH;
    const h = ((Math.abs(p.x | 0) * 31 + Math.abs(p.y | 0) * 13) >>> 0);
    return pool[h % pool.length];
  }
  // ── Ragdoll physics — kinematic rigid-body. On impact, initialize
  // velocity + angular velocity from the hit vector. Each frame, integrate
  // with gravity, damping, and a ground bounce. State persists on the
  // formation player object (d._ragdoll) so it survives across frames
  // within a play and resets when a new play / formation is created.
  // Render uses style._ragdoll via the "ragdoll" pose case.
  const RAG_GRAVITY = 480;       // px/s² downward
  const RAG_DAMP_X  = 0.96;      // per-step velocity damping
  const RAG_DAMP_Y  = 0.99;
  const RAG_DAMP_W  = 0.94;      // angular damping
  function initRagdoll(player, hitDirX, hitDirY, force, nowMs, seed) {
    // hitDirX/Y is the unit vector FROM the hitter TO the victim — that's
    // the direction the victim flies. Force is impulse magnitude (px/s).
    const dist = Math.hypot(hitDirX, hitDirY) || 1;
    const ux = hitDirX / dist;
    const uy = hitDirY / dist;
    // Tackle PILE — bodies collapse, they don't explode. Spin and upward
    // kick capped so players fall in place with slight tumble instead
    // of flying apart. Per-seed jitter keeps each ragdoll a little
    // different without anyone going airborne.
    const seedF = (seed >>> 0);
    const spinSign = (seedF & 1) ? -1 : 1;
    const forceScale = Math.min(1.1, Math.max(0.5, force / 200));
    const spinMag = (2 + ((seedF >>> 1) & 5)) * forceScale;     // 1-7 rad/s
    const upKick  = (15 + ((seedF >>> 4) & 25)) * forceScale;   // 7-44 px/s
    player._ragdoll = {
      vx: ux * force,
      vy: uy * force - upKick,
      angVel: spinSign * spinMag,
      dx: 0, dy: 0, rot: 0,
      life: 0,
      onGround: false,
      lastMs: nowMs,
    };
  }
  function stepRagdoll(player, nowMs, groundDy) {
    const r = player._ragdoll;
    if (!r) return;
    let dt = Math.min(0.05, Math.max(0, (nowMs - r.lastMs) / 1000));
    r.lastMs = nowMs;
    if (dt <= 0) return;
    // Respect an active slow-mo window. The ragdoll runs on wall-clock (so it
    // keeps falling during the post-play hold once t clamps to 1) — but on a
    // BIG-HIT slow-mo the scene runs at 0.2-0.5x, and an unscaled ragdoll
    // tumbled to the turf at full speed THROUGH the dramatic slow-motion.
    // Scale dt by the live multiplier ONLY while the slow-mo is active; after
    // it ends (incl. the post-play hold) the factor is 1 and it advances
    // normally.
    if (typeof animState !== "undefined" && animState && animState.slowMoUntil
        && nowMs < animState.slowMoUntil) {
      dt *= (animState.slowMoMul != null ? animState.slowMoMul : 1);
      if (dt <= 0) return;
    }
    r.vy += RAG_GRAVITY * dt;
    r.dx += r.vx * dt;
    r.dy += r.vy * dt;
    r.rot += r.angVel * dt;
    if (r.dy >= groundDy) {
      // Landed — bounce a bit, then stick
      if (r.vy > 30) {
        r.dy = groundDy;
        r.vy = -r.vy * 0.20;
        r.angVel *= 0.5;
        r.vx *= 0.55;
      } else {
        r.dy = groundDy;
        r.vy = 0;
        r.angVel *= 0.6;
        r.vx *= 0.7;
      }
      r.onGround = true;
    }
    r.vx *= RAG_DAMP_X;
    r.vy *= RAG_DAMP_Y;
    r.angVel *= RAG_DAMP_W;
    r.life = Math.min(1, r.life + dt * 1.4);
  }
  // INCREMENTAL pursuit. Previously this computed "where would d be at
  // time elapsedMs if it traveled from d.x to (tx, ty) at constant
  // velocity", recomputing the path from d.x EVERY frame. When the
  // target shifted between frames (carrier juke, dodged stale-target
  // snap, sack pocket collapse, truck anchor), the entire path
  // re-drew from the origin and the defender appeared to teleport —
  // because the SAME elapsed time aimed at a NEW target lands at a
  // new fraction along a new line. Now mutates per-defender state
  // (_cx, _cy, _lastMs) so each call advances by dt FROM the last
  // known position; target changes only affect the direction of the
  // next small step.
  // UNIFIED PURSUIT — SimPlayer-backed. Replaces the old time-based
  // tween (`_cx/_cy/_lastMs` cache) and the dead `simPursue()` helper.
  // One pursuit system across the codebase. Caller can opt into
  // intercept-against-carrier-velocity by passing opts.carrier.
  //
  //   pursue(d, tx, ty, elapsedMs, factor)
  //     — direct pursuit toward (tx, ty)
  //   pursue(d, tx, ty, elapsedMs, factor, { carrier: { x, y, vx, vy } })
  //     — intercept: aim at where the carrier WILL be, plus the
  //       lane offset (tx - carrier.x, ty - carrier.y).
  //
  // Returns { x, y, moved } where `moved` indicates translation > 0.5px
  // this frame. (Locomotion-driven legs now self-derive in drawPlayer,
  // so `moved` is mostly redundant — kept for callers that gate other
  // behavior on actual movement.)
  const pursue = (d, tx, ty, elapsedMs, factor = 1.0, opts = {}) => {
    if (typeof SimPlayer === "undefined") {
      // Fallback only if play-sim.js didn't load — should never happen.
      d._cx = tx; d._cy = ty;
      return { x: tx, y: ty, moved: false };
    }
    const targetFactor = factor || 1.0;
    if (!d._sim) {
      d._sim = new SimPlayer(d.x, d.y, {
        maxSpeed: SIM_DEFAULTS.MAX_SPEED * targetFactor,
        accel: SIM_DEFAULTS.ACCEL,
      });
      d._simFactor = targetFactor;
    } else if (Math.abs((d._simFactor || 0) - targetFactor) > 0.01) {
      // Speed re-cap — used by the run-play primary-tackler dynamic speed.
      d._sim.maxSpeed = SIM_DEFAULTS.MAX_SPEED * targetFactor;
      d._simFactor = targetFactor;
    }
    let aimX = tx, aimY = ty;
    if (opts.carrier && typeof simIntercept === "function") {
      const intercept = simIntercept(d._sim, {
        x: opts.carrier.x, y: opts.carrier.y,
        vx: opts.carrier.vx || 0, vy: opts.carrier.vy || 0,
      });
      // Lane offset — preserve the (tx, ty) lane the caller wanted
      // relative to the carrier's current spot, then add the intercept
      // delta so the defender aims at where the carrier WILL be.
      aimX = intercept.x + (tx - opts.carrier.x);
      aimY = intercept.y + (ty - opts.carrier.y);
    }
    const beforeX = d._sim.x, beforeY = d._sim.y;
    d._sim.stepTowardAt(aimX, aimY, elapsedMs);
    return {
      x: d._sim.x, y: d._sim.y,
      moved: Math.hypot(d._sim.x - beforeX, d._sim.y - beforeY) > 0.5,
    };
  };
  // ── DEFENDER SIM ↔ RENDERED-POSITION SYNC (Stage 4) ────────────────
  // Sync formation.defense[i]._sim to the position the defender was
  // JUST rendered at, every frame, regardless of which code path
  // produced that position (pre-snap defShiftXY + coverage adjustment,
  // engine track sample, pursue sim, ragdoll, anything). The next
  // frame's pursue() will then start from there instead of from the
  // formation home — closes the pre-snap → post-snap snap teleport
  // class on pass plays (CB press → release, walked-up safety → deep
  // rotation) where the coverage-adjusted spot is 5-9 yards off the
  // formation slot.
  // Call AFTER each def.map() with the rendered array. Mutates the
  // formation slots in place; idempotent.
  function _syncDefRendered(rendered) {
    if (!rendered || !formation || !formation.defense) return;
    for (let i = 0; i < rendered.length; i++) {
      const r = rendered[i];
      const fd = formation.defense[i];
      if (!r || !fd) continue;
      if (typeof r.x !== "number" || typeof r.y !== "number") continue;
      fd._lastRenderedX = r.x;
      fd._lastRenderedY = r.y;
      if (typeof SimPlayer !== "undefined") {
        if (!fd._sim) {
          fd._sim = new SimPlayer(r.x, r.y, {
            maxSpeed: SIM_DEFAULTS.MAX_SPEED,
            accel: SIM_DEFAULTS.ACCEL,
          });
        } else {
          fd._sim.x = r.x; fd._sim.y = r.y;
        }
      }
    }
  }
  // Action duration scales with yardage. Derived from real-football math
  // so plays don't "stop early": distance / cruise-speed + ragdoll beat,
  // floored at a real minimum action time. Real NFL snap-to-whistle is
  // 3-7s for typical plays, 8-12s for breakaways.
  //   distance time = yds / 12 yd/s (= NFL top sustained speed)
  //   + 1000ms ragdoll
  //   floored at 2200ms so even a 2-yard stuff has visible action
  //   capped at 11500ms for full-field plays
  //   2yd → 2200ms,  5yd → 2200ms,  10yd → 2200ms (floor binds),
  //   20yd → 2667ms,  40yd → 4333ms,  60yd → 6000ms,  80yd → 7667ms,
  //   100yd → 9333ms (under the cap)
  function scaledDuration(yds) {
    // ~100ms per yard at 10 yps (NFL elite top speed). Was 12 yps
    // (8.3 ms/yd) which left the cruise phase running at ~13.3 yps
    // (12 yps avg / 0.78 cruise fraction × 0.97 cruise distance) =
    // visibly faster than any human can sprint on long plays.
    // 10 yps matches Tyreek Hill / Sauce Gardner — the actual ceiling.
    const distTimeMs = Math.abs(yds || 0) / 10 * 1000;
    return clamp(distTimeMs + 700, 1200, 13000);
  }
  // _stPlayTiming / _stPlayDuration live at module scope — see top of file.
  // Pre-snap timing — ~3 seconds of huddle break, line set, audible, "HUT HUT"
  // before the center snaps. Audibles add an extra ~600 ms.
  const PRE_MS = isAudible ? 2800 : 2200;
  // Realistic run pacing: handoff mesh → read the hole → burst → sustained → tackle.
  // Replaces the old eased-cubic linear blend that made the RB shoot to the end zone
  // in the first 30% of the play. Now the carrier hangs near the LOS for the early
  // mesh/read frames before exploding through the hole.
  //
  // cruiseEnd was a fixed 0.78, so 22% of action time was "ragdoll" wait at the
  // tackle spot. Fine at short durations (~300ms). After bumping scaledDuration
  // for long plays, 22% became 2+ seconds of the carrier standing still waiting
  // to be tackled — "teleport then wait" feel. Now adaptive: cap ragdoll
  // wall-time at ~1000ms by pushing cruiseEnd up on big plays.
  function runPacing(runT, actionMs) {
    // Real RBs hit top speed within 1-2 yards of the handoff, then
    // sustain. The old curve had a long mesh+read phase (22% of time
    // covering only 14% of yards = 0.6× speed) followed by a cruise
    // (63% of time covering 86% of yards = 1.37× speed) — RB visibly
    // sprinted ULTRA-FAST in the cruise to compensate for the slow
    // start. User: "lets make normal speed throughout."
    //
    // New curve: brief acceleration ramp (5% of time = ~3% of yards
    // = real handoff burst), then LINEAR cruise to 100%. Constant
    // speed throughout the cruise.
    // Accel phase is 15% time / 10% distance — RB visibly ramps up
    // over the first ~3 yards instead of teleporting to top speed.
    // Cruise minimum is 0.88 (was 0.78). Old curve compressed cruise
    // into 73% of time covering 97% distance = 1.33× the average
    // speed — that's where "first part of run is super quick" came
    // from. New ratio: 73% time / 90% distance = 1.23× avg, with
    // scaledDuration already conservative at 10 yps.
    const accelEnd = 0.15;
    const accelDist = 0.10;
    const cruiseEnd = actionMs
      ? Math.max(0.88, Math.min(0.96, 1 - 500 / actionMs))
      : 0.88;
    if (runT < accelEnd) {
      const t = runT / accelEnd;
      return t * t * accelDist;   // ease-in for the burst
    }
    if (runT < cruiseEnd) {
      const t = (runT - accelEnd) / (cruiseEnd - accelEnd);
      return accelDist + (1.0 - accelDist) * t;   // linear cruise
    }
    return 1.0;                      // RB has stopped; tackle / ragdoll
  }

  // Pre-snap callouts: only AUDIBLE (when relevant) + the "BALL SNAPPED!"
  // flash at the moment of the snap. No SET/DOWN/HUT cadence text.
  function drawPreSnapCallouts(c, t, dur) {
    // Broadcast camera: route all banners/text to the upright overlay
    // canvas so they don't tilt with the field plane.
    if (typeof cameraMode !== "undefined" && cameraMode === "broadcast"
        && typeof _uprightCtx !== "undefined" && _uprightCtx) {
      c = _uprightCtx;
    }
    // Snap flash window — anchored to ~750ms wall time (not a fixed fraction
    // of action), so short plays still get a visible flash.
    const snapFlashWindow = Math.min(0.5, 750 / (dur || 2400));
    if (t > PRE && t < PRE + snapFlashWindow) {
      const flashT = (t - PRE) / snapFlashWindow;
      const fade   = flashT < 0.2 ? flashT / 0.2 : (1 - (flashT - 0.2) / 0.80);
      c.save();
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = `rgba(0,0,0,${0.62 * fade})`;
      c.fillRect(0, 24, FIELD.W, 72);
      // Big jagged banner — "HIKE!" reads more cinematic than "BALL SNAPPED!"
      c.fillStyle = `rgba(240, 204, 48, ${fade})`;
      c.font = "900 64px Impact, Arial Black, sans-serif";
      c.fillText("HIKE!", FIELD.W / 2, 60);
      // Thin outline for legibility against any field
      c.strokeStyle = `rgba(0,0,0,${0.85 * fade})`;
      c.lineWidth = 2;
      c.strokeText("HIKE!", FIELD.W / 2, 60);
      c.restore();
      return;
    }
    if (t > PRE) return;
    const tt = t / PRE;
    // ── PRE-SNAP UI — Madden-style formation + cadence overlay ────
    // Top-left: personnel + formation chip (offense)
    // Top-right: defensive package chip
    // Bottom-center: down + distance + yardline summary
    // Bottom: animated cadence text (READY → SET → HUT)
    // Faded out at the very end of pre-snap so the snap flash takes over.
    const uiFade = tt < 0.10 ? tt / 0.10 : tt > 0.88 ? (1 - tt) / 0.12 : 1;
    if (uiFade > 0.02) {
      c.save();
      // Personnel chip (top-left)
      const personnel = play.personnel || "BASE";
      const personnelLabel = personnel === "TRIPS"   ? "11 · TRIPS"
                          : personnel === "SPREAD"   ? "10 · SPREAD"
                          : personnel === "EMPTY"    ? "00 · EMPTY"
                          : personnel === "HEAVY"    ? "12 · HEAVY"
                          : personnel === "SMASH"    ? "21 · SMASH"
                          : personnel === "I_FORM"   ? "21 · I-FORM"
                          : personnel === "GOAL_LINE" ? "23 · GOAL LINE"
                          : `${personnel}`;
      const chipPadX = 14, chipPadY = 7;
      c.font = "900 18px sans-serif";
      const persW = c.measureText(personnelLabel).width + chipPadX * 2;
      c.globalAlpha = uiFade * 0.92;
      c.fillStyle = "rgba(0,0,0,0.78)";
      c.fillRect(16, 92, persW, 28);
      c.fillStyle = "#ffd54d";
      c.fillRect(16, 92, 4, 28);  // accent stripe
      c.fillStyle = "#fff";
      c.textAlign = "left";
      c.textBaseline = "middle";
      c.fillText(personnelLabel, 28, 106);
      // Defensive package chip (top-right)
      const defPkg = play.defPackage || "BASE_43";
      const defLabel = defPkg === "BASE_43" ? "4-3 BASE"
                     : defPkg === "BASE_34" ? "3-4 BASE"
                     : defPkg === "NICKEL"  ? "NICKEL"
                     : defPkg === "DIME"    ? "DIME"
                     : defPkg === "BLITZ_46" ? "46 BLITZ"
                     : defPkg === "PREVENT" ? "PREVENT"
                     : String(defPkg).replace(/_/g," ");
      const defW = c.measureText(defLabel).width + chipPadX * 2;
      c.fillStyle = "rgba(0,0,0,0.78)";
      c.fillRect(FIELD.W - defW - 16, 92, defW, 28);
      c.fillStyle = "#ff8a4a";
      c.fillRect(FIELD.W - 20, 92, 4, 28);
      c.fillStyle = "#fff";
      c.textAlign = "right";
      c.fillText(defLabel, FIELD.W - 28, 106);
      // Cadence text (bottom-center) — READY → SET → HUT timed across pre-snap
      const cadenceY = FIELD.H - 50;
      const cadenceLabel = tt < 0.35 ? "READY"
                        : tt < 0.65 ? "SET"
                        : tt < 0.92 ? "HUT"
                        : null;
      if (cadenceLabel) {
        c.textAlign = "center";
        c.textBaseline = "middle";
        // Pulse on each cadence beat
        const beatT = cadenceLabel === "READY" ? (tt - 0)    / 0.35
                    : cadenceLabel === "SET"   ? (tt - 0.35) / 0.30
                    :                            (tt - 0.65) / 0.27;
        const beatPulse = Math.min(1, Math.sin(beatT * Math.PI) * 1.2);
        const cadFade = uiFade * (0.5 + beatPulse * 0.5);
        c.globalAlpha = cadFade;
        c.font = `900 ${Math.round(28 + beatPulse * 6)}px Impact, Arial Black, sans-serif`;
        c.strokeStyle = "rgba(0,0,0,0.85)";
        c.lineWidth = 3;
        c.fillStyle = cadenceLabel === "HUT" ? "#ffd54d" : "#fff";
        c.strokeText(cadenceLabel, FIELD.W / 2, cadenceY);
        c.fillText(cadenceLabel, FIELD.W / 2, cadenceY);
      }
      c.restore();
    }
    // MOTION! callout — flashes while the receiver is actually jogging across
    if (hasMotion && tt >= 0.40 && tt < 0.78 && !isAudible) {
      c.save();
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = "rgba(0,0,0,0.45)";
      c.fillRect(0, 30, FIELD.W, 40);
      c.fillStyle = "#9bd0ff";
      c.font = "900 22px sans-serif";
      c.fillText("MOTION!", FIELD.W / 2, 50);
      c.restore();
    }
    // Audible callout — only shown when the QB is actually changing the play.
    if (isAudible && tt >= 0.30 && tt < 0.78) {
      c.save();
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = "rgba(0,0,0,0.55)";
      c.fillRect(0, 30, FIELD.W, 56);
      c.fillStyle = "#f0cc30";
      c.font = "900 28px sans-serif";
      c.fillText("AUDIBLE!", FIELD.W / 2, 50);
      c.fillStyle = "#fff";
      c.font = "bold 13px sans-serif";
      c.fillText(`${lastNameUpper(offStarters?.qb || "QB")} changes the play at the line`, FIELD.W / 2, 72);
      c.restore();
    }
  }

  if (play.kind === "run") {
    const yards = play.yards ?? 0;
    const isTD = (play.endYard ?? 0) >= 100;
    // First-down runs get an extra beat for the carrier to get up and
    // signal first down. Match definition used by the chyron card.
    const isFirstDownRun = !isTD && (play.down ?? 0) > 0 && yards >= (play.ytg ?? 0);
    // TD runs: push the endX 5 yards INTO the endzone so the carrier
    // runs THROUGH the goal line and celebrates in the EZ instead of
    // stopping at the white stripe.
    // TD: carry ~3yd INTO the end zone (crosses the plane, celebrates in the
    // EZ) — was 5yd, which on the ~6.7yd-deep rendered EZ put the scorer back
    // at the goalpost base, so he celebrated "standing on the post".
    const endX = yardToAbsX(play.endYard, poss) + (isTD ? dir * 3 * FIELD.PX_PER_YARD : 0);
    // Extra time at the end. Non-TDs get a tackle-ragdoll window; TDs
    // get a celebration window where the scorer raises arms + a banner
    // flashes. Big-play TDs get more celebration time — let it breathe.
    // First downs add ~700ms for the get-up + signal beat.
    const RUN_TACKLE_MS = isTD ? Math.round(1500 + Math.min(Math.abs(yards), 80) * 8)
                         : isFirstDownRun ? 1700
                         : 1000;
    // Size the run clock off the carrier's ACTUAL path length, not the
    // net yards gained. A run that bounces outside travels a longer
    // (diagonal) path; clocking it for straight yards made the carrier
    // cover the extra lateral distance in the same time = "really fast"
    // bounce runs. Measure the carrier waypoint arc length (in yards)
    // and pace off whichever is longer.
    let _runPathYds = Math.abs(yards);
    {
      const _ct = play.motion && play.motion.tracks && play.motion.tracks.carrier;
      if (_ct && _ct.waypoints && _ct.waypoints.length > 1) {
        let acc = 0;
        for (let _w = 1; _w < _ct.waypoints.length; _w++) {
          const a = _ct.waypoints[_w - 1], b = _ct.waypoints[_w];
          acc += Math.hypot((b.dxYd - a.dxYd), (b.dyYd - a.dyYd));
        }
        // Ignore the pre-snap formation→mesh leg (carrier isn't sprinting
        // yet) by not counting more than the gain + a sane lateral budget.
        if (acc > _runPathYds) _runPathYds = Math.min(acc, _runPathYds + 25);
      }
    }
    // Scrambles physically travel a ~5-yd dropback + recovery BEFORE the
    // forward scramble, none of which is in the net yards. Sizing the clock
    // off net yards alone crammed that travel into too little time — the
    // dropback ran at ~12 yps ("fast in the pocket"). Pace off the full path.
    if (play.isScramble) _runPathYds = Math.max(_runPathYds, Math.abs(yards) + 10);
    const actionDur = scaledDuration(_runPathYds) + RUN_TACKLE_MS;
    const dur = actionDur + PRE_MS;
    PRE = PRE_MS / dur;
    // Scramble pocket boundaries (fixed wall-time). Hoisted here so the
    // carrier MOTION (ball-X branch) and the carrier POSE (sprite branch)
    // switch phases at the SAME runT — otherwise the pose lagged the motion
    // (QB still in the cocked "throw" pose while his body was already
    // running forward) on short scrambles where _readFrac > the old 0.34.
    const _scrDropFrac = clamp(950 / actionDur, 0.10, 0.34);
    const _scrReadFrac = _scrDropFrac + clamp(330 / actionDur, 0.04, 0.14);
    // Play-side picks for run concepts — hoisted out of the RB block so
    // they're also available to the OL/FB renders. counterSide/stretchSide/
    // pitchSide use the same hash formulas as the existing RB code so the
    // sides agree.
    const _counterSide = ((play.startYard * 11) % 2) === 0 ? 1 : -1;
    const _stretchSide = ((play.startYard * 17) % 2) === 0 ? 1 : -1;
    const _pitchSide   = ((play.startYard * 13) % 2) === 0 ? 1 : -1;
    // Run-block engagement sim (built lazily on the first post-snap frame,
    // persists across render frames via this closure — like _passPro).
    let _runBlock = null;
    // TD-celebration "_followX/_followY" state for run-play teammates
    // lives on the formation.offense player objects themselves (per-play
    // state, reset each play via the formation rebuild). No closure
    // map needed — every non-RB player is a potential celebrator.
    return { duration: dur, kind: "run", render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);
      // BIG-RUN crowd reaction — fires at the break-through moment
      // (runT > 0.40) for 15+yd carries. Was firing at the snap from
      // _isBigPlay = "crowd cheers before the back hits the hole."
      // One-shot via play._bigRunFired.
      if (!play._bigRunFired && t > PRE && (play.yards ?? 0) >= 15) {
        const _runT = (t - PRE) / (1 - PRE);
        if (_runT >= 0.40) {
          play._bigRunFired = true;
          if (typeof GCAudio !== "undefined") {
            GCAudio.play("bigplay");
            GCAudio.crowd.swell(0.20, 1100, 1500);
          }
        }
      }
      const rb = { ...formation.rb };
      const qb = { ...formation.qb };
      const isScramble = !!play.isScramble;
      const isQBRun = !!play.isQBRun;
      const isQBCarry = isScramble || isQBRun;
      const runT = t < PRE ? 0 : (t - PRE) / (1 - PRE);
      // Pre-snap: ball sits at the CENTER (front of the OL).
      // Snap window (runT 0 - 0.04): ball travels back to the QB.
      // Post-snap: ball follows the carrier, sliding from backfield to LOS lane.
      const snapMotionRT = 0.04;
      const centerX = losX - dir * 2;
      let ballX, ballY;
      // SINGLE BALL ON RUNS — with sprites on, the carrier's carry/run sprite
      // has a ball tucked under the arm, so drawing the standalone ball at the
      // carrier (drawBall auto-shifts it into the hand) doubles it. Track when
      // the ball is genuinely LOOSE / in the air (pre-snap at the center, the
      // snap toss, a pitch in flight) — only then is the standalone the ball.
      // During possession the carry sprite is the single ball.
      let _ballLoose = false;
      // Speed-option dual-sprite tracking — when set, the rendering swap
      // below uses these to draw the QB and RB sprites at their parallel
      // sprint positions. Null otherwise (normal one-carrier rendering).
      let optQbX = null, optQbY = null;
      let optRbX = null, optRbY = null;
      if (t < PRE) {
        ballX = centerX;
        ballY = cy;
        _ballLoose = true;          // pre-snap: ball sits at the center
      } else if (runT < snapMotionRT) {
        // Snap from center back to QB
        const snapT = runT / snapMotionRT;
        const sm = snapT * snapT * (3 - 2 * snapT);
        ballX = centerX + (formation.qb.x - centerX) * sm;
        ballY = cy + (cy - cy) * sm;
        _ballLoose = true;          // snap toss in the air
      } else if (isScramble) {
        // SCRAMBLE: QB drops back, reads the field briefly, then tucks
        // and runs. The pocket (drop + read) is a FIXED wall-time window,
        // not a fixed FRACTION of the play — as a fraction, a short scramble
        // dropped back at ~12 yps ("fast in the pocket"). Fixed time keeps
        // the drop at a realistic ~5-6 yps no matter how far he runs.
        //   Phase A (drop ~0.95s): clean dropback to ~5 yds behind LOS
        //   Phase B (read ~0.33s): single lateral step, no wiggle
        //   Phase C (rest):        tuck and run to endX, paced (accel→cruise)
        const dropBackX = qb.x - dir * 5 * FIELD.PX_PER_YARD;
        const readSpotX = dropBackX + dir * 2;
        const _dropFrac = _scrDropFrac;
        const _readFrac = _scrReadFrac;
        if (runT < _dropFrac) {
          const dropT = runT / _dropFrac;
          const sm = dropT * dropT * (3 - 2 * dropT);
          ballX = qb.x + (dropBackX - qb.x) * sm;
          rb.x = ballX;
          rb.y = cy;
        } else if (runT < _readFrac) {
          // Single read step — one easeout sidestep, then settles
          const hesT = (runT - _dropFrac) / (_readFrac - _dropFrac);
          const sm = hesT * (2 - hesT);   // easeOut — peaks at the end
          ballX = dropBackX + dir * 2 * sm;   // small forward read step
          rb.x = ballX;
          rb.y = cy + dir * 3 * Math.sin(sm * Math.PI);  // gentle one-time sway
        } else {
          // Tuck and run — natural accel→cruise (runPacing) over the
          // remaining action time, instead of a linear constant-speed tween.
          const _runMs = Math.max(1, (1 - _readFrac) * actionDur);
          const _localT = (runT - _readFrac) / (1 - _readFrac);
          const prog = runPacing(_localT, _runMs);
          ballX = readSpotX + (endX - readSpotX) * prog;
          rb.x = ballX;
          rb.y = cy;
        }
      } else if (play.isSpeedOption) {
        // SPEED OPTION — QB and RB sprint parallel to the option side.
        // At the pitch read (PITCH_T), the QB either KEEPS or PITCHES to
        // the trailing RB. Both sprites are actively animated — the
        // dual-sprite positions are stored in optQbX/Y and optRbX/Y
        // which the rendering pass uses to draw both players.
        const optSide = ((play.startYard * 19) >>> 0) % 2 === 0 ? 1 : -1;
        const PITCH_T = 0.28;
        const PITCH_FLY = 0.06;
        const isPitchPlay = !!play.isPitch;
        // The edge target — the corner the option attacks toward
        const edgeX = qb.x + dir * 3 * FIELD.PX_PER_YARD;
        const edgeY = cy + optSide * 50;
        const rbTrailDx = -dir * 2 * FIELD.PX_PER_YARD;
        const rbTrailDy = optSide * 18;
        // QB sprint path
        let qbCurX, qbCurY;
        if (runT < PITCH_T) {
          const sm = runT / PITCH_T;
          const eased = sm * sm * (3 - 2 * sm);
          qbCurX = qb.x + (edgeX - qb.x) * eased;
          qbCurY = cy + (edgeY - cy) * eased;
        } else if (isPitchPlay) {
          // After pitching, the QB slows and drifts toward the sideline
          const after = (runT - PITCH_T) / (1 - PITCH_T);
          qbCurX = edgeX + dir * 6 * after;
          qbCurY = edgeY + optSide * 8 * after;
        } else {
          // Keep — QB continues forward toward endX
          const progress = runPacing(runT, actionDur);
          const after = (runT - PITCH_T) / (1 - PITCH_T);
          qbCurX = qb.x + (endX - qb.x) * progress;
          qbCurY = edgeY + (cy + optSide * 25 - edgeY) * Math.min(1, after);
        }
        // RB pitch-back path
        let rbCurX, rbCurY;
        if (runT < PITCH_T) {
          const sm = runT / PITCH_T;
          const eased = sm * sm * (3 - 2 * sm);
          const tx = edgeX + rbTrailDx;
          const ty = edgeY + rbTrailDy;
          rbCurX = formation.rb.x + (tx - formation.rb.x) * eased;
          rbCurY = formation.rb.y + (ty - formation.rb.y) * eased;
        } else if (isPitchPlay) {
          // RB takes the pitch and sprints upfield
          const rbStartX = edgeX + rbTrailDx;
          const rbStartY = edgeY + rbTrailDy;
          const after = (runT - PITCH_T) / (1 - PITCH_T);
          const easeOut = after * (2 - after);
          rbCurX = rbStartX + (endX - rbStartX) * easeOut;
          rbCurY = rbStartY + (cy + optSide * 20 - rbStartY) * easeOut;
        } else {
          // QB keeps — RB peels off the option lane as a decoy
          const after = (runT - PITCH_T) / (1 - PITCH_T);
          rbCurX = edgeX + rbTrailDx + dir * 8 * after;
          rbCurY = edgeY + rbTrailDy + optSide * 22 * after;
        }
        // Assign rb (carrier sprite slot) and stash the OTHER sprite's pos
        if (isPitchPlay) {
          rb.x = rbCurX; rb.y = rbCurY;          // RB is the carrier
          optQbX = qbCurX; optQbY = qbCurY;      // QB sprite separate
        } else {
          rb.x = qbCurX; rb.y = qbCurY;          // QB-as-carrier (isQBCarry override)
          optRbX = rbCurX; optRbY = rbCurY;      // RB sprite separate
        }
        // Ball position — with QB pre-pitch, in flight during pitch arc,
        // with RB post-pitch (or with QB throughout for keeps)
        if (runT < PITCH_T) {
          ballX = qbCurX; ballY = qbCurY;
        } else if (isPitchPlay && runT < PITCH_T + PITCH_FLY) {
          const flyT = (runT - PITCH_T) / PITCH_FLY;
          ballX = edgeX + (rbCurX - edgeX) * flyT;
          ballY = edgeY + (rbCurY - edgeY) * flyT - Math.sin(flyT * Math.PI) * 10;
          _ballLoose = true;        // option pitch in flight
        } else if (isPitchPlay) {
          ballX = rbCurX; ballY = rbCurY;
        } else {
          ballX = qbCurX; ballY = qbCurY;
        }
      } else if (isQBRun) {
        // DESIGNED QB RUN / OPTION KEEPER — the QB sprite (rendered at
        // rb.x/rb.y by the qbCarrier swap below) sprints from his stance
        // position straight to endX using the standard run-pacing curve.
        // The real RB is drawn separately in the backfield as a decoy.
        // Previously this was split into a 0-0.16 "option fake" lerp +
        // a 0.16-end runPacing lerp — the two phases didn't agree on
        // distance, so the carrier teleported BACKWARDS by ~2.5 yds at
        // the seam (rb.x jumped from qb.x+3yd to ~qb.x+0.3yd at runT=0.16).
        // A single curve from qb.x → endX eliminates the teleport, the
        // stall, and the ball-going-backwards-then-forward shudder.
        const progress = runPacing(runT, actionDur);
        rb.x = qb.x + (endX - qb.x) * progress;
        // Slight lateral sway during the mesh window (0-0.20) shows the
        // option look; QB then straightens out for the sprint.
        const meshSway = runT < 0.20
          ? Math.sin((runT / 0.20) * Math.PI) * 4
          : 0;
        rb.y = cy - dir * meshSway;
        ballX = rb.x;
      } else if (play.isReverse) {
        // REVERSE — RB sprints laterally to one sideline, then the lateral
        // handoff "reverses" the carrier across the field to the opposite side.
        // Visualized as a single carrier whose lateral direction flips at the
        // handoff moment, gaining yards toward endX in the back half.
        const reverseSide = ((play.startYard * 7) % 2) === 0 ? 1 : -1;   // top or bottom sideline
        const lateralMax = 90;   // pixels of lateral travel before the handoff
        if (runT < 0.18) {
          // Sprint laterally to one side, ~0 forward progress
          const p = runT / 0.18;
          rb.x = qb.x;
          rb.y = cy + reverseSide * p * lateralMax;
        } else if (runT < 0.30) {
          // Lateral handoff — carrier slows, then reverses direction
          const p = (runT - 0.18) / 0.12;
          rb.x = qb.x + Math.sin(p * Math.PI * 0.5) * 4;
          rb.y = cy + reverseSide * lateralMax;
        } else {
          // The "WR" now carries — sprints back across the field and forward to endX
          const p = (runT - 0.30) / 0.42;          // 0 → 1 over the rest of cruise
          const eased = Math.min(1, p);
          rb.x = qb.x + (endX - qb.x) * eased;
          // Lateral position swings from the start sideline back across to the other
          rb.y = cy + reverseSide * lateralMax * (1 - eased) + (-reverseSide) * lateralMax * 0.3 * eased;
        }
        ballX = rb.x;
      } else if (play.runType === "counter") {
        // COUNTER — RB takes a false step opposite the intended direction
        // (~0.10), then cuts BACK and follows the pulling guard's gap. Looks
        // like "step right, run left" misdirection.
        const counterSide = ((play.startYard * 11) % 2) === 0 ? 1 : -1;
        if (runT < 0.10) {
          // False step away from the play
          const p = runT / 0.10;
          rb.x = qb.x - dir * p * 8;
          rb.y = cy + 28 - counterSide * p * 14;
        } else if (runT < 0.22) {
          // Plant + cut back across
          const p = (runT - 0.10) / 0.12;
          rb.x = qb.x - dir * (8 - p * 6);
          rb.y = cy + 28 + counterSide * p * 18 - counterSide * 14;
        } else {
          // Burst through the gap toward endX, slight angle in counterSide direction
          const p = (runT - 0.22) / 0.50;
          const eased = Math.min(1, p);
          rb.x = qb.x + (endX - qb.x) * eased;
          rb.y = cy + 28 - counterSide * (1 - eased) * 4 + counterSide * eased * 10;
        }
        ballX = rb.x;
      } else if (play.runType === "stretch") {
        // STRETCH / OUTSIDE ZONE — RB attacks the edge laterally first, then
        // cuts upfield when a gap opens. Sustained sideways flow along the LOS.
        const stretchSide = ((play.startYard * 17) % 2) === 0 ? 1 : -1;
        const lateralMax = 70;
        if (runT < 0.30) {
          // Pure lateral run along the LOS
          const p = runT / 0.30;
          rb.x = qb.x + dir * p * 1 * FIELD.PX_PER_YARD;
          rb.y = cy + 28 + stretchSide * p * lateralMax;
        } else {
          // Cut upfield — toward endX while maintaining the lateral offset
          const p = (runT - 0.30) / 0.42;
          const eased = Math.min(1, p);
          const lateralStart = cy + 28 + stretchSide * lateralMax;
          rb.x = qb.x + dir * FIELD.PX_PER_YARD + (endX - qb.x - dir * FIELD.PX_PER_YARD) * eased;
          rb.y = lateralStart + (cy + 28 + stretchSide * 30 - lateralStart) * eased;
        }
        ballX = rb.x;
      } else if (play.runType === "pitch") {
        // PITCH — QB tosses the ball laterally to the RB on the move, who
        // sprints to the edge.
        const pitchSide = ((play.startYard * 13) % 2) === 0 ? 1 : -1;
        const pitchTargetX = qb.x;
        const pitchTargetY = cy + 28 + pitchSide * 50;
        if (runT < 0.12) {
          // Ball in flight from QB to RB (lateral pitch)
          const p = runT / 0.12;
          ballX = qb.x + (pitchTargetX - qb.x) * p;
          // RB sprinting laterally to catch
          rb.x = qb.x;
          rb.y = cy + 28 + pitchSide * p * 50;
          // Ball Y interpolates from QB → catching RB along a small arc
          ballY = cy + (rb.y - cy) * p - Math.sin(p * Math.PI) * 8;
          _ballLoose = true;        // lateral pitch in flight
        } else if (runT < 0.20) {
          // RB has the ball, still moving laterally before turning upfield
          const p = (runT - 0.12) / 0.08;
          rb.x = qb.x + dir * p * 4;
          rb.y = pitchTargetY + pitchSide * p * 8;
          ballX = rb.x;
        } else {
          // Burst toward endX along the sideline
          const p = (runT - 0.20) / 0.52;
          const eased = Math.min(1, p);
          rb.x = qb.x + dir * 4 + (endX - qb.x - dir * 4) * eased;
          rb.y = pitchTargetY + pitchSide * 8 + (cy + 28 + pitchSide * 60 - pitchTargetY - pitchSide * 8) * eased;
          ballX = rb.x;
        }
      } else {
        // PATH B Phase 2 — read the engine-emitted carrier track when
        // present. Animation just interpolates between waypoints; no
        // per-frame runPacing math here. Falls back to legacy pacing
        // when motion data isn't present (older plays, non-standard).
        const motionTrack = play.motion && play.motion.tracks && play.motion.tracks.carrier;
        const sample = motionTrack && typeof MotionPlayback !== "undefined"
          ? MotionPlayback.sampleTrack(motionTrack, runT)
          : null;
        if (sample) {
          rb.x = losX + dir * sample.dxYd * FIELD.PX_PER_YARD;
          rb.y = cy + sample.dyYd * FIELD.PX_PER_YARD;
          ballX = rb.x;
        } else {
          // Legacy path — runPacing inference.
          const progress = runPacing(runT, actionDur);
          ballX = qb.x + (endX - qb.x) * progress;
          rb.x = qb.x + (endX - qb.x) * progress;
          rb.y = cy + (1 - progress) * 18;
        }
      }
      // ── BALL FOLLOWS CARRIER ──
      // If a variant didn't explicitly set ballY (it sets ballX = rb.x but
      // forgets ballY), default it to the carrier's y. Previously ballY
      // was initialized to cy + (1 - runT) * 18, which decoupled the ball
      // from the carrier on plays where rb.y diverged from that formula
      // (stretch, pitch, reverse, etc.) — visually the ball ended up on
      // the ground while the carrier ran somewhere else.
      if (ballY === undefined) ballY = rb.y;
      // (rbLateral added after pose decision below)
      // Carrier pose & move signature — drives juke/spin/hurdle/stiff/truck visibly.
      // Each move triggers a lateral side-step (or shoulder lower) AND makes the
      // nearest defender briefly overshoot, so the play LOOKS like a broken tackle.
      // Pose by phase: idle (pre-snap) → reach (mesh, taking the ball)
      // → run (read, looking for the hole) → carry (cruise / sustained)
      // SCRAMBLE has its own pose timeline: throw-look → throw-look → carry
      // OPTION KEEPER: reach → carry
      let rbPose;
      if (t < PRE) {
        rbPose = "idle";
      } else if (isScramble) {
        // QB breaks pocket, ball in 2 hands at chest. Was "carry"
        // (RB ball-tucked-under-arm), wrong silhouette for a QB.
        // Switch to the sprint pose at _scrReadFrac — the SAME instant the
        // motion leaves the pocket — so the pose can't lag the body (was a
        // hardcoded 0.34 that no longer matched the fixed-time pocket).
        if (runT < _scrReadFrac) rbPose = "throw";        // pocket: looking downfield, ball cocked
        else                     rbPose = "qb_scramble";  // 2-handed sprint
      } else if (isQBRun) {
        // Designed QB keeper. Use qb_scramble sprite (ball at chest)
        // instead of carry (RB tuck).
        if (runT < 0.16)        rbPose = "handoff";      // arms at belly, not over head
        else                     rbPose = "qb_scramble";
      } else {
        if (runT < 0.14)        rbPose = "handoff";      // arms at belly, not over head
        else if (runT < 0.30)   rbPose = "run";
        else                     rbPose = "churn";       // high-knee carry through cruise

      }
      // RB stride frequency — scale with the carrier's cruise speed so
      // foot strikes match world motion. Was a fixed 3Hz wall-clock
      // cycle (performance.now() / 333), which made long carries look
      // like ice-skating: legs cycled at jogging pace while the body
      // moved at sprint speed = "too fast" / sliding. cruiseYPS is
      // estimated from yards / actionDur, with a 1.22 fudge for the
      // runPacing cruise-vs-average ratio. Natural stride ~2yd, so
      // strideHz = yps / 2. Clamped to 2.0..5.5 Hz.
      const _runCruiseYPS = Math.max(0.1, Math.abs(yards)) / (actionDur / 1000) * 1.22;
      const _runStrideHz  = clamp(_runCruiseYPS / 2, 2.0, 5.5);
      let rbT = (t < 0.95 ? ((t * (dur / 1000)) * _runStrideHz) % 1 : 0);
      let rbLateral = 0;
      let dodgeIdx = -1;
      let moveCallout = null;
      const rbArch = formation.rb.archetype;
      // Use two independent seeds so we can roll two moves per play
      const seedA = ((play.startYard * 17 + (play.yards || 0) * 53) >>> 0) % 100 / 100;
      const seedB = ((play.startYard * 41 + (play.yards || 0) * 29 + 7) >>> 0) % 100 / 100;
      // PATH B: tackler decision comes from play.motion (engine-owned).
      // Falls back to per-play hash if engine didn't emit motion data
      // (older plays or non-run kinds that don't populate it yet).
      const tacklerHash = (((play.startYard * 31) ^ ((play.yards||0) * 17) ^ ((play.time||0) * 13)) >>> 0);
      const numPursuers = Math.max(1, formation.defense.length - 4);
      // Map play.motion.tacklerRole → defender index in formation.defense.
      // Used only when the engine didn't emit a specific tacklerSlot (legacy
      // plays); falls back to a hash pick which can collide with the wrong
      // CB and warp across the field. Prefer _idxForSlot below.
      function _idxForTacklerRole(role) {
        if (role === "MLB") return idxLBmid;
        if (role === "OLB") return (tacklerHash & 1) ? idxLB1 : idxLB3;
        if (role === "SS")  return idxS1;
        if (role === "FS")  return idxS2;
        if (role === "CB")  return (tacklerHash & 1) ? idxCB1 : idxCB2;
        return null;
      }
      // Direct slot → index map. Engine already knows which specific slot
      // it credited the tackle to; reading that here avoids the role
      // collision that hash-picks the wrong CB / OLB.
      function _idxForSlot(slot) {
        if (slot === "cb1") return idxCB1;
        if (slot === "cb2") return idxCB2;
        if (slot === "nb")  return idxNB;
        if (slot === "fs")  return idxS1;
        if (slot === "ss")  return idxS2;
        if (slot === "lb1") return idxLB1;
        if (slot === "lb2") return idxLBmid;
        if (slot === "lb3") return idxLB3;
        return null;
      }
      const _motionRole = (play.motion && play.motion.tacklerRole) || null;
      const _motionSlot = (play.motion && play.motion.tacklerSlot) || null;
      const _slotIdx = _motionSlot ? _idxForSlot(_motionSlot) : null;
      const _motionIdx = _slotIdx ?? (_motionRole ? _idxForTacklerRole(_motionRole) : null);
      const primaryTacklerIdx = (_motionIdx != null && _motionIdx < formation.defense.length)
        ? _motionIdx
        : 4 + (tacklerHash % numPursuers);
      // ── TRACK-START ALIGNMENT (Stage 1, REFACTOR_POSITION_CONTRACT.md) ──
      // Single source of truth for "where this player starts pre-snap" is
      // the renderer's formation slot. The engine's motion track owns the
      // trajectory SHAPE from there. Without this enforcement, engine
      // tracks (authored independently in play-engine.js) disagree with
      // formation at t=0 — e.g. the fs track says cy=0 deep middle but
      // formation.s1 sits at cy-56 in 2-high; the cb-tackler track says
      // play-side dyYd=+18 but formation.cb1 is at the top numbers. At
      // the snap (t=PRE) the sampler jumps from formation to track t=0
      // and the sprite teleports across the field (detector measured up
      // to 34yd in a single frame). Rewrite the t=0 waypoint in place to
      // match formation; the rest of the track interpolates from there.
      // Idempotent across frames (sets the same value every call).
      const _toYd = (x, y) => ({
        dxYd: (x - losX) * dir / FIELD.PX_PER_YARD,
        dyYd: (y - cy) / FIELD.PX_PER_YARD,
      });
      const _alignT0 = (track, slot) => {
        if (!track || !slot || !track.waypoints || !track.waypoints.length) return;
        const w0 = track.waypoints[0];
        if (!w0 || w0.t !== 0) return;
        const { dxYd, dyYd } = _toYd(slot.x, slot.y);
        w0.dxYd = dxYd;
        w0.dyYd = dyYd;
      };
      const _tracks = play.motion && play.motion.tracks;
      if (_tracks) {
        _alignT0(_tracks.carrier, isQBRun ? formation.qb : formation.rb);
        if (primaryTacklerIdx != null && formation.defense[primaryTacklerIdx])
          _alignT0(_tracks.tackler, formation.defense[primaryTacklerIdx]);
        _alignT0(_tracks.fs,  formation.defense[idxS1]);
        _alignT0(_tracks.ss,  formation.defense[idxS2]);
        _alignT0(_tracks.cb1, formation.defense[idxCB1]);
        _alignT0(_tracks.cb2, formation.defense[idxCB2]);
      }
      // Tackler-arrives-via-dive odds. Mechanism overrides the random
      // pick: "low" tackles (cut/shoestring) are ALWAYS dive; "behind"
      // tackles (chase-down) are NEVER dive; others use the per-play
      // hash for 30% dive variety.
      const _mechHint = play.mechanism || "head-on";
      const primaryTacklerDives = _mechHint === "low"    ? true
                                : _mechHint === "behind" ? false
                                : ((tacklerHash >>> 6) % 100) < 30;
      // Most plays display a move; broken tackles ALWAYS show one (forces probabilities to 1)
      const bt = play.brokenTackles || 0;
      const eluciveProb = bt > 0 ? 1.0 : (rbArch === "ELUSIVE" ? 0.95 : rbArch === "SPEED" ? 0.65 : 0.55);
      const powerProb   = bt > 0 ? 1.0 : (rbArch === "POWER"   ? 0.90 : rbArch === "WORKHORSE" ? 0.55 : 0.35);
      const inWindow = (a, b) => runT > a && runT < b;
      // PATH B — single source of truth for tackle timing. Engine publishes
      // play.motion.tackleT (0..1); the carrier track and primary-tackler
      // track BOTH converge to the tackle spot at this exact value. Every
      // ragdoll / hit-pose gate below references TACKLE_T so the moment of
      // impact stays synchronized across all five touch points (carrier
      // path endpoint, tackler path endpoint, carrier pose flip, tackler
      // pose flip, ragdoll impulse). 0.78 fallback preserves legacy
      // behavior if motion isn't emitted.
      const TACKLE_T = (play.motion && typeof play.motion.tackleT === "number")
        ? play.motion.tackleT
        : 0.78;
      const POST_TACKLE = Math.max(0.01, 1 - TACKLE_T);
      // Tackle window — ragdoll starts at runT = TACKLE_T (~22% of action
      // devoted to tackle + ragdoll roll-around) so the play doesn't end
      // the instant the carrier is touched.
      // First-down sequence: TACKLE_T..0.85 ragdoll (handled by the next
      // branch below, since !isTD covers FD too), 0.85-0.90 stand up,
      // 0.90+ signal first down. TDs use 0.88+ for celebrate (handled
      // further down). For first downs we INTERRUPT the ragdoll branch
      // at 0.85 by branching here first.
      if (isFirstDownRun && runT > 0.85 && runT < 0.90) {
        rbPose = "stance";   // "back to feet" — abrupt transition for now
        rbT = 0;
      } else if (isFirstDownRun && runT >= 0.90) {
        rbPose = "celebrate";
        rbT = Math.min(1, (runT - 0.90) / 0.10);
        rb.celebStyle = "first_down";
      } else if (runT > TACKLE_T && yards < 90 && !isTD) {
        // Carrier ragdoll. The impact FEEL comes from the player's own
        // motion (launch + spin) plus brief time dilation, NOT dust/
        // shake noise. force scales the launch velocity and a slow-mo
        // window so the impact frame is held briefly. nowMs uses
        // performance.now() (not t*dur) so the ragdoll integrator
        // keeps advancing past t=1.0 during the post-action hold —
        // otherwise the carrier freezes mid-fall when the play timer
        // clamps.
        const nowMs = performance.now();
        if (!formation.rb._ragdoll) {
          if (typeof window !== "undefined" && window.GC_DEBUG_TACKLE) {
            const _pt = formation.defense[primaryTacklerIdx];
            const _ptx = (_pt && _pt._sim) ? _pt._sim.x : (_pt ? _pt.x : NaN);
            const _pty = (_pt && _pt._sim) ? _pt._sim.y : (_pt ? _pt.y : NaN);
            console.log("[GC_TACKLE]", {
              tackleT: +TACKLE_T.toFixed(3),
              runT: +runT.toFixed(3),
              role: _motionRole,
              idx: primaryTacklerIdx,
              rb: { x: +rb.x.toFixed(1), y: +rb.y.toFixed(1) },
              tackler: { x: +(+_ptx).toFixed(1), y: +(+_pty).toFixed(1) },
              distPx: +Math.hypot(rb.x - _ptx, rb.y - _pty).toFixed(1),
              yards: play.yards, mech: play.mechanism,
              force: play.force ?? null,
            });
          }
          const force = play.force || 0;
          const mech = play.mechanism || "head-on";
          // Mechanism drives the FALL SHAPE — high/low/side/behind each
          // produce a distinct ragdoll trajectory.
          //   head-on / high: carrier topples BACKWARD (-dir)
          //   low: feet stop, upper body continues FORWARD (+dir), spinout
          //   side: lateral tumble (perpendicular jolt)
          //   behind: shoved FORWARD (+dir), low spin, face-first fall
          const sideSign = ((play.startYard * 23) >>> 0) & 1 ? 1 : -1;
          let hvx, hvy, fbase, spinBoost;
          if (mech === "low") {
            hvx =  dir * 0.4;          // upper body forward
            hvy = sideSign * 0.3;
            fbase = 70 + Math.min(80, force * 5);
            spinBoost = 1.8;           // tumble forward (high spin)
          } else if (mech === "side") {
            hvx = -dir * 0.25;
            hvy = sideSign * 1.0;      // mostly lateral
            fbase = 55 + Math.min(75, force * 5);
            spinBoost = 1.2;
          } else if (mech === "behind") {
            hvx =  dir * 0.8;          // shoved forward
            hvy = sideSign * 0.2;
            fbase = 40 + Math.min(70, force * 5);
            spinBoost = 0.5;           // less spin, more belly-flop
          } else if (mech === "high") {
            hvx = -dir * 0.9;          // toppled back hard
            hvy = sideSign * 0.2;
            fbase = 60 + Math.min(95, force * 6);
            spinBoost = 1.0;
          } else {
            // head-on / default — backward shove with light angle
            hvx = -dir;
            hvy = sideSign * 0.4;
            fbase = 50 + Math.min(90, force * 6);
            spinBoost = 0.9;
          }
          initRagdoll(formation.rb, hvx, hvy, fbase, nowMs,
                      (play.startYard * 11 + (play.yards||0)) >>> 0);
          // Apply mechanism-specific spin boost on top of the base spin
          if (formation.rb._ragdoll) {
            formation.rb._ragdoll.angVel *= spinBoost;
          }
          // Cinematic slow-mo at impact — duration & depth scale with
          // force. Bigger hits get held longer / slower. Read by tick().
          if (typeof animState !== "undefined" && animState) {
            const slowMs = 100 + Math.min(220, force * 22);
            animState.slowMoUntil = performance.now() + slowMs;
            animState.slowMoMul = Math.max(0.20, 0.50 - force * 0.025);
          }
        }
        stepRagdoll(formation.rb, nowMs, 8);
        rbPose = "ragdoll";
      } else if (runT > 0.88 && isTD) {
        // TD CELEBRATION — only AFTER the carrier has visibly crossed
        // the plane. Old threshold 0.72 had the RB switching to a
        // stationary celebrate pose before he'd even crossed the goal
        // line, which read as "play cuts off the instant he enters
        // the endzone". endX is goalLine + 5yd, so by runT 0.88 the
        // carrier is well past the goal line.
        rbPose = "celebrate";
        rbT = Math.min(1, (runT - 0.88) / 0.12);
      }
      // EARLY CRUISE: ELUSIVE → juke; POWER → truck stick at/just past the line.
      // Moves happen during cruise (0.22 - 0.72); the carrier then runs the
      // final ~6% of action time straight before the tackle fires at TACKLE_T.
      // Windows widened (was 0.16/0.14/0.15 → 0.22/0.20/0.18 of action time)
      // so each move takes ~0.5-0.8s in absolute time instead of 0.25-0.35s,
      // which read as a teleport-cut.
      else if (yards >= 2 && inWindow(0.22, 0.44)) {
        const wantsJuke = rbArch === "ELUSIVE" || rbArch === "RECEIVING" || (rbArch !== "POWER" && seedA < 0.55);
        const wantsTruck = rbArch === "POWER" && seedA < powerProb;
        if (wantsTruck) {
          rbPose = "truck";
          moveCallout = "TRUCK!";
          dodgeIdx = 4;
        } else if (wantsJuke && seedA < eluciveProb) {
          rbPose = "juke";
          const cutDir = seedA < eluciveProb / 2 ? 1 : -1;
          // Window 0.22-0.44 (22%). Anticipation at 0.22-0.27; cut 0.27-0.44.
          const within = (runT - 0.27) / 0.17;
          const anticT = Math.max(0, Math.min(1, (runT - 0.22) / 0.05));
          const cutT   = Math.max(0, within);
          rbLateral = (-cutDir * anticT * 6 * (1 - cutT)) +
                      (cutDir * Math.sin(within * Math.PI) * 38);
          dodgeIdx = 4;
          moveCallout = "JUKE!";
        }
      }
      // MID CRUISE: spin (ELUSIVE/WORKHORSE) on plays ≥ 5 yds. Window widened.
      else if (yards >= 5 && inWindow(0.44, 0.62) && (rbArch === "ELUSIVE" || rbArch === "WORKHORSE" || seedB < 0.4)) {
        rbPose = "spin";
        rbT = (runT - 0.44) / 0.18;
        const cutDir = seedB < 0.5 ? 1 : -1;
        const within = (runT - 0.44) / 0.18;
        rbLateral = cutDir * Math.sin(within * Math.PI) * 28;
        dodgeIdx = 6;
        moveCallout = "SPIN!";
      }
      // LATE CRUISE: stiff arm / hurdle on plays ≥ 6 yds. Window widened
      // (was 0.55-0.70 = 15% → 0.55-0.72 = 17%).
      else if (yards >= 6 && inWindow(0.55, 0.72)) {
        if ((rbArch === "POWER" || rbArch === "WORKHORSE") && seedB > 0.55) {
          rbPose = "hurdle";
          dodgeIdx = 9;
          moveCallout = "HURDLE!";
        } else {
          rbPose = "stiff";
          dodgeIdx = 7;
          moveCallout = "STIFF ARM!";
        }
      }
      rb.pose = rbPose; rb.t = rbT; rb.facing = dir;
      // Expose ragdoll state to the renderer via style. The spread copy
      // of formation.rb at the top of the frame may not have captured
      // _ragdoll if init happened later this frame, so re-attach.
      if (formation.rb._ragdoll) rb._ragdoll = formation.rb._ragdoll;
      rb.y += rbLateral;
      ballY += rbLateral;
      // Determine which DL "wins" his rep — for big runs, the OL is winning at every gap
      // (we ALSO need at least one DL to break free if the run is short / for losses)
      const dlBreaksFree = yards < 2 ? 1 : 0;  // on stuffs, one rusher penetrates
      // ── RUN-BLOCK ENGAGEMENT SIM ──
      // Pair each ENGAGED DL with its nearest OL; a winning block SEALS the
      // DL out of the carrier's LANE (the corridor from the LOS center to the
      // hole), opening the path the back hits. The penetrator (dlBreaksFree)
      // is left OUT — it beats its block and pursues via the DL logic below.
      // Runs on inside/power AND the gap/zone concepts (counter, stretch,
      // pitch): the lane corridor + the away-from-hole seal naturally produce
      // the A-gap split (inside) and the play-side wash/reach (stretch/pitch).
      // On a COUNTER the pulling guard is excluded so he pulls via his own
      // track. Still scripted (special carrier mechanics, not a straight
      // trench): scramble, QB keep, speed option, reverse.
      const _isTrenchRun = !play.isScramble && !play.isQBRun
        && !play.isSpeedOption && !play.isReverse;
      if (t > PRE && _runBlock == null && _isTrenchRun && typeof RunBlockSim !== "undefined") {
        const _PX = FIELD.PX_PER_YARD;
        const _holeY = cy + ((play.motion && play.motion.gapYd) || 0) * _PX;
        _runBlock = new RunBlockSim({ dir, losX, holeY: _holeY });
        const _rbOLs = formation.offense.filter(o => o.role === "OL");
        const _rbDLs = formation.defense.filter(x => x.role === "DL");
        // Counter: the backside guard PULLS. The engine's pull is on OL slot
        // (2 - sign(gapYd)) by Y rank (matches _buildRunBlockerTracks). Reserve
        // him out of the sim so he runs his pull track instead of locking a DL.
        let _pullerOL = null;
        if (play.runType === "counter") {
          const _engCS = Math.sign((play.motion && play.motion.gapYd) || 0) || 1;
          const _pr = Math.max(0, Math.min(4, 2 - _engCS));
          _pullerOL = [..._rbOLs].sort((a, b) => a.y - b.y)[_pr];
        }
        // Lane corridor: LOS center → hole, ±1.6yd cushion. A DL inside it is
        // in the carrier's path (gets sealed); outside it just holds. Inside
        // run: holeY≈cy → corridor = the A-gaps. Stretch/pitch: holeY wide →
        // corridor = the whole play side, so those DL get washed away from it.
        const _loY = Math.min(cy, _holeY) - 1.6 * _PX;
        const _hiY = Math.max(cy, _holeY) + 1.6 * _PX;
        const _usedOL = new Set();
        if (_pullerOL) _usedOL.add(_pullerOL);   // puller pulls via its track, not the sim
        for (let di = 0; di < _rbDLs.length; di++) {
          if (di === dlBreaksFree) continue;   // penetrator pursues (not in the sim)
          const dl = _rbDLs[di];
          let best = null, bestDist = Infinity;
          for (const ol of _rbOLs) {
            if (_usedOL.has(ol)) continue;
            const dist = Math.abs(ol.y - dl.y);
            if (dist < bestDist) { bestDist = dist; best = ol; }
          }
          if (!best) continue;
          _usedOL.add(best);
          const _inLane = dl.y >= _loY && dl.y <= _hiY;
          const win = _inLane ? 0.7 : 0.3;              // in-lane DL sealed, others hold
          const sealSign = (dl.y >= _holeY ? 1 : -1);   // shove the DL away from the hole
          _runBlock.addPair(best, dl, {
            contactX: dl.x - dir * 12,   // OL fires to a body-depth in front of the DL
            contactY: dl.y,
            win, sealSign,
          });
        }
      }
      if (_runBlock) _runBlock.step(performance.now());
      // PILE SIZE CAP — limit how many defenders flip to the tackled/
      // ragdoll pose. Was "every defender within 28px gets the pose" so
      // when 4-5 defenders happened to be close they ALL piled on,
      // looking like a bomb. Real NFL tackles: 1 primary + 1-2 piling
      // on. Compute the 3 closest defenders to the carrier; only they
      // can be in the pile. Others stay running.
      const PILE_CAP = 3;
      const _defDistArr = formation.defense.map((d, i) => ({
        i, dist: Math.hypot((d._sim?.x ?? d.x) - rb.x, (d._sim?.y ?? d.y) - rb.y),
      }));
      _defDistArr.sort((a, b) => a.dist - b.dist);
      const pileIdxSet = new Set(_defDistArr.slice(0, PILE_CAP).map(o => o.i));
      // Defense: DL get locked up at LOS (engaged with OL); LBs/DBs pursue
      const def = formation.defense.map((d, i) => {
        const dd = { ...d };
        if (t < PRE) {
          const sh = defShiftXY(i, t);
          dd.x = d.x + sh.dx;
          dd.y = d.y + sh.dy;
          dd.pose = isDefShifting(i, t) ? "run" : (isDefPointer(i) ? "point" : "stance");
          dd.t = (t < 0.95 ? ((performance.now() / 333)) % 1 : 0);
          dd.facing = -dir;
          return dd;
        }
        const tt = runT;
        // ── SPEED OPTION DEFENSE ──────────────────────────────────────
        // The playside edge defender and playside safety divide the QB
        // and pitch responsibilities. Whichever the EDGE plays (QB or
        // pitch), the SAFETY plays the other. This forces a real read
        // for the QB — the carrier with the correct read wins.
        if (play.isSpeedOption && play.optionRead) {
          const opt = play.optionRead;
          const isPlaysideEdge = (opt.optSide === 1 && i === 3) || (opt.optSide === -1 && i === 0);
          const isPlaysideSafety = (opt.optSide === 1 && i === idxS2) || (opt.optSide === -1 && i === idxS1);
          if (isPlaysideEdge || isPlaysideSafety) {
            // Locate the two ball-paths. For a keep: rb.x/y is the QB,
            // optRbX/Y is the trailing pitch back. For a pitch: rb.x/y
            // is the RB, optQbX/Y is the QB sprite.
            const qbPosX = play.isPitch ? (optQbX ?? rb.x) : rb.x;
            const qbPosY = play.isPitch ? (optQbY ?? rb.y) : rb.y;
            const rbPosX = play.isPitch ? rb.x : (optRbX ?? rb.x);
            const rbPosY = play.isPitch ? rb.y : (optRbY ?? rb.y);
            // Edge gets QB if defAttacksQb; safety gets the OPPOSITE.
            const attacksQb = opt.defAttacksQb ? isPlaysideEdge : isPlaysideSafety;
            // Edge defender attacking QB crashes hard; defender on the
            // pitch keeps outside leverage (slower, contain track).
            const tx = attacksQb ? qbPosX + dir * 2 : rbPosX - dir * 2;
            const ty = attacksQb ? qbPosY            : rbPosY + opt.optSide * 4;
            const factor = attacksQb ? 1.05 : 0.78;
            const elapsedMs = Math.max(0, (t - PRE) * dur);
            const np = elapsedMs > 0 ? pursue(d, tx, ty, elapsedMs, factor) : { x: d.x, y: d.y, moved: false };
            dd.x = np.x; dd.y = np.y;
            dd.pose = "run";
            dd.t = np.moved ? (t < 0.95 ? ((performance.now() / 333) + i * 0.13) % 1 : 0) : 0;
            dd.facing = -dir;
            // Tackle at the end if right on the carrier (the real ball-carrier
            // is rb.x/y by convention here regardless of pitch/keep).
            if (runT > TACKLE_T && Math.hypot(rb.x - dd.x, rb.y - dd.y) < 26) {
              dd.pose = "tackled";
              dd.t = Math.min(1, (runT - TACKLE_T) / POST_TACKLE);
            }
            return dd;
          }
        }
        if (i < 4) {
          // RUN-BLOCK SIM — if this DL is in an engaged (non-shed) rep, the
          // sim owns his position: he's locked up with an OL, getting driven
          // / sealed. The penetrator isn't in the sim (it falls through to
          // the pursuit below), and a shed rep releases him likewise.
          const _rbPair = _runBlock && _runBlock.pairFor(d);
          if (_rbPair && !_rbPair.shed) {
            dd.x = _rbPair.dlX; dd.y = _rbPair.dlY;
            dd.pose = "engage";
            dd.t = tt;
            dd.facing = -dir;
            dd.archetype = _archForLineman(d, "DL");
            return dd;
          }
          // PATH B Phase 9 — engine-emitted DL anchor track wins when
          // present. DL holds the LOS with a slight push-back; engine
          // varies by run type + interior position. Non-tackler DL.
          const _dlTrack = play.motion?.tracks?.[`dl${i}`];
          const wobble = Math.sin(tt * Math.PI * 4 + d.y * 0.09) * 1.3;
          const _isPursuingDl = (i === dlBreaksFree && tt > 0.3);
          if (_isPursuingDl) {
            // This DL penetrates and chases the carrier (speed-capped)
            const elapsedMs = Math.max(0, (t - (PRE + (1 - PRE) * 0.3)) * dur);
            const np = pursue(d, rb.x + dir * 2, rb.y, elapsedMs, 0.85);
            dd.x = np.x; dd.y = np.y;
            dd.pose = "run";
            dd.t = np.moved ? (t < 0.95 ? ((performance.now() / 333)) % 1 : 0) : 0;
          } else if (_dlTrack && typeof MotionPlayback !== "undefined") {
            const sample = MotionPlayback.sampleTrack(_dlTrack, runT);
            if (sample) {
              dd.x = losX + dir * sample.dxYd * FIELD.PX_PER_YARD + Math.sin(tt * Math.PI * 6 + i * 0.4) * 1.5;
              dd.y = cy + sample.dyYd * FIELD.PX_PER_YARD + wobble;
              dd.pose = "engage";
              dd.archetype = _archForLineman(d, "DL");
              dd.t = tt;
            }
          } else {
            // Fallback — hold at last-rendered (pre-snap shift) with jitter
            const _dlBaseXR = (typeof d._lastRenderedX === "number") ? d._lastRenderedX : d.x;
            const _dlBaseYR = (typeof d._lastRenderedY === "number") ? d._lastRenderedY : d.y;
            dd.x = _dlBaseXR + Math.sin(tt * Math.PI * 6 + i * 0.4) * 1.5;
            dd.y = _dlBaseYR + wobble;
            dd.pose = "engage";
            dd.archetype = _archForLineman(d, "DL");
            dd.t = tt;
          }
          // ── WIN-THE-MATCHUP HOLE OPENING (visual heuristic) ──────────
          // Real run blocking opens a HOLE — winning OL drives his DL
          // off-axis from the carrier's lane. The engine doesn't emit
          // per-block winners yet, so we fake it: any blocked DL within
          // ~30 lateral pixels of the carrier's current Y gets shoved
          // AWAY from the carrier and slightly backward, eased over the
          // first 40% of the run. Off-lane DL stay put. Skips the
          // pursuing DL (he beat his block; he's not blocked). Live
          // tuning via window.GC_RUN_HOLE_RANGE / _LATERAL / _BACK.
          if (!_isPursuingDl) {
            const _laneRange = (typeof window !== "undefined" && window.GC_RUN_HOLE_RANGE) || 30;
            const _laneDist = dd.y - rb.y;
            const _absDist = Math.abs(_laneDist);
            if (_absDist < _laneRange) {
              const _proximity = 1 - _absDist / _laneRange;
              const _ramp = Math.min(1, tt / 0.4);
              const _eased = _ramp * _ramp * (3 - 2 * _ramp);
              // Per-DL win-magnitude variation so each play doesn't look identical
              const _winSeed = (((i + 1) * 7 + ((play.startYard || 0) * 13)) >>> 0) % 100 / 100;
              const _winMul = 0.65 + _winSeed * 0.45;     // 0.65-1.10 multiplier
              const _push = _proximity * _eased * _winMul;
              const _maxLat = (typeof window !== "undefined" && window.GC_RUN_HOLE_LATERAL) || 14;
              const _maxBack = (typeof window !== "undefined" && window.GC_RUN_HOLE_BACK) || 5;
              dd.y += _maxLat * Math.sign(_laneDist || 1) * _push;
              dd.x += dir * _maxBack * _push;
            }
          }
          dd.facing = -dir;
          return dd;
        }
        // LBs (4-6), CBs (7-8), Safeties (9-10) — pursue with imperfect angles.
        // Each defender targets a point slightly OFF the carrier (lane discipline)
        // and reacts on a small delay so they don't laser-lock. The "dodged"
        // defender keeps the PRE-MOVE rb position as their target — so when the
        // carrier cuts they shoot past where the carrier WAS.
        const lane = ((i - 4) % 5) - 2;
        const reactDelay = 0.04 + ((i * 13) % 8) / 100;  // 40-110 ms reaction lag
        const isDodged = i === dodgeIdx && rbLateral !== 0;
        // TRUCK STICK — the targeted defender gets bowled over (ragdolled)
        const isTrucked = i === dodgeIdx && rbPose === "truck";
        // Dodged defender OVERSHOOTS — targets a spot 12px FORWARD of
        // the carrier's stale (pre-move) Y position. Bigger overshoot
        // ensures the dive visibly clears the carrier's new position
        // and the defender lands flat on empty grass.
        const txBase = isDodged
          ? rb.x + dir * 12                             // overshoot forward
          : rb.x + dir * (4 + ((i - 4) % 3) * 3);
        const tyBase = isDodged
          ? (rb.y - rbLateral) + lane * 8               // chases stale Y
          : rb.y + lane * 8;
        // ── LANE DISCIPLINE / COVERAGE ASSIGNMENT ─────────────────
        // Most defenders DON'T chase the carrier from the snap. Real
        // run defense:
        //   LBs / NB / SS  → fill the gap, pursue the carrier
        //   CBs            → stay with their WR until run breaks contain
        //   FS             → stay deep, big-play insurance
        // "Broken contain" trips when the run is meaningful (>12 yd for
        // CB release, >15 yd for FS). Until then, CBs cover, FS holds.
        const isCB = (i === idxCB1 || i === idxCB2);
        const isFS = (i === idxS2);
        const cbBroken = (yards >= 12) || (runT > 0.65);
        const fsBroken = (yards >= 15) || (runT > 0.70);
        const isPrimaryOverride = (i === primaryTacklerIdx);   // primary always pursues
        let tx = txBase, ty = tyBase;
        if (!isPrimaryOverride && isCB && !cbBroken) {
          // CB stays with assigned WR — track WR position with slight
          // outside leverage. CB1 → wr1, CB2 → wr2.
          const wrTarget = (i === idxCB1) ? formation.wr1 : formation.wr2;
          if (wrTarget) {
            tx = wrTarget.x + dir * 2;        // 2px head-on leverage
            ty = wrTarget.y;
          }
        } else if (!isPrimaryOverride && isFS && !fsBroken) {
          // FS holds deep position — only minor lateral shift to track
          // the ball's lateral side.
          tx = d.x;
          ty = d.y + Math.sign(rb.y - d.y) * 4;
        }
        const elapsedMs = Math.max(0, (t - PRE - reactDelay) * dur);
        const carrierFast = (rbArch === "SPEED" || rbArch === "ELUSIVE") ? 0.92 : 1.0;
        const factor = (i >= idxCB1 ? 1.02 : (i === idxS1 || i === idxS2 ? 1.0 : 0.92)) * carrierFast;
        // Primary tackler's max speed is DYNAMICALLY tuned so they can
        // reach the tackle spot via REAL pursuit physics. Compute the
        // distance from their formation position to the tackle spot,
        // divide by the time available (until runT 0.78), set max speed
        // to that. Sim then naturally accelerates them along an
        // intercept angle — no rubber-band needed for the common case.
        const isPrimary = (i === primaryTacklerIdx);
        // PATH B Phase 3a — engine-emitted tackler track wins over sim
        // for the primary tackler. Reads play.motion.tracks.tackler and
        // sets np directly from the interpolated waypoint. Skips the
        // dynamic-speed-sim entirely so no rubber-band correction is
        // needed downstream (the engine path IS the authoritative pursuit).
        const _tacklerTrack = (play.motion && play.motion.tracks && play.motion.tracks.tackler) || null;
        const _useTacklerMotion = isPrimary && !isDodged && !isTrucked && _tacklerTrack && typeof MotionPlayback !== "undefined";
        // PATH B Phase 3c — secondary defender lane discipline tracks.
        // FS / SS / CB1 / CB2 (when not the primary tackler) get
        // engine-emitted zone behaviors so they don't all converge
        // on the carrier. Track keys: fs, ss, cb1, cb2.
        const _tracksAll = (play.motion && play.motion.tracks) || null;
        let _secondaryTrack = null;
        if (_tracksAll && !isPrimary && !isTrucked && !isDodged) {
          if      (i === idxS1)  _secondaryTrack = _tracksAll.fs;
          else if (i === idxS2)  _secondaryTrack = _tracksAll.ss;
          else if (i === idxCB1) _secondaryTrack = _tracksAll.cb1;
          else if (i === idxCB2) _secondaryTrack = _tracksAll.cb2;
        }
        const _useSecondaryMotion = _secondaryTrack && typeof MotionPlayback !== "undefined";
        // Sync d._sim to a known (x, y) so a later pursue() handoff starts
        // from THERE, not from formation. Without this, the sim is created
        // lazily at d.x/d.y (formation) the first time pursue() runs —
        // teleporting the defender from his track position back to
        // formation. Creates the sim if missing; updates if present.
        // (Stage 2 of REFACTOR_POSITION_CONTRACT.md: kill the
        // formation→pursue-sim handoff seam.)
        const _syncSimAt = (nx, ny, factor) => {
          if (typeof SimPlayer === "undefined") return;
          if (!d._sim) {
            d._sim = new SimPlayer(nx, ny, {
              maxSpeed: SIM_DEFAULTS.MAX_SPEED * factor,
              accel: SIM_DEFAULTS.ACCEL,
            });
            d._simFactor = factor;
          } else {
            d._sim.x = nx; d._sim.y = ny;
          }
        };
        let np;
        if (_useTacklerMotion) {
          const sample = MotionPlayback.sampleTrack(_tacklerTrack, runT);
          if (sample) {
            const nx = losX + dir * sample.dxYd * FIELD.PX_PER_YARD;
            const ny = cy + sample.dyYd * FIELD.PX_PER_YARD;
            const moved = Math.hypot(nx - d.x, ny - d.y) > 0.5;
            np = { x: nx, y: ny, moved };
            _syncSimAt(nx, ny, factor);
          }
        } else if (_useSecondaryMotion) {
          const sample = MotionPlayback.sampleTrack(_secondaryTrack, runT);
          if (sample) {
            const nx = losX + dir * sample.dxYd * FIELD.PX_PER_YARD;
            const ny = cy + sample.dyYd * FIELD.PX_PER_YARD;
            const moved = Math.hypot(nx - d.x, ny - d.y) > 0.5;
            np = { x: nx, y: ny, moved };
            _syncSimAt(nx, ny, factor);
          }
        }
        let primarySpeedPx = SIM_DEFAULTS.MAX_SPEED * factor;
        if (!_useTacklerMotion && isPrimary && !isDodged) {
          const tackleX = endX - dir * 4;
          const tackleY = cy + 28 + 2;     // ~where rb.y ends up
          const distPx = Math.hypot(tackleX - d.x, tackleY - d.y);
          const availSec = Math.max(0.4, (0.78 - PRE / 1 - reactDelay) * (dur / 1000));
          // Need this speed (px/sec) to JUST reach the spot. Add 10%
          // margin so they arrive slightly early (looks decisive).
          const needed = distPx / availSec * 1.10;
          // Clamp to a believable range — 7 yd/s floor (jog), 11 yd/s
          // ceiling (NFL elite top sprint). Was 18 yd/s (40 mph)
          // which made the primary tackler visibly outrun the rest of
          // the defense by 2x — looked like cheating.
          primarySpeedPx = clamp(needed, SIM_DEFAULTS.MAX_SPEED * 0.8, 11 * 15);
        }
        const simFactor = isPrimary ? (primarySpeedPx / SIM_DEFAULTS.MAX_SPEED) : factor;
        // PHYSICS SIM pursuit — defender computes intercept against the
        // CARRIER's velocity. Primary tackler's speed is tuned so the
        // sim catches the carrier naturally; rubber-band remains as
        // fallback below but should be moot now.
        if (!np) {
          if (elapsedMs > 0) {
            const nowMs = t * dur;
            // Coverage defenders (CB on WR, FS deep) aim directly at
            // their assignment. Pursuit defenders intercept against the
            // carrier's velocity. One pursue() call handles both via
            // the carrier opt.
            const inCoverage = (!isPrimaryOverride && isCB && !cbBroken) ||
                               (!isPrimaryOverride && isFS && !fsBroken);
            const carrierVel = inCoverage ? null
                             : carrierVelocityToward(rb.x, rb.y, endX, cy + 28, 180);
            np = pursue(d, tx, ty, nowMs, simFactor,
              inCoverage ? {} : { carrier: { x: rb.x, y: rb.y, vx: carrierVel.vx, vy: carrierVel.vy } });
          } else {
            np = { x: d.x, y: d.y, moved: false };
          }
        }
        dd.x = np.x; dd.y = np.y;
        if (isTrucked) {
          // Trucked defender ragdolls — driven toward the carrier and falls.
          // CONTINUITY (tackle seam, REFACTOR_POSITION_CONTRACT.md): the truck
          // victim can be several yards from the carrier at truck onset (his
          // pursuit sim didn't converge), so hard-setting him onto the carrier
          // teleported up to ~22yd in one frame. Capture where he was last
          // rendered (dd.x/y, set from np just above) at the onset frame and
          // EASE to the carrier anchor over the truck window, so "bowled over"
          // reads as continuous motion instead of a pop.
          const _truckAnchorX = rb.x + dir * 6;
          const _truckAnchorY = rb.y + 2;
          if (d._truckBaseX == null) {
            d._truckBaseX = dd.x; d._truckBaseY = dd.y; d._truckOnsetRunT = runT;
          }
          const _tp = Math.min(1, Math.max(0, (runT - d._truckOnsetRunT) / 0.18));
          const _te = _tp * _tp * (3 - 2 * _tp);
          dd.x = d._truckBaseX + (_truckAnchorX - d._truckBaseX) * _te;
          dd.y = d._truckBaseY + (_truckAnchorY - d._truckBaseY) * _te;
          dd.pose = "tackled";
          // Fall progress over the truck window (cruise 0.34-0.52)
          const truckT = Math.min(1, Math.max(0, (runT - 0.34) / 0.20));
          dd.t = truckT;
        } else {
          // LB SCRAPE — read the play first, then commit. For the
          // first ~25% of run-cycle, LBs (i in [idxLB1, idxCB1)) show
          // the scrape pose (lateral shuffle, hands ready). After
          // that they transition to run pursuit. Other defender
          // levels (CB/S) skip scrape and go straight to run since
          // they're already in coverage shells.
          const isLB = i >= idxLB1 && i < idxCB1;
          if (isLB && runT < 0.25) {
            dd.pose = "scrape";
            dd.t = ((t * (dur / 1000)) * 2.5) % 1;
          } else {
            dd.pose = "run";
            // Freeze the leg cycle when the defender hasn't translated
            // this frame — caught up to the carrier / target isn't
            // moving. Old code kept the run-cycle going regardless, so
            // a stationary defender looked like they were sprinting in
            // place.
            dd.t = np.moved ? (t < 0.95 ? ((performance.now() / 333) + i * 0.13) % 1 : 0) : 0;
          }
        }
        // GUARANTEED TACKLER FALLBACK — keep a soft rubber-band in case
        // the sim's tuned speed doesn't quite catch (edge cases:
        // defender far off-axis, dodge-stale target, etc.). Eased over
        // runT 0.40 → 0.75. With the sim now sized to reach the tackle
        // spot, the defender is usually already near the carrier and
        // this fallback applies very little correction.
        // PATH B Phase 3a — skip rubber-band entirely when engine
        // motion is driving the tackler. The waypoint path already
        // lands on the carrier at t=0.78.
        if (i === primaryTacklerIdx && !isTrucked && yards < 90 && !_useTacklerMotion) {
          const arriveStartT = 0.40;
          const arriveEndT   = 0.75;
          if (runT > arriveStartT) {
            const arrProg = Math.min(1, (runT - arriveStartT) / (arriveEndT - arriveStartT));
            const eased   = arrProg * arrProg * (3 - 2 * arrProg);
            const fromX = np.x, fromY = np.y;
            const toX = rb.x - dir * 4, toY = rb.y + 2;
            // Only blend if the sim hasn't caught — measure distance gap
            const distGap = Math.hypot(toX - fromX, toY - fromY);
            const blendStrength = distGap > 20 ? eased : eased * 0.3;
            dd.x = fromX + (toX - fromX) * blendStrength;
            dd.y = fromY + (toY - fromY) * blendStrength;
          }
        }
        // Face the CARRIER, not just -dir.
        dd.facing = (rb.x > dd.x) ? 1 : (rb.x < dd.x ? -1 : -dir);
        // Tackle pose — variety. PRIMARY tackler drives in (hit) or dives
        // (big-hit dive); pile-on defenders RAGDOLL with physics; the
        // DODGED defender (juked) flies past in a missed-dive pose.
        // PILE CAP: only the closest PILE_CAP defenders + the primary
        // can be in the pile. Others stay running (out of position).
        const _inPile = (i === primaryTacklerIdx) || pileIdxSet.has(i);
        if (!isTrucked && _inPile && yards < 90 && tt > TACKLE_T && Math.hypot(rb.x - dd.x, rb.y - dd.y) < 28) {
          if (i === primaryTacklerIdx) {
            // Both variants route to the tackle/ sprite (a horizontal
            // diving wrap). The primaryTacklerDives flag still drives
            // timing differences upstream; the sprite itself is the
            // same wrap motion for both. Using "dive" here routed to
            // dive_forward/, a layout-catch pose meant for receivers.
            dd.pose = "hit";
            dd.t = Math.min(1, (tt - TACKLE_T) / POST_TACKLE);
          } else {
            // Pile-on defender — collapses ON the pile, doesn't ricochet.
            // Hit vector aims slightly TOWARD the carrier so the
            // defender falls inward, not outward. Tiny lateral jitter
            // per defender so they don't all land in the same spot.
            // nowMs uses performance.now() so the ragdoll continues
            // advancing through the post-action hold (otherwise the
            // pile freezes mid-fall when t clamps to 1.0).
            const nowMs = performance.now();
            if (!d._ragdoll) {
              const inX = -Math.sign((dd.x - rb.x) || 1) * 0.4;   // toward carrier
              const inY = -Math.sign((dd.y - rb.y) || 1) * 0.4;
              const jitter = ((tacklerHash + i * 17) % 7) - 3;
              const hvx = inX + jitter * 0.1;
              const hvy = inY + ((i * 13) % 7 - 3) * 0.1;
              initRagdoll(d, hvx, hvy, 35 + (i * 5 % 25), nowMs, tacklerHash + i * 7);
            }
            stepRagdoll(d, nowMs, 8);   // groundDy ~= 8 below body origin
            dd._ragdoll = d._ragdoll;   // expose state to renderer via style
            dd.pose = "ragdoll";
          }
        } else if (isDodged && tt > 0.34 && tt < 0.58) {
          // Juked defender dives at the carrier's PRE-move position and
          // misses. Lands flat after the dive arc completes.
          dd.pose = "dive";
          dd.t = Math.min(1, (tt - 0.34) / 0.24);
        }
        return dd;
      });
      // OL fire out and engage DL at the LOS
      const off = formation.offense.filter(p => p.role !== "RB").map((p, idx) => {
        // Pre-snap motion for the chosen player
        if (hasMotion && t < PRE) {
          const isMotion = (motionRole === "wr1" && p === formation.wr1)
                        || (motionRole === "wr2" && p === formation.wr2)
                        || (motionRole === "te" && p === formation.te);
          if (isMotion) {
            const yOff = motionYOffset(t);
            const moving = isInMotionNow(t);
            // Eased ~20px behind the LOS (clears the line) — see motionXOffset.
            // Was binary (moving ? -20 : 0), which jumped at the motion
            // start/set boundaries and slid via the continuity guard.
            const xOff = motionXOffset(t);
            // Face the DIRECTION OF MOTION when actively running. If
            // motionEndY > motionStartY, player is moving toward higher
            // field-Y → faces +1. Otherwise faces -1. Reverts to dir
            // (offense direction) once motion stops so they line up for
            // the snap.
            const motionFacing = moving
              ? ((motionEndY > motionStartY) ? 1 : -1)
              : dir;
            return { ...p, x: p.x + xOff, y: p.y + yOff,
                     pose: moving ? "run" : "stance",
                     t: (t < 0.95 ? ((performance.now() / 333)) % 1 : 0), facing: motionFacing };
          }
        }
        if (t < PRE) return { ...p, pose: "stance" };
        const tt = runT;
        // === RUN TD GROUP CELEBRATION ===
        // On a TD run past runT > 0.85, WR/TE/FB converge on the
        // scorer in the end zone. QB and OL celebrate IN PLACE — QB
        // can't realistically sprint 30+ yd in the celebration window
        // (lerp stalls him near the LOS in arms-up pose) and OL would
        // teleport through the defensive line on the way. Pre-snap
        // hash uses the formation home (p.y, p.x) which is constant
        // per personnel; that determinism is fine — gives stable per-
        // slot angles around the scorer.
        // Held until runT > 0.92 so the QB/OL aren't already in
        // celebration pose while the carrier is still 5-10 yards short
        // of the goal line on long TD runs.
        if (isTD && runT > 0.92) {
          if (p.role === "QB" || p.role === "OL") {
            // Celebrate in place. Pose-only override; rendered position
            // pins to where the player was on the previous frame (NOT
            // formation home) — otherwise the QB / OL teleport back to
            // their pre-snap slot the frame celebration triggers.
            return { ...p,
                     x: p._lastRenderedX ?? p.x,
                     y: p._lastRenderedY ?? p.y,
                     pose: "celebrate",
                     t: Math.min(1, (runT - 0.92) / 0.08),
                     facing: dir };
          }
          const hash = ((p.y * 17 + p.x * 13) >>> 0) % 1000;
          const angle = (hash / 1000) * Math.PI * 2;
          const radius = (4 + (hash % 4)) * FIELD.PX_PER_YARD;
          // Clamp the cluster INTO the endzone (the scorer is there) but
          // keep it IN FRONT of the goalpost (base ~18px from the back edge)
          // — EZ_PX*0.3 (30px) let celebrators reach the post and, in the 3D
          // broadcast projection, their tall sprites overlapped the uprights
          // ("standing on the goal post"). 0.5 (50px) keeps a clear ~30px gap.
          const targetX = clamp(rb.x + Math.cos(angle) * radius,
                                FIELD.EZ_PX * 0.5, FIELD.W - FIELD.EZ_PX * 0.5);
          const targetY = clamp(rb.y + Math.sin(angle) * radius,
                                FIELD.TOP + 20, FIELD.BOT - 20);
          // Initialize from the PREVIOUSLY RENDERED position, not the
          // formation slot. Reading p.x/p.y here was the late-play
          // teleport: at the frame celebration starts, the player jumps
          // from his downfield blocking spot back to formation home and
          // begins the celebrate-converge from there. _lastRenderedX is
          // captured at the end of this map() each frame.
          if (p._followX == null) {
            p._followX = p._lastRenderedX ?? p.x;
            p._followY = p._lastRenderedY ?? p.y;
          }
          if (p._followVX == null) { p._followVX = 0; p._followVY = 0; }
          // Frame-time factor (see pass downfield-blocker block) — driven
          // off PLAY-TIME (t) delta so it's both refresh-independent AND
          // respects slow-mo / TD freezes (wall-clock dt surged the
          // celebrators through frozen frames).
          const _dtF = (p._followT == null) ? 1
                     : Math.max(0, Math.min(3, (t - p._followT) * dur / 16.67));
          p._followT = t;
          // Velocity-based motion with per-celebrator variation so they
          // arrive on different frames instead of stopping in unison.
          const _fdx = targetX - p._followX;
          const _fdy = targetY - p._followY;
          const _fd  = Math.hypot(_fdx, _fdy);
          const _maxPF = 14 * FIELD.PX_PER_YARD * 16 / 1000;   // ≈3.36 px/frame
          const _cHash = ((p.y * 17 + p.x * 13) >>> 0) % 100 / 100;
          if (_fd > 0.001) {
            const _desiredSpeed = Math.min(_maxPF, _fd * 0.18);
            const _dvx = (_fdx / _fd) * _desiredSpeed;
            const _dvy = (_fdy / _fd) * _desiredSpeed;
            const _accel = 0.13 + _cHash * 0.06;   // 0.13-0.19
            p._followVX += (_dvx - p._followVX) * _accel;
            p._followVY += (_dvy - p._followVY) * _accel;
          } else {
            const _decay = 0.85 + _cHash * 0.08;
            p._followVX *= _decay;
            p._followVY *= _decay;
          }
          p._followX += p._followVX * _dtF;
          p._followY += p._followVY * _dtF;
          const _gap = Math.hypot(p._followX - targetX, p._followY - targetY);
          const celebPose = _gap < 18 ? "celebrate" : "run";
          return { ...p,
                   x: p._followX, y: p._followY,
                   pose: celebPose,
                   t: celebPose === "celebrate"
                        ? Math.min(1, (runT - 0.85) / 0.15)
                        : (t < 0.95 ? ((performance.now() / 333)) % 1 : 0),
                   facing: dir };
        }
        if (p.role === "OL") {
          // RUN-BLOCK SIM — if this OL is in an engaged rep, the sim owns his
          // position (he's driving / sealing his DL). Wins the matchup =
          // drives the DL downfield + out of the hole.
          const _rbOLPair = _runBlock && _runBlock.pairFor(p);
          if (_rbOLPair) {
            return { ...p, x: _rbOLPair.olX, y: _rbOLPair.olY,
                     pose: "engage", t: tt, facing: dir,
                     archetype: _archForLineman(p, "OL") };
          }
          // PATH B Phase 9 — engine-emitted OL track wins when present.
          // Slot index 0-4 by Y RANK among the OL (topmost = 0). Was
          // round((p.y-cy)/14)+2, but the OL are spaced 32px (not 14), so
          // the tackles hashed to out-of-range slots (-3 / 7 -> no track ->
          // fallback) and the guards picked the WRONG track (ol0/ol4) and
          // teleported to that slot's wider Y on the snap. Ranking is
          // spacing-agnostic and maps each OL to its own ol{s} track, whose
          // t=0 waypoint matches the formation (no snap teleport).
          const _olRankYs = formation.offense
            .filter(o => o.role === "OL").map(o => o.y).sort((a, b) => a - b);
          const olSlotIdx = Math.max(0, Math.min(4, _olRankYs.indexOf(p.y)));   // 0..4 from top
          const _olTrack = play.motion?.tracks?.[`ol${olSlotIdx}`];
          if (_olTrack && typeof MotionPlayback !== "undefined") {
            const sample = MotionPlayback.sampleTrack(_olTrack, runT);
            if (sample) {
              const wobble = Math.sin(tt * Math.PI * 5 + olSlotIdx * 1.7) * 1.5;
              return { ...p,
                x: losX + dir * sample.dxYd * FIELD.PX_PER_YARD + wobble * 0.6,
                y: cy + sample.dyYd * FIELD.PX_PER_YARD + wobble,
                pose: "engage", t: tt, facing: dir,
                archetype: _archForLineman(p, "OL"),
              };
            }
          }
          // Blocking pattern by runType. Slot is the OL's lateral seat
          // (-2 leftmost guard ... +2 rightmost). Defines who pulls,
          // who reaches, etc.
          const slot = (p.y - cy) / 14;
          const wobble = Math.sin(tt * Math.PI * 5 + slot * 1.7) * 1.5;
          const rt = play.runType || "inside";
          // counter: ONE guard (opposite the play side) pulls across to
          //   lead the carrier into the cutback gap. Other OL fire fwd.
          // stretch: ALL OL flow lateral toward the play side ("zone
          //   step") — synchronous slide before engagement.
          // pitch: outside OL on the play side reaches out toward the
          //   sideline; backside OL drives forward.
          // inside (default): straight-ahead drive.
          //
          // DL sits at LOS+37.5px pre-snap (DL_DEPTH_YD=2.5 × 15) and
          // OL at LOS-2px, so the snap-time gap is ~39.5px. For run
          // blocking to READ as engagement, the OL has to drive forward
          // ~22px (~1.5yd) to reach the DL row. Eased ramp = OL stays
          // legal pre-snap, then fires off the ball post-snap to clash.
          // Live-tunable via window.GC_OL_RUN_DRIVE. Default 30px (~2yd) so
          // the OL front actually reaches the DL row at LOS+37.5px (was 22px,
          // which stalled ~1yd short of the DL — they posed but never met).
          const _olDriveMax = (typeof window !== "undefined" && window.GC_OL_RUN_DRIVE) || 30;
          let driveX = dir * Math.min(tt * _olDriveMax * 1.4, _olDriveMax);
          let driveY = 0;
          if (rt === "counter") {
            const pullSlot = -_counterSide * 1;     // guard opposite play side pulls
            const isPuller = Math.round(slot) === pullSlot;
            if (isPuller) {
              // Pull across the formation in the play-side direction
              const pullT = Math.min(1, tt * 1.7);
              driveX = dir * 1.5;
              driveY = _counterSide * pullT * 18;
            }
          } else if (rt === "stretch") {
            // Whole line flows toward the play side. X drive smaller
            // than inside since the lateral flow is the focus, but
            // still enough to engage the DL row.
            const flowT = Math.min(1, tt * 1.4);
            driveX = dir * Math.min(tt * 16, 12);
            driveY = _stretchSide * flowT * 5;
          } else if (rt === "pitch") {
            const isPlaySideOuter = Math.sign(slot) === Math.sign(_pitchSide) && Math.abs(slot) >= 1.5;
            if (isPlaySideOuter) {
              const reachT = Math.min(1, tt * 1.6);
              driveX = dir * 1.0;
              driveY = _pitchSide * reachT * 12;
            }
          }
          return { ...p, x: p.x + driveX, y: p.y + wobble + driveY, pose: "engage", t: tt, facing: dir, archetype: _archForLineman(p, "OL") };
        }
        if (p.role === "TE") {
          // TE seals the edge — engage a defender to the side, doesn't run free
          return { ...p, x: p.x + dir * tt * 12, y: p.y - dir * tt * 6, pose: "engage", t: tt, facing: dir };
        }
        if (p.role === "FB") {
          // FB lead-block: sprint forward to the 2nd level (LB area) and engage.
          // Travels roughly 7-10 yds forward in the first half of the play,
          // then engages a linebacker. Slight inside cut to seal the gap.
          const fbProg = Math.min(1, tt / 0.55);
          const fbXJump = 9 * FIELD.PX_PER_YARD * fbProg;
          const fbYMerge = (cy - p.y) * 0.35 * fbProg;
          const fbPose = tt < 0.50 ? "run" : "engage";
          return { ...p, x: p.x + dir * fbXJump, y: p.y + fbYMerge,
                   pose: fbPose, t: fbPose === "run" ? (t < 0.95 ? ((performance.now() / 333)) % 1 : 0) : tt, facing: dir };
        }
        // WRs RUN-BLOCK on run plays — sprint at their CB then drive-block.
        // First ~30% of the play they release straight downfield, then they
        // close on the nearest CB and adopt the "engage" pose. The TE handles
        // its edge block above; here we only deal with wide receivers.
        if (p.role === "WR1" || p.role === "WR2" || p.role === "WR3" || p.role === "WR4" || p.role === "WR5") {
          // Pick a CB to block, then LOCK that choice for the rest of
          // the play. Re-picking every frame caused a teleport when the
          // nearest CB switched sides (e.g., a CB crosses the midline
          // and the sameSide filter returns a defender 30+ yards away);
          // the WR's lerp endpoint jumped, snapping the sprite. Cache
          // the defender INDEX (not the object) since def[] is rebuilt
          // each frame.
          let tgtX = p.x + dir * 18, tgtY = p.y;
          let tgtDef = (p._blockTargetIdx != null && def && def[p._blockTargetIdx])
            ? def[p._blockTargetIdx] : null;
          if (!tgtDef && def && def.length) {
            const sameSide = def.filter(d => Math.sign(d.y - cy) === Math.sign(p.y - cy) && (d.role === "CB" || d.role === "NB" || d.role === "DB"));
            if (sameSide.length) {
              const best = sameSide.reduce((b, d) => {
                const dist = Math.hypot(d.x - p.x, d.y - p.y);
                return (b == null || dist < b.dist) ? { d, dist } : b;
              }, null);
              if (best) {
                tgtDef = best.d;
                p._blockTargetIdx = def.indexOf(tgtDef);
              }
            }
          }
          if (tgtDef) { tgtX = tgtDef.x - dir * 4; tgtY = tgtDef.y; }
          // Release downfield first, then close on the CB
          const releaseT = Math.min(1, tt / 0.30);
          const closeT   = Math.max(0, (tt - 0.30) / 0.70);
          const baseX = p.x + (tgtX - p.x) * Math.min(1, releaseT * 0.45 + closeT * 0.85);
          const baseY = p.y + (tgtY - p.y) * Math.min(1, closeT * 0.85);
          const isEngaged = tt > 0.35;
          return { ...p, x: baseX, y: baseY,
                   pose: isEngaged ? "engage" : "run",
                   t: isEngaged ? closeT : (t < 0.95 ? ((performance.now() / 333) + 0.5) % 1 : 0),
                   facing: dir };
        }
        // WRs release downfield (run block on screens/runs) — fallback for any
        // role string we didn't catch above.
        return { ...p, x: p.x + dir * tt * 14, pose: "run", t: (t < 0.95 ? ((performance.now() / 333) + 0.5) % 1 : 0), facing: dir };
      });
      // Capture each offense slot's RENDERED position from this frame so
      // next-frame branches that need "where was this player last" (TD
      // celebration init, QB celebrate-in-place, future phase handoffs)
      // read the last rendered spot, not formation home. Same Family-A
      // continuity fix as the Stage 1+2 track/sim work — applied to the
      // offense's frame-to-frame phase handoff.
      // filter() preserves order; off[k] corresponds to the k-th non-RB
      // formation slot.
      {
        let _k = 0;
        for (const _fp of formation.offense) {
          if (_fp.role === "RB") continue;
          const _r = off[_k++];
          if (_r && typeof _r.x === "number" && typeof _r.y === "number") {
            _fp._lastRenderedX = _r.x;
            _fp._lastRenderedY = _r.y;
          }
        }
      }
      // For scrambles / option keepers the QB is the actual ball carrier — so
      // we render the QB sprite at the carrier position with the carrier pose,
      // and the RB sits in the backfield as a check-down blocker.
      let off2;
      let carrierToDraw;
      if (isQBCarry) {
        const qbCarrier = {
          ...formation.qb,
          x: rb.x, y: rb.y,
          pose: rbPose, t: rbT, facing: dir,
        };
        off2 = off.map(p => p.role === "QB" ? qbCarrier : p);
        // Real RB — on a speed option KEEP, the RB sprints alongside as
        // a live pitch threat. On other QB-carry plays, he sits in the
        // backfield as a check-down blocker.
        carrierToDraw = (optRbX !== null)
          ? { ...formation.rb, x: optRbX, y: optRbY,
              pose: "run", t: (t < 0.95 ? ((performance.now() / 333)) % 1 : 0), facing: dir }
          : { ...formation.rb,
              x: formation.rb.x + dir * Math.min(8, runT * 18),
              y: formation.rb.y - dir * Math.min(0, runT * 4),
              pose: t < PRE ? "idle" : "block",
              t: runT,
              facing: dir };
      } else {
        // Standard handoff: QB stays in stance pre-snap (auto-stance via "idle"),
        // briefly does a handoff motion right after the snap, then idles.
        // For a speed-option PITCH, the QB sprite actively sprints to the
        // option side, then peels off after the pitch — driven by optQbX/Y.
        off2 = off.map(p => {
          if (p.role !== "QB") return p;
          if (optQbX !== null) {
            return { ...p, x: optQbX, y: optQbY,
                     pose: "run", t: (t < 0.95 ? ((performance.now() / 333)) % 1 : 0), facing: dir };
          }
          const handoffPose = t < PRE
            ? "idle"                                  // stance pre-snap
            : (t < PRE + (1 - PRE) * 0.10 ? "throw"  // brief handoff motion
            : "idle");                                // back to neutral after
          return { ...p, pose: handoffPose, t, facing: dir };
        });
        carrierToDraw = rb;
      }
      _syncDefRendered(def);
      drawPlayers([...off2, carrierToDraw], def);
      // RUN TRAIL — dotted breadcrumbs from the LOS to the current ball
      // position. Only after the snap-and-handoff phase so it doesn't
      // smear out from the center pre-snap.
      if (runT > 0.10 && typeof drawRunTrail === "function") {
        const teamColor = (poss === "home" ? gameResult?.homeTeam : gameResult?.awayTeam)?.primary || "#f5c542";
        // Convert hex team color to rgba for the trail; fall back to gold
        const rgba = (() => {
          if (!teamColor || teamColor[0] !== "#" || teamColor.length !== 7) return "rgba(245,197,66,0.55)";
          const r = parseInt(teamColor.slice(1,3),16), g = parseInt(teamColor.slice(3,5),16), b = parseInt(teamColor.slice(5,7),16);
          return `rgba(${r},${g},${b},0.55)`;
        })();
        drawRunTrail(ctx, centerX, cy, ballX, ballY, runT, rgba);
      }
      // Ball drawn at the engine-computed (ballX, ballY). drawBall()
      // itself runs a proximity-gated foot-to-hand auto-shift (24px
      // window) for any nearby carrier — so a separate call-site
      // override was redundant and the source of the pre-snap "ball
      // in RB's hands" bug. Single canonical mechanism now.
      // With sprites on, the carry sprite already draws a tucked ball, so
      // the standalone is suppressed during possession (only drawn when the
      // ball is loose/in the air) — otherwise two balls ride the carrier.
      const _runSpritesOn = (typeof SpriteAtlas !== "undefined" && SpriteAtlas.anyLoaded());
      if (!_runSpritesOn || _ballLoose) {
        drawBall(ctx, ballX, ballY);
      }
      // SPEED OPTION banner — shows the play call. Once the read fires
      // (after PITCH_T), a secondary line shows whether the QB made the
      // RIGHT or WRONG read of the edge defender's commit.
      if (play.isSpeedOption && runT > 0 && runT < 0.55) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "900 22px sans-serif";
        const opt = play.optionRead;
        const showRead = opt && runT > 0.30;
        const bannerH = showRead ? 48 : 30;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(FIELD.W/2 - 150, 8, 300, bannerH);
        ctx.fillStyle = "#ffd54d";
        ctx.fillText(play.isPitch ? "SPEED OPTION — PITCH" : "SPEED OPTION — KEEP", FIELD.W / 2, 23);
        if (showRead) {
          ctx.font = "bold 12px sans-serif";
          ctx.fillStyle = opt.goesCorrect ? "#86d56d" : "#e87878";
          const defLabel = opt.defAttacksQb ? "EDGE ATTACKED QB" : "EDGE PLAYED PITCH";
          const readLabel = opt.goesCorrect ? "RIGHT READ" : "WRONG READ";
          ctx.fillText(`${defLabel} · ${readLabel}`, FIELD.W / 2, 42);
        }
        ctx.restore();
      }
      // REVERSE banner — shows for the first 30% of action so viewers see it's a trick
      if (play.isReverse && runT < 0.55) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "900 24px sans-serif";
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(FIELD.W/2 - 120, 8, 240, 32);
        ctx.fillStyle = "#ffd54d";
        ctx.fillText("🔄 REVERSE", FIELD.W / 2, 24);
        ctx.restore();
      }
      // Big bold callout for jukes / spins / trucks / stiff arms / hurdles
      if (moveCallout) {
        ctx.save();
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = "900 24px sans-serif";
        const lblX = rb.x + dir * 16;
        const lblY = rb.y - 22;
        // Outline for legibility on any field background
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.strokeText(moveCallout, lblX, lblY);
        ctx.fillStyle = "#f0cc30";
        ctx.fillText(moveCallout, lblX, lblY);
        ctx.restore();
      }
      // In-canvas TOUCHDOWN! banner removed — _touchdownCinema overlay
      // + GCFx.chyron + result card already handle scoring chrome.
      drawPreSnapCallouts(ctx, t, dur);
    }};
  }

  if (play.kind === "spike") {
    // Quick spike-the-ball play. Total duration ~1.6s: pre-snap → snap →
    // QB spikes ball into the ground → ball bounces → CLOCK STOPPED banner.
    const actionDur = 1100;
    const dur = actionDur + PRE_MS;
    PRE = PRE_MS / dur;
    const centerX = losX - dir * 2;
    return { duration: dur, kind: "spike", render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);
      const qb = { ...formation.qb };
      const aT = t < PRE ? 0 : (t - PRE) / (1 - PRE);
      // Action phases:
      //   0.00 - 0.05  ball snap (C → QB)
      //   0.05 - 0.45  QB cocks the spike (arm raises briefly)
      //   0.45 - 0.55  QB spikes — ball goes from QB hand to ground
      //   0.55 - 1.00  ball bounces in front of the QB, settles
      let ballX = centerX, ballY = cy;
      let qbPose = "idle", qbT = 0;
      if (t < PRE) {
        qbPose = "idle";
      } else if (aT < 0.05) {
        // Snap travel
        const s = aT / 0.05;
        ballX = centerX + (qb.x - centerX) * s;
        ballY = cy;
        qbPose = "idle";
      } else if (aT < 0.45) {
        // Cock
        ballX = qb.x;
        ballY = cy - 6;
        qbPose = "throw";
        qbT = (aT - 0.05) / 0.40 * 0.40;          // run throw pose up to its cock peak (~0.40)
      } else if (aT < 0.55) {
        // Spike — ball drops from QB hand height down to the ground
        const s = (aT - 0.45) / 0.10;
        ballX = qb.x + dir * 4;
        ballY = (cy - 14) + (cy + 4 - (cy - 14)) * s;  // hand height → ground
        qbPose = "throw";
        qbT = 0.55 + s * 0.20;                     // through release portion
      } else {
        // Ball bounces, settles in front of QB. Bounce decays.
        const s = (aT - 0.55) / 0.45;
        ballX = qb.x + dir * (4 + s * 4);
        const bounce = Math.abs(Math.sin(s * Math.PI * 2)) * 6 * (1 - s);
        ballY = cy + 4 - bounce;
        qbPose = "idle";
      }
      // Build a minimal offense + defense — everyone stays in stance.
      // (No real play happens, so no need for line-engagement animations.)
      const off = [
        ...formation.offense.filter(p => p.role !== "QB" && p.role !== "RB"),
        { ...formation.rb, pose: "stance", t: 0, facing: dir },
        { ...formation.qb, pose: qbPose, t: qbT, facing: dir },
      ];
      const def = formation.defense.map((d, i) => ({
        ...d, pose: "stance", t: (t < 0.95 ? ((performance.now() / 333)) % 1 : 0), facing: -dir,
      }));
      _syncDefRendered(def);
      drawPlayers(off, def);
      drawBall(ctx, ballX, ballY);
      // Banner: "SPIKE — CLOCK STOPPED!" once the ball hits the ground.
      if (aT >= 0.55) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "900 22px sans-serif";
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillRect(FIELD.W/2 - 140, 8, 280, 30);
        ctx.fillStyle = "#ffd54d";
        ctx.fillText("SPIKE — CLOCK STOPPED", FIELD.W / 2, 23);
        ctx.restore();
      }
      drawPreSnapCallouts(ctx, t, dur);
    }};
  }

  if (play.kind === "penalty") {
    // FLAG ON THE PLAY. A dead-ball beat: the teams are set/standing, the
    // referee throws his flag and signals the call, and an announcement card
    // states the foul + enforcement. (The engine already applied the yardage
    // and down — this surfaces it. Lights up the ref_flag / ref_first_down /
    // ref_idle sprites, which had never been drawn.) No PRE — it's not a snap.
    const dur = 3400;
    PRE = 0;
    const _autoFirst = !!play.autoFirst;
    // The ref stands just off the ball; faces back toward the offense.
    const _refX = losX + dir * 2 * FIELD.PX_PER_YARD;
    const _refY = cy - 70;
    // Flag lands near the foul spot (just past the LOS, in the middle).
    const _flagLandX = losX + dir * 0.5 * FIELD.PX_PER_YARD;
    const _flagLandY = cy + 22;
    return { duration: dur, kind: "penalty", render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);
      // Dead ball — both lines set in stance at the pre-penalty spot.
      const off = formation.offense.map(p => ({ ...p, pose: "stance", t: 0, facing: dir }));
      const def = formation.defense.map(d => ({ ...d, pose: "stance", t: 0, facing: -dir }));
      _syncDefRendered(def);
      drawPlayers(off, def);
      drawBall(ctx, losX - dir * 2, cy);
      // Referee — throws the flag over the first ~28%, then SIGNALS the call:
      // ref_first_down on automatic-first (defensive) fouls, else a neutral
      // ref_idle stance. "#ffffff" primary = multiply-by-white = identity, so
      // the ref keeps his black-and-white stripes (no team tint).
      let refPose, refT;
      if (t < 0.28) { refPose = "ref_flag"; refT = Math.min(1, t / 0.28); }
      else if (_autoFirst) { refPose = "ref_first_down"; refT = Math.min(1, (t - 0.28) / 0.32); }
      else { refPose = "ref_idle"; refT = (t < 0.95 ? ((performance.now() / 333)) % 1 : 0); }
      drawPlayer(ctx, _refX, _refY, "#ffffff", "#1a1a1a", "R", refPose, refT, -dir, { role: "REF", name: "ref" });
      // The flag — yellow marker arcing from the ref's hand to the turf.
      let _flagX, _flagY;
      if (t < 0.28) {
        const ft = t / 0.28;
        _flagX = _refX + (_flagLandX - _refX) * ft;
        _flagY = _refY + (_flagLandY - _refY) * ft - Math.sin(ft * Math.PI) * 42;
      } else { _flagX = _flagLandX; _flagY = _flagLandY; }
      ctx.save();
      ctx.fillStyle = "#f3d11a";
      ctx.beginPath(); ctx.arc(_flagX, _flagY, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
      // Announcement card — fades in after the flag is down.
      if (t > 0.30) {
        const fade = Math.min(1, (t - 0.30) / 0.12);
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const _bw = 440, _bh = 64, _bx = FIELD.W / 2 - _bw / 2, _by = 40;
        ctx.fillStyle = "rgba(12,12,16,0.82)";
        ctx.fillRect(_bx, _by, _bw, _bh);
        ctx.fillStyle = "#f3d11a";
        ctx.fillRect(_bx, _by, 6, _bh);   // yellow flag stripe
        ctx.font = "900 22px sans-serif";
        ctx.fillStyle = "#f3d11a";
        ctx.fillText("🚩 PENALTY", FIELD.W / 2, _by + 20);
        ctx.font = "600 14px sans-serif";
        ctx.fillStyle = "#e8e8ee";
        const _txt = (play.desc || "Penalty").replace(/^🚩\s*/, "");
        ctx.fillText(_txt, FIELD.W / 2, _by + 44);
        ctx.restore();
      }
    }};
  }

  if (play.kind === "complete" || play.kind === "incomplete" || play.kind === "int") {
    const isScreen = !!play.isScreen;
    // The catch can't happen past the goal line — otherwise the WR catches
    // it past the back of the endzone, then "runs back" to score, which
    // looks ridiculous. Cap catchDepth at distance to the goal.
    const rawCatchDepth = play.catchDepth ?? play.targetDepth ?? 10;
    const catchDepth = Math.min(rawCatchDepth, 100 - play.startYard - 0.5);
    const targetX = losX + dir * catchDepth * FIELD.PX_PER_YARD;
    // Incomplete subtypes — the ball lands somewhere DIFFERENT from the
    // intended target, telling the viewer WHY it was incomplete:
    //   overthrown    → ball sails past receiver (offsetX forward, offsetY up)
    //   underthrown   → ball lands short (offsetX backward, offsetY down)
    //   throwaway     → ball goes WAY off to the sideline
    //   batted        → ball stops near the LOS, drops fast
    //   offtarget     → ball lands a few yards off to the side
    let incOffsetX = 0, incOffsetY = 0, incArcMul = 1.0, incDropFast = false;
    if (play.kind === "incomplete" && play.incReason) {
      const r = play.incReason;
      const sideSign = ((play.startYard * 23) >>> 0) % 2 === 0 ? 1 : -1;
      if (r === "overthrown") {
        incOffsetX = dir * 50;
        incOffsetY = -8;       // ball stays high — overshoot
        incArcMul = 1.20;      // bigger arc
      } else if (r === "underthrown") {
        incOffsetX = -dir * 40;
        incOffsetY = 12;
        incArcMul = 0.75;      // shorter arc
      } else if (r === "throwaway") {
        // Lateral throw to the sideline near the LOS — straight out of bounds
        incOffsetX = -dir * 10;
        incOffsetY = sideSign * 220;
        incArcMul = 0.55;
      } else if (r === "batted") {
        // Stopped at the LOS — ball drops short and fast
        incOffsetX = -dir * (catchDepth * FIELD.PX_PER_YARD - FIELD.PX_PER_YARD * 1.5);
        incOffsetY = 0;
        incArcMul = 0.25;
        incDropFast = true;
      } else if (r === "offtarget") {
        incOffsetX = dir * 15;
        incOffsetY = sideSign * 30;
        incArcMul = 1.0;
      } else if (r === "pd") {
        // PASS DEFLECTION — the THROW is on-target (a catchable ball into
        // the receiver's hands). The deflection is an EVENT at the contact
        // frame, not a bad throw: the defender's hand reaches in and knocks
        // the ball away. So the flight carries NO landing offset (ball flies
        // clean to the WR); the visible "broken up" beat is a sharp pop-and-
        // fall applied in the post-contact branch below. The old −18/+10
        // offset made the ball ease to a spot just short of the WR and drop
        // with no directional change — it read as a generic incompletion,
        // never as a defender swatting the ball.
        incOffsetX = 0;
        incOffsetY = 0;
        incArcMul = 1.0;
      }
    }
    // Pick receiver lane deterministically per play (screens always go to the RB)
    const wrRoll = ((play.startYard * 13 + (play.time||0)) >>> 0) % 100 / 100;
    // PATH B Phase 3b — when engine emits motion with a targetSlot,
    // the animation MUST animate that exact receiver (so the route
    // track lines up, ball flight lands on the right player, and the
    // covering CB shadows the actual catcher). Falls back to the
    // legacy hash for older plays/non-standard kinds.
    const _engineSlot = play.motion && play.motion.targetSlot;
    // Screens used to be hardcoded to wrChoice="rb". Engine can now
    // emit WR screens (play.isWRScreen) with targetSlot=wr1|wr2, so
    // honor the engine slot when it's a valid receiver. Fallback to
    // "rb" preserves the legacy behavior for older plays / paths.
    // Valid when the engine's slot resolves to a real on-field formation
    // slot. Generic lookup (wr1/wr2/wr3/wr4/te/te2/rb — whichever this
    // personnel fielded) so every receiver animates AS ITSELF, with its
    // own jersey, instead of being collapsed onto wr1/wr2/te/rb.
    const _validSlot = !!(_engineSlot && formation[_engineSlot]);
    const wrChoice = isScreen ? (_validSlot ? _engineSlot : "rb")
                   : _validSlot ? _engineSlot
                   : wrRoll < 0.45 ? "wr1"
                   : wrRoll < 0.78 ? "wr2"
                   : wrRoll < 0.92 ? "te"
                   :                  "rb";
    // Screen RB releases to the strong-side flat; normal receivers run their lane
    // Screen side — which sideline the convoy + carrier work toward.
    // For WR screens the side is determined by which WR caught it
    // (wr1 = top sideline, wr2 = bottom). RB screens still hash so
    // the side is deterministic per play but varied.
    const screenSide = wrChoice === "wr1" ? -1
                     : wrChoice === "wr2" ?  1
                     : ((play.startYard * 17) >>> 0) % 2 ? 1 : -1;
    // Derive catchTargetX/Y from the engine-emitted route track when
    // present — so the ball lands EXACTLY where the motion-driven
    // receiver will be at throwT, no last-frame snap. The hardcoded
    // legacy values (cy - 70 for wr1 etc.) ignored the route's
    // lateral break, so the WR would be at one y from motion and
    // the ball arrived at a different y → visible teleport at catch.
    const _wrTrk = (play.motion && play.motion.tracks) ? play.motion.tracks[wrChoice] : null;
    const _wrBase = formation[wrChoice] || formation.rb;
    let _catchTargetY;
    if (_wrTrk && _wrBase && typeof MotionPlayback !== "undefined" && !isScreen) {
      // Sample at engine-emitted throwT (catch moment in action time).
      // This is the same time the WR's motion-driven render samples
      // at the catch frame, so the ball lands exactly where the WR is.
      const _engineThrowT = (play.motion && play.motion.throwT) || 0.56;
      const catchSample = MotionPlayback.sampleTrack(_wrTrk, _engineThrowT);
      if (catchSample) {
        const toMidSign = Math.sign(cy - _wrBase.y) || 1;
        _catchTargetY = _wrBase.y + toMidSign * catchSample.dyYd * FIELD.PX_PER_YARD;
      }
    }
    const targetY = isScreen ? cy + screenSide * 50
                  : _catchTargetY != null ? _catchTargetY
                  : wrChoice === "wr1" ? cy - 70
                  : wrChoice === "wr2" ? cy + 65
                  : wrChoice === "te"  ? cy + 28
                  : wrChoice === "rb"  ? cy - 10
                  : formation[wrChoice] ? formation[wrChoice].y   // slot WR / te2 fallback
                  :                       cy - 10;
    const isComplete = play.kind === "complete";
    // Push TD catches INTO the endzone (~5 yards past the goal line) so
    // the WR runs THROUGH the goal line + celebrates in the EZ instead
    // of stopping right at the white stripe. Real NFL plays use the
    // endzone depth — receiver carries the ball 3-7 yards in.
    const _isTDComplete = isComplete && (play.endYard ?? 0) >= 100;
    // ~3yd into the EZ (was 5yd — put the scorer at the goalpost base on the
    // shallow rendered end zone, so he celebrated on top of the post).
    const _tdEZBonus = _isTDComplete ? dir * 3 * FIELD.PX_PER_YARD : 0;
    const endX = isComplete ? yardToAbsX(play.endYard, poss) + _tdEZBonus : targetX;
    // Which defender picks off the pass on an INT — match the receiver's side
    // 7=cb1 (top), 8=cb2 (bottom), 9=s1 (top safety), 10=s2 (bottom safety).
    // PATH B sweep — on an INT the engine samples defender ∈ {CB 55%,
    // S 35%, LB 10%} and emits the name as `play.defender`. Resolve
    // to the formation index so the visual interceptor matches the
    // named one (was always a CB even when engine credited a safety).
    let intDefIdx = wrChoice === "wr1" ? idxCB1
                  : wrChoice === "wr2" ? idxCB2
                  : (wrChoice === "te" || wrChoice === "te2"
                     || wrChoice === "wr3" || wrChoice === "wr4")
                      ? (targetY < cy ? idxS1 : idxS2)   // slot WR / TE → safety on that side
                  :                       (targetY < cy ? idxLB3 : idxLB1);  // LB for RB checkdown
    // INT: engine emits `defender`. Dropped pick (incomplete with
    // isDroppedPick): engine emits `dropper`. Pass deflection
    // (incomplete, incReason="pd"): engine emits `defender`. Same
    // resolution path — each puts a single named defender at the ball.
    const _isPDPlay = play.kind === "incomplete" && play.incReason === "pd";
    const _intName = (play.kind === "int" && play.defender) ? play.defender
                   : (play.isDroppedPick && play.dropper)   ? play.dropper
                   : (_isPDPlay && play.defender)           ? play.defender
                   : null;
    if (_intName) {
      const resolved = formation.defense.findIndex(d => d && d.name === _intName);
      if (resolved >= 0) intDefIdx = resolved;
    }
    // Lazy-init set for post-catch pursuit limiter — populated on the
    // first frame after the catch, kept stable for the rest of the play
    // so the same defenders continue chasing instead of swapping.
    let _postCatchPursuerSet = null;
    // Diagnostic one-shot guard (see [pass-setup] log below).
    let _dbgPassLogged = false;
    // Sim-driven WR motion post-catch (replaces the time-based linear
    // tween that compressed long YAC into 2.4s of impossible 17-yps
    // sliding). Initialised lazily on the first post-throw render frame.
    let _wrSim = null;
    // WR's actual rendered position on the latest pre-catch frame —
    // captured each frame from the route block. _wrSim initialises HERE
    // (not at the independently-computed targetX/targetY) so the catcher
    // continues smoothly from where the route visually ended. The engine
    // route track and the ball's targetX/targetY are computed separately
    // and can differ by a yard or two laterally; initialising the sim at
    // targetX teleported the WR (and lurched the downfield blockers that
    // target wr.x) on the catch frame.
    let _wrLastX = null, _wrLastY = null;
    // Route velocity (EMA of per-frame deltas, px/frame) — carried into
    // the YAC sim at the catch so the receiver keeps his momentum
    // through the catch instead of decelerating to rest and
    // re-accelerating (the catch "hitch"). This + the route-end position
    // init = the WR is one continuous agent across the catch boundary.
    let _wrVX = 0, _wrVY = 0;
    // Carrier's YAC endpoint — single source of truth for where the
    // ball-carrier ends up, shared by the WR sim AND the guaranteed-
    // tackler convergence so they meet at the SAME spot. Anchored at the
    // actual catch position in the ball block below (not the setup-time
    // targetX/targetY, which the receiver no longer catches at).
    let _yacEndX = null, _yacEndY = null;
    // Downfield-blocker picks. Map from player ref → slot index (0 or 1)
    // for the two non-target offensive players closest to the carrier
    // at the catch. Sticky across the play so the same guys block.
    let _downfieldBlockerMap = null;
    // Trench engagement set (Phase-1 first-principles OL/DL line play).
    // Lazy-init at the first post-snap render frame. Pairs each OL with
    // a non-rusher DL by Y proximity; the breakingRusher (if any) is NOT
    // engaged — he keeps his existing arc/swim/spin path toward the QB.
    // Each frame the engagements step, anchors drift, OL/DL positions
    // emerge. Pocket centroid drives nothing yet — Phase 1.5 will route
    // the QB drop through it. Today we only read positions back.
    let _passPro = null;
    const yac = isComplete ? (play.yac ?? Math.max(0, (play.yards ?? 0) - catchDepth)) : 0;
    // Visual top speed for a WR sprint. ~13 yps is slightly compressed
    // from real NFL top speed (~12) so plays don't feel slow.
    const WR_TOP_YPS_VISUAL = 10.5;  // was 13 (29 mph, exceeded NFL records); matches Tyreek Hill
    const _yacScaleMs = (Math.max(yac, 0) / WR_TOP_YPS_VISUAL) * 1000;
    // Final Y where YAC ends — receiver may drift back toward middle if running upfield
    const finalY = targetY + (cy - targetY) * Math.min(0.5, yac / 40);
    // Pass plays — base duration covers drop + ball flight. Tack on
    // POST_CATCH time for YAC + tackle so the play doesn't end the
    // instant the receiver catches it.
    //
    // SCREEN bug: previously basePass used max(targetDepth, yards, 8)
    // which on a 40-yd screen allocated 5.1s of "flight" for a 2-yd
    // toss behind the LOS, plus a fixed 1.7s POST_CATCH meant the RB
    // had to cover 40 yards in 1.5s. Ball appeared to crawl, then RB
    // teleported downfield. Fix: screens use a SHORT ball flight
    // (~5 yd) and POST_CATCH scaled to actual YAC distance so the
    // post-catch run gets proportional time.
    const passYards = (play.yards ?? 0) + ((play.targetDepth ?? 0) > (play.yards ?? 0) ? 0 : 0);
    const basePass  = isScreen
      ? scaledDuration(5)
      : scaledDuration(Math.max(play.targetDepth ?? 0, play.yards ?? 0, 8));
    // Receiving TDs get extra post-catch time for the celebration banner.
    const isPassTD = play.kind === "complete" && (play.endYard ?? 0) >= 100;
    // First-down catches get a "tackle + get up + signal first down" beat.
    const isFirstDownPassPlay = play.kind === "complete" && !isPassTD
                               && (play.down ?? 0) > 0 && (play.yards ?? 0) >= (play.ytg ?? 0);
    const screenYacMs = isScreen ? scaledDuration(Math.abs(play.yards || 0)) + 600 : 0;
    // POST_CATCH_MS sized to let everything SETTLE before the play ends.
    // Tackle pose engages at aT > 0.78 (or on contact) and needs ~22% of
    // action time to play out a complete fall. Plus secondary pursuers,
    // dive attempts, and blocks need time to land. With the old 1700 ms,
    // the action ended with people still mid-air. 2400 ms is the
    // settle-friendly target for complete passes. First downs add ~600 ms
    // so the get-up + signal beat is visible.
    // POST_CATCH scales with YAC distance so the sim-driven WR has
    // room to traverse the gap at a realistic top speed. The tackle
    // window starts at aT > 0.78, so action_dur * 0.78 must be enough
    // for the WR to cover the YAC distance — adding _yacScaleMs + 1500
    // (1000 ms accel ramp + 500 ms settle) hits that for all yardages.
    // INT return distance is computed in the render closure below from
    // the same seed; mirror it here so POST_CATCH gets enough time for
    // long returns. Without this scaling, a 30-yd return had to fit in
    // 1800 ms = 16 yps average and 48 yps peak with easeOutCubic — pure
    // teleport. Now: ~100 ms per yard at top speed + 1500 ms tackle
    // settle so even 30-yd returns play out at realistic ~10 yps.
    let _intRetDistYds = 0;
    if (play.kind === "int") {
      const _intSeed = ((play.startYard * 7 + (play.targetDepth || 0)) >>> 0) % 100;
      _intRetDistYds = _intSeed < 55 ? (_intSeed % 3)
                     : _intSeed < 85 ? 3 + (_intSeed % 10)
                     :                 13 + (_intSeed % 18);
    }
    const POST_CATCH_MS = isPassTD                  ? Math.max(2400, _yacScaleMs + 1800)
                        : isScreen && play.kind === "complete"  ? screenYacMs
                        : isFirstDownPassPlay       ? Math.max(3000, _yacScaleMs + 1800)
                        : play.kind === "complete"  ? Math.max(2400, _yacScaleMs + 1500)
                        : play.kind === "int"       ? Math.max(1800, _intRetDistYds * 100 + 1500)
                        : play.kind === "incomplete" ? 1800   // ball bounce + roll settle window
                        : 1000;
    const actionDur = basePass + POST_CATCH_MS;
    // When the engine emits motion, IT computes its own throwT (the
    // catch waypoint on the route tracks) from a SLIGHTLY DIFFERENT
    // formula than the renderer's basePass/actionDur ratio (different
    // floor + offset on scaledDuration, different POST_CATCH window).
    // The renderer was sampling track waypoints at its own throwFrac,
    // but the engine's catch waypoint lives at engine.throwT. On a
    // 20-yd throw to a wr1 streak, the render's throwFrac landed at
    // ~75% of the engine catch waypoint — so the WR was at 75% depth
    // (~15 yds) when the renderer fired the post-catch transition,
    // then _wrSim teleported him to the 20-yd catch target. User-
    // visible "WR teleports under the ball" on deep throws.
    // Honor engine's throwT when present so both sides agree on when
    // the catch happens in normalized action time.
    const _engineMotionThrowT = play.motion && typeof play.motion.throwT === "number" ? play.motion.throwT : null;
    const dur = actionDur + PRE_MS;
    PRE = PRE_MS / dur;
    return { duration: dur, kind: play.kind, render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);
      // dropPhase / throwPhase are absolute t values within the full play.
      // The throwPhase now corresponds to the END of the pre-catch portion;
      // remaining action time is YAC + tackle.
      // Use the natural basePass/actionDur ratio for everything. The old
      // hardcoded `throwFrac = 0.78` for screens compounded the basePass
      // bug — it told the play that 78% of action was pre-catch even
      // when basePass was reduced for screens, leaving only 22% for the
      // RB to cover all the YAC.
      // throwFrac defines WHEN the catch happens in normalized action
      // time. Engine motion tracks place their catch waypoint at engine
      // throwT (a slightly different formula). When motion is present
      // we adopt engine throwT so the route track's catch waypoint and
      // the renderer's catch transition fire at the same aT — without
      // this alignment the WR's track sample at render.throwFrac is at
      // an earlier waypoint than the catch target, and _wrSim teleports
      // him forward to the catch position. (See _engineMotionThrowT
      // comment above.) Drop ratio held constant at 0.42 of throwFrac.
      const throwFrac = _engineMotionThrowT != null ? _engineMotionThrowT
                                                    : basePass / actionDur;
      // DIAGNOSTIC (toggle: window.GC_DEBUG_TELEPORT = true). One line per
      // pass play describing the slot resolution + throwT alignment — the
      // two things that determine whether the receiver teleports at the
      // catch. Pair with the [teleport] log in play-render.js's continuity
      // guard to pinpoint the cause. Zero cost when flag is off.
      if (!_dbgPassLogged && typeof window !== "undefined" && window.GC_DEBUG_TELEPORT) {
        _dbgPassLogged = true;
        const _trkKeys = (play.motion && play.motion.tracks) ? Object.keys(play.motion.tracks).join(",") : "(none)";
        console.log(`[pass-setup] kind=${play.kind} target=${play.receiver} engineSlot=${_engineSlot} wrChoice=${wrChoice} validSlot=${_validSlot} motion=${!!play.motion} throwT(engine)=${_engineMotionThrowT != null ? _engineMotionThrowT.toFixed(3) : "null"} throwFrac=${throwFrac.toFixed(3)} catchDepth=${catchDepth.toFixed(1)}yd targetDepth=${play.targetDepth} yac=${yac} wrTrackForChoice=${(play.motion && play.motion.tracks && play.motion.tracks[wrChoice]) ? "yes" : "NO-FALLBACK"} tracks=[${_trkKeys}]`);
      }
      const dropFrac  = throwFrac * 0.42;
      const dropPhase  = PRE + (1 - PRE) * dropFrac;
      const throwPhase = PRE + (1 - PRE) * throwFrac;
      // ACTION-relative time — 0 at snap, 1 at end of play. Use this for any
      // post-snap movement so nobody moves during the pre-snap window.
      // aTRaw is true action time from snap. For flea flickers we delay all of
      // the normal pass-play flow by FLICKER_END so aT (used everywhere else)
      // is the time AFTER the trick has played out.
      const FLICKER_END = 0.25;
      const aTRaw = Math.max(0, (t - PRE) / (1 - PRE));
      const aT = play.isFleaFlicker
        ? Math.max(0, (aTRaw - FLICKER_END) / (1 - FLICKER_END))
        : aTRaw;
      const qb = { ...formation.qb };
      let ballX, ballY = cy;
      let arc = 0;
      // Default ball orientation. Set to the velocity vector during the
      // FLIGHT phase below so the football points where it's going
      // (visible spiral / nose-forward), not stuck in a fixed tilt.
      let ballAngle = -0.35;

      // PATH B Phase 4.3 — engine-emitted drop depth.
      // 3-step (short), 5-step (mid), 7-step (deep / PA). Animation
      // used a fixed 5 for everything; engine now varies by route.
      const _engineDropDepth = play.motion && play.motion.dropDepth;
      const dropDepth = isScreen ? 2 : (typeof _engineDropDepth === "number" ? _engineDropDepth : 5);
      // Dropback uses ease-out so the QB DECELERATES into the pocket
      // spot instead of snapping to a halt at full depth. Linear
      // motion read as "QB stops abruptly" at the apex of the drop.
      const dropProgress = aT > 0 ? Math.min(1, aT / dropFrac) : 0;
      const dropEased    = 1 - Math.pow(1 - dropProgress, 2);   // ease-out quadratic
      const dropAmt      = dropEased * dropDepth * FIELD.PX_PER_YARD;
      qb.x -= dir * dropAmt;
      // FLEA FLICKER — during the trick phase the QB shuffles slightly back
      // and pretends to hand off, then catches the pitch back.
      if (play.isFleaFlicker && aTRaw < FLICKER_END) {
        const fT = aTRaw / FLICKER_END;
        qb.x -= dir * fT * 3 * FIELD.PX_PER_YARD;   // small backward shuffle
        qb.y = cy + Math.sin(fT * Math.PI * 0.5) * 4;   // slight body turn toward RB
      }
      // PLAY-ACTION fake — only during the early action portion (post-snap).
      // Skip if this is a flea flicker — the trick play has its own fake.
      if (play.isPlayAction && !play.isFleaFlicker && aT > 0 && aT < dropFrac * 0.65) {
        const paT = aT / (dropFrac * 0.65);
        const fakeBack = Math.sin(paT * Math.PI) * 6;
        qb.x += dir * fakeBack;
        qb.y = cy + fakeBack;
      }
      // THROW ON THE RUN — QB drifts laterally before/during the throw
      if (play.isTOR && aT > 0) {
        const torT = Math.min(1, aT / throwFrac);
        const lateral = Math.sin(torT * Math.PI * 0.7) * 36;
        qb.y += lateral * (targetY < cy ? -1 : 1);
        qb.x -= dir * 4 * torT;
      }
      // POCKET PRESENCE — composed, high-AWR QBs visibly STEP UP in the
      // pocket and slide off the closing rusher to buy time. Magnitude
      // scales directly with AWR so the on-screen movement matches the
      // sim's qbPocketBonus / qbAwrSackMul advantages a smart QB enjoys:
      //   AWR 65 → 0 yds step (statue, takes the hit)
      //   AWR 80 → ~1.0 yd step + tiny lateral slide
      //   AWR 95 → ~1.8 yd step + visible slide to avoid the rusher
      // Skip on throw-on-the-run (already moving) and flea flicker (handoff
      // animation), and only during the window when the rusher is closing.
      if (!play.isTOR && !play.isFleaFlicker && aT > 0.30 && aT < throwFrac + 0.05) {
        const pocketFactor = clamp((qbAwr - 65) / 30, 0, 1);
        if (pocketFactor > 0.02) {
          const stepWindow = clamp((aT - 0.30) / 0.32, 0, 1);
          const sm = stepWindow * stepWindow * (3 - 2 * stepWindow);
          // Step-up (forward, toward the LOS) — buys time by stepping into
          // the pocket lane the OL has cleared
          qb.x += dir * sm * pocketFactor * 1.8 * FIELD.PX_PER_YARD;
          // Lateral micro-slide — only kicks in for AWR > 78. Direction
          // is deterministic per play so the QB doesn't shimmy randomly.
          const slideFactor = clamp((qbAwr - 78) / 17, 0, 1);
          if (slideFactor > 0) {
            const slideSeed = (((play.startYard * 13) ^ ((play.time || 0) * 5)) >>> 0) & 1;
            const slideDir  = slideSeed ? 1 : -1;
            qb.y += slideDir * sm * slideFactor * 0.55 * FIELD.PX_PER_YARD;
          }
        }
      }

      // Receiver runs route — starts AT the snap, reaches catch point by throwPhase
      const wrBase = wrChoice === "wr1" ? formation.wr1
                   : wrChoice === "wr2" ? formation.wr2
                   : wrChoice === "te"  ? formation.te
                   :                       formation.rb;
      const wr = { ...wrBase };
      // Route progression: 0 → 1 from snap to throwPhase. In press
      // coverage (C0/C1) the route start is delayed by the jam window
      // so the WR is briefly held at the LOS before releasing — the
      // visible "fight off the jam" beat.
      const _cov = play.coverage;
      const _wrIsPressed = (_cov === "C0_BLITZ" || _cov === "C1_MAN") &&
                           (wrChoice === "wr1" || wrChoice === "wr2");
      const _jamDelay = _wrIsPressed ? throwFrac * 0.07 : 0;
      const _effThrow = Math.max(0.001, throwFrac - _jamDelay);
      const routeT = aT > _jamDelay ? Math.min(1, (aT - _jamDelay) / _effThrow) : 0;
      const wrPathX0 = wrBase.x;
      const wrPathY0 = wrBase.y;
      // Route SHAPE varies by play.concept. Old code was a single linear
      // lerp from start to target regardless of concept — every route
      // looked the same. Now each concept has a 2-segment path through
      // a CONTROL POINT, so slants break diagonally inside, digs go
      // straight then 90° break, drags run shallow + lateral, etc.
      // All concepts still end at (targetX, targetY) so the ball lands
      // where it should.
      const _conc = play.concept || "VERTICAL";
      // Control point as fraction of (path depth, path lateral) — defines
      // where the receiver is at the BREAK point of the route.
      const ctrl =
            _conc === "QUICK_GAME"   ? { breakT: 0.30, depthF: 0.40, latF: 0.0 }   // slant: 4-step then break IN
          : _conc === "DRAG_MESH"    ? { breakT: 0.30, depthF: 0.20, latF: -0.5 }  // shallow + cross toward midfield
          : _conc === "INTERMEDIATE" ? { breakT: 0.72, depthF: 1.0,  latF: 0.0 }   // vertical stem, sharp break
          : _conc === "VERTICAL"     ? { breakT: 0.95, depthF: 0.95, latF: 0.0 }   // straight line
          : _conc === "PA_SHOT"      ? { breakT: 0.95, depthF: 0.95, latF: 0.0 }
          : _conc === "SCREEN"       ? null
          :                            { breakT: 0.95, depthF: 0.95, latF: 0.0 };
      // PATH B Phase 3b — engine-emitted route track wins if present.
      // dyYd in the track is "yards toward midfield", so animation
      // projects with sign(cy - formationY). Falls back to legacy
      // concept-driven ctrl logic otherwise. Phase 4 keys tracks by
      // slot (tracks.wr1 / wr2 / te / rb), so we read directly.
      const _wrMotionTrack = (play.motion && play.motion.tracks)
        ? play.motion.tracks[wrChoice] : null;
      if (_wrMotionTrack && typeof MotionPlayback !== "undefined") {
        // Sample at action time (aT) — engine waypoints are in the same scale.
        const sample = MotionPlayback.sampleTrack(_wrMotionTrack, aT);
        if (sample) {
          const toMidSign = Math.sign(cy - wrPathY0) || 1;
          // REFERENCE-FRAME FIX. Route dxYd is "yards downfield from the
          // LOS" (route-depth convention — every shape quotes depth from
          // the line). But a BACKFIELD slot starts well behind the LOS:
          // formation.rb.x = losX − 8yd, fb ≈ −7yd. Projecting dxYd
          // straight off the slot X landed the catch ~8yd short (behind
          // the LOS), so the ball homed too short ("looked like a 3-yd
          // throw") and the post-catch sim had to absorb the missing 8yd
          // as extra YAC — a fast diagonal slide that read as a lateral
          // TELEPORT (reported on RB checkdowns/swings). WR/TE slots sit
          // on the LOS so the gap is ~0 and they were always fine; the
          // ctrl-fallback path already used the LOS-relative targetX, so
          // only this engine-track branch carried the bug.
          //
          // Remap for backfield slots: ramp the backfield gap in over the
          // pre-catch (depth) phase so dxYd=0 → backfield (no snap jump)
          // and dxYd=catchDepth → LOS+catchDepth (catch agrees with the
          // ball aim). Past the catch, YAC runs 1:1 in LOS-relative space
          // so dxYd=catchDepth+yac → endX exactly.
          const _bfGapYd = (losX - wrPathX0) * dir / FIELD.PX_PER_YARD;
          if (_bfGapYd > 1) {
            if (sample.dxYd <= catchDepth) {
              const _frac = catchDepth > 0.01 ? sample.dxYd / catchDepth : 0;
              const _catchX = losX + dir * catchDepth * FIELD.PX_PER_YARD;
              wr.x = wrPathX0 + (_catchX - wrPathX0) * _frac;
            } else {
              wr.x = losX + dir * sample.dxYd * FIELD.PX_PER_YARD;
            }
          } else {
            wr.x = wrPathX0 + dir * sample.dxYd * FIELD.PX_PER_YARD;
          }
          wr.y = wrPathY0 + toMidSign * sample.dyYd * FIELD.PX_PER_YARD;
        }
      } else if (ctrl) {
        const midX = wrPathX0 + (targetX - wrPathX0) * ctrl.depthF;
        // latF interpolates between (start Y = 0) and (cy = 1, midfield).
        const midY = wrPathY0 + (cy - wrPathY0) * ctrl.latF;
        if (routeT < ctrl.breakT) {
          const p = routeT / ctrl.breakT;
          wr.x = wrPathX0 + (midX - wrPathX0) * p;
          wr.y = wrPathY0 + (midY - wrPathY0) * p;
        } else {
          const p = (routeT - ctrl.breakT) / (1 - ctrl.breakT);
          wr.x = midX + (targetX - midX) * p;
          wr.y = midY + (targetY - midY) * p;
        }
      } else {
        // SCREEN — keep the existing linear handling
        wr.x = wrPathX0 + (targetX - wrPathX0) * routeT;
        wr.y = wrPathY0 + (targetY - wrPathY0) * routeT;
      }
      // SIDELINE SAFETY CLAMP — keep the receiver inside the field
      // bounds. Catches any route-track lateral value that would put
      // the WR past the sideline (e.g., the old DRAG_MESH wr2 bug, or
      // any future shape that overshoots).
      const _sideMargin = 8;
      wr.y = Math.max(FIELD.TOP + _sideMargin, Math.min(FIELD.BOT - _sideMargin, wr.y));
      // Capture the WR's actual rendered position AND velocity so _wrSim
      // can init from both (continuity + momentum across the catch).
      // POST-CATCH FREEZE: only update _wrLastX during the route phase.
      // Once we're past throwPhase, _wrLastX must stay at the catch-frame
      // value — the post-catch branch reads _catchX = _wrLastX and uses
      // it to compute _carrySign for the overshoot clamp. If we keep
      // updating _wrLastX to the route's still-advancing projection,
      // _carrySign flips when the route crosses _effEndX, the clamp
      // fires incorrectly, and _wrSim teleports back to _effEndX
      // (the late-YAC f421-f534 jump).
      if (t < throwPhase) {
        if (_wrLastX != null) {
          _wrVX = _wrVX * 0.6 + (wr.x - _wrLastX) * 0.4;   // px/frame, smoothed
          _wrVY = _wrVY * 0.6 + (wr.y - _wrLastY) * 0.4;
        }
        _wrLastX = wr.x; _wrLastY = wr.y;
      }

      // Throw style — TOUCH lobs high+slow, ZIP fires low+fast, DEEP arcs even higher
      const throwType = play.throwType || (isScreen ? "CHECKDOWN" : "TOUCH");
      const arcHeight = isScreen ? 12
                      : throwType === "ZIP"       ? 18
                      : throwType === "CHECKDOWN" ? 22
                      : throwType === "DEEP"      ? 95
                      : 55;  // TOUCH default
      // ZIP throws compress the throw window so the ball arrives faster
      const flightCurve = throwType === "ZIP" ? (x => x * x) : (x => x);
      // Action time and key moments (all 0-1 within action portion).
      // These align with the QB pose timeline above — all scaled by throwFrac
      // so hands and ball stay synced when the catch happens earlier in action.
      // Use the flicker-aware aT so ball/QB phases stay synced when flea
      // flicker delays the normal throw flow.
      const at = aT;
      const snapMotionAT = 0.04;             // ball travels C→QB in first 4% of action
      // Phase timing (within action time). Must stay in sync with the
      // QB throw pose timeline below (~tf*0.73 release, tf*1.0 follow-
      // through). Moving releaseAT earlier without shifting the QB
      // pose caused the ball to leave the hand before the throwing
      // motion started — reverted.
      // Throw timing — release moved earlier so the FLIGHT phase is
      // longer in absolute time. Was 0.27 of throwFrac → flight covered
      // 15 yd in ~470 ms = 32 yps = ~75 mph. NFL passes are 50-60 mph.
      // Now 0.45 of throwFrac → ~780 ms for 15 yd = ~45 mph. Slower,
      // visible, matches "I can track the ball" feel.
      const dropEndAT  = throwFrac * 0.25;   // dropback ends here
      const cockHoldAT = throwFrac * 0.48;   // ball reaches the ear, "held cocked"
      const releaseAT  = throwFrac * 0.55;   // ball leaves the hand (matches QB pose)
      const throwEndAT = throwFrac;          // ball arrives at WR
      // Ball-in-hand positions
      const releaseX = qb.x + dir * 1.5;
      const releaseY = cy - 14;
      const cradleX = qb.x;
      const cradleY = cy - 3;
      // Center position (front of OL) — where the ball is pre-snap
      const centerX = losX - dir * 2;
      const centerY = cy;
      // RB position during the flea flicker — runs forward, pivots, pitches back
      const rbBase = formation.rb;
      const rbForwardMax = rbBase.x + dir * 5 * FIELD.PX_PER_YARD;
      let flickerRBX = rbBase.x, flickerRBY = rbBase.y;
      if (play.isFleaFlicker && aTRaw < FLICKER_END) {
        const fT = aTRaw / FLICKER_END;
        if (fT < 0.40) {
          // RB sprints toward the LOS
          const p = fT / 0.40;
          flickerRBX = rbBase.x + (rbForwardMax - rbBase.x) * p;
          flickerRBY = cy;
        } else if (fT < 0.60) {
          // RB plants at max forward, pivots
          flickerRBX = rbForwardMax;
          flickerRBY = cy;
        } else {
          // RB stays as a decoy
          flickerRBX = rbForwardMax;
          flickerRBY = cy;
        }
      }
      if (t < PRE) {
        // Pre-snap: ball sits in the center's hands, ready to be snapped
        ballX = centerX; ballY = centerY;
      } else if (play.isFleaFlicker && aTRaw < FLICKER_END) {
        // FLEA FLICKER ball path: C→QB (snap) → QB→RB (handoff) → RB carries
        // forward → RB→QB (pitch back) → QB cradles.
        const fT = aTRaw / FLICKER_END;
        if (fT < 0.08) {
          // Snap from center to QB
          const sm = (fT / 0.08);
          ballX = centerX + (cradleX - centerX) * sm;
          ballY = centerY + (cradleY - centerY) * sm;
        } else if (fT < 0.30) {
          // Handoff: ball travels from QB to RB
          const p = (fT - 0.08) / 0.22;
          const sm = p * p * (3 - 2 * p);
          ballX = cradleX + (flickerRBX - cradleX) * sm;
          ballY = cradleY + (flickerRBY - cradleY) * sm;
        } else if (fT < 0.50) {
          // Ball with RB as he runs forward
          ballX = flickerRBX;
          ballY = flickerRBY - 1;
        } else if (fT < 0.80) {
          // Pitch back: ball travels back from RB to QB
          const p = (fT - 0.50) / 0.30;
          const sm = p * p * (3 - 2 * p);
          ballX = flickerRBX + (cradleX - flickerRBX) * sm;
          // High lateral arc
          ballY = flickerRBY + (cradleY - flickerRBY) * sm - Math.sin(p * Math.PI) * 8;
        } else {
          // QB cradles the pitch
          ballX = cradleX;
          ballY = cradleY;
        }
      } else if (at < snapMotionAT) {
        // SNAP! Ball travels from center back to the QB
        const snapT = at / snapMotionAT;
        const sm = snapT * snapT * (3 - 2 * snapT);
        ballX = centerX + (cradleX - centerX) * sm;
        ballY = centerY + (cradleY - centerY) * sm;
      } else if (at < dropEndAT) {
        // Dropback: ball cradled at chest with both hands
        ballX = cradleX;
        ballY = cradleY;
      } else if (at < cockHoldAT) {
        // COCK: ball rises from chest up-behind-helmet to the cocked ear position
        const cockT = (at - dropEndAT) / (cockHoldAT - dropEndAT);
        const sm = cockT * cockT * (3 - 2 * cockT);
        ballX = cradleX + sm * (releaseX - cradleX);
        ballY = cradleY + sm * (releaseY - cradleY);
      } else if (at < releaseAT) {
        // HOLD AT EAR — ball locked at the cocked position (Brady frame)
        ballX = releaseX;
        ballY = releaseY;
      } else if (at < throwEndAT) {
        // FLIGHT: from cocked hand position out to the target. For
        // incompletes the actual flight target is offset (overthrown
        // sails long, underthrown lands short, throwaway flies OOB,
        // batted barely makes it past the LOS).
        const ttRaw = (at - releaseAT) / (throwEndAT - releaseAT);
        const tt = flightCurve(ttRaw);
        // COMPLETE passes home the ball to the receiver's ACTUAL catch
        // position (his live route-end, _wrLast) — NOT the abstract
        // targetX/targetY the throw was aimed at. Since the receiver now
        // catches at his route-end (continuity fix), aiming the ball at
        // the static target made the descending arc sail OVER/BESIDE him
        // and then snap to his chest at the catch ("sailed over his head
        // but caught it"). Incompletes keep target + miss offset (the
        // ball is SUPPOSED to land where the receiver isn't).
        const _homeToRcvr = play.kind === "complete" && _wrLastX != null;
        const flightTX = _homeToRcvr ? _wrLastX : (targetX + incOffsetX);
        const flightTY = _homeToRcvr ? _wrLastY : (targetY + incOffsetY);
        ballX = releaseX + (flightTX - releaseX) * tt;
        // Arc lands at HAND/HEAD height, not feet. Original parabola
        // dropped to 0 at catch, so the ball arrived at the receiver's
        // chest. NFL catches are at HAND HEIGHT (above the head), so
        // we add a linear ascent term that ramps the ball UP to ~14px
        // above field-y by tt=1 — matches the receiver's reach-arm
        // tip position. Reduced for batted / underthrown so those land
        // at the right (low) height.
        // handElev raises the ball to the carrier's HAND/CHEST height at
        // tt=1 so it arrives where the carry-hand sink will hold it (no
        // snap at the catch). The sprite body is ~92px tall (chest ≈ 46px
        // above the foot origin) vs the shorter procedural body (chest
        // ≈ 14px), so pick the elevation to match whichever is active.
        const _spriteHands = (typeof SpriteAtlas !== "undefined" && SpriteAtlas.anyLoaded());
        const _chestElev = _spriteHands ? 46 : 14;
        const handElev = incDropFast ? 0
                       : _homeToRcvr  ? _chestElev
                       : (incOffsetY < 0 ? 18 : 14);
        arc = Math.sin(tt * Math.PI) * arcHeight * incArcMul + tt * handElev;
        ballY = releaseY + (flightTY - releaseY) * tt - arc;
        // Spiral orientation — ball nose points along the velocity vector.
        // The flight ball is drawn with its LONG AXIS ALONG Y (ellipse
        // 8x14, ry>rx), so the tip sits at (0, ±ry) before rotation.
        // To align tip with velocity (vx,vy), rotate by atan2(vx, -vy)
        // (not atan2(vy, vx) — that aligned the SHORT axis with velocity,
        // which is why the ball came out sideways).
        const vx = flightTX - releaseX;
        const vy = (flightTY - releaseY) - Math.cos(tt * Math.PI) * Math.PI * arcHeight * incArcMul - handElev;
        ballAngle = Math.atan2(vx, -vy);
      } else {
        const tt = (t - throwPhase) / (1 - throwPhase);
        if (play.kind === "complete") {
          // After catch: ball + receiver travel together to (effEndX, finalY).
          //
          // MINIMUM VISUAL CARRY: 0-YAC catches (leaps, contested grabs) had
          // endX == targetX, so the formula put the receiver at the catch
          // spot and left him there. Visually that's a freeze ("WR catches
          // it then stands still until the tackle pose engages and he falls
          // backward"). Real receivers always carry 1-2 yd from momentum
          // even on contested catches — the box score doesn't track it,
          // but the visual needs it for continuity.
          // Anchor the YAC at the ACTUAL catch spot (route-end _wrLast),
          // not the setup-time target — the receiver catches at _wrLast,
          // so the min-carry threshold and the lateral YAC end must be
          // measured from there too (else the carrier slides to a finalY
          // anchored at a spot he never occupied).
          const _catchX = (_wrLastX != null) ? _wrLastX : targetX;
          const _catchY = (_wrLastY != null) ? _wrLastY : targetY;
          const _minCarryPx = 1.5 * FIELD.PX_PER_YARD;
          const _raw = endX - _catchX;
          const _effEndX = Math.abs(_raw) >= _minCarryPx
                         ? endX
                         : _catchX + dir * _minCarryPx;
          // YAC end Y anchored at the catch spot. Drifts toward midfield
          // by the same fraction the old setup-time finalY used.
          const _simFinalY = _catchY + (cy - _catchY) * Math.min(0.5, yac / 40);
          _yacEndX = _effEndX; _yacEndY = _simFinalY;
          // SIM-DRIVEN WR motion. Accelerates from rest at the catch
          // position, caps at WR_TOP_YPS_VISUAL, runs toward _effEndX.
          // Replaces the time-based linear tween that forced impossible
          // 15+ yps motion on long YAC and made the legs slide rather
          // than match foot strikes. The tween fallback runs only if
          // SimPlayer is unavailable.
          if (!_wrSim && typeof SimPlayer !== "undefined") {
            // Init at the WR's actual route-end position (continuity), not
            // the independently-computed targetX/targetY which can differ
            // and cause a catch-frame teleport.
            const _maxV = WR_TOP_YPS_VISUAL * FIELD.PX_PER_YARD;
            _wrSim = new SimPlayer(
              _wrLastX != null ? _wrLastX : targetX,
              _wrLastY != null ? _wrLastY : targetY, {
              maxSpeed: _maxV,
              accel:    10 * FIELD.PX_PER_YARD,   // ~1s to top speed
            });
            // MOMENTUM CARRY-THROUGH — seed the sim with the receiver's
            // route velocity (px/frame → px/sec at 60fps), capped at the
            // sim's top speed, so a deep ball caught in stride keeps
            // running instead of stopping dead and re-accelerating. A
            // receiver who was stationary at the catch (hitch/comeback)
            // seeds ~0 and accelerates from rest, which is correct.
            const _routeVpx = Math.hypot(_wrVX, _wrVY) * 60;   // px/sec
            if (_routeVpx > 1) {
              const _spd = Math.min(_routeVpx, _maxV);
              _wrSim.vx = (_wrVX / Math.hypot(_wrVX, _wrVY)) * _spd;
              _wrSim.vy = (_wrVY / Math.hypot(_wrVX, _wrVY)) * _spd;
            }
          }
          if (_wrSim) {
            _wrSim.stepTowardAt(_effEndX, _simFinalY, performance.now());
            // Clamp to not overshoot the engine's yardage. Without this
            // the sim cruises past _effEndX (no deceleration logic) and
            // the visible tackle spot disagrees with play.endYard.
            // dir-aware comparison handles both +X and -X offenses; the
            // Math.sign(_effEndX - _catchX) form also handles backward-
            // YAC completes (engine-emitted loss past the catch).
            const _carrySign = Math.sign(_effEndX - _catchX) || dir;
            if ((_wrSim.x - _effEndX) * _carrySign > 0) {
              _wrSim.x = _effEndX;
              _wrSim.vx = 0;
            }
            // Also clamp Y so the stride frequency (hypot(vx,vy)) drops
            // to zero at the tackle point — otherwise lateral drift
            // keeps the legs cycling after the body has stopped.
            if (Math.abs(_wrSim.y - _simFinalY) < 4) {
              _wrSim.y = _simFinalY;
              _wrSim.vy = 0;
            }
            ballX = _wrSim.x;
            ballY = _wrSim.y;
          } else {
            ballX = targetX + (_effEndX - targetX) * tt;
            ballY = targetY + (finalY - targetY) * tt;
          }
          // Receiver carries the ball — keep them locked together.
          // _wrLastX is FROZEN at the catch-frame value (gated at line
          // ~4010), so the overshoot clamp at line ~4233 uses the catch
          // position as its anchor — not the still-projecting route.
          wr.x = ballX;
          wr.y = ballY;
        } else if (play.kind === "incomplete" && play.incReason === "pd") {
          // DEFLECTION — the ball arrived on-target at the WR's hands
          // (targetX, targetY at hand height); the defender's hand knocks
          // it away HERE, at the contact frame. The visible beat: the ball
          // pops UP off the swat, then tumbles down to the turf and drifts
          // AWAY from the receiver (lateral, swat side). The sharp pop-and-
          // fall — a kink in the path at contact — is what reads as "broken
          // up" instead of the smooth ease-and-drop of a generic miss.
          // Heights are screen-px above the field spot (larger = higher).
          let h;
          if (tt < 0.15)       { h = 14 + (tt / 0.15) * 20; }              // 14 → 34: knocked UP off the hand
          else if (tt < 0.55)  { const u = (tt - 0.15) / 0.40; h = 34 * (1 - u); } // 34 → 0: falls to the turf
          else                 { const u = (tt - 0.55) / 0.45; h = Math.sin(u * Math.PI) * 6; } // small settle bounce
          // Lateral knock (swat direction) + a touch back toward the LOS,
          // eased so the kink is sharp at contact then settles. Recompute
          // the swat side locally — the `sideSign` used during flight is
          // block-scoped to the incOffset block above and isn't visible here.
          const _swatSide = ((play.startYard * 23) >>> 0) % 2 === 0 ? 1 : -1;
          const _drift = 1 - Math.exp(-3 * tt);
          ballX = targetX - dir * 16 * _drift;
          ballY = targetY - h + _swatSide * 34 * _drift;
          // Fast tumble on the swat, settling flat as it stops.
          ballAngle = (tt * 14) * Math.max(0, 1 - tt * 1.4);
        } else if (play.kind === "incomplete") {
          // BOUNCE + ROLL — ball hits the turf, bounces 3 times with
          // diminishing amplitude, then rolls to a stop. Was a static
          // drift-and-sink over 250ms. POST_CATCH_MS for incomplete
          // was extended to 1800ms to give the settle window room.
          //
          // Phase model (tt is normalized post-catch time 0→1):
          //   tt 0.00 → 0.55: 3 bounces, amplitudes 14 / 6.3 / 2.8 px
          //   tt 0.55 → 1.00: rolling, friction decays forward motion
          // Forward roll: exponential decay (asymptotes to landX + maxRoll).
          const landX = targetX + incOffsetX;
          const landY = targetY + incOffsetY;
          const maxRollPx = 60;
          const xProg = 1 - Math.exp(-2.5 * tt);
          ballX = landX + dir * maxRollPx * xProg;
          // Vertical arc: 3 bounces with damping (each ~45% of prior).
          let arc = 0;
          const bounceWindow = 0.55;
          if (tt < bounceWindow) {
            const bounceT = tt / bounceWindow;       // 0-1 across all 3 bounces
            const bounceIdx = Math.floor(bounceT * 3);
            const localT = (bounceT * 3) - bounceIdx;
            const amp = 14 * Math.pow(0.45, bounceIdx);
            arc = Math.sin(localT * Math.PI) * amp;
          }
          ballY = landY - arc;
          // Tumble spin — ball spins fast on impact, settles to flat
          // as it stops rolling.
          const spinFalloff = Math.max(0, 1 - tt * 1.5);
          ballAngle = (tt * 12) * spinFalloff;
        } else {
          // INT — defender catches the ball. Return distance varies:
          // ~55% short (0-2 yds, WR tackles immediately), 30% medium (3-12 yds),
          // 15% long return (13-30 yds, defender gets loose)
          const seed = ((play.startYard * 7 + (play.targetDepth||0)) >>> 0) % 100;
          const retDistYds = seed < 55 ? (seed % 3)
                           : seed < 85 ? 3 + (seed % 10)
                           :             13 + (seed % 18);
          const retEndX = targetX - dir * retDistYds * FIELD.PX_PER_YARD;
          const retEndY = targetY + (targetY < cy ? -10 : 10);
          // Use the same accel + linear cruise pacing as the run carrier
          // instead of easeOutCubic. easeOutCubic peaked at 3× avg speed
          // at the catch instant — a 30-yd return had to start at ~48
          // yps to satisfy the time budget. With runPacing the defender
          // ramps up over ~15% time then cruises linearly. POST_CATCH_MS
          // is now sized to retDistYds so the cruise stays at ~10 yps.
          const _postCatchMs = (1 - throwPhase) * dur;
          const _retProg = runPacing(tt, _postCatchMs);
          ballX = targetX + (retEndX - targetX) * _retProg;
          ballY = targetY + (retEndY - targetY) * _retProg;
          // WR converges on the picking defender to make the tackle. The
          // *1.4 hurry-factor was fine when post-catch was 1800ms, but
          // with the scaled longer window the WR was visibly outrunning
          // the int defender. Drop to 1.15 so the convergence speed is
          // proportional and the WR still arrives ahead of the tackle
          // window's end.
          const wrTackleX = ballX + dir * 6;
          const wrTackleY = ballY + (targetY < cy ? 4 : -4);
          wr.x = targetX + (wrTackleX - targetX) * Math.min(1, tt * 1.15);
          wr.y = targetY + (wrTackleY - targetY) * Math.min(1, tt * 1.15);
        }
      }

      // Defense: rush + DBs cover (and one closes on the ball-carrier post-catch)
      // On a sack/pressure (we don't know that here without checking play.kind), 1 DL breaks through.
      // For incomplete/INT, DL stay engaged with OL.
      const breakingRusher = play.kind === "complete" && (play.yards ?? 0) > 5 ? -1
                           : play.kind === "incomplete" ? -1
                           : 1;  // one rusher breaks through on tight throws/INTs
      // TACKLE EVENT — single source of truth for "who falls on the tackle".
      // Computed once per play. The defender map below consults this at the
      // end of each iteration to override per-defender pose to "hit" when
      // (a) named tackler, (b) the guaranteed cover defender, or (c) any
      // pursuer in contact during the tackle window. This replaces the
      // three scattered pose-decision branches that used to disagree about
      // who got "hit" vs "engage" vs the broken "tackle" pose.
      const TACKLE_START_AT = 0.78;
      const _carrierVx = (endX - targetX) / Math.max(0.1, (1 - throwPhase) * dur / 1000);
      const tackleEvent = {
        fallStartT: TACKLE_START_AT,
        primaryTacklerName: (play.motion && play.motion.tacklerName) || null,
        intDefIdx,
        carrierVx: _carrierVx,
        contactDist: 16,   // a hair more lenient than the sim's CONTACT_DIST=10
      };
      // ── PHASE-1 TRENCH ──
      // Build the OL↔DL engagement set on the first post-snap frame, step
      // it each frame BEFORE def/off maps run so both maps read fresh
      // positions. The pairing pairs every OL with the closest non-rusher
      // DL by Y (the breakingRusher keeps his own arc/swim/spin path).
      // With 5 OL vs ~3 non-rusher DL, two OL share a DL — double-team feel.
      if (t > PRE && _passPro == null && typeof PassProSim !== "undefined") {
        _passPro = new PassProSim({ dir, losX });
        const ols = formation.offense.filter(x => x.role === "OL");
        const dls = formation.defense.filter((x, j) =>
          x.role === "DL" && j !== breakingRusher);
        for (const ol of ols) {
          let best = null, bestDY = Infinity;
          for (const dl of dls) {
            const dy = Math.abs(dl.y - ol.y);
            if (dy < bestDY) { bestDY = dy; best = dl; }
          }
          if (best) {
            const eng = _passPro.addPair(ol, best, {
              // lanePx shapes the pocket cup — tackles (±64px off center)
              // set deepest and widen, the center (~0) holds firmest.
              lanePx: ol.y - cy,
              // Leverage seeded from play.pressure (-1.5..1.9). Negative
              // leverage = the rush winning → the blocker (and pocket)
              // drifts back toward the QB. Mapped to ±0.7 and combined
              // with a higher driftPx so the pocket compression is
              // actually READABLE on a pressured dropback (the prior
              // 0.25×/0.55 produced ~0.5yd of give — invisible).
              leverage: Math.min(0.7, Math.max(-0.7, -(play.pressure || 0) * 0.42)),
              driftPx: 0.95,
              wobble: 1.0,
              pull: 0.30,
            });
            // Stash for quick lookup in OL render below; cleared at play end.
            ol._eng = eng;
            best._eng = eng;
          }
        }
      }
      if (_passPro) _passPro.step(performance.now());
      const def = formation.defense.map((d, i) => {
        const dd = { ...d };
        dd.t = (t < 0.95 ? ((performance.now() / 333) + i * 0.13) % 1 : 0);
        dd.facing = -dir;
        // Coverage shell — declared ONCE at map scope so every block (pre-snap
        // depth, CB bail, LB/safety rotation + zone read-break) shares it. The
        // rotation/read-break blocks below referenced `cov` but it was only
        // declared inside the pre-snap and CB blocks — so post-snap they threw
        // ReferenceError every frame, which the render try/catch swallowed,
        // freezing the play at the formation ("offense never snaps").
        const cov = play.coverage;
        // Pre-snap: hold stance + apply coverage-aware depth alignment.
        // play.coverage was unused beyond the broadcast UI label. Now
        // drives CB / S depth so each coverage VISUALLY differs:
        //   C0_BLITZ:  CBs press (2yd), Ss walked up (5yd)
        //   C1_MAN:    CBs press, 1S deep (14yd) + 1S box (6yd)
        //   C2_ZONE:   CBs at 4yd, both Ss deep wide (12yd)
        //   TAMPA_2:   like C2 but MLB drops post-snap (still 12/4)
        //   C3_ZONE:   CBs off 8yd, 1S deep middle 14yd, 1S 8yd
        //   C4_QUARTERS: CBs deep 10yd, both Ss deep 12yd
        if (t < PRE) {
          const sh = defShiftXY(i, t);
          let dx = sh.dx, dy = sh.dy;
          if (cov && (d.role === "CB" || d.role === "S" || d.role === "NB")) {
            const pxPerYd = FIELD.PX_PER_YARD;
            const baseX = losX;
            const cbDepth =
                  (cov === "C0_BLITZ" || cov === "C1_MAN") ? 2
                : (cov === "C2_ZONE"  || cov === "TAMPA_2") ? 4
                : (cov === "C3_ZONE")     ? 8
                : (cov === "C4_QUARTERS") ? 10
                : null;
            const safDepth = (idxS) => {
              if (cov === "C0_BLITZ") return 5;
              if (cov === "C1_MAN")   return (i === idxS1) ? 14 : 6;
              if (cov === "C2_ZONE" || cov === "TAMPA_2") return 12;
              if (cov === "C3_ZONE")     return (i === idxS1) ? 14 : 8;
              if (cov === "C4_QUARTERS") return 12;
              return null;
            };
            if (d.role === "CB" && cbDepth != null) {
              dx = (baseX + dir * cbDepth * pxPerYd) - d.x;
              // PRESS — CB1/CB2 also align their Y to their assigned WR
              // so they're nose-to-nose at the snap, not at their formation
              // home slot. Only for press depths (≤4yd).
              if (cbDepth <= 4) {
                const wrTarget = (i === idxCB1) ? formation.wr1
                              : (i === idxCB2) ? formation.wr2
                              : null;
                if (wrTarget) dy = (wrTarget.y - d.y);
              }
            } else if (d.role === "S") {
              // TWO-HIGH DISGUISE — pre-snap, the safeties show a generic
              // balanced two-high shell (both ~11yd deep, split to the
              // hashes) instead of their TRUE post-snap landmark. Real
              // defenses disguise the coverage; pre-aligning each safety at
              // its post-snap depth (one at 14yd middle, one at 8yd) gave
              // the shell away before the snap and erased the rotation. The
              // post-snap track (engine) then rotates them from this shared
              // look to the real spots, so single-high (C3/C1, one safety
              // spins to the deep middle) reads distinctly from two-high
              // (C2/C4, they hold). Blitz still walks the SS down (the
              // pressure look is intentional, not a disguise).
              if (cov === "C0_BLITZ") {
                const depth = safDepth(i);
                if (depth != null) dx = (baseX + dir * depth * pxPerYd) - d.x;
              } else {
                dx = (baseX + dir * 11 * pxPerYd) - d.x;
                dy = ((i === idxS1) ? -1 : 1) * 9 * pxPerYd - (d.y - cy);
              }
            }
          }
          dd.x = d.x + dx;
          dd.y = d.y + dy;
          dd.pose = isDefShifting(i, t) ? "run" : (isDefPointer(i) ? "point" : "stance");
          return dd;
        }
        // Carry the LAST RENDERED position forward as dd's starting basis,
        // so post-snap branches that read dd.x as a baseline (CB follow
        // init at d._cbFollowX = dd.x, zone-bail ease from dd.x, etc.)
        // don't snap back to formation home on the first post-snap frame.
        // _syncDefRendered captures the pre-snap rendered position
        // (coverage-adjusted CB press, walked-up safety, etc.) at the end
        // of the prior frame. Without this, the CB jumps 5-9 yards
        // laterally from the press alignment back to formation slot, then
        // starts the follow logic from there — the f131→132 pass-play
        // snap teleport. Subsequent dd.x assignments below override as
        // usual; this just sets the initial value.
        if (typeof d._lastRenderedX === "number") {
          dd.x = d._lastRenderedX;
          dd.y = d._lastRenderedY;
        }
        dd.pose = "run";
        if (i < 4) {
          // Breaking rusher chases the QB throughout — DON'T cut him off at
          // the throw, or his position snaps back to the original DL spot
          // (the "teleport" bug). Other DL only animate through the rush
          // phase, since they're held up at the LOS and barely move anyway.
          const tt = Math.min(1, aT / 0.55);
          if (i === breakingRusher) {
            // Path shape varies by dlMove — the rusher's PATH to the QB
            // reflects HOW they beat the OL. play.dlMove was sitting
            // unused beyond a text callout; now drives the actual chase
            // geometry. 5 visual categories pulled from the 15 archetype
            // moves.
            const move = play.dlMove || "";
            const moveCat = /SPEED|GET-OFF|GHOST/.test(move) ? "SPEED"
                          : /SWIM|ARM-OVER|CROSS/.test(move)  ? "SWIM"
                          : /SPIN|COUNTER/.test(move)         ? "SPIN"
                          : /DIP|CLUB/.test(move)             ? "DIP"
                          : "BULL";   // bull rush / long arm / stab / pierce / hand fight (default)
            const baseX = d.x + (qb.x - d.x) * tt * 0.85;
            const baseY = d.y + (qb.y - d.y) * tt * 0.6;
            let pathDX = 0, pathDY = 0;
            if (moveCat === "SPEED") {
              // Wide outside arc — peel AWAY from QB lateral first, swing in late.
              const arc = Math.sin(tt * Math.PI);
              const outSide = (d.y > qb.y ? 1 : -1);
              pathDY = outSide * arc * 14;
            } else if (moveCat === "SWIM") {
              // Brief lateral bump during the engagement phase only
              const eng = tt < 0.35 ? Math.sin((tt / 0.35) * Math.PI) : 0;
              pathDY = (d.y > qb.y ? -1 : 1) * eng * 9;
            } else if (moveCat === "SPIN") {
              // Zigzag laterally — spinning past the OL
              pathDY = Math.sin(tt * Math.PI * 2.5) * 7 * (1 - tt * 0.5);
            } else if (moveCat === "DIP") {
              // Lower, tighter line — drops the body and rips through
              pathDY = -Math.sin(tt * Math.PI * 0.8) * 4;
            }
            // BULL: no offset, straight bull-line through the OL
            dd.x = baseX + pathDX;
            dd.y = baseY + pathDY;
            // After release, the rusher arrives in the QB's face and engages
            dd.pose = aT > throwFrac ? "engage" : "run";
            // Breaking rusher's archetype: prefer play.dlType (specific
            // DL who beat his man) if present, else hash by position.
            dd.archetype = (play.dlType && _DL_ARCH.indexOf(play.dlType) >= 0)
              ? play.dlType : _archForLineman(d, "DL");
          } else if (d._eng) {
            // PHASE 1 — non-rusher DL position emerges from the shared
            // Engagement (same anchor as his paired OL). Wobble and drift
            // live inside Engagement.step. No more LOS-relative push math.
            dd.x = d._eng.defenderX;
            dd.y = d._eng.defenderY;
            dd.pose = "engage";
            dd.t = tt;
            dd.archetype = _archForLineman(d, "DL");
          } else {
            // Fallback (engagement set unavailable): the legacy fixed-
            // push wobble that the trench rebuild replaces.
            const _engageRamp = Math.min(1, tt / 0.30);
            const _engageEased = _engageRamp * _engageRamp * (3 - 2 * _engageRamp);
            const _engageHash = ((i * 19 + (play.startYard || 0) * 11) >>> 0) % 100 / 100;
            const _pushMin   = (typeof window !== "undefined" && window.GC_PASS_RUSH_PUSH_MIN)   || 22;
            const _pushRange = (typeof window !== "undefined" && window.GC_PASS_RUSH_PUSH_RANGE) || 8;
            const _engagePush = (_pushMin + _engageHash * _pushRange) * _engageEased;
            const wobble = Math.sin(tt * Math.PI * 6 + d.y * 0.08) * 1.2;
            const _postThrowT_dl = aT > throwFrac ? Math.min(1, (aT - throwFrac) / Math.max(0.001, 1 - throwFrac)) : 0;
            const _postPushExtra = _postThrowT_dl * 3 + Math.sin(aT * Math.PI * 5 + d.y * 0.09) * _postThrowT_dl * 1.5;
            // Base from last rendered (Stage 4 pattern) so pre-snap shifts
            // carry through this fallback path too.
            const _dlBaseX = (typeof d._lastRenderedX === "number") ? d._lastRenderedX : d.x;
            const _dlBaseY = (typeof d._lastRenderedY === "number") ? d._lastRenderedY : d.y;
            dd.x = _dlBaseX - dir * (_engagePush + _postPushExtra) + wobble * 0.6;
            dd.y = _dlBaseY + wobble;
            dd.pose = "engage";
            dd.t = tt;
            dd.archetype = _archForLineman(d, "DL");
          }
        }
        // CB / WR interaction varies by coverage. In MAN (C0/C1) the CB
        // follows his WR downfield. In ZONE (C2/C3/C4/TAMPA_2) the CB
        // settles at his zone depth and reads the QB. Was always
        // following WR regardless of coverage, which made man and zone
        // visually indistinguishable.
        if (i >= idxCB1) {
          const tt = Math.min(1, aT / 0.55);
          const isMan = !cov || cov === "C0_BLITZ" || cov === "C1_MAN";
          if (i === idxCB1 || i === idxCB2) {
            // UNIFIED CB MODEL — position is anchored to the WR's
            // current sampled position. CB plays OVER THE TOP (between
            // WR and endzone), not in front of the WR (toward QB).
            // "Cushion" = how many yards the CB is on the endzone
            // side of the WR. In our coords, that's +dir from WR
            // (offense moves in +dir direction toward endzone).
            //
            // Cushion by phase:
            //   jam (man press only, brief): 0yd — at WR
            //   press post-jam: ramps 0 → 2yd over backpedal
            //   off coverage: 6yd cushion throughout (no jam/ramp)
            const cbSlot = (i === idxCB1) ? "wr1" : (i === idxCB2) ? "wr2" : null;
            const wrTarget = (cbSlot === "wr1") ? formation.wr1 : (cbSlot === "wr2") ? formation.wr2 : null;
            const trk = (cbSlot && play.motion && play.motion.tracks) ? play.motion.tracks[cbSlot] : null;
            const jamT = isMan ? throwFrac * 0.07 : 0;
            const backpedalT = throwFrac * 0.30;
            // Pose / facing by phase (independent of cushion)
            let cbPose, cbFacing;
            if (jamT > 0 && aT < jamT) {
              cbPose = "jam"; cbFacing = -dir;
              dd.t = aT / jamT;
            } else if (aT < backpedalT) {
              cbPose = "backpedal"; cbFacing = -dir;
              dd.t = ((t * (dur / 1000)) * 2.0) % 1;
            } else {
              cbPose = "run"; cbFacing = dir;
              const moving = trk && typeof MotionPlayback !== "undefined" ? MotionPlayback.isMoving(trk, aT) : true;
              dd.t = moving ? (t < 0.95 ? ((performance.now() / 333) + i * 0.13) % 1 : 0) : 0;
            }
            dd.pose = cbPose;
            dd.facing = cbFacing;
            // Cushion (yards downfield of WR) by phase. Long-yardage
            // bumps both man + zone cushion so the corner can't be
            // beaten by a quick 8-12yd dig at the marker.
            const _manTrailBase = (typeof window !== "undefined" && window.GC_CB_TRAIL_YD != null) ? window.GC_CB_TRAIL_YD : 2;
            const _manTrail  = formation.isLongYd ? Math.max(_manTrailBase, 5) : _manTrailBase;
            const _zoneTrail = formation.isLongYd ? 9 : 6;
            let _trailYd;
            if (jamT > 0 && aT < jamT) {
              _trailYd = 0;   // pressed at WR
            } else if (isMan && aT < backpedalT) {
              // Press release: cushion grows 0 → manTrail as CB peels off
              const bpProg = (aT - jamT) / Math.max(0.001, backpedalT - jamT);
              _trailYd = bpProg * _manTrail;
            } else if (!isMan) {
              _trailYd = _zoneTrail;
            } else {
              _trailYd = _manTrail;
            }
            // Compute target position. MAN: trail the WR on the endzone
            // side (shadow). ZONE: the corner BAILS to a landmark (deep third
            // in C3, deep half in C2/C4/Tampa) and reads the QB — he does NOT
            // shadow the receiver's route. Shadowing in a zone shell was the
            // "every coverage looks like man" tell; the read-and-break layer
            // (below) drives him on a throw that enters his zone.
            let _cbTargetX = null, _cbTargetY = null;
            const _cbZone = !isMan && cov;
            if (_cbZone) {
              // Which sideline this corner mans (top = -1, bottom = +1).
              const _cbSide = (i === idxCB1) ? -1 : (i === idxCB2) ? 1 : (d.y < cy ? -1 : 1);
              // Landmark DEPTH + lateral by shell. C3 = deep thirds (deeper,
              // ~13yd at the numbers); C2/C4/Tampa = deep half (a touch
              // shallower, wider toward the sideline). Eased in over the
              // backpedal, then held — the read-and-break takes over on the
              // throw. Long-yardage pushes the landmark deeper.
              const _cbZoneDepth = (cov === "C3_ZONE" ? 13 : 11) + (formation.isLongYd ? 3 : 0);
              const _cbZoneLat = (cov === "C3_ZONE" ? 18 : 22);   // yd off the middle, toward the sideline
              const _landX = losX + dir * _cbZoneDepth * FIELD.PX_PER_YARD;
              const _landY = cy + _cbSide * _cbZoneLat * FIELD.PX_PER_YARD;
              // Ease from the CB's current spot to the landmark over the
              // backpedal window so he turns and bails, not teleports.
              const _bailT = Math.min(1, aT / Math.max(0.001, backpedalT));
              const _eb = _bailT * _bailT * (3 - 2 * _bailT);
              _cbTargetX = dd.x + (_landX - dd.x) * _eb;
              _cbTargetY = dd.y + (_landY - dd.y) * _eb;
            } else if (cbSlot && trk && typeof MotionPlayback !== "undefined" && wrTarget) {
              const sample = MotionPlayback.sampleTrack(trk, aT);
              if (sample) {
                const toMidSign = Math.sign(cy - wrTarget.y) || 1;
                const wrX = wrTarget.x + dir * sample.dxYd * FIELD.PX_PER_YARD;
                const wrY = wrTarget.y + toMidSign * sample.dyYd * FIELD.PX_PER_YARD;
                _cbTargetX = wrX + dir * _trailYd * FIELD.PX_PER_YARD;   // ENDZONE side
                _cbTargetY = wrY + toMidSign * -8;   // 8px outside leverage
              }
            }
            if (_cbTargetX == null) {
              // Fallback: hold formation home (pre-route, no track)
              _cbTargetX = d.x;
              _cbTargetY = d.y;
            }
            // Init follow position FIRST — the read-and-break below reads
            // d._cbFollowY, so seeding it after that check left it undefined
            // on the first post-release frame (NaN compare → CB hesitates one
            // frame before breaking).
            if (d._cbFollowX == null) { d._cbFollowX = dd.x; d._cbFollowY = dd.y; }
            // ZONE READ-AND-BREAK (CB) — once the ball is thrown into THIS
            // corner's zone, he drives ON the ball instead of holding his deep
            // landmark. Gate on BOTH (a) the throw being toward this corner's
            // sideline and (b) the catch point being within ~14yd of where he
            // bailed. The sideline check is essential: without it a throw to
            // the MIDDLE (targetY≈cy) is within 14yd of BOTH corners' deep
            // landmarks, so both would break and converge. _cbSide is -1 for
            // the top corner, +1 for the bottom; a throw on his side has
            // sign(targetY-cy) === _cbSide (or is dead-center, |Δ|<2yd, which
            // either may take).
            if (_cbZone && aT >= releaseAT) {
              const _cbSide = (i === idxCB1) ? -1 : (i === idxCB2) ? 1 : (d.y < cy ? -1 : 1);
              const _ballDY = targetY - cy;
              const _onMySide = (Math.sign(_ballDY) === _cbSide) || Math.abs(_ballDY) < 2 * FIELD.PX_PER_YARD;
              if (_onMySide && Math.abs(d._cbFollowY - targetY) < 14 * FIELD.PX_PER_YARD) {
                _cbTargetX = targetX;
                _cbTargetY = targetY;
              }
            }
            // PLAY-TIME dt factor — this is a per-frame accumulator, so it
            // MUST be dt-scaled or it runs at 2× on a 120Hz display (28yps,
            // "superhuman CB") and surges through the catch freeze. Driven
            // off play-time (t) delta so it's both refresh-independent AND
            // halts when the play is frozen (same model as the downfield
            // blockers / WR sim).
            const _cbDtF = (d._cbFollowT == null) ? 1
                         : Math.max(0, Math.min(3, (t - d._cbFollowT) * dur / 16.67));
            d._cbFollowT = t;
            const _cbTopYps = (typeof window !== "undefined" && window.GC_CB_TOP_YPS != null) ? window.GC_CB_TOP_YPS : 14;
            const _cbMaxPF = _cbTopYps * FIELD.PX_PER_YARD * 16 / 1000;
            const _cbDx = _cbTargetX - d._cbFollowX;
            const _cbDy = _cbTargetY - d._cbFollowY;
            const _cbDist = Math.hypot(_cbDx, _cbDy);
            if (_cbDist > 0.001) {
              const _cbSpeed = Math.min(_cbMaxPF, _cbDist * 0.22);
              d._cbFollowX += (_cbDx / _cbDist) * _cbSpeed * _cbDtF;
              d._cbFollowY += (_cbDy / _cbDist) * _cbSpeed * _cbDtF;
            }
            dd.x = d._cbFollowX;
            dd.y = d._cbFollowY;
          }
          // SAFETIES — POSE ONLY here (position is owned by the rotation
          // blend in the _applySecondary track block below). During the
          // rotation window they backpedal/turn; after, the leg cycle is
          // gated by the track's isMoving so a settled deep safety doesn't
          // jog in place. The old `dd.x = d.x + dir*bpProg*5` nudge fought
          // the two-high-disguise rotation and is removed.
          if (i === idxS1 || i === idxS2) {
            const backpedalT = throwFrac * 0.20;
            if (aT < backpedalT) {
              dd.pose = "backpedal";
              dd.t = ((t * (dur / 1000)) * 1.8) % 1;
              dd.facing = -dir;
            } else {
              dd.t = 0;
            }
          }
        }
        // PATH B Phase 5 — engine-emitted post-catch tackler track wins
        // over sim-physics pursuit for the named tackler. When the
        // engine credits a safety with the tackle on a deep ball, the
        // animation now drives that safety to the catch+YAC spot via
        // the motion waypoints — no more "closest defender via sim
        // geometry happens to be a CB" override.
        const _passTacklerTrack = (play.motion && play.motion.tracks && play.motion.tracks.tackler) || null;
        const _passTacklerName = play.motion && play.motion.tacklerName;
        const _isPassTacklerByName = play.kind === "complete" && _passTacklerName && d.name === _passTacklerName;
        // PHASE 5b → PHASE 12 — zone drops for ALL coverage defenders
        // (LB + S), INCLUDING the named tackler. The tackler holds his
        // coverage assignment until the catch, then breaks via the
        // sim-physics post-catch pursuit (added below). This replaces
        // the old tackler-track scheme that pre-routed the defender to
        // the YAC endpoint — that always teleported off coverage at
        // the snap and made the tackler stand still at the endpoint
        // waiting for the receiver to glide in. Now the tackler stays
        // in coverage, then ACTUALLY chases the receiver at speed.
        let _passSecondaryTrack = null;
        const _isPassKind = play.kind === "complete" || play.kind === "incomplete" || play.kind === "int";
        if (_isPassKind && play.motion?.tracks) {
          const ti = play.motion.tracks;
          const isLBIdx = (i >= idxLB1 && i < idxCB1);
          const lbOrdinal = i - idxLB1;     // 0, 1, 2
          const _lbCount = idxCB1 - idxLB1;
          if (isLBIdx) {
            // Map LB index → engine track key. In NICKEL the formation
            // has 2 LBs (W/M) which map to lb1/lb2. In DIME the formation
            // has 1 LB which is the MLB (middle) — must map to lb2, NOT
            // lb1 (which is the top-side hook). Without this correction
            // the single DIME LB at cy snaps to the lb1 t=0 waypoint
            // at cy-42 (a ~3yd jump at the snap, and his coverage
            // assignment for the rest of the play is wrong).
            if (_lbCount === 3) {
              _passSecondaryTrack = lbOrdinal === 0 ? ti.lb1
                                  : lbOrdinal === 1 ? ti.lb2
                                  : lbOrdinal === 2 ? ti.lb3
                                  : null;
            } else if (_lbCount === 2) {
              // NICKEL: top LB → lb1, bottom LB → lb3 (closer to lb2 since
              // both formation slots are ±_lbYNickel ≈ ±22px from cy and
              // engine's lb1 hook is at -7yd vs lb3's +7yd — slot-side
              // match is best). Use lb1/lb3 since those are the outside
              // hooks; the middle hook is unused in NICKEL.
              _passSecondaryTrack = lbOrdinal === 0 ? ti.lb1 : ti.lb3;
            } else {
              // DIME / QUARTER (1 LB or 0 LB) — single LB is the MLB.
              _passSecondaryTrack = ti.lb2;
            }
          } else if (i === idxS1) {
            _passSecondaryTrack = ti.fs;
          } else if (i === idxS2) {
            _passSecondaryTrack = ti.ss;
          }
        }
        // Secondary track drives the defender every frame the track is
        // defined — including the tackler. Without this, the named
        // tackler's dd resets to formation default on the first post-
        // throw frame and the safety teleports.
        const _applySecondary = _passSecondaryTrack;
        // Active pursuit = post-throw and this defender is the named
        // tackler or in the pursuit set. When pursuing, the sim is the
        // source of truth — secondary should not overwrite it.
        const _activePursuit = play.kind === "complete" && t > throwPhase &&
                               (_isPassTacklerByName || d._postCatchSynced);
        if (_applySecondary && typeof MotionPlayback !== "undefined") {
          const sample = MotionPlayback.sampleTrack(_passSecondaryTrack, aT);
          if (sample) {
            // Long-yardage track shift — engine emits zone-drop tracks
            // with baselines tied to the standard front (LB at 5.5yd,
            // safeties at 14yd). When the formation places defenders
            // deeper for 3rd-and-long, sampling the track without a
            // shift would snap them back to standard depth on the first
            // post-snap frame. Shift everything by the formation
            // depth delta so the deeper coverage carries through the
            // entire play.
            let _xYdShift = 0;
            if (formation.isLongYd) {
              const isLBIdx2 = (i >= idxLB1 && i < idxCB1);
              if (isLBIdx2) {
                _xYdShift = (formation.lbDepthYd || 5.5) - 5.5;
              } else if (i === idxS1 || i === idxS2) {
                _xYdShift = (formation.sDepthYd || 14) - 14;
              }
            }
            let _trkX = losX + dir * (sample.dxYd + _xYdShift) * FIELD.PX_PER_YARD;
            let _trkY = cy + sample.dyYd * FIELD.PX_PER_YARD;
            // SAFETY ROTATION OUT OF PRE-SNAP LOOK — ease from wherever
            // the safety was JUST rendered to the engine's track waypoint
            // over the rotation window, regardless of coverage. The
            // engine track's spot is the TRUE shell (one safety spins to
            // deep middle in C3/C1, both hold in C2/C4, SS walks down in
            // C0_BLITZ); easing from the pre-snap render makes the
            // transition continuous instead of jumping to track-t=0.
            // _lastRenderedX/Y is captured by _syncDefRendered after the
            // prior frame's draw and reflects the actual pre-snap
            // position (two-high disguise for non-blitz, walked-up for
            // C0_BLITZ, anything else for custom shifts). Fallback to
            // the legacy hardcoded disguise spot when no prior render
            // exists (first frame of a play).
            if (i === idxS1 || i === idxS2) {
              const _disgX = (typeof d._lastRenderedX === "number")
                ? d._lastRenderedX
                : losX + dir * 11 * FIELD.PX_PER_YARD;
              const _disgY = (typeof d._lastRenderedY === "number")
                ? d._lastRenderedY
                : cy + ((i === idxS1) ? -1 : 1) * 9 * FIELD.PX_PER_YARD;
              const _rotT = Math.min(1, aT / Math.max(0.001, throwFrac * 0.45));
              const _er = _rotT * _rotT * (3 - 2 * _rotT);   // smoothstep
              _trkX = _disgX + (_trkX - _disgX) * _er;
              _trkY = _disgY + (_trkY - _disgY) * _er;
            }
            dd.x = _trkX;
            dd.y = _trkY;
            // Sync sim to track ONLY if the defender is NOT actively
            // pursuing. Once pursue() takes over (post-throw, tackler
            // or in pursuit set after sync), sim is the position of
            // record; overwriting sim.x with the track sample each
            // frame nullified the pursue() acceleration — defender
            // stayed glued to the zone-drop track and the sim only
            // got a tiny per-frame nudge that never accumulated.
            if (d._sim && !_activePursuit) {
              d._sim.x = dd.x; d._sim.y = dd.y;
            }
            dd.facing = -dir;
            // LBs scrape laterally; safeties backpedal/turn during the
            // rotation (their pose is set in the pose-only block above, so
            // don't clobber it with the LB scrape).
            const _isSafetyRot = (i === idxS1 || i === idxS2);
            if (aT < 0.78 && !_isSafetyRot) dd.pose = "scrape";
            if (!MotionPlayback.isMoving(_passSecondaryTrack, aT)) dd.t = 0;
            // ── ZONE READ-AND-BREAK ──────────────────────────────────
            // In a ZONE shell the LB/safety isn't man-shadowing — he drops
            // to his landmark (the track above), READS the QB, and BREAKS
            // on the ball once it's thrown. Without this he sat frozen on
            // the last waypoint while the ball sailed into his zone, so
            // every coverage looked like soft man. Only the defender whose
            // zone the throw enters breaks (within ~7yd of the catch point
            // laterally); others hold their drop. Man shells (C0/C1) skip
            // this — their CBs already trail-shadow. Not for the named
            // tackler / active pursuers (the post-catch sim owns them).
            const _zoneShell = cov === "C2_ZONE" || cov === "C3_ZONE"
                            || cov === "C4_QUARTERS" || cov === "TAMPA_2";
            if (_zoneShell && play.kind !== "int" && !_activePursuit
                && !_isPassTacklerByName && aT >= releaseAT) {
              const _zoneToBallY = Math.abs(dd.y - targetY);
              if (_zoneToBallY < 7 * FIELD.PX_PER_YARD) {
                // Break on the ball — drive toward the catch point. Closer
                // zones break harder (closes faster); deep zones rally up.
                const _brkMs = Math.max(0, (aT - releaseAT) * dur);
                const _np = pursue(d, targetX, targetY, _brkMs, 0.95);
                dd.x = _np.x; dd.y = _np.y;
                dd.pose = "run";
                if (_np.moved) dd.t = (t < 0.95 ? ((performance.now() / 333) + i * 0.11) % 1 : 0);
              }
            }
          }
        }
        // PHASE 12 — post-catch agent sim. Replaces the old tackler-
        // track override entirely. The named tackler is just another
        // pursuer, sprinting at top speed from his coverage spot. The
        // tackle EMERGES when his sim catches the carrier instead of
        // being a snap-to-waypoint at a predetermined endpoint.
        // === POST-CATCH DEFENDER STATE MACHINE ===
        // Replaces the prior scattered logic: path A (sim pursuit + contact
        // snap), path B (guaranteed tackler position blend), and the unified
        // tackle-event pose override. ONE block now owns the entire post-
        // throw pursuit-through-tackle sequence.
        //
        // States (derived per-frame from observable facts — not stored):
        //   PURSUE     pursuer not yet in contact → sim physics, "run"
        //   CONTACT    pursuer within CONTACT_DIST, aT < TACKLE_START_AT → "engage"
        //   DOWN       pursuer within CONTACT_DIST (or named/cover), aT > TACKLE_START_AT → "hit"
        //   HOLD_ZONE  non-pursuer → upstream zone-drop track wins; no-op
        //
        // INT and dropped-pick are handled in dedicated blocks BELOW; the
        // state machine skips them.
        const _isDroppedPickDropper = play.isDroppedPick && i === intDefIdx;
        const _isIntCarrier         = play.kind === "int" && i === intDefIdx;
        if (play.kind === "complete" && t > throwPhase
            && !_isIntCarrier && !_isDroppedPickDropper) {
          // Build pursuit set ONCE on first post-throw frame.
          const POST_CATCH_PURSUERS = 2;
          if (!_postCatchPursuerSet) {
            const candidates = [];
            for (let j = 4; j < formation.defense.length; j++) {
              if (j === intDefIdx) continue;
              const dj = formation.defense[j];
              if (_passTacklerName && dj && dj.name === _passTacklerName) continue;
              const cx = (dj._sim?.x ?? dj.x), cy_ = (dj._sim?.y ?? dj.y);
              candidates.push({ j, dist: Math.hypot(cx - ballX, cy_ - ballY) });
            }
            candidates.sort((a, b) => a.dist - b.dist);
            _postCatchPursuerSet = new Set(candidates.slice(0, POST_CATCH_PURSUERS).map(c => c.j));
            // Cover defender always pursues — they're already next to the
            // WR at catch. Excluding them used to leave them parked in the
            // zone-drop position when the engine emitted a track for a
            // different tackler; they then never reached the carrier and
            // the unified tackle block couldn't see them as close.
            _postCatchPursuerSet.add(intDefIdx);
            // SAFETIES on deep / extended plays — last line of defense
            // must commit. Was leaving safeties parked at deep zone
            // even when the WR ran past them into a 30yd gain. Both
            // safeties join the pursuit on plays of 10+ yards.
            const _projectedYards = play.yards ?? 0;
            if (_projectedYards > 10) {
              _postCatchPursuerSet.add(idxS1);
              _postCatchPursuerSet.add(idxS2);
            }
          }

          const isPursuer = _postCatchPursuerSet.has(i) || _isPassTacklerByName;
          if (isPursuer) {
            // Sync sim once on first pursuit frame. CRITICAL: if d._sim
            // doesn't exist yet (defender didn't run pursue() during
            // pre-throw — e.g. a deep safety whose only motion was the
            // zone-drop track), CREATE it AT dd.x. The previous code
            // only synced when d._sim already existed; otherwise pursue()
            // below would init a fresh sim at d.x (formation position),
            // and dd.x = sim.x would teleport the defender backward from
            // the coverage spot to near the formation. That was the
            // "defender slides backwards on a long pass" glitch.
            if (!d._postCatchSynced) {
              if (typeof SimPlayer !== "undefined") {
                if (!d._sim) {
                  d._sim = new SimPlayer(dd.x, dd.y, {
                    maxSpeed: SIM_DEFAULTS.MAX_SPEED,
                    accel: SIM_DEFAULTS.ACCEL,
                  });
                } else {
                  d._sim.x = dd.x; d._sim.y = dd.y; d._sim._lastMs = null;
                }
              }
              d._postCatchSynced = true;
            }
            // Pursuit speed factor. Auto-scaled for anyone who NEEDS to
            // close by the tackle window (named tackler + cover defender).
            // Other pursuers use a fixed base factor.
            const isCB  = i === idxCB1 || i === idxCB2;
            const isSaf = i === idxS1  || i === idxS2;
            let factor = _isPassTacklerByName ? 1.25
                       : isCB ? 1.05 : isSaf ? 1.0 : 0.95;
            // ALL pursuers auto-scale — not just named tackler + cover.
            // WR sim caps at 13 yps; DB base factor caps at ~1.05x×9.5 =
            // 10 yps. Without auto-scale, convergers fall ~3 yps behind
            // the WR every second of YAC and arrive after the tackle.
            const _needArrival = _isPassTacklerByName
                              || i === intDefIdx
                              || _postCatchPursuerSet.has(i);
            if (_needArrival) {
              const distRemaining = Math.hypot(ballX - dd.x, ballY - dd.y);
              const timeRemaining = (tackleEvent.fallStartT - aT) * dur;
              if (timeRemaining > 80 && distRemaining > 12) {
                const speedNeededPxSec = (distRemaining / timeRemaining) * 1000;
                const neededFactor = speedNeededPxSec / SIM_DEFAULTS.MAX_SPEED;
                factor = Math.min(2.5, Math.max(factor, neededFactor));
              }
            }
            // Step sim toward the carrier. PURSUIT ANGLE — converging help
            // (safeties, backside CB, LBs) aims at the INTERCEPT point (where
            // the carrier WILL be given his velocity), not his current spot,
            // so they take a cutoff angle across the field instead of chasing
            // from behind and trailing. The cover defender (already next to
            // the WR at the catch) and the in-contact pursuer chase directly
            // — an intercept lead would overshoot a carrier who's right there.
            const elapsedMs = Math.max(0, (t - throwPhase) * dur);
            const _carVx = (_wrSim && play.kind === "complete") ? _wrSim.vx : 0;
            const _carVy = (_wrSim && play.kind === "complete") ? _wrSim.vy : 0;
            const _useIntercept = i !== intDefIdx
                               && Math.hypot(_carVx, _carVy) > 1
                               && Math.hypot(ballX - dd.x, ballY - dd.y) > 18;
            const _pursOpts = _useIntercept
              ? { carrier: { x: ballX, y: ballY, vx: _carVx, vy: _carVy } }
              : {};
            const np = pursue(dd, ballX, ballY, elapsedMs, factor, _pursOpts);
            dd.x = np.x; dd.y = np.y;

            // Backup positioning for the cover defender — blend toward the
            // tackle spot if the sim is still too far. Replaces the old
            // path B that ran unconditionally; now scoped to "sim not
            // close enough yet".
            const CONTACT_DIST = 10;
            let _distToCar = Math.hypot(dd.x - ballX, dd.y - ballY);
            if (i === intDefIdx && _distToCar > CONTACT_DIST * 3) {
              // Converge on the carrier's ACTUAL YAC endpoint (shared
              // _yacEnd, anchored at the catch) so the tackler meets the
              // carrier instead of a targetY-based phantom spot a yard off.
              const tackleX = (_yacEndX != null ? _yacEndX : endX) - dir * 5;
              const tackleY = (_yacEndY != null ? _yacEndY : finalY) + 4;
              const arrProgress = clamp((t - throwPhase) / Math.max(0.001, (PRE + (1 - PRE) * tackleEvent.fallStartT) - throwPhase), 0, 1);
              const blend = arrProgress * arrProgress;
              dd.x = dd.x + (tackleX - dd.x) * blend;
              dd.y = dd.y + (tackleY - dd.y) * blend;
              if (d._sim) { d._sim.x = dd.x; d._sim.y = dd.y; }
              _distToCar = Math.hypot(dd.x - ballX, dd.y - ballY);
            }

            // Contact snap — never let pursuer overlap carrier.
            const inContact = _distToCar < CONTACT_DIST;
            if (inContact) {
              const ang = Math.atan2(dd.y - ballY, dd.x - ballX);
              dd.x = ballX + Math.cos(ang) * CONTACT_DIST;
              dd.y = ballY + Math.sin(ang) * CONTACT_DIST;
              if (d._sim) {
                d._sim.x = dd.x; d._sim.y = dd.y;
                d._sim.vx *= 0.65; d._sim.vy *= 0.65;
              }
            }

            // State → pose. Single decision point.
            dd.facing = -dir;
            const _atTackleWindow = aT > tackleEvent.fallStartT;
            // Cover defender only auto-locks into the tackle pose when
            // the engine isn't emitting a tracked tackler — otherwise
            // BOTH the named tackler and the cover would fall on the WR
            // even if the cover is 10+ yd away.
            const _isLockedTackler = _isPassTacklerByName
                                  || (i === intDefIdx && !_passTacklerTrack);
            if (_atTackleWindow && (inContact || _isLockedTackler)) {
              // DOWN
              dd.pose = "hit";
              dd.t = Math.min(1, (aT - tackleEvent.fallStartT) / (1 - tackleEvent.fallStartT));
              if (_isPassTacklerByName) {
                const _tVx = d._sim ? d._sim.vx : 0;
                const _comb = tackleEvent.carrierVx + _tVx;
                dd.fallDir = -(_comb * dir < 0 ? -1 : 1);
              } else {
                dd.fallDir = -1;
              }
            } else if (inContact) {
              // CONTACT (pre-tackle)
              dd.pose = "engage";
              dd.t = (t < 0.95 ? ((performance.now() / 333)) % 1 : 0);
            }
            // else PURSUE — pose stays "run" from upstream sim/track.
          } else {
            // PILE-ON for non-pursuers: a zone-drop LB or man-coverage
            // CB who isn't in the pursuit set but happens to be near the
            // carrier at the tackle moment should still fall into the
            // pile. Old unified-tackle block did this via a generic
            // _isClose check; the state-machine refactor dropped it.
            const _atTackleWindowNP = aT > tackleEvent.fallStartT;
            if (_atTackleWindowNP) {
              const _distNP = Math.hypot(dd.x - ballX, dd.y - ballY);
              if (_distNP < tackleEvent.contactDist) {
                dd.pose = "hit";
                dd.t = Math.min(1, (aT - tackleEvent.fallStartT) / (1 - tackleEvent.fallStartT));
                dd.facing = -dir;
                dd.fallDir = -1;
              }
            }
          }
        }
        // INT — the picking defender races to the catch spot, then carries the ball back
        if (play.kind === "int" && i === intDefIdx) {
          // Start the ease from the LAST RENDERED position (carries
          // through any pre-snap coverage shift), not from formation
          // home, so the first post-snap frame doesn't snap back.
          const _intStartX = (typeof d._lastRenderedX === "number") ? d._lastRenderedX : d.x;
          const _intStartY = (typeof d._lastRenderedY === "number") ? d._lastRenderedY : d.y;
          if (t < throwPhase) {
            const tt = Math.min(1, aT / (throwFrac));
            dd.x = _intStartX + (targetX - _intStartX) * easeOutCubic(tt);
            dd.y = _intStartY + (targetY - _intStartY) * easeOutCubic(tt);
          } else {
            dd.x = ballX;
            dd.y = ballY;
            dd.facing = -dir;
            // INT defender HAS the ball on the return. Must be a ball-bearing
            // sprite: the standalone ball is gated OFF after the catch (int
            // pure-flight window), so a "run" pose (no ball on the sprite)
            // left the return with NO ball visible at all until the very end.
            // "carry" tucks the ball through the return; "tackled_carry" at
            // the tackle keeps it tucked as he goes down.
            dd.pose = aT > 0.92 ? "tackled_carry" : "carry";
          }
        }
        // DROPPED PICK — play.isDroppedPick + play.dropper. The defender
        // who could have intercepted closes on the ball, reaches up for
        // it, and the ball goes THROUGH their hands. Visible "dropper"
        // identity even though we can't match by name (no per-defender
        // names on the formation), the intDefIdx target maps to the
        // covering defender of the targeted WR — same defender who
        // would've made the pick.
        if (play.isDroppedPick && i === intDefIdx) {
          // Same pattern as INT — start from last rendered position so
          // the pre-snap coverage shift carries through the snap.
          const _dpStartX = (typeof d._lastRenderedX === "number") ? d._lastRenderedX : d.x;
          const _dpStartY = (typeof d._lastRenderedY === "number") ? d._lastRenderedY : d.y;
          if (t < throwPhase) {
            const tt = Math.min(1, aT / (throwFrac));
            dd.x = _dpStartX + (targetX - _dpStartX) * easeOutCubic(tt);
            dd.y = _dpStartY + (targetY - _dpStartY) * easeOutCubic(tt);
            // Closer to throwPhase: reach pose, arms up for the ball.
            // Progress t once (arms come up and hold) — without an
            // explicit t the reach/catch sprite inherits the wall-clock
            // loop default and cycles (a "flopping" reach).
            if (aT > throwFrac * 0.85) {
              dd.pose = "reach";
              dd.t = Math.min(1, (aT - throwFrac * 0.85) / Math.max(0.001, throwFrac * 0.15));
            }
          } else if (t < throwPhase + 0.15) {
            // Catch frame — at the ball, arms still up (hold extended).
            dd.x = ballX - dir * 2;
            dd.y = ballY;
            dd.pose = "reach";
            dd.t = 1;
          } else {
            // After the drop — frustrated, on the ground
            dd.pose = "tackled";
            dd.t = Math.min(1, (t - throwPhase - 0.15) / 0.2);
          }
        }
        // PASS DEFLECTION — named PD defender (covering CB / safety /
        // LB) leaps at the ball at the catch frame, swats it down.
        // Distinct from a dropped pick: defender HITS the ball before
        // the WR's hands close on it. Closes on the ball trajectory,
        // jumps at the catch moment, lands and watches the ball drop.
        if (_isPDPlay && i === intDefIdx) {
          // Start ease from last rendered (pre-snap coverage shift)
          // so the PD defender doesn't snap back to formation at t=PRE.
          const _pdStartX = (typeof d._lastRenderedX === "number") ? d._lastRenderedX : d.x;
          const _pdStartY = (typeof d._lastRenderedY === "number") ? d._lastRenderedY : d.y;
          if (t < throwPhase) {
            // Close on the CONTACT point — the WR's hands (targetX,targetY).
            // On a PD the throw is on-target (incOffset is 0), so the ball
            // and the receiver meet here and the defender's hand reaches in
            // at the same spot to knock it away.
            const _pdBallX = targetX + incOffsetX;
            const _pdBallY = targetY + incOffsetY;
            const tt = Math.min(1, aT / throwFrac);
            const _pdEaseT = easeOutCubic(tt);
            dd.x = _pdStartX + (_pdBallX - _pdStartX) * _pdEaseT;
            dd.y = _pdStartY + (_pdBallY - _pdStartY) * _pdEaseT;
            if (aT > throwFrac * 0.88) {
              dd.pose = "leap";   // rise up to contest the ball (windup)
              // Progress once into the leap (no explicit t → wall-clock
              // loop → flopping leap windup).
              dd.t = Math.min(1, (aT - throwFrac * 0.88) / Math.max(0.001, throwFrac * 0.12));
            }
          } else if (t < throwPhase + 0.10) {
            // SWAT FRAME — the dedicated arm-chop. Was "leap" (a one-arm
            // diving CATCH reach), which looked like the defender trying to
            // catch it, not knock it away. "swat" maps to the strip_swat
            // sprite (DB punch-out) and the procedural arm-chop fallback.
            dd.x = targetX + incOffsetX;
            dd.y = targetY + incOffsetY + 6;
            dd.pose = "swat";
            dd.t = Math.min(1, (t - throwPhase) / 0.10);
            dd.facing = -dir;
          } else {
            // Lands — back to feet, watches the ball roll away.
            dd.x = targetX + incOffsetX;
            dd.y = targetY + incOffsetY + 8;
            dd.pose = aT < 0.92 ? "stiff" : "idle";
            dd.t = 0;
            dd.facing = -dir;
          }
        }
        return dd;
      });

      // QB pose timeline — scaled by throwFrac so the throw motion lines up with
      // when the ball arrives. Sub-phases (in fractions of throwFrac):
      //   0   - 0.29: dropback (run)
      //   0.29 - 0.65: cradle → cock
      //   0.65 - 0.73: hold at cocked ear (Tom Brady frame)
      //   0.73 - 0.85: snap (release ~0.78)
      //   0.85 - 1.00: follow-through
      //   >throwFrac: idle / watching the play
      let qbPose, qbT;
      if (t < PRE) {
        qbPose = "idle";
        qbT = 0;
      } else if (play.isFleaFlicker && aTRaw < FLICKER_END) {
        // FLEA FLICKER QB pose: handoff → watch → reach for pitch → cradle
        const fT = aTRaw / FLICKER_END;
        if (fT < 0.30) {
          qbPose = "throw";   // pretending to hand off
          qbT = fT / 0.30 * 0.18;   // partial throw motion (cradle stage)
        } else if (fT < 0.55) {
          qbPose = "idle";    // empty-handed, watching the RB
          qbT = 0;
        } else if (fT < 0.85) {
          qbPose = "reach";   // arms out for the pitch back
          qbT = 0;
        } else {
          qbPose = "qb_carry";   // got the ball, holding it at chest (dedicated QB cradle, not RB tuck)
          qbT = (t < 0.95 ? ((performance.now() / 333)) % 1 : 0);
        }
      } else {
        const at = aT;   // flicker-aware action time
        const tf = throwFrac;
        // QB pose timeline — shifted earlier to match the new release at
        // tf * 0.55 (was tf * 0.73). Dropback compressed; cock + release
        // start sooner. The follow-through still finishes at tf so the
        // ball is in the air while the QB completes his motion.
        //   0    - 0.35 tf: dropback (drop_step)
        //   0.35 - 0.45 tf: cock-back (qbT 0.18→0.42)
        //   0.45 - 0.50 tf: hold at cocked ear (qbT 0.42→0.48)
        //   0.50 - 0.65 tf: snap / release (qbT 0.48→0.68, ball out at 0.55)
        //   0.65 - 1.00 tf: follow-through (qbT 0.68→1.0)
        if (at < tf * 0.35) {
          qbPose = "drop_step";
          qbT = ((t * (dur / 1000)) * 1.8) % 1;
        } else if (at < tf * 0.45) {
          qbPose = "throw";
          qbT = 0.18 + (at - tf * 0.35) / (tf * 0.10) * (0.42 - 0.18);
        } else if (at < tf * 0.50) {
          qbPose = "throw";
          qbT = 0.42 + (at - tf * 0.45) / (tf * 0.05) * 0.06;
        } else if (at < tf * 0.65) {
          qbPose = "throw";
          qbT = 0.48 + (at - tf * 0.50) / (tf * 0.15) * 0.20;
        } else if (at < tf * 1.0) {
          qbPose = "throw";
          qbT = 0.68 + (at - tf * 0.65) / (tf * 0.35) * 0.32;
        } else {
          qbPose = "idle";
          qbT = 0;
        }
      }
      const qbWithPose = { ...qb, pose: qbPose, t: qbT, facing: dir };
      // Target receiver pose — reach during the catch window, then carry the ball downfield
      const isCatching = t > throwPhase - 0.05 && t < throwPhase + 0.10;
      const isPostCatch = play.kind === "complete" && t > throwPhase + 0.10;
      // On an INT, the WR briefly reacts ("reach") then chases ("run") toward the defender,
      // facing the opposite direction since they're now playing defense.
      const wrIntPose = play.kind === "int" && t > throwPhase + 0.02
        ? (t > 0.92 ? "tackled" : "run")
        : null;
      // RARE WR JUKE — when play.wrJuke is set, the receiver makes a move on the
      // closest defender immediately after the catch. ~0.16-0.32 of total play.
      const isWRJuke = !!play.wrJuke;
      const inWRJukeWindow = isWRJuke && t > throwPhase + 0.04 && t < throwPhase + 0.22;
      // Lateral cut during the juke (then drift back to original path)
      const wrJukeLateral = inWRJukeWindow
        ? ((targetY < cy ? -1 : 1) * Math.sin(((t - throwPhase - 0.04) / 0.18) * Math.PI) * 26)
        : 0;
      if (inWRJukeWindow) {
        wr.y += wrJukeLateral;
        ballY += wrJukeLateral;
      }
      // LEAP / NEAR-MISS — for deep catches (or near-miss incompletes), the
      // receiver leaps for the ball. Leap window covers the catch frame.
      const isLeapingCatch = !!play.isLeapingCatch;
      const isLeapMiss = !!play.isLeapMiss;
      const inLeapWindow = (isLeapingCatch || isLeapMiss) && t > throwPhase - 0.10 && t < throwPhase + 0.08;
      const leapInternalT = inLeapWindow ? Math.max(0.001, (t - (throwPhase - 0.10)) / 0.18) : 0;
      // For near-miss leaps, the ball sails OVER the receiver's hand — nudge
      // ballY upward during the leap window so it visibly clears them.
      if (isLeapMiss && inLeapWindow) {
        ballY -= 6 + Math.sin(leapInternalT * Math.PI) * 4;
      }
      // Tackle window: after catch we let the carrier run YAC, then a few
      // tenths in the defenders close in. Start of tackle = TackleFrac of
      // action time; ragdoll plays out from there to the end.
      const passIsTD = (play.endYard ?? 0) >= 100;
      // First 20% of the route window = RELEASE pose (explosive first
      // step off the LOS). After that, standard run until catch.
      const inRelease = aT > 0 && aT < throwFrac * 0.20;
      // Pre-compute whether this frame is the carrier-going-down moment
      // so the fall-variant logic below can pick the right pose. The
      // variant is computed AFTER `def` is built so it can read the
      // tackler's sim velocity for the momentum model.
      //
      // CONTACT-DRIVEN tackle: the receiver only goes to a fall pose
      // when the named tackler is actually CLOSE (within ~1.2 yd) — or
      // as a fallback at the very end of the play (aT > 0.92). Previous
      // version triggered the fall purely on the aT > 0.78 timer, so
      // any play where the tackler couldn't catch up (big YAC, hard
      // auto-scale cap) had the receiver fall over with nobody near him.
      const _outerTacklerName = play.motion && play.motion.tacklerName;
      let _defenderNearby = false;
      if (_outerTacklerName) {
        const _tk = def.find(d => d && d.name === _outerTacklerName);
        if (_tk) {
          const _distToTackler = Math.hypot(_tk.x - wr.x, _tk.y - wr.y);
          _defenderNearby = _distToTackler < 18;   // ~1.2 yd center-to-center
        }
      }
      const _isTackleNow = play.kind === "complete" && t > throwPhase + 0.10
                         && aT > TACKLE_START_AT && (play.yards ?? 0) < 90
                         && (_defenderNearby || aT > 0.92);
      // FALL VARIANT — picked from combined-momentum physics before the
      // wrPose chain runs. Three poses available:
      //   tackled   – default ragdoll (rotates 90° to horizontal)
      //   tumble    – big chase tackle, carrier rolls 270° head-over-heels
      //   spin_fall – side hit, carrier spins to one side
      let _wrFallDir = 1;
      let _wrSideDir = 1;
      let _wrFallPose = "tackled_carry";  // WR has caught the ball — ballcarrier prone sprite
      if (_isTackleNow && _outerTacklerName) {
        const _tk = def.find(d => d && d.name === _outerTacklerName);
        if (_tk) {
          const postCatchSec = Math.max(0.1, (1 - throwPhase) * dur / 1000);
          const carrierVx = (endX - targetX) / postCatchSec;
          const tackVx    = (_tk._sim && typeof _tk._sim.vx === "number") ? _tk._sim.vx : 0;
          const tackVy    = (_tk._sim && typeof _tk._sim.vy === "number") ? _tk._sim.vy : 0;
          const combinedVx = carrierVx + tackVx;
          const combinedVy = tackVy;
          if (combinedVx * dir < 0) _wrFallDir = -1;
          _wrSideDir = combinedVy >= 0 ? 1 : -1;
          const absVx = Math.abs(combinedVx);
          const absVy = Math.abs(combinedVy);
          const yacYds = Math.abs(endX - targetX) / FIELD.PX_PER_YARD;
          // Thresholds tuned to trigger variants on most non-trivial
          // tackles. Most pass tackles have some YAC and forward momentum;
          // pure backward flops are now the exception, not the default.
          if (absVy > absVx * 0.6 && absVy > 60) {
            _wrFallPose = "spin_fall";
          } else if (yacYds > 4 && combinedVx * dir > 100) {
            _wrFallPose = "tumble";
          }
        }
      }
      // First-down catch: after the tackle pose has held, the WR pops
      // back up and signals first down. Detection matches the chyron card.
      // Exclude 25+ yd gains: the result card classifies those as
      // "BIG PLAY!" (the yards>=25 branch precedes its first-down branch),
      // so the WR shouldn't pull a polite first-down chop on a 30-yard
      // explosive while the card reads BIG PLAY — he celebrates instead.
      // Matches formatPlayResult's branch order (one source of truth).
      const isFirstDownPass = !passIsTD && play.kind === "complete"
                              && (play.down ?? 0) > 0 && (play.yards ?? 0) >= (play.ytg ?? 0)
                              && (play.yards ?? 0) < 25;
      const wrPose = t < PRE
        ? "idle"
        : (wrIntPose
        || (inWRJukeWindow ? "juke"
        :  (inLeapWindow ? "leap"
        :  (isCatching ? "reach"
        :  (isPostCatch && aT > 0.90 && passIsTD ? "celebrate"
        :  (isPostCatch && aT > 0.92 && isFirstDownPass ? "celebrate"
        :  (_isTackleNow ? _wrFallPose
        :  (isPostCatch ? "carry"
        :  (inRelease ? "release"
        :   "run")))))))));
      const wrIsTackled = wrPose === "tackled" || wrPose === "tackled_carry" || wrPose === "tumble" || wrPose === "spin_fall";
      // For the tackled fall, pass fall-progress (not stride cycle).
      // For run/carry, scale stride frequency with the carrier's actual
      // motion speed — fixed 2 Hz meant a long YAC TD covered 6+ yd
      // per stride while the legs cycled at jogging pace ("stuttered
      // to the endzone"). Natural stride is ~2 yd; strideHz = yps / 2,
      // clamped to a believable 2.5–5.5 Hz range.
      // Pre-catch baseline derived from the route geometry: WR covers
      // ~targetDepth yards over throwFrac*actionDur ms. At 3.0Hz the
      // legs cycled at jogging pace regardless of speed, so a 4yd hitch
      // had the WR's legs flailing while his body crept forward, and a
      // 22yd streak had the legs jogging while the body sprinted. Both
      // read as the WR "teleporting" — body motion decoupled from foot
      // strikes. Now stride matches the route's average ground speed.
      const _routeYds = Math.max(2, play.targetDepth || play.catchDepth || 8);
      const _routeMs  = Math.max(400, throwFrac * actionDur);
      const _routeYPS = _routeYds / (_routeMs / 1000);
      let strideHz = clamp(_routeYPS / 2, 2.0, 5.5);
      if (isPostCatch && _wrSim) {
        // Sim-driven: use instantaneous velocity so the stride ramps
        // up during accel, sits high at top speed, and slows on the
        // tackle clamp — natural foot-strike timing throughout.
        const _carrierYPS = Math.hypot(_wrSim.vx, _wrSim.vy) / FIELD.PX_PER_YARD;
        strideHz = clamp(_carrierYPS / 2, 2.5, 5.5);
      }
      // CATCH POSE — when wrPose is "reach" (during the catch window),
      // progress its t once from 0 → 1 across the window. Was falling
      // through to the stride-cycle expression which replayed the full
      // reach/catch animation every 333ms — looked like the WR was
      // catch-faking on a loop. Single-fire matches a real catch.
      const _isReachCatch = isCatching && !inLeapWindow;
      const reachInternalT = _isReachCatch
        ? Math.min(1, Math.max(0, (t - (throwPhase - 0.05)) / 0.15))
        : 0;
      const wrTackleT = wrIsTackled ? Math.min(1, (aT - TACKLE_START_AT) / (1 - TACKLE_START_AT))
                       : inLeapWindow ? leapInternalT
                       : _isReachCatch ? reachInternalT
                       : ((t * (dur / 1000)) * strideHz) % 1;
      const wrWithPose = { ...wr,
        pose: wrPose,
        t: wrTackleT,
        facing: (play.kind === "int" && t > throwPhase + 0.05) ? -dir : dir,
        // Fall variant picked from combined-momentum physics above.
        // fallDir = forward (+1) / backward (-1); sideDir = left/right
        // (only used by spin_fall pose).
        fallDir: wrIsTackled ? _wrFallDir : undefined,
        sideDir: wrIsTackled ? _wrSideDir : undefined,
        // First-down signal — drives the celebrate pose's first_down
        // variant in play-render.js (chopping arm in play direction).
        celebStyle: (isPostCatch && aT > 0.92 && isFirstDownPass) ? "first_down" : wr.celebStyle,
      };
      const off = formation.offense.map(p => {
        if (p.role === "QB") return qbWithPose;
        // FLEA FLICKER — RB takes the fake handoff, runs forward, pitches back
        if (play.isFleaFlicker && p === formation.rb && aTRaw < FLICKER_END) {
          const fT = aTRaw / FLICKER_END;
          let rbPose = "carry";
          if (fT < 0.30) rbPose = "handoff";            // arms at belly for the handoff
          else if (fT < 0.50) rbPose = "carry";          // sprinting forward
          else if (fT < 0.80) rbPose = "throw";          // pitching back (cradle/cock)
          else rbPose = "stance";                        // settled, decoy
          return { ...p, x: flickerRBX, y: flickerRBY,
                   pose: rbPose, t: rbPose === "throw" ? Math.min(0.30, (fT - 0.50) / 0.30 * 0.30) : (t < 0.95 ? ((performance.now() / 333)) % 1 : 0),
                   facing: dir };
        }
        // Pre-snap motion: the motion player jogs across the formation
        if (hasMotion && t < PRE) {
          const isMotion = (motionRole === "wr1" && p === formation.wr1)
                        || (motionRole === "wr2" && p === formation.wr2)
                        || (motionRole === "te" && p === formation.te);
          if (isMotion) {
            const yOff = motionYOffset(t);
            const moving = isInMotionNow(t);
            // Eased ~20px back from the LOS (see motionXOffset) — was binary
            // (moving ? -20 : 0), which jumped at the motion boundaries and
            // got smeared into a fast slide ("super speed at the snap").
            const xOff = motionXOffset(t);
            const motionFacing = moving
              ? ((motionEndY > motionStartY) ? 1 : -1)
              : dir;
            return { ...p, x: p.x + xOff, y: p.y + yOff,
                     pose: moving ? "run" : "idle",
                     t: (t < 0.95 ? ((performance.now() / 333)) % 1 : 0), facing: motionFacing };
          }
        }
        // The targeted receiver — whatever slot — gets the catch pose.
        // Generic match (was a wr1/wr2/te/rb whitelist that left slot
        // receivers wr3/wr4/te2 to be drawn by the wrong sprite).
        if (p === formation[wrChoice]) return wrWithPose;
        // === POST-CATCH DOWNFIELD BLOCKING + TD CELEBRATION ===
        // Non-target receivers (and the RB if he isn't the target) take
        // on two roles during the post-catch window:
        //   - The 2 closest to the carrier become downfield blockers,
        //     running 6-9 yd ahead of the carrier in offset lanes.
        //   - On a TD past aT 0.85, nearby teammates converge on the
        //     scorer for a group celebration.
        // OL stay at the LOS regardless — they're not downfield blockers
        // on a pass play (they were pass-blocking the rush).
        // Inverted check: anyone NOT QB / OL is a potential downfield
        // blocker / TD-celebrator. Old enumeration whitelisted only
        // WR1-5 / TE / RB which silently dropped the FB on I-Form and
        // PRO personnel — he froze at the snap position through the
        // whole post-catch sequence.
        if (play.kind === "complete" && t > throwPhase
            && p.role !== "QB" && p.role !== "OL") {
          // Lazy-init blocker picks on first post-catch frame.
          if (!_downfieldBlockerMap) {
            const _isTarget = (cand) => cand === formation[wrChoice];
            const candidates = [];
            for (const cand of formation.offense) {
              if (cand.role === "QB" || cand.role === "OL") continue;
              if (_isTarget(cand)) continue;
              const dist = Math.hypot(cand.x - wr.x, cand.y - wr.y);
              candidates.push({ ref: cand, dist });
            }
            candidates.sort((a, b) => a.dist - b.dist);
            _downfieldBlockerMap = new Map();
            candidates.slice(0, 2).forEach((c, idx) => _downfieldBlockerMap.set(c.ref, idx));
          }
          // Was aT > 0.85 — celebrators converged on the scorer before
          // the WR had visibly crossed the goal line on long YAC TDs.
          // 0.92 keeps them running routes / blocking until the scoring
          // moment is unambiguous, then collapses on the carrier.
          const isTDCeleb = passIsTD && aT > 0.92;
          const slotIdx = _downfieldBlockerMap.get(p);   // 0, 1, or undefined
          let targetX = null, targetY = null, targetPose = "run";
          if (isTDCeleb) {
            // Cluster around scorer (who's in the endzone). Allow into
            // the endzone — was clamped to playing field (excluded the
            // endzone) so celebrators stopped at the goal line instead
            // of converging on the scorer. Now: tight clamp keeps them
            // off the very back / sidelines but they CAN enter the
            // endzone.
            const hash = ((p.y * 17 + p.x * 13) >>> 0) % 1000;
            const angle = (hash / 1000) * Math.PI * 2;
            const radius = (4 + (hash % 4)) * FIELD.PX_PER_YARD;
            // Keep the cluster IN FRONT of the goalpost (base ~18px from the
            // back edge) — 0.3 (30px) let celebrators overlap the uprights in
            // the broadcast projection ("standing on the post"). 0.5 = ~30px gap.
            targetX = clamp(wr.x + Math.cos(angle) * radius,
                            FIELD.EZ_PX * 0.5, FIELD.W - FIELD.EZ_PX * 0.5);
            targetY = clamp(wr.y + Math.sin(angle) * radius,
                            FIELD.TOP + 20, FIELD.BOT - 20);
            const _curX = p._followX != null ? p._followX : p.x;
            const _curY = p._followY != null ? p._followY : p.y;
            const _gap = Math.hypot(_curX - targetX, _curY - targetY);
            targetPose = _gap < 18 ? "celebrate" : "run";
          } else if (slotIdx != null) {
            // Downfield blocker — leads the carrier toward where the play
            // ENDS, not a fixed slot far ahead of the LIVE carrier. The old
            // "6-9 yd ahead of wr.x" meant that on a SHORT pass (carrier
            // tackled almost immediately) the blocker kept sprinting to a
            // slot 6-9 yd PAST a dead play and blew downfield at full speed
            // ("blockers hyperspeed for a 7-yd pass"). Capping the lead at
            // ~2 yd past the carrier's endpoint keeps the blocker WITH the
            // play: a short gain has almost nowhere to run (so no sprint),
            // a long gain has endX far downfield so the lead is normal.
            const _leadPx = (3 + slotIdx * 2) * FIELD.PX_PER_YARD;   // 3-5 yd lead
            const dyYd = slotIdx === 0 ? -4 : 4;
            const _leadX = wr.x + dir * _leadPx;
            const _capX  = endX + dir * 2 * FIELD.PX_PER_YARD;        // ≤2 yd past the end
            const _tx = dir > 0 ? Math.min(_leadX, _capX) : Math.max(_leadX, _capX);
            targetX = clamp(_tx, FIELD.EZ_PX * 0.3, FIELD.W - FIELD.EZ_PX * 0.3);
            targetY = clamp(wr.y + dyYd * FIELD.PX_PER_YARD,
                            FIELD.TOP + 20, FIELD.BOT - 20);
          }
          if (targetX != null) {
            // Init follow position AND velocity. CRITICAL: guard each
            // independently. The route branch persists _followX/_followY
            // (for handoff continuity) but NOT the velocities — so a
            // receiver who ran a route and is now picked as a downfield
            // blocker hits this branch with _followX already set but
            // _followVX undefined. The old `if (_followX == null)` guard
            // then skipped velocity init → `_followVX += ...` = NaN →
            // the player drew at NaN and VANISHED for the rest of the
            // play. Init velocities whenever they're missing.
            // Init from PREVIOUSLY RENDERED position so a player
            // transitioning from route/pass-block phase to post-catch
            // downfield-blocker phase doesn't snap back to formation
            // home. _lastRenderedX is captured at the end of this
            // map() each frame. Same pattern as Stage 3 run-play
            // celebration init.
            if (p._followX == null) {
              p._followX = p._lastRenderedX ?? p.x;
              p._followY = p._lastRenderedY ?? p.y;
            }
            if (p._followVX == null) { p._followVX = 0; p._followVY = 0; }
            // Frame-time factor — _followVX is px-per-60fps-frame, but the
            // position step below runs once per RENDER frame. Drive it off
            // PLAY-TIME delta (t), not wall-clock: (t-prevT)*dur = the ms of
            // PLAY time elapsed this frame, /16.67 = 60fps-frame equivalent.
            //   • frame-rate independent (120Hz → half the play-time per
            //     frame → half the step → same total), as before; AND
            //   • respects slow-mo / freezes — during the catch FREEZE
            //     (slowMoMul=0) t doesn't advance, so _dtF=0 and the blockers
            //     hold with the frozen scene. Wall-clock dt kept advancing
            //     them ~14yps through the freeze → a ~3yd SURGE at the catch
            //     ("blockers super speed when the ball arrived").
            const _dtF = (p._followT == null) ? 1
                       : Math.max(0, Math.min(3, (t - p._followT) * dur / 16.67));
            p._followT = t;
            // Speed-capped converge motion. Cap at 15 yps (celebration
            // sprint) or 14 yps (downfield blocker — must equal or
            // exceed WR_TOP_YPS_VISUAL = 13 so they can hold the slot
            // ahead of the carrier instead of getting caught and
            // "freezing" beside him).
            const _maxYPSps = isTDCeleb ? 15 : 14;
            const _maxPF = _maxYPSps * FIELD.PX_PER_YARD * 16 / 1000;
            const _fdx = targetX - p._followX;
            const _fdy = targetY - p._followY;
            const _fd  = Math.hypot(_fdx, _fdy);
            // Velocity-based motion with per-blocker decay variation.
            // Was: position lerps toward target proportional to distance
            // — when the carrier was tackled, every blocker reached
            // their slot simultaneously and stopped at the same frame.
            // Now: each blocker accumulates velocity (capped); during
            // the tackle/post-play phase, velocity DECAYS at a
            // per-blocker rate so blockers coast varying distances past
            // their slot before stopping. Looks like real momentum +
            // staggered reactions instead of synchronized halt.
            const _postPlay = aT > TACKLE_START_AT + 0.02 && !isTDCeleb;
            // Per-blocker hash → individual decay rate + responsiveness.
            // Slower decay = more glide; varies by 6-12 frames between
            // blockers so they stop on different frames.
            const _bHash = ((p.y * 17 + p.x * 13) >>> 0) % 100 / 100;
            if (_postPlay) {
              // Coast with hash-derived decay. Range 0.85-0.93 per
              // frame → exponential stop over 0.4-1.0s.
              const _decay = 0.85 + _bHash * 0.08;
              p._followVX *= _decay;
              p._followVY *= _decay;
            } else if (_fd > 0.001) {
              // Pre-tackle: accelerate toward target. Target velocity
              // is distance-proportional (smooth approach when close);
              // velocity update is a low-pass filter so direction
              // changes blend over ~6 frames instead of snapping.
              const _desiredSpeed = Math.min(_maxPF, _fd * 0.18);
              const _dvx = (_fdx / _fd) * _desiredSpeed;
              const _dvy = (_fdy / _fd) * _desiredSpeed;
              const _accel = 0.15 + _bHash * 0.06;   // 0.15-0.21
              p._followVX += (_dvx - p._followVX) * _accel;
              p._followVY += (_dvy - p._followVY) * _accel;
            }
            p._followX += p._followVX * _dtF;
            p._followY += p._followVY * _dtF;
            return { ...p,
                     x: p._followX, y: p._followY,
                     pose: targetPose,
                     t: targetPose === "celebrate"
                          ? Math.min(1, (aT - 0.85) / 0.15)
                          : (t < 0.95 ? ((performance.now() / 333)) % 1 : 0),
                     facing: dir };
          }
        }
        if (p.role === "OL" && aT > 0) {
          if (isScreen) {
            // SCREEN OL behavior: sell pass block briefly, then RELEASE
            // downfield as a convoy. Previously the OL only released
            // 32px (~2yd) and drifted modestly toward screenSide —
            // looked like "OL pushed back" not "OL leading the screen."
            // Now: 5-6yd downfield by mid-play, strong lateral drift
            // toward the catch side, so the convoy is clearly leading
            // the carrier into YAC.
            if (aT < 0.18) {
              // Sell the pass set
              return { ...p, x: p.x, y: p.y, pose: "engage", t: aT, facing: dir };
            }
            const tt = Math.min(1, (aT - 0.18) / 0.70);
            const downfield = dir * tt * 95;                          // ~6.3yd downfield by mid-play
            // Strong drift toward catch side — convoy stacks ahead of
            // carrier on the WR's sideline.
            const tgtY = cy + screenSide * 60;
            const driftY = p.y + (tgtY - p.y) * Math.min(1, tt * 1.2);
            return { ...p,
                     x: p.x + downfield,
                     y: driftY,
                     pose: "run",
                     t: (t < 0.95 ? ((performance.now() / 333)) % 1 : 0),
                     facing: dir };
          }
          // PHASE 1 — OL position emerges from its Engagement (initialized
          // up-front before def.map runs). DL has a matching reader; both
          // sides come from the same anchor + leverage state.
          const eng = p._eng;
          const olArch = (play.olType && _OL_ARCH.indexOf(play.olType) >= 0)
            ? play.olType : _archForLineman(p, "OL");
          if (eng) {
            return { ...p, x: eng.blockerX, y: eng.blockerY,
                     pose: "kick_slide",
                     t: ((t * (dur / 1000)) * 2.2) % 1,
                     facing: dir, archetype: olArch };
          }
          // Fallback (no engagement built — e.g. PassProSim unavailable):
          // keep the legacy fixed dropback + wobble.
          const tt = Math.min(1, aT / 0.55);
          const dropBack = 12 * tt;
          const wobble = Math.sin(tt * Math.PI * 6 + p.y * 0.05) * 1.3;
          return { ...p, x: p.x - dir * dropBack, y: p.y + wobble,
                   pose: "kick_slide",
                   t: ((t * (dur / 1000)) * 2.2) % 1,
                   facing: dir, archetype: olArch };
        }
        // RB / FB pass-block. A non-target RB or FB stays in the
        // backfield in pass-pro — slides slightly, scans for blitzers,
        // engages the same kick-slide footwork the OL uses. Without
        // this branch the RB falls through to the "idle" catch-all
        // (line 4326) and stands motionless through the whole play.
        if ((p.role === "RB" || p.role === "FB") && aT > 0 && !isScreen) {
          const tt = Math.min(1, aT / 0.55);
          // Slide back ~1.5 yd off the snap, hold position. Lateral
          // drift toward the play side so the back faces the rusher.
          const slideX = -dir * tt * 1.5;
          const slideY = (cy - p.y) * Math.min(1, tt * 1.3) * 0.10;
          const _x = p.x + slideX, _y = p.y + slideY;
          // Persist rendered position so the post-catch downfield-blocker
          // / TD-celebration branch can pick up FROM HERE on the catch
          // frame instead of teleporting back to p.x (formation home).
          p._followX = _x; p._followY = _y;
          return { ...p, x: _x, y: _y,
                   pose: "kick_slide",
                   t: ((t * (dur / 1000)) * 2.0) % 1,
                   facing: dir };
        }
        // Non-targeted receivers run REAL routes (decoys clear coverage).
        // First ~20% = RELEASE pose (explosive first step), then transition
        // to standard run cycle. WRs and TEs explode off the LOS before
        // settling into a route.
        // PATH B Phase 4 — when the engine emits per-slot route tracks,
        // sample them instead of hashing decoy paths. Each receiver
        // runs the route the engine specified for their slot.
        if ((p.role === "WR1" || p.role === "WR2" || p.role === "WR3" || p.role === "WR4" || p.role === "WR5" || p.role === "TE1" || p.role === "TE" || p.role === "TE2") && aT > 0) {
          const tt = Math.min(1, aT / Math.max(0.1, throwFrac));
          const strideHz = 2.0;
          const inRelease = tt < 0.20;
          // Map this player to a slot key for engine track lookup.
          const slotKey = p === formation.wr1 ? "wr1"
                        : p === formation.wr2 ? "wr2"
                        : p === formation.wr3 ? "wr3"
                        : p === formation.wr4 ? "wr4"
                        : p === formation.te  ? "te"
                        : p === formation.te2 ? "te2"
                        : null;
          const trk = (slotKey && play.motion && play.motion.tracks) ? play.motion.tracks[slotKey] : null;
          // Field-bounds clamp so a deep-go route extending past the
          // back of the endzone doesn't park a non-target WR off the
          // visible canvas and read as "the receiver disappeared."
          // EZ_PX is the endzone width; staying out of the back 30%
          // matches the downfield-blocker clamp above.
          const _clampX = (x) => clamp(x, FIELD.EZ_PX * 0.3, FIELD.W - FIELD.EZ_PX * 0.3);
          const _clampY = (y) => clamp(y, FIELD.TOP + 20, FIELD.BOT - 20);
          if (trk && typeof MotionPlayback !== "undefined") {
            const sample = MotionPlayback.sampleTrack(trk, aT);
            if (sample) {
              const toMidSign = Math.sign(cy - p.y) || 1;
              const moving = MotionPlayback.isMoving(trk, aT);
              const _x = _clampX(p.x + dir * sample.dxYd * FIELD.PX_PER_YARD);
              const _y = _clampY(p.y + toMidSign * sample.dyYd * FIELD.PX_PER_YARD);
              // Persist for the post-catch handoff (see RB pass-block).
              p._followX = _x; p._followY = _y;
              return { ...p, x: _x, y: _y,
                       pose: inRelease ? "release" : "run",
                       t: moving ? ((t * (dur / 1000)) * strideHz) % 1 : 0,
                       facing: dir };
            }
          }
          // Fallback: legacy hash decoys for receivers without a slot
          // track (WR3+, screen plays, plays missing motion data).
          const idHash = ((p.y * 7 + (p.x * 3)) >>> 0) % 100 / 100;
          const decoyDepth = catchDepth * (0.6 + idHash * 0.6);
          const lateralOff = (idHash - 0.5) * 36;
          // Pace the clear-out at a REALISTIC speed (~9 yps) and hold once
          // at depth — NOT "reach full depth by the catch". On a quick throw
          // (WR screen) throwFrac is tiny, so the old tt = aT/throwFrac
          // sprinted the backside decoys downfield at superhuman speed
          // ("the side that's not the screen went super speed downfield").
          const _decoySec = Math.max(0, aT * actionDur / 1000);
          const _decoyYd  = Math.min(decoyDepth, 9 * _decoySec);
          const _decoyProg = decoyDepth > 0.1 ? _decoyYd / decoyDepth : 1;
          const _x = _clampX(p.x + dir * _decoyYd * FIELD.PX_PER_YARD);
          const _y = _clampY(p.y + Math.sin(_decoyProg * Math.PI * 0.6) * lateralOff);
          p._followX = _x; p._followY = _y;
          return { ...p, x: _x, y: _y,
                   pose: inRelease ? "release" : "run",
                   t: ((t * (dur / 1000)) * strideHz) % 1,
                   facing: dir };
        }
        return { ...p, pose: "idle", facing: dir };
      });
      // Capture each offense slot's RENDERED position. The post-catch
      // downfield-blocker / TD-celebration init at line ~5501 reads
      // p._followX (initialized from p._lastRenderedX) so a player
      // transitioning from route-phase to post-catch phase doesn't
      // snap back to formation home. Mirrors the Stage 3 run-play
      // capture. formation.offense order matches the map (no filter).
      for (let _k = 0; _k < formation.offense.length && _k < off.length; _k++) {
        const _fp = formation.offense[_k];
        const _r  = off[_k];
        if (!_r || typeof _r.x !== "number" || typeof _r.y !== "number") continue;
        _fp._lastRenderedX = _r.x;
        _fp._lastRenderedY = _r.y;
      }
      _syncDefRendered(def);
      drawPlayers(off, def);
      // Standalone ball visibility. The ball is drawn ONLY while it's a
      // free object — in the air (pure flight) or loose on the ground
      // (incomplete bounce). Whenever a player SPRITE already depicts the
      // ball it's suppressed: the QB cradle/throwing hand, the WR catch,
      // and the carry (the carry sprite has a tucked ball — the old gate
      // kept drawing a second ball that stuck to the carrier's body
      // through the whole YAC). Per design: show it coming out into the
      // air and arcing, hide it AT both hands and during the carry.
      // SINGLE BALL ON THE FIELD — the catch/reach/leap sprites have a ball
      // baked into the hands (and the carry sprites a tucked ball). Whenever
      // one of those is on screen it IS the ball, so the standalone flight
      // ball must be suppressed or two balls show at once. Hand off to the
      // catch sprite, but ONLY once the ball is genuinely near the hands.
      const _flightSpan = Math.max(0.001, throwEndAT - releaseAT);
      const _airStart = releaseAT + _flightSpan * 0.08;
      const _airEnd   = throwEndAT - _flightSpan * 0.06;
      // The catch/leap POSE windup opens at a fixed offset in FULL-PLAY time
      // (throwPhase - 0.10 for a leap). On a deep ball the flight is only a
      // small slice of the play, so that 0.10 lead reaches back to MID-FLIGHT
      // in action-time — suppressing the standalone there made the ball
      // VANISH halfway through a ~20-yd leaping sideline throw. Gate the
      // hand-off on FLIGHT progress instead: only suppress in the final
      // stretch of flight (ball near the hands), regardless of how early the
      // windup pose engages. The catch sprite is already up by then, so the
      // hand-off stays clean and the ball never disappears mid-flight.
      const _nearCatch = at >= throwEndAT - _flightSpan * 0.13;
      const _spriteHoldsCatchBall = (inLeapWindow || isCatching) && _nearCatch;
      let showStandalone;
      if (t < PRE || at < snapMotionAT) {
        showStandalone = true;            // pre-snap + C→QB snap toss
      } else if (play.kind === "complete") {
        // Flight only, and hand off to the catch sprite the moment it
        // engages — its hand-ball becomes the single ball through the carry.
        showStandalone = at >= _airStart && at < _airEnd && !_spriteHoldsCatchBall;
      } else if (play.kind === "incomplete") {
        // A MISS (overthrow / underthrow / leapmiss / PD) keeps the standalone
        // — it's the real ball flying PAST the receiver, somewhere the
        // sprite's (wrong) hand-ball isn't. Only a DROP has the ball briefly
        // in the hands, so suppress the standalone there during the reach.
        showStandalone = at >= releaseAT && !(play.isDrop && _spriteHoldsCatchBall);
      } else {
        // int: the ball continues to the DEFENDER, so the intended
        // receiver's reach sprite must NOT suppress it. Pure-flight window.
        showStandalone = at >= _airStart && at < _airEnd;
      }
      // PASS TRAIL — once the ball is in flight, draw a fading parabolic
      // dotted trail from release point to current ball position. Persists
      // through catch + YAC so the user can see the throw retroactively.
      if (at >= releaseAT && typeof drawBallTrail === "function") {
        const flightProg = Math.min(1, (at - releaseAT) / Math.max(0.0001, throwEndAT - releaseAT));
        drawBallTrail(ctx, releaseX, releaseY, ballX, ballY, flightProg, { arcHeight: arcHeight * 0.85 });
      }
      // HANDS-TRACK-BALL on pass plays — pull standalone ball to the
      // ball-hand position. Phases:
      //   QB cradle/cock (suppressed in showStandalone) — no effect
      //   QB release (just after releaseAT) — ball at throwing hand
      //   Flight — caller's ballX/ballY (engine trajectory)
      //   Catch arrival (around throwEndAT) — ball at receiver's
      //     raised reach hands (midpoint of both)
      //   Post-catch carry — ball at receiver's tuck hand
      const _passerName = play.passer;
      const _rcvrName   = play.receiver || play.intended;
      const _carrierSink = drawPlayer._carryHandSink || {};
      let _ballDrawX = ballX, _ballDrawY = ballY, _ballDrawAng = ballAngle;
      // At release moment (briefly after release): ball comes out of throw hand
      if (at < releaseAT + 0.02 && at > releaseAT - 0.02 && _passerName && _carrierSink[_passerName]) {
        const h = _carrierSink[_passerName];
        _ballDrawX = h.x; _ballDrawY = h.y;
      }
      // At catch arrival: ball lands at receiver's raised hands.
      // INCOMPLETE / INT: skip hand-track — the bounce/roll (incomplete)
      // or DB-pickup (int) trajectory in ballX/ballY is authoritative.
      // Pulling to the WR's hands here teleports the ball onto a body
      // that isn't holding it, hiding the visual bounce.
      else if (play.kind === "complete"
               && at >= throwEndAT - 0.02 && at < throwEndAT + 0.04
               && _rcvrName && _carrierSink[_rcvrName]) {
        const h = _carrierSink[_rcvrName];
        _ballDrawX = h.x; _ballDrawY = h.y;
      }
      // CATCH FLASH — on the first frame after the ball arrives at a
      // completed catch, freeze the action briefly + tint the ball
      // green to celebrate the moment (NFL replay style). One-shot
      // per play via play._catchFlashFired.
      if (play.kind === "complete" && at >= throwEndAT && !play._catchFlashFired) {
        play._catchFlashFired = true;
        const _now = performance.now();
        if (typeof animState !== "undefined" && animState) {
          animState.slowMoUntil = _now + 220;   // hold the frame ~0.22s
          animState.slowMoMul = 0;                // total freeze (t doesn't advance)
        }
        play._catchFlashUntil = _now + 350;       // green tint a bit longer than the freeze
        if (typeof GCFx !== "undefined") {
          GCFx.flash("#7cff7c", 180, 0.10);       // brief green field flash
        }
        // BIG-CATCH crowd reaction — fires AT the catch (was at snap from
        // _isBigPlay). >= 20 yds threshold; matches the audio classifier.
        const _bigCatchYds = play.yards ?? 0;
        if (_bigCatchYds >= 20 && typeof GCAudio !== "undefined") {
          GCAudio.play("bigplay");
          GCAudio.crowd.swell(0.22, 1200, 1600);
        }
      }
      // INT FLASH — equivalent moment when the defender hauls in the
      // interception. Brief slow-mo freeze + crowd reaction synced to
      // the actual pick frame. Was: groan fired at snap (before the
      // throw even left the QB's hand).
      if (play.kind === "int" && at >= throwEndAT && !play._intFlashFired) {
        play._intFlashFired = true;
        const _now = performance.now();
        if (typeof animState !== "undefined" && animState) {
          animState.slowMoUntil = _now + 280;   // slightly longer than catch
          animState.slowMoMul = 0;
        }
        if (typeof GCFx !== "undefined") {
          GCFx.flash("#ffaa30", 220, 0.12);     // amber field flash
        }
        if (typeof GCAudio !== "undefined") {
          // Picking team crowd reacts (bigplay). Offense groan deferred
          // here too so the QB-side and DB-side reactions both sync.
          GCAudio.play("bigplay");
          GCAudio.crowd.swell(0.25, 1400, 1700);
        }
      }
      // Post-catch carry: ball at receiver's tuck hand. Completed catches
      // only — on incomplete, ballX/ballY follows the engine bounce/roll
      // trajectory and must not be overridden to the receiver body.
      else if (play.kind === "complete" && at > throwEndAT + 0.04 && _rcvrName) {
        const h = _carrierSink[_rcvrName];
        // Sink freshness check — if the sink is stale (older than 50ms,
        // which happens during tackle poses where the carry-hand logic
        // doesn't run because arms splay outward), fall back to a body-
        // relative tuck offset so the ball stays visibly held instead
        // of jumping to wherever the last carry-frame put it.
        if (h && (performance.now() - h.frameMs) < 50) {
          _ballDrawX = h.x; _ballDrawY = h.y;
        } else {
          // Tuck offset: slight forward + chest height. Reads as ball
          // held against the body during the fall.
          _ballDrawX = ballX + dir * 4;
          _ballDrawY = ballY - 4;
        }
      }
      if (showStandalone) {
        const _ballOpts = { angle: _ballDrawAng };
        // Green-tint the ball during the catch flash window
        if (play._catchFlashUntil && performance.now() < play._catchFlashUntil) {
          _ballOpts.highlight = "catch";
        }
        // On incomplete, the ball is on the ground bouncing/rolling near
        // the receiver — disable drawBall's carrier auto-shift so the ball
        // isn't yanked up to the WR's hand position.
        if (play.kind === "incomplete" && at > throwEndAT - 0.02) {
          _ballOpts.skipCarryShift = true;
        }
        drawBall(ctx, _ballDrawX, _ballDrawY, arc > 30 ? 1.3 : 1, _ballOpts);
      }
      // Play-action / Flea-flicker / Throw-on-run banner at the top of the field
      if ((play.isPlayAction || play.isTOR || play.isFleaFlicker) && t < throwPhase + 0.08) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "900 20px sans-serif";
        const lbl = play.isFleaFlicker ? "🎪 FLEA FLICKER"
                  : play.isTOR ? "🏃 THROW ON THE RUN"
                  : "🎭 PLAY-ACTION";
        const lblColor = play.isFleaFlicker ? "#ffd54d"
                       : play.isTOR ? "#ffb060"
                       : "#c890ff";
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(FIELD.W/2 - 140, 8, 280, 28);
        ctx.fillStyle = lblColor;
        ctx.fillText(lbl, FIELD.W / 2, 22);
        ctx.restore();
      }
      // Throw-type callout — small label near the QB during the throw window
      if (play.throwType && play.throwType !== "CHECKDOWN" && t > dropPhase && t < throwPhase + 0.05) {
        ctx.save();
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = "900 16px sans-serif";
        const lbl = play.throwType === "ZIP"   ? "🎯 ZIPPED IT"
                  : play.throwType === "DEEP"  ? "🚀 DEEP BALL"
                  : play.throwType === "TOR"   ? "🏃 ON THE RUN"
                  :                              "🪶 TOUCH";
        const lblX = qb.x + dir * 14;
        const lblY = qb.y - 18;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.strokeText(lbl, lblX, lblY);
        ctx.fillStyle = play.throwType === "ZIP" ? "#ffb060" : "#9be09b";
        ctx.fillText(lbl, lblX, lblY);
        ctx.restore();
      }
      // WR juke callout — fires during the juke window with a big yellow flash
      if (play.wrJuke && t > throwPhase + 0.02 && t < throwPhase + 0.30) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "900 26px sans-serif";
        const lbl = "🔥 CATCH & JUKE!";
        const lblX = (wr.x + (qb.x + dir * 60)) / 2;
        const lblY = wr.y - 26;
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.strokeText(lbl, lblX, lblY);
        ctx.fillStyle = "#f0cc30";
        ctx.fillText(lbl, lblX, lblY);
        ctx.restore();
      }
      // In-canvas TOUCHDOWN! banner removed — cinema overlay + chyron
      // + result card cover the scoring chrome.
      // INT CONTEXT CARD — held until the return resolves (aT > 0.85)
      // so the "PICK SIX" / "Touchback" / "Returned X yds" sub-line
      // doesn't reveal the return outcome before the user has watched
      // the runback. Was firing at aT > throwPhase = immediately after
      // the pick, naming the result before the picker had even started
      // running.
      if (play.kind === "int" && aT > 0.85) {
        const fadeT = Math.min(1, (aT - 0.85) / 0.04) * Math.min(1, (1 - aT) / 0.05);
        const lastName = (n) => String(n || "").split(/\s+/).pop().toUpperCase();
        const passer  = lastName(play.passer);
        const picker  = lastName(play.defender);
        const target  = lastName(play.intended);
        const retYds  = play.intReturnYds || 0;
        const downTag = play.down ? `${play.down}${play.down===1?"ST":play.down===2?"ND":play.down===3?"RD":"TH"}` : "";
        const ytgTag  = (play.ytg != null) ? ` & ${play.ytg}` : "";
        // 3-line card
        const line1 = downTag ? `${downTag}${ytgTag}` : "INTERCEPTION";
        const line2 = target
          ? `${passer} intended for ${target} — ${picker} steps in front`
          : `${passer} pass picked off by ${picker}`;
        const line3 = play.isPickSix          ? "🚀 PICK SIX — DEFENSIVE TOUCHDOWN"
                    : play.isTouchback        ? "Touchback — recovered in the end zone"
                    : retYds > 0              ? `Returned ${retYds} yds`
                    :                            "No return — tackled immediately";
        ctx.save();
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const cardX = 24, cardY = FIELD.H - 96;
        const cardW = 420, cardH = 76;
        ctx.fillStyle = `rgba(0,0,0,${fadeT * 0.72})`;
        ctx.fillRect(cardX, cardY, cardW, cardH);
        ctx.strokeStyle = `rgba(120,180,255,${fadeT * 0.95})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(cardX, cardY, cardW, cardH);
        ctx.font = "bold 11px monospace";
        ctx.fillStyle = `rgba(120,180,255,${fadeT})`;
        ctx.fillText(line1, cardX + 12, cardY + 10);
        ctx.font = "bold 13px sans-serif";
        ctx.fillStyle = `rgba(255,255,255,${fadeT})`;
        ctx.fillText(line2, cardX + 12, cardY + 30);
        ctx.font = "bold 13px sans-serif";
        ctx.fillStyle = play.isPickSix
          ? `rgba(255,212,77,${fadeT})`
          : `rgba(255,150,80,${fadeT})`;
        ctx.fillText(line3, cardX + 12, cardY + 52);
        ctx.restore();
      }
      drawPreSnapCallouts(ctx, t, dur);
    }};
  }

  if (play.kind === "sack") {
    const endX = yardToAbsX(play.endYard, poss);
    // Sack action plays out like a normal pass play first (drop + scan
    // through the QB's progressions) before pressure breaks through.
    // Floor at 2800ms (~drop + 1.5s of scan) so the rush doesn't arrive
    // before the play visually develops.
    const actionDur = clamp(2800 + Math.abs(play.sackLoss || 0) * 100, 2800, 4500);
    const dur = actionDur + PRE_MS;
    PRE = PRE_MS / dur;
    // Per-sack variation seed — no two sacks look the same.
    const sackSeed = ((play.startYard * 17) ^ ((play.sackLoss || 0) * 53) ^ ((play.time || 0) * 7)) >>> 0;
    const r = (i) => ((sackSeed >> (i * 3)) & 0xff) / 256;  // pseudorandom 0-1 from seed bits
    // Each sack picks: who's the primary rusher, when contact happens,
    // dance frequency/intensity, fall direction, second-chaser presence.
    // PATH B sweep — engine knows dlName (the sacker). Resolve to its
    // formation index so the visual sacker matches the named one.
    // Falls back to hash pick when name resolution fails.
    let primaryIdx = Math.floor(r(0) * 4);
    // Resolve the VISUAL primary sacker from the CREDITED sacker
    // (motion.sackerName) — which may be a blitzing LB/DB (idx >= 4), not
    // just a DL. Resolving from dlName (the beaten OL's man) and clamping
    // to <4 put a SEPARATE DL on the takedown while the LB's sacker-track
    // ran in parallel: two bodies converged and the chyron/box named
    // different players. When the sacker is an LB, primaryIdx becomes his
    // index; the DL-rush block (i<4) then never flags a DL as primary, so
    // only the track-driven blitzer makes the sack. Fall back to dlName,
    // then the random DL.
    const _crSacker = (play.motion && play.motion.sackerName) || play.dlName;
    if (_crSacker) {
      const resolved = formation.defense.findIndex(d => d && d.name === _crSacker);
      if (resolved >= 0) primaryIdx = resolved;
    }
    // Is the primary sacker a non-lineman blitzer (LB/DB, idx >= 4)? Used
    // to drive his rush when no engine track is present, and to skip the
    // "beaten OL" override (a clean blitz wasn't a one-on-one OL loss).
    const _primaryIsBlitzer = primaryIdx >= 4;
    // Use engine-emitted contactT when present so the QB tackle pose
    // and the sacker pursuit track converge on the same frame. Falls
    // back to per-play random for plays without motion. Range 0.62-0.75
    // keeps the first ~65% of the play looking like a normal pass play,
    // with the takedown + fall + pile/celebration occupying the last
    // 35% of the action.
    const contactT = (play.motion && typeof play.motion.contactT === "number")
      ? play.motion.contactT
      : 0.62 + r(1) * 0.13;
    const danceFreq = 3.5 + r(2) * 4.5;              // pocket wiggle frequency
    const danceAmpY = 4 + r(3) * 12;                 // Y wiggle amplitude
    const danceAmpX = 2 + r(4) * 8;                  // X drift amplitude
    const xDir = r(5) > 0.5 ? 1 : -1;                // QB drifts which way?
    const yFlavor = r(6) > 0.5 ? 1 : -1;             // initial drift direction
    const secondChaser = r(7) > 0.55;                // does a 2nd DL get in?
    const secondIdx = (primaryIdx + 1 + Math.floor(r(8) * 3)) % 4;
    const fallTilt = -0.6 + r(9) * 1.2;              // tackle fall angle bias (left/right)
    const dropDepth = 4 + r(10) * 3;                 // how deep the QB drops (4-7 yds)
    let _sackRumbled = false;
    // PHASE 2 — trench engagement for the sack. Pairs each OL with the
    // closest NON-primary DL (the primary is the shedder who beats his
    // block and gets home). Strong negative leverage so the pocket cup
    // collapses toward the QB as the sack develops. Built lazily on the
    // first post-snap frame; stepped once per frame before the maps run.
    let _sackPassPro = null;
    return { duration: dur, kind: "sack", render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);
      // RUMBLE at contact (engine-emitted contactT). Edge-triggered
      // so the shake fires once when the sacker arrives at the QB,
      // not at play start (which used to paint an "explosion in the
      // middle of the field" before anything happened).
      if (!_sackRumbled && t > PRE) {
        const tt = (t - PRE) / (1 - PRE);
        if (tt >= contactT - 0.01) {
          if (typeof GCFx !== "undefined") GCFx.shake(5, 200);
          // Crowd reacts AT contact — was firing at play start (sack in
          // _isBigPlay) which made the cheer arrive before the rush even
          // released. Now synced to the actual hit.
          if (typeof GCAudio !== "undefined") {
            GCAudio.play("bigplay");
            GCAudio.crowd.swell(0.20, 1000, 1400);
          }
          _sackRumbled = true;
        }
      }
      // Shared release timing — used by both QB (evade bias) + DL (rush
      // release). Floor 0.45 keeps the rush from winning before the QB
      // finishes his drop and first read.
      const _sackRushReleaseT = Math.max(0.45, contactT - 0.12);
      // STRIP-SACK ball physics — pops loose at contact, bounces 3 times
      // toward the sacker (+dir), then settles. Returns null when not in
      // a strip-sack post-contact window.
      const _isStripSack = !!play.isStripSack;
      function _stripBallAt(tt, qbX, qbY) {
        if (!_isStripSack || tt < contactT) return null;
        const stripT = (tt - contactT) / Math.max(0.001, 1 - contactT);
        const settleX = qbX + dir * 28;
        const settleY = qbY + ((sackSeed % 13) - 6);
        const bx = qbX + (settleX - qbX) * Math.min(1, stripT * 2.4);
        let by, ang;
        if (stripT < 0.50) {
          const bounceT = stripT / 0.50;
          const bounceIdx = Math.floor(bounceT * 3);
          const localT = bounceT * 3 - bounceIdx;
          const amp = 18 * Math.pow(0.45, bounceIdx);
          by = settleY - Math.sin(localT * Math.PI) * amp;
        } else {
          by = settleY;
        }
        ang = stripT * 14 * Math.max(0, 1 - stripT * 1.6);
        return { x: bx, y: by, ang };
      }
      // Estimated primary rusher position at this tt — used to bias the
      // QB's wiggle AWAY from the closing rusher instead of randomly.
      const _primaryStart = formation.defense[primaryIdx] || formation.defense[0];
      function _estRusherPos(tt, qbX, qbY) {
        if (tt < _sackRushReleaseT) return { x: _primaryStart.x, y: _primaryStart.y };
        if (tt < contactT) {
          const rT = (tt - _sackRushReleaseT) / Math.max(0.001, contactT - _sackRushReleaseT);
          return { x: _primaryStart.x + (qbX - _primaryStart.x) * rT,
                   y: _primaryStart.y + (qbY - _primaryStart.y) * rT };
        }
        return { x: qbX, y: qbY };
      }
      const qb = { ...formation.qb };
      let qbPose = "idle";
      if (t > PRE) {
        const tt = (t - PRE) / (1 - PRE);
        // Base drop varies by seed: some sacks the QB barely drops, others he gets deep
        const dropFrac = Math.min(1, tt / 0.30);
        qb.x = formation.qb.x - dir * dropFrac * dropDepth * FIELD.PX_PER_YARD;
        qb.y = cy;
        // Pocket pressure — small seeded idle motion + evade bias AWAY
        // from the closing primary rusher. Was a pure sin wiggle on a
        // random direction (xDir/yFlavor) which let the QB drift INTO
        // the rusher. Now the evade term scales with rusher closeness
        // so the QB visibly steps up / leans away as pressure arrives.
        if (tt > 0.12 && tt < contactT) {
          const danceT = (tt - 0.12) / (contactT - 0.12);
          const wigY = Math.sin(tt * Math.PI * danceFreq + (sackSeed % 11)) * danceAmpY * 0.35;
          const wigX = Math.cos(tt * Math.PI * (danceFreq - 1) + (sackSeed % 5)) * danceAmpX * danceT * 0.35;
          qb.y += wigY * yFlavor;
          qb.x += wigX * xDir;
          // Evade — fades in after rusher release, grows with closeness.
          if (tt > _sackRushReleaseT) {
            const rPos = _estRusherPos(tt, qb.x, qb.y);
            const dxA = qb.x - rPos.x, dyA = qb.y - rPos.y;
            const dA = Math.hypot(dxA, dyA) || 1;
            const closeness = Math.max(0, 1 - dA / (FIELD.PX_PER_YARD * 6));
            const evade = closeness * 11;
            qb.x += (dxA / dA) * evade;
            qb.y += (dyA / dA) * evade;
          }
        }
        // Final takedown — fall point shifts based on flavor
        if (tt > contactT) {
          const fallT = (tt - contactT) / (1 - contactT);
          qb.x = qb.x + (endX - qb.x) * fallT;
          qb.y = qb.y + fallTilt * fallT * 4;
          qbPose = "tackled";
        } else if (tt < 0.30) {
          // Dropback — use drop_step pose, NOT "run". The run pose
          // auto-faces by velocity, so dropping back (moving -dir)
          // flipped the QB's facing to -dir = "facing his own
          // endzone". drop_step keeps caller-set facing intact.
          qbPose = "drop_step";
        } else {
          // Post-dropback, pre-contact — QB is scanning, ball at chest.
          // Use dedicated qb_carry sprite (two-handed cradle at sternum)
          // instead of the throw motion. Throw was a stand-in before
          // qb_carry existed.
          qbPose = "qb_carry";
        }
      }
      // Strip-sack ball target this frame — referenced by primary-sacker
      // dive + pile-follower convergence below.
      const _stripBall = (t > PRE) ? _stripBallAt((t - PRE) / (1 - PRE), qb.x, qb.y) : null;
      // PHASE 2 — build/step the sack pocket engagement. OL pair with the
      // closest non-primary DL; the primary breaks free (its rush logic
      // is unchanged below). Leverage is strongly negative so the cup
      // visibly collapses as the rush wins.
      if (t > PRE && _sackPassPro == null && typeof PassProSim !== "undefined") {
        _sackPassPro = new PassProSim({ dir, losX });
        const ols = formation.offense.filter(x => x.role === "OL");
        const dls = formation.defense.filter((x, j) =>
          x.role === "DL" && j !== primaryIdx && !(secondChaser && j === secondIdx));
        for (const ol of ols) {
          let best = null, bestDY = Infinity;
          for (const dl of dls) {
            const dyd = Math.abs(dl.y - ol.y);
            if (dyd < bestDY) { bestDY = dyd; best = dl; }
          }
          if (best) {
            const eng = _sackPassPro.addPair(ol, best, {
              lanePx: ol.y - cy,
              leverage: -0.55,   // rush is winning → pocket compresses
              driftPx: 0.9,
              wobble: 1.0,
              pull: 0.30,
            });
            ol._sackEng = eng;
            best._sackEng = eng;
          }
        }
      }
      if (_sackPassPro) _sackPassPro.step(performance.now());
      const def = formation.defense.map((d, i) => {
        const dd = { ...d, pose: t < PRE ? "stance" : "run", t: (t < 0.95 ? ((performance.now() / 333) + i * 0.13) % 1 : 0), facing: -dir };
        if (t < PRE) {
          const sh = defShiftXY(i, t);
          dd.x = d.x + sh.dx;
          dd.y = d.y + sh.dy;
          dd.pose = isDefShifting(i, t) ? "run" : (isDefPointer(i) ? "point" : "stance");
          return dd;
        }
        if (t <= PRE) return dd;
        // Carry last rendered position into dd's starting basis (Stage 4
        // pattern, applied to the sack branch). Without this, the post-
        // snap branch reads dd.x = d.x (formation) instead of the
        // coverage-adjusted pre-snap render, teleporting any defender
        // whose pre-snap shift differed from formation.
        if (typeof d._lastRenderedX === "number") {
          dd.x = d._lastRenderedX;
          dd.y = d._lastRenderedY;
        }
        const tt = (t - PRE) / (1 - PRE);
        // PATH B Phase 7 — engine-emitted sacker track wins for the
        // named DL/blitzer. Other DLs continue with the existing
        // pursue-based logic so the visual "pile" still develops.
        const _sackerTrack = (play.motion && play.motion.tracks && play.motion.tracks.sacker) || null;
        const _sackerName = play.motion && play.motion.sackerName;
        const _isSackerByName = _sackerName && d.name === _sackerName;
        if (_sackerTrack && _isSackerByName && typeof MotionPlayback !== "undefined") {
          const sample = MotionPlayback.sampleTrack(_sackerTrack, tt);
          if (sample) {
            dd.x = losX + dir * sample.dxYd * FIELD.PX_PER_YARD;
            dd.y = cy + sample.dyYd * FIELD.PX_PER_YARD;
            const _engineContactT = (play.motion && play.motion.contactT) || contactT;
            if (tt > _engineContactT + 0.03) {
              dd.pose = "sack";
              // Progress the sack/fall sprite 0→1 ONCE across contact→end
              // and hold flat. The old code only froze dd.t when the
              // sacker stopped MOVING — but he rides the QB forward from
              // contact to t=0.95, so during that ride the wall-clock
              // default dd.t (set at the top of the map) cycled the
              // 4-frame fall sprite on a loop = "flopping like a seal".
              dd.t = Math.min(1, Math.max(0,
                (tt - _engineContactT) / Math.max(0.001, 1 - _engineContactT)));
            } else if (!MotionPlayback.isMoving(_sackerTrack, tt)) {
              dd.t = 0;   // engaged-at-LOS hold (pre-contact), frozen frame
            }
            return dd;
          }
        }
        if (i < 4) {
          const isPrimary = i === primaryIdx;
          const isSecondary = secondChaser && i === secondIdx;
          const rushReleaseT = _sackRushReleaseT;
          // PILE CONVERGENCE — once the QB is down, ALL remaining DL
          // release from their OL blocks and converge on the carrier.
          // Real sacks: 2-4 defenders typically arrive within the
          // first second of the takedown. Was: non-rushers held OL
          // engagement for the entire play even after contact.
          const PILE_START = contactT + 0.05;
          if (tt < rushReleaseT) {
            // Engaged hold. PHASE 2: non-primary/secondary DL read their
            // pocket engagement (cup) instead of a hand-tuned sway. The
            // primary/secondary rushers keep the small forward struggle
            // since they're about to break free.
            if (d._sackEng && !isPrimary && !isSecondary) {
              dd.x = d._sackEng.defenderX;
              dd.y = d._sackEng.defenderY;
            } else {
              const wig = Math.sin(tt * Math.PI * 1.5 + i) * 1.2;
              const fwdProgress = isPrimary ? Math.min(3, tt * 4) : 0;
              const _dlBaseX2 = (typeof d._lastRenderedX === "number") ? d._lastRenderedX : d.x;
              const _dlBaseY2 = (typeof d._lastRenderedY === "number") ? d._lastRenderedY : d.y;
              dd.x = _dlBaseX2 + dir * fwdProgress;
              dd.y = _dlBaseY2 + wig;
            }
            dd.pose = "engage";
            // Hold the engage pose on frame 0 (was wall-clock cycling
            // through the 4-frame engage anim at ~3 Hz = visible
            // shuffle). Frame 0 reads as "locked in the block".
            dd.t = 0;
          } else if (isPrimary || isSecondary) {
            // RUSH PHASE — primary (and optional secondary) break free
            // and chase the QB. Pile-followers join after PILE_START.
            const speedFactor = isPrimary ? 1.05 : 0.88;
            const _rushElapsed = Math.max(0, tt - rushReleaseT) * dur * speedFactor;
            const angleOffset = isPrimary ? 0 : (i - primaryIdx) * 4;
            // Sync pursue start position to the engagement-end spot so
            // there's no teleport from LOS to formation defaults.
            if (!d._sackRushSynced) {
              if (d._sim) { d._sim.x = dd.x; d._sim.y = dd.y; d._sim._lastMs = null; }
              d._sackRushSynced = true;
            }
            const np = pursue(dd, qb.x + dir * 2 + angleOffset, qb.y + (isSecondary ? 6 : 0), _rushElapsed, isPrimary ? 1.0 : 0.85);
            dd.x = np.x; dd.y = np.y;
            if (!np.moved) dd.t = 0;
            // Primary sacker post-contact:
            //   STRIP-SACK: dive onto the loose ball (tackled pose) — no
            //     celebration until recovery is confirmed.
            //   CLEAN SACK: hold 'sack' briefly, then 'celebrate' (steps
            //     off QB, arms up).
            if (isPrimary && _isStripSack && _stripBall && tt > contactT + 0.03) {
              dd.pose = "tackled";
              dd.x = _stripBall.x + dir * 4;   // sacker's body slightly past the ball
              dd.y = _stripBall.y - 3;
              dd.t = Math.min(1, (tt - contactT - 0.03) / 0.20);
              dd.facing = -dir;
            } else if (isPrimary && _isStripSack && tt > contactT - 0.10 && tt <= contactT + 0.03) {
              // Strip-sack contact window — arm-chop at the ball. Just
              // before the ball pops loose and the sacker dives on it.
              dd.pose = "strip_swat";
              dd.t = Math.min(1, (tt - (contactT - 0.10)) / 0.13);
              dd.facing = -dir;
            } else if (isPrimary && !_isStripSack && tt > contactT + 0.15) {
              dd.pose = "celebrate";
              dd.t = Math.min(1, (tt - contactT - 0.15) / Math.max(0.001, 0.85 - contactT));
              // Stand up slightly off the QB — sacker steps back to flex
              dd.x = qb.x + dir * 10;
              dd.y = qb.y - 6;
              dd.facing = -dir;
            } else if (isPrimary && tt > contactT + 0.03) {
              dd.pose = "sack";
              dd.t = Math.min(1, (tt - contactT) / 0.18);
            } else if (isSecondary && tt > contactT + 0.05) {
              dd.pose = "sack";
              dd.t = Math.min(1, (tt - contactT - 0.05) / Math.max(0.001, 0.95 - contactT));
            } else {
              dd.pose = "run";
            }
          } else if (tt >= PILE_START) {
            // PILE FOLLOWERS — release from OL and converge on the
            // carrier/ball. Per-slot offset so they don't stack.
            // Strip-sack: target the loose ball, not the QB.
            // PHASE 2: shed the pocket engagement so it stops pinning
            // this DL to its blocker while it pursues the pile.
            if (d._sackEng && !d._sackEng.shed) d._sackEng.releaseShed();
            const _pileT = (tt - PILE_START) * dur / 1000;
            const offX = ((i - primaryIdx) * 6) + (i * 3 - 4);
            const offY = ((i & 1) ? 8 : -8) + (i - 2) * 3;
            const tgtCx = (_isStripSack && _stripBall) ? _stripBall.x : qb.x;
            const tgtCy = (_isStripSack && _stripBall) ? _stripBall.y : qb.y;
            if (!d._sackRushSynced) {
              if (d._sim) { d._sim.x = dd.x; d._sim.y = dd.y; d._sim._lastMs = null; }
              d._sackRushSynced = true;
            }
            const np = pursue(dd, tgtCx + offX, tgtCy + offY, _pileT, 0.80);
            dd.x = np.x; dd.y = np.y;
            const arrived = Math.hypot(dd.x - (tgtCx + offX), dd.y - (tgtCy + offY)) < 8;
            // On the pile, settle into engage/scrum; on strip-sacks the
            // scrum reads as a dogpile diving on the ball.
            dd.pose = arrived ? (_isStripSack ? "tackled" : "engage") : "run";
            if (arrived) dd.t = 0;
            else if (!np.moved) dd.t = 0;
          } else {
            // Non-rushing DL hold the LOS engaged with OL between
            // rushReleaseT and PILE_START. PHASE 2: read the pocket
            // engagement (cup) so they track their blocker as the
            // pocket collapses, instead of swaying around a fixed spot.
            if (d._sackEng && !d._sackEng.shed) {
              dd.x = d._sackEng.defenderX;
              dd.y = d._sackEng.defenderY;
            } else {
              const wig = Math.sin(tt * Math.PI * 1.2 + i * 0.7) * 1.0;
              const _dlBaseX3 = (typeof d._lastRenderedX === "number") ? d._lastRenderedX : d.x;
              const _dlBaseY3 = (typeof d._lastRenderedY === "number") ? d._lastRenderedY : d.y;
              dd.x = _dlBaseX3 + wig * 0.5;
              dd.y = _dlBaseY3 + wig;
            }
            dd.pose = "engage";
            dd.t = 0;
          }
        } else if (i >= 4 && i <= 6) {
          // LBs hold their drop depth with a slow scrape — slight
          // forward drift, gentle sway, frozen pose-frame. Base from
          // _lastRenderedX so a walked-up blitz LB doesn't snap back
          // to formation slot at the snap (was a 14yd jump in the
          // detector's sack/- class).
          const _lbBaseX = (typeof d._lastRenderedX === "number") ? d._lastRenderedX : d.x;
          const _lbBaseY = (typeof d._lastRenderedY === "number") ? d._lastRenderedY : d.y;
          const lbProg = Math.min(1, tt * 1.2);
          const wigLB = Math.sin(tt * Math.PI * 1.0 + i * 0.5) * 0.8;
          dd.x = _lbBaseX - dir * lbProg * 12;
          dd.y = _lbBaseY + wigLB;
          dd.pose = "scrape";
          dd.t = 0;
        }
        return dd;
      });
      // LOSING OL — the lineman who got beaten by the primary rusher.
      // Engine credits play.olName but we don't have name handles on
      // formation slots. Map by position: DL primaryIdx (de1/dt1/dt2/de2,
      // 0..3) -> OL slot (LT/LG/RG/RT). Center (middle OL) is rarely the
      // pure loss spot in the engine model.
      const _sackOlList = formation.offense
        .filter(o => o.role === "OL")
        .sort((a, b) => a.y - b.y);   // sorted top -> bottom (LT first)
      // Only a DL primary (idx 0-3) maps to a beaten OL. On a BLITZ
      // (primaryIdx >= 4 = LB/DB), no lineman lost a one-on-one rep —
      // the blitzer came free through a gap — so no OL posts up "beaten".
      const _losingOlSlot = _primaryIsBlitzer ? -1   // blitzer: no beaten OL
                          : primaryIdx === 0 ? 0
                          : primaryIdx === 1 ? 1
                          : primaryIdx === 2 ? 3
                          :                    4;
      const _losingOl = _losingOlSlot >= 0 ? (_sackOlList[_losingOlSlot] || null) : null;
      const off = formation.offense.map(p => {
        if (p.role === "QB") {
          // Pose-t per QB state:
          //  - tackled (takedown): fall progresses 0→1 ONCE across the
          //    contact→end window, then holds flat. Was wall-clock
          //    cycling → the QB's fall sprite looped = "flopping like a
          //    seal" through the whole takedown.
          //  - settled scan poses (drop_step / qb_carry / throw / idle):
          //    frozen frame 0 (the cradle/scanning silhouette) — these
          //    are HOLD poses, not loops. qb_carry was missing from the
          //    settled set before, so it also cycled during the scan.
          const _qbTT = (t - PRE) / (1 - PRE);
          let _qbT;
          if (qbPose === "tackled") {
            _qbT = Math.min(1, Math.max(0,
              (_qbTT - contactT) / Math.max(0.001, 1 - contactT)));
          } else if (qbPose === "throw" || qbPose === "drop_step"
                     || qbPose === "idle" || qbPose === "qb_carry") {
            _qbT = 0;
          } else {
            _qbT = (t < 0.95 ? ((performance.now() / 333) + 0.4) % 1 : 0);
          }
          return { ...qb, pose: qbPose, t: _qbT, facing: dir };
        }
        if (p.role === "OL" && t > PRE) {
          const tt = (t - PRE) / (1 - PRE);
          const slotDepth = Math.abs((p.y - cy) / 14);
          // PHASE 2: OL position comes from the pocket-cup engagement —
          // tackles kick back and widen, center holds, the whole cup
          // collapses as the rush wins. The losing OL (whose man beats
          // him) still gets the extra shove + "stiff" lost-it override.
          let _olX, _olY;
          if (p._sackEng && !p._sackEng.shed) {
            _olX = p._sackEng.blockerX;
            _olY = p._sackEng.blockerY;
          } else {
            // No live engagement (never paired, OR the paired DL shed to
            // the pile → engagement.step() early-returns and blockerX/Y
            // freeze). Without the !shed guard the OL locked in place for
            // the rest of the play while everyone converged on the QB.
            // Fall back to the legacy pushed-back drift so the OL keeps
            // giving ground naturally.
            _olX = p.x - dir * (6 + slotDepth * 3) * tt;
            _olY = p.y + Math.sin(tt * Math.PI * 5 + p.y) * 2.5;
          }
          let _olPose = "engage";
          if (p === _losingOl && tt > _sackRushReleaseT) {
            // Win window — bigger push back, slight lean, transitions
            // from engaged to stiff (= out of the play) as winT grows.
            const _winT = Math.min(1, (tt - _sackRushReleaseT) / Math.max(0.001, contactT - _sackRushReleaseT));
            _olX -= dir * _winT * 22;                       // extra ~1.5yd shove back
            _olY += _winT * 4;                              // slight lean
            _olPose = _winT > 0.55 ? "stiff" : "engage";    // posts up, watches the QB go down
          }
          return { ...p, x: _olX, y: _olY, pose: _olPose, facing: dir };
        }
        if ((p.role === "WR1" || p.role === "WR2" || p.role === "TE") && t > PRE) {
          // Receivers run real routes during the scan so the play looks
          // like a developing pass play (not just bodies shuffling 5yd).
          // WR1: streak (vertical 15-18yd). WR2: 10yd out (forward then
          // breaks toward sideline). TE: 6yd dig (forward then crosses
          // toward middle). Routes complete around contactT; after that
          // they're covered/standing.
          const tt = (t - PRE) / (1 - PRE);
          const routeT = Math.min(1, tt / Math.max(0.4, contactT));   // route done by contact
          let dx = 0, dy = 0;
          if (p.role === "WR1") {
            // Streak — fast vertical, slight outside angle.
            dx = routeT * 16 * FIELD.PX_PER_YARD;
            dy = (p.y < cy ? -1 : 1) * routeT * 1.5 * FIELD.PX_PER_YARD;
          } else if (p.role === "WR2") {
            // Out — 8yd vertical, then break toward nearest sideline.
            const stem = Math.min(1, routeT / 0.55);
            const breakT = Math.max(0, routeT - 0.55) / 0.45;
            dx = stem * 8 * FIELD.PX_PER_YARD + breakT * 2 * FIELD.PX_PER_YARD;
            dy = (p.y < cy ? -1 : 1) * breakT * 6 * FIELD.PX_PER_YARD;
          } else {
            // TE dig — 6yd vertical, then cross toward middle.
            const stem = Math.min(1, routeT / 0.60);
            const breakT = Math.max(0, routeT - 0.60) / 0.40;
            dx = stem * 6 * FIELD.PX_PER_YARD + breakT * 2 * FIELD.PX_PER_YARD;
            dy = (p.y < cy ? 1 : -1) * breakT * 5 * FIELD.PX_PER_YARD;
          }
          return { ...p,
                   x: p.x + dir * dx,
                   y: p.y + dy,
                   pose: routeT >= 1 ? "idle" : "run",
                   t: (t < 0.95 ? ((performance.now() / 333) + 0.5) % 1 : 0),
                   facing: dir };
        }
        // RB pass-protects on the sack. Pre-snap RB falls through to
        // the "idle" catch-all (formation home). Post-snap, RB steps
        // UP toward the LOS to engage a blitzer. slideX = +dir =
        // TOWARD defense (was -dir, which moved RB DEEPER into the
        // backfield = away from action).
        if ((p.role === "RB" || p.role === "FB") && t > PRE) {
          const tt = (t - PRE) / (1 - PRE);
          const slideX = dir * Math.min(tt * 30, 20);     // step up ~1.3yd toward LOS
          const slideY = (cy - p.y) * Math.min(tt * 1.3, 0.35);  // drift toward middle
          const rbPose = tt < 0.40 ? "run" : "block";
          return { ...p,
                   x: p.x + slideX, y: p.y + slideY,
                   pose: rbPose,
                   t: rbPose === "run" ? (t < 0.95 ? ((performance.now() / 333) + 0.3) % 1 : 0) : tt,
                   facing: dir };
        }
        return { ...p, pose: "idle", facing: dir };
      });
      _syncDefRendered(def);
      drawPlayers(off, def);
      // Pre-snap: ball at the LOS (between center's legs). Was at
      // qb.x = LOS-90px ≈ 30px in front of RB — user-reported "ball
      // floats in front of RB pre-snap" on audible sacks.
      // STRIP-SACK: after contact the ball follows the bounce/roll
      // trajectory from _stripBallAt instead of staying with the QB.
      let _sackBallX, _sackBallY;
      const _sackBallOpts = {};
      if (t < PRE) {
        _sackBallX = losX - dir * 2; _sackBallY = cy;
      } else if (_stripBall) {
        _sackBallX = _stripBall.x; _sackBallY = _stripBall.y;
        _sackBallOpts.angle = _stripBall.ang;
        _sackBallOpts.skipCarryShift = true;   // ball is on the ground; don't yank to a body
      } else {
        _sackBallX = qb.x; _sackBallY = qb.y;
      }
      // SINGLE BALL — before contact the QB holds the ball in a ball-bearing
      // sprite (drop_step / qb_carry both draw a ball at his chest), so the
      // standalone would double it. Show the standalone only when no sprite
      // is holding it: pre-snap (at the center), a strip-sack (loose ball),
      // or once the QB is DOWN ("tackled" → fall sprite, which has no ball).
      const _sackSpritesOn = (typeof SpriteAtlas !== "undefined" && SpriteAtlas.anyLoaded());
      const _qbHoldsBall = (qbPose === "qb_carry" || qbPose === "drop_step");
      if (!_sackSpritesOn || t < PRE || _stripBall || !_qbHoldsBall) {
        drawBall(ctx, _sackBallX, _sackBallY, 1, _sackBallOpts);
      }
      // Pressure indicator — pulsing red ring around QB once the rush
      // has visually broken through. Was sackT > 0.20 which tipped the
      // user that "this is a sack" before the rusher even released. Now
      // gated on the same rushReleaseT used by the rusher motion.
      const sackT = Math.max(0, (t - PRE) / (1 - PRE));
      if (sackT >= _sackRushReleaseT && sackT < 0.86) {
        const ringAlpha = 0.15 + Math.sin(sackT * Math.PI * 6) * 0.10;
        ctx.strokeStyle = `rgba(214,90,90,${ringAlpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(qb.x, qb.y, 18 + sackT * 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Burst at sack contact
      if (sackT > 0.85) {
        const burstT = (sackT - 0.85) / 0.15;
        ctx.strokeStyle = `rgba(255,200,0,${0.8 - burstT * 0.8})`;
        ctx.lineWidth = 3;
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          const inner = 14 + burstT * 8;
          const outer = 26 + burstT * 12;
          ctx.beginPath();
          ctx.moveTo(qb.x + Math.cos(ang) * inner, qb.y + Math.sin(ang) * inner);
          ctx.lineTo(qb.x + Math.cos(ang) * outer, qb.y + Math.sin(ang) * outer);
          ctx.stroke();
        }
      }
      // STRIP-SACK banner — distinct from a clean sack. Fades in after
      // the ball has clearly popped loose (sackT > contactT + 0.10).
      // The recovery sub-line is held until the pile has visibly
      // settled (sackT > 0.92) so the user discovers who got it from
      // the on-field scrum, not from the banner.
      if (_isStripSack && sackT > contactT + 0.08) {
        const fadeT = Math.min(1, (sackT - contactT - 0.08) / 0.10);
        ctx.save();
        ctx.globalAlpha = fadeT;
        ctx.textAlign = "center";
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 4;
        ctx.fillStyle = "#ffaa30";
        ctx.font = "900 36px monospace";
        ctx.strokeText("STRIP-SACK!", FIELD.W / 2, 70);
        ctx.fillText("STRIP-SACK!", FIELD.W / 2, 70);
        if (sackT > 0.92) {
          const subFade = Math.min(1, (sackT - 0.92) / 0.05);
          ctx.globalAlpha = subFade;
          ctx.font = "900 22px monospace";
          ctx.fillStyle = play.recoveredByDef ? "#ff7070" : "#9be09b";
          const sub = play.recoveredByDef ? "DEFENSE RECOVERS — TURNOVER" : "OFFENSE RECOVERS";
          ctx.strokeText(sub, FIELD.W / 2, 102);
          ctx.fillText(sub, FIELD.W / 2, 102);
        }
        ctx.restore();
      }
      // PRESSURE! callout removed — was firing on every sack, contributed
      // to the per-play text wall. The SACK! result card carries the
      // information after the play resolves.
      drawPreSnapCallouts(ctx, t, dur);
    }};
  }

  if (play.kind === "fumble") {
    // Full fumble sequence — carrier RUNS from LOS, gets HIT at the
    // fumble spot, ball pops loose, then scrum + recovery. Previously
    // the play started with the ball already loose at midfield —
    // missed the entire run-up. User: "fumbles should happen in the
    // middle of a play."
    //   0.00 - CARRY_END:    carrier runs forward like a normal run
    //   CARRY_END - STRIP_END: tackler closes, hit + ball pops loose
    //   STRIP_END - SCRUM_END: ball rolls, players converge, dive
    //   SCRUM_END - 1.0:     recovery confirmed, banners
    const CARRY_END = 0.32;
    const STRIP_END = 0.40;
    const SCRUM_END = 0.88;
    const recoveredBy = play.recoveredBy || "def";
    const fumYards = play.yards || 0;
    const startX   = losX;
    const fumX     = losX + dir * fumYards * FIELD.PX_PER_YARD;
    // Lateral fumble position — tracks where the carrier was running.
    const motionDY = (play.motion && play.motion.carrierEndDY != null)
      ? play.motion.carrierEndDY
      : 28 + (((play.startYard * 17) >>> 0) % 21) - 10;
    const fumY = cy + motionDY;
    const startY = cy + 28;       // RB formation lane
    // Ball rolls forward after the strip — ends up ~3 yards past
    const restX = fumX + dir * 50;
    const restY = fumY + ((((play.startYard * 13) >>> 0) % 21) - 10);
    let _rumbled = false;
    return { duration: 4200, kind: "fumble", render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);

      // RUMBLE at the strip — brief screen shake when ball comes loose
      // so the hit reads as impact (not just "ball appeared on grass").
      // Fired once, edge-triggered. User: "at the hit there should be
      // rumble and then people pile on top of the pile."
      if (!_rumbled && t >= CARRY_END && typeof GCFx !== "undefined") {
        GCFx.shake(6, 240);
        if (typeof GCAudio !== "undefined") {
          GCAudio.play("bigplay");
          GCAudio.crowd.swell(0.18, 900, 1300);
        }
        _rumbled = true;
      }

      // Ball physics — pop loose → roll forward bouncing → settle
      let ballX, ballY, ballScale;
      if (t < CARRY_END) {
        // CARRY PHASE — ball is in the carrier's hands, traveling
        // with him from LOS to the fumble spot.
        const pt = t / CARRY_END;
        const sm = pt * pt * (3 - 2 * pt);
        ballX = startX + (fumX - startX) * sm;
        ballY = startY + (fumY - startY) * sm;
        ballScale = 0.95;
      } else if (t < STRIP_END) {
        // STRIP PHASE — ball POPS loose at the hit. Bigger pop (16px)
        // than the old 10px so the moment reads as impact.
        const pt = (t - CARRY_END) / (STRIP_END - CARRY_END);
        ballX = fumX + dir * pt * 10;
        ballY = fumY - Math.sin(pt * Math.PI) * 16;
        ballScale = 1.0 + Math.sin(pt * Math.PI) * 0.20;
      } else if (t < SCRUM_END - 0.05) {
        // ROLL PHASE — ball rolls forward toward restX with 3 decaying
        // bounces (was sin(pt*PI*5) = 5 bouncelets that read as buzz).
        // 3 bigger bounces feel like a real loose ball: pop-pop-pop-roll.
        const pt = (t - STRIP_END) / (SCRUM_END - 0.05 - STRIP_END);
        const sm = pt * pt * (3 - 2 * pt);
        ballX = fumX + dir * 10 + (restX - fumX - dir * 10) * sm;
        const bounceIdx = Math.floor(pt * 3);
        const localT = pt * 3 - bounceIdx;
        const amp = 12 * Math.pow(0.5, bounceIdx);
        ballY = fumY + (restY - fumY) * sm - Math.sin(localT * Math.PI) * amp;
        ballScale = 0.95 + Math.sin(localT * Math.PI) * 0.06;
      } else {
        // SETTLED — ball at rest, pile forming on top.
        ballX = restX;
        ballY = restY;
        ballScale = 0.85;
      }

      // The on-field formation collapsing on the ball. Defenders sprint at
      // full speed; OL lumber; carrier collapses at the fumble spot.
      const offPlayers = [...formation.offense];
      const defPlayers = [...formation.defense];
      const rusherName = play.rusher;
      const matchesCarrier = (p) =>
        (p.role === "RB" || p.role === "QB") && rusherName;

      // Fumble pile sizing — dialed further down. Was 7 participants
      // sprinting at 180 px/s which still read as a bomb. NFL fumble
      // recovery has 3-5 bodies in the immediate pile.
      const SCRUM_SIZE = 5;
      const SPRINT_PX = 150;            // ≈ 10 yd/s — slower, more deliberate
      const OL_PX     = 85;             // OL lumber
      const JOG_PX    = 50;             // ≈ 3.3 yd/s — far players trot
      const scrumMisses = Math.min(3, play.scrumMisses || 0);
      const allNonCarriers = [...offPlayers, ...defPlayers].filter(p => !(p.role === "RB" || p.role === "QB"));
      allNonCarriers.sort((a, b) =>
        Math.hypot(a.x - fumX, a.y - fumY) - Math.hypot(b.x - fumX, b.y - fumY));
      const scrumParticipants = new Set(allNonCarriers.slice(0, SCRUM_SIZE));
      const missers = new Set(allNonCarriers.slice(0, scrumMisses));
      // FORCER — the defender who knocked the ball loose. Engine emits
      // play.forcedBy as a name. Resolve to formation slot; on hit he
      // arrives AT the carrier at CARRY_END instead of trickling in
      // with the rest of the pile post-strip.
      const forcer = play.forcedBy
        ? defPlayers.find(p => p && p.name === play.forcedBy)
        : null;
      if (forcer) scrumParticipants.add(forcer);
      // RECOVERER — closest scrum participant on the recovering side.
      // Featured pose after SCRUM_END (stands up + celebrates).
      const _recOff = recoveredBy === "off";
      const recoverer = allNonCarriers.find(p => {
        const isOffP = offPlayers.includes(p);
        return scrumParticipants.has(p) && (_recOff ? isOffP : !isOffP);
      }) || null;

      const renderConverging = (players, isOff) => {
        const color = isOff ? possColor : oppColor;
        const sec = isOff ? team.secondary : oppTeam.secondary;
        for (const p of players) {
          const carrier = isOff && matchesCarrier(p);
          let pX, pY, pPose, pT = (t < 0.95 ? ((performance.now() / 333)) % 1 : 0);
          if (carrier) {
            // Carrier path:
            //   CARRY PHASE  — running from formation to fumble spot
            //   STRIP PHASE  — getting hit, body crumples
            //   SCRUM        — on the ground at the fumble spot
            if (t < CARRY_END) {
              const pt = t / CARRY_END;
              const sm = pt * pt * (3 - 2 * pt);
              pX = startX + (fumX - startX) * sm;
              pY = startY + (fumY - startY) * sm;
              pPose = "carry";
            } else if (t < STRIP_END) {
              const pt = (t - CARRY_END) / (STRIP_END - CARRY_END);
              pX = fumX + dir * pt * 4;     // slight further forward as he loses balance
              pY = fumY + pt * 3;
              pPose = "reach";              // arms out as ball comes loose
            } else {
              const collapseT = Math.min(1, (t - STRIP_END) / 0.10);
              pX = fumX + dir * 4;
              pY = fumY + 6;
              pPose = "tackled";
              pT = collapseT;
            }
          } else if (p === forcer) {
            // FORCER — sprints from his formation slot to the carrier
            // and ARRIVES at CARRY_END for the visible hit. Then sticks
            // around briefly (tackled pose) before peeling off to the
            // ball with the rest of the pile.
            const _hitX = fumX - dir * 6;
            const _hitY = fumY;
            if (t < CARRY_END) {
              const sprintT = Math.min(1, t / CARRY_END);
              pX = p.x + (_hitX - p.x) * sprintT;
              pY = p.y + (_hitY - p.y) * sprintT;
              if (sprintT < 0.85) {
                pPose = "run";
              } else {
                pPose = "dive";
                pT = (sprintT - 0.85) / 0.15;
              }
            } else if (t < STRIP_END) {
              // Strip attempt — forcer's arm chopping at the ball just
              // before it pops loose. New: uses dedicated strip_swat
              // sprite (the same one the sack-play forcer uses) so
              // the cause of the fumble visibly reads as a punch-out
              // instead of a generic wrap-up.
              pX = _hitX;
              pY = _hitY;
              pPose = "strip_swat";
              pT = Math.min(1, (t - CARRY_END) / Math.max(0.001, STRIP_END - CARRY_END));
            } else if (t < STRIP_END + 0.06) {
              // Wrap-up at the hit — frozen tackled frame
              pX = _hitX;
              pY = _hitY;
              pPose = "tackled";
              pT = 1;
            } else {
              // Peel off toward the loose ball
              const fromX = _hitX, fromY = _hitY;
              const tConverge = Math.max(0, t - STRIP_END - 0.06);
              const dx = ballX - fromX, dy = ballY - fromY;
              const dist = Math.hypot(dx, dy);
              const maxMove = tConverge * SPRINT_PX;
              const moveFrac = Math.min(1, maxMove / Math.max(1, dist));
              pX = fromX + dx * moveFrac;
              pY = fromY + dy * moveFrac;
              if (Math.hypot(ballX - pX, ballY - pY) < 22) {
                pPose = "tackled";
                pT = 1;
              } else {
                pPose = "run";
              }
            }
          } else if (p === recoverer && t > SCRUM_END + 0.01) {
            // RECOVERER — stands up off the pile holding the ball,
            // celebrates briefly so the result reads visually.
            const celebT = Math.min(1, (t - SCRUM_END - 0.01) / 0.10);
            pX = ballX + dir * 4;
            pY = ballY - 18 * celebT;        // stand up from prone
            pPose = celebT < 0.5 ? "tackled_carry" : "celebrate";  // recoverer has the ball
            pT = celebT < 0.5 ? 1 : (celebT - 0.5) / 0.5;
          } else if (missers.has(p)) {
            // Designated misser — only starts converging AFTER the ball
            // is loose (STRIP_END). Stays in formation pose during the
            // carry. Then sprints and dives in their staggered window.
            const myIdx = [...missers].indexOf(p);
            const diveStart = STRIP_END + 0.05 + myIdx * 0.10;
            const diveEnd   = diveStart + 0.18;
            const isOL = p.role === "OL";
            const speed = isOL ? OL_PX : SPRINT_PX;
            const tConverge = Math.max(0, t - STRIP_END);
            const dx = ballX - p.x, dy = ballY - p.y;
            const dist = Math.hypot(dx, dy);
            const maxMove = Math.min(tConverge, diveStart - STRIP_END) * speed;
            const moveFrac = Math.min(1, maxMove / Math.max(1, dist));
            pX = p.x + dx * moveFrac;
            pY = p.y + dy * moveFrac;
            if (t < STRIP_END) {
              pPose = "engage";   // still in their assignment
              pT = 0;             // freeze engage frame — no shuffle
            } else if (t >= diveStart && t < diveEnd) {
              pPose = "dive";
              pT = (t - diveStart) / 0.18;
            } else if (t >= diveEnd) {
              pPose = "tackled";
              pT = 1;            // LOCK — no wall-clock somersault
            } else {
              pPose = "run";
            }
          } else if (scrumParticipants.has(p)) {
            // Pile participants — staggered arrival in waves so the
            // pile builds up instead of all 5 hitting at once (which
            // read as a bomb). Wave 1: closest player arrives quickly;
            // Wave 2: ~150ms later; Wave 3: ~300ms later.
            const myIdx = [...scrumParticipants].indexOf(p);
            const waveDelay = myIdx * 0.04;     // ~150ms per wave at 4200ms total
            const isOL = p.role === "OL";
            const speed = isOL ? OL_PX : SPRINT_PX;
            const tConverge = Math.max(0, t - STRIP_END - waveDelay);
            const dx = ballX - p.x, dy = ballY - p.y;
            const dist = Math.hypot(dx, dy);
            const maxMove = tConverge * speed;
            const moveFrac = Math.min(1, maxMove / Math.max(1, dist));
            pX = p.x + dx * moveFrac;
            pY = p.y + dy * moveFrac;
            if (t < STRIP_END + waveDelay) {
              pPose = "engage";
              pT = 0;       // freeze engage frame — no shuffle
            } else {
              const newDist = Math.hypot(ballX - pX, ballY - pY);
              if (newDist < 28) {
                pPose = "tackled";
                pT = 1;     // LOCK the pose — was cycling via wall-clock,
                            // creating the "somersaulting in place" bug
              } else {
                pPose = "run";
              }
            }
          } else {
            // Out-of-position — assignment during carry, then jog after.
            const tConverge = Math.max(0, t - STRIP_END);
            const dx = ballX - p.x, dy = ballY - p.y;
            const dist = Math.hypot(dx, dy);
            const maxMove = tConverge * JOG_PX;
            const moveFrac = Math.min(0.6, maxMove / Math.max(1, dist));
            pX = p.x + dx * moveFrac;
            pY = p.y + dy * moveFrac;
            if (t < STRIP_END) {
              pPose = "engage";
              pT = 0;       // freeze engage frame
            } else {
              pPose = "run";
            }
          }
          drawPlayer(ctx, pX, pY, color, sec, p.label || "", pPose, pT, isOff ? dir : -dir, p);
        }
      };
      renderConverging(offPlayers, true);
      renderConverging(defPlayers, false);

      // LOOSE-BALL HALO — pulsing amber ring around the ball during the
      // strip + roll window so the viewer can track it through the pile.
      // Draws BEFORE the ball so the sprite sits on top of the halo.
      if (t > CARRY_END && t < 0.78) {
        const pulse = 0.6 + Math.sin(performance.now() / 110) * 0.4;
        const radius = 24 + pulse * 4;
        const halo = ctx.createRadialGradient(ballX, ballY, 0, ballX, ballY, radius);
        halo.addColorStop(0,    `rgba(255,200,80,${0.55 * pulse})`);
        halo.addColorStop(0.45, `rgba(255,170,40,${0.28 * pulse})`);
        halo.addColorStop(1,    "rgba(255,170,40,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(ballX, ballY, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      // Ball drawn on top of everyone EXCEPT after the pile has formed (then
      // it's buried under the dogpile)
      if (t < 0.78) drawBall(ctx, ballX, ballY, ballScale);

      // SPOT MARKERS — chalk on the field at the catch yard line (if this
      // was a fumble-after-catch) and at the fumble spot. Helps the
      // viewer track the progression: caught HERE → ran → fumbled THERE.
      // Driven by play.catchYL + play.fumbleSpotYL (previously unused).
      if (play.catchYL != null || play.fumbleSpotYL != null) {
        ctx.save();
        const drawSpot = (yl, label, color) => {
          if (yl == null) return;
          const sx = yardToAbsX(yl, poss);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(sx, cy - 10);
          ctx.lineTo(sx, cy + 10);
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(sx, cy - 14, 3.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = "bold 11px monospace";
          ctx.textAlign = "center";
          ctx.fillText(label, sx, cy - 19);
        };
        drawSpot(play.catchYL, "CATCH", "rgba(110,210,255,0.85)");
        drawSpot(play.fumbleSpotYL ?? (play.yards != null ? null : null), "FUMBLE", "rgba(255,170,80,0.95)");
        ctx.restore();
      }

      // "FUMBLE!" callout — fires AT THE STRIP MOMENT now, not at t=0.
      // User sees the carrier running, getting hit, THEN the banner.
      if (t > CARRY_END && t < CARRY_END + 0.20) {
        const localT = (t - CARRY_END) / 0.20;
        const fadeIn = Math.min(1, localT * 4);
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "900 38px monospace";
        ctx.fillStyle = `rgba(214,90,90,${fadeIn})`;
        ctx.strokeStyle = `rgba(0,0,0,${fadeIn * 0.85})`;
        ctx.lineWidth = 4;
        ctx.strokeText("FUMBLE!", FIELD.W / 2, 60);
        ctx.fillText("FUMBLE!", FIELD.W / 2, 60);
        ctx.restore();
      }
      // "LOOSE BALL!" during the scrum
      if (t > 0.32 && t < 0.75) {
        const pulse = 0.5 + Math.sin(t * Math.PI * 8) * 0.5;
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "900 22px monospace";
        ctx.fillStyle = `rgba(255,200,80,${0.6 + pulse * 0.4})`;
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.lineWidth = 3;
        ctx.strokeText("LOOSE BALL — DIVE!", FIELD.W / 2, 60);
        ctx.fillText("LOOSE BALL — DIVE!", FIELD.W / 2, 60);
        ctx.restore();
      }
      // Recovery callout — held until the pile has visibly settled
      // (was t > 0.82, before SCRUM_END = 0.88). Telling the user who
      // got the ball before the scrum resolves is an outcome leak.
      if (t > SCRUM_END) {
        const fadeT = Math.min(1, (t - SCRUM_END) / 0.05);
        const isRecOff = recoveredBy === "off";
        const lbl = isRecOff
          ? `${(poss === "home" ? homeTeam : awayTeam).name.toUpperCase()} RECOVERS!`
          : `${(poss === "home" ? awayTeam : homeTeam).name.toUpperCase()} RECOVERS!`;
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "900 26px sans-serif";
        ctx.fillStyle = isRecOff ? `rgba(155,224,155,${fadeT})` : `rgba(240,204,48,${fadeT})`;
        ctx.strokeStyle = `rgba(0,0,0,${fadeT * 0.85})`;
        ctx.lineWidth = 4;
        ctx.strokeText(lbl, FIELD.W / 2, 60);
        ctx.fillText(lbl, FIELD.W / 2, 60);
        ctx.restore();
      }
      // CONTEXT CARD — what play, who fumbled, who forced it, who
      // recovered. Held until SCRUM_END so the card never names the
      // outcome before the user has seen it resolve on-field. Was
      // appearing at t > 0.18 — about 200ms into the play, before the
      // carrier had even taken the handoff, fully revealing who would
      // fumble, who would force it, and who would recover.
      if (t > SCRUM_END && t < 0.99) {
        const fadeT = Math.min(1, (t - SCRUM_END) / 0.04) * Math.min(1, (0.99 - t) / 0.03);
        const lastName = (n) => String(n || "").split(/\s+/).pop().toUpperCase();
        const carrier = lastName(play.rusher);
        const forcer  = lastName(play.forcedBy);
        const yardTag = `${play.yards >= 0 ? "+" : ""}${play.yards || 0}YD`;
        const downTag = play.down ? `${play.down}${play.down===1?"ST":play.down===2?"ND":play.down===3?"RD":"TH"}` : "";
        const ytgTag  = (play.ytg != null) ? ` & ${play.ytg}` : "";
        // 3-line card: SITUATION / ACTION / SPOT
        const line1 = downTag ? `${downTag}${ytgTag}` : "FUMBLE";
        const line2 = forcer
          ? `${carrier} stripped by ${forcer} on a ${yardTag} carry`
          : `${carrier} loses the ball on a ${yardTag} carry`;
        const line3 = (recoveredBy === "off")
          ? "Offense recovers — drive continues"
          : "DEFENSE RECOVERS — turnover";
        ctx.save();
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const cardX = 24, cardY = FIELD.H - 96;
        const cardW = 380, cardH = 76;
        ctx.fillStyle = `rgba(0,0,0,${fadeT * 0.72})`;
        ctx.fillRect(cardX, cardY, cardW, cardH);
        ctx.strokeStyle = `rgba(255,170,80,${fadeT * 0.95})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(cardX, cardY, cardW, cardH);
        ctx.font = "bold 11px monospace";
        ctx.fillStyle = `rgba(255,170,80,${fadeT})`;
        ctx.fillText(line1, cardX + 12, cardY + 10);
        ctx.font = "bold 13px sans-serif";
        ctx.fillStyle = `rgba(255,255,255,${fadeT})`;
        ctx.fillText(line2, cardX + 12, cardY + 30);
        ctx.font = "bold 13px sans-serif";
        ctx.fillStyle = (recoveredBy === "off")
          ? `rgba(155,224,155,${fadeT})`
          : `rgba(255,150,80,${fadeT})`;
        ctx.fillText(line3, cardX + 12, cardY + 52);
        ctx.restore();
      }
    }};
  }

  if (play.kind === "fg_good" || play.kind === "fg_miss" || play.kind === "fg_blocked") {
    const isGood = play.kind === "fg_good";
    const isBlocked = play.kind === "fg_blocked";
    const isReturned = !!play.isReturned;
    const isReturnTD = !!play.isReturnTD;
    // PATH B Phase 10 — engine emits missType when known
    const _engineMissType = play.motion && play.motion.missType;
    const missRoll = ((play.startYard * 17 + (play.time || 0)) >>> 0) % 100 / 100;
    const missType = isGood ? "good"
                   : _engineMissType ? _engineMissType
                   : (missRoll < 0.5 ? (missRoll < 0.25 ? "wide_l" : "wide_r") : "short");
    const HASH_HALF = 40;
    const goalX = poss === "home" ? FIELD.W - FIELD.EZ_PX * 0.4 : FIELD.EZ_PX * 0.4;
    // Special-teams positions
    const holderX = losX - dir * 7 * FIELD.PX_PER_YARD;
    const holderY = cy;
    const kickerX = holderX - dir * 18;     // slightly behind & to the side of the holder
    const kickerY = cy + 12;
    // Block deflection point (just past the LOS)
    const blockX = losX + dir * 8;
    const blockY = cy + (((play.startYard * 7) >>> 0) % 11) - 5;
    const recoverX = isBlocked
      ? losX - dir * (8 + ((play.startYard * 11) >>> 0) % 14)
      : losX - dir * 4;
    const returnEndX = isReturnTD
      ? (poss === "home" ? FIELD.EZ_PX * 0.5 : FIELD.W - FIELD.EZ_PX * 0.5)
      : holderX - dir * 6;
    // Unified ST timing. FG: ball flies to uprights, optional return.
    const _fgDist = play.fgDist || 35;
    const _fgRunYds = isReturned ? (play.endYard || 30) : 0;
    const dur = _stPlayDuration({
      ballYds:   _fgDist,
      runYds:    _fgRunYds,
      presnapMs: 1800,   // snap + holder + kicker plant
      payoffMs:  isReturnTD ? 1800 : (isBlocked || isReturned) ? 1200 : 800,
    });
    return { duration: dur, kind: play.kind, render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);
      // In broadcast cam, the stadium Y-shaped uprights are already drawn
      // on the field overlay — skip the flat top-down H to avoid the
      // "original goalposts" doubled with the stadium pair.
      if (typeof cameraMode === "undefined" || cameraMode !== "broadcast") {
        drawGoalposts(ctx, goalX, cy);
      }

      // ── Special-teams formation (drawn instead of regular formation) ──
      // 9-man protection along the LOS, holder kneeling, kicker offset.
      // On a GOOD kick, once the ball has cleared (t > 0.82, when the
      // IT'S GOOD! banner fires), the kicking team breaks into a
      // celebration — arms up, bouncing — so a make reads as a make.
      const _kickCheer = isGood && t > 0.82;
      const olY = [-50, -36, -22, -8, 6, 20, 34, 48, 62];
      for (let i = 0; i < 9; i++) {
        const olXOff = (i === 0 || i === 8) ? -dir * 4 : 0;   // wings slightly back
        // Per-OL name so _locoState gives each its own velocity cache.
        // Without it, all 9 OL share "OL||R" as the id, overwrite each
        // other's lastX/lastY, and oscillate vxEMA → sprite direction
        // flickers between octants per frame = visible stutter.
        // Stagger the celebration t per lineman so they don't bounce in
        // lockstep (each OL's name-hash phases the wave).
        const _olHash = ((i * 37 + 13) % 100) / 100;
        drawPlayer(ctx, losX - dir * 1 + olXOff, cy + olY[i], possColor, team.secondary, "",
          _kickCheer ? "celebrate" : "stance", _kickCheer ? t + _olHash : t, dir,
          { role: "OL", bodyType: "BIG", name: "fg-ol-" + i });
      }
      // Defense — 11-man FG defense: 4 interior DL, 4 edge rushers/LBs,
      // 2 wing CBs sealing the outside, 1 deep safety for return / spy.
      // All rushers surge toward the kicker over the first 18% of the
      // play. Pre-fix, only 4 DL were rendered — the rest of the
      // opposing team was missing from the screen.
      const defLineY = [-30, -10, 10, 30];
      for (let i = 0; i < 4; i++) {
        const surgeT = Math.min(1, t / 0.18);
        const dxRush = -dir * 30 * surgeT;
        drawPlayer(ctx, losX + dir * 2 + dxRush, cy + defLineY[i], oppColor, oppTeam.secondary, "", t < 0.20 ? "stance" : "run", t, -dir, { role: "DL", name: "fg-dl-" + i });
      }
      // Edge rushers + OLBs — angled in from a bit wider, also crashing.
      const edgeY = [-55, -42, 42, 55];
      for (let i = 0; i < 4; i++) {
        const surgeT = Math.min(1, t / 0.18);
        const dxRush = -dir * 26 * surgeT;
        drawPlayer(ctx, losX + dir * 1 + dxRush, cy + edgeY[i], oppColor, oppTeam.secondary, "", t < 0.20 ? "stance" : "run", t, -dir, { role: "LB", name: "fg-lb-" + i });
      }
      // Wing CBs — outside the wing OL, holding their leverage.
      drawPlayer(ctx, losX + dir * 2, cy - 92, oppColor, oppTeam.secondary, "", "stance", t, -dir, { role: "CB", name: "fg-cb-0" });
      drawPlayer(ctx, losX + dir * 2, cy +  92, oppColor, oppTeam.secondary, "", "stance", t, -dir, { role: "CB", name: "fg-cb-1" });
      // Deep safety — sits ~8yd off the LOS as the return / fake spy.
      drawPlayer(ctx, losX + dir * 8 * FIELD.PX_PER_YARD, cy, oppColor, oppTeam.secondary, "", "stance", t, -dir, { role: "S", name: "fg-fs" });

      // Ball + kicker animation
      let ballX, ballY, arc = 0, ballScale = 1, ballHidden = false;
      const showBlocker = isBlocked && t > 0.22 && t < 0.36;

      // Kicker pose progression: stance → approach → kick → follow
      let kickerPoseX = kickerX, kickerPoseY = kickerY, kickerPose = "stance";
      if (t < 0.10) { kickerPose = "stance"; }
      else if (t < 0.22) {
        // Run-up — approach the ball from behind
        const ap = (t - 0.10) / 0.12;
        kickerPoseX = kickerX + (holderX - kickerX) * ap * 0.85;
        kickerPoseY = kickerY + (holderY - kickerY) * ap * 0.85;
        kickerPose = "run";
      } else {
        kickerPoseX = holderX - dir * 4;
        kickerPoseY = holderY + 4;
        kickerPose = "kick";
      }
      // Kicker celebrates his own make once the ball clears.
      if (_kickCheer) kickerPose = "celebrate";
      drawPlayer(ctx, kickerPoseX, kickerPoseY, possColor, team.secondary, "", kickerPose, t, dir, { role: "K", celebStyle: "fist_pump" });

      // Holder kneeling at the spot (drawn behind ball during placement)
      if (t < 0.85) {
        drawPlayer(ctx, holderX + dir * 2, holderY + 6, possColor, team.secondary, "", "stance", t, -dir, { role: "RB" });
      }

      // Ball: snap → placed → kick → flight → result
      if (t < 0.06) {
        // Snap travels back to holder
        const sp = t / 0.06;
        ballX = losX + (holderX - losX) * sp;
        ballY = cy;
      } else if (t < 0.22) {
        // Ball held at the spot
        ballX = holderX; ballY = holderY;
      } else if (isBlocked && t < 0.36) {
        // Ball gets a few yards then deflects backward off a blocker
        const bp = (t - 0.22) / 0.14;
        if (bp < 0.5) {
          // Forward into the block
          ballX = holderX + (blockX - holderX) * (bp / 0.5);
          ballY = holderY;
          arc = Math.sin((bp / 0.5) * Math.PI * 0.6) * 25;
        } else {
          // Wobble back toward recovery spot
          const wp = (bp - 0.5) / 0.5;
          ballX = blockX + (recoverX - blockX) * wp;
          ballY = blockY + (Math.sin(wp * Math.PI * 3) * 6);
          arc = Math.max(0, 25 - wp * 25) + Math.abs(Math.sin(wp * Math.PI * 4)) * 8;
        }
        ballScale = 0.9;
      } else if (!isBlocked && t >= 0.22 && (!isReturned || t < 0.78)) {
        // Normal kick flight — extends to ~0.95 (was 0.78) so the ball
        // stays visible while the IT'S GOOD! banner appears at 0.82.
        // For good kicks the trajectory continues PAST the uprights into
        // the netting; previously the branch closed at 0.78 leaving
        // ballX/ballY undefined → invisible "stopped at the posts" ball.
        const FLIGHT_END_T = 0.95;
        const kt = Math.min(1, (t - 0.22) / (FLIGHT_END_T - 0.22));
        if (missType === "short") {
          const reach = 0.78;
          ballX = holderX + (goalX - holderX) * kt * reach;
          ballY = holderY;
          arc = Math.sin(kt * Math.PI) * 50;
        } else if (missType === "good") {
          // Ball clears the crossbar and sails ALL THE WAY THROUGH the
          // uprights into the netting behind the goal. The posts were
          // moved back to the end line: in broadcast cam the stadium
          // goalposts stand at FIELD.W+8 (home) / -8 (away) per
          // drawStadiumGoalposts — NOT at goalX (which is only ~40% into
          // the end zone). Targeting goalX left the ball stopping short
          // of the visible posts. Aim at the real post X (camera-aware),
          // plus a margin so it passes between and beyond them. Tactical
          // cam still draws the flat H at goalX, so target that there.
          const _isBroadcast = (typeof cameraMode !== "undefined" && cameraMode === "broadcast");
          const _postX = _isBroadcast ? (poss === "home" ? FIELD.W + 8 : -8) : goalX;
          const endXForGood = _postX + dir * 30;   // sail past the posts into the net
          ballX = holderX + (endXForGood - holderX) * kt;
          ballY = cy;
          // Asymmetric arc: peak at kt=0.55, still 50px elevated at kt=1
          // so the ball is well over the crossbar throughout the cross.
          arc = kt < 0.55
              ? Math.sin(kt / 0.55 * Math.PI / 2) * 120
              : 120 - (kt - 0.55) / 0.45 * (120 - 50);
        } else {
          // wide_l / wide_r — lands on the ground beside the uprights.
          let goalY = cy;
          if (missType === "wide_l") goalY = cy - HASH_HALF - 8;
          else if (missType === "wide_r") goalY = cy + HASH_HALF + 8;
          ballX = holderX + (goalX - holderX) * kt;
          ballY = holderY + (goalY - holderY) * kt;
          arc = Math.sin(kt * Math.PI) * 90;
        }
      } else if (isBlocked && t < 1.0) {
        // Defender picks up ball and returns
        const rt = (t - 0.36) / 0.64;
        ballX = recoverX + (returnEndX - recoverX) * rt;
        ballY = blockY;
        arc = 0;
        // Returning defender (drawn at the ball)
        drawPlayer(ctx, ballX, ballY, oppColor, oppTeam.secondary, "", "carry", t, -dir, { role: "DL" });
        ballHidden = true;  // ball is in the carrier's hands
      } else if (isReturned && t > 0.78) {
        // Returner picks it up after a short miss & returns
        const rt = (t - 0.78) / 0.22;
        ballX = (poss === "home" ? FIELD.W - 90 : 90);
        ballX = ballX + (returnEndX - ballX) * rt;
        ballY = cy + 18 - rt * 20;
        drawPlayer(ctx, ballX, ballY, oppColor, oppTeam.secondary, "", "carry", t, -dir, { role: "S" });
        ballHidden = true;
      }

      if (!ballHidden) drawBall(ctx, ballX, ballY - arc, ballScale + (arc / 250));

      // ── Callouts ──
      if (t > 0.82 && !isBlocked && !isReturned) {
        const banT = Math.min(1, (t - 0.82) / 0.14);
        ctx.save();
        ctx.globalAlpha = banT;
        ctx.fillStyle = isGood ? "#f0cc30" : "#e07070";
        ctx.font = "900 44px monospace";
        ctx.textAlign = "center";
        ctx.fillText(isGood ? "IT'S GOOD!" : missType === "short" ? "SHORT!" : missType === "wide_l" ? "WIDE LEFT!" : "WIDE RIGHT!", FIELD.W / 2, 60);
        ctx.restore();
      }
      if (isBlocked && t > 0.22 && t < 0.50) {
        const fadeT = Math.min(1, (t - 0.22) / 0.06);
        ctx.save();
        ctx.globalAlpha = fadeT;
        ctx.fillStyle = "#e07070";
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 4;
        ctx.font = "900 46px monospace";
        ctx.textAlign = "center";
        ctx.strokeText("BLOCKED!", FIELD.W / 2, 60);
        ctx.fillText("BLOCKED!", FIELD.W / 2, 60);
        ctx.restore();
      }
      // TOUCHDOWN! on blocked-FG return — held until t > 0.95 so the
      // recoverer is visibly in the endzone (was 0.85).
      if ((isBlocked || isReturned) && isReturnTD && t > 0.95) {
        const fadeT = Math.min(1, (t - 0.95) / 0.04);
        ctx.save();
        ctx.globalAlpha = fadeT;
        ctx.fillStyle = "#f0cc30";
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 4;
        ctx.font = "900 40px monospace";
        ctx.textAlign = "center";
        ctx.strokeText("TOUCHDOWN!", FIELD.W / 2, 60);
        ctx.fillText("TOUCHDOWN!", FIELD.W / 2, 60);
        ctx.restore();
      }
    }};
  }

  if (play.kind === "punt" && play.isBlocked) {
    // BLOCKED PUNT — distinct sequence from a normal punt. Rusher
    // breaks through, ball is deflected just past the punter's foot,
    // wobbles backward toward a recovery spot. If isReturnTD, the
    // recoverer runs it back; otherwise the defense gets the ball
    // at the spot.
    const isReturnTD = !!play.isReturnTD;
    const recoverX = losX - dir * (4 + ((play.startYard * 11) >>> 0) % 6);
    const recoverY = cy + (((play.startYard * 7) >>> 0) % 11) - 5;
    const tdEndX = poss === "home" ? FIELD.EZ_PX * 0.5 : FIELD.W - FIELD.EZ_PX * 0.5;
    // Block point — just past the punter's foot (where the rusher
    // gets a hand on the ball).
    const blockX = losX - dir * 10 * FIELD.PX_PER_YARD;
    const blockY = recoverY;
    const dur = isReturnTD ? 2800 : 1900;
    return { duration: dur, kind: "punt", render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);
      const startX = losX - dir * 12 * FIELD.PX_PER_YARD;   // punter's spot
      let ballX, ballY, arc = 0, ballHidden = false, ballScale = 1;
      const T_SNAP = 0.06;
      const T_WIND_END = 0.22;
      const T_BLOCK = 0.32;
      const T_RECOVER = 0.55;
      if (t < T_SNAP) {
        ballX = losX + (startX - losX) * (t / T_SNAP);
        ballY = cy;
      } else if (t < T_WIND_END) {
        ballX = startX; ballY = cy;
      } else if (t < T_BLOCK) {
        const bp = (t - T_WIND_END) / (T_BLOCK - T_WIND_END);
        ballX = startX + (blockX - startX) * bp;
        ballY = cy;
        arc = Math.sin(bp * Math.PI * 0.6) * 18;
        ballScale = 0.95;
      } else if (t < T_RECOVER) {
        const wp = (t - T_BLOCK) / (T_RECOVER - T_BLOCK);
        ballX = blockX + (recoverX - blockX) * wp;
        ballY = blockY + Math.sin(wp * Math.PI * 3) * 6;
        arc = Math.max(0, 14 - wp * 14) + Math.abs(Math.sin(wp * Math.PI * 4)) * 6;
        ballScale = 0.9;
      } else {
        if (isReturnTD) {
          const rt = (t - T_RECOVER) / (1 - T_RECOVER);
          ballX = recoverX + (tdEndX - recoverX) * rt;
          ballY = recoverY;
          drawPlayer(ctx, ballX, ballY, oppColor, oppTeam.secondary, "",
                     rt > 0.92 ? "celebrate" : "carry",
                     (t < 0.95 ? ((performance.now() / 333)) % 1 : 0),
                     -dir, { name: "punt-blk-recoverer" });
          ballHidden = true;
        } else {
          ballX = recoverX; ballY = recoverY;
          drawPlayer(ctx, recoverX, recoverY, oppColor, oppTeam.secondary, "",
                     "stance", 0, -dir, { name: "punt-blk-recoverer" });
        }
      }
      // Punter — kick pose during strike, knocked-off-balance after.
      let punterPose, punterT;
      if (t < T_WIND_END)        { punterPose = "idle";  punterT = 0; }
      else if (t < T_BLOCK)      { punterPose = "kick";  punterT = (t - T_WIND_END) / (T_BLOCK - T_WIND_END); }
      else                       { punterPose = "stiff"; punterT = 0; }
      drawPlayer(ctx, startX, cy, possColor, team.secondary, "", punterPose, punterT, dir, { name: "punter" });
      // Rusher — sprints from LOS toward the punter, dives at the
      // block point.
      const rusherStartX = losX + dir * 1;
      const rusherY = cy + (((play.startYard * 13) >>> 0) % 9) - 4;
      let rusherX, rusherPose, rusherT;
      if (t < T_WIND_END) {
        rusherX = rusherStartX;
        rusherPose = "stance"; rusherT = 0;
      } else if (t < T_BLOCK) {
        const sp = (t - T_WIND_END) / (T_BLOCK - T_WIND_END);
        rusherX = rusherStartX + (blockX - rusherStartX) * sp;
        rusherPose = sp > 0.7 ? "dive" : "run";
        rusherT = sp > 0.7 ? (sp - 0.7) / 0.3 : (t < 0.95 ? ((performance.now() / 333)) % 1 : 0);
      } else if (t < T_RECOVER) {
        rusherX = blockX + dir * 4;
        rusherPose = "tackled";
        rusherT = Math.min(1, (t - T_BLOCK) / 0.10);
      } else {
        const rt = (t - T_RECOVER) / (1 - T_RECOVER);
        rusherX = blockX + (recoverX - blockX) * Math.min(1, rt * 1.5);
        rusherPose = "run";
        rusherT = (t < 0.95 ? ((performance.now() / 333)) % 1 : 0);
      }
      if (t < T_RECOVER) {
        drawPlayer(ctx, rusherX, rusherY, oppColor, oppTeam.secondary, "", rusherPose, rusherT, -dir, { name: "punt-rusher" });
      }
      if (!ballHidden) drawBall(ctx, ballX, ballY - arc, ballScale + (arc / 200));
      // "BLOCKED!" banner during the deflection window
      if (t > T_WIND_END && t < T_RECOVER + 0.10) {
        const fadeT = Math.min(1, Math.min((t - T_WIND_END) / 0.05, (T_RECOVER + 0.10 - t) / 0.15));
        ctx.save();
        ctx.globalAlpha = fadeT;
        ctx.fillStyle = "#e07070";
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 4;
        ctx.font = "900 46px monospace";
        ctx.textAlign = "center";
        ctx.strokeText("BLOCKED!", FIELD.W / 2, 60);
        ctx.fillText("BLOCKED!", FIELD.W / 2, 60);
        ctx.restore();
      }
      // RETURN TD! held until t > 0.95 so the returner has reached the
      // endzone before the banner fires (was 0.85 — on long 95yd
      // returns the returner was still ~14yd short of the goal line).
      if (isReturnTD && t > 0.95) {
        const fadeT = Math.min(1, (t - 0.95) / 0.04);
        ctx.save();
        ctx.globalAlpha = fadeT;
        ctx.fillStyle = "#f0cc30";
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 4;
        ctx.font = "900 44px monospace";
        ctx.textAlign = "center";
        ctx.strokeText("RETURN TD!", FIELD.W / 2, 110);
        ctx.fillText("RETURN TD!", FIELD.W / 2, 110);
        ctx.restore();
      }
    }};
  }

  if (play.kind === "punt") {
    const landYardAbs = play.landYard ?? play.endYard ?? play.startYard;
    const landX = yardToAbsX(landYardAbs, poss);
    const endX  = yardToAbsX(play.endYard ?? landYardAbs, poss);
    const returnerY = cy + (((play.startYard * 23 + (play.time || 0)) >>> 0) % 80) - 40;
    const returnYards = play.returnYards || 0;
    const isTouchback = !!play.isTouchback;
    const isFairCatch = !!play.isFairCatch;
    const isReturnTD  = !!play.isReturnTD;
    // Unified ST timing: punt distance + return + presnap setup.
    // TB/FC plays skip the return phase (runYds = 0) but still need
    // the ball-flight + post-catch hold.
    const _puntBallYds = play.puntYards || 45;
    // No Math.min cap here — long returns (80-95 yds) need proportional
    // time, otherwise the visual carrier covers 95 yds in only 70 yds
    // worth of time and visibly "teleports" toward the goal.
    const _puntRunYds  = (isTouchback || isFairCatch) ? 0 : returnYards;
    const _puntTiming = _stPlayTiming({
      ballYds:   _puntBallYds,
      runYds:    _puntRunYds,
      presnapMs: 1400,
      payoffMs:  isReturnTD ? 1200 : 800,
    });
    const dur = _puntTiming.duration;
    // Phase boundaries derived from the timing components — air time
    // automatically scales with punt distance; return time with the
    // actual return yardage.
    const PH_WIND_END  = _puntTiming.presnapT;
    const PH_AIR_END   = _puntTiming.flightT;
    const PH_FIELD_END = _puntTiming.flightT + 0.03;
    const RET_LEN      = 1 - PH_FIELD_END;
    return { duration: dur, kind: "punt", render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);
      const startX = losX - dir * 12 * FIELD.PX_PER_YARD;
      let ballX, ballY, arc = 0;
      let phase = "snap";
      if (t < 0.08) { ballX = losX; ballY = cy; phase = "snap"; }
      else if (t < PH_WIND_END) { ballX = losX + (startX - losX) * ((t - 0.08) / (PH_WIND_END - 0.08)); ballY = cy; phase = "wind"; }
      else if (t < PH_AIR_END) {
        const tt = (t - PH_WIND_END) / (PH_AIR_END - PH_WIND_END);
        ballX = startX + (landX - startX) * tt;
        arc = Math.sin(tt * Math.PI) * 170;
        ballY = cy - arc + (returnerY - cy) * tt;
        phase = "air";
      } else if (t < PH_FIELD_END) {
        ballX = landX; ballY = returnerY; phase = "field";
      } else {
        const tt = (t - PH_FIELD_END) / RET_LEN;
        if (isTouchback || isFairCatch) {
          ballX = landX; ballY = returnerY;
        } else {
          // Linear-with-mild-easeIn motion — no more easeOutCubic teleport.
          // First 15% accelerates from catch, then steady run to endX.
          const eased = tt < 0.15
                      ? (tt * tt) / 0.30
                      : 0.075 + ((tt - 0.15) / 0.85) * 0.925;
          ballX = landX + (endX - landX) * eased;
          ballY = returnerY + Math.sin(tt * 6) * 5;
        }
        phase = "return";
      }
      // Punter — actually punts the ball. Was rendered as "idle" while
      // the football magically flew away. Now uses the "kick" pose with
      // t advancing through the windup/strike during the snap+wind phase
      // and following through during early air phase.
      //   0    - 0.08: idle (receiving the snap)
      //   0.08 - 0.18: kick pose, kickT 0 → 0.5 (windup + plant + strike)
      //   0.18 - 0.30: kick pose, kickT 0.5 → 1.0 (follow-through)
      //   0.30+      : stiff (watching the ball)
      let punterPose, punterT;
      if (t < 0.08)        { punterPose = "idle";  punterT = 0; }
      else if (t < 0.18)   { punterPose = "kick";  punterT = (t - 0.08) / 0.10 * 0.5; }
      else if (t < 0.30)   { punterPose = "kick";  punterT = 0.5 + (t - 0.18) / 0.12 * 0.5; }
      else                 { punterPose = "stiff"; punterT = 0; }
      drawPlayer(ctx, startX, cy, possColor, team.secondary, "", punterPose, punterT, dir, { name: "punter" });
      // ── 4 COVERAGE PLAYERS — 3 get engaged by blockers, 1 stays free for the tackle ──
      const laneYs = [returnerY - 38, returnerY - 14, returnerY + 14, returnerY + 38];
      const chaserPositions = [];
      for (let i = 0; i < 4; i++) {
        const isOutside = (i === 0 || i === 3);
        const chaserStartX = losX + dir * (isOutside ? 14 : 2);
        const sprintT = Math.min(1, t * (isOutside ? 1.7 : 1.3));
        let cx_ = chaserStartX + (landX - chaserStartX) * sprintT;
        let cy_ = laneYs[i] + (returnerY - laneYs[i]) * Math.min(1, t * 1.0) * 0.65;
        const isFree = (i === 3);  // outside gunner is the free pursuer / eventual tackler
        if (phase === "return") {
          const tt = (t - PH_FIELD_END) / RET_LEN;
          if (isFree) {
            // Free pursuer takes a closing angle on the returner — arrives near the end
            cx_ = landX + (ballX - landX) * (0.35 + tt * 0.65);
            cy_ = laneYs[i] + (ballY - laneYs[i]) * Math.min(1, tt * 1.3);
          } else {
            // Engaged chaser — locked up by blocker. Stays AHEAD of the returner in
            // his running direction (-dir), creating the visible wedge.
            const aheadOffset = -dir * (24 - i * 4);
            cx_ = ballX + aheadOffset + Math.sin(tt * 5 + i) * 2;
            cy_ = laneYs[i] * 0.4 + returnerY * 0.6;
          }
        }
        chaserPositions.push({ x: cx_, y: cy_, isFree });
        const isEngaged = phase === "return" && !isFree;
        const pose = isEngaged ? "engage" : "run";
        // Geometry during return: returner runs -dir; engaged chasers are
        // AHEAD of him (-dir side), blockers wedged between them (-dir of
        // returner, +dir of chaser). So engaged chaser faces blocker
        // (+dir of chaser → +dir). Free pursuer closes from landX (+dir
        // of returner) toward returner running -dir → faces -dir.
        // Pre-return: everyone is sprinting downfield with the punt (+dir).
        const facing = (phase === "return" && isFree) ? -dir : dir;
        drawPlayer(ctx, cx_, cy_, possColor, team.secondary, "", pose, (t < 0.95 ? ((performance.now() / 333) + i * 0.2) % 1 : 0), facing, { name: "punt-cov-" + i });
      }
      // ── 3 RETURN-TEAM BLOCKERS — each glued to their assigned chaser during the return ──
      for (let i = 0; i < 3; i++) {
        const targetChaser = chaserPositions[i];
        let bx, by;
        if (phase === "snap" || phase === "wind") {
          bx = landX - dir * 22;
          by = laneYs[i] * 0.4 + returnerY * 0.6;
        } else if (phase === "air") {
          const tt = (t - PH_WIND_END) / (PH_AIR_END - PH_WIND_END);
          const setupX = (targetChaser.x + landX) / 2;
          const setupY = targetChaser.y * 0.5 + returnerY * 0.5;
          bx = (landX - dir * 22) + (setupX - (landX - dir * 22)) * tt;
          by = (laneYs[i] * 0.4 + returnerY * 0.6) + (setupY - (laneYs[i] * 0.4 + returnerY * 0.6)) * tt;
        } else if (phase === "field") {
          bx = (targetChaser.x + landX) / 2;
          by = (targetChaser.y + returnerY) / 2;
        } else {
          // RETURN — wedge between returner (at ballX) and chaser (ahead
          // of returner at ballX - dir*~24, since returner runs -dir).
          // Blocker sits on the RETURNER side of the chaser (+dir of
          // chaser) so cov has to fight through him to reach the carrier.
          bx = targetChaser.x + dir * 7;
          by = targetChaser.y + (returnerY - targetChaser.y) * 0.10;
        }
        const blockerPose = (phase === "return" || phase === "field") ? "engage" : "run";
        // Pre-return: blockers run downfield toward the landing area (+dir).
        // Once engaging (field + return) the chaser is on the -dir side →
        // face -dir to look at him. Was `=== "return"` only, so during the
        // FIELD phase the blocker wrestled the coverage while facing the
        // wrong way (mismatching the engage pose above).
        const facing = (phase === "return" || phase === "field") ? -dir : dir;
        drawPlayer(ctx, bx, by, oppColor, oppTeam.secondary, "", blockerPose, (t < 0.95 ? ((performance.now() / 333) + i * 0.15) % 1 : 0), facing, { name: "punt-block-" + i });
      }
      // Returner (with ball after fielding)
      const returnerX = phase === "return" ? ballX : landX;
      const returnerDrawY = phase === "return" ? ballY : returnerY;
      const returnerPose = phase === "return" ? "carry"
                         : (phase === "field" ? "catch" : "idle");
      // Returner faces his return direction (-dir) from the moment the ball
      // is in the air — he tracks it, catches it, and runs it back all facing
      // the same way. Was `=== "return"` only, so he faced downfield through
      // the catch then SNAPPED 180° to -dir on the return (a visible flip on
      // the ball-carrier). snap/wind (pre-kick) still face the line.
      const returnerFacing = (phase === "snap" || phase === "wind") ? dir : -dir;
      drawPlayer(ctx, returnerX, returnerDrawY, oppColor, oppTeam.secondary, "", returnerPose, (t < 0.95 ? ((performance.now() / 333)) % 1 : 0), returnerFacing, { name: "punt-returner" });
      // SINGLE BALL — once the returner fields it ("catch") and runs it back
      // ("carry"), those sprites draw the ball in hand/tuck; the standalone
      // would double it. Show the standalone only while the ball is in the
      // air (snap/wind/air, returner "idle" — no ball on the sprite).
      const _puntSpritesOn = (typeof SpriteAtlas !== "undefined" && SpriteAtlas.anyLoaded());
      const _returnerHoldsBall = (returnerPose === "carry" || returnerPose === "catch");
      if (!_puntSpritesOn || !_returnerHoldsBall) {
        drawBall(ctx, ballX, ballY, 1 + arc / 200);
      }
      // Callouts
      if (phase === "field" || (phase === "return" && t < PH_FIELD_END + RET_LEN * 0.25)) {
        ctx.save();
        ctx.fillStyle = isTouchback ? "#cccccc" : isFairCatch ? "#9bd0ff" : "#9be09b";
        ctx.font = "900 22px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(isTouchback ? "TOUCHBACK" : isFairCatch ? "FAIR CATCH" : "FIELDED!", landX, returnerY - 24);
        ctx.restore();
      }
      // Big-return callout held until the returner has nearly completed
      // the runback (t > 0.94 vs prior 0.88) so the call doesn't fire
      // 5-12 yds before the actual end of the return.
      if (phase === "return" && returnYards >= 20 && t > 0.94) {
        ctx.save();
        ctx.fillStyle = "#f0cc30";
        ctx.font = "900 32px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(returnYards >= 40 ? "HOUSE CALL!" : "BIG RETURN!", FIELD.W / 2, 50);
        ctx.restore();
      }
      if (isReturnTD && t > 0.95) {
        ctx.save();
        ctx.fillStyle = "#f0cc30";
        ctx.font = "900 38px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("TOUCHDOWN!", FIELD.W / 2, 90);
        ctx.restore();
      }
    }};
  }

  if (play.kind === "score") {
    return { duration: 1200, kind: "score", render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);
      // Big banner
      ctx.fillStyle = `rgba(26,51,0,${0.4 + t * 0.4})`;
      ctx.fillRect(0, FIELD.H / 2 - 50, FIELD.W, 100);
      ctx.fillStyle = "#f0cc30";
      ctx.font = "bold 38px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("🏈 " + play.desc, FIELD.W / 2, FIELD.H / 2);
    }};
  }

  // Default: just show the field with formation
  return { duration: 800, kind: play.kind, render: (t, c) => {
    ctx = c;
    drawField(c, homeTeam, awayTeam, fieldState);
    drawPlayers(formation.offense, formation.defense);
  }};
}

function drawKickoffFormation(ctx, homeTeam, awayTeam) {
  const cy = (FIELD.TOP + FIELD.BOT) / 2;
  // Kicking team (away) at their 35
  const kx = absYardToX(65);
  for (let i = -5; i <= 5; i++) {
    if (i === 0) continue;
    drawPlayer(ctx, kx, cy + i * 12, awayTeam.primary, awayTeam.secondary);
  }
  drawPlayer(ctx, kx - 10, cy, awayTeam.primary, awayTeam.secondary, "K");
  // Receiving team (home) deep
  const rx = absYardToX(15);
  for (let i = -3; i <= 3; i++) {
    drawPlayer(ctx, rx, cy + i * 16, homeTeam.primary, homeTeam.secondary);
  }
  drawPlayer(ctx, absYardToX(8), cy, homeTeam.primary, homeTeam.secondary, "R");
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── CINEMA VIEW (side-camera, pixel-art sprites) ──────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Pixel codes: H=helmet, L=helmet stripe, F=facemask grille, J=jersey,
// N=back number, S=skin (arms/hands), P=pants, C=cleats, B=ball.
// Clean retro silhouette — minimal shading, lots of negative space.
const SPRITE_W = 20, SPRITE_H = 26;

// Anatomy-driven sprite system.
// Each frame combines a HEAD (rows 0-7), a TORSO (rows 8-16), and LEGS (rows 17-25).
// H=helmet, h=helmet-shade, L=stripe, F=facemask, V=visor-eye, J=jersey,
// j=jersey-shade, N=number, S=skin, s=skin-shade, P=pants, p=pants-shade,
// C=cleats, B=ball. Dots are transparent.

// Standard upright head — helmet with depth, facemask, visor eye holes, neck.
const _HEAD = [
  "......HHHHHHHH......",  // crown top
  ".....HhHHHHHHhH.....",  // crown with side shading
  "....HhhHHHHHHhhH....",  // widest part of helmet
  "....HLLLLLLLLLLH....",  // team-color stripe across top
  "....HFFFVFFVFFFH....",  // facemask + 2 visor pupils (eyes)
  "....HFFFFFFFFFFH....",  // lower facemask
  ".....HHHHHHHHHH.....",  // helmet base / jaw
  ".......SSSSSS.......",  // neck
];

// Torso: arms relaxed at sides, jersey w/ number on chest
const _TORSO_IDLE = [
  "....JJJJJJJJJJJJ....",  // shoulder pads top
  "...JJJJJJJJJJJJJJ...",  // shoulder pads spread
  "..SSJJJNNNNNNJJJSS..",  // upper arms (skin) + number on chest
  "..SSJJJNNNNNNJJJSS..",
  "..SSJJJNNNNNNJJJSS..",
  "..SSJJJJJJJJJJJJSS..",  // arms continue past number
  "..SSJJJJJJJJJJJJSS..",
  "...SSJJJJJJJJJJSS...",  // forearms taper in toward jersey
  "....JJJJJJJJJJJJ....",  // jersey hem / waist
];

// Standing legs — straight down, even stance
const _LEGS_STAND = [
  "....pPPPPPPPPPPp....",  // waistband shading
  "....PPP......PPP....",  // legs split
  "....PPP......PPP....",
  "....PPP......PPP....",
  "....PPP......PPP....",
  "....PPP......PPP....",
  "...PPPP......PPPP...",  // calves flare slightly
  "...CCC........CCC...",  // cleats
  "..CCC..........CCC..",  // cleat heels
];

const SPRITE_FRAMES = {
  // Idle — standing, arms at sides
  idle: [..._HEAD, ..._TORSO_IDLE, ..._LEGS_STAND],

  // Run A — back leg lifted (left), front leg planted (right side)
  run_a: [
    ..._HEAD,
    ..._TORSO_IDLE,
    "....pPPPPPPPPPPp....",
    "....PPP......PPP....",
    "....PPP.......PP....",  // right leg drifts back, lifting
    "...PPP.........PP...",
    "..PPP..........PP...",
    ".PPP...........PPP..",
    "PPP............PPP..",
    "CCC.............CCC.",  // left cleat planted forward
    "CC...............CC.",
  ],

  // Run B — opposite stride, back leg lifted (right), front leg planted (left)
  run_b: [
    ..._HEAD,
    ..._TORSO_IDLE,
    "....pPPPPPPPPPPp....",
    "....PPP......PPP....",
    "....PP.......PPP....",
    "...PP.........PPP...",
    "...PP..........PPP..",
    "..PPP...........PPP.",
    "..PPP............PPP",
    ".CCC.............CCC",
    ".CC...............CC",
  ],
  // Juke — whole sprite leans right (planted on left foot)
  // Juke — body leans right with the planted left foot
  juke: [
    "........HHHHHHHH....",
    ".......HhHHHHHHhH...",
    "......HhhHHHHHHhhH..",
    "......HLLLLLLLLLLH..",
    "......HFFFVFFVFFFH..",
    "......HFFFFFFFFFFH..",
    ".......HHHHHHHHHH...",
    ".........SSSSSS.....",
    "......JJJJJJJJJJJJ..",
    ".....JJJJJJJJJJJJJJ.",
    "....SSJJJNNNNNNJJJSS",
    "....SSJJJNNNNNNJJJSS",
    "....SSJJJNNNNNNJJJSS",
    "....SSJJJJJJJJJJJJSS",
    "....SSJJJJJJJJJJJJSS",
    ".....SSJJJJJJJJJJSS.",
    "......JJJJJJJJJJJJ..",
    "...pPPPPPPPPPPp.....",
    "..PPP........PPP....",
    "..PPP.........PPP...",
    ".PPP...........PPP..",
    ".PPP............PPP.",
    "PPP..............PP.",
    "PPP...............PP",
    "CCC...............CC",
    "CC.................C",
  ],

  // Stiff arm — right arm extends out at shoulder height
  stiff: [
    "......HHHHHHHH......",
    ".....HhHHHHHHhH.....",
    "....HhhHHHHHHhhH....",
    "....HLLLLLLLLLLH....",
    "....HFFFVFFVFFFH....",
    "....HFFFFFFFFFFH....",
    ".....HHHHHHHHHH.....",
    ".......SSSSSS.......",
    "....JJJJJJJJJJJJ....",
    "...JJJJJJJJJJJJJJSSS",
    "..SSJJJNNNNNNJJJSSSS",
    "..SSJJJNNNNNNJJJSSSS",
    "..SSJJJNNNNNNJJJSS..",
    "..SSJJJJJJJJJJJJSS..",
    "..SSJJJJJJJJJJJJSS..",
    "...SSJJJJJJJJJJSS...",
    "....JJJJJJJJJJJJ....",
    ..._LEGS_STAND,
  ],

  // Tackled — body crumpled on the ground (helmet at top, legs splayed below)
  tackled: [
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "......HHHHHHHH......",
    ".....HhHHHHHHhH.....",
    "....HhhHHHHHHhhH....",
    "....HLLLLLLLLLLH....",
    "....HFFFVFFVFFFH....",
    "....HFFFFFFFFFFH....",
    ".....HHHHHHHHHH.....",
    "....JJJJJJJJJJJJ....",
    "...SJJJNNNNNNJJJS...",
    "...SJJJJJJJJJJJJS...",
    "....JJJJJJJJJJJJ....",
    "....pPPPPPPPPPPp....",
    "....PPPPPPPPPPPP....",
    "...CC..CC..CC..CC...",
    "....................",
    "....................",
    "....................",
    "....................",
  ],

  // Catch — both arms reaching up overhead (head shifts down to make room)
  catch: [
    "SS................SS",
    ".SS..............SS.",
    "..SS............SS..",
    "...SS..........SS...",
    "....SS........SS....",
    "......HHHHHHHH......",
    ".....HhHHHHHHhH.....",
    "....HhhHHHHHHhhH....",
    "....HLLLLLLLLLLH....",
    "....HFFFVFFVFFFH....",
    "....HFFFFFFFFFFH....",
    ".....HHHHHHHHHH.....",
    ".......SSSSSS.......",
    "....JJJJJJJJJJJJ....",
    "...JJJJJJJJJJJJJJ...",
    "...JJJJNNNNNNJJJJ...",
    "...JJJJJJJJJJJJJJ...",
    "....JJJJJJJJJJJJ....",
    "....pPPPPPPPPPPp....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "...PPPP......PPPP...",
    "...CCC........CCC...",
    "..CCC..........CCC..",
  ],

  // Celebrate — both arms in a wide V
  celebrate: [
    "SS................SS",
    "SS................SS",
    ".SS..............SS.",
    "..SS............SS..",
    "...SS..........SS...",
    "......HHHHHHHH......",
    ".....HhHHHHHHhH.....",
    "....HhhHHHHHHhhH....",
    "....HLLLLLLLLLLH....",
    "....HFFFVFFVFFFH....",
    "....HFFFFFFFFFFH....",
    ".....HHHHHHHHHH.....",
    ".......SSSSSS.......",
    "....JJJJJJJJJJJJ....",
    "...JJJJJJJJJJJJJJ...",
    "...JJJJNNNNNNJJJJ...",
    "...JJJJJJJJJJJJJJ...",
    "....JJJJJJJJJJJJ....",
    "....pPPPPPPPPPPp....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "...PPPP......PPPP...",
    "...CCC........CCC...",
    "..CCC..........CCC..",
  ],

  // Leap — diving reach: right arm extended way up-right, body tilted
  leap: [
    "................SSSS",
    "..............SSSS..",
    "............SSSS....",
    "..........SSSS......",
    "........SSSS........",
    "......HHHHHHHH......",
    ".....HhHHHHHHhH.....",
    "....HhhHHHHHHhhH....",
    "....HLLLLLLLLLLH....",
    "....HFFFVFFVFFFH....",
    "....HFFFFFFFFFFH....",
    ".....HHHHHHHHHH.....",
    ".......SSSSSS.......",
    "....JJJJJJJJJJJJ....",
    "...JJJJJJJJJJJJJJ...",
    "..SSJJJNNNNNNJJJJ...",
    "..SSJJJNNNNNNJJJJ...",
    "..SSJJJJJJJJJJJJ....",
    "...SSJJJJJJJJJJ.....",
    "....pPPPPPPPPp......",
    "...PPP......PPP.....",
    "..PPP......PPP......",
    ".PPP......PPP.......",
    "PPP......PPP........",
    "CCC.......CCC.......",
    "CC.........CC.......",
  ],

  // Fist pump A — arm cocked back at shoulder height
  fist_a: [
    ..._HEAD,
    "....JJJJJJJJJJJJ....",
    "SSSJJJJJJJJJJJJJJ...",
    "SSSJJJNNNNNNJJJSS...",
    "SSSJJJNNNNNNJJJSS...",
    "..SJJJNNNNNNJJJSS...",
    "...JJJJJJJJJJJJSS...",
    "...SSJJJJJJJJJJSS...",
    "....JJJJJJJJJJJJ....",
    "....JJJJJJJJJJJJ....",
    ..._LEGS_STAND,
  ],

  // Fist pump B — fist punched up next to the head
  fist_b: [
    ".....SS.HHHHHHHH....",
    ".....SS.HhHHHHHHhH..",
    ".....SS.HhhHHHHHHhhH",
    "......SSHLLLLLLLLLLH",
    "........HFFFVFFVFFFH",
    "........HFFFFFFFFFFH",
    "........HHHHHHHHHH..",
    "..........SSSSSS....",
    ".......JJJJJJJJJJJJ.",
    "......JJJJJJJJJJJJJJ",
    ".....SSJJJNNNNNNJJJS",
    ".....SSJJJNNNNNNJJJS",
    ".....SSJJJNNNNNNJJJS",
    ".....SSJJJJJJJJJJJJS",
    "......SSJJJJJJJJJJS.",
    ".......JJJJJJJJJJJJ.",
    ".......pPPPPPPPPPPp.",
    ".......PPP......PPP.",
    ".......PPP......PPP.",
    ".......PPP......PPP.",
    ".......PPP......PPP.",
    ".......PPP......PPP.",
    "......PPPP......PPPP",
    "......CCC........CCC",
    ".....CCC..........CC",
    "....................",
  ],

  // Ref TD signal — both arms straight up
  ref_signal: [
    "SS..............SS..",
    "SS..............SS..",
    "SS..............SS..",
    "SS..............SS..",
    "SS....HHHHHHHH..SS..",
    ".....HhHHHHHHhH.....",
    "....HhhHHHHHHhhH....",
    "....HLLLLLLLLLLH....",
    "....HFFFVFFVFFFH....",
    "....HFFFFFFFFFFH....",
    ".....HHHHHHHHHH.....",
    ".......SSSSSS.......",
    "....JJJJJJJJJJJJ....",
    "...JJJJJJJJJJJJJJ...",
    "...JJJJNNNNNNJJJJ...",
    "...JJJJNNNNNNJJJJ...",
    "....JJJJJJJJJJJJ....",
    "....JJJJJJJJJJJJ....",
    "....pPPPPPPPPPPp....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "...PPPP......PPPP...",
    "...CCC........CCC...",
    "..CCC..........CCC..",
    "....................",
  ],

  // Spike — football raised overhead, ready to slam
  spike: [
    "...........BBB......",
    "..........BBBBB.....",
    "..........BBBBB.....",
    "........SSBBB.......",
    "......HHSS..........",
    ".....HhHHHHHHhH.....",
    "....HhhHHHHHHhhH....",
    "....HLLLLLLLLLLH....",
    "....HFFFVFFVFFFH....",
    "....HFFFFFFFFFFH....",
    ".....HHHHHHHHHH.....",
    ".......SSSSSS.......",
    "....JJJJJJJJJJJJ....",
    "...JJJJJJJJJJJJJJ...",
    "..SSJJJNNNNNNJJJSS..",
    "..SSJJJNNNNNNJJJSS..",
    "...SSJJJJJJJJJJSS...",
    "....JJJJJJJJJJJJ....",
    "....pPPPPPPPPPPp....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "...PPPP......PPPP...",
    "...CCC........CCC...",
    "..CCC..........CCC..",
  ],

  // Point sky — index finger raised straight up
  point_sky: [
    "........SS..........",
    "........SS..........",
    "........SS..........",
    ".......SSS..........",
    ".......SSHHHHHH.....",
    "......HHHHHHHHhH....",
    "....HhhHHHHHHhhH....",
    "....HLLLLLLLLLLH....",
    "....HFFFVFFVFFFH....",
    "....HFFFFFFFFFFH....",
    ".....HHHHHHHHHH.....",
    ".......SSSSSS.......",
    "....JJJJJJJJJJJJ....",
    "...JJJJJJJJJJJJJJ...",
    "..SSJJJNNNNNNJJJSS..",
    "..SSJJJNNNNNNJJJSS..",
    "...SSJJJJJJJJJJSS...",
    "....JJJJJJJJJJJJ....",
    "....pPPPPPPPPPPp....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "...PPPP......PPPP...",
    "...CCC........CCC...",
    "..CCC..........CCC..",
  ],
};

// Pre-render sprite frames to offscreen canvases per team palette (cached)
const SPRITE_CACHE = new Map();
const SPRITE_SCALE = 5; // each sprite pixel = 5 canvas pixels (90×90 final)

function shade(color, factor) {
  if (color[0] !== "#") return color;
  const r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16);
  return `rgb(${Math.min(255,(r*factor)|0)},${Math.min(255,(g*factor)|0)},${Math.min(255,(b*factor)|0)})`;
}

function getSpriteCanvas(team, frameKey, flipped, dimmed = false) {
  const cacheKey = `${team.primary}|${team.secondary}|${frameKey}|${flipped ? "L" : "R"}|${dimmed ? "d" : "n"}`;
  if (SPRITE_CACHE.has(cacheKey)) return SPRITE_CACHE.get(cacheKey);
  const grid = SPRITE_FRAMES[frameKey];
  const SCALE = SPRITE_SCALE;
  const cv = document.createElement("canvas");
  cv.width = SPRITE_W * SCALE;
  cv.height = SPRITE_H * SCALE;
  const c = cv.getContext("2d");
  c.imageSmoothingEnabled = false;
  const dim = (color) => dimmed ? shade(color, 0.78) : color;
  const helmet = dim(team.primary);
  const helmetShade = dim(shade(team.primary, 0.78));
  const stripe = dim(team.secondary);
  const jersey = dim(team.primary);
  const jerseyShade = dim(shade(team.primary, 0.82));
  const number = dim(team.secondary);
  for (let row = 0; row < grid.length; row++) {
    const line = grid[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === "." || ch === " ") continue;
      let color;
      switch (ch) {
        case "H": color = helmet; break;
        case "h": color = helmetShade; break;       // helmet shadow side
        case "L": color = stripe; break;             // helmet center stripe
        case "F": color = "#3a3f48"; break;          // facemask / visor (dark tint)
        case "V": color = "#1a1e26"; break;          // deeper visor band
        case "J": color = jersey; break;
        case "j": color = jerseyShade; break;        // jersey shadow side
        case "N": color = number; break;             // jersey number
        case "S": color = "#d6a878"; break;          // skin
        case "s": color = "#a87a52"; break;          // skin shadow
        case "P": color = "#f1f1f1"; break;          // pants
        case "p": color = "#bcbcbc"; break;          // pants shadow
        case "C": color = "#15151a"; break;          // cleats
        case "B": color = "#6b3416"; break;          // ball
        default:  color = jersey;
      }
      c.fillStyle = color;
      const drawCol = flipped ? (line.length - 1 - col) : col;
      c.fillRect(drawCol * SCALE, row * SCALE, SCALE, SCALE);
    }
  }
  SPRITE_CACHE.set(cacheKey, cv);
  return cv;
}

// Pre-rendered black silhouette of the sprite, used for the outline halo
function getSpriteSilhouette(frameKey, flipped) {
  const key = `__silh|${frameKey}|${flipped ? "L" : "R"}`;
  if (SPRITE_CACHE.has(key)) return SPRITE_CACHE.get(key);
  const grid = SPRITE_FRAMES[frameKey];
  const SCALE = SPRITE_SCALE;
  const cv = document.createElement("canvas");
  cv.width = SPRITE_W * SCALE;
  cv.height = SPRITE_H * SCALE;
  const c = cv.getContext("2d");
  c.imageSmoothingEnabled = false;
  c.fillStyle = "#08080c";
  for (let row = 0; row < grid.length; row++) {
    const line = grid[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === "." || ch === " ") continue;
      const drawCol = flipped ? (line.length - 1 - col) : col;
      c.fillRect(drawCol * SCALE, row * SCALE, SCALE, SCALE);
    }
  }
  SPRITE_CACHE.set(key, cv);
  return cv;
}

// In TOP-DOWN view, sprites are anchored at their vertical center on (x, y).
// `faceSeed`: optional 0..1 — when provided, draws a generated face + sunglasses.
function drawSprite(ctx, x, y, team, frameKey, flipped, dimmed, faceSeed) {
  const cv = getSpriteCanvas(team, frameKey, flipped, dimmed);
  const sx = Math.round(x - cv.width / 2);
  const sy = Math.round(y - cv.height / 2);
  // Ground shadow at player's feet (just below sprite center)
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.ellipse(Math.round(x), Math.round(y) + cv.height * 0.35, 26, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  // 4-direction outline stamp for crisp silhouette against grass
  const sil = getSpriteSilhouette(frameKey, flipped);
  ctx.drawImage(sil, sx - 2, sy);
  ctx.drawImage(sil, sx + 2, sy);
  ctx.drawImage(sil, sx, sy - 2);
  ctx.drawImage(sil, sx, sy + 2);
  ctx.drawImage(cv, sx, sy);
  if (faceSeed != null) drawFace(ctx, x, y, faceSeed, flipped);
}

// Sort sprites by their lateral Y so further-back players draw first
function drawSpriteList(ctx, sprites) {
  sprites.sort((a, b) => (a.sortY ?? a.y) - (b.sortY ?? b.y));
  for (const s of sprites) {
    drawSprite(ctx, s.x, s.y, s.team, s.frame, s.flipped, s.dimmed, s.faceSeed);
  }
}

// ─── Top-down field rendering ──────────────────────────────────────────────
const CINEMA = {
  fieldTop: 50,         // top sideline screen Y
  fieldBot: 390,        // bottom sideline screen Y
  fieldCenterY: 220,    // mid-field screen Y
  lateralPxPerYard: 6.0, // 53.3 yds × 6 = 320 px (fits)
  pxPerYard: 24,        // horizontal yards
  // groundY kept as alias for any legacy plays that draw "center field"
  get groundY() { return this.fieldCenterY; },
};

let cinemaCamX = 0;     // camera world-X (in yards × pxPerYard)
let cinemaCalloutTimeout = null;

// World X (in pixels, where 0 = home goal line) → screen X
function worldToScreenX(wx) {
  return wx - cinemaCamX + FIELD.W / 2;
}
function yardToWorldX(yard) { return yard * CINEMA.pxPerYard; }
// Lateral position in yards (0 = mid-field, ±26.6 = sidelines) → screen Y
function lateralToScreenY(lat) { return CINEMA.fieldCenterY + lat * CINEMA.lateralPxPerYard; }

function drawCinemaField(ctx, homeTeam, awayTeam, fieldState) {
  // Out-of-bounds (dark band above/below the field)
  ctx.fillStyle = "#0c0c10";
  ctx.fillRect(0, 0, FIELD.W, FIELD.H);
  // Painted sideline pad — off-white strip just past the top chalk so the
  // sideline reads as the edge of a painted surface, not a line floating
  // against the dark cinematic frame. Only the top is painted; the area
  // below CINEMA.fieldBot is the cinematic player-sprite zone (cinema
  // mode draws player bodies extending downward from the field), where a
  // pad would clash with the sprites.
  {
    const padDepth = 30;
    ctx.fillStyle = "#d9cfb9";
    ctx.fillRect(0, CINEMA.fieldTop - padDepth, FIELD.W, padDepth);
    const topGrad = ctx.createLinearGradient(0, CINEMA.fieldTop - padDepth, 0, CINEMA.fieldTop);
    topGrad.addColorStop(0, "rgba(0,0,0,0.55)");
    topGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, CINEMA.fieldTop - padDepth, FIELD.W, padDepth);
  }
  // Grass field
  const fieldGrad = ctx.createLinearGradient(0, CINEMA.fieldTop, 0, CINEMA.fieldBot);
  fieldGrad.addColorStop(0, "#1e5a2c");
  fieldGrad.addColorStop(0.5, "#247536");
  fieldGrad.addColorStop(1, "#1e5a2c");
  ctx.fillStyle = fieldGrad;
  ctx.fillRect(0, CINEMA.fieldTop, FIELD.W, CINEMA.fieldBot - CINEMA.fieldTop);
  // Mowed alternating bands (every 5 yards)
  for (let yard = -10; yard < 110; yard += 5) {
    const x = worldToScreenX(yardToWorldX(yard));
    if (x < -60 || x > FIELD.W + 60) continue;
    if ((Math.floor(yard / 5)) % 2 === 0) {
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(x, CINEMA.fieldTop, 5 * CINEMA.pxPerYard, CINEMA.fieldBot - CINEMA.fieldTop);
    }
  }
  // End zones — colored team panels
  const homeEZx = worldToScreenX(yardToWorldX(0));
  const awayEZx = worldToScreenX(yardToWorldX(100));
  ctx.fillStyle = homeTeam.primary + "d0";
  ctx.fillRect(homeEZx - 10 * CINEMA.pxPerYard, CINEMA.fieldTop, 10 * CINEMA.pxPerYard, CINEMA.fieldBot - CINEMA.fieldTop);
  ctx.fillStyle = awayTeam.primary + "d0";
  ctx.fillRect(awayEZx, CINEMA.fieldTop, 10 * CINEMA.pxPerYard, CINEMA.fieldBot - CINEMA.fieldTop);
  // End zone wordmarks (sideways like real fields)
  ctx.save();
  ctx.font = "bold 30px sans-serif";
  ctx.fillStyle = homeTeam.secondary;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.translate(homeEZx - 5 * CINEMA.pxPerYard, CINEMA.fieldCenterY);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(homeTeam.name.toUpperCase(), 0, 0);
  ctx.restore();
  ctx.save();
  ctx.font = "bold 30px sans-serif";
  ctx.fillStyle = awayTeam.secondary;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.translate(awayEZx + 5 * CINEMA.pxPerYard, CINEMA.fieldCenterY);
  ctx.rotate(Math.PI / 2);
  ctx.fillText(awayTeam.name.toUpperCase(), 0, 0);
  ctx.restore();
  // Goal lines (thick white)
  for (const gx of [homeEZx, awayEZx]) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(gx, CINEMA.fieldTop);
    ctx.lineTo(gx, CINEMA.fieldBot);
    ctx.stroke();
  }
  // Sidelines
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, CINEMA.fieldTop); ctx.lineTo(FIELD.W, CINEMA.fieldTop);
  ctx.moveTo(0, CINEMA.fieldBot); ctx.lineTo(FIELD.W, CINEMA.fieldBot);
  ctx.stroke();
  // Yard lines (vertical, full lateral field span)
  for (let yard = 0; yard <= 100; yard += 5) {
    const x = worldToScreenX(yardToWorldX(yard));
    if (x < -10 || x > FIELD.W + 10) continue;
    const isMajor = yard % 10 === 0;
    ctx.strokeStyle = isMajor ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)";
    ctx.lineWidth = isMajor ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(x, CINEMA.fieldTop);
    ctx.lineTo(x, CINEMA.fieldBot);
    ctx.stroke();
    if (isMajor && yard > 0 && yard < 100) {
      const label = yard <= 50 ? yard : 100 - yard;
      ctx.fillStyle = "#fff";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x, CINEMA.fieldTop + 22);
      ctx.fillText(label, x, CINEMA.fieldBot - 22);
    }
  }
  // Hash marks (small ticks at every yard, in two rows)
  const hashTop = CINEMA.fieldCenterY - CINEMA.lateralPxPerYard * 6.5;
  const hashBot = CINEMA.fieldCenterY + CINEMA.lateralPxPerYard * 6.5;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  for (let yard = 1; yard < 100; yard++) {
    if (yard % 5 === 0) continue;
    const x = worldToScreenX(yardToWorldX(yard));
    if (x < 0 || x > FIELD.W) continue;
    ctx.beginPath();
    ctx.moveTo(x, hashTop - 4); ctx.lineTo(x, hashTop + 4);
    ctx.moveTo(x, hashBot - 4); ctx.lineTo(x, hashBot + 4);
    ctx.stroke();
  }
  // LOS marker (blue vertical)
  if (fieldState && fieldState.losYard !== undefined) {
    const lx = worldToScreenX(yardToWorldX(fieldState.losYard));
    ctx.strokeStyle = "rgba(60,180,255,0.85)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(lx, CINEMA.fieldTop);
    ctx.lineTo(lx, CINEMA.fieldBot);
    ctx.stroke();
  }
  // First-down marker (yellow vertical)
  if (fieldState && fieldState.fdYard !== undefined && fieldState.fdYard >= 0 && fieldState.fdYard <= 100) {
    const fx = worldToScreenX(yardToWorldX(fieldState.fdYard));
    ctx.strokeStyle = "rgba(255,200,40,0.9)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(fx, CINEMA.fieldTop);
    ctx.lineTo(fx, CINEMA.fieldBot);
    ctx.stroke();
  }
}

function showCallout(text) {
  const el = document.getElementById("cinemaCallout");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  if (cinemaCalloutTimeout) clearTimeout(cinemaCalloutTimeout);
  cinemaCalloutTimeout = setTimeout(() => el.classList.remove("show"), 900);
}

function clearCallout() {
  const el = document.getElementById("cinemaCallout");
  if (el) el.classList.remove("show");
}

// Draw a chunky football icon at (x,y). Used to "enlarge the hand" on catches.
function drawBigFootball(ctx, x, y, size = 24) {
  ctx.save();
  // Drop shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 2, size, size * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  // Dark outline
  ctx.fillStyle = "#2a1408";
  ctx.beginPath();
  ctx.ellipse(x, y, size + 2, size * 0.62 + 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Body
  ctx.fillStyle = "#8a4520";
  ctx.beginPath();
  ctx.ellipse(x, y, size, size * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  // Top highlight
  ctx.fillStyle = "#b06030";
  ctx.beginPath();
  ctx.ellipse(x - size * 0.25, y - size * 0.18, size * 0.55, size * 0.18, -0.3, 0, Math.PI * 2);
  ctx.fill();
  // Laces
  ctx.strokeStyle = "#fafafa";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - size * 0.42, y);
  ctx.lineTo(x + size * 0.42, y);
  for (let i = -2; i <= 2; i++) {
    ctx.moveTo(x + i * size * 0.16, y - 4);
    ctx.lineTo(x + i * size * 0.16, y + 4);
  }
  ctx.stroke();
  ctx.restore();
}

// Draw a pop-up callout above a player ("CAUGHT!", "PICK!", etc.)
function drawHeadCallout(ctx, x, y, text, color, scale = 1) {
  ctx.save();
  const fontSize = Math.round(26 * scale);
  ctx.font = `900 ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const padX = 12 * scale;
  const w = ctx.measureText(text).width + padX * 2;
  const h = fontSize + 12;
  const cy = y - h - 4;
  ctx.fillStyle = "rgba(0,0,0,0.82)";
  roundedRect(ctx, x - w / 2, cy - h / 2, w, h, 6);
  ctx.fill();
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundedRect(ctx, x - w / 2 + 0.5, cy - h / 2 + 0.5, w - 1, h - 1, 6);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.fillText(text, x, cy + 1);
  // Tail pointer below the pill
  ctx.fillStyle = "rgba(0,0,0,0.82)";
  ctx.beginPath();
  ctx.moveTo(x - 7, cy + h / 2);
  ctx.lineTo(x + 7, cy + h / 2);
  ctx.lineTo(x, cy + h / 2 + 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Helper: pseudo-random bool from a play & seed number
function playSeed(play, salt) {
  const s = ((play.startYard ?? 0) * 31 + (play.quarter ?? 0) * 17 + (play.time ?? 0) + salt) | 0;
  return ((Math.sin(s) + 1) / 2) % 1;
}

// Hash a player name to a stable 0..1 for face-pattern selection
function nameSeed(name, salt = 0) {
  if (!name) return 0;
  let h = salt | 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return ((h >>> 0) % 10000) / 10000;
}

// Draw a generated face with COOL SUNGLASSES over the sprite's helmet area.
// (x, y) = sprite center; faceSeed = 0..1 deterministic per player
function drawFace(ctx, x, y, faceSeed, flipped) {
  // Helmet face opening is roughly at the top-center of the sprite, slightly
  // forward of center. With SCALE 5 and SPRITE_W=18/H=18, sprite spans ±45px.
  // Face sits in the upper third.
  const cx = x + (flipped ? -6 : 6);
  const cy = y - 20;
  const sx = flipped ? -1 : 1;
  ctx.save();
  // Skin patch peeking through helmet (subtle, just adds variation)
  const skinTones = ["#e8b890", "#c9905e", "#8a5a3a", "#5d3b22"];
  const skin = skinTones[Math.floor(faceSeed * skinTones.length) % skinTones.length];
  // Sunglasses style (8 variations)
  const style = Math.floor(faceSeed * 8) % 8;
  ctx.translate(cx, cy);
  // Different sunglass shapes (drawn relative to face center)
  // The "lens" colors mostly black, sometimes mirrored / colored
  const lensColors = ["#0a0a10", "#0a0a10", "#101820", "#1a0a1a", "#0a1010"];
  const lensColor = lensColors[Math.floor(faceSeed * 100) % lensColors.length];
  ctx.fillStyle = lensColor;
  ctx.strokeStyle = "#15151a";
  ctx.lineWidth = 1.5;
  switch (style) {
    case 0: { // Aviators (teardrop)
      ctx.beginPath(); ctx.ellipse(-7 * sx, 0, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(+7 * sx, 0, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#888"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-1 * sx, -1); ctx.lineTo(1 * sx, -1); ctx.stroke();
      break;
    }
    case 1: { // Wayfarers (wide rectangles)
      ctx.fillRect(-14, -4, 11, 8);
      ctx.fillRect(+3, -4, 11, 8);
      ctx.fillStyle = "#222";
      ctx.fillRect(-3, -2, 6, 2);
      // glint
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.fillRect(-12, -3, 2, 2);
      ctx.fillRect(+5, -3, 2, 2);
      break;
    }
    case 2: { // Round Lennon
      ctx.beginPath(); ctx.arc(-7 * sx, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(+7 * sx, 0, 5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 3: { // Sport visor wraparound (single band)
      ctx.fillRect(-14, -3, 28, 7);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillRect(-12, -3, 6, 2);
      break;
    }
    case 4: { // Tiny round mafia shades
      ctx.beginPath(); ctx.arc(-6 * sx, 0, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(+6 * sx, 0, 3.2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 5: { // Oversized squares
      ctx.fillRect(-16, -6, 13, 11);
      ctx.fillRect(+3, -6, 13, 11);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(-14, -5, 3, 3);
      ctx.fillRect(+5, -5, 3, 3);
      break;
    }
    case 6: { // Cat-eye (sloped)
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-14, 1); ctx.lineTo(-2, -2); ctx.lineTo(-2, 4); ctx.lineTo(-14, 5);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(14, 1); ctx.lineTo(2, -2); ctx.lineTo(2, 4); ctx.lineTo(14, 5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      break;
    }
    case 7: { // Mirrored chrome
      ctx.fillStyle = "#666";
      ctx.fillRect(-14, -4, 11, 9);
      ctx.fillRect(+3, -4, 11, 9);
      ctx.fillStyle = "#bbb";
      ctx.fillRect(-13, -4, 11, 3);
      ctx.fillRect(+4, -4, 11, 3);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(-11, -3, 2, 1);
      ctx.fillRect(+6, -3, 2, 1);
      break;
    }
  }
  // Optional facial hair (33% chance)
  if (faceSeed > 0.66) {
    ctx.fillStyle = "#1a1208";
    if (faceSeed > 0.85) {
      // Full beard
      ctx.fillRect(-7, 6, 14, 4);
    } else {
      // Goatee / chinstrap
      ctx.fillRect(-3, 7, 6, 3);
    }
  }
  ctx.restore();
}

// Top-down goalposts at (cx, cy) — the goal line cross-bar and uprights span lateral Y.
// In top-down view, the goalposts look like an H with the crossbar running along the
// goal line vertically (in screen Y), and the uprights extending into the end zone (X).
function drawTopDownGoalposts(ctx, cx, cy) {
  const POST_LAT = CINEMA.lateralPxPerYard * 3.1; // ~3.1 yds from center to each upright
  const POST_BACK = 60;                            // how far behind goal line the uprights extend
  ctx.save();
  ctx.strokeStyle = "#ffe048";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(255,224,72,0.5)";
  ctx.shadowBlur = 6;
  // Crossbar (between uprights, along Y axis)
  ctx.beginPath();
  ctx.moveTo(cx, cy - POST_LAT);
  ctx.lineTo(cx, cy + POST_LAT);
  ctx.stroke();
  // Two uprights extending back from crossbar
  ctx.beginPath();
  ctx.moveTo(cx, cy - POST_LAT); ctx.lineTo(cx + POST_BACK, cy - POST_LAT);
  ctx.moveTo(cx, cy + POST_LAT); ctx.lineTo(cx + POST_BACK, cy + POST_LAT);
  ctx.stroke();
  // Support pole (front of crossbar, lateral center)
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - 14, cy);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Base disc
  ctx.fillStyle = "#ffe048";
  ctx.beginPath();
  ctx.arc(cx - 16, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Draw a TD-style firework burst at (x, y)
function drawFirework(ctx, x, y, t01, hue) {
  // t01: 0 → 1 expansion. Particle radius grows; alpha fades.
  if (t01 < 0 || t01 > 1) return;
  const N = 14;
  const maxR = 90;
  const r = maxR * t01;
  const alpha = 1 - t01 * t01;
  ctx.save();
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    const sparkSize = 4 - t01 * 2;
    ctx.fillStyle = `hsla(${hue + (i * 7)}, 95%, ${70 - t01 * 30}%, ${alpha})`;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1, sparkSize), 0, Math.PI * 2);
    ctx.fill();
    // Trailing dot
    const px2 = x + Math.cos(a) * r * 0.7;
    const py2 = y + Math.sin(a) * r * 0.7;
    ctx.fillStyle = `hsla(${hue + (i * 7)}, 95%, ${85 - t01 * 30}%, ${alpha * 0.55})`;
    ctx.beginPath();
    ctx.arc(px2, py2, Math.max(0.8, sparkSize * 0.55), 0, Math.PI * 2);
    ctx.fill();
  }
  // Central flash
  if (t01 < 0.25) {
    ctx.fillStyle = `rgba(255,255,255,${(1 - t01 * 4) * 0.7})`;
    ctx.beginPath();
    ctx.arc(x, y, 10 * (1 - t01 * 4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Multiple staggered fireworks over the field
function drawFireworksShow(ctx, ageMs) {
  const seeds = [
    { x: 200, y: 130, hue: 50,  delay: 0    },
    { x: 800, y: 110, hue: 0,   delay: 220  },
    { x: 500, y: 90,  hue: 270, delay: 400  },
    { x: 320, y: 160, hue: 120, delay: 700  },
    { x: 680, y: 140, hue: 200, delay: 950  },
    { x: 150, y: 180, hue: 30,  delay: 1200 },
    { x: 850, y: 190, hue: 320, delay: 1400 },
    { x: 500, y: 130, hue: 60,  delay: 1700 },
  ];
  const lifetime = 900; // ms per burst
  for (const s of seeds) {
    const localT = (ageMs - s.delay) / lifetime;
    drawFirework(ctx, s.x, s.y, localT, s.hue);
  }
}

// Draw little floating "taunt" emote text rising above (x, y)
function drawTaunt(ctx, x, y, text, color, t01) {
  const rise = 30 * t01;
  const alpha = t01 < 0.15 ? t01 / 0.15 : (t01 > 0.7 ? (1 - t01) / 0.3 : 1);
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.font = "900 22px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(text, x, y - rise);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y - rise);
  ctx.restore();
}

// Stable per-play taunt pick
function pickTaunt(play, salt = 0) {
  const opts = ["LET'S GOOO!", "TOO EASY", "ALL DAY!", "SIX!!", "CAN'T STOP ME", "GIVE ME MY MONEY", "TALK TO ME NOW", "WHO?!", "BIG TIME", "CASH IT IN"];
  const seed = ((play.startYard ?? 0) * 31 + (play.time ?? 0) + salt) | 0;
  return opts[((seed >>> 0) % opts.length)];
}

// ─── Celebration animation system ─────────────────────────────────────────
// A celebration is a sequence of frames the player cycles through, plus an
// optional MvC-style portrait popup with grinning face.
const CELEBRATIONS = {
  FIST_PUMP:  { frames: ["fist_a", "fist_b", "fist_a", "fist_b"], shoutWords: ["YESSSS!", "C'MON!", "LIGHT IT UP!"] },
  REF_SIGNAL: { frames: ["ref_signal", "celebrate", "ref_signal", "celebrate"], shoutWords: ["TOUCHDOWN!", "REFS CAN'T STOP ME", "SIX MORE!"] },
  SPIKE:      { frames: ["spike", "spike", "celebrate", "fist_b"], shoutWords: ["SPIKE IT!", "BOOM!", "PUT IT DOWN"] },
  POINT_SKY:  { frames: ["point_sky", "point_sky", "celebrate", "point_sky"], shoutWords: ["BLESSED!", "THANK YOU LORD", "UP THERE!"] },
  DANCE:      { frames: ["juke", "stiff", "juke", "celebrate"], shoutWords: ["GET BUCKETS!", "WHO?!", "TOO EASY"] },
};
const CELEBRATION_NAMES = Object.keys(CELEBRATIONS);

function pickCelebration(play, salt = 0) {
  const seed = ((play.startYard ?? 0) * 41 + (play.time ?? 0) + salt) | 0;
  return CELEBRATION_NAMES[((seed >>> 0) % CELEBRATION_NAMES.length)];
}
function pickShout(celebKey, play, salt = 0) {
  const c = CELEBRATIONS[celebKey];
  const seed = ((play.startYard ?? 0) * 53 + (play.time ?? 0) + salt) | 0;
  return c.shoutWords[((seed >>> 0) % c.shoutWords.length)];
}
function getCelebFrame(celebKey, t01) {
  const c = CELEBRATIONS[celebKey];
  const idx = Math.min(c.frames.length - 1, Math.floor(t01 * c.frames.length));
  return c.frames[idx];
}

// MvC-style portrait popup of the celebrating player. (x, y) = anchor;
// portrait slides in from off-screen, bounces, and slides out.
//   t01: 0 → 1 over the popup lifetime
//   side: "left" or "right" — which side of the screen the portrait sits
//   team: the player's team (for jersey color), faceSeed: for the face
//   playerName: appears in the nameplate
function drawPortraitPopup(ctx, t01, side, team, faceSeed, playerName, shoutText) {
  if (t01 < 0 || t01 > 1) return;
  const W = 220, H = 200;
  const targetX = side === "left" ? 30 : FIELD.W - W - 30;
  const targetY = 40;
  // Slide in (0..0.18), hold (0.18..0.78), slide out (0.78..1)
  let slideT;
  if (t01 < 0.18) slideT = t01 / 0.18;
  else if (t01 < 0.78) slideT = 1;
  else slideT = 1 - (t01 - 0.78) / 0.22;
  const startX = side === "left" ? -W - 20 : FIELD.W + 20;
  const x = startX + (targetX - startX) * easeOutCubic(slideT);
  const y = targetY;
  // Pulse scale during hold (subtle breathing)
  const holdPhase = (t01 > 0.18 && t01 < 0.78) ? (t01 - 0.18) / 0.6 : 0;
  const pulse = 1 + Math.sin(holdPhase * Math.PI * 3) * 0.025;
  ctx.save();
  ctx.translate(x + W / 2, y + H / 2);
  ctx.scale(pulse, pulse);
  ctx.translate(-W / 2, -H / 2);
  // Speed-line backdrop — diagonal slashes radiating from center
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  const cxBg = W / 2, cyBg = H / 2;
  const lineCount = 18;
  for (let i = 0; i < lineCount; i++) {
    const ang = (i / lineCount) * Math.PI * 2 + t01 * 0.5;
    const hue = (i * 18 + t01 * 90) % 360;
    ctx.strokeStyle = `hsla(${hue}, 90%, 60%, 0.5)`;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(cxBg, cyBg);
    ctx.lineTo(cxBg + Math.cos(ang) * 400, cyBg + Math.sin(ang) * 400);
    ctx.stroke();
  }
  // Dark vignette so face pops
  const grad = ctx.createRadialGradient(cxBg, cyBg, 30, cxBg, cyBg, 140);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.7)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  // Frame border (comic-book style)
  ctx.lineWidth = 5;
  ctx.strokeStyle = team.secondary || "#f0cc30";
  ctx.strokeRect(2, 2, W - 4, H - 4);
  ctx.lineWidth = 2;
  ctx.strokeStyle = team.primary || "#000";
  ctx.strokeRect(6, 6, W - 12, H - 12);
  // BIG portrait of the player — draw the celebrate sprite scaled up to fill the frame
  const cv = getSpriteCanvas(team, "celebrate", false, false);
  const portraitScale = (H - 40) / cv.height * 1.4;  // crop helmet area
  const pw = cv.width * portraitScale;
  const ph = cv.height * portraitScale;
  ctx.save();
  ctx.beginPath(); ctx.rect(10, 10, W - 20, H - 50); ctx.clip();
  // Show only the upper portion (head + shoulders)
  ctx.drawImage(cv, W / 2 - pw / 2, H / 2 - ph / 2 - 10);
  // Big grinning face overlaid on top of the helmet area
  drawFace(ctx, W / 2 + 3, H / 2 - ph * 0.28, faceSeed, false);
  // Add a grin (white teeth)
  ctx.fillStyle = "#fafafa";
  ctx.fillRect(W / 2 - 8, H / 2 - ph * 0.18, 16, 4);
  ctx.fillStyle = "#000";
  for (let i = 0; i < 4; i++) ctx.fillRect(W / 2 - 6 + i * 4, H / 2 - ph * 0.18, 1, 4);
  ctx.restore();
  // Nameplate at bottom
  ctx.fillStyle = team.primary || "#000";
  ctx.fillRect(10, H - 42, W - 20, 30);
  ctx.lineWidth = 2;
  ctx.strokeStyle = team.secondary || "#fff";
  ctx.strokeRect(10, H - 42, W - 20, 30);
  ctx.fillStyle = team.secondary || "#fff";
  ctx.font = "900 16px sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText((playerName || "STAR").toUpperCase(), W / 2, H - 27);
  // Shout bubble at top
  if (shoutText) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    const shoutW = 130, shoutH = 26;
    roundedRect(ctx, W / 2 - shoutW / 2, -8, shoutW, shoutH, 6);
    ctx.fill();
    ctx.strokeStyle = "#f0cc30";
    ctx.lineWidth = 2;
    roundedRect(ctx, W / 2 - shoutW / 2 + 0.5, -8 + 0.5, shoutW - 1, shoutH - 1, 6);
    ctx.stroke();
    ctx.fillStyle = "#f0cc30";
    ctx.font = "900 14px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(shoutText, W / 2, 6);
    ctx.restore();
  }
  ctx.restore();
}

// Decide if a juke fires this play, weighted by hidden athleticism.
// Without career hidden stats wired in, fall back to a base rate.
function decideMoves(play, offRatings, defRatings) {
  const moves = []; // [{ at: t01, kind: "JUKE" | "STIFF_ARM" | "BROKEN_TACKLE" }]
  if (play.kind !== "run" && play.kind !== "complete") return moves;
  const yards = play.yards ?? 0;
  // Big runs more likely to feature a move
  const bigPlay = yards >= 10;
  const r = playSeed(play, 11);
  const r2 = playSeed(play, 23);
  const r3 = playSeed(play, 41);
  if (yards >= 6 && r < (bigPlay ? 0.55 : 0.22)) {
    moves.push({ at: 0.40 + r2 * 0.15, kind: "JUKE" });
  }
  if (yards >= 8 && r2 < 0.22) {
    moves.push({ at: 0.55 + r3 * 0.1, kind: "STIFF ARM" });
  }
  if (bigPlay && r3 < 0.30) {
    moves.push({ at: 0.62 + r * 0.1, kind: "BROKEN TACKLE" });
  }
  return moves;
}

// ─── Cinema animation builder ─────────────────────────────────────────────

function buildCinemaAnim(play, prevPlay) {
  const homeTeam = gameResult.homeTeam, awayTeam = gameResult.awayTeam;

  // Markers
  if (["halftime", "ot", "quarter"].includes(play.kind)) {
    return { duration: 1200, kind: play.kind, render: (t, ctx) => {
      drawCinemaField(ctx, homeTeam, awayTeam, null);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, FIELD.W, FIELD.H);
      ctx.fillStyle = "#f0cc30";
      ctx.font = "bold 42px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(play.desc, FIELD.W / 2, FIELD.H / 2);
    }};
  }

  if (play.kind === "score") {
    const isTD = (play.desc || "").toLowerCase().includes("touchdown");
    const isFG = (play.desc || "").toLowerCase().includes("fg");
    return { duration: isTD ? 2200 : 1200, kind: "score", render: (t, ctx) => {
      drawCinemaField(ctx, homeTeam, awayTeam, null);
      ctx.fillStyle = `rgba(10,16,4,${0.55 + t * 0.3})`;
      ctx.fillRect(0, FIELD.H / 2 - 60, FIELD.W, 120);
      ctx.fillStyle = isTD ? "#f0cc30" : isFG ? "#9be09b" : "#ffffff";
      ctx.font = "900 44px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("🏈 " + play.desc, FIELD.W / 2, FIELD.H / 2);
      if (isTD) {
        const ageMs = t * 2200;
        drawFireworksShow(ctx, ageMs);
      }
    }};
  }

  // play.startYard is already possession-relative (0 = offense's own goal, 100 = defense EZ).
  // Cinema view always orients offense → right.
  const poss = play.poss;
  const offTeam = poss === "home" ? homeTeam : awayTeam;
  const defTeam = poss === "home" ? awayTeam : homeTeam;
  const offRatings = poss === "home" ? gameResult.homeRatings : gameResult.awayRatings;
  const defRatings = poss === "home" ? gameResult.awayRatings : gameResult.homeRatings;
  const startYardAbs = play.startYard;
  const endYardAbs = play.endYard ?? play.startYard;
  const fdYardAbs = play.down > 0 ? clamp(startYardAbs + play.ytg, 0, 100) : -1;
  const losWX = yardToWorldX(startYardAbs);
  const endWX = yardToWorldX(endYardAbs);

  // Camera follows the ball carrier, slightly leading the action
  function setCamFromCarrier(carrierWX) {
    const lead = (endWX - losWX) * 0.15;
    cinemaCamX = carrierWX + lead;
  }

  const moves = decideMoves(play, offRatings, defRatings);

  // ── RUN PLAY (top-down) ───────────────────────────────────────────────
  if (play.kind === "run") {
    const yards = play.yards ?? 0;
    const isTD = (play.endYard ?? 0) >= 100;
    const isBig = yards >= 15;
    const rusherSeed = nameSeed(play.rusher);
    const qbSeed = nameSeed(play.passer || "QB");
    // Scale cinema duration with the run so big plays have time to develop
    // (was a flat 2400ms — 80-yd TDs covered the field in ~2 seconds).
    const cinDur = Math.round(clamp(1800 + Math.abs(yards) * 70, 1900, 7500) + (isTD ? 1000 : 600));
    return { duration: cinDur, kind: "run", render: (t, ctx) => {
      const PRE = 0.14;
      let carrierWX, runT = 0;
      const carrierStartWX = losWX - 7 * CINEMA.pxPerYard;
      if (t < PRE) {
        carrierWX = carrierStartWX;
      } else {
        runT = (t - PRE) / (1 - PRE);
        // Linear-with-mild-easeIn — no more easeOutCubic teleport on big plays.
        const eased = runT < 0.12
                    ? (runT * runT) / 0.24
                    : 0.06 + ((runT - 0.12) / 0.88) * 0.94;
        carrierWX = carrierStartWX + (endWX - carrierStartWX) * Math.min(1, eased * 1.05);
      }
      // Determine active "move" (juke / stiff / broken tackle)
      let activeMove = null;
      for (const m of moves) { if (Math.abs(t - m.at) < 0.05) { activeMove = m; break; } }
      // Lateral wobble for carrier (more for juke)
      let carrierLat = activeMove?.kind === "JUKE" ? Math.sin(t * 24) * 3 : Math.sin(t * 4) * 0.6;
      setCamFromCarrier(carrierWX);
      drawCinemaField(ctx, homeTeam, awayTeam, { losYard: startYardAbs, fdYard: fdYardAbs });

      // Collect all player sprites, sort by lateral Y for proper layering
      const sprites = [];
      // OL — 5 across LOS, lateralY -4.5 .. +4.5
      const olLats = [-4.5, -2.2, 0, 2.2, 4.5];
      for (let i = 0; i < 5; i++) {
        const surge = t < PRE ? 0 : runT * 22;
        const olWX = losWX - 0.7 * CINEMA.pxPerYard + surge + Math.sin(t * 6 + i) * 2;
        const frame = t < PRE ? "idle" : (Math.floor(t * 7 + i) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(olWX), y: lateralToScreenY(olLats[i]), team: offTeam, frame, flipped: false, faceSeed: nameSeed("OL", i) });
      }
      // TE on the right
      sprites.push({ x: worldToScreenX(losWX - 0.7 * CINEMA.pxPerYard), y: lateralToScreenY(7), team: offTeam, frame: t < PRE ? "idle" : "run_a", flipped: false, faceSeed: nameSeed("TE") });
      // WR1 (left wide), WR2 (right wide) — they run downfield blocking
      sprites.push({ x: worldToScreenX(losWX + (t < PRE ? 0 : runT * 30)), y: lateralToScreenY(-22), team: offTeam, frame: t < PRE ? "idle" : "run_b", flipped: false, faceSeed: nameSeed("WR1") });
      sprites.push({ x: worldToScreenX(losWX + (t < PRE ? 0 : runT * 30)), y: lateralToScreenY(20), team: offTeam, frame: t < PRE ? "idle" : "run_a", flipped: false, faceSeed: nameSeed("WR2") });
      // QB — hands off then trails
      const qbWX = losWX - 5 * CINEMA.pxPerYard;
      const qbFrame = t < PRE ? "idle" : "stiff";
      sprites.push({ x: worldToScreenX(qbWX), y: lateralToScreenY(0.5), team: offTeam, frame: qbFrame, flipped: false, faceSeed: qbSeed });
      // Carrier (RB)
      let carrierFrame;
      if (t < PRE) carrierFrame = "idle";
      else if (activeMove) {
        if (activeMove.kind === "JUKE") carrierFrame = "juke";
        else if (activeMove.kind === "STIFF ARM") carrierFrame = "stiff";
        else carrierFrame = "run_a";
        if (!play._calloutsFired) play._calloutsFired = new Set();
        if (!play._calloutsFired.has(activeMove.kind)) {
          play._calloutsFired.add(activeMove.kind);
          showCallout(activeMove.kind);
        }
      } else carrierFrame = (Math.floor(t * 10) % 2 === 0) ? "run_a" : "run_b";
      if (runT > 0.88 && yards < 90 && !isTD) carrierFrame = "tackled";
      // TD celebration on the carrier — held until runT > 0.92 so the
      // carrier is visibly in the endzone before he starts celebrating.
      // Was 0.85, which on long TDs put the carrier in pre-celebration
      // pose 5-10 yards short of the goal line.
      if (isTD && runT > 0.92) carrierFrame = "celebrate";
      sprites.push({ x: worldToScreenX(carrierWX), y: lateralToScreenY(carrierLat), team: offTeam, frame: carrierFrame, flipped: false, faceSeed: rusherSeed });

      // Defenders — DL, LB, S, CB
      const dlLats = [-3.8, -1.3, 1.3, 3.8];
      for (let i = 0; i < 4; i++) {
        const dlStartWX = losWX + 0.8 * CINEMA.pxPerYard;
        const dWX = dlStartWX + (t > PRE ? Math.min(1, runT * 1.3) * (carrierWX - dlStartWX) * 0.85 : 0);
        const frame = t < PRE ? "idle" : (Math.floor(t * 9 + i) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(dWX), y: lateralToScreenY(dlLats[i] + (carrierLat - dlLats[i]) * Math.min(0.5, runT * 0.5)), team: defTeam, frame, flipped: true, faceSeed: nameSeed("DL", i) });
      }
      const lbLats = [-5, 0, 5];
      for (let i = 0; i < 3; i++) {
        const lbStartWX = losWX + 5 * CINEMA.pxPerYard;
        const dWX = lbStartWX + (t > PRE ? Math.min(1, runT * 1.0) * (carrierWX - lbStartWX) * 0.95 : 0);
        const frame = t < PRE ? "idle" : (Math.floor(t * 9 + i + 4) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(dWX), y: lateralToScreenY(lbLats[i] + (carrierLat - lbLats[i]) * Math.min(0.6, runT * 0.7)), team: defTeam, frame, flipped: true, faceSeed: nameSeed("LB", i) });
      }
      // Safeties (deep)
      for (let i = 0; i < 2; i++) {
        const sLat = i === 0 ? -9 : 9;
        const sStartWX = losWX + 12 * CINEMA.pxPerYard;
        const dWX = sStartWX + (t > PRE && yards > 5 ? Math.min(1, runT) * (carrierWX - sStartWX) * 0.7 : 0);
        const frame = t < PRE ? "idle" : (Math.floor(t * 9 + i + 8) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(dWX), y: lateralToScreenY(sLat + (carrierLat - sLat) * Math.min(0.4, runT * 0.5)), team: defTeam, frame, flipped: true, faceSeed: nameSeed("S", i) });
      }
      // Corners on the wide receivers
      for (const [lat, salt] of [[-22, 0], [20, 1]]) {
        sprites.push({ x: worldToScreenX(losWX + 4 * CINEMA.pxPerYard + (t > PRE ? runT * 20 : 0)), y: lateralToScreenY(lat), team: defTeam, frame: t < PRE ? "idle" : "run_b", flipped: true, faceSeed: nameSeed("CB", salt) });
      }

      drawSpriteList(ctx, sprites);

      // BIG PLAY taunt floating above the carrier
      if (isBig && runT > 0.70 && runT < 0.96 && !isTD) {
        const tauntT = (runT - 0.70) / 0.26;
        drawTaunt(ctx, worldToScreenX(carrierWX), lateralToScreenY(carrierLat) - 60, pickTaunt(play, 0), "#f0cc30", tauntT);
      }
      // TD fireworks — held until runT > 0.92 (was 0.82) so the
      // fireworks don't start before the carrier has crossed the line.
      if (isTD && runT > 0.92) {
        const ageMs = (runT - 0.92) * 2400;
        drawFireworksShow(ctx, ageMs);
      }

      // Reset callouts at start of next play
      if (t < 0.05 && play._calloutsFired) play._calloutsFired = null;
    }};
  }

  // ── PASS PLAYS (complete / incomplete / int) ──────────────────────────
  if (play.kind === "complete" || play.kind === "incomplete" || play.kind === "int") {
    const isComplete = play.kind === "complete";
    const isInt      = play.kind === "int";
    const targetDepth = play.targetDepth || 10;
    const targetWX_view = losWX + targetDepth * CINEMA.pxPerYard;
    // Pick a target receiver lateral position deterministically (WR1 left, WR2 right, TE slot, RB short)
    // Use the play seed to keep it stable.
    const recRoll = playSeed(play, 99);
    const recLat = recRoll < 0.4 ? -20 : recRoll < 0.7 ? 18 : recRoll < 0.88 ? 7 : -3;
    // "Highlight" catches get a longer freeze + CAUGHT! callout
    const yardsGained = play.yards ?? 0;
    const isDeep      = targetDepth >= 18;
    const isBigCatch  = yardsGained >= 25;
    const isTD        = isComplete && (play.endYard ?? 0) >= 100;
    const isHighlight = isComplete && (isDeep || isBigCatch || isTD);
    const FREEZE_MS = isComplete ? (isHighlight ? 850 : 280) : (isInt ? 700 : 0);
    // Scale cinema pass duration with depth/yards so deep balls + big YAC
    // catches don't teleport (was a flat 2400ms for everything).
    const passSpan  = Math.max(targetDepth, yardsGained, 8);
    const baseDur   = Math.round(clamp(1800 + passSpan * 55, 2000, 6500) + (isTD ? 800 : 0));
    const totalDur  = baseDur + FREEZE_MS;
    const ARRIVE = 0.62;
    const F1 = (ARRIVE * baseDur) / totalDur;
    const F2 = (ARRIVE * baseDur + FREEZE_MS) / totalDur;
    const mapT = FREEZE_MS === 0 ? (x => x) : (x => {
      if (x <= F1) return x * ARRIVE / F1;
      if (x <= F2) return ARRIVE;
      return ARRIVE + (x - F2) * (1 - ARRIVE) / (1 - F2);
    });
    const passerSeed = nameSeed(play.passer);
    const rcvrSeed   = nameSeed(play.receiver || play.intended);
    return { duration: totalDur, kind: play.kind, render: (tNew, ctx) => {
      const t = mapT(tNew);
      const inFreeze = FREEZE_MS > 0 && tNew > F1 && tNew < F2;
      const freezePhase = inFreeze ? (tNew - F1) / (F2 - F1) : 0;
      const PRE = 0.16, DROP = 0.34;
      let qbWX = losWX - 5 * CINEMA.pxPerYard, ballWX, ballArc = 0;
      let ballLat = 0;  // lateral position of ball
      let carrierWX = losWX - 1 * CINEMA.pxPerYard, carrierLat = recLat;
      // Ball animation
      if (t < PRE) { ballWX = qbWX; ballLat = 0.5; }
      else if (t < DROP) {
        const tt = (t - PRE) / (DROP - PRE);
        qbWX = losWX - 5 * CINEMA.pxPerYard - tt * 3.2 * CINEMA.pxPerYard;
        ballWX = qbWX; ballLat = 0.5;
      } else if (t < ARRIVE) {
        const tt = (t - DROP) / (ARRIVE - DROP);
        qbWX = losWX - 7.7 * CINEMA.pxPerYard;
        ballWX = qbWX + (targetWX_view - qbWX) * tt;
        ballLat = 0.5 + (recLat - 0.5) * tt;
        ballArc = Math.sin(tt * Math.PI) * 95;
      } else {
        const tt = (t - ARRIVE) / (1 - ARRIVE);
        qbWX = losWX - 7.7 * CINEMA.pxPerYard;
        if (isComplete) {
          ballWX = targetWX_view + (endWX - targetWX_view) * easeOutCubic(tt);
          carrierWX = ballWX;
        } else if (isInt) {
          // The defender (interceptor) takes the ball back the OTHER direction
          ballWX = targetWX_view - tt * 60;
          ballLat = recLat + (0 - recLat) * tt; // drifts to mid-field
        } else {
          ballWX = targetWX_view;
          ballLat = recLat;
        }
      }
      if (inFreeze) setCamFromCarrier(targetWX_view);
      else setCamFromCarrier(t < ARRIVE ? (qbWX + targetWX_view) / 2 : carrierWX);
      drawCinemaField(ctx, homeTeam, awayTeam, { losYard: startYardAbs, fdYard: fdYardAbs });
      if (inFreeze) {
        const vignette = Math.sin(freezePhase * Math.PI) * 0.28;
        ctx.fillStyle = `rgba(0,0,0,${vignette})`;
        ctx.fillRect(0, 0, FIELD.W, FIELD.H);
      }

      const sprites = [];
      // OL — pass-block, slight retreat
      const olLats = [-4.5, -2.2, 0, 2.2, 4.5];
      for (let i = 0; i < 5; i++) {
        const olWX = losWX - 0.7 * CINEMA.pxPerYard - Math.min(t, 0.5) * 22 + Math.sin(t * 5 + i) * 2;
        const frame = "idle";
        sprites.push({ x: worldToScreenX(olWX), y: lateralToScreenY(olLats[i]), team: offTeam, frame, flipped: false, faceSeed: nameSeed("OL", i) });
      }
      // QB
      const qbFrame = t < PRE ? "idle" : (t < DROP ? "run_b" : (t < ARRIVE ? "stiff" : (isInt && t > ARRIVE + 0.1 ? "tackled" : "idle")));
      sprites.push({ x: worldToScreenX(qbWX), y: lateralToScreenY(0.5), team: offTeam, frame: qbFrame, flipped: false, faceSeed: passerSeed });
      // Receivers — WR1 (-20), WR2 (+18), TE (+7), RB (-3 shallow)
      const routes = [
        { lat: -20, depth: targetDepth + 2, faceSeed: nameSeed("WR1"), isTarget: Math.abs(recLat - (-20)) < 5 },
        { lat: 18,  depth: targetDepth + 1, faceSeed: nameSeed("WR2"), isTarget: Math.abs(recLat - 18)  < 5 },
        { lat: 7,   depth: Math.min(targetDepth, 12), faceSeed: nameSeed("TE"), isTarget: Math.abs(recLat - 7) < 5 },
        { lat: -3,  depth: 4, faceSeed: nameSeed("RB"), isTarget: Math.abs(recLat - (-3)) < 5 },
      ];
      const catchWindow = (t > ARRIVE - 0.08 && t < ARRIVE + 0.05) || inFreeze;
      for (const route of routes) {
        const routeProgress = Math.min(1, t / ARRIVE);
        const wrWX = losWX + 4 + routeProgress * route.depth * CINEMA.pxPerYard;
        let wx = wrWX, lat = route.lat;
        let frame;
        if (route.isTarget) {
          if (t < PRE) frame = "idle";
          else if (inFreeze && isComplete) frame = isHighlight ? "leap" : "catch";
          else if (catchWindow && isComplete) frame = isHighlight ? "leap" : "catch";
          else if (catchWindow && isInt) frame = "tackled";
          else if (t > ARRIVE && isComplete) { wx = carrierWX; lat = recLat; frame = (Math.floor(t * 10) % 2 === 0) ? "run_a" : "run_b"; }
          else if (isTD && t > 0.92) frame = "celebrate";
          else frame = (Math.floor(t * 10) % 2 === 0) ? "run_a" : "run_b";
        } else {
          if (t < PRE) frame = "idle";
          else frame = (Math.floor(t * 10) % 2 === 0) ? "run_a" : "run_b";
        }
        sprites.push({ x: worldToScreenX(wx), y: lateralToScreenY(lat), team: offTeam, frame, flipped: false, faceSeed: route.faceSeed });
      }
      // Defenders — DL rush, LB drops, CB on WRs, S deep
      const dlLats = [-3.5, -1.2, 1.2, 3.5];
      for (let i = 0; i < 4; i++) {
        const dlStartWX = losWX + 0.8 * CINEMA.pxPerYard;
        const dWX = dlStartWX + Math.min(1, t / ARRIVE) * (qbWX - dlStartWX) * 0.85;
        const frame = t < PRE ? "idle" : (Math.floor(t * 9 + i) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(dWX), y: lateralToScreenY(dlLats[i]), team: defTeam, frame, flipped: true, faceSeed: nameSeed("DL", i) });
      }
      const lbLats = [-5, 0, 5];
      for (let i = 0; i < 3; i++) {
        const lbStartWX = losWX + 4.5 * CINEMA.pxPerYard;
        const dWX = lbStartWX + (t > PRE ? Math.min(1, t / ARRIVE) * 18 : 0);
        const frame = t < PRE ? "idle" : (Math.floor(t * 9 + i + 4) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(dWX), y: lateralToScreenY(lbLats[i]), team: defTeam, frame, flipped: true, faceSeed: nameSeed("LB", i) });
      }
      // Corners on WRs
      for (const [lat, salt] of [[-20, 0], [18, 1]]) {
        const cbStartWX = losWX + 4 * CINEMA.pxPerYard;
        let cbX = cbStartWX + Math.min(1, t / ARRIVE) * targetDepth * CINEMA.pxPerYard * 0.82;
        let cbLat = lat;
        // If this CB is the interceptor (closest to recLat), they GRAB the ball
        const isInterceptor = isInt && Math.abs(lat - recLat) < 5;
        if (isInterceptor && t > ARRIVE - 0.05) {
          // Move toward the ball pickup point, then run back the other way
          if (t < ARRIVE) {
            cbX = targetWX_view - 18;
            cbLat = recLat + 2;
          } else {
            const tt = (t - ARRIVE) / (1 - ARRIVE);
            cbX = targetWX_view - 18 - tt * 80;
            cbLat = recLat + 2;
          }
        }
        const cbFrame = isInterceptor && catchWindow ? "catch" : (Math.floor(t * 10 + salt) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(cbX), y: lateralToScreenY(cbLat), team: defTeam, frame: cbFrame, flipped: !isInterceptor || t < ARRIVE, faceSeed: nameSeed("CB", salt) });
      }
      // Safeties (deep)
      for (let i = 0; i < 2; i++) {
        const sLat = i === 0 ? -9 : 9;
        const sStartWX = losWX + 12 * CINEMA.pxPerYard;
        const dWX = sStartWX + (t > PRE && isComplete && t > ARRIVE ? Math.min(1, t - ARRIVE) * (carrierWX - sStartWX) * 0.8 : 0);
        const frame = t < PRE ? "idle" : (Math.floor(t * 9 + i + 8) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(dWX), y: lateralToScreenY(sLat), team: defTeam, frame, flipped: true, faceSeed: nameSeed("S", i) });
      }

      drawSpriteList(ctx, sprites);

      // Ball indicator (not during freeze unless incomplete — then big football)
      if (!inFreeze) {
        // Shadow on field beneath ball
        const ballScreenX = worldToScreenX(ballWX);
        const ballGroundY = lateralToScreenY(ballLat);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath();
        ctx.ellipse(ballScreenX, ballGroundY, 5, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        // Ball
        ctx.fillStyle = "#8a4520";
        ctx.beginPath();
        ctx.ellipse(ballScreenX, ballGroundY - ballArc, 7, 4.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillRect(ballScreenX - 2, ballGroundY - ballArc - 1, 4, 1);
      } else if (isComplete) {
        const wrScreenX = worldToScreenX(carrierWX);
        const wrScreenY = lateralToScreenY(recLat);
        const popScale = 1 + Math.sin(freezePhase * Math.PI) * 0.45;
        const handY = wrScreenY - 50;
        drawBigFootball(ctx, wrScreenX + (isHighlight ? 30 : 0), handY, 26 * popScale);
        if (isHighlight) {
          const cScale = 0.85 + Math.sin(Math.min(1, freezePhase * 2.5) * Math.PI * 0.5) * 0.35;
          drawHeadCallout(ctx, wrScreenX, wrScreenY - 88, "CAUGHT!", "#f0cc30", cScale);
        } else if (freezePhase < 0.55) {
          drawHeadCallout(ctx, wrScreenX, wrScreenY - 80, "CATCH", "#9be09b", 0.75);
        }
      } else if (isInt) {
        // Ball secured by the DB — show big football at interceptor's hands + giant PICK! callout
        const interceptorLat = recLat + 2;
        const intX = worldToScreenX(targetWX_view - 18);
        const intY = lateralToScreenY(interceptorLat);
        const popScale = 1 + Math.sin(freezePhase * Math.PI) * 0.45;
        drawBigFootball(ctx, intX + 12, intY - 48, 26 * popScale);
        const cScale = 0.85 + Math.sin(Math.min(1, freezePhase * 2.5) * Math.PI * 0.5) * 0.4;
        drawHeadCallout(ctx, intX, intY - 92, "PICK!", "#e07070", cScale);
      }

      // TD fireworks — held until t > 0.94 so the fireworks start
      // after the WR has crossed the line (was 0.88).
      if (isTD && t > 0.94 && !inFreeze) {
        const ageMs = (t - 0.94) * totalDur;
        drawFireworksShow(ctx, ageMs);
      }
      // BIG PLAY taunt
      if (isComplete && !isTD && yardsGained >= 20 && t > ARRIVE + 0.18 && t < 0.96) {
        const tauntT = (t - (ARRIVE + 0.18)) / (0.96 - (ARRIVE + 0.18));
        drawTaunt(ctx, worldToScreenX(carrierWX), lateralToScreenY(recLat) - 70, pickTaunt(play, 1), "#f0cc30", tauntT);
      }

      // Move callouts on YAC
      if (isComplete && t > ARRIVE && !inFreeze) {
        const yacT = (t - ARRIVE) / (1 - ARRIVE);
        for (const m of moves) {
          const localAt = (m.at - ARRIVE) / (1 - ARRIVE);
          if (Math.abs(yacT - localAt) < 0.04) {
            if (!play._calloutsFired) play._calloutsFired = new Set();
            if (!play._calloutsFired.has(m.kind)) {
              play._calloutsFired.add(m.kind);
              showCallout(m.kind);
            }
          }
        }
      }
      if (tNew < 0.05 && play._calloutsFired) play._calloutsFired = null;
    }};
  }

  // ── SACK (top-down) ───────────────────────────────────────────────────
  if (play.kind === "sack") {
    const passerSeed = nameSeed(play.passer);
    return { duration: 1700, kind: "sack", render: (t, ctx) => {
      const qbWX = losWX - 5 * CINEMA.pxPerYard - Math.min(1, t * 1.5) * 60;
      setCamFromCarrier(qbWX);
      drawCinemaField(ctx, homeTeam, awayTeam, { losYard: startYardAbs, fdYard: fdYardAbs });

      const sprites = [];
      const olLats = [-4.5, -2.2, 0, 2.2, 4.5];
      for (let i = 0; i < 5; i++) {
        const olWX = losWX - 0.7 * CINEMA.pxPerYard - Math.min(t * 1.5, 0.7) * 25 + Math.sin(t * 6 + i) * 2;
        sprites.push({ x: worldToScreenX(olWX), y: lateralToScreenY(olLats[i]), team: offTeam, frame: "idle", flipped: false, faceSeed: nameSeed("OL", i) });
      }
      const qbFrame = t > 0.85 ? "tackled" : (t > 0.4 ? "stiff" : "run_b");
      sprites.push({ x: worldToScreenX(qbWX), y: lateralToScreenY(0.5), team: offTeam, frame: qbFrame, flipped: false, faceSeed: passerSeed });
      // Pass rusher (from edge, closes on QB)
      const rusherStart = losWX + 4 * CINEMA.pxPerYard;
      const rusherWX = rusherStart + (qbWX - rusherStart) * easeOutCubic(t);
      const rusherLat = 3 + (0.5 - 3) * easeOutCubic(t);
      const rFrame = t > 0.85 ? "tackled" : (Math.floor(t * 10) % 2 === 0 ? "run_a" : "run_b");
      sprites.push({ x: worldToScreenX(rusherWX), y: lateralToScreenY(rusherLat), team: defTeam, frame: rFrame, flipped: true, faceSeed: nameSeed("DL", 7) });
      // Other DL contributing pressure
      const dlLats = [-3.5, -1.2, 1.2];
      for (let i = 0; i < 3; i++) {
        const dWX = losWX + 0.8 * CINEMA.pxPerYard + Math.min(1, t * 1.3) * (qbWX - losWX) * 0.6;
        const frame = (Math.floor(t * 9 + i) % 2 === 0) ? "run_a" : "run_b";
        sprites.push({ x: worldToScreenX(dWX), y: lateralToScreenY(dlLats[i]), team: defTeam, frame, flipped: true, faceSeed: nameSeed("DL", i) });
      }
      drawSpriteList(ctx, sprites);
      // Show the pass-rush move callout BEFORE the sack lands (mid-rush)
      if (t > 0.55 && t < 0.85 && play.dlMove && !play._moveFired) {
        play._moveFired = true;
        showCallout(`💥 ${play.dlMove}!`);
      }
      if (t > 0.85 && !play._sackFired) {
        play._sackFired = true;
        showCallout("SACK!");
      }
      if (t < 0.05) { play._sackFired = false; play._moveFired = false; }
    }};
  }

  // ── FG / PUNT / FUMBLE / KICKOFF — top-down ───────────────────────────
  if (play.kind === "fg_good" || play.kind === "fg_miss") {
    const isGood = play.kind === "fg_good";
    const kickerSeed = nameSeed(play.kicker);
    // Determine miss type deterministically
    const missRoll = playSeed(play, 77);
    const missType = isGood ? "good" : (missRoll < 0.5 ? (missRoll < 0.25 ? "wide_l" : "wide_r") : "short");
    return { duration: 2600, kind: play.kind, render: (t, ctx) => {
      const holderWX = losWX - 7 * CINEMA.pxPerYard;
      const goalWX = yardToWorldX(110); // goalpost back of end zone
      let ballWX, ballArc = 0, ballLat = 0;
      if (t < 0.22) { ballWX = holderWX; }
      else {
        const tt = (t - 0.22) / 0.78;
        let reach = 1;
        if (missType === "wide_l") ballLat = -3.5 * Math.min(1, tt * 1.2);
        else if (missType === "wide_r") ballLat = 3.5 * Math.min(1, tt * 1.2);
        else if (missType === "short") { reach = 0.72; }
        // Good kicks OVERSHOOT the goalposts and stay elevated as they
        // cross, so the ball visibly clears the crossbar instead of
        // landing exactly at the post (which reads as a miss).
        if (missType === "good") {
          const overshoot = 4 * CINEMA.pxPerYard;
          ballWX = holderWX + (goalWX + overshoot - holderWX) * tt;
          ballArc = tt < 0.55
                  ? Math.sin(tt / 0.55 * Math.PI / 2) * 240
                  : 240 - (tt - 0.55) / 0.45 * (240 - 130);
        } else {
          ballWX = holderWX + (goalWX - holderWX) * tt * reach;
          ballArc = Math.sin(tt * Math.PI) * 200 * (missType === "short" ? 0.6 : 1);
        }
      }
      setCamFromCarrier((holderWX + goalWX) / 2);
      drawCinemaField(ctx, homeTeam, awayTeam, { losYard: startYardAbs });
      // Big top-down goalposts (drawn in screen coords past the goal line).
      // In broadcast cam the stadium goalposts are already drawn standing
      // up on the upright overlay; skip the flat H here to avoid doubling.
      if (cameraMode !== "broadcast") {
        drawTopDownGoalposts(ctx, worldToScreenX(goalWX), lateralToScreenY(0));
      }
      const sprites = [];
      sprites.push({ x: worldToScreenX(holderWX), y: lateralToScreenY(0), team: offTeam, frame: t > 0.3 ? "stiff" : "idle", flipped: false, faceSeed: kickerSeed });
      sprites.push({ x: worldToScreenX(holderWX - 25), y: lateralToScreenY(0.5), team: offTeam, frame: "tackled", flipped: false, faceSeed: nameSeed("Holder") });
      const lineLats = [-4, -2, 0, 2, 4];
      for (let i = 0; i < 5; i++) {
        sprites.push({ x: worldToScreenX(losWX - 0.7 * CINEMA.pxPerYard), y: lateralToScreenY(lineLats[i]), team: offTeam, frame: "idle", flipped: false, faceSeed: nameSeed("OL", i) });
      }
      const dLats = [-3, 0, 3];
      for (let i = 0; i < 3; i++) {
        sprites.push({ x: worldToScreenX(losWX + 1 * CINEMA.pxPerYard + Math.min(t, 0.4) * 20), y: lateralToScreenY(dLats[i]), team: defTeam, frame: t > 0.3 ? "leap" : "idle", flipped: true, faceSeed: nameSeed("DL", i) });
      }
      drawSpriteList(ctx, sprites);
      // Ball
      const bsX = worldToScreenX(ballWX);
      const bsY = lateralToScreenY(ballLat) - ballArc;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(bsX, lateralToScreenY(ballLat), 5, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8a4520";
      ctx.beginPath(); ctx.ellipse(bsX, bsY, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(bsX - 2, bsY - 1, 4, 1);
      // Result banner
      if (t > 0.82) {
        const banT = Math.min(1, (t - 0.82) / 0.18);
        ctx.save();
        ctx.globalAlpha = banT;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(0, 18, FIELD.W, 64);
        ctx.fillStyle = isGood ? "#f0cc30" : "#e07070";
        ctx.font = "900 44px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(isGood ? "IT'S GOOD!" : missType === "short" ? "NO GOOD — SHORT!" : missType === "wide_l" ? "NO GOOD — WIDE LEFT" : "NO GOOD — WIDE RIGHT", FIELD.W / 2, 50);
        ctx.restore();
        if (isGood && t > 0.92) {
          const ageMs = (t - 0.92) * 2600;
          drawFireworksShow(ctx, ageMs);
        }
      }
    }};
  }

  if (play.kind === "punt") {
    const punterSeed = nameSeed(play.kicker || play.passer);
    const returnerLat = (playSeed(play, 51) - 0.5) * 14;
    const landYardAbs = play.landYard ?? play.endYard ?? play.startYard;
    const landWX = yardToWorldX(landYardAbs);
    const returnYards = play.returnYards || 0;
    const isTouchback = !!play.isTouchback;
    const isFairCatch = !!play.isFairCatch;
    const isReturnTD  = !!play.isReturnTD;
    // The return goes BACK toward the punting team's end zone (away from landWX)
    const finalWX = yardToWorldX(play.endYard ?? landYardAbs);
    // Direction returner is running, normalized (-1 or +1 in world coords)
    const runSign = Math.sign(finalWX - landWX) || -1;
    // Scale duration with return yards so big returns have time to develop
    // Duration scales with actual return yards (no Math.min cap, was 70).
    // Multiplier 60 ms/yard tuned so a 100-yd return runs ~24 yps in
    // the return phase — NFL realistic, no teleport.
    const dur = isTouchback ? 2400
              : isFairCatch ? 2400
              : Math.round(3000 + returnYards * 60);
    return { duration: dur, kind: "punt", render: (t, ctx) => {
      const punterWX = losWX - 12 * CINEMA.pxPerYard;
      // Phases — return now gets ~46% of the animation (no more 28% teleport)
      const PHASE_AIR_START = 0.18;
      const PHASE_AIR_END   = 0.46;
      const PHASE_FIELD_END = 0.54;
      const RET_LEN = 1 - PHASE_FIELD_END;
      let ballWX, ballArc = 0, ballLat = 0;
      let carrierWX = landWX, carrierLat = returnerLat;
      let phase = "snap";
      if (t < PHASE_AIR_START) {
        ballWX = punterWX; phase = "snap";
      } else if (t < PHASE_AIR_END) {
        const tt = (t - PHASE_AIR_START) / (PHASE_AIR_END - PHASE_AIR_START);
        ballWX = punterWX + (landWX - punterWX) * tt;
        ballArc = Math.sin(tt * Math.PI) * 220;
        ballLat = returnerLat * tt;
        phase = "air";
      } else if (t < PHASE_FIELD_END) {
        ballWX = landWX; ballLat = returnerLat;
        phase = "field";
      } else {
        const tt = (t - PHASE_FIELD_END) / RET_LEN;
        if (isTouchback || isFairCatch) {
          ballWX = landWX; ballLat = returnerLat;
        } else {
          // Linear-with-mild-easeIn — no more easeOutCubic teleport.
          const eased = tt < 0.15
                      ? (tt * tt) / 0.30
                      : 0.075 + ((tt - 0.15) / 0.85) * 0.925;
          carrierWX = landWX + (finalWX - landWX) * eased;
          carrierLat = returnerLat + Math.sin(tt * 6) * 1.8;
          ballWX = carrierWX; ballLat = carrierLat;
        }
        phase = "return";
      }
      setCamFromCarrier(phase === "return" ? carrierWX : ballWX);
      drawCinemaField(ctx, homeTeam, awayTeam, { losYard: startYardAbs });

      const sprites = [];
      // Punter
      // Punter actually punts — kick pose during snap+wind+early air,
      // follow-through during air, stiff after the ball is gone.
      let pframe = "idle", pT = 0;
      if (t < 0.08)        { pframe = "idle";  pT = 0; }
      else if (t < 0.18)   { pframe = "kick";  pT = (t - 0.08) / 0.10 * 0.5; }
      else if (t < 0.30)   { pframe = "kick";  pT = 0.5 + (t - 0.18) / 0.12 * 0.5; }
      else                 { pframe = "stiff"; pT = 0; }
      sprites.push({ x: worldToScreenX(punterWX), y: lateralToScreenY(0), team: offTeam, frame: pframe, frameT: pT, flipped: false, faceSeed: punterSeed });
      // Punter's protection
      const lineLats = [-4, -2, 0, 2, 4];
      for (let i = 0; i < 5; i++) {
        sprites.push({ x: worldToScreenX(losWX - 0.7 * CINEMA.pxPerYard), y: lateralToScreenY(lineLats[i]), team: offTeam, frame: "idle", flipped: false, faceSeed: nameSeed("OL", i) });
      }
      // Gunners (coverage team) — sprint downfield. 3 will be picked up by
      // blockers, 1 stays free as the eventual tackler.
      const gunnerPositions = [];
      for (let i = 0; i < 4; i++) {
        const gStartWX = losWX + (i - 1.5) * 18;
        const isFree = (i === 3);
        let gWX, gLat;
        if (phase !== "return") {
          const gT = Math.min(1, t * 1.1);
          gWX = gStartWX + (landWX - gStartWX) * gT;
          gLat = (i - 1.5) * 6 + (returnerLat - ((i - 1.5) * 6)) * Math.min(1, t * 1.2) * 0.6;
        } else {
          const tt = (t - PHASE_FIELD_END) / RET_LEN;
          if (isFree) {
            // Free gunner closes on the returner — pursuit angle, arrives at end
            gWX = landWX + (carrierWX - landWX) * (0.35 + tt * 0.65);
            gLat = (i - 1.5) * 6 + (carrierLat - (i - 1.5) * 6) * Math.min(1, tt * 1.3);
          } else {
            // Engaged gunner — held by blocker, AHEAD of returner in run direction
            const aheadOffset = runSign * (22 - i * 3) * CINEMA.pxPerYard / 3;
            gWX = carrierWX + aheadOffset + Math.sin(tt * 5 + i) * 1.4;
            gLat = (i - 1.5) * 5 + (carrierLat - (i - 1.5) * 5) * 0.4;
          }
        }
        gunnerPositions.push({ wx: gWX, lat: gLat, isFree });
        const isEngagedG = phase === "return" && !isFree;
        const frame = isEngagedG ? "stiff" : ((Math.floor(t * 11 + i) % 2 === 0) ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(gWX), y: lateralToScreenY(gLat), team: offTeam, frame, flipped: isEngagedG, faceSeed: nameSeed("G", i) });
      }
      // Blockers for the returner — engaged with their assigned gunner during return
      const numBlockers = 3;
      for (let i = 0; i < numBlockers; i++) {
        const target = gunnerPositions[i];
        let bWX, bLat;
        if (phase === "snap" || phase === "air") {
          const angle = (i / numBlockers - 0.5);
          bWX = landWX + 14 + i * 6;
          bLat = returnerLat + angle * 8;
        } else if (phase === "field") {
          bWX = (target.wx + landWX) / 2;
          bLat = (target.lat + returnerLat) / 2;
        } else {
          // RETURN — glue to the gunner, on the returner side (visible engagement)
          bWX = target.wx - runSign * (CINEMA.pxPerYard * 0.6);
          bLat = target.lat + (carrierLat - target.lat) * 0.10;
        }
        const frame = (phase === "return" || phase === "field") ? "stiff" : "idle";
        sprites.push({ x: worldToScreenX(bWX), y: lateralToScreenY(bLat), team: defTeam, frame, flipped: false, faceSeed: nameSeed("Blocker", i) });
      }
      // Returner
      let returnerFrame;
      if (phase === "snap" || phase === "air") returnerFrame = "idle";
      else if (phase === "field") returnerFrame = "catch";
      else if (isReturnTD && t > 0.92) returnerFrame = "celebrate";
      else returnerFrame = (Math.floor(t * 11) % 2 === 0) ? "run_a" : "run_b";
      sprites.push({ x: worldToScreenX(carrierWX), y: lateralToScreenY(carrierLat), team: defTeam, frame: returnerFrame, flipped: true, faceSeed: nameSeed("Returner") });

      drawSpriteList(ctx, sprites);
      // Ball
      const bsX = worldToScreenX(ballWX);
      const bsY = lateralToScreenY(ballLat) - ballArc;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(bsX, lateralToScreenY(ballLat), 5, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8a4520";
      ctx.beginPath(); ctx.ellipse(bsX, bsY, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(bsX - 2, bsY - 1, 4, 1);

      // Callouts
      if (phase === "field" && !play._catchFired) {
        play._catchFired = true;
        if (isTouchback) showCallout("TOUCHBACK");
        else if (isFairCatch) showCallout("FAIR CATCH");
        else showCallout("FIELDED!");
      }
      // Big-return / house-call held until t > 0.92 so the call lands
      // on the actual return outcome, not 85% into the runback.
      if (phase === "return" && returnYards >= 20 && t > 0.92 && !play._bigRetFired) {
        play._bigRetFired = true;
        showCallout(returnYards >= 40 ? "TAKE IT TO THE HOUSE!" : "BIG RETURN!");
      }
      if (isReturnTD && t > 0.94) {
        const ageMs = (t - 0.94) * dur;
        drawFireworksShow(ctx, ageMs);
      }
      if (t < 0.05) { play._catchFired = false; play._bigRetFired = false; }
    }};
  }

  if (play.kind === "kickoff") {
    return { duration: 1800, kind: "kickoff", render: (t, ctx) => {
      const kickerWX = yardToWorldX(35);
      const landWX = yardToWorldX(75);
      const ballWX = kickerWX + (landWX - kickerWX) * t;
      const arc = Math.sin(t * Math.PI) * 220;
      setCamFromCarrier(ballWX);
      drawCinemaField(ctx, homeTeam, awayTeam, null);
      drawSprite(ctx, worldToScreenX(kickerWX), lateralToScreenY(0), awayTeam, t > 0.2 ? "stiff" : "idle", false, false, nameSeed("Kicker"));
      const bsX = worldToScreenX(ballWX);
      const bsY = lateralToScreenY(0) - arc;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(bsX, lateralToScreenY(0), 5, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8a4520";
      ctx.beginPath(); ctx.ellipse(bsX, bsY, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
    }};
  }

  if (play.kind === "fumble") {
    const rusherSeed = nameSeed(play.rusher);
    return { duration: 1900, kind: "fumble", render: (t, ctx) => {
      setCamFromCarrier(losWX);
      drawCinemaField(ctx, homeTeam, awayTeam, { losYard: startYardAbs });
      // Ball bounces around wildly
      const wobX = losWX + 30 + Math.sin(t * 18) * 26;
      const wobLat = Math.cos(t * 12) * 4;
      const bsX = worldToScreenX(wobX);
      const bsY = lateralToScreenY(wobLat) - Math.abs(Math.sin(t * 12)) * 22;
      const sprites = [];
      // Fumbling player (collapsed)
      sprites.push({ x: worldToScreenX(losWX), y: lateralToScreenY(0), team: offTeam, frame: "tackled", flipped: false, faceSeed: rusherSeed });
      // Defenders piling in
      for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI / 2;
        const dWX = losWX + Math.cos(angle) * 40 * (1 - t * 0.8);
        const dLat = Math.sin(angle) * 5 * (1 - t * 0.8);
        const frame = t > 0.6 ? "tackled" : (Math.floor(t * 12 + i) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(dWX), y: lateralToScreenY(dLat), team: defTeam, frame, flipped: true, faceSeed: nameSeed("D", i) });
      }
      drawSpriteList(ctx, sprites);
      // Bouncing ball
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(bsX, lateralToScreenY(wobLat), 5, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8a4520";
      ctx.beginPath(); ctx.ellipse(bsX, bsY, 8, 5, Math.sin(t * 8), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(bsX - 2, bsY - 1, 4, 1);
      // Giant FUMBLE! callout
      if (t > 0.25) {
        const cT = Math.min(1, (t - 0.25) / 0.2);
        const cScale = 0.7 + cT * 0.6;
        ctx.save();
        ctx.globalAlpha = cT;
        drawHeadCallout(ctx, FIELD.W / 2, 70, "FUMBLE!", "#e07070", cScale);
        ctx.restore();
      }
      if (t > 0.6 && !play._fumbleFired) {
        play._fumbleFired = true;
        showCallout("RECOVERED!");
      }
      if (t < 0.05) play._fumbleFired = false;
    }};
  }

  // Fallback: scoreboard hold
  return { duration: 600, kind: play.kind, render: (t, ctx) => {
    drawCinemaField(ctx, homeTeam, awayTeam, null);
  }};
}

// ═══════════════════════════════════════════════════════════════════════════
// Play-result digest card — big banner that holds for ~1.4s after each play
// ═══════════════════════════════════════════════════════════════════════════
const RESULT_HOLD_MS = 2700;

// "Tom Brady" → "BRADY" (last token, uppercased).
function lastNameUpper(name) {
  if (!name) return "";
  const parts = String(name).trim().split(/\s+/);
  return parts[parts.length - 1].toUpperCase();
}

function formatPlayResult(play) {
  if (!play) return null;
  const yards = play.yards ?? 0;
  const passer = lastNameUpper(play.passer);
  const rusher = lastNameUpper(play.rusher);
  const rcvr   = lastNameUpper(play.receiver);
  const kicker = lastNameUpper(play.kicker);
  const intended = lastNameUpper(play.intended);
  switch (play.kind) {
    case "run": {
      const isTD = (play.endYard ?? 0) >= 100;
      const isFirstDown = !isTD && play.down > 0 && yards >= (play.ytg ?? 0);
      const verb = play.isScramble ? "scrambles" : play.isQBRun ? "keeps it" : "runs";
      const noun = play.isScramble ? "SCRAMBLE" : play.isQBRun ? "QB KEEPER" : "RUN";
      const carryLabel = play.isScramble ? "Scramble" : play.isQBRun ? "Keeper" : "Carry";
      if (isTD) {
        const tdSub = play.isScramble ? `${yards}-yard scramble by ${rusher}`
                   : play.isQBRun     ? `${yards}-yard QB keeper from ${rusher}`
                   :                    `${yards} yards on the ground from ${rusher}`;
        return { title: "TOUCHDOWN!", sub: tdSub, color: "#f0cc30", big: true };
      }
      if (yards < 0)   return { title: "TACKLE FOR LOSS", sub: `${rusher} stopped for ${yards}`, color: "#e07070" };
      if (yards === 0) return { title: "NO GAIN", sub: `${rusher} stuffed at the line`, color: "#cccccc" };
      if (isFirstDown) return { title: "FIRST DOWN", sub: `${yards}-yard ${verb} by ${rusher}`, color: "#9be09b" };
      return { title: `${yards}-YARD ${noun}`, sub: `${carryLabel} by ${rusher}`, color: "#ffffff" };
    }
    case "complete": {
      const isTD = (play.endYard ?? 0) >= 100;
      const isFirstDown = !isTD && play.down > 0 && yards >= (play.ytg ?? 0);
      if (isTD)        return { title: "TOUCHDOWN!", sub: `${yards} yards from ${passer} to ${rcvr}`, color: "#f0cc30", big: true };
      if (yards >= 25) return { title: "BIG PLAY!", sub: `${yards} yards from ${passer} to ${rcvr}`, color: "#9be09b", big: true };
      if (isFirstDown) return { title: "FIRST DOWN", sub: `${yards} yards from ${passer} to ${rcvr}`, color: "#9be09b" };
      return { title: `COMPLETE +${yards}`, sub: `${passer} to ${rcvr}`, color: "#ffffff" };
    }
    case "incomplete": {
      if (play.isDrop) {
        return { title: "DROP!", sub: intended ? `${intended} can't hang on` : `Receiver drops it`, color: "#e07070" };
      }
      // PASS BREAKUP — a defender knocked the ball away. The engine
      // emits incReason "pd" with play.defender (the DB) or "batted"
      // with play.defender (the DL at the LOS). Both deserve a distinct
      // call-out that NAMES the defender — otherwise the breakup reads
      // as a generic incompletion and the swat goes unnoticed. (This was
      // the whole "I've never seen a deflection" report: the animation
      // ran the swat but the banner never said one happened.)
      const breakupBy = lastNameUpper(play.defender);
      if (play.incReason === "pd") {
        return {
          title: "BROKEN UP!",
          sub: breakupBy
            ? (intended ? `${breakupBy} breaks up the pass to ${intended}` : `${breakupBy} knocks it away`)
            : (intended ? `Pass to ${intended} broken up` : `Pass broken up`),
          color: "#7fb8ff",
        };
      }
      // Use the specific incomplete reason for the banner sub-text so
      // the viewer knows WHAT happened, not just that the pass was
      // incomplete. Maps incReason → human-readable phrase.
      const reasonMap = {
        overthrown:  intended ? `${passer} overthrows ${intended}`       : `Pass sails high`,
        underthrown: intended ? `${passer} throws short of ${intended}`   : `Pass falls short`,
        throwaway:   `${passer} throws it away — out of bounds`,
        batted:      breakupBy ? `Batted down at the line by ${breakupBy}` : `Batted down at the line`,
        offtarget:   intended ? `${passer} off-target to ${intended}`     : `Pass off-target`,
      };
      const sub = reasonMap[play.incReason]
        || (intended ? `${passer} pass to ${intended} hits the turf`
                     : `${passer} pass hits the turf`);
      return { title: "INCOMPLETE", sub, color: "#cccccc" };
    }
    case "int":
      return { title: "INTERCEPTION!", sub: `${passer} picked off — turnover`, color: "#e07070", big: true };
    case "sack": {
      // Name the CREDITED sacker (motion.sackerName — the LB on a blitz,
      // else the DL). play.dlName is only the beaten OL's man, which on a
      // blitz is a different player than who got the sack: the chyron used
      // to name the DL while the box credited the LB. One source of truth.
      const sackerName = lastNameUpper((play.motion && play.motion.sackerName) || play.dlName);
      const move = play.dlMove;
      const sub = sackerName && move
        ? `${sackerName} with the ${move} — ${passer} dropped for −${play.sackLoss ?? 0}`
        : `${passer} dropped for −${play.sackLoss ?? 0} in the backfield`;
      return { title: "SACK!", sub, color: "#e07070" };
    }
    case "fumble":
      return { title: "FUMBLE!", sub: rusher ? `${rusher} cough it up — defense recovers` : "Defense recovers the loose ball", color: "#e07070", big: true };
    case "fg_good":
      return { title: "FIELD GOAL!", sub: `${kicker} drills it from ${play.fgDist}`, color: "#f0cc30" };
    case "fg_miss":
      return { title: "NO GOOD", sub: `${kicker} misses from ${play.fgDist}`, color: "#e07070" };
    case "punt": {
      if (play.isReturnTD)   return { title: "RETURNED FOR SIX!", sub: `${play.returnYards}-yard punt return TD`, color: "#f0cc30", big: true };
      if (play.isTouchback)  return { title: "PUNT", sub: `${play.puntYards}-yard punt — touchback`, color: "#cccccc" };
      if (play.isFairCatch)  return { title: "PUNT", sub: `${play.puntYards}-yard punt — fair catch`, color: "#cccccc" };
      if ((play.returnYards ?? 0) >= 20) return { title: `${play.returnYards}-YD RETURN!`, sub: `${play.puntYards}-yard punt, brought back ${play.returnYards}`, color: "#9be09b", big: true };
      const rty = play.returnYards ?? 0;
      return { title: "PUNT", sub: rty > 0 ? `${play.puntYards}-yard punt, returned ${rty}` : `${play.puntYards}-yard punt — change of possession`, color: "#cccccc" };
    }
    case "score": {
      const d = (play.desc || "").toLowerCase();
      if (d.includes("touchdown")) return null;
      if (d.includes("fg")) return null;
      if (d.includes("extra point")) return { title: "EXTRA POINT  ✓", sub: "Good — +1", color: "#9be09b" };
      if (d.includes("2-point")) return { title: "2-PT CONVERSION!", sub: "Good — +2", color: "#f0cc30" };
      return null;
    }
    case "kickoff":
    case "halftime":
    case "quarter":
    case "ot":
    case "two_min_warning":
    case "timeout":
      return null;
    default: return null;
  }
}

// Celebration overlay — animates the scoring player + a portrait popup
function drawCelebrationOverlay(ctx, play, celebrate, holdT) {
  if (!celebrate || viewMode !== "cinema") return;
  const celeb = CELEBRATIONS[celebrate.celebKey];
  if (!celeb) return;
  // Pick the player who deserves the celebration
  const heroName = play.receiver || play.rusher || play.kicker || play.passer || "STAR";
  const offTeam = play.poss === "home" ? gameResult.homeTeam : gameResult.awayTeam;
  const faceSeed = nameSeed(heroName);
  // Cycle through celebration frames
  const cycleT = (holdT * 2) % 1;
  const frameKey = getCelebFrame(celebrate.celebKey, cycleT);
  // Find a good on-field anchor: end zone for TDs, end-yard for big plays
  const isTD = celebrate.kind === "TD";
  const endYardAbs = play.endYard ?? play.startYard ?? 50;
  const heroYard = isTD ? (play.poss === "home" ? 100 : 0) : endYardAbs;
  const heroWX  = yardToWorldX(heroYard);
  const heroLat = 0;
  // Pan camera to the celebration (only do this if we still want to update cam)
  if (isTD) cinemaCamX = heroWX - 60;
  // Re-render field beneath the celebration so we can frame it freshly
  drawCinemaField(ctx, gameResult.homeTeam, gameResult.awayTeam, null);
  // Subtle vignette
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(0, 0, FIELD.W, FIELD.H);
  // Confetti / sparkle field for TDs (drifts down across the field)
  if (isTD) {
    const ageMs = holdT * 2400;
    drawFireworksShow(ctx, ageMs);
    drawConfettiRain(ctx, holdT, offTeam);
  }
  // The hero, jumping / fist-pumping, with a small bobbing motion
  const bob = Math.sin(holdT * Math.PI * 6) * 4;
  const heroX = worldToScreenX(heroWX);
  const heroY = lateralToScreenY(heroLat) + bob;
  drawSprite(ctx, heroX, heroY, offTeam, frameKey, false, false, faceSeed);
  // A few teammates around them, also fist-pumping
  const buddies = [
    { dx: -50, dy: -28, frame: "fist_a" },
    { dx:  60, dy: -22, frame: "fist_b" },
    { dx: -80, dy:  18, frame: "celebrate" },
    { dx:  90, dy:  22, frame: "fist_a" },
  ];
  for (let i = 0; i < buddies.length; i++) {
    const b = buddies[i];
    const bx = heroX + b.dx + Math.sin(holdT * Math.PI * 4 + i) * 3;
    const by = heroY + b.dy + Math.cos(holdT * Math.PI * 5 + i * 1.3) * 3;
    const f = (holdT * 2 + i * 0.4) % 1 < 0.5 ? "fist_a" : "fist_b";
    drawSprite(ctx, bx, by, offTeam, f, i % 2 === 1, false, nameSeed("Buddy", i));
  }
  // Portrait popup (slides in/out)
  if (holdT > 0.05 && holdT < 0.95) {
    const popT = (holdT - 0.05) / 0.90;
    const side = (nameSeed(heroName, 1) > 0.5) ? "right" : "left";
    const shout = pickShout(celebrate.celebKey, play, 0);
    drawPortraitPopup(ctx, popT, side, offTeam, faceSeed, heroName, shout);
  }
  // Rising celebration text near the hero
  if (holdT > 0.1 && holdT < 0.7) {
    const taunt = pickTaunt(play, 9);
    const tT = (holdT - 0.1) / 0.6;
    drawTaunt(ctx, heroX, heroY - 80, taunt, "#f0cc30", tT);
  }
}

// Confetti falling across the field — colored by the scoring team
function drawConfettiRain(ctx, holdT, team) {
  const colors = [team.primary, team.secondary, "#f0cc30", "#ffffff", "#e07070"];
  const N = 60;
  const fallH = FIELD.H + 80;
  for (let i = 0; i < N; i++) {
    const seed = i * 37;
    const startX = ((seed * 89) % FIELD.W) + Math.sin(holdT * 2 + i) * 12;
    const delay = ((seed * 13) % 1000) / 1000;
    const localT = (holdT * 1.4 - delay) % 1;
    if (localT < 0) continue;
    const y = -10 + localT * fallH;
    const color = colors[(seed) % colors.length];
    ctx.save();
    ctx.translate(startX, y);
    ctx.rotate((holdT * 8 + i) * 0.5);
    ctx.fillStyle = color;
    ctx.fillRect(-3, -1.5, 6, 3);
    ctx.restore();
  }
}

function drawResultCard(ctx, play, holdT) {
  const result = formatPlayResult(play);
  if (!result) return;
  // Broadcast cam: route the banner to the flat upright overlay so it
  // doesn't get perspective-warped with the tilted field plane. Anchored
  // to the "sky" zone above the field tilt so the action below stays
  // unobstructed.
  const isBroadcast = (typeof cameraMode !== "undefined" && cameraMode === "broadcast"
                       && typeof _uprightCtx !== "undefined" && _uprightCtx);
  if (isBroadcast) ctx = _uprightCtx;
  // Card delayed so the post-play scene is visible for ~600ms before the
  // banner overlays. User feedback: "animation ends abruptly" — old code
  // popped the card at holdT*5 (full opacity by ~280ms), which cut the
  // post-tackle moment off. Now holds the action frame alone for 30% of
  // the hold window, then fades the card in.
  // Settle beat after the tackle. User: "it ends as soon as theyre on
  // the ground." Previously card started fading in at 30% of hold (~630
  // ms in) — right when the ragdoll completed. Pushed to 45% (~1215 ms
  // in) so there's a real "tackle complete, scrum on the ground" beat
  // of about a full second before the card overlays.
  const fadeIn = Math.max(0, Math.min(1, (holdT - 0.45) / 0.18));
  const fadeOut = holdT > 0.88 ? Math.max(0, 1 - (holdT - 0.88) / 0.12) : 1;
  const opacity = fadeIn * fadeOut;
  const slideY = (1 - fadeIn) * -24;

  const titleSize = result.big ? 52 : 38;
  const subSize = 18;
  const padX = 36;
  ctx.save();
  ctx.font = `900 ${titleSize}px sans-serif`;
  const titleW = ctx.measureText(result.title).width;
  ctx.font = `600 ${subSize}px sans-serif`;
  const subW = result.sub ? ctx.measureText(result.sub).width : 0;
  const bannerW = Math.max(titleW, subW) + padX * 2;
  const bannerH = result.sub ? titleSize + subSize + 28 : titleSize + 24;
  const bannerX = (FIELD.W - bannerW) / 2;
  // Broadcast: sit between the LED ad ribbon and the tilted field plane
  // (the perspective "sky" zone). Out of the action, never clipped by
  // the scrubber chrome at the bottom of the wrap.
  const bannerY = isBroadcast
    ? 32 + slideY
    : 34 + slideY;

  ctx.globalAlpha = opacity;
  // Backdrop
  ctx.fillStyle = "rgba(8, 12, 18, 0.90)";
  roundedRect(ctx, bannerX, bannerY, bannerW, bannerH, 8);
  ctx.fill();
  // Left accent bar
  ctx.fillStyle = result.color;
  ctx.fillRect(bannerX, bannerY, 6, bannerH);
  // Border / glow for big plays
  if (result.big) {
    ctx.shadowColor = result.color;
    ctx.shadowBlur = 22;
    ctx.strokeStyle = result.color;
    ctx.lineWidth = 2.5;
    roundedRect(ctx, bannerX + 1.5, bannerY + 1.5, bannerW - 3, bannerH - 3, 8);
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else {
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1;
    roundedRect(ctx, bannerX + 0.5, bannerY + 0.5, bannerW - 1, bannerH - 1, 8);
    ctx.stroke();
  }
  // Title
  ctx.fillStyle = result.color;
  ctx.font = `900 ${titleSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const titleCenterY = result.sub ? bannerY + 14 + titleSize / 2 : bannerY + bannerH / 2;
  ctx.fillText(result.title, bannerX + bannerW / 2, titleCenterY);
  // Subtitle
  if (result.sub) {
    ctx.fillStyle = "#e8eaef";
    ctx.font = `600 ${subSize}px sans-serif`;
    ctx.fillText(result.sub, bannerX + bannerW / 2, bannerY + bannerH - subSize / 2 - 10);
  }
  ctx.restore();
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ═══════════════════════════════════════════════════════════════════════════
// View toggle wiring
// ═══════════════════════════════════════════════════════════════════════════
let viewMode = "tactical"; // 'tactical' | 'cinema'

// Broadcast camera — field canvas gets CSS perspective + rotateX; a
// parallel upright overlay canvas (#field-uprights) draws player sprites
// at projected positions so they stay billboarded (upright) rather than
// foreshortened with the field plane.
let cameraMode = "broadcast"; // 'topdown' | 'broadcast' — broadcast is the default for that "watching it on TV" feel
let _uprightCtx = null;      // set per frame by _frameStartBroadcast()
let _spriteQueue = [];        // deferred sprite draws (player/ball) for depth sort
const BROADCAST_TILT_DEG = 38;
const BROADCAST_PERSPECTIVE_PX = 1100;

// Called by the tick loop before each render(). Clears the upright
// overlay canvas and sets _uprightCtx so drawPlayer/drawBall route
// there in broadcast mode.
function _frameStartBroadcast() {
  if (cameraMode !== "broadcast") {
    _uprightCtx = null;
    _spriteQueue.length = 0;
    return;
  }
  const upr = document.getElementById("field-uprights");
  if (!upr) { _uprightCtx = null; return; }
  _uprightCtx = upr.getContext("2d");
  _uprightCtx.clearRect(0, 0, upr.width, upr.height);
  // Stadium goalposts at both end zones — drawn behind sprites so a
  // player crossing in front of one occludes it correctly.
  try { drawStadiumGoalposts(_uprightCtx); } catch (e) { /* defensive */ }
  _spriteQueue.length = 0;
  // Phase 3.2 — bump the PIXI player frame marker so sprites not
  // refreshed by drawPlayer this frame get hidden at frame end.
  if (typeof GCPlayer !== "undefined") GCPlayer.frameStart();
}

// Y-shaped stadium goalposts at the back of each end zone, drawn on the
// flat upright overlay so they stand UP in broadcast cam (canvas2D #field
// is CSS rotateX'd which would lay an H flat against the ground).
function drawStadiumGoalposts(ctx) {
  if (!ctx || cameraMode !== "broadcast") return;
  const yMid = (FIELD.TOP + FIELD.BOT) / 2;
  // JUST OUTSIDE the back end line of each end zone, like the NFL (the posts
  // stand on the end line at the very back, not inside the field of play).
  // The end zone spans 0..EZ_PX from the edge, so x=0 is the back line; a
  // small NEGATIVE inset (-8px ≈ 0.5yd behind) sets the base just outside it.
  _drawOneGoalpost(ctx, -8, yMid);
  _drawOneGoalpost(ctx, FIELD.W + 8, yMid);
}
function _drawOneGoalpost(ctx, fieldX, fieldYMid) {
  const PXY = 15; // FIELD.PX_PER_YARD
  const halfLat = 3 * PXY;  // crossbar half-width: ~3yd from center each side
  const baseC = projectBroadcast(fieldX, fieldYMid);
  const baseL = projectBroadcast(fieldX, fieldYMid - halfLat);
  const baseR = projectBroadcast(fieldX, fieldYMid + halfLat);
  if (!baseC || baseC.scale <= 0) return;
  const s = baseC.scale;
  const sinθ = Math.sin(BROADCAST_TILT_DEG * Math.PI / 180);
  // Vertical pixel heights for crossbar + uprights at this perspective scale.
  // 3yd crossbar height, 12yd upright extension above the crossbar.
  const crossbarH = 3 * PXY * sinθ * s;
  const uprightH  = 12 * PXY * sinθ * s;
  const crossbarL_y = baseL.y - crossbarH;
  const crossbarR_y = baseR.y - crossbarH;
  const crossbarC_y = baseC.y - crossbarH;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Thin dark stroke first (silhouette / depth), then yellow on top.
  const drawStrokes = (color, widthMul) => {
    ctx.strokeStyle = color;
    // Support pole
    ctx.lineWidth = Math.max(2, 4.5 * s * widthMul);
    ctx.beginPath();
    ctx.moveTo(baseC.x, baseC.y);
    ctx.lineTo(baseC.x, crossbarC_y);
    ctx.stroke();
    // Crossbar
    ctx.lineWidth = Math.max(2, 3.8 * s * widthMul);
    ctx.beginPath();
    ctx.moveTo(baseL.x, crossbarL_y);
    ctx.lineTo(baseR.x, crossbarR_y);
    ctx.stroke();
    // Two vertical uprights
    ctx.beginPath();
    ctx.moveTo(baseL.x, crossbarL_y);
    ctx.lineTo(baseL.x, crossbarL_y - uprightH);
    ctx.moveTo(baseR.x, crossbarR_y);
    ctx.lineTo(baseR.x, crossbarR_y - uprightH);
    ctx.stroke();
  };
  drawStrokes("rgba(0,0,0,0.55)", 1.45);
  drawStrokes("#ffe048", 1.0);
  // Small flag/wind sock at the top of each upright (visual flourish that
  // makes the posts read as part of a real stadium, not a wireframe).
  ctx.fillStyle = "#ff7a3a";
  const flagH = Math.max(4, 8 * s);
  const flagW = Math.max(6, 12 * s);
  ctx.fillRect(baseL.x, crossbarL_y - uprightH - flagH, flagW, flagH);
  ctx.fillRect(baseR.x - flagW, crossbarR_y - uprightH - flagH, flagW, flagH);
  ctx.restore();
}

// Called by the tick loop after render(). Sorts queued sprite draws
// by depth (smaller projected Y = further away = drawn first) so
// closer players occlude farther ones on pile-ups.
function _frameEndBroadcast() {
  if (cameraMode === "broadcast" && _uprightCtx && _spriteQueue.length) {
    _spriteQueue.sort((a, b) => a.screenY - b.screenY);
    for (const item of _spriteQueue) {
      try { item.run(); } catch (e) { console.error("sprite flush err", e); }
    }
  }
  _spriteQueue.length = 0;
  // Phase 3.2 — flush PIXI player layer: hide stale sprites + render
  // the WebGL stage. Runs even when canvas2D _spriteQueue is empty
  // (which happens when ALL players route to PIXI).
  if (typeof GCPlayer !== "undefined") GCPlayer.frameEnd();
}

function setCameraMode(mode) {
  cameraMode = (mode === "broadcast") ? "broadcast" : "topdown";
  _bcastGeom = null;   // wrap dimensions change with the broadcast-cam class
  // Apply / remove the perspective transform on the field-wrap
  const wrap = document.querySelector(".bspnlive-field-wrap")
            || document.querySelector(".field-wrap")
            || document.getElementById("field")?.parentElement;
  const canvas = document.getElementById("field");
  const canvasPixi = document.getElementById("field-pixi");
  if (cameraMode === "broadcast") {
    if (wrap) {
      wrap.classList.add("broadcast-cam");
      wrap.style.perspective = BROADCAST_PERSPECTIVE_PX + "px";
      wrap.style.perspectiveOrigin = "50% 80%";
    }
    if (canvas) {
      // Scale Y to keep the rotated field filling vertical space the same.
      // rotateX(38°) compresses the projected height by ~cos(38°) ≈ 0.79;
      // counter-scale ~1.27 brings it back to original visual height.
      canvas.style.transform = `rotateX(${BROADCAST_TILT_DEG}deg) scaleY(${1 / Math.cos(BROADCAST_TILT_DEG * Math.PI / 180)})`;
      canvas.style.transformOrigin = "50% 100%";
    }
    if (canvasPixi) {
      // PIXI field canvas tracks #field's transform exactly so it stays
      // aligned with the canvas2D layer above it.
      canvasPixi.style.transform = `rotateX(${BROADCAST_TILT_DEG}deg) scaleY(${1 / Math.cos(BROADCAST_TILT_DEG * Math.PI / 180)})`;
      canvasPixi.style.transformOrigin = "50% 100%";
    }
  } else {
    if (wrap) {
      wrap.classList.remove("broadcast-cam");
      wrap.style.perspective = "";
      wrap.style.perspectiveOrigin = "";
    }
    if (canvas) {
      canvas.style.transform = "";
      canvas.style.transformOrigin = "";
    }
    if (canvasPixi) {
      canvasPixi.style.transform = "";
      canvasPixi.style.transformOrigin = "";
    }
  }
  // GCPlayer PIXI overlay is only refreshed in broadcast cam (no
  // frameStart/frameEnd in topdown). Stale sprites from a prior
  // broadcast session would otherwise stay visible as ghost players
  // on top of the canvas2D topdown rendering. Toggle display so the
  // overlay only shows when broadcast is actively rendering it.
  const pixiPlayer = document.querySelector("canvas.gc-player-pixi");
  if (pixiPlayer) {
    pixiPlayer.style.display = (cameraMode === "broadcast") ? "" : "none";
  }
  // Stadium-wall FX (LED ad ribbon, light beams, vignette) only belong in
  // broadcast cam — in top-down they floated as a stray strip over the
  // field. Apply immediately so toggling while paused updates at once.
  if (typeof GCFx !== "undefined" && GCFx.setStadiumChrome) {
    GCFx.setStadiumChrome(cameraMode === "broadcast");
  }
  // Update the button states (if those buttons exist on the page yet)
  const tdBtn = document.getElementById("camTopdownBtn");
  const bdBtn = document.getElementById("camBroadcastBtn");
  if (tdBtn) tdBtn.classList.toggle("active", cameraMode === "topdown");
  if (bdBtn) bdBtn.classList.toggle("active", cameraMode === "broadcast");
  // Repaint
  if (typeof renderBSPNLive === "function") renderBSPNLive();
}

// Cached wrap/field geometry for projectBroadcast — rebuilt on camera mode
// change and window resize.
let _bcastGeom = null;
function _updateBroadcastGeom() {
  const wrap = document.querySelector(".bspnlive-field-wrap");
  if (!wrap) { _bcastGeom = null; return; }
  const cs = getComputedStyle(wrap);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const wrapW = wrap.clientWidth;
  const wrapH = wrap.clientHeight;
  // Field's CSS width = wrap content width (assumes symmetric horizontal padding).
  // Height comes from the canvas aspect ratio (FIELD.H / FIELD.W) because the
  // canvas CSS rule is width:100%; height:auto.
  const fieldW = Math.max(1, wrapW - 2 * padL);
  const fieldH = fieldW * (FIELD.H / FIELD.W);
  const θ = BROADCAST_TILT_DEG * Math.PI / 180;
  _bcastGeom = {
    wrapW, wrapH, padL, padT, fieldW, fieldH,
    ox: padL + fieldW / 2,   // #field transformOrigin x in wrap CSS
    oy: padT + fieldH,        // #field transformOrigin y in wrap CSS (50%, 100%)
    cosθ: Math.cos(θ),
    sinθ: Math.sin(θ),
    sY: 1 / Math.cos(θ),
    P: BROADCAST_PERSPECTIVE_PX,
    Px: wrapW / 2,            // perspective-origin x (50%)
    Py: wrapH * 0.8,          // perspective-origin y (80%)
  };
}
if (typeof window !== "undefined") {
  window.addEventListener("resize", () => { _bcastGeom = null; });
}

// Project a canvas-space (x, y) point through the broadcast camera's
// perspective+rotateX+scaleY transform to get the equivalent upright-canvas
// internal (x, y) and the perspective scale. Replicates the full CSS pipeline
// applied to #field (scaleY then rotateX, origin 50% 100%) and to the wrap
// (perspective P, origin 50% 80%), then maps the screen-space result back
// into the upright canvas's internal coords (since the upright canvas spans
// the full wrap padding box via inset:0).
function projectBroadcast(x, y) {
  if (cameraMode !== "broadcast") return { x, y, scale: 1 };
  if (!_bcastGeom) _updateBroadcastGeom();
  if (!_bcastGeom) return { x, y, scale: 1 };
  const g = _bcastGeom;

  // Canvas-internal → #field pre-transform CSS coords (within wrap)
  const Cx = g.padL + (x / FIELD.W) * g.fieldW;
  const Cy = g.padT + (y / FIELD.H) * g.fieldH;

  // Distance from #field transformOrigin (50%, 100%)
  const dx = Cx - g.ox;
  const dy = Cy - g.oy;       // <= 0 for points above the bottom-center origin

  // Apply scaleY(1/cosθ) then rotateX(θ).
  // For (x, y, 0) after rotateX(θ) the rotation matrix gives:
  //   y' = y*cosθ  ;  z' = y*sinθ
  // Pre-scaled by sY, so y becomes dy*sY (more negative above origin).
  const sdy = dy * g.sY;
  const y3d = sdy * g.cosθ;
  const z3d = sdy * g.sinθ;    // negative for above-origin → further from viewer

  // Wrap CSS coords + depth after transform
  const fx = g.ox + dx;
  const fy = g.oy + y3d;
  const fz = z3d;

  // Wrap perspective (P=1100, origin 50% 80%). fz < 0 → scale < 1.
  const persScale = g.P / (g.P - fz);
  const screenX = g.Px + (fx - g.Px) * persScale;
  const screenY = g.Py + (fy - g.Py) * persScale;

  // Wrap CSS → upright canvas internal coords. Upright canvas covers the
  // wrap's padding box (clientW × clientH) via inset:0, so:
  const uX = screenX * (FIELD.W / g.wrapW);
  const uY = screenY * (FIELD.H / g.wrapH);

  return { x: uX, y: uY, scale: persScale };
}

function setViewMode(mode) {
  viewMode = mode;
  document.getElementById("viewTacticalBtn").classList.toggle("active", mode === "tactical");
  document.getElementById("viewCinemaBtn").classList.toggle("active", mode === "cinema");
  clearCallout();
  // Rebuild the current play with the new view, restarting from t=0.
  if (gameResult && playHead > 0 && playHead <= gameResult.plays.length) {
    const play = gameResult.plays[playHead - 1];
    const builder = mode === "cinema" ? buildCinemaAnim : buildAnimForPlay;
    const anim = builder(play, null);
    animState = { play, anim, startTime: performance.now(), duration: anim.duration / speedMul };
    if (!playing) {
      // Render one frame so user sees the new view immediately
      const ctx = $("field").getContext("2d");
      anim.render(0, ctx);
    }
  } else if (gameResult) {
    // Pre-game: redraw whatever field
    const ctx = $("field").getContext("2d");
    if (mode === "cinema") {
      cinemaCamX = yardToWorldX(50);
      drawCinemaField(ctx, gameResult.homeTeam, gameResult.awayTeam, null);
    } else {
      drawField(ctx, gameResult.homeTeam, gameResult.awayTeam, null);
    }
  }
}

document.getElementById("viewTacticalBtn")?.addEventListener("click", () => setViewMode("tactical"));
document.getElementById("viewCinemaBtn")?.addEventListener("click", () => setViewMode("cinema"));

// Click the field during the result-hold to advance to the next play immediately.
// The #field canvas is created lazily by renderGameLayout(), so attach via
// event delegation on the document instead of directly on the element.
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "field") {
    if (animState && animState.holdStart != null) animState.skipHold = true;
  }
});

// Brief "jog up to the new line of scrimmage" animation between plays.
// Returns null if no transition is appropriate (kickoff, halftime, score-only,
// turnover, or first play). Otherwise returns { duration, render(t01, ctx) }.
function buildJogTransition(prevPlay, nextPlay) {
  if (!prevPlay || !nextPlay) return null;
  if (nextPlay.startYard == null || prevPlay.startYard == null) return null;
  const skipKinds = ["halftime", "ot", "quarter", "two_min_warning", "timeout",
                     "kickoff", "punt", "fg_good", "fg_miss", "fg_blocked", "int", "fumble",
                     "fourth_go", "to_downs"];
  if (skipKinds.includes(nextPlay.kind) || skipKinds.includes(prevPlay.kind)) return null;
  // Turnovers swap which team is on offense — the formation identity changes,
  // so we can't smoothly jog. Skip and let the next play snap into place.
  if (prevPlay.poss && nextPlay.poss && prevPlay.poss !== nextPlay.poss) return null;
  const newPoss = nextPlay.poss;
  // Formation was lined up at the PREVIOUS play's startYard. After the play,
  // the new LOS is the next play's startYard. That's the distance to jog.
  const newLosX  = yardToAbsX(nextPlay.startYard, newPoss);
  const prevLosX = yardToAbsX(prevPlay.startYard, newPoss);
  const xOffset = prevLosX - newLosX;
  if (Math.abs(xOffset) < 6) return null;   // <~½ yard, no jog needed

  const homeTeam = gameResult.homeTeam, awayTeam = gameResult.awayTeam;
  const team    = newPoss === "home" ? homeTeam : awayTeam;
  const oppTeam = newPoss === "home" ? awayTeam : homeTeam;
  const possColor = team.primary;
  const oppColor  = oppTeam.primary;
  const dir = newPoss === "home" ? 1 : -1;

  const formation = makeFormation(newLosX, newPoss);
  const offStarters = newPoss === "home" ? gameResult.homeRatings.starters : gameResult.awayRatings.starters;
  const defStarters = newPoss === "home" ? gameResult.awayRatings.starters : gameResult.homeRatings.starters;
  attachPlayerStyles(formation, offStarters, defStarters, gameResult.playerLookup);

  let firstDownAbs = null;
  if (nextPlay.down > 0) {
    const fdYard = clamp(nextPlay.startYard + nextPlay.ytg, 0, 100);
    firstDownAbs = yardToAbsX(fdYard, newPoss);
  }
  const fieldState = { los: newLosX, firstDownAbs, possColor };

  // Faster jog for longer distances so players don't drag. ~9 yds/s sprint speed.
  const yardsToCover = Math.abs(xOffset) / FIELD.PX_PER_YARD;
  // Accelerated tempo: 1.4× regular running so jogs feel snappy between plays.
  const sprintSpeed = 9 * 1.4;   // yds/s
  const duration = clamp(yardsToCover / sprintSpeed * 1000, 350, 1400);

  // Players jog toward the new LOS. Direction of motion is (newLosX - cur).
  // facingMotion = sign of motion direction (-1 left, +1 right).
  const motionSign = xOffset > 0 ? -1 : 1;

  return {
    duration,
    render: (t01, ctx) => {
      drawField(ctx, homeTeam, awayTeam, fieldState);
      const eased = t01 * t01 * (3 - 2 * t01);
      const curOffset = xOffset * (1 - eased);
      // Cycle the run animation faster than wall time so the legs visibly churn.
      const runCycle = (t01 * 4.5) % 1;
      const renderAll = (arr, color, sec, facing) => {
        for (const p of arr) {
          drawPlayer(ctx, p.x + curOffset, p.y, color, sec, p.label, "run", runCycle, facing, p);
        }
      };
      renderAll(formation.offense, possColor, team.secondary, motionSign);
      renderAll(formation.defense, oppColor, oppTeam.secondary, motionSign);
      // Small "HUDDLE BREAK" / jog hint near the LOS
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("...", newLosX, 26);
      ctx.restore();
    },
  };
}

function startNextPlay() {
  if (!gameResult) return;
  if (playHead >= gameResult.plays.length) {
    playing = false;
    renderStaticEnd();
    updateButtons();
    const pb = document.getElementById("hudScrubPlay");
    if (pb) pb.textContent = "▶";
    if (typeof GCAudio !== "undefined") {
      GCAudio.play("whistle");                // final whistle
      setTimeout(() => GCAudio.play("cheer"), 220);
      // Fade ambient crowd a moment later (after the final cheer settles)
      setTimeout(() => GCAudio.crowd.stop(), 1800);
    }
    if (typeof GCFx !== "undefined") {
      // No GCFx.bigText("FINAL") here — renderStaticEnd() already draws a
      // prominent canvas "FINAL" + score + stars-of-the-game. The PIXI
      // bigText was a SECOND "FINAL" stacked on top (same duplicate-owner
      // class as the LED ribbon / quarter-end graphic). Keep the lens
      // flare (atmosphere, not text).
      GCFx.lensFlare(1100, 850, 360);
    }
    return;
  }
  const play = gameResult.plays[playHead];
  const prev = playHead > 0 ? gameResult.plays[playHead - 1] : null;
  // ── Audio cues for this play.
  // Ambient crowd hum runs continuously while plays are advancing; SFX
  // layer on top for individual events.
  const _kind = play.kind;
  // For "score" events the engine emits both TDs and FGs (and XPs / 2P)
  // with the same kind. Distinguish by description so FG doesn't trigger
  // TD-level celebration (was firing cheer + confetti + bigText
  // "TOUCHDOWN!" on every made field goal).
  const _scoreDesc = (_kind === "score" && play.desc) ? play.desc.toLowerCase() : "";
  const _isScoreTD = _scoreDesc.includes("touchdown");
  const _isScoreFG = _scoreDesc.includes("fg") || _scoreDesc.includes("field goal");
  const _isScoreXP = _scoreDesc.includes("extra point");
  const _isScore2P = _scoreDesc.includes("2-point");
  const _isTD   = _isScoreTD || _kind === "td" || _kind === "rush_td" ||
                  _kind === "pass_td" || _kind === "kr_td" || _kind === "pr_td" ||
                  _kind === "fum_td" || _kind === "int_td" || _kind === "two_pt_good" ||
                  _kind === "fg_good" || _kind === "xp_good";
  // _isHit triggers a screen shake + center-field hitBurst at PLAY
  // START. That made sense for big_hit / ejection (the play IS the
  // hit). For sack / fumble it fired AT THE SNAP, painting an
  // "explosion in the middle of the field" before anything had
  // happened. Those play kinds now fire their own per-frame rumble
  // at the actual contact moment.
  const _isHit  = _kind === "big_hit" || _kind === "ejection";
  const _isSeg  = _kind === "halftime" || _kind === "quarter" ||
                  _kind === "ot" || _kind === "two_min_warning";
  // _isGroan plays at play start. "interception"/"int" fire their crowd
  // reaction at the actual pick frame from inside the pass-play renderer
  // (slow-mo + bigplay swell), so they're NOT in the start-of-play groan
  // — the crowd reacting before the QB even drops back was unmistakable.
  const _isGroan = _kind === "incomplete" || _kind === "fg_miss" ||
                   _kind === "xp_miss"   || _kind === "to_downs";
  // Big-play yardage classifier. Engine never actually emits "long_pass"
  // or "long_run" — those buckets stayed empty. Detect big gains by
  // yardage instead so the crowd reacts to the explosive plays it
  // already knows about: completions of 20+ yd and runs of 15+ yd.
  const _bigYards = play.yards ?? 0;
  const _isBigCatch = _kind === "complete" && _bigYards >= 20;
  const _isBigRun   = _kind === "run"      && _bigYards >= 15;
  // Same rule as sack/fumble: big catches + big runs + interceptions
  // fire their crowd reaction inline from the per-play renderer, at the
  // moment the catch / break-through / pick lands. Including them in
  // the start-of-play _isBigPlay group caused the SFX + swell to fire
  // BEFORE the play even developed (user-reported "crowd cheers before
  // the deep ball arrives").
  const _isBigPlay = _kind === "int_no_td" || _kind === "long_run" ||
                     _kind === "long_pass";
  // Plays that begin with a QB snap — fire the synthetic "HIKE!" vocal
  // in addition to the snap click so the cadence is audible.
  const _isSnapPlay = _kind === "run" || _kind === "complete" ||
                      _kind === "incomplete" || _kind === "sack" ||
                      _kind === "int" || _kind === "interception" ||
                      _kind === "int_no_td" || _kind === "fumble" ||
                      _kind === "scramble" || _kind === "two_pt_good" ||
                      _kind === "two_pt_fail";
  // Plays that end with a tackle or downed ball — referee whistle at
  // the play hold, grunts at the contact moment.
  const _isTackleEnd = _kind === "run" || _kind === "complete" ||
                       _kind === "sack" || _kind === "scramble" ||
                       _kind === "fumble" || _kind === "kickoff" ||
                       _kind === "punt";
  if (typeof GCAudio !== "undefined") {
    GCAudio.crowd.start();
    if (_isTD) {
      GCAudio.play("cheer");
      GCAudio.crowd.swell(0.30, 1500, 1800);   // crowd bed swells with TD cheer
    }
    else if (_isHit) {
      GCAudio.play("hit");
      GCAudio.play("grunt");
      if (_kind === "fumble" || _kind === "sack") {
        GCAudio.play("bigplay");
        GCAudio.crowd.swell(0.18, 900, 1300);
      }
    }
    else if (_isSeg) {
      GCAudio.play("whistle");
      // No GCFx.bigText here — the segment cinematic (_segmentCinema.show,
      // fired from the play's render fn) already draws the headline +
      // quarter-score table. The old bigText was a SECOND graphic on top
      // of it (the "double graphic at quarter end"), and its quarter
      // math `(play.quarter||1) - 1 || 4` was wrong anyway: at the end
      // of Q1 it printed "END OF Q4" (1-1=0, 0||4 → 4). The cinematic
      // parses the quarter from play.desc correctly.
    }
    else if (_isGroan) GCAudio.play("groan");
    else if (_isBigPlay) {
      GCAudio.play("bigplay");
      GCAudio.crowd.swell(0.20, 1000, 1400);
    }
    else if (_kind !== "hc_decision") GCAudio.play("snap");
    // QB cadence — the snap click leads into a vocal "HIKE!" so the
    // pre-snap sounds like the QB is actually calling the cadence.
    if (_isSnapPlay) {
      setTimeout(() => { try { GCAudio.play("hike"); } catch (_) {} }, 220);
    }
  }
  // Visual FX hooks — screen shake on big hits, confetti on TDs. Particle
  // origin is the canvas center for now; the per-play render code can call
  // GCFx.dust(x,y) at specific player positions for richer FX in the future.
  if (typeof GCFx !== "undefined") {
    if (_isHit) {
      GCFx.shake(11, 350);
      GCFx.hitBurst(FIELD.W / 2, (FIELD.TOP + FIELD.BOT) / 2);
      GCFx.flash("#ffe6c0", 200, 0.18);   // warm camera flash on collisions
    } else if (_isTD) {
      const teamColor = (play.team === "home"
        ? gameResult.homeTeam.primary
        : gameResult.awayTeam.primary);
      GCFx.shake(5, 220);
      // Triple confetti burst — center + two endzone bursts so the
      // celebration feels like a full stadium reaction.
      GCFx.confetti(FIELD.W / 2,      FIELD.TOP + 40, teamColor, 32);
      GCFx.confetti(FIELD.W * 0.18,   FIELD.TOP + 40, teamColor, 18);
      GCFx.confetti(FIELD.W * 0.82,   FIELD.TOP + 40, teamColor, 18);
      GCFx.flash(teamColor, 320, 0.22);
      GCFx.lensFlare(700);
      GCFx.celebration(1400);
      // Big celebration banner — only for TOUCHDOWN, where it doubles
      // the cinema overlay's chyron and reads as the marquee moment.
      // FG / XP / 2P scoring chrome is already conveyed by the result
      // card; an extra middle-of-field banner just stacks text.
      // Detect FG/XP/2P from either the play kind OR the score-desc
      // string. Without the score-desc check, FG → kind:"score" events
      // fell through to the TD bigText.
      const isFG = _kind === "fg_good" || _isScoreFG;
      const isXP = _kind === "xp_good" || _isScoreXP;
      const is2P = _kind === "two_pt_good" || _isScore2P;
      if (!isFG && !isXP && !is2P) {
        GCFx.bigText("TOUCHDOWN!", teamColor, 1700);
      }
      // Player highlight chyron — name the scorer + a short tag.
      const scorer = play.receiver || play.rusher || play.passer || play.returner;
      if (scorer && !isXP) {
        const tag = isFG ? `${play.fgYds || ""} YD FIELD GOAL`.trim()
                  : is2P ? "2-POINT CONVERSION"
                  : play.kind === "pass_td" ? "PASSING TD"
                  : play.kind === "rush_td" ? "RUSHING TD"
                  : play.kind === "kr_td"   ? "KICKOFF RETURN TD"
                  : play.kind === "pr_td"   ? "PUNT RETURN TD"
                  : play.kind === "int_td"  ? "PICK SIX"
                  : play.kind === "fum_td"  ? "FUMBLE RETURN TD"
                  : "TOUCHDOWN";
        GCFx.chyron(scorer, tag, teamColor, 3400);
      }
    } else if (_kind === "drive_summary") {
      // Drive recap chyron — shows plays / yards / TOP / result.
      const plays = play.drivePlays || 0;
      const yds   = play.driveYards != null ? play.driveYards : 0;
      const ts    = play.driveTime != null
        ? `${Math.floor(play.driveTime / 60)}:${String(Math.floor(play.driveTime % 60)).padStart(2, "0")}`
        : "";
      const result = (play.driveResult || "").toUpperCase();
      const title = result || "DRIVE";
      const sub   = `${plays} PLAYS · ${yds} YDS${ts ? " · " + ts : ""}`;
      GCFx.chyron(title, sub, null, 3200);
    } else if (_isBigPlay && play.kind === "sack") {
      const sacker = play.tackler || play.sackBy;
      if (sacker) GCFx.chyron(sacker, "SACK", null, 2800);
    } else if (_isBigPlay && (play.kind === "interception" || play.kind === "int_no_td")) {
      const picker = play.defender || play.intercepter;
      if (picker) GCFx.chyron(picker, "INTERCEPTION", null, 2800);
    }
  }
  // Clear the big-hit cinematic when the play isn't one
  if (play.kind !== "big_hit" && play.kind !== "ejection") {
    if (typeof _bigHitCinema !== "undefined") _bigHitCinema.clear();
  }
  // Clear HC decision overlay when leaving its play
  if (play.kind !== "hc_decision") {
    if (typeof _hcDecisionCinema !== "undefined") _hcDecisionCinema.clear();
  }
  // Touchdown cinema clears on every new play start (it was shown by the
  // PREVIOUS play's hold phase; advance = it's over)
  if (typeof _touchdownCinema !== "undefined") _touchdownCinema.clear();
  // Same for big-play moment cinema
  if (typeof _momentCinema !== "undefined") _momentCinema.clear();
  // Clear segment cinema when leaving a quarter/halftime/2-min/OT play
  if (play.kind !== "halftime" && play.kind !== "ot" &&
      play.kind !== "quarter" && play.kind !== "two_min_warning") {
    if (typeof _segmentCinema !== "undefined") _segmentCinema.clear();
  }
  const builder = viewMode === "cinema" ? buildCinemaAnim : buildAnimForPlay;
  const anim = builder(play, prev);
  animState = {
    play,
    anim,
    startTime: performance.now(),
    duration: anim.duration / speedMul,
  };
  // Update side panels
  renderScoreboard(play);
  renderPlayLog();
  renderProgress();
  renderBoxScore();
  setCaption(play);
  setFieldStatus(play);
  rafId = requestAnimationFrame(tick);
}

// ── Scrubbable timeline ───────────────────────────────────────────────
// Injects a slim play/pause + drag-to-scrub timeline into the field-wrap on
// first tick. Lets the user drag through the current play's animation in
// real time, jump back to t=0 to re-watch, or pause on a frame.
function _ensureScrubber() {
  if (document.getElementById("hudScrubber")) return;
  const wrap = document.querySelector(".bspnlive-field-wrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.id = "hudScrubber";
  el.className = "hud-scrubber";
  el.innerHTML = `
    <button class="hud-scrub-btn" id="hudScrubPlay" title="Play / Pause">⏸</button>
    <button class="hud-scrub-btn" id="hudScrubRestart" title="Restart this play">↺</button>
    <div class="hud-scrub-track" id="hudScrubTrack">
      <div class="hud-scrub-fill" id="hudScrubFill"></div>
      <div class="hud-scrub-knob" id="hudScrubKnob"></div>
    </div>
    <div class="hud-scrub-time" id="hudScrubTime">0.00s</div>`;
  wrap.appendChild(el);
  document.getElementById("hudScrubPlay").addEventListener("click", _scrubToggle);
  document.getElementById("hudScrubRestart").addEventListener("click", _scrubRestart);
  document.getElementById("hudScrubTrack").addEventListener("pointerdown", _scrubStart);
}

function _scrubToggle() {
  if (!animState) return;
  if (playing) {
    // Pause — remember elapsed so resume picks up here
    if (animState.startTime != null) {
      animState._pausedElapsed = performance.now() - animState.startTime;
    }
    playing = false;
  } else {
    if (animState._pausedElapsed != null) {
      animState.startTime = performance.now() - animState._pausedElapsed;
      animState._pausedElapsed = null;
    }
    playing = true;
    rafId = requestAnimationFrame(tick);
  }
  const btn = document.getElementById("hudScrubPlay");
  if (btn) btn.textContent = playing ? "⏸" : "▶";
}

function _scrubRestart() {
  if (!animState) return;
  animState.startTime = performance.now();
  animState.holdStart = null;
  animState._pausedElapsed = null;
  animState.skipHold = false;
  if (!playing) {
    playing = true;
    const btn = document.getElementById("hudScrubPlay");
    if (btn) btn.textContent = "⏸";
    rafId = requestAnimationFrame(tick);
  }
}

function _scrubStart(ev) {
  if (!animState) return;
  ev.preventDefault();
  const wasPlaying = playing;
  playing = false;  // hold while dragging
  const track = ev.currentTarget;
  const onMove = e => _scrubTo(e, track);
  const onUp = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    if (wasPlaying) {
      playing = true;
      rafId = requestAnimationFrame(tick);
    } else {
      // Remember the new elapsed for resume
      if (animState && animState.startTime != null) {
        animState._pausedElapsed = performance.now() - animState.startTime;
      }
    }
  };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  _scrubTo(ev, track);
}

function _scrubTo(ev, track) {
  if (!animState) return;
  const rect = track.getBoundingClientRect();
  let frac = (ev.clientX - rect.left) / rect.width;
  frac = Math.max(0, Math.min(1, frac));
  // Re-anchor startTime so elapsed = frac * duration
  animState.startTime = performance.now() - frac * animState.duration;
  animState.holdStart = null;
  animState.skipHold = false;
  // Render the new frame immediately so the scrub feels live
  const ctx = $("field").getContext("2d");
  _frameStartBroadcast();
  try {
    animState.anim.render(frac, ctx);
    _frameEndBroadcast();
  } catch (e) { console.error("Scrub render error", e); }
  _updateScrubberUI(frac);
}

function _updateScrubberUI(frac) {
  const fill = document.getElementById("hudScrubFill");
  const knob = document.getElementById("hudScrubKnob");
  const time = document.getElementById("hudScrubTime");
  if (fill) fill.style.width = (frac * 100) + "%";
  if (knob) knob.style.left = (frac * 100) + "%";
  if (time && animState) {
    time.textContent = ((animState.duration * frac) / 1000).toFixed(2) + "s";
  }
}

function tick(now) {
  _ensureScrubber();
  if (!playing || !animState) return;
  // Inter-play jog transition — animate players trotting up to the new LOS.
  if (animState.transition) {
    const ctx = $("field").getContext("2d");
    const tElapsed = now - animState.transitionStart;
    const tT = Math.min(1, tElapsed / animState.transitionDur);
    try {
      animState.transition.render(tT, ctx);
    } catch (e) {
      console.error('Jog transition render error', e);
    }
    if (tT >= 1) {
      playHead++;
      animState = null;
      if (playing) startNextPlay();
      return;
    }
    rafId = requestAnimationFrame(tick);
    return;
  }
  // Cinematic slow-mo at tackle impact — set by initRagdoll for the
  // carrier. While now < slowMoUntil, burn (1 - slowMoMul) * frameDt
  // back into startTime so play-elapsed grows at (slowMoMul)x of real
  // time. Result: a brief slow-mo hold on the impact frame.
  if (animState.slowMoUntil && now < animState.slowMoUntil) {
    const frameDt = animState.lastTickAt ? (now - animState.lastTickAt) : 0;
    const mul = animState.slowMoMul || 0.30;
    animState.startTime += frameDt * (1 - mul);
    // Publish the live dilation for the trench sims (play-sim.js has no
    // animState access) so PassProSim / RunBlockSim advance at the dilated
    // play-clock rate — slowMoMul (0 on a catch freeze, ~0.2-0.5 on a big
    // hit) — instead of creeping on wall-clock through the freeze.
    if (typeof window !== "undefined") window._GC_SLOWF = animState.slowMoMul != null ? animState.slowMoMul : 0.30;
  } else if (typeof window !== "undefined") {
    window._GC_SLOWF = 1;
  }
  const elapsed = now - animState.startTime;
  const t = Math.min(1, elapsed / animState.duration);
  const ctx = $("field").getContext("2d");
  // FX particle update — advance dust/debris/confetti every frame.
  if (typeof GCFx !== "undefined") {
    const dt = animState.lastTickAt ? (now - animState.lastTickAt) : 16.7;
    animState.lastTickAt = now;
    GCFx.tick(dt);
  }
  _frameStartBroadcast();
  try {
    animState.anim.render(t, ctx);
    _frameEndBroadcast();
    // Particles draw on top of the upright sprites overlay (broadcast cam)
    // or on the field canvas itself (topdown). _uprightCtx is set by
    // _frameStartBroadcast in broadcast mode; null in topdown.
    if (typeof GCFx !== "undefined") {
      const fxCtx = (typeof _uprightCtx !== "undefined" && _uprightCtx) ? _uprightCtx : ctx;
      GCFx.draw(fxCtx);
    }
  } catch (e) {
    console.error('Render error on play', animState.play, e);
  }
  _updateScrubberUI(t);
  if (t >= 1) {
    // Hold the final frame and overlay a result card so the play can be digested.
    if (animState.holdStart == null) {
      animState.holdStart = now;
      const play = animState.play;
      const hasCard = !!formatPlayResult(play);
      // Celebrations: longer hold so the player can dance + portrait shows
      const isTD = (play.endYard ?? 0) >= 100 && (play.kind === "run" || play.kind === "complete");
      const isBigPlay = !isTD && (
        (play.kind === "complete" && (play.yards ?? 0) >= 25) ||
        (play.kind === "run" && (play.yards ?? 0) >= 20) ||
        play.kind === "int" || play.kind === "fumble"
      );
      animState.celebrate = isTD ? { kind: "TD", celebKey: pickCelebration(play, 0) }
                          : isBigPlay ? { kind: "BIG", celebKey: pickCelebration(play, 7) }
                          : null;
      // AAA touchdown spectacle — team-color flood overlay on the field
      // for the duration of the TD hold.
      if (isTD && typeof _touchdownCinema !== "undefined") _touchdownCinema.show(play);
      // Big-play moment card — INT (incl. pick six), FUMBLE recovery
      if ((play.kind === "int" || play.kind === "fumble") && typeof _momentCinema !== "undefined") {
        _momentCinema.show(play);
      }
      // End-of-play sounds. Whistle fires on plays that end with a
      // tackle / downed ball; tackle grunts layer on contact-end plays
      // (run / complete / sack). Score plays get cheer not whistle.
      if (typeof GCAudio !== "undefined") {
        const _endTackle = play.kind === "run" || play.kind === "complete" ||
                           play.kind === "sack" || play.kind === "scramble" ||
                           play.kind === "fumble" || play.kind === "kickoff" ||
                           play.kind === "punt" || play.kind === "incomplete";
        if (_endTackle && !isTD) {
          GCAudio.play("whistle");
          if (play.kind === "run" || play.kind === "complete" ||
              play.kind === "sack" || play.kind === "scramble" ||
              play.kind === "fumble") {
            GCAudio.play("grunt");
            // Big-play crowd swell at the resolution moment for hard-hit plays.
            if (isBigPlay) GCAudio.crowd.swell(0.18, 800, 1200);
          }
        }
      }
      // Routine plays (incomplete, no-yards run) hold shorter than the
      // standard RESULT_HOLD_MS. 2700ms after an incomplete is just
      // staring at a frozen ball on the ground — the play is over,
      // viewer doesn't need to dwell. Cut to 1300ms.
      const _routineHold = play.kind === "incomplete"
                        || (play.kind === "run" && (play.yards ?? 0) <= 1 && !isTD);
      const baseHold = hasCard ? (_routineHold ? 1300 : RESULT_HOLD_MS) : 90;
      const extraHold = isTD ? 1600 : isBigPlay ? 700 : 0;
      animState.holdDur = (baseHold + extraHold) / speedMul;
    }
    const holdElapsed = now - animState.holdStart;
    const holdT = Math.min(1, holdElapsed / animState.holdDur);
    // Celebration overlay BEFORE the result card so the card sits on top
    if (animState.celebrate) {
      drawCelebrationOverlay(ctx, animState.play, animState.celebrate, holdT);
    }
    // ONE owner per event announcement. TD plays are announced by the
    // _touchdownCinema DOM overlay (team flood + "TOUCHDOWN" + scorer +
    // detail); INT/fumble by the _momentCinema card. The result-card
    // banner duplicated those headlines on the same hold ("TOUCHDOWN!"
    // over the cinema's "TOUCHDOWN"). Suppress the card for cinema-owned
    // plays; it still draws for every routine play where it's the sole
    // announcement. (Hold duration logic above is unchanged — it keys
    // off hasCard, preserving the TD dwell.)
    const _cp = animState.play;
    const _cinemaOwned =
      (((_cp.kind === "run" || _cp.kind === "complete") && (_cp.endYard ?? 0) >= 100)
       || _cp.kind === "int" || _cp.kind === "fumble");
    if (!_cinemaOwned) drawResultCard(ctx, animState.play, holdT);
    if (holdElapsed >= animState.holdDur || animState.skipHold) {
      // Build a jog transition into the NEXT play (if applicable) so players
      // visibly trot up to the new LOS instead of instacutting.
      const nextIdx = playHead + 1;
      const nextPlay = nextIdx < gameResult.plays.length ? gameResult.plays[nextIdx] : null;
      const jog = (viewMode === "tactical" && !animState.skipHold)
        ? buildJogTransition(animState.play, nextPlay) : null;
      if (jog) {
        animState = {
          transition: jog,
          transitionStart: now,
          transitionDur: jog.duration / speedMul,
        };
        rafId = requestAnimationFrame(tick);
        return;
      }
      playHead++;
      animState = null;
      if (playing) startNextPlay();
      return;
    }
  }
  rafId = requestAnimationFrame(tick);
}

function renderStaticEnd() {
  const ctx = $("field").getContext("2d");
  if (viewMode === "cinema") {
    cinemaCamX = yardToWorldX(50);
    drawCinemaField(ctx, gameResult.homeTeam, gameResult.awayTeam, null);
  } else {
    drawField(ctx, gameResult.homeTeam, gameResult.awayTeam, null);
  }
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, FIELD.W, FIELD.H);
  ctx.fillStyle = "#f0cc30";
  ctx.font = "bold 48px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("FINAL", FIELD.W / 2, FIELD.H / 2 - 24);
  ctx.font = "bold 32px sans-serif";
  ctx.fillStyle = "#fff";
  ctx.fillText(`${gameResult.homeTeam.name} ${gameResult.homeScore} — ${gameResult.awayScore} ${gameResult.awayTeam.name}`, FIELD.W / 2, FIELD.H / 2 + 22);
  // Stars of the game — top performers from both teams, shown with their key
  // stat line. Drawn beneath the FINAL banner before the scoreboard refresh.
  drawStarsOfGame(ctx);
  renderScoreboard();
  renderPlayLog();
  renderProgress();
  renderBoxScore();
}

// Compute the top 3 individual performances of the game (offense + defense).
// Score formula weighs TDs heavily, then yards/sacks/INTs/picks. Returns up
// to 3 player rows, each labeled with team + stat line.
function pickStarsOfGame() {
  const stats = (gameResult.plays.length && gameResult.plays[gameResult.plays.length - 1].statsSnap) || gameResult.stats;
  if (!stats) return [];
  const collect = (sideKey) => {
    const team = sideKey === "home" ? gameResult.homeTeam : gameResult.awayTeam;
    return Object.values(stats[sideKey].players || {}).map(p => ({ ...p, sideKey, teamName: team.name }));
  };
  const all = [...collect("home"), ...collect("away")];
  const scored = all.map(p => {
    let score = 0;
    let line = "";
    // QB
    if (p.pos === "QB") {
      score += (p.pass_td || 0) * 22 + (p.pass_yds || 0) * 0.10 + (p.pass_comp || 0) * 1.0
             - (p.pass_int || 0) * 14 - (p.sk_taken || 0) * 1;
      line = `${p.pass_comp || 0}/${p.pass_att || 0}, ${p.pass_yds || 0} yds, ${p.pass_td || 0} TD${(p.pass_int||0) ? `, ${p.pass_int} INT` : ""}`;
    }
    // RB
    if (p.rush_att > 0) {
      score += (p.rush_td || 0) * 18 + (p.rush_yds || 0) * 0.12 + (p.broken_tackles || 0) * 1.5
             - (p.fumbles_lost || 0) * 12;
      if (!line) line = `${p.rush_att || 0} car, ${p.rush_yds || 0} yds, ${p.rush_td || 0} TD`;
    }
    // Receiver
    if (p.rec > 0 || p.rec_tgt > 0) {
      const recScore = (p.rec_td || 0) * 18 + (p.rec_yds || 0) * 0.18 + (p.rec || 0) * 1.5;
      if (recScore > score) {
        score = recScore;
        line = `${p.rec || 0}/${p.rec_tgt || 0}, ${p.rec_yds || 0} yds, ${p.rec_td || 0} TD`;
      }
    }
    // Defender
    const defScore = (p.tkl || 0) * 1.5 + (p.sk || 0) * 8 + (p.int_made || 0) * 16
                   + (p.pd || 0) * 3 + (p.ff || 0) * 6 + (p.fr || 0) * 4 + (p.def_td || 0) * 24;
    if (defScore > score) {
      score = defScore;
      const parts = [];
      if (p.tkl)      parts.push(`${p.tkl} TKL`);
      if (p.sk)       parts.push(`${p.sk.toFixed(1)} SK`);
      if (p.int_made) parts.push(`${p.int_made} INT`);
      if (p.pd)       parts.push(`${p.pd} PD`);
      if (p.ff)       parts.push(`${p.ff} FF`);
      if (p.def_td)   parts.push(`${p.def_td} DEF TD`);
      line = parts.join(", ");
    }
    // Kicker
    if (p.fg_att > 0 && (p.fg_made || 0) >= 2) {
      const kScore = (p.fg_made || 0) * 6 + (p.fg_long || 0) * 0.10;
      if (kScore > score) { score = kScore; line = `${p.fg_made}/${p.fg_att} FG (long ${p.fg_long || 0})`; }
    }
    return { ...p, score, line };
  })
  .filter(p => p.score > 8 && p.line)
  .sort((a, b) => b.score - a.score)
  .slice(0, 3);
  return scored;
}

function drawStarsOfGame(ctx) {
  const stars = pickStarsOfGame();
  if (!stars.length) return;
  const baseY = FIELD.H / 2 + 60;
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#f0cc30";
  ctx.fillText("⭐ STARS OF THE GAME ⭐", FIELD.W / 2, baseY);
  ctx.font = "600 14px sans-serif";
  stars.forEach((s, i) => {
    const isHome = s.sideKey === "home";
    ctx.fillStyle = isHome ? "#9be09b" : "#9bd0ff";
    const y = baseY + 26 + i * 22;
    ctx.fillText(`${i + 1}. ${s.name} (${s.teamName}) — ${s.line}`, FIELD.W / 2, y);
  });
}

function setCaption(play) {
  const cap = $("playCaption");
  cap.className = "play-caption " + play.kind;
  cap.textContent = play.desc;
}

function setFieldStatus(play) {
  if (!play) return;
  const fs = $("fieldStatus");
  const qc = $("quarterClock");
  let possLabel = "";
  if (play.poss) {
    const team = play.poss === "home" ? gameResult.homeTeam : gameResult.awayTeam;
    possLabel = ` · ${teamAscii(team)} ${team.name} ball`;
  }
  let dd = "";
  if (play.down > 0) {
    const dStr = `${play.down}${["st","nd","rd","th"][play.down-1]} & ${play.ytg}`;
    const fieldDesc = play.poss === "home"
      ? (play.yardLine < 50 ? `own ${play.yardLine}` : play.yardLine === 50 ? "midfield" : `opp ${100 - play.yardLine}`)
      : (play.yardLine < 50 ? `own ${play.yardLine}` : play.yardLine === 50 ? "midfield" : `opp ${100 - play.yardLine}`);
    dd = ` · ${dStr} at ${fieldDesc}`;
  }
  fs.textContent = `${quarterLabel(play.quarter, play.time || 0)}${possLabel}${dd}`;
  qc.textContent = "";
}

function renderScoreboard(curPlay) {
  if (!gameResult) return;
  // Phase 1: when the BSPN broadcast layout is mounted, the new
  // panels own all per-play rendering. The legacy helper would
  // overwrite the new scoreboard if we let it run.
  if (document.querySelector(".bspnlive-root")) { renderBSPNLive(); return; }
  const last = curPlay || (playHead > 0 ? gameResult.plays[playHead - 1] : gameResult.plays[0]);
  const homeScore = last?.homeScore ?? 0;
  const awayScore = last?.awayScore ?? 0;
  const ended = playHead >= gameResult.plays.length;
  const winner = ended ? gameResult.winner : null;
  const sb = $("scoreboard");
  if (!sb) return;
  const pbBadge = team => {
    const pb = getPlaybook(team);
    if (pb.id === "AIR_RAID")         return `<span class="badge badge-air">AIR RAID</span>`;
    if (pb.id === "GROUND_AND_POUND") return `<span class="badge badge-gnp">G&amp;P</span>`;
    if (pb.id === "DUAL_THREAT")      return `<span class="badge badge-dt">DUAL THREAT</span>`;
    if (pb.id === "OPTION")           return `<span class="badge badge-opt">READ OPTION</span>`;
    return "";
  };
  const toDots = (count) => {
    const dots = [];
    for (let i = 0; i < 3; i++) dots.push(i < (count ?? 3) ? "●" : "○");
    return `<div class="timeout-dots" title="Timeouts remaining">${dots.join("")}</div>`;
  };
  const tos = last?.timeouts || { home: 3, away: 3 };
  sb.innerHTML = `
    <div class="score-team">
      <div class="score-team-emoji">${teamAscii(gameResult.homeTeam)}</div>
      <div class="score-team-full">${gameResult.homeTeam.city}</div>
      <div class="score-team-name">${gameResult.homeTeam.name}</div>
      ${pbBadge(gameResult.homeTeam)}
      <div class="score-num ${winner === "home" ? "win" : ""}">${homeScore}</div>
      ${toDots(tos.home)}
      ${last?.poss === "home" && !ended ? `<div class="poss-indicator">🏈 POSS</div>` : ""}
    </div>
    <div class="score-mid">
      <div class="score-status ${ended ? "final" : "live"}">
        ${ended ? (winner === "tie" ? "FINAL · TIE" : winner === "home" ? "🏆 HOME WIN" : "🏆 AWAY WIN") : "● LIVE"}
      </div>
      <div class="quarter-clock">${last ? quarterLabel(last.quarter, last.time || 0) : "—"}</div>
      ${last?.down > 0 && !ended ? `<div class="down-distance">${last.down}${["st","nd","rd","th"][last.down-1]} & ${last.ytg}</div>` : ""}
    </div>
    <div class="score-team">
      <div class="score-team-emoji">${teamAscii(gameResult.awayTeam)}</div>
      <div class="score-team-full">${gameResult.awayTeam.city}</div>
      <div class="score-team-name">${gameResult.awayTeam.name}</div>
      ${pbBadge(gameResult.awayTeam)}
      <div class="score-num ${winner === "away" ? "win" : ""}">${awayScore}</div>
      ${toDots(tos.away)}
      ${last?.poss === "away" && !ended ? `<div class="poss-indicator">🏈 POSS</div>` : ""}
    </div>
  `;
}

function renderProgress() {
  $("progLabel").textContent = `Play ${playHead} / ${gameResult.plays.length}`;
  $("progFill").style.width = `${(playHead / gameResult.plays.length) * 100}%`;
}

// Walk back from playHead to find the latest snapshot (kickoff/markers don't carry one)
function currentStats() {
  for (let i = Math.min(playHead, gameResult.plays.length) - 1; i >= 0; i--) {
    const s = gameResult.plays[i].statsSnap;
    if (s) return s;
  }
  // Pre-game: all zeros
  return gameResult.stats && {
    home: { team: emptyTeamTotals(), players: {} },
    away: { team: emptyTeamTotals(), players: {} },
  };
}

function emptyTeamTotals() {
  return { plays: 0, totalYds: 0, passYds: 0, rushYds: 0, pass_att: 0, pass_comp: 0,
           rush_att: 0, sacks: 0, sacks_allowed: 0, turnovers: 0, takeaways: 0,
           firstDowns: 0, thirdAtt: 0, thirdConv: 0, fourthAtt: 0, fourthConv: 0 };
}

function renderBoxScore() {
  // BSPN broadcast: the new layout owns the box-score panel.
  if (document.querySelector(".bspnlive-root")) { renderBSPNLive(); return; }
  const el = $("boxScore"); if (!el) return;
  const stats = currentStats();
  const hT = stats.home.team, aT = stats.away.team;
  const hP = stats.home.players, aP = stats.away.players;
  const homeName = gameResult.homeTeam.name, awayName = gameResult.awayTeam.name;

  if (boxTab === "totals") {
    const row = (lbl, h, a, fmt = v => v) => `
      <div class="team-totals">
        <div class="h">${fmt(h)}</div>
        <div class="lbl">${lbl}</div>
        <div class="a">${fmt(a)}</div>
      </div>`;
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:.5rem;font-size:.7rem;color:var(--gray);padding-bottom:.3rem;border-bottom:1px solid var(--border);">
        <div style="text-align:right;color:var(--green-lt);font-weight:700">${homeName}</div>
        <div></div>
        <div style="text-align:left;color:var(--gold);font-weight:700">${awayName}</div>
      </div>
      ${row("TOTAL YDS", hT.totalYds, aT.totalYds)}
      ${row("PASS YDS", hT.passYds, aT.passYds)}
      ${row("RUSH YDS", hT.rushYds, aT.rushYds)}
      ${row("CMP / ATT", `${hT.pass_comp}/${hT.pass_att}`, `${aT.pass_comp}/${aT.pass_att}`)}
      ${row("RUSH ATT", hT.rush_att, aT.rush_att)}
      ${row("FIRST DOWNS", hT.firstDowns, aT.firstDowns)}
      ${row("3RD DOWN", `${hT.thirdConv}/${hT.thirdAtt}`, `${aT.thirdConv}/${aT.thirdAtt}`)}
      ${row("SACKS", hT.sacks, aT.sacks)}
      ${row("TURNOVERS", hT.turnovers, aT.turnovers)}
    `;
    return;
  }

  const sideStats = boxTab === "home" ? stats.home : stats.away;
  const teamLabel = boxTab === "home" ? gameResult.homeTeam : gameResult.awayTeam;
  const players = sideStats.players;
  const byPos = pos => Object.values(players).filter(p => p.pos === pos);

  const passingRows = byPos("QB").map(p =>
    `<tr>
      <td class="pos">QB</td>
      <td class="name">${nameSpan(p.name)}</td>
      <td>${p.pass_comp}/${p.pass_att}</td>
      <td>${p.pass_yds}</td>
      <td>${p.pass_yds && p.pass_att ? (p.pass_yds / p.pass_att).toFixed(1) : "0.0"}</td>
      <td>${p.pass_td}</td>
      <td>${p.pass_int}</td>
      <td>${p.pass_long}</td>
    </tr>`).join("");

  const rushingRows = Object.values(players).filter(p => p.rush_att > 0).map(p =>
    `<tr>
      <td class="pos">${p.pos}</td>
      <td class="name">${nameSpan(p.name)}</td>
      <td>${p.rush_att}</td>
      <td>${p.rush_yds}</td>
      <td>${p.rush_att ? (p.rush_yds / p.rush_att).toFixed(1) : "0.0"}</td>
      <td>${p.rush_td}</td>
      <td>${p.broken_tackles || 0}</td>
      <td>${(p.fumbles || 0) + (p.fumbles_lost ? `/${p.fumbles_lost}` : "")}</td>
      <td>${p.rush_long}</td>
    </tr>`).join("");

  const recRows = Object.values(players).filter(p => p.rec_tgt > 0).map(p =>
    `<tr>
      <td class="pos">${p.pos}</td>
      <td class="name">${nameSpan(p.name)}</td>
      <td>${p.rec}/${p.rec_tgt}</td>
      <td>${p.rec_yds}</td>
      <td>${p.rec ? (p.rec_yds / p.rec).toFixed(1) : "0.0"}</td>
      <td>${p.rec_td}</td>
      <td>${p.rec_drops || 0}</td>
      <td>${p.rec_long}</td>
    </tr>`).join("");

  const kickRows = byPos("K").filter(p => p.fg_att + p.xp_att > 0).map(p =>
    `<tr>
      <td class="pos">K</td>
      <td class="name">${nameSpan(p.name)}</td>
      <td>${p.fg_made}/${p.fg_att}</td>
      <td>${p.fg_long || "—"}</td>
      <td>${p.xp_made}/${p.xp_att}</td>
    </tr>`).join("");

  // Defense — any player with any defensive stat > 0. Includes def_td
  // (pick-six, fumble return TD, blocked-FG return TD).
  const defRows = Object.values(players)
    .filter(p => ["DE","DT","LB","CB","FS","SS"].includes(p.pos))
    .filter(p => (p.tkl || p.sk || p.int_made || p.pd || p.ff || p.fr || p.def_td) > 0)
    .sort((a, b) => (b.tkl + b.sk * 2 + b.int_made * 3 + b.pd + (b.def_td || 0) * 6) - (a.tkl + a.sk * 2 + a.int_made * 3 + a.pd + (a.def_td || 0) * 6))
    .map(p => `<tr>
      <td class="pos">${p.pos}</td>
      <td class="name">${nameSpan(p.name)}</td>
      <td>${p.tkl || 0}</td>
      <td>${p.sk ? p.sk.toFixed(1) : "0.0"}</td>
      <td>${p.int_made || 0}</td>
      <td>${p.pd || 0}</td>
      <td>${p.ff || 0}</td>
      <td>${p.fr || 0}</td>
      <td>${p.def_td || 0}</td>
    </tr>`).join("");

  const empty = `<tr><td colspan="9" style="color:var(--gray);text-align:center;padding:.4rem">—</td></tr>`;

  el.innerHTML = `
    <div style="font-size:.7rem;color:var(--gold);font-weight:700;letter-spacing:.4px;margin-bottom:.4rem;">${teamAscii(teamLabel)} ${teamLabel.city.toUpperCase()} ${teamLabel.name.toUpperCase()}</div>
    <div class="boxscore-section">
      <h4>PASSING</h4>
      <table class="boxscore-table">
        <thead><tr><th></th><th></th><th>C/A</th><th>YDS</th><th>AVG</th><th>TD</th><th>INT</th><th>LNG</th></tr></thead>
        <tbody>${passingRows || empty}</tbody>
      </table>
      <h4>RUSHING</h4>
      <table class="boxscore-table">
        <thead><tr><th></th><th></th><th>ATT</th><th>YDS</th><th>AVG</th><th>TD</th><th>BTK</th><th>FUM</th><th>LNG</th></tr></thead>
        <tbody>${rushingRows || empty}</tbody>
      </table>
      <h4>RECEIVING</h4>
      <table class="boxscore-table">
        <thead><tr><th></th><th></th><th>R/T</th><th>YDS</th><th>AVG</th><th>TD</th><th>DRP</th><th>LNG</th></tr></thead>
        <tbody>${recRows || empty}</tbody>
      </table>
      <h4>DEFENSE</h4>
      <table class="boxscore-table">
        <thead><tr><th></th><th></th><th>TKL</th><th>SK</th><th>INT</th><th>PD</th><th>FF</th><th>FR</th><th>TD</th></tr></thead>
        <tbody>${defRows || empty}</tbody>
      </table>
      <h4>KICKING</h4>
      <table class="boxscore-table">
        <thead><tr><th></th><th></th><th>FG</th><th>LNG</th><th>XP</th></tr></thead>
        <tbody>${kickRows || empty}</tbody>
      </table>
    </div>
  `;
}

function renderPlayLog() {
  // BSPN broadcast: the new pbp panel handles this through the adapter.
  if (document.querySelector(".bspnlive-root")) { renderBSPNLive(); return; }
  const log = $("playLog");
  const visible = gameResult.plays.slice(0, playHead);
  log.innerHTML = visible.map(p => playEntry(p)).join("");
  log.scrollTop = log.scrollHeight;
}

function quarterLabel(q, t) {
  if (q === 5) return `OT ${Math.floor(t/60)}:${String(t%60).padStart(2,"0")}`;
  return `Q${q} ${Math.floor(t/60)}:${String(t%60).padStart(2,"0")}`;
}

function highlightPlayerNamesInPlay(p) {
  let out = escapeHtml(p.desc || "");
  // ALL name-bearing fields on a play object — offense AND defense. Anyone
  // mentioned in the description should be a hoverable .player-name span,
  // not raw text (which is why defenders like tacklers / sackers / forced-
  // fumblers used to be unhoverable).
  const players = [
    p.passer, p.rusher, p.receiver, p.kicker, p.intended,
    p.tackler, p.defender, p.sacker, p.forcedBy, p.interceptor,
    p.returner, p.muffedBy,
  ].filter(Boolean);
  // Sort longest first so "Marcus Smith" wins over "Marcus"
  players.sort((a, b) => b.length - a.length);
  const placeholders = [];
  for (let i = 0; i < players.length; i++) {
    const name = players[i];
    const escName = escapeHtml(name);
    if (out.includes(escName)) {
      const ph = `\x00P${i}\x00`;
      out = out.split(escName).join(ph);
      placeholders[i] = nameSpan(name);
    }
  }
  for (let i = 0; i < placeholders.length; i++) {
    if (placeholders[i]) out = out.split(`\x00P${i}\x00`).join(placeholders[i]);
  }
  return out;
}

function playEntry(p) {
  const isMarker = ["halftime","ot","quarter","kickoff","two_min_warning","timeout","drive_summary"].includes(p.kind);
  if (isMarker) return `<div class="play-entry ${p.kind}">${escapeHtml(p.desc)}</div>`;
  // ── BIOMECHANICS-AWARE ENTRIES (Wave 1 — Live Game Viewer) ────────
  // Big hits, ejections, and UR-flag-driven penalties get an inline
  // chip strip showing what the engine knows about the contact: hit
  // mechanism, force, tackler archetype, body-part impact.
  if (p.kind === "big_hit") {
    const chips = [];
    if (p.mechanism) {
      const mechColor = p.mechanism === "high" ? "#e6373a"
                     : p.mechanism === "head_on" ? "#ed6a3a"
                     : p.mechanism === "low" ? "#f0a93a"
                     : p.mechanism === "behind" ? "#d4dc5a"
                     : "#90c4ec";
      const mechLbl = p.mechanism === "head_on" ? "HEAD-ON"
                    : p.mechanism === "high"    ? "HIGH"
                    : p.mechanism === "low"     ? "LOW"
                    : p.mechanism === "side"    ? "SIDE"
                    : p.mechanism === "behind"  ? "BLINDSIDE"
                    : p.mechanism.toUpperCase();
      chips.push(`<span style="background:${mechColor};color:#000;font-size:.55rem;letter-spacing:.6px;font-weight:800;padding:.05rem .3rem;border-radius:2px;margin:0 .15rem">${mechLbl}</span>`);
    }
    if (p.force != null) {
      const fColor = p.force >= 1.9 ? "#e6373a" : p.force >= 1.7 ? "#ed6a3a" : "#f0a93a";
      chips.push(`<span style="color:${fColor};font-size:.6rem;font-weight:700;letter-spacing:.4px;margin:0 .15rem">⚡ ${p.force.toFixed(2)}</span>`);
    }
    if (p.eventType === "sack") chips.push(`<span style="color:#90c4ec;font-size:.55rem;letter-spacing:.6px;font-weight:700;padding:.05rem .3rem;border:1px solid #90c4ec;border-radius:2px;margin:0 .15rem">SACK</span>`);
    return `<div class="play-entry big-hit" style="background:rgba(230,55,58,.08);border-left:3px solid #e6373a;padding:.35rem .55rem;margin:.2rem 0;border-radius:2px">
      <span style="font-size:.7rem;font-weight:700">${highlightPlayerNamesInPlay(p)}</span>
      <div style="margin-top:.2rem">${chips.join("")}</div>
    </div>`;
  }
  if (p.kind === "ejection") {
    return `<div class="play-entry ejection" style="background:rgba(230,55,58,.18);border:2px solid #e6373a;padding:.45rem .6rem;margin:.3rem 0;border-radius:4px;font-weight:800;color:#ec9090;letter-spacing:.5px">${highlightPlayerNamesInPlay(p)}</div>`;
  }
  // Field-position phrase: own 30 / opp 35 / midfield. startYard is from
  // the offense's perspective (0 = own goal, 100 = opp goal).
  const fp = p.startYard;
  const fieldPos = (typeof fp === "number")
    ? (fp === 50 ? "midfield"
      : fp < 50  ? `own ${fp}`
      :            `opp ${100 - fp}`)
    : null;
  const downStr = p.down > 0
    ? `${p.down}${["st","nd","rd","th"][p.down-1]} & ${p.ytg}` + (fieldPos ? ` at ${fieldPos}` : "")
    : "";
  const meta = `Q${p.quarter} ${Math.floor(p.time/60)}:${String(p.time%60).padStart(2,"0")}`
             + (downStr ? ` · ${downStr}` : "");
  const icon = p.kind === "score" ? "🏈 "
             : p.kind === "int" || p.kind === "fumble" ? "⚠️ "
             : p.kind === "fg_good" ? "✅ "
             : p.kind === "fg_miss" ? "❌ "
             : "";
  return `<div class="play-entry ${p.kind}"><span class="meta">${meta}</span>${icon}${highlightPlayerNamesInPlay(p)}</div>`;
}

function renderRatings() {
  const r = gameResult; if (!r) return;
  const row = (label, h, a) => {
    const winner = h > a ? "h" : a > h ? "a" : null;
    return `<tr>
      <td class="home ${winner === "h" ? "winner" : ""}">${Math.round(h)}</td>
      <td class="lbl">${label}</td>
      <td class="away ${winner === "a" ? "winner" : ""}">${Math.round(a)}</td>
    </tr>`;
  };
  // Starter rows — show name (hoverable) + OVR for each side's top player at the slot
  const topAt = (roster, pos, idx = 0) => {
    const list = roster.filter(p => p.position === pos).sort((a, b) => b.overall - a.overall);
    return list[idx] || null;
  };
  const starterRow = (label, hP, aP) => {
    if (!hP || !aP) return "";
    const winner = hP.overall > aP.overall ? "h" : aP.overall > hP.overall ? "a" : null;
    return `<tr class="starter-row">
      <td class="home ${winner === "h" ? "winner" : ""}">${nameSpan(hP.name)} <span class="ovr-pill">${hP.overall}</span></td>
      <td class="lbl">${label}</td>
      <td class="away ${winner === "a" ? "winner" : ""}"><span class="ovr-pill">${aP.overall}</span> ${nameSpan(aP.name)}</td>
    </tr>`;
  };
  $("ratings").innerHTML = `
    <thead><tr>
      <th class="home" style="color:var(--gold);font-size:.78rem">${r.homeTeam.name}</th>
      <th class="lbl"></th>
      <th class="away" style="color:var(--gold);font-size:.78rem">${r.awayTeam.name}</th>
    </tr></thead>
    <tbody>
      ${row("OFFENSE", r.homeRatings.offense, r.awayRatings.offense)}
      ${row("DEFENSE", r.homeRatings.defense, r.awayRatings.defense)}
      ${starterRow("QB",  topAt(r.homeRoster, "QB"), topAt(r.awayRoster, "QB"))}
      ${starterRow("RB",  topAt(r.homeRoster, "RB"), topAt(r.awayRoster, "RB"))}
      ${starterRow("WR1", topAt(r.homeRoster, "WR", 0), topAt(r.awayRoster, "WR", 0))}
      ${starterRow("WR2", topAt(r.homeRoster, "WR", 1), topAt(r.awayRoster, "WR", 1))}
      ${starterRow("TE",  topAt(r.homeRoster, "TE"), topAt(r.awayRoster, "TE"))}
      ${row("OL",  r.homeRatings.ol,  r.awayRatings.ol)}
      ${row("DL",  r.homeRatings.dl,  r.awayRatings.dl)}
      ${row("LB",  r.homeRatings.lb,  r.awayRatings.lb)}
      ${row("CB",  r.homeRatings.cb,  r.awayRatings.cb)}
      ${row("S",   r.homeRatings.saf, r.awayRatings.saf)}
      ${starterRow("K",   topAt(r.homeRoster, "K"), topAt(r.awayRoster, "K"))}
    </tbody>
  `;
}

