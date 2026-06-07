// ── Route to correct phase UI ────────────────────────────────────────────────
// ─── In-loop nav rail — phase-driven Home/title rendering ──────────────────
// Sits between frnAppShell and frnHomeContent. Hidden on the start screen and
// during regular-season (the app-shell tab bar handles nav there). On every
// other phase shows a Home button + title + optional step indicator + an
// optional "progress saved" tooltip for locked-transactional screens.
//
// The Home button calls _frnGoHome() which saves the current franchise to its
// slot, clears the active in-memory state, and returns to the start screen.
// The user's franchise reappears in the slot list and can be reloaded — so
// "Home" is read-only return, never an undo.
const _FRN_PHASE_NAV = {
  preseason:            { title: "Preseason",        kind: "milestone" },
  free_agency:          { title: "Free Agency",      kind: "locked",   step: "Bidding window" },
  free_agency_results:  { title: "FA Results",       kind: "milestone" },
  fa_cuts:              { title: "Salary-Cap Cuts",  kind: "locked",   step: "Get cap-legal to advance" },
  playoffs_pending:     { title: "Playoffs",         kind: "locked" },
  playoffs:             { title: "Playoffs",         kind: "locked",   step: "Bracket saved between visits" },
  awards:               { title: "Season Awards",    kind: "milestone" },
  offseason:            { title: "Offseason",        kind: "locked",   step: "Re-signings + roster moves" },
  draft:                { title: "Draft",            kind: "locked",   step: "Picks saved between visits" },
  // Regular gets nothing — the app shell tab bar IS the nav. Start gets
  // nothing — the welcome card is the nav.
};
function _frnUpdateNavBar() {
  const navEl = $("frnNavBar");
  if (!navEl) return;
  if (!franchise) { navEl.style.display = "none"; return; }
  const phase = franchise.phase;
  // Milestone overlays (season recap, post-draft grade) render off booleans
  // even though phase says regular/draft. Detect them so the bar reflects the
  // overlay, not the underlying phase.
  const seasonOver = (franchise.week || 1) > (typeof FRANCHISE_WEEKS !== "undefined" ? FRANCHISE_WEEKS : 14);
  const onRecap = phase === "regular" && seasonOver && !franchise.playoffBracket;
  const onDraftGrade = phase === "draft" && franchise.draft == null;
  let cfg = _FRN_PHASE_NAV[phase];
  if (onRecap)      cfg = { title: "Season " + (franchise.season || 1) + " Recap", kind: "milestone" };
  if (onDraftGrade) cfg = { title: "Draft Grade",       kind: "milestone" };
  if (!cfg || phase === "regular") { navEl.style.display = "none"; return; }
  const seasonTag = franchise.season ? `Season ${franchise.season}` : "";
  const stepTxt   = cfg.step ? `<span class="frn-nav-step">${cfg.step}</span>` : "";
  const homeLabel = cfg.kind === "locked" ? "← Home (saved)" : "← Home";
  const homeHint  = cfg.kind === "locked"
    ? "Progress is saved — you can resume from the slot list anytime"
    : "Return to the franchise selector";
  navEl.style.display = "block";
  navEl.innerHTML = `
    <div class="frn-nav-bar ${cfg.kind === "locked" ? "locked" : "milestone"}">
      <button class="frn-nav-home" onclick="_frnGoHome()" title="${homeHint}">${homeLabel}</button>
      <div class="frn-nav-title">
        <span class="frn-nav-title-main">${cfg.title}</span>
        ${seasonTag ? `<span class="frn-nav-season">${seasonTag}</span>` : ""}
        ${stepTxt}
      </div>
      <div class="frn-nav-spacer"></div>
    </div>`;
}
function _frnGoHome() {
  // Save current franchise to its slot (no-op for in-progress writes that
  // haven't yet allocated a slot), clear the active in-memory franchise,
  // hide the in-loop chrome, and return to the start screen. The franchise
  // appears in the slot list and can be reloaded via [▶ Load].
  if (franchise) {
    try { saveFranchise(); } catch (_e) {}
  }
  franchise = null;
  if (typeof _readSlotsMeta === "function" && typeof _writeSlotsMeta === "function") {
    const meta = _readSlotsMeta();
    meta.activeSlotId = null;
    _writeSlotsMeta(meta);
  }
  const shellEl = $("frnAppShell"); if (shellEl) shellEl.style.display = "none";
  const footEl  = $("frnAppFooter"); if (footEl)  footEl.style.display = "none";
  const navEl   = $("frnNavBar");   if (navEl)   navEl.style.display   = "none";
  renderFrnStartScreen();
}

// Graceful error fallback for any franchise render crash. A render bug is NOT
// the same as a corrupt save (the data on disk is almost always fine), so the
// message must NOT alarm the user into abandoning a good franchise. Offers SAFE
// recovery first (Reload / Home-saved); "start new" is demoted to a reassuring
// link that explicitly preserves the current slot. Used by both the app-shell
// render and the phase dispatch below.
function _frnRenderError(err, phase) {
  try { console.error("[franchise render] crash on phase '" + phase + "':", err); } catch (_e) {}
  const host = (typeof $ === "function") ? $("frnHomeContent") : document.getElementById("frnHomeContent");
  if (!host) return;
  const safeMsg = String((err && err.message) || err || "unknown error").replace(/</g, "&lt;");
  host.innerHTML = `
    <div class="frn-welcome" style="max-width:560px;margin:2rem auto;text-align:center">
      <div class="frn-welcome-title" style="color:var(--gold)">⚠ This screen hit a display error</div>
      <div class="frn-welcome-sub" style="margin-top:.5rem">
        Your franchise is <b>safe</b> — this is a rendering glitch, not lost data.
        Reloading usually clears it; if it sticks, go Home and re-open the slot.
      </div>
      <div style="margin-top:1.1rem;display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-gold" onclick="location.reload()">⟳ Reload</button>
        <button class="btn" onclick="(typeof _frnGoHome==='function'?_frnGoHome():location.reload())">← Home (saved)</button>
      </div>
      <details style="margin-top:1.1rem;text-align:left;font-size:.65rem;color:var(--gray)">
        <summary style="cursor:pointer;color:var(--gold)">Technical details</summary>
        <div style="margin-top:.4rem;font-family:monospace;white-space:pre-wrap;word-break:break-word">phase: ${phase || "?"}
${safeMsg}</div>
      </details>
      <div style="margin-top:1rem;font-size:.6rem;color:var(--gray)">
        Still stuck? You can <a style="color:var(--gold);cursor:pointer" onclick="frnStartNew()">start a new franchise</a> —
        your current one stays saved in its slot.
      </div>
    </div>`;
}

// Idempotent: wrap every major franchise render entry point so a crash inside
// one — whatever invoked it (the dashboard dispatch OR any of the ~80 direct
// re-render call sites: a draft pick refreshing the board, an FA bid refreshing
// the market, an offseason action, etc.) — degrades to the recoverable error
// fallback instead of white-screening. These are classic-script function
// declarations (global-object properties), so reassigning the global name wraps
// it for every bare-name caller. Installed once, lazily, on the first dashboard
// render — by which point every file has loaded and every fn is defined.
let _frnRenderGuardsInstalled = false;
function _frnInstallRenderGuards() {
  if (_frnRenderGuardsInstalled) return;
  _frnRenderGuardsInstalled = true;
  const g = (typeof window !== "undefined") ? window
          : (typeof globalThis !== "undefined") ? globalThis : null;
  if (!g) return;
  const wrap = (name, label) => {
    const orig = g[name];
    if (typeof orig !== "function" || orig._frnGuarded) return;
    const wrapped = function (...args) {
      try { return orig.apply(this, args); }
      catch (err) { _frnRenderError(err, label || name); }
    };
    wrapped._frnGuarded = true;
    g[name] = wrapped;
  };
  [["renderFrnStartScreen", "start"], ["renderFrnPreseason", "preseason"],
   ["renderFrnFA", "free agency"], ["renderFrnFAResults", "FA results"], ["renderFrnFACuts", "FA cuts"],
   ["renderFrnSeasonRecap", "season recap"], ["renderFrnPlayoffs", "playoffs"],
   ["showFrnAwards", "awards"], ["renderFrnAwards", "awards"],
   ["renderFrnResignings", "re-signings"], ["_renderResignUI", "re-signings"], ["renderFrnOffseason", "offseason"],
   ["renderFrnDraftPreshow", "draft preshow"], ["renderFrnDraft", "draft"],
   ["renderFrnUDFAScramble", "UDFA"], ["_renderPostDraftGrade", "draft grade"],
   ["_frnRenderActiveTab", "regular season"]].forEach(([n, l]) => wrap(n, l));
}

function showFranchiseDashboard() {
  _frnInstallRenderGuards();
  // Dismiss any lingering hover tooltips when changing screens
  try { frnHoverTipHide && frnHoverTipHide(); } catch {}
  try { _frnHoverTipPgHide && _frnHoverTipPgHide(); } catch {}
  if (!franchise) { renderFrnStartScreen(); return; }
  // Surface the injury-repair report after _repairInjuries ran on load.
  // Shown once per save (gated by report.seenByUser).
  try { _showInjuryRepairBanner(); } catch (_e) {}
  // Week recap modal — pops once per completed week with the top plays
  try { _showWeekRecapIfReady && _showWeekRecapIfReady(); } catch (_e) {}
  // SAVE-MIGRATION / BACKFILL BLOCK (wrapped). Best-effort repairs for older
  // saves; many sub-steps already self-guard, but several backfills below
  // (assignContracts, the jersey / guaranteed-money / career loops, etc.) do
  // not — and they run BEFORE the dispatch boundary, so an unguarded throw here
  // would white-screen on load. Wrap the whole block: on failure, log and fall
  // through to render (the data is usually still renderable, and the dispatch's
  // own boundary catches any render crash). Body indentation left as-is to keep
  // this a minimal, low-risk defensive wrap.
  try {
  // Defensive defaults for older saves missing newer fields
  if (!franchise.phase)            franchise.phase = "regular";
  if (!franchise.seasonStats)      franchise.seasonStats = {};
  // One-time repair for saves predating idempotent stat-merge. If the
  // merged-game tracker is missing, the save may have double-counted
  // games whose markGamePlayed silently failed before a later Sim Week
  // re-merged them. Rebuild seasonStats from per-game schedule blobs.
  if (!franchise._mergedGameKeys) _repairSeasonStatsFromSchedule();
  // Heal FA negotiations that should have already signed but got stuck
  // by the pre-fix signFn ReferenceError or the float-precision miss
  // on the knockout threshold. Idempotent: only signs negotiations
  // whose standing bids actually clear the threshold.
  if (franchise.faNegotiations) {
    for (const name of Object.keys(franchise.faNegotiations)) {
      if (franchise.faNegotiations[name]?.state === "negotiating") {
        try { _faTryKnockout(name); } catch (e) { console.warn("[fa heal]", name, e); }
      }
    }
  }
  // One-time repair for stale PID-as-name strings baked into news and
  // _faLastNews from before the FA-news pid-leak fix. Replace any 8-char
  // base-36 token that maps to a real player's pid with that player's name.
  if (!franchise._pidNamesRepaired) {
    try { _repairNewsPidNames(); } catch (e) { console.warn("[news pid repair]", e); }
    franchise._pidNamesRepaired = true;
  }
  // One-time repair for contracts whose aav was clobbered by the
  // assignContracts retrofit pass (triggered when a fresh signing
  // lacked signedAav). baseSalaries + signingBonus still reflect the
  // true deal — recompute aav from them when there's a meaningful
  // mismatch.
  if (!franchise._contractAavRepaired) {
    try { _repairClobberedAavs(); } catch (e) { console.warn("[aav repair]", e); }
    franchise._contractAavRepaired = true;
  }
  // One-time repair for signed-FA career histories that were rewritten by
  // assignCareerTeams' seeded RNG every dashboard render. Any player whose
  // systemYears < careerHistory length was acquired (FA / trade) and should
  // have prior-team seasons — if their whole history collapsed to a single
  // team, re-stamp them with the FA-seeded distribution.
  // v2 flag: prior v1 repair had an off-by-one that overlaid the most-recent
  // row with the user's team even for systemYears=0 FAs. Run again to fix.
  // One-time repair for "long" stats (rec_long, pass_long, rush_long,
  // fg_long, int_long, punt_long) that were summed instead of maxed
  // across games. Rebuilds the current season's totals from per-game
  // blobs, recomputes career-long maxima from careerHistory, and clamps
  // any historical row above 99 yards (which can only be the sum bug).
  if (!franchise._longStatsRepaired) {
    try { _repairLongStats(); } catch (e) { console.warn("[long stats repair]", e); }
    franchise._longStatsRepaired = true;
  }
  if (!franchise._careerHistoryFaRepaired_v2) {
    // Clear the per-player "already assigned" flag so the v2 repair gets a
    // fresh pass at signed FAs the broken v1 pass already touched.
    for (const roster of Object.values(franchise.rosters || {})) {
      for (const p of roster) {
        if (p._careerTeamsAssigned && (p.systemYears != null) && p.systemYears < (p.careerHistory?.length || 0)) {
          delete p._careerTeamsAssigned;
        }
      }
    }
    try { _repairSignedFaCareerHistories(); } catch (e) { console.warn("[fa career repair v2]", e); }
    franchise._careerHistoryFaRepaired_v2 = true;
  }
  // One-time repair for career rows corrupted by the pre-fix
  // _rollSeasonStatsToCareer merge (overwrote age/ovr with current values,
  // collapsing multi-season cards to a single age) and the dashboard
  // generateCareer backfill creating phantom calendar-year rows alongside
  // real franchise-season rows. Also backfills careerEarnings for players
  // who served years but never had it ticked.
  if (!franchise._careerHistoryRepaired_v3) {
    try { _repairCareerHistoryAndEarnings_v3(); } catch (e) { console.warn("[career repair v3]", e); }
    franchise._careerHistoryRepaired_v3 = true;
  }
  // v4: restore prior-career rows for veterans whose calendar-year mock
  // history was stripped by the over-aggressive original v3 migration.
  // Detects players where careerStats reflects significantly more games
  // played than the visible careerHistory rows account for, then
  // synthesizes prior-team rows that sum to the missing stats.
  if (!franchise._careerHistoryRestored_v4) {
    try { _restorePriorCareerHistories_v4(); } catch (e) { console.warn("[career repair v4]", e); }
    franchise._careerHistoryRestored_v4 = true;
  }
  if (!franchise.seasonHighlights) franchise.seasonHighlights = [];
  if (!franchise.history)          franchise.history = [];
  if (!franchise.rosters)          franchise.rosters = {};
  if (!franchise.schedule)         franchise.schedule = [];
  if (!franchise.standings)        franchise.standings = initStandings();
  if (!franchise.salaryCap)        franchise.salaryCap = SALARY_CAP_BASE;
  // Backfill contracts + draft info for saves from before Phase 1
  assignContracts(franchise.rosters, franchise.salaryCap);
  const baseYear = new Date().getFullYear() + (franchise.season || 1) - 1;
  assignDraftInfo(franchise.rosters, baseYear);
  // Backfill picks for saves from before draft-picks-as-assets
  if (!franchise.picks || !franchise.picks.length) _initFranchisePicks();
  // Backfill coaching staff
  if (!franchise.coaches) _initCoachingStaff();
  // Backfill jersey numbers for any roster where players are missing
  // p.number (older saves, or new FA signees, or traded-in players).
  for (const [tid, roster] of Object.entries(franchise.rosters || {})) {
    if (roster.some(p => !p.number)) assignTeamJerseyNumbers(roster);
  }
  // Backfill guaranteed-money fields on contracts from older saves so
  // released-player dead-cap math works for everyone.
  for (const roster of Object.values(franchise.rosters || {})) {
    for (const p of roster) {
      if (p.contract && p.contract.guaranteedYears == null) {
        p.contract.guaranteedYears = _guaranteedYearsForLength(p.contract.years || p.contract.remaining || 1);
        p.contract.guaranteedAAV = p.contract.aav;
      }
      // Clamp guaranteed years so there's always at least 1 free year at the end.
      // Fixes saves where guaranteedYears was never decremented and every contract
      // became 100% dead cap.
      if (p.contract && p.contract.guaranteedYears != null) {
        const rem = p.contract.remaining || 0;
        p.contract.guaranteedYears = Math.max(0, Math.min(p.contract.guaranteedYears, rem - 1));
      }
    }
  }
  // Backfill practice squad data for older saves.
  if (!franchise.practiceSquads) franchise.practiceSquads = {};
  if (!Object.keys(franchise.practiceSquads).length) _seedPracticeSquads();
  if (!franchise.scoutVisits) franchise.scoutVisits = {};
  if (!franchise.scoutedPS) franchise.scoutedPS = {};
  if (!franchise.psPoachAlerts) franchise.psPoachAlerts = [];
  if (franchise.autoSpendScouts == null) franchise.autoSpendScouts = true;
  // Backfill mock career history for veterans loaded from very old saves
  // where generateCareer hadn't run with the careerHistory shape yet. The
  // guard skips:
  //   - rookies (age ≤ 22)
  //   - anyone who already has any careerHistory rows
  //   - anyone who has accumulated careerStats from real play
  //     (regenerating mocks would silently overwrite real history)
  //   - anyone we've already backfilled (per-player one-shot flag)
  for (const [tid, roster] of Object.entries(franchise.rosters || {})) {
    for (const p of roster) {
      if (p._careerGeneratedBackfill) continue;
      const age = p.age || 22;
      const hasHist = p.careerHistory && p.careerHistory.length > 0;
      const hasRealStats = p.careerStats && Object.keys(p.careerStats).length > 0;
      if (age > 22 && !hasHist && !hasRealStats) {
        generateCareer(p);
      }
      p._careerGeneratedBackfill = true;
    }
  }
  assignCareerTeams(franchise.rosters || {});

  // Heal FA players whose career history was built with the wrong age
  // (generated before the _generateFAPool fix). History length must equal
  // max(0, age - 22); if it doesn't, regenerate and re-assign team names.
  for (const p of franchise.freeAgents || []) {
    const expected = Math.max(0, (p.age || 22) - 22);
    const actual   = (p.careerHistory || []).length;
    if (actual !== expected) {
      generateCareer(p);
      _assignFACareerTeams(p);
    }
  }
  } catch (_repairErr) {
    console.warn("[franchise backfill] non-fatal, continuing to render:", _repairErr);
  }

  $("franchiseHome").style.display = "block";
  // Update the in-loop nav rail before dispatch. The router below decides
  // which render fn runs; the nav bar reflects the resulting phase + state.
  try { _frnUpdateNavBar(); } catch (_e) {}
  const { phase } = franchise;
  // Regular-season → playoffs transition screen. Detected by: phase
  // still "regular", every week of the season played, no bracket built
  // yet. Replaces the dashboard entirely so the moment feels like an
  // actual milestone instead of another button to click.
  const seasonOver = (franchise.week || 1) > FRANCHISE_WEEKS;
  const showRecap = phase === "regular" && seasonOver && !franchise.playoffBracket
    && typeof renderFrnSeasonRecap === "function";

  // App shell shows only during the regular season — playoffs / offseason /
  // free agency / draft each have their own self-contained UIs. Also
  // hidden during the season recap (full-screen takeover).
  const shellEl = $("frnAppShell");
  const footEl  = $("frnAppFooter");
  if (shellEl) {
    if (phase === "regular" && !showRecap) {
      shellEl.style.display = "block";
      // App-shell render is outside the dispatch try below, so guard it here —
      // a shell crash should degrade to the error fallback, not white-screen.
      if (typeof _frnRenderAppShell === "function") {
        try { _frnRenderAppShell(); }
        catch (err) { _frnRenderError(err, "regular (app shell)"); return; }
      }
    } else {
      shellEl.style.display = "none";
      // Hide the Bloomberg footer too in non-regular phases (it's
      // rendered as a sibling div, so its visibility tracks the shell).
      if (footEl) footEl.style.display = "none";
    }
  }
  try {
    if      (showRecap)                        renderFrnSeasonRecap();
    else if (phase === "preseason")            renderFrnPreseason();
    else if (phase === "free_agency")          renderFrnFA();
    else if (phase === "free_agency_results")  renderFrnFAResults();
    else if (phase === "fa_cuts")              renderFrnFACuts();
    else if (phase === "draft")                renderFrnDraft();
    else if (phase === "regular")              _frnRenderActiveTab();
    else if (phase === "playoffs_pending")     startFrnPlayoffs();
    else if (phase === "playoffs")         renderFrnPlayoffs();
    else if (phase === "awards")           showFrnAwards();
    else if (phase === "offseason") {
      if (franchise._resignPending?.length) {
        const cap = franchise.salaryCap || SALARY_CAP_BASE;
        const committed = (franchise.rosters[franchise.chosenTeamId] || [])
          .filter(p => p.contract && p.contract.remaining > 0)
          .reduce((s, p) => s + p.contract.aav, 0);
        _renderResignUI(cap, committed);
      } else {
        renderFrnOffseason();
      }
    }
    else                                   renderFrnStartScreen();
  } catch (err) {
    _frnRenderError(err, phase);
  }
}

// One-shot toast for the injury-repair migration. Reads
// franchise._injuryRepairReport (populated by _repairInjuries on load),
// renders a non-blocking banner across the bottom of the screen, and
// stamps seenByUser when the user clicks Dismiss.
function _showInjuryRepairBanner() {
  if (!franchise?._injuryRepairReport) return;
  const rep = franchise._injuryRepairReport;
  if (rep.seenByUser) return;
  if (document.getElementById("frn-injury-repair-toast")) return; // already up
  const KIND_LABEL = {
    "stale-zero":         "cleared (already healed)",
    "capped":             "duration capped to catalog max",
    "cleared-prior":      "prior-season carry-over cleared",
    "backfilled-history": "onset week backfilled",
  };
  const rows = rep.fixes.slice(0, 50).map(f => {
    const detail = f.kind === "capped" ? ` ${f.from}w → ${f.to}w`
                 : f.kind === "cleared-prior" && f.seasonsAgo ? ` (${f.seasonsAgo}+ seasons stale)`
                 : "";
    return `<div style="display:flex;justify-content:space-between;gap:.6rem;padding:.18rem 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:.62rem">
      <span><b style="color:var(--white)">${f.pos} ${f.name}</b> <span style="color:var(--gray)">· ${f.label}</span></span>
      <span style="color:var(--gold);font-size:.58rem">${KIND_LABEL[f.kind] || f.kind}${detail}</span>
    </div>`;
  }).join("");
  const more = rep.fixes.length > 50 ? `<div style="font-size:.6rem;color:var(--gray);text-align:center;padding:.3rem">…and ${rep.fixes.length - 50} more</div>` : "";
  const el = document.createElement("div");
  el.id = "frn-injury-repair-toast";
  el.style.cssText = "position:fixed;right:1rem;bottom:1rem;width:min(420px,90vw);max-height:60vh;background:var(--bg2);border:2px solid var(--gold);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.5);z-index:9000;font-family:inherit;overflow:hidden;display:flex;flex-direction:column";
  el.innerHTML = `
    <div style="background:rgba(200,169,0,.16);padding:.55rem .7rem;border-bottom:1px solid var(--gold);display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
      <div>
        <div style="font-size:.85rem;font-weight:900;color:var(--gold);letter-spacing:.5px">🩹 SAVE MIGRATION</div>
        <div style="font-size:.6rem;color:var(--gray);margin-top:.1rem">Cleaned ${rep.total} stale injury record${rep.total===1?"":"s"} from before the engine fix.</div>
      </div>
      <button onclick="frnDismissInjuryRepair()"
        style="background:var(--gold);color:#000;border:none;border-radius:3px;padding:.25rem .55rem;font-weight:700;font-size:.65rem;cursor:pointer;font-family:inherit">
        Got it
      </button>
    </div>
    <div style="overflow-y:auto;padding:.4rem .7rem">
      ${rows}${more}
    </div>
    <div style="padding:.35rem .7rem;font-size:.55rem;color:var(--gray);background:var(--bg3);border-top:1px solid var(--border);flex-shrink:0">
      These were repaired in-place. New games run on the current engine rules.
    </div>`;
  document.body.appendChild(el);
}
function frnDismissInjuryRepair() {
  const el = document.getElementById("frn-injury-repair-toast");
  if (el) el.remove();
  if (franchise?._injuryRepairReport) {
    franchise._injuryRepairReport.seenByUser = true;
    saveFranchise();
  }
}

// ── Team picker / welcome screen ─────────────────────────────────────────────
// Tier label for hover + detail screen
const TIER_LABEL = {
  powerhouse: "⭐ POWERHOUSE",
  contender:  "💪 CONTENDER",
  average:    "⚖ AVERAGE",
  rebuilding: "🔧 REBUILDING",
};

// Resolve roster/tier from either the live franchise OR the picker draft.
function _draftRosterFor(teamId) {
  return franchise?.rosters?.[teamId] || franchiseDraft?.rosters?.[teamId] || [];
}
function _draftTierFor(teamId) {
  return franchise?.teamTiers?.[teamId] || franchiseDraft?.teamTiers?.[teamId] || "average";
}

// Build a short scouting report for a team — 3-5 bullet points covering
// QB outlook, best/worst unit, age profile, and star presence.
function summarizeTeam(teamId) {
  const roster = _draftRosterFor(teamId);
  const tier   = _draftTierFor(teamId);
  const ratings = buildRatings(roster);
  const bullets = [];

  const qb = roster.filter(p => p.position === "QB").sort((a,b)=>b.overall-a.overall)[0];
  if (qb) {
    const g = scoutGrade(qb), age = qb.age || 25;
    if (age <= 24 && g >= 80)        bullets.push(`Promising young QB (age ${age}, ${gradeLabel(g)})`);
    else if (age >= 33 && g >= 85)   bullets.push(`Aging legend at QB (age ${age}) — win-now window`);
    else if (g >= 88)                bullets.push(`Elite QB anchors the offense`);
    else if (g >= 78)                bullets.push(`Reliable starting QB`);
    else if (g <= 60)                bullets.push(`Big question marks at QB`);
    else if (age <= 23)              bullets.push(`Developmental QB (age ${age})`);
  }

  const units = [
    { label:"rushing attack",   score: ratings.rb },
    { label:"receiving corps",  score: ratings.wr },
    { label:"offensive line",   score: ratings.ol },
    { label:"defensive line",   score: ratings.dl },
    { label:"linebacking corps",score: ratings.lb },
    { label:"secondary",        score: (ratings.cb + ratings.saf) / 2 },
  ];
  const sortedUnits = units.slice().sort((a,b) => b.score - a.score);
  const best = sortedUnits[0], worst = sortedUnits[sortedUnits.length-1];
  if (best.score  >= 80) bullets.push(`Strength: ${best.label}`);
  if (worst.score <= 64) bullets.push(`Weakness: ${worst.label}`);

  const totalAge = roster.reduce((s,p)=>s+(p.age||25),0);
  const avgAge = totalAge / Math.max(1, roster.length);
  if (avgAge < 25.3)      bullets.push(`Youthful core (avg age ${avgAge.toFixed(1)})`);
  else if (avgAge > 28.0) bullets.push(`Veteran-heavy (avg age ${avgAge.toFixed(1)})`);

  const stars = roster.filter(p => scoutGrade(p) >= 87);
  if (stars.length === 0)      bullets.push(`No headline talent`);
  else if (stars.length === 1) bullets.push(`Built around ${stars[0].name} (${stars[0].position})`);
  else if (stars.length >= 4)  bullets.push(`Stacked: ${stars.length} A-grade players`);

  return { tier, bullets: bullets.slice(0, 5) };
}

function renderFrnTeamPicker() {
  const confOrder = [
    "AFC East","AFC North","AFC South","AFC West",
    "NFC East","NFC North","NFC South","NFC West",
  ];
  const groups = {};
  for (const t of TEAMS) {
    const k = `${t.conference} ${t.division}`;
    (groups[k] = groups[k] || []).push(t);
  }
  let pickerHtml = `<div class="frn-picker-grid">`;
  for (const divKey of confOrder) {
    const teams = groups[divKey] || [];
    pickerHtml += `<div>
      <div style="font-size:.62rem;color:var(--gold);letter-spacing:.5px;margin-bottom:.3rem">${divKey.toUpperCase()}</div>
      <div class="frn-team-grid">`;
    for (const t of teams) {
      const tier    = _draftTierFor(t.id);
      const roster  = _draftRosterFor(t.id);
      const ratings = buildRatings(roster);
      pickerHtml += `<button class="frn-team-btn"
        onclick="renderFrnTeamDetail(${t.id})"
        onmouseenter="frnTeamTipShow(event,${t.id})"
        onmouseleave="frnTeamTipHide()"
        style="border-left:4px solid ${t.primary}">
        <span class="frn-ascii">${t.emoji || teamAscii(t)}</span>
        <div class="frn-team-btn-body">
          <span class="frn-team-btn-name">${t.city} ${t.name}</span>
          <span class="frn-team-btn-meta">OFF ${Math.round(ratings.offense)} · DEF ${Math.round(ratings.defense)} · ${roster.length} players</span>
        </div>
        <div class="frn-team-btn-right">
          <div class="frn-team-colors">
            <span class="frn-color-swatch" style="background:${t.primary}" title="${t.primary}"></span>
            <span class="frn-color-swatch" style="background:${t.secondary||'#fff'}" title="${t.secondary||''}"></span>
          </div>
          <span class="frn-team-tier tier-${tier}">${tier[0].toUpperCase()}</span>
        </div>
      </button>`;
    }
    pickerHtml += `</div></div>`;
  }
  pickerHtml += `</div>`;

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.8rem;flex-wrap:wrap">
      <button class="btn btn-outline" onclick="renderFrnStartScreen()">← Back</button>
      <div style="font-size:1.1rem;font-weight:700;color:var(--gold)">CHOOSE YOUR TEAM</div>
      <button class="btn btn-outline" onclick="frnRerollLeague()" style="margin-left:auto;font-size:.7rem" title="Reroll the entire league">🎲 Reroll League</button>
    </div>
    <div class="frn-picker-intro">
      Hover for a quick scout report · Click a team to inspect them in depth before choosing.
      League tiers: <span style="color:var(--gold-lt)">P=Powerhouse</span> ·
      <span style="color:#9be09b">C=Contender</span> ·
      <span style="color:var(--gray)">A=Average</span> ·
      <span style="color:#c08080">R=Rebuilding</span>
    </div>
    ${pickerHtml}
  `;
}

// Floating hover tooltip — single shared element appended to body.
function frnTeamTipShow(e, teamId) {
  let tip = document.getElementById("frn-team-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "frn-team-tooltip";
    tip.className = "frn-team-tooltip";
    document.body.appendChild(tip);
  }
  const team    = getTeam(teamId);
  const summary = summarizeTeam(teamId);
  const ratings = buildRatings(_draftRosterFor(teamId));
  tip.innerHTML = `
    <div class="frn-tip-head">
      <span style="color:var(--gold);font-size:1.2rem">${teamAscii(team)}</span>
      <span style="font-weight:900">${team.city} ${team.name}</span>
    </div>
    <div class="frn-tip-tier tier-${summary.tier}">${TIER_LABEL[summary.tier]}</div>
    <div class="frn-tip-ratings">
      OFF <b style="color:var(--gold)">${Math.round(ratings.offense)}</b> ·
      DEF <b style="color:var(--gold)">${Math.round(ratings.defense)}</b>
    </div>
    ${summary.bullets.map(b => `<div class="frn-tip-bullet">• ${b}</div>`).join("")}
    <div class="frn-tip-foot">Click to inspect roster</div>
  `;
  tip.style.display = "block";
  // Position near the team button, clamped to viewport
  const rect = e.currentTarget.getBoundingClientRect();
  const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
  let left = rect.right + 8;
  if (left + tipW > window.innerWidth - 8) left = rect.left - tipW - 8;
  let top = rect.top;
  if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8;
  if (top < 8) top = 8;
  tip.style.left = left + "px";
  tip.style.top  = top  + "px";
}

function frnTeamTipHide() {
  const tip = document.getElementById("frn-team-tooltip");
  if (tip) tip.style.display = "none";
}

// Team detail view — shown after a click in the picker.
function renderFrnTeamDetail(teamId) {
  frnTeamTipHide();
  const team   = getTeam(teamId);
  const roster = _draftRosterFor(teamId);
  const tier   = _draftTierFor(teamId);
  const ratings = buildRatings(roster);
  const summary = summarizeTeam(teamId);

  const byPos = {};
  for (const p of roster) (byPos[p.position] = byPos[p.position] || []).push(p);
  for (const pos of Object.keys(byPos)) byPos[pos].sort((a,b)=>b.overall-a.overall);

  const renderDepthRow = (p, slot) => `<tr>
    <td class="frn-scout-slot">${slot}</td>
    <td>${p.name}</td>
    <td>${gradeBadge(p)}</td>
    <td style="color:var(--gray)">${p.age||"?"}</td>
    <td style="color:var(--gray);font-size:.66rem">${draftStr(p)}</td>
    <td style="color:var(--gold);font-size:.7rem">$${(p.contract?.aav||0).toFixed(1)}M</td>
  </tr>`;

  const buildDepth = positions => positions.map(({pos, n}) => {
    const players = (byPos[pos] || []).slice(0, n);
    return players.map((p, i) => renderDepthRow(p, players.length>1 ? `${pos}${i+1}` : pos)).join("");
  }).join("");

  const offenseDepth = buildDepth([
    {pos:"QB", n:1}, {pos:"RB", n:1}, {pos:"WR", n:3},
    {pos:"TE", n:1}, {pos:"OL", n:5},
  ]);
  const defenseDepth = buildDepth([
    {pos:"DL", n:4}, {pos:"LB", n:3}, {pos:"CB", n:2}, {pos:"S", n:2},
  ]);
  const stDepth = buildDepth([{pos:"K", n:1}, {pos:"P", n:1}]);

  // Star players — top 6 by scout grade
  const stars = roster.slice().sort((a,b) => scoutGrade(b) - scoutGrade(a)).slice(0, 6);

  // ── Franchise vitals ───────────────────────────────────────────────────────
  const capUsedPrev = roster.reduce((s,p) => s+(p.contract?.aav||0), 0);
  const capBase = SALARY_CAP_BASE || 220;
  const capLeft = capBase - capUsedPrev;
  const avgAge  = roster.length ? (roster.reduce((s,p)=>s+(p.age||25),0)/roster.length).toFixed(1) : "—";
  const qb      = roster.filter(p=>p.position==="QB").sort((a,b)=>b.overall-a.overall)[0];
  const pb      = (typeof getPlaybook === "function") ? getPlaybook(team) : null;
  const pbLabel = pb?.name || team.playbook?.replace(/_/g," ") || "Balanced";
  const tierDesc = { powerhouse:"Turn-Key Contender", contender:"Solid Foundation", average:"Development Mode", rebuilding:"Full Rebuild" }[summary.tier] || "";
  const diffColor = { powerhouse:"#7dff97", contender:"#aaffaa", average:"var(--gold)", rebuilding:"#ff9090" }[summary.tier] || "var(--gray)";

  // Position depth counts
  const posCounts = {};
  for (const p of roster) posCounts[p.position] = (posCounts[p.position]||0)+1;
  const depthStr = ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"]
    .filter(p => posCounts[p])
    .map(p => `${p} ×${posCounts[p]}`).join("  ·  ");

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <button class="btn btn-outline" onclick="renderFrnTeamPicker()">← Back to picker</button>
      <div style="font-size:.75rem;color:var(--gray)">Inspect roster before committing</div>
      <button class="btn btn-gold-big" onclick="startFranchise(${teamId})" style="margin-left:auto">
        ✓ CHOOSE ${team.name.toUpperCase()}
      </button>
    </div>

    <div class="frn-team-banner" style="--banner-color:${team.primary}">
      <div class="frn-banner-stripe"></div>
      <div class="frn-banner-ascii" style="font-size:1.6rem">${team.emoji || teamAscii(team)}</div>
      <div class="frn-banner-info" style="flex:1">
        <div class="frn-banner-name">${team.city.toUpperCase()} ${team.name.toUpperCase()}</div>
        <div class="frn-banner-sub">${team.conference} ${team.division} · <span style="color:var(--gold-lt)">${TIER_LABEL[summary.tier]}</span> · OFF ${Math.round(ratings.offense)} · DEF ${Math.round(ratings.defense)}</div>
        <div class="frn-color-bar" style="max-width:120px">
          <div class="frn-color-bar-seg" style="background:${team.primary}"></div>
          <div class="frn-color-bar-seg" style="background:${team.secondary||'#fff'}"></div>
        </div>
      </div>
    </div>

    <div class="frn-vitals-grid">
      <div class="frn-vital-cell">
        <span class="frn-vital-label">FRANCHISE MODE</span>
        <span class="frn-vital-value" style="color:${diffColor}">${tierDesc}</span>
        <span class="frn-vital-sub">${TIER_LABEL[summary.tier]}</span>
      </div>
      <div class="frn-vital-cell">
        <span class="frn-vital-label">ROSTER</span>
        <span class="frn-vital-value">${roster.length} players</span>
        <span class="frn-vital-sub">Avg age ${avgAge}</span>
      </div>
      <div class="frn-vital-cell">
        <span class="frn-vital-label">CAP SPACE</span>
        <span class="frn-vital-value" style="color:${capLeft<20?'#ff9090':capLeft>50?'#7dff97':'var(--gold)'}">$${capLeft.toFixed(0)}M</span>
        <span class="frn-vital-sub">$${capUsedPrev.toFixed(0)}M committed</span>
      </div>
      <div class="frn-vital-cell">
        <span class="frn-vital-label">COLORS</span>
        <span class="frn-vital-value" style="display:flex;align-items:center;gap:.3rem">
          <span style="background:${team.primary};width:1.1rem;height:1.1rem;display:inline-block;border-radius:2px;border:1px solid rgba(255,255,255,0.15)"></span>
          <span style="background:${team.secondary||'#fff'};width:1.1rem;height:1.1rem;display:inline-block;border-radius:2px;border:1px solid rgba(255,255,255,0.15)"></span>
        </span>
        <span class="frn-vital-sub">${pbLabel}</span>
      </div>
    </div>

    <div style="font-size:.58rem;color:var(--gray);margin-bottom:.7rem;letter-spacing:.3px">${depthStr}</div>

    <div class="frn-card-box" style="margin-bottom:.8rem">
      <div class="frn-card-title">📋 SCOUT REPORT</div>
      <ul class="frn-summary-bullets">
        ${summary.bullets.map(b => `<li>${b}</li>`).join("")}
      </ul>
    </div>

    <div class="frn-dash-grid">
      <div class="frn-card-box">
        <div class="frn-card-title">OFFENSE DEPTH</div>
        <table class="frn-pre-roster-table">
          <thead><tr><th></th><th>Player</th><th>Grade</th><th>Age</th><th>Draft</th><th>AAV</th></tr></thead>
          <tbody>${offenseDepth}</tbody>
        </table>
      </div>
      <div class="frn-card-box">
        <div class="frn-card-title">DEFENSE DEPTH</div>
        <table class="frn-pre-roster-table">
          <thead><tr><th></th><th>Player</th><th>Grade</th><th>Age</th><th>Draft</th><th>AAV</th></tr></thead>
          <tbody>${defenseDepth}</tbody>
        </table>
      </div>
    </div>

    <div class="frn-card-box" style="margin-top:.8rem">
      <div class="frn-card-title">SPECIAL TEAMS</div>
      <table class="frn-pre-roster-table">
        <thead><tr><th></th><th>Player</th><th>Grade</th><th>Age</th><th>Draft</th><th>AAV</th></tr></thead>
        <tbody>${stDepth}</tbody>
      </table>
    </div>

    <div class="frn-card-box" style="margin-top:.8rem">
      <div class="frn-card-title">⭐ TOP TALENT</div>
      <div class="frn-team-stars">
        ${stars.map(p => `<div class="frn-star-pill">
          ${gradeBadge(p)}
          <span style="font-weight:700">${p.name}</span>
          <span style="color:var(--gray);font-size:.65rem">${p.position} · age ${p.age||"?"} · ${draftStr(p)}</span>
        </div>`).join("")}
      </div>
    </div>

    <div class="frn-actions" style="justify-content:center;margin-top:1rem">
      <button class="btn btn-gold-big" onclick="startFranchise(${teamId})">✓ CHOOSE ${team.name.toUpperCase()}</button>
      <button class="btn btn-outline" onclick="renderFrnTeamPicker()">← Pick a different team</button>
    </div>
  `;
}

// Compute basic team rating (offense/defense averages) for display
function frnTeamRating(teamId) {
  const roster = franchise.rosters[teamId] || [];
  const r = buildRatings(roster);
  return { off: Math.round(r.offense), def: Math.round(r.defense), qb: Math.round(r.qb) };
}

// Compute season leaders for a single team (top stat-holder per category)
function frnTeamLeaders(teamId) {
  const players = franchise.seasonStats?.[teamId] || {};
  const list = Object.values(players);
  if (!list.length) return [];
  const out = [];
  const best = (key, label, fmt) => {
    const top = list.filter(p => p[key]).sort((a, b) => b[key] - a[key])[0];
    if (top && top[key] > 0) out.push({ cat: label, name: top.name, stat: fmt(top) });
  };
  best("pass_yds", "PASS", p => `${p.pass_yds} yds · ${p.pass_td || 0} TD`);
  best("rush_yds", "RUSH", p => `${p.rush_yds} yds · ${p.rush_td || 0} TD`);
  best("rec_yds",  "REC",  p => `${p.rec_yds} yds · ${p.rec_td || 0} TD`);
  best("sk",       "SACKS",p => `${(+p.sk).toFixed(1)} sacks`);
  best("int_made", "INTs", p => `${p.int_made} INT`);
  best("tkl",      "TKL",  p => `${p.tkl} tackles`);
  return out;
}

// ── Regular-season dashboard (polished inline layout) ────────────────────────
// ── Pre-season screen: roster review, schedule preview, scout opponents ───────
function renderFrnPreseason(tab, scoutId, scoutView, selName) {
  tab = tab || "roster";
  const { chosenTeamId, season, salaryCap, schedule, teamTiers } = franchise;
  const cap = effectiveSalaryCap(chosenTeamId);
  const myTeam = getTeam(chosenTeamId);
  const myRoster = franchise.rosters[chosenTeamId] || [];
  const capUsed = capUsedByTeam(chosenTeamId);
  const capLeft = cap - capUsed;
  const myRtg = frnTeamRating(chosenTeamId);
  const overCap = capLeft < 0;
  const myTier = teamTiers?.[chosenTeamId];
  const tierLabel = myTier
    ? { powerhouse:"⭐ POWERHOUSE", contender:"💪 CONTENDER",
        average:"⚖ AVERAGE", rebuilding:"🔧 REBUILDING" }[myTier] || ""
    : "";

  const bannerHtml = `
    <div class="frn-team-banner" style="--banner-color:${myTeam.primary}">
      <div class="frn-banner-stripe"></div>
      <div class="frn-banner-ascii">${teamAscii(myTeam)}</div>
      <div class="frn-banner-info">
        <div class="frn-banner-name">${myTeam.city.toUpperCase()} ${myTeam.name.toUpperCase()}</div>
        <div class="frn-banner-sub">
          Season ${season} · Pre-Season Camp · OFF ${myRtg.off} · DEF ${myRtg.def}
          ${tierLabel ? ` · <span style="color:var(--gold-lt)">${tierLabel}</span>` : ""}
        </div>
        <div class="frn-banner-cap" style="color:${overCap?"var(--red)":capUsed/cap>=0.95?"#e8a000":"var(--green-lt)"}">
          CAP $${capUsed.toFixed(1)}M / $${cap.toFixed(0)}M
          <span style="color:var(--gray);font-weight:400"> · Room $${capLeft.toFixed(1)}M</span>
          <button class="frn-cap-btn" onclick="renderFrnAnalytics('mysheet')">📊 Analytics</button>
        </div>
      </div>
      <div style="text-align:right">
        ${franchise.phase === "preseason"
          ? `<button class="btn btn-gold-big" onclick="frnStartSeason()">▶ START SEASON ${season}</button>`
          : `<button class="btn btn-outline" onclick="showFranchiseDashboard()">◀ Back to Week ${franchise.week || ""}</button>`
        }
      </div>
    </div>`;

  const tabs = [
    { id:"roster",   label:"📋 MY ROSTER" },
    { id:"ps",       label:"🏋 PRACTICE SQUAD" },
    { id:"schedule", label:"📅 SCHEDULE" },
    { id:"scout",    label:"🔍 SCOUT" },
  ];
  const tabBar = tabs.map(t =>
    `<button class="frn-ana-tab ${t.id===tab?"active":""}" onclick="renderFrnPreseason('${t.id}')">${t.label}</button>`
  ).join("");

  let body;
  if      (tab === "roster")   body = _preseasonRosterTab(myRoster, selName);
  else if (tab === "ps")       body = _buildPSTab(chosenTeamId);
  else if (tab === "schedule") body = _preseasonScheduleTab(schedule, chosenTeamId);
  else                         body = _preseasonScoutTab(chosenTeamId, scoutId, scoutView, selName);

  // Fix 3: Over-cap wizard — shown instead of normal content when significantly over cap.
  const overCapWizard = (() => {
    if (capLeft >= 0) return "";
    const overBy = Math.abs(capLeft);
    const roster = myRoster.filter(p => p.contract);

    // Sort candidates: free cuts first (no dead cap), then by net savings descending
    const candidates = roster.map(p => {
      const hit = currentYearCapHit(p);
      const { perYear: deadPY, years: deadYrs } = deadCapOnRelease(p);
      const dead = deadPY * Math.min(deadYrs, 1); // Only this year's dead cap matters for relief
      const netSave = hit - dead;
      return { p, hit, dead, deadPY, deadYrs, netSave };
    }).filter(c => c.netSave > 0.3)
      .sort((a, b) => {
        // Free cuts (no dead cap) first, then by net savings
        const aFree = a.dead < 0.5 ? 1 : 0;
        const bFree = b.dead < 0.5 ? 1 : 0;
        if (aFree !== bFree) return bFree - aFree;
        return b.netSave - a.netSave;
      })
      .slice(0, 12);

    const rows = candidates.map(({ p, hit, dead, deadPY, deadYrs, netSave }) => {
      const escN = p.name.replace(/'/g, "\\'");
      const isFree = dead < 0.5;
      return `<tr style="${isFree ? "background:rgba(0,180,0,.06)" : ""}">
        <td style="font-weight:700;color:${isFree?"var(--green-lt)":"var(--white)"}">${isFree?"✓ ":""}${p.name}</td>
        <td style="color:var(--gray);font-size:.68rem">${p.position}</td>
        <td>${gradeBadge(p)}</td>
        <td style="color:var(--red);font-weight:700">$${hit.toFixed(1)}M</td>
        <td style="color:${isFree?"var(--gray)":"#ff9090"};font-size:.65rem">${isFree ? "No dead cap" : `☠ $${deadPY.toFixed(1)}M×${deadYrs}yr`}</td>
        <td style="color:var(--green-lt);font-weight:700">+$${netSave.toFixed(1)}M</td>
        <td style="color:var(--gray);font-size:.65rem">${p.contract.remaining}yr</td>
        <td><button class="btn btn-outline" onclick="frnReleasePlayer('${escN}','${p.position}')" style="font-size:.6rem;padding:.15rem .4rem;color:var(--red)">✗ Cut</button></td>
      </tr>`;
    }).join("");

    return `<div style="background:rgba(220,50,50,.08);border:1px solid rgba(220,50,50,.4);border-radius:6px;padding:.8rem 1rem;margin-bottom:.8rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;flex-wrap:wrap;gap:.4rem">
        <div>
          <span style="font-size:1rem;font-weight:900;color:var(--red)">⚠ OVER THE CAP BY $${overBy.toFixed(1)}M</span>
          <span style="color:var(--gray);font-size:.72rem;margin-left:.6rem">Must get under $${cap.toFixed(0)}M to start the season</span>
        </div>
        <div style="display:flex;gap:.5rem">
          <button class="btn btn-outline" onclick="renderFrnAnalytics('cuts')" style="font-size:.68rem">📋 Full Cut List</button>
          <button class="btn btn-outline" onclick="renderFrnAnalytics('caphealth')" style="font-size:.68rem">↺ Restructures</button>
        </div>
      </div>
      <p style="font-size:.63rem;color:var(--gray);margin-bottom:.5rem">✓ Green rows = free cuts (no dead cap). Cut these first. Net save = cap relief after dead money.</p>
      <div style="overflow-x:auto"><table class="frn-ana-table" style="font-size:.7rem">
        <thead><tr><th>Player</th><th>Pos</th><th>Grade</th><th>Cap Hit</th><th>Dead Cap</th><th>Net Save</th><th>Yrs</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  })();

  // In-season scout view: the app shell already provides Roster / Front
  // Office / League / Tools tabs at the top, so drop the preseason wrapper
  // (banner + 4-tab bar + footer) and render just the scout body with a
  // small back button. Preseason keeps the full wrapper since the app
  // shell isn't rendered until the regular season starts.
  if (franchise.phase !== "preseason" && tab === "scout") {
    $("frnHomeContent").innerHTML = `
      <div class="frn-scout-standalone">
        <div class="frn-scout-standalone-head">
          <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="font-size:.7rem;padding:.2rem .6rem">← Back</button>
          <div class="frn-scout-standalone-title">🔍 Scout</div>
        </div>
        ${body}
      </div>`;
    return;
  }

  $("frnHomeContent").innerHTML = `
    ${bannerHtml}
    ${overCapWizard}
    <div class="frn-ana-tabs">${tabBar}</div>
    <div class="frn-ana-body">${body}</div>
    <div class="frn-footer-row">
      <div class="frn-footer-info">Pre-season — review and tinker before Week 1 kicks off</div>
      <button class="btn btn-outline frn-abandon-btn" onclick="frnAbandon()">× Abandon</button>
    </div>`;
}

function _buildPSTab(myId) {
  const myPS = franchise.practiceSquads?.[myId] || [];
  const myRoster = franchise.rosters[myId] || [];
  const psCost = psCostForTeam(myId);
  const poachAlerts = (franchise.psPoachAlerts || []).filter(a => a.ownerTeamId === myId);
  const eligible = myRoster.filter(p => _psEligible(p));

  const alertsHtml = poachAlerts.map(a => {
    const ep = (a.playerName || "").replace(/'/g, "\\'");
    return `<div style="background:rgba(220,50,50,.12);border:1px solid rgba(220,50,50,.4);border-radius:4px;padding:.45rem .55rem;margin-bottom:.4rem">
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
        <span style="font-size:.88rem">⚠️</span>
        <b style="color:var(--red);font-size:.78rem">${a.position} ${a.playerName}</b>
        <span style="font-size:.62rem;color:var(--gray)">being scouted by ${getTeam(a.suitorTeamId)?.name||"rival"} — promote by end of Wk ${a.deadlineWeek}</span>
        <button onclick="frnPSPromote('${ep}')"
          style="margin-left:auto;background:rgba(245,197,66,.15);border:1px solid var(--gold);color:var(--gold-lt);font-size:.63rem;padding:.18rem .55rem;border-radius:3px;cursor:pointer;font-family:inherit;font-weight:700">
          ⬆ PROMOTE NOW
        </button>
      </div>
    </div>`;
  }).join("");

  const psRows = myPS.map(p => {
    const ep = (p.name || "").replace(/'/g, "\\'");
    const epid = (p.pid || "").replace(/'/g, "\\'");
    const flashLog = p._psFlashLog || [];
    const recentFlashes = flashLog.filter(f => f.season === franchise.season);
    const gemFlash = recentFlashes.find(f => f.kind === "gem");
    const wowFlash = recentFlashes.find(f => f.kind === "wow");
    const flashBadge = gemFlash
      ? `<span style="font-size:.6rem;color:var(--gold);font-weight:700">💎 GEM +${gemFlash.ovrBoost}</span>`
      : wowFlash
      ? `<span style="font-size:.6rem;color:#9be09b;font-weight:700">⭐ +${wowFlash.ovrBoost}</span>` : "";
    const isAlert = poachAlerts.some(a => a.playerName === p.name);
    return `<div style="display:flex;align-items:center;gap:.4rem;padding:.32rem .45rem;background:${isAlert?"rgba(220,50,50,.08)":"var(--bg2)"};border:1px solid ${isAlert?"rgba(220,50,50,.35)":"var(--border)"};border-radius:4px;margin-bottom:.22rem">
      <span style="font-size:.58rem;color:var(--gold);font-weight:700;min-width:1.6rem">${p.position}</span>
      <span style="font-size:.72rem;font-weight:700;flex:1;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px"
        onclick="frnOpenPlayerCard('${ep}','${epid}')">${p.name}</span>
      ${gradeBadge(p)}
      <span style="font-size:.6rem;color:var(--gray)">Age ${p.age||"?"}</span>
      ${flashBadge}
      <button onclick="frnPSPromote('${ep}')"
        style="background:rgba(245,197,66,.1);border:1px solid var(--gold);color:var(--gold-lt);font-size:.58rem;padding:.12rem .38rem;border-radius:3px;cursor:pointer;font-family:inherit;flex-shrink:0">
        ⬆ Promote
      </button>
    </div>`;
  }).join("");

  const eligRows = eligible.filter(p => !myPS.some(x => x.name === p.name)).map(p => {
    const ep = (p.name || "").replace(/'/g, "\\'");
    const epid = (p.pid || "").replace(/'/g, "\\'");
    const slotsLeft = Math.max(0, PS_SLOTS - myPS.length);
    return `<div style="display:flex;align-items:center;gap:.4rem;padding:.28rem .45rem;background:var(--bg3);border:1px solid var(--border);border-radius:4px;margin-bottom:.18rem;opacity:${slotsLeft<=0?.45:1}">
      <span style="font-size:.58rem;color:var(--gold);font-weight:700;min-width:1.6rem">${p.position}</span>
      <span style="font-size:.68rem;font-weight:700;flex:1;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px"
        onclick="frnOpenPlayerCard('${ep}','${epid}')">${p.name}</span>
      ${gradeBadge(p)}
      <span style="font-size:.6rem;color:var(--gray)">Age ${p.age||"?"}</span>
      <button onclick="frnPSStash('${ep}')" ${slotsLeft<=0?"disabled":""}
        style="background:rgba(100,100,255,.1);border:1px solid #8888ff;color:#aaaaff;font-size:.58rem;padding:.12rem .38rem;border-radius:3px;cursor:${slotsLeft<=0?"not-allowed":"pointer"};font-family:inherit;flex-shrink:0">
        ↓ Stash
      </button>
    </div>`;
  }).join("");

  return `<div style="max-width:680px">
    <div style="padding:.5rem .65rem;background:var(--bg3);border:1px solid var(--border);border-radius:4px;margin-bottom:.7rem;display:flex;gap:1.2rem;flex-wrap:wrap;font-size:.65rem">
      <div><span style="color:var(--blgray);font-size:.52rem;letter-spacing:.5px">SLOTS</span><br><b style="color:${myPS.length>=PS_SLOTS?"var(--red)":"var(--green-lt)"};font-size:.85rem">${myPS.length}/${PS_SLOTS}</b></div>
      <div><span style="color:var(--blgray);font-size:.52rem;letter-spacing:.5px">PS CAP COST</span><br><b style="font-size:.85rem">$${psCost.toFixed(1)}M/yr</b></div>
      <div style="flex:1;font-size:.6rem;color:var(--gray);align-self:center">
        PS players flash in practice and can earn promotion. Rival teams can poach your gems — promote before the deadline.
      </div>
    </div>
    ${alertsHtml ? `<div style="margin-bottom:.5rem">${alertsHtml}</div>` : ""}
    <div style="font-size:.55rem;letter-spacing:.6px;color:var(--blgray);font-weight:700;margin-bottom:.28rem">MY PRACTICE SQUAD (${myPS.length}/${PS_SLOTS})</div>
    ${myPS.length ? psRows : `<div style="color:var(--gray);font-size:.7rem;font-style:italic;padding:.4rem 0">No players on your practice squad.</div>`}
    ${eligRows ? `
    <div style="font-size:.55rem;letter-spacing:.6px;color:var(--blgray);font-weight:700;margin:1rem 0 .28rem">ELIGIBLE TO STASH (age ≤${PS_MAX_AGE}, ≤${PS_MAX_YEARS_EXP} seasons exp)</div>
    ${eligRows}` : ""}
  </div>`;
}

async function frnPSPromote(playerName) {
  const myId = franchise.chosenTeamId;
  const ps = franchise.practiceSquads?.[myId] || [];
  const p = ps.find(x => x.name === playerName);
  if (!p) return;
  const myRoster = franchise.rosters[myId] || [];
  if (myRoster.length >= 53) {
    if (!await _frnConfirm(`Your roster is full (53 players). Promote ${p.name} anyway? You'll need to cut someone.`)) return;
  }
  _psPromote(myId, p);
  saveFranchise();
  renderFrnPreseason("ps");
}

function frnPSStash(playerName) {
  const myId = franchise.chosenTeamId;
  const myPS = franchise.practiceSquads?.[myId];
  if (!myPS) return;
  if (myPS.length >= PS_SLOTS) { alert(`Practice squad is full (${PS_SLOTS} slots).`); return; }
  const roster = franchise.rosters[myId] || [];
  const idx = roster.findIndex(p => p.name === playerName);
  if (idx === -1) return;
  const [p] = roster.splice(idx, 1);
  p._psFlashLog = p._psFlashLog || [];
  p._psStashedSeason = franchise.season || 1;
  myPS.push(p);
  saveFranchise();
  renderFrnPreseason("ps");
}

function _preseasonRosterTab(roster, selName) {
  const posOrder = ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];
  const groups = {};
  for (const p of roster) (groups[p.position] = groups[p.position] || []).push(p);

  // Default selected: highest-OVR player on the team
  let selected = null;
  if (selName) selected = roster.find(p => p.pid === selName || p.name === selName);
  if (!selected) selected = roster.slice().sort((a,b) => b.overall - a.overall)[0];

  // Cap context for the header
  const myId = franchise.chosenTeamId;
  const cap = effectiveSalaryCap(myId);
  const capUsed = capUsedByTeam(myId);
  const capLeft = cap - capUsed;
  const j1Used = _june1Used(myId);
  const j1Left = JUNE1_DESIGNATIONS_PER_TEAM - j1Used;

  // Decision-panel mode: when a release is pending, the right pane becomes
  // a side-by-side Standard vs Post-June-1 comparison instead of the player
  // detail panel. Player detail still shows when nothing is pending.
  const pendingDecisionHtml = _releasePending
    ? _buildReleaseDecisionPanel(roster)
    : null;

  // Header strip: cap meter + post-June 1 counter — top-of-page context.
  const capPct = Math.min(100, capUsed / cap * 100);
  const capColor = capUsed >= cap * 0.97 ? "var(--red)" : capUsed >= cap * 0.88 ? "#e8a000" : "var(--green-lt)";
  const headerHtml = `
    <div style="display:flex;align-items:center;gap:.8rem;padding:.5rem .7rem;background:var(--bg3);border:1px solid var(--border);border-radius:5px;margin-bottom:.65rem;flex-wrap:wrap">
      <div style="flex:1;min-width:280px">
        <div style="display:flex;justify-content:space-between;font-size:.6rem;color:var(--gray);margin-bottom:.18rem">
          <span>SALARY CAP</span>
          <span style="color:${capLeft<0?"var(--red)":"var(--gray)"}">${capLeft >= 0 ? `$${capLeft.toFixed(1)}M room` : `$${Math.abs(capLeft).toFixed(1)}M over`}</span>
        </div>
        <div style="height:8px;background:#222;border-radius:4px;overflow:hidden;position:relative">
          <div style="height:100%;width:${capPct.toFixed(1)}%;background:${capColor};transition:width .2s"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.62rem;margin-top:.18rem">
          <span style="color:var(--gray)">$<b style="color:var(--white)">${capUsed.toFixed(1)}M</b> used</span>
          <span style="color:var(--gray)">$<b style="color:var(--gold)">${cap.toFixed(0)}M</b> cap</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-start;padding:.25rem .55rem;background:var(--bg2);border:1px solid var(--border);border-radius:4px;min-width:130px"
           title="Post-June 1 designations: 2 per team per offseason. Use to defer most dead-cap on a release to next year.">
        <span style="font-size:.55rem;letter-spacing:.5px;color:var(--gray)">📅 POST-JUN 1</span>
        <span style="font-size:.95rem;font-weight:700;color:${j1Left===0?"#888":"var(--gold)"}">${j1Used} / ${JUNE1_DESIGNATIONS_PER_TEAM}</span>
        <span style="font-size:.55rem;color:var(--gray)">${j1Left} remaining</span>
      </div>
    </div>`;

  let listHtml = headerHtml;
  for (const pos of posOrder) {
    const players = (groups[pos] || []).slice().sort((a,b) => b.overall - a.overall);
    if (!players.length) continue;
    listHtml += `<div class="frn-pre-pos-group">
      <div class="frn-pre-pos-title">${pos} <span style="color:var(--gray);font-weight:400;font-size:.6rem">${players.length}</span></div>
      <table class="frn-pre-roster-table">
        <thead><tr>
          <th></th><th>Player</th><th>Grade</th><th>Pot</th><th>Age</th>
          <th title="Annual Avg Value × years remaining">AAV</th>
          <th title="This year's cap charge (base + bonus proration)">Cap Hit</th>
          <th title="Total dead cap if released now (prorated bonus × years remaining)">Dead</th>
          <th title="Net current-year cap relief if released (Cap Hit − this-year dead)">Save</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${players.map((p, i) => {
            const pKey = p.pid || p.name;
            const escName = pKey.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
            const isStarter = i === 0;
            const isSel = selected && (selected.pid ? selected.pid === p.pid : selected.name === p.name);
            const aav = p.contract?.aav || 0;
            const yrs = p.contract?.remaining || 0;
            const capHit = currentYearCapHit(p);
            const { perYear: deadPerYr, years: deadYrs } = deadCapOnRelease(p);
            const deadTotal = Math.round(deadPerYr * deadYrs * 10) / 10;
            const thisYearSave = Math.round((capHit - deadPerYr) * 10) / 10;
            const escNm = p.name.replace(/'/g, "\\'");
            const isPendingRelease = _releasePending?.name === p.name && _releasePending?.pos === p.position;
            const tag = potentialTag(p, { known: true });
            // Compress the potential tag to a short chip for the table
            const potChip = tag
              ? `<span title="${tag}" style="font-size:.56rem;padding:.08rem .3rem;border-radius:3px;background:${
                  tag.includes("HIGH CEILING") ? "rgba(255,215,0,.18);color:#ffd700"
                  : tag.includes("Late bloomer") ? "rgba(120,255,120,.15);color:#9af0a3"
                  : tag.includes("Bust") ? "rgba(255,100,100,.18);color:#ff9090"
                  : tag.includes("Capped") || tag.includes("Fell short") ? "rgba(200,100,100,.13);color:#ff9090"
                  : tag.includes("Hit ceiling") || tag.includes("At ceiling") ? "rgba(150,150,150,.18);color:var(--gray)"
                  : "rgba(160,160,160,.15);color:var(--gray)"
                }">${tag.replace(/^[📋⭐↗▾⚠✓≈↘]\s*/,"").replace(/\s*$/,"").slice(0,12)}</span>`
              : `<span style="color:#555;font-size:.6rem">—</span>`;
            const ageColor = (p.age||0) >= 33 ? "#ff9090" : (p.age||0) >= 30 ? "#e8a000" : "var(--gray)";
            const saveColor = thisYearSave >= 5 ? "var(--green-lt)" : thisYearSave > 0 ? "#9af0a3" : thisYearSave < 0 ? "var(--red)" : "var(--gray)";
            const deadColor = deadTotal === 0 ? "var(--green-lt)" : deadTotal >= 10 ? "var(--red)" : "#ff9090";
            const rowBg = isPendingRelease ? "rgba(220,50,50,.18)" : "";
            const cutBtn = isPendingRelease
              ? `<button class="frn-pre-cut" onclick="event.stopPropagation();frnReleasePlayerCancel()" title="Cancel release" style="background:var(--red);color:#fff">✗</button>`
              : `<button class="frn-pre-cut" onclick="event.stopPropagation();frnReleasePlayer('${escNm}','${p.position}')" title="Release — opens decision panel">✗</button>`;
            return `<tr class="frn-scout-row ${isSel?"selected":""}" style="background:${rowBg}" onclick="renderFrnPreseason('roster',null,null,'${escName}')">
              <td class="frn-scout-slot">${isStarter?"★":"#"+(i+1)}</td>
              <td style="font-weight:${isStarter?700:400}"><span style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px" onclick="event.stopPropagation();frnOpenPlayerCard('${escName}','${(p.pid||"").replace(/'/g,"\\'")}')">${p.name}</span></td>
              <td>${gradeBadge(p)}</td>
              <td>${potChip}</td>
              <td style="color:${ageColor}">${p.age || "?"}</td>
              <td style="color:var(--gold);font-size:.68rem;white-space:nowrap">$${aav.toFixed(1)}M·${yrs}y</td>
              <td style="color:var(--white);font-weight:600;font-size:.68rem">$${capHit.toFixed(1)}M</td>
              <td style="font-size:.65rem;color:${deadColor};white-space:nowrap">${deadTotal===0?"—":`$${deadTotal.toFixed(1)}M`}</td>
              <td style="font-size:.68rem;font-weight:700;color:${saveColor};white-space:nowrap">${thisYearSave>0?"+":""}$${thisYearSave.toFixed(1)}M</td>
              <td>${cutBtn}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
  }

  return `<div class="frn-scout-split">
    <div class="frn-scout-roster">${listHtml}</div>
    <div class="frn-scout-player">${
      pendingDecisionHtml || (selected ? _buildPlayerDetailPanel(selected) : "")
    }</div>
  </div>`;
}

// Side-by-side release decision panel — replaces the player detail pane
// when _releasePending is set. Shows Standard vs Post-June-1 in two cards
// so the user can SEE the trade-off rather than reading explanatory text.
function _buildReleaseDecisionPanel(roster) {
  const p = roster.find(q => q.name === _releasePending.name && q.position === _releasePending.pos);
  if (!p) return "";
  const { deadPerYr, deadYrs, deadTotal, june1, j1Year1, j1Year2, j1Allowed, j1Used } = _releasePending;
  const capHit = currentYearCapHit(p);
  const standardSaveY1 = Math.round((capHit - deadPerYr) * 10) / 10;
  const j1SaveY1 = Math.round((capHit - (j1Year1 || deadPerYr)) * 10) / 10;
  const j1Eligible = (j1Allowed || 0) > 0 && deadYrs >= 2 && deadTotal > 0;
  const tag = potentialTag(p, { known: true });
  const escNm = p.name.replace(/'/g, "\\'");
  const saveDelta = j1SaveY1 - standardSaveY1;
  const futureDelta = (j1Year2 || 0) - (deadPerYr * (deadYrs - 1));

  // Card builder so the two layouts are visually identical except for the numbers
  function cutCard(kind) {
    const isJ1 = kind === "june1";
    const accent = isJ1 ? "var(--gold)" : "var(--red)";
    const title = isJ1 ? "POST-JUNE 1 CUT" : "STANDARD CUT";
    const subtitle = isJ1
      ? `<span style="font-size:.55rem;color:${j1Left()===0?"#888":"var(--green-lt)"};letter-spacing:.5px">${j1Left()} / ${JUNE1_DESIGNATIONS_PER_TEAM} LEFT</span>`
      : `<span style="font-size:.55rem;color:var(--gray);letter-spacing:.5px">ALWAYS AVAILABLE</span>`;
    const y1Save = isJ1 ? j1SaveY1 : standardSaveY1;
    const y1Dead = isJ1 ? j1Year1 : deadPerYr;
    const y2Plus = isJ1
      ? [{ y: "Y2", amt: j1Year2 || 0, note: "(deferred lump)" }]
      : Array.from({ length: deadYrs - 1 }, (_, k) => ({ y: `Y${k+2}`, amt: deadPerYr, note: "" }));
    const totalDead = isJ1 ? ((j1Year1 || 0) + (j1Year2 || 0)) : deadTotal;
    const isPending = (isJ1 && june1) || (!isJ1 && !june1);
    const confirmBtn = isJ1 && !j1Eligible
      ? `<div style="font-size:.6rem;color:#888;text-align:center;padding:.5rem 0">
          ${deadYrs < 2 ? "Needs ≥2yr dead to defer" : `0 / ${JUNE1_DESIGNATIONS_PER_TEAM} designations left`}
        </div>`
      : `<button onclick="frnReleasePlayer('${escNm}','${p.position}',${isJ1});frnReleasePlayerConfirm()"
           style="display:block;width:100%;padding:.4rem;background:${accent};color:${isJ1?"#000":"#fff"};font-weight:700;border:none;border-radius:4px;cursor:pointer;font-size:.7rem;letter-spacing:.5px">
           ✓ ${isJ1 ? "CONFIRM POST-JUN 1" : "CONFIRM STANDARD"}
         </button>`;
    const dim = (isJ1 && !j1Eligible) ? .55 : 1;

    return `<div style="flex:1;background:var(--bg2);border:2px solid ${isPending?accent:"var(--border)"};border-radius:6px;padding:.6rem;opacity:${dim}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.4rem">
        <span style="font-size:.7rem;font-weight:700;letter-spacing:.5px;color:${accent}">${title}</span>
        ${subtitle}
      </div>
      <div style="font-size:.6rem;color:var(--gray);letter-spacing:.5px;margin-bottom:.15rem">THIS YEAR</div>
      <div style="display:flex;justify-content:space-between;font-size:.7rem;padding:.15rem 0">
        <span>Cap freed</span>
        <span style="color:var(--green-lt);font-weight:700">+$${capHit.toFixed(1)}M</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:.7rem;padding:.15rem 0">
        <span>Dead cap</span>
        <span style="color:#ff9090;font-weight:700">−$${(y1Dead||0).toFixed(1)}M</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:.78rem;padding:.25rem 0;border-top:1px solid var(--border);margin-top:.15rem">
        <span style="font-weight:700">Net Y1</span>
        <span style="color:${y1Save>0?"var(--green-lt)":"var(--red)"};font-weight:900">${y1Save>0?"+":""}$${y1Save.toFixed(1)}M</span>
      </div>
      ${y2Plus.length ? `
        <div style="font-size:.6rem;color:var(--gray);letter-spacing:.5px;margin:.4rem 0 .15rem">FUTURE YEARS</div>
        ${y2Plus.map(y => `<div style="display:flex;justify-content:space-between;font-size:.68rem;padding:.1rem 0">
          <span>${y.y}${y.note?` <span style="color:var(--gray);font-size:.55rem">${y.note}</span>`:""}</span>
          <span style="color:#ff9090">−$${(y.amt||0).toFixed(1)}M</span>
        </div>`).join("")}` : ""}
      <div style="display:flex;justify-content:space-between;font-size:.65rem;color:var(--gray);padding:.3rem 0 .5rem;border-top:1px solid var(--border);margin-top:.25rem">
        <span>Total dead</span>
        <span style="color:#ff9090">$${totalDead.toFixed(1)}M</span>
      </div>
      ${confirmBtn}
    </div>`;
  }

  function j1Left() { return Math.max(0, JUNE1_DESIGNATIONS_PER_TEAM - (j1Used || 0)); }

  const advice = j1Eligible
    ? `<div style="font-size:.65rem;color:var(--gold);background:rgba(200,169,0,.08);border:1px solid rgba(200,169,0,.3);border-radius:4px;padding:.4rem .55rem;margin-top:.6rem">
        💡 Post-June 1 frees <b>$${saveDelta>0?`${saveDelta.toFixed(1)}M more`:`the same`}</b> this year but pushes <b>$${Math.abs(futureDelta).toFixed(1)}M ${futureDelta>0?"more":"less"}</b> to next year. Use when you need cap NOW for free agency or trades.
      </div>`
    : "";

  return `<div style="padding:.5rem .6rem;background:var(--bg3);border:1px solid var(--border);border-radius:6px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:.5rem;margin-bottom:.5rem">
      <div>
        <div style="font-size:.95rem;font-weight:700;color:var(--red);letter-spacing:.4px">RELEASE ${p.name}?</div>
        <div style="font-size:.6rem;color:var(--gray);margin-top:.1rem">
          ${p.position} · age ${p.age} · ${gradeBadge(p).replace(/<[^>]*>/g,"").trim()} grade${tag?` · ${tag}`:""}
          · $${(p.contract?.aav||0).toFixed(1)}M × ${p.contract?.remaining||0}yr
        </div>
      </div>
      <button onclick="frnReleasePlayerCancel()" style="font-size:.62rem;padding:.25rem .6rem;background:transparent;color:var(--gray);border:1px solid var(--border);border-radius:3px;cursor:pointer">✗ Cancel</button>
    </div>
    <div style="display:flex;gap:.55rem;flex-wrap:wrap">
      ${cutCard("standard")}
      ${cutCard("june1")}
    </div>
    ${advice}
  </div>`;
}

function _preseasonScheduleTab(schedule, myId) {
  const myGames = schedule.filter(g => g.homeId === myId || g.awayId === myId)
    .sort((a,b) => a.week - b.week);
  return `<table class="frn-pre-roster-table">
    <thead><tr><th>WK</th><th>Opponent</th><th>Where</th><th>OFF</th><th>DEF</th><th>Star Player</th></tr></thead>
    <tbody>
      ${myGames.map(g => {
        const isHome = g.homeId === myId;
        const oppId  = isHome ? g.awayId : g.homeId;
        const opp    = getTeam(oppId);
        const oppRtg = frnTeamRating(oppId);
        const star   = (franchise.rosters[oppId] || []).slice().sort((a,b) => b.overall - a.overall)[0];
        return `<tr>
          <td style="color:var(--gold);font-weight:700">W${g.week}</td>
          <td style="font-weight:700">${teamAscii(opp)} ${opp.city} ${opp.name}</td>
          <td style="color:${isHome?"var(--green-lt)":"var(--gray)"};font-size:.7rem">${isHome ? "HOME" : "@ AWAY"}</td>
          <td style="color:var(--gold)">${oppRtg.off}</td>
          <td style="color:var(--gold)">${oppRtg.def}</td>
          <td style="color:var(--gray);font-size:.7rem">${star ? `${star.name} (${star.position}, ${gradeLabel(scoutGrade(star))})` : "—"}</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>`;
}

// Number of "starters" we display per position in the depth-chart view.
const SCOUT_STARTER_COUNTS = { QB:1, RB:1, WR:3, TE:1, OL:5, DL:4, LB:3, CB:2, S:2, K:1, P:1 };

// ── Scout UI helpers ─────────────────────────────────────────────────────────

// Grade badge that shows a dashed-border "fuzzy" style when the team is
// unscouted (grades are noisy ±8 estimates rather than sharpened ±2).
function _scoutGradeBadge(p, scouted) {
  const g  = scoutGrade(p);
  const gL = gradeLabel(g);
  const gc = gradeClass(g);
  const bg  = gc === "elite" ? "#f0cc30" : gc === "good" ? "#9be09b" : gc === "average" ? "#c0c0c0" : "#c08080";
  const col = gc === "poor" ? "#200" : "#000";
  const base = `display:inline-block;background:${bg};color:${col};font-weight:800;padding:.1rem .35rem;border-radius:3px;font-size:.68rem;font-family:inherit;letter-spacing:.2px;white-space:nowrap`;
  return scouted
    ? `<span style="${base}">${gL}</span>`
    : `<span style="${base};opacity:.8;outline:1px dashed ${bg}">~${gL}</span>`;
}

// Full scouting report panel — everything a scout needs to evaluate a player.
function _buildScoutPlayerPanel(p, scouted) {
  const g   = scoutGrade(p);
  const aav = p.contract?.aav || 0;
  const yrs = p.contract?.remaining || 0;
  const pos = p.position;
  const cmb = combineMeasurables(p);
  const isKicker = pos === "K" || pos === "P";
  const escN   = (p.name||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
  const escPid = (p.pid||"").replace(/'/g,"\\'");

  // Grade + confidence
  const gradeBadgeHtml = _scoutGradeBadge(p, scouted);
  const noiseNote = scouted
    ? `<span style="font-size:.55rem;color:#4dbd64">±2 scouted</span>`
    : `<span style="font-size:.55rem;color:#f5a028">~±8 estimate</span>`;

  // Accolades banner
  const accolades = [];
  if (p.mvps)     accolades.push(`🏆 ${p.mvps}× MVP`);
  if (p.sbRings)  accolades.push(`💍 ${p.sbRings}× SB`);
  if (p.allPros)  accolades.push(`⭐ ${p.allPros}× All-Pro`);
  if (p.proBowls) accolades.push(`🌟 ${p.proBowls}× Pro Bowl`);
  const accoladeHtml = accolades.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:.28rem;margin-top:.3rem">
        ${accolades.map(a=>`<span style="font-size:.58rem;background:rgba(245,197,66,.1);border:1px solid rgba(245,197,66,.3);padding:.08rem .32rem;border-radius:3px;color:var(--gold-lt)">${a}</span>`).join("")}
       </div>` : "";

  // Potential tag (always fuzzy for opponents)
  const potTag = potentialTag(p, { known: false });

  // Career history
  const hist = p.careerHistory || [];
  const careerYrs = hist.length;
  const recentSeasons = hist.slice(-3);

  // Career totals one-liner
  const ct = p.careerStats || {};
  let careerStatLine = "";
  if (pos==="QB" && ct.pass_yds)            careerStatLine = `${(ct.pass_yds||0).toLocaleString()} pass yds · ${ct.pass_td||0} TD · ${ct.pass_int||0} INT`;
  else if (pos==="RB" && ct.rush_yds)       careerStatLine = `${(ct.rush_yds||0).toLocaleString()} rush yds · ${ct.rush_td||0} TD`;
  else if ((pos==="WR"||pos==="TE") && ct.rec_yds) careerStatLine = `${ct.rec||0} rec · ${(ct.rec_yds||0).toLocaleString()} yds · ${ct.rec_td||0} TD`;
  else if ((pos==="DL"||pos==="LB"))        careerStatLine = `${ct.tkl||0} tkl · ${ct.sk||0} sk · ${ct.ff||0} FF`;
  else if ((pos==="CB"||pos==="S"))         careerStatLine = `${ct.tkl||0} tkl · ${ct.int_made||0} INT · ${ct.pd||0} PD`;

  // Recent seasons mini-table
  let recentHtml = "";
  if (recentSeasons.length) {
    const keyCols = _careerColsFor(pos).slice(0, 3);
    recentHtml = `<div style="margin-top:.5rem;border-top:1px solid var(--border);padding-top:.45rem">
      <div style="font-size:.52rem;letter-spacing:.7px;color:var(--blgray);margin-bottom:.22rem">RECENT SEASONS</div>
      <table style="width:100%;border-collapse:collapse;font-size:.6rem">
        <thead><tr style="color:var(--gray)">
          <th style="text-align:left;font-weight:400;padding:.1rem .2rem .12rem">YR</th>
          <th style="text-align:left;font-weight:400;padding:.1rem .2rem .12rem">TEAM</th>
          <th style="text-align:center;font-weight:400;padding:.1rem .2rem .12rem">OVR</th>
          ${keyCols.map(c=>`<th style="text-align:center;font-weight:400;padding:.1rem .2rem .12rem">${c.label}</th>`).join("")}
        </tr></thead>
        <tbody>${recentSeasons.map(s=>{
          const ovrCol = s.ovr>=88?"var(--gold)":s.ovr>=75?"var(--green-lt)":"var(--gray)";
          const lastWord = (s.teamName||"—").split(" ").slice(-1)[0];
          return `<tr style="border-top:1px solid rgba(255,255,255,.05)">
            <td style="padding:.12rem .2rem;color:var(--gray)">'${String(s.season||s.year||"").slice(-2)}</td>
            <td style="padding:.12rem .2rem;color:var(--blgray)">${lastWord}</td>
            <td style="padding:.12rem .2rem;text-align:center;font-weight:700;color:${ovrCol}">${s.ovr||"—"}</td>
            ${keyCols.map(c=>`<td style="padding:.12rem .2rem;text-align:center">${s[c.key]??0}</td>`).join("")}
          </tr>`;
        }).join("")}</tbody>
      </table>
    </div>`;
  }

  // Injury flags
  const injHist = p.injuryHistory || [];
  const injRiskBit = injHist.length >= 3
    ? `<span style="font-size:.57rem;color:var(--red);font-weight:700">⚠ Injury-prone (${injHist.length}×)</span>`
    : injHist.length
    ? `<span style="font-size:.57rem;color:#e8a000">${injHist.length}× prior injury</span>` : "";
  const curInjHtml = p.injury
    ? (() => {
        const onset = _currentInjuryOnset(p);
        const icon = p.injury._careerEnding ? "💔" : p.injury._catastrophic ? "🚑" : "🩹";
        const onsetTxt = onset?.week ? ` · onset W${onset.week}` : "";
        return `<div style="margin:.38rem 0;padding:.28rem .42rem;background:rgba(220,50,50,.1);border:1px solid rgba(220,50,50,.35);border-radius:3px;font-size:.64rem;color:var(--red)">${icon} ${p.injury.label}${onsetTxt} — ${p.injury.weeksRemaining} wk${p.injury.weeksRemaining===1?"":"s"} out</div>`;
      })()
    : "";

  // Contract + dead cap intel
  const { perYear: deadPY, years: deadYrs } = deadCapOnRelease(p);
  const hasDeadCap = deadYrs > 0 && deadPY > 0;
  const contractDetail = `$${aav.toFixed(1)}M/yr · ${yrs}yr left · ${hasDeadCap?`☠ $${deadPY.toFixed(1)}M dead if cut`:"clean — no dead cap"}`;

  // Combine — position-aware. K/P show kick-specific. Other positions
  // show only the drills they actually run at the NFL combine.
  const combineHtml = isKicker
    ? `<div style="display:flex;gap:1.2rem;flex-wrap:wrap;font-size:.65rem">
         <div><span class="frn-meta-label">LEG</span> ${Math.round(70+(cmb.kpw-50)*0.45)} yds</div>
         <div><span class="frn-meta-label">HT/WT</span> ${Math.floor(cmb.heightIn/12)}'${cmb.heightIn%12}" / ${cmb.weightLbs}lb</div>
       </div>`
    : (() => {
        const tests = (typeof COMBINE_TESTS_BY_POS === "object" ? COMBINE_TESTS_BY_POS[p.position] : null) || {};
        const cells = [];
        cells.push(`<div><span class="frn-meta-label">HT/WT</span> ${Math.floor(cmb.heightIn/12)}'${cmb.heightIn%12}" / ${cmb.weightLbs}lb</div>`);
        if (tests.fortyTime)   cells.push(`<div><span class="frn-meta-label">40-YD</span> ${cmb.fortyTime}s</div>`);
        if (tests.benchReps)   cells.push(`<div><span class="frn-meta-label">BENCH</span> ${cmb.benchReps} reps</div>`);
        if (tests.verticalIn)  cells.push(`<div><span class="frn-meta-label">VERT</span> ${cmb.verticalIn}"</div>`);
        if (tests.broadJumpIn) cells.push(`<div><span class="frn-meta-label">BROAD</span> ${cmb.broadJumpIn}"</div>`);
        if (tests.coneTime)    cells.push(`<div><span class="frn-meta-label">3-CONE</span> ${cmb.coneTime}s</div>`);
        if (tests.shuttleTime) cells.push(`<div><span class="frn-meta-label">SHUTTLE</span> ${cmb.shuttleTime}s</div>`);
        if (tests.handSizeIn && cmb.handSizeIn) cells.push(`<div><span class="frn-meta-label">HAND</span> ${cmb.handSizeIn}"</div>`);
        if (tests.armLengthIn && cmb.armLengthIn) cells.push(`<div><span class="frn-meta-label">ARM</span> ${cmb.armLengthIn}"</div>`);
        return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:.25rem .8rem;font-size:.65rem">${cells.join("")}</div>`;
      })();

  // Current season stats (if in-season)
  const seasonBlock = _buildSeasonStatsBlock(p);

  // Archetype
  const archBlock = _buildArchetypeBlock(p);

  return `<div class="frn-player-card" style="padding:.6rem .72rem">

    <!-- ① Identity + Full Card button -->
    <div style="display:flex;gap:.8rem;align-items:flex-start;margin-bottom:.45rem">
      ${_playerPortrait(p, 80)}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:flex-start;gap:.4rem;flex-wrap:wrap">
          <span style="font-size:.98rem;font-weight:900;flex:1">${p.name}</span>
          <button onclick="frnOpenPlayerCard('${escN}','${escPid}')"
            style="background:none;border:1px solid var(--border);color:var(--blgray);font-size:.54rem;padding:.12rem .32rem;border-radius:3px;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0"
            onmouseover="this.style.borderColor='var(--gold)';this.style.color='var(--gold)'"
            onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--blgray)'">📋 Full Card</button>
        </div>
        <div style="color:var(--gray);font-size:.67rem;margin-top:.06rem">
          #${jerseyForPlayer(p)||"—"} · ${pos} · Age ${p.age||"?"}${p.height?` · ${formatHeight(p.height)}, ${p.weight||"?"}lbs`:""}
        </div>
        <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;margin-top:.28rem">
          ${gradeBadgeHtml} ${noiseNote}
          ${potTag?`<span style="font-size:.58rem;color:var(--gold-lt);font-weight:700">${potTag}</span>`:""}
        </div>
        ${accoladeHtml}
      </div>
    </div>

    <!-- ② Contract + pedigree intel -->
    <div style="padding:.3rem .42rem;background:var(--bg3);border:1px solid var(--border);border-radius:3px;margin-bottom:.4rem;font-size:.6rem">
      <div style="color:var(--blgray);margin-bottom:.08rem"><span class="frn-meta-label">CONTRACT</span> ${contractDetail}</div>
      <div style="color:var(--gray)"><span class="frn-meta-label">DRAFT</span> ${draftStr(p)} · ${careerYrs} season${careerYrs!==1?"s":""} in league${injRiskBit?` · ${injRiskBit}`:""}</div>
    </div>

    ${curInjHtml}

    <!-- ③ Archetype -->
    ${archBlock?`<div style="margin-bottom:.4rem">${archBlock}</div>`:""}

    <!-- ④ Career totals -->
    ${careerStatLine?`<div style="font-size:.62rem;color:var(--blgray);padding:.26rem .42rem;background:rgba(255,255,255,.03);border-radius:3px;margin-bottom:.4rem"><span class="frn-meta-label">CAREER TOTALS</span> ${careerStatLine}</div>`:""}

    <!-- ⑤ Recent seasons -->
    ${recentHtml}

    <!-- ⑥ This season stats -->
    ${seasonBlock?`<div style="margin-top:.45rem;border-top:1px solid var(--border);padding-top:.42rem">${seasonBlock}</div>`:""}

    <!-- ⑦ Combine / athleticism -->
    <div style="margin-top:.45rem;border-top:1px solid var(--border);padding-top:.42rem">
      <div style="font-size:.52rem;letter-spacing:.7px;color:var(--blgray);margin-bottom:.2rem">COMBINE · ATHLETICISM</div>
      ${combineHtml}
    </div>

  </div>`;
}

function _scoutNeedsBar(myId) {
  const posOrder = ["QB","RB","WR","TE","OL","DL","LB","CB","S"];
  const pills = posOrder.map(pos => {
    const lvl = _draftNeedLevel(myId, pos);
    if (lvl === 0) return null;
    const col = lvl === 2 ? "#ff9090" : "#e8a000";
    const label = lvl === 2 ? "NEED" : "THIN";
    return `<span style="font-size:.52rem;font-weight:700;color:${col};background:rgba(0,0,0,.25);border:1px solid ${col}55;padding:.06rem .3rem;border-radius:3px;white-space:nowrap">${pos} <span style="opacity:.75">${label}</span></span>`;
  }).filter(Boolean);
  if (!pills.length) return "";
  return `<div style="display:flex;flex-wrap:wrap;gap:.25rem;align-items:center;margin-bottom:.55rem;padding:.3rem .4rem;background:rgba(0,0,0,.2);border-radius:4px;border:1px solid var(--border)">
    <span style="font-size:.5rem;letter-spacing:.6px;color:var(--blgray);flex-shrink:0">MY NEEDS</span>
    ${pills.join("")}
  </div>`;
}

function _preseasonScoutTab(myId, scoutId, view, selName) {
  view = view || "starters";

  // ── Default opponent: your next unplayed game ────────────────────────────
  if (!scoutId) {
    const next = franchise.schedule.find(g =>
      !g.played && (g.homeId === myId || g.awayId === myId));
    if (next) {
      scoutId = next.homeId === myId ? next.awayId : next.homeId;
    } else {
      const any = franchise.schedule.find(g => g.homeId === myId || g.awayId === myId);
      scoutId = any
        ? (any.homeId === myId ? any.awayId : any.homeId)
        : TEAMS.find(t => t.id !== myId).id;
    }
  }
  scoutId = Number(scoutId);

  // ── Build team list sorted by schedule week ──────────────────────────────
  // Find each opponent's week number in the schedule (vs myId).
  const opponentWeekMap = {};
  for (const g of franchise.schedule) {
    if (g.homeId === myId || g.awayId === myId) {
      const oppId = g.homeId === myId ? g.awayId : g.homeId;
      if (!(oppId in opponentWeekMap)) opponentWeekMap[oppId] = g.week;
    }
  }

  // Find the next opponent (next unplayed game vs myId).
  let nextOppId = null;
  const nextGame = franchise.schedule.find(g =>
    !g.played && (g.homeId === myId || g.awayId === myId));
  if (nextGame) nextOppId = nextGame.homeId === myId ? nextGame.awayId : nextGame.homeId;

  const opponents = TEAMS.filter(t => t.id !== myId).slice().sort((a, b) => {
    const wa = opponentWeekMap[a.id] ?? 999;
    const wb = opponentWeekMap[b.id] ?? 999;
    return wa - wb;
  });

  const listHtml = opponents.map(t => {
    const active  = t.id === scoutId;
    const wk      = opponentWeekMap[t.id];
    const wkLabel = wk != null ? `WK ${wk}` : "";
    const st      = franchise.standings?.[t.id] || { w:0, l:0, t:0 };
    const rec     = `${st.w}-${st.l}${st.t ? `-${st.t}` : ""}`;
    const isNext  = t.id === nextOppId;
    const tOff    = typeof _getTeamOffScheme === "function" ? _getTeamOffScheme(t.id) : null;
    const tDef    = typeof _getTeamDefScheme === "function" ? _getTeamDefScheme(t.id) : null;
    return `<button class="frn-scout-team ${active?"active":""}" onclick="renderFrnPreseason('scout',${t.id})" style="border-left:3px solid ${t.primary}">
      <span class="frn-scout-team-week">${wkLabel}</span>
      <span style="color:var(--gold);flex-shrink:0;font-size:.75rem">${teamAscii(t)}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${t.city} ${t.name}</span>
      ${isNext ? `<span class="frn-scout-next-chip">NEXT</span>` : ""}
      <span class="frn-scout-team-rec">${rec}</span>
      ${tOff ? `<span style="width:100%;margin-top:.1rem;display:flex;gap:.25rem">${_schemeBadge(tOff,true)} ${_schemeBadge(tDef,true)}</span>` : ""}
    </button>`;
  }).join("");

  const oppTeam   = getTeam(scoutId);
  const oppRoster = franchise.rosters[scoutId] || [];
  const oppRtg    = frnTeamRating(scoutId);
  const oppCap    = capUsedByTeam(scoutId);

  // ── Scouting intel ────────────────────────────────────────────────────────
  const intel           = franchise?.scoutingIntel?.[scoutId];
  const scoutedThisSeason = intel?.season === franchise.season;

  // ── Opponent record & schedule info ──────────────────────────────────────
  const oppSt      = franchise.standings?.[scoutId] || { w:0, l:0, t:0 };
  const oppRec     = `${oppSt.w}-${oppSt.l}${oppSt.t ? `-${oppSt.t}` : ""}`;
  const oppWeek    = opponentWeekMap[scoutId];
  const oppWkLabel = oppWeek != null ? `· WK ${oppWeek}` : "";

  // Count injured starters (starter positions, injury present)
  const starterPositions = new Set(["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"]);
  const injuredStarterCount = oppRoster.filter(p =>
    p.injury && starterPositions.has(p.position)).length;
  const injuredStr = injuredStarterCount > 0
    ? ` · ${injuredStarterCount} starter${injuredStarterCount>1?"s":""} out &#x1F9F9;`
    : "";

  // ── Group roster by position, sorted by OVR desc ──────────────────────────
  const byPos = {};
  for (const p of oppRoster) (byPos[p.position] = byPos[p.position] || []).push(p);
  for (const pos of Object.keys(byPos)) byPos[pos].sort((a,b) => b.overall - a.overall);

  // ── Selected player ───────────────────────────────────────────────────────
  let selected = null;
  if (selName) selected = oppRoster.find(p => p.pid === selName || p.name === selName);
  if (!selected) selected = oppRoster.slice().sort((a,b) => b.overall - a.overall)[0];

  // ── Key threats ───────────────────────────────────────────────────────────
  const offSkillPos  = new Set(["QB","RB","WR","TE"]);
  const defPos       = new Set(["DL","LB","CB","S"]);
  const bestOff  = oppRoster.filter(p => offSkillPos.has(p.position)).sort((a,b) => b.overall - a.overall)[0] || null;
  const bestDef  = oppRoster.filter(p => defPos.has(p.position)).sort((a,b) => b.overall - a.overall)[0] || null;
  const injured  = oppRoster.filter(p => p.injury);
  const topInj   = injured.length > 0 ? injured.sort((a,b) => b.overall - a.overall)[0] : null;

  // One-line season stat summary for a player.
  const _threatStatLine = (p) => {
    const ts = franchise?.seasonStats?.[scoutId] || {};
    const st = ts[p.name];
    if (!st || !st.gp) return "";
    const pos = p.position;
    if (pos === "QB") return `${st.pass_yds||0} yds · ${st.pass_td||0} TD`;
    if (pos === "RB") return `${st.rush_yds||0} yds · ${st.rush_td||0} TD`;
    if (pos === "WR" || pos === "TE") return `${st.rec||0} rec · ${st.rec_yds||0} yds`;
    if (pos === "DL" || pos === "LB" || pos === "CB" || pos === "S")
      return `${st.tkl||0} tkl${st.sk ? ` · ${st.sk} sk` : ""}${st.int_made ? ` · ${st.int_made} int` : ""}`;
    return "";
  };

  const _threatCard = (labelText, p) => {
    if (!p) return "";
    const pKey = (p.pid || p.name).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const statLine = _threatStatLine(p);
    return `<div class="frn-scout-threat-card"
      onclick="renderFrnPreseason('scout',${scoutId},'${view}','${pKey}')">
      <div class="frn-scout-threat-lbl">${labelText}</div>
      <div class="frn-scout-threat-name"><span style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px" onclick="event.stopPropagation();frnOpenPlayerCard('${(p.name||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'")}','${(p.pid||"").replace(/'/g,"\\'")}')">${p.name}</span></div>
      <div style="margin-top:.15rem">${_scoutGradeBadge(p, scoutedThisSeason)}</div>
      ${statLine ? `<div class="frn-scout-threat-stat">${statLine}</div>` : ""}
    </div>`;
  };

  const threatsHtml = (bestOff || bestDef || topInj)
    ? `<div class="frn-scout-threats">
        ${_threatCard("BEST OFFENSE", bestOff)}
        ${_threatCard("BEST DEFENSE", bestDef)}
        ${topInj ? _threatCard("INJURY RISK", topInj) : ""}
      </div>`
    : "";

  // ── Noise banner ──────────────────────────────────────────────────────────
  const noiseBanner = scoutedThisSeason
    ? `<div class="frn-scout-noise-banner scouted">
        &#x2713; Intel active &middot; Grades sharpened to &plusmn;2 (Wk ${intel.gainedWeek})
       </div>`
    : `<div class="frn-scout-noise-banner unscouted">
        &#x26A0; Grade noise &plusmn;8 &mdash; grades are estimates.
        <a onclick="renderFrnScrimmages()">Run a joint practice to sharpen to &plusmn;2.</a>
       </div>`;

  // ── Roster table rows ─────────────────────────────────────────────────────
  const posOrder = ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];
  const groupHeaders = { QB: "OFFENSE", DL: "DEFENSE", K: "SPECIAL TEAMS" };

  const rowHtml = (p, slotLabel) => {
    const pKey = p.pid || p.name;
    const isSel = selected && (selected.pid ? selected.pid === p.pid : selected.name === p.name);
    const escName = pKey.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const isStarter = slotLabel.includes("1") || slotLabel === "QB" || slotLabel === "RB"
      || slotLabel === "TE" || slotLabel === "K" || slotLabel === "P";
    return `<tr class="frn-scout-row ${isSel?"selected":""}"
      onclick="renderFrnPreseason('scout',${scoutId},'${view}','${escName}')">
      <td class="frn-scout-slot">${slotLabel}</td>
      <td style="font-weight:${isStarter?700:400}"><span style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px" onclick="event.stopPropagation();frnOpenPlayerCard('${escName}','${(p.pid||"").replace(/'/g,"\\'")}')">${p.name}</span></td>
      <td>${_scoutGradeBadge(p, scoutedThisSeason)}</td>
      <td style="color:var(--gray)">${p.age || "?"}</td>
      <td style="color:var(--gray);font-size:.66rem">${draftStr(p)}</td>
      <td style="color:var(--gold);font-size:.7rem">$${(p.contract?.aav||0).toFixed(1)}M</td>
    </tr>`;
  };

  const rows = [];
  for (const pos of posOrder) {
    if (groupHeaders[pos]) {
      rows.push(`<tr class="frn-scout-group-hdr"><td colspan="6">${groupHeaders[pos]}</td></tr>`);
    }
    const all   = byPos[pos] || [];
    const limit = view === "starters" ? (SCOUT_STARTER_COUNTS[pos] || 1) : all.length;
    const shown = all.slice(0, limit);
    shown.forEach((p, i) => {
      const slotLabel = shown.length > 1 ? `${pos}${i+1}` : pos;
      rows.push(rowHtml(p, slotLabel));
    });
  }

  const escSel = selected ? (selected.name || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'") : "";
  // Single toggle replaces the old Depth Chart / Full Roster sub-tabs —
  // depth chart is the default, click to fold in every backup.
  const starterCount = posOrder.reduce((s, pos) =>
    s + Math.min((byPos[pos] || []).length, (SCOUT_STARTER_COUNTS[pos] || 1)), 0);
  const backupCount = Math.max(0, oppRoster.length - starterCount);
  const isFull = view === "full";
  const toggleHtml = `
    <div class="frn-scout-roster-toggle">
      <button class="${isFull?"active":""}"
              onclick="renderFrnPreseason('scout',${scoutId},'${isFull?"starters":"full"}','${escSel}')">
        ${isFull ? `− Hide backups (${oppRoster.length} → starters only)` : `+ Show backups (${backupCount} more)`}
      </button>
    </div>`;

  return `<div class="frn-scout-layout">
    <div class="frn-scout-list">${listHtml}</div>
    <div class="frn-scout-detail">
      ${_scoutNeedsBar(myId)}
      <div style="display:flex;align-items:center;gap:.7rem;margin-bottom:.5rem">
        <span style="font-size:1.8rem;color:var(--gold)">${teamAscii(oppTeam)}</span>
        <div style="flex:1">
          <div style="font-weight:900;font-size:1.05rem">${oppTeam.city} ${oppTeam.name.toUpperCase()}
            <span style="font-size:.75rem;font-weight:400;color:var(--gray);margin-left:.4rem">${oppRec}</span>
            ${scoutedThisSeason ? `<span style="color:var(--gold-lt);font-size:.6rem;border:1px solid var(--gold-lt);padding:.05rem .3rem;margin-left:.4rem">&#x1F3DF; SCOUTED</span>` : ""}
          </div>
          <div style="color:var(--gray);font-size:.7rem">
            OFF <b style="color:var(--gold)">${oppRtg.off}</b> ·
            DEF <b style="color:var(--gold)">${oppRtg.def}</b> ·
            Cap $${oppCap.toFixed(0)}M${oppWkLabel}${injuredStr}
          </div>
          <div style="margin-top:.3rem;display:flex;gap:.35rem;flex-wrap:wrap">
            ${typeof _getTeamOffScheme === "function" ? _schemeBadge(_getTeamOffScheme(scoutId)) : ""}
            ${typeof _getTeamDefScheme === "function" ? _schemeBadge(_getTeamDefScheme(scoutId)) : ""}
          </div>
        </div>
      </div>
      ${noiseBanner}
      ${threatsHtml}
      ${toggleHtml}
      <div class="frn-scout-split">
        <div class="frn-scout-roster">
          <table class="frn-pre-roster-table">
            <thead><tr><th></th><th>Player</th><th>Grade</th><th>Age</th><th>Draft</th><th>AAV</th></tr></thead>
            <tbody>${rows.join("")}</tbody>
          </table>
        </div>
        <div class="frn-scout-player">${selected ? _buildScoutPlayerPanel(selected, scoutedThisSeason) : ""}</div>
      </div>
    </div>
  </div>`;
}

// ── Career stats + Hall of Fame helpers ──────────────────────────────────────
// Position-keyed HOF thresholds: combined career production benchmarks.
// Tuned for ~5% retirement-rate inclusion of real-stat-line stars.
const HOF_THRESHOLDS = {
  QB: p => (p.careerStats?.pass_yds||0) >= 28000 || (p.careerStats?.pass_td||0) >= 200,
  RB: p => (p.careerStats?.rush_yds||0) >= 8500 || (p.careerStats?.rush_td||0) >= 75,
  WR: p => (p.careerStats?.rec_yds ||0) >= 9000 || (p.careerStats?.rec_td ||0) >= 70,
  TE: p => (p.careerStats?.rec_yds ||0) >= 6000 || (p.careerStats?.rec_td ||0) >= 50,
  DL: p => (p.careerStats?.sk||0) >= 75 || (p.careerStats?.tkl||0) >= 450,
  LB: p => (p.careerStats?.tkl||0) >= 700 || (p.careerStats?.sk||0) >= 50,
  CB: p => (p.careerStats?.int_made||0) >= 25 || (p.careerStats?.pd||0) >= 80,
  S:  p => (p.careerStats?.int_made||0) >= 20 || (p.careerStats?.tkl||0) >= 500,
  K:  p => (p.careerStats?.fg_made||0) >= 220,
  P:  p => false,
};

// Position multipliers normalize HOF scoring across positions whose
// raw stats wildly differ (OL pancakes ≠ QB pass_yds). Tuned so a
// representative star at each position lands in the same ~70 score
// band when they belong in Canton.
function _hofPositionMul(pos) {
  // HoF mult retune r-3 (40-season audit baseline). r-2 nailed DL (14.5%),
  // QB (12.9%), WR (10.8%), RB (11.3%), CB (8.6%), S (6.5%), K (1.6%) — all
  // on target. Two gaps left: OL overshot to 22% (target 17 — pancake
  // counting bonus sits near the induction threshold so the 1.55 bump
  // moved it a lot) and LB dipped to 7.5% (target 10 — OL ballooning to
  // 41 ate slots in the 6/yr class cap, squeezing LB). r-3: pull OL back
  // toward 1.50, nudge LB up, trim TE. Hold everything else.
  // NFL shares QB13/RB12/WR10/TE3/OL17/DL14/LB10/CB8/S6/K2/P1.
  return { QB:1.35, RB:1.28, WR:1.45, TE:0.94,
           OL:1.50, LT:1.50, LG:1.50, C:1.50, RG:1.50, RT:1.50,
           DL:0.55, LB:0.76, CB:1.55, S:1.45, K:0.78, P:0.72 }[pos] || 1.0;
}

// Composite HOF score: peak ability + accolades + counting stats +
// longevity, scaled by position multiplier. Returns integer.
function _computeHOFScore(p) {
  const stats = p.careerStats || {};
  const histPeak = Math.max(...(p.careerHistory||[]).map(h => h.ovr ?? h.overall ?? 0), 0);
  const peak = Math.max(histPeak, p.overall || 0);
  let s = Math.max(0, peak - 70) * 1.5;
  s += (p.mvps    || 0) * 12;
  s += (p.opoys   || 0) * 5;
  s += (p.dpoys   || 0) * 5;
  s += (p.allPros || 0) * 4;
  s += (p.proBowls|| 0) * 1.2;
  s += (p.sbRings || 0) * 3;
  s += (p.roys    || 0) * 2;
  s += Math.max(0, (p.careerHistory?.length || 0) - 6) * 0.8;
  const pos = p.position;
  // Counting-stat bonus rebalanced per 500-season audit. DB INTs / PDs
  // were inflating CB scores ~4× over the rest of the field; LB
  // counting stats were too slow to accumulate. Numbers are now
  // calibrated against the actual sim stat-rates (which run ~1.7-2.7×
  // NFL norms) so a top career at each position trends to similar
  // counting-stat contribution.
  if (pos === "QB") s += (stats.pass_yds||0)/2500 + (stats.pass_td||0)/12;
  else if (pos === "RB") s += (stats.rush_yds||0)/800*1.2 + (stats.rush_td||0)/6 + (stats.rec_yds||0)/2000;
  else if (pos === "WR" || pos === "TE") s += (stats.rec_yds||0)/1200*1.2 + (stats.rec_td||0)/8;
  else if (pos === "DL") s += (stats.sk||0)/4 + (stats.tkl||0)/100;
  else if (pos === "LB") s += (stats.sk||0)/3 + (stats.tkl||0)/60 + (stats.int_made||0)/4;
  else if (pos === "CB" || pos === "S")  s += (stats.int_made||0)/6 + (stats.pd||0)/40 + (stats.tkl||0)/200;
  else if (pos === "K") s += (stats.fg_made||0)/18;
  else if (["OL","LT","LG","C","RG","RT"].includes(pos)) s += (stats.pancakes||0)/18;
  s *= _hofPositionMul(pos);
  return Math.round(s);
}

// Slim-snapshot a retired player into the HOF candidate pool. A
// retiree must clear the candidate floor to appear on any ballot;
// most journeymen never even get nominated.
const _HOF_STAT_KEYS = ["pass_yds","pass_td","pass_int","rush_yds","rush_att","rush_td","rec","rec_yds","rec_td","sk","tkl","int_made","pd","fg_made","fg_long","xp_made","pancakes","sacks_allowed","kr_yds","pr_yds","kr_td","pr_td"];
const _HOF_CANDIDATE_MIN = 25;
function _addHOFCandidate(player, team) {
  const score = _computeHOFScore(player);
  if (score < _HOF_CANDIDATE_MIN) return false;
  if (!franchise._hofEligible) franchise._hofEligible = [];
  const cleanStats = {};
  for (const k of _HOF_STAT_KEYS) if (player.careerStats?.[k]) cleanStats[k] = player.careerStats[k];
  const peak = Math.max(
    ...(player.careerHistory||[]).map(h => h.ovr ?? h.overall ?? 0),
    player.overall || 0
  );
  franchise._hofEligible.push({
    name: player.name, pos: player.position,
    age: player.age, retiredSeason: franchise.season,
    firstEligible: franchise.season + 1,
    yearsOnBallot: 0,
    teamName: team ? `${team.city} ${team.name}` : "?",
    teamId: team?.id,
    teamPrimary: team?.primary || "#888",
    teamAbbr: team ? (typeof _bspnLiveAbbr === "function" ? _bspnLiveAbbr(team) : (team.abbr || team.name.slice(0,3).toUpperCase())) : "—",
    careerStats: cleanStats,
    careerEarnings: player.careerEarnings || 0,
    careerYears: player.seasonsPlayed || (player.careerHistory || []).length,
    peakOvr: peak,
    accolades: {
      mvps: player.mvps || 0, opoys: player.opoys || 0, dpoys: player.dpoys || 0,
      roys: player.roys || 0, allPros: player.allPros || 0,
      proBowls: player.proBowls || 0, sbRings: player.sbRings || 0,
    },
    careerHistory: (player.careerHistory || []).map(r => {
      const slim = { season: r.season, pos: r.pos, ovr: r.ovr, teamName: r.teamName, age: r.age };
      for (const k of _HOF_STAT_KEYS) if (r[k]) slim[k] = r[k];
      if (r.accolades?.length) slim.accolades = r.accolades.slice();
      return slim;
    }),
    baseScore: score,
  });
  return true;
}

// Annual HOF Selection Committee vote. Inducts the top candidates from
// the eligible pool above an induction threshold, max 6 per class.
// Drops candidates after 10 years on ballot (Veterans Committee fallback
// would go here in a future enhancement).
// HoF selection — bumped induct threshold 55 → 65 to make first-ballot
// induction actually meaningful. At 55, the 500-season sim landed
// 84% of inductees as first-ballot (real NFL is ~50%). At 65, only
// genuinely elite resumes clear on first attempt; lesser candidates
// sit on the ballot and lose 2 points/year past year 1 of eligibility.
const _HOF_INDUCT_THRESHOLD = 65;
const _HOF_MAX_CLASS = 6;
const _HOF_MAX_BALLOT_YEARS = 10;
function _runHOFVoting() {
  if (!franchise._hofEligible) franchise._hofEligible = [];
  if (!franchise.hallOfFame) franchise.hallOfFame = [];
  const currentSeason = franchise.season;
  const ballot = franchise._hofEligible
    .filter(c => currentSeason >= (c.firstEligible || (c.retiredSeason + 1)));
  for (const c of ballot) c.yearsOnBallot = (c.yearsOnBallot || 0) + 1;
  const scored = ballot.map(c => ({
    cand: c,
    score: (c.baseScore || 0) - Math.max(0, (c.yearsOnBallot - 1)) * 2,
  })).sort((a, b) => b.score - a.score);
  const winners = scored
    .filter(s => s.score >= _HOF_INDUCT_THRESHOLD)
    .slice(0, _HOF_MAX_CLASS);
  const inductees = [];
  for (const { cand, score } of winners) {
    const firstBallot = cand.yearsOnBallot === 1;
    const votePct = Math.min(99, Math.max(60,
      Math.round(60 + (score - _HOF_INDUCT_THRESHOLD) * 1.5)));
    const inductee = {
      name: cand.name, pos: cand.pos,
      age: cand.age, season: currentSeason,
      teamName: cand.teamName, teamPrimary: cand.teamPrimary || "#888",
      teamAbbr: cand.teamAbbr || "—",
      careerStats: cand.careerStats,
      careerEarnings: cand.careerEarnings,
      careerYears: cand.careerYears,
      careerHistory: cand.careerHistory,
      firstBallot, votePct,
      yearsOnBallot: cand.yearsOnBallot,
      classSeason: currentSeason,
      retiredSeason: cand.retiredSeason,
      peakOvr: cand.peakOvr,
      accolades: cand.accolades,
      line: typeof mvpStatLine === "function" ? mvpStatLine(cand.careerStats || {}) : "",
    };
    franchise.hallOfFame.push(inductee);
    inductees.push(inductee);
    _pushNews({ type:"hof",
      label: `🏛 HALL OF FAME · ${cand.name} (${cand.pos}) enshrined${firstBallot?" — FIRST BALLOT":""} · ${votePct}%` });
  }
  if (inductees.length) {
    _pushNews({ type:"hof",
      label: `🏛 HOF CLASS OF S${currentSeason}: ${inductees.length} inductee${inductees.length===1?"":"s"} — ${inductees.map(i => i.name).join(", ")}` });
  }
  const winnerNames = new Set(winners.map(w => w.cand.name));
  franchise._hofEligible = franchise._hofEligible
    .filter(c => !winnerNames.has(c.name))
    .filter(c => (c.yearsOnBallot || 0) < _HOF_MAX_BALLOT_YEARS);
  return inductees;
}

// Legacy shim — preserved for any saves/callers still wired to the old
// direct-enshrinement path. New code routes retirees through
// _addHOFCandidate + _runHOFVoting instead.
function _maybeEnshrineHOF(player, team) {
  _addHOFCandidate(player, team);
}

// Build a career-stats card for any player — shown when you click into
// a player from the scout / roster screens. Falls back gracefully for
// rookies with no career data yet.
function _buildCareerCard(p) {
  const history = p.careerHistory || [];
  const stats   = p.careerStats   || {};
  if (history.length === 0) {
    const collLine  = p.collegeProfile?.line  || "";
    const collKnock = p.collegeProfile?.knock || "";
    const school    = p.collegeProfile?.school || "";
    const level     = p.collegeProfile?.level || "";
    // F2 multi-year college career — pre-game school history. Shows
    // each underclass year as a row; SR year is the collLine itself.
    const career    = p.collegeCareer?.history || [];
    const currentYrLabel = p.collegeYear || "SR";
    const careerRows = career.map(c => `
      <tr>
        <td style="color:var(--gold);font-weight:700;padding:.12rem .3rem .12rem 0;font-size:.6rem">${c.year}</td>
        <td style="color:var(--gray);padding:.12rem .3rem;font-size:.6rem">${c.season}</td>
        <td style="color:var(--blgray);padding:.12rem .3rem;font-size:.6rem">${c.role}</td>
        <td style="color:var(--gray);padding:.12rem .3rem;font-size:.6rem">${c.games}G</td>
        <td style="color:var(--blgray);padding:.12rem 0;font-size:.6rem">${c.stats || "—"}</td>
      </tr>`).join("");
    // Senior-year row (the current/peak season the prospect is being
    // drafted off of). Uses the existing collegeProfile.line which now
    // includes the school name + level prefix.
    const seniorStats = collLine.replace(`${school}${level ? ` (${level})` : ""} · `, "");
    const seniorRow = collLine ? `
      <tr style="background:rgba(200,169,0,.05)">
        <td style="color:var(--gold);font-weight:700;padding:.12rem .3rem .12rem 0;font-size:.6rem">${currentYrLabel}</td>
        <td style="color:var(--gray);padding:.12rem .3rem;font-size:.6rem">—</td>
        <td style="color:var(--gold-lt);padding:.12rem .3rem;font-size:.6rem;font-weight:700">Draft year</td>
        <td style="color:var(--gray);padding:.12rem .3rem;font-size:.6rem">—</td>
        <td style="color:var(--white);padding:.12rem 0;font-size:.6rem;font-weight:700">${seniorStats}</td>
      </tr>` : "";
    const collBlock = (collLine || career.length) ? `
      <div style="margin:.35rem 0 .1rem;padding:.4rem .55rem;background:rgba(255,255,255,.04);border-left:2px solid var(--gray);border-radius:2px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.25rem">
          <div style="font-size:.57rem;color:var(--gray);letter-spacing:.4px">COLLEGE${school ? ` · ${school.toUpperCase()}` : ""}</div>
          ${level ? `<div style="font-size:.54rem;color:#e8a000;letter-spacing:.4px;font-weight:700">${level}</div>` : ""}
        </div>
        ${(career.length || collLine) ? `<table style="width:100%;border-collapse:collapse;font-family:'IBM Plex Mono','JetBrains Mono',monospace">${careerRows}${seniorRow}</table>` : ""}
        ${collKnock ? `<div style="font-size:.6rem;color:#e8a000;margin-top:.3rem">⚠ ${collKnock}</div>` : ""}
      </div>` : "";
    return `<div class="frn-career-card">
      <div class="frn-card-title">📊 CAREER</div>
      <div style="color:var(--gray);font-size:.72rem;padding:.4rem 0">
        ${p.isProspect ? "Prospect — pre-draft" : "Rookie season — no career stats yet."}
      </div>
      ${collBlock}
      <div class="frn-player-meta">
        <div><span class="frn-meta-label">DRAFT</span> ${draftStr(p)}</div>
        <div><span class="frn-meta-label">CAREER $</span> ${careerEarningsStr(p)}</div>
      </div>
    </div>`;
  }
  // Pick stat columns based on position. Drop columns whose total across
  // the entire history is zero — keeps a non-mobile QB from showing all-0
  // RUSH/R-TD columns, a non-receiving RB from showing REC TD, etc.
  const _allCols = _careerColsFor(p.position);
  const cols = _allCols.filter(c => history.some(r => (r[c.key] || 0) > 0));
  // OVR column visibility: matches the rest of the app's scout-grade
  // philosophy. Owned players + HOF/retired show real OVR; opposing
  // players + FAs see grades / public stats only. HOF detection is
  // duck-typed on the absence of a roster reference. FA-pool members
  // are explicitly hidden — historical OVRs from when they were on an
  // AI team must not leak through their FA player card.
  const isHofEntry = !!p.careerYears && !p.position && !p.archetype;
  const isRetiredAlumni = !!p.retiredAt;
  const isFreeAgent = !!(franchise?.freeAgents?.some(fa =>
    fa === p || (fa.pid && p.pid && fa.pid === p.pid) || (fa.name === p.name && fa.position === p.position)
  ));
  const isOpposingRoster = !isFreeAgent && (() => {
    const myId = franchise?.chosenTeamId;
    for (const [tid, roster] of Object.entries(franchise?.rosters || {})) {
      if (Number(tid) === myId) continue;
      if (roster.some(rp => rp === p || (rp.pid && p.pid && rp.pid === p.pid) || (rp.name === p.name && rp.position === p.position))) return true;
    }
    return false;
  })();
  const showOvr = !isFreeAgent && !isOpposingRoster && (_isOwnedPlayer(p) || isHofEntry || isRetiredAlumni);
  const trajLabel = {
    EARLY_BLOOM: "⚡ Early Bloomer", LATE_BLOOM: "🌱 Late Bloomer",
    CONSISTENT: "📈 Consistent",    STREAKY: "〰 Streaky",
    FLASH: "💥 Flash",
  }[p._trajectory] || "";
  const _accAbbr = a => a === "MVP" ? "MVP" : a === "Super Bowl MVP" ? "SB MVP" : a === "Super Bowl" ? "💍" : a === "All-Pro" ? "AP1" : a === "All-Pro (2nd)" ? "AP2" : a === "Pro Bowl" ? "PB" : a === "OPOY" ? "OPOY" : a === "DPOY" ? "DPOY" : a === "ROY" ? "ROY" : a === "Comeback POY" ? "CPOY" : a === "Breakout POY" ? "BPOY" : "";
  const hasAcc = history.some(r => (r.accolades||[]).length > 0);
  const ovrTh = showOvr ? `<th>OVR</th>` : "";
  const headerHtml = `<tr><th>AGE</th><th>TEAM</th>${ovrTh}<th>GP</th>${cols.map(c => `<th>${c.label}</th>`).join("")}${hasAcc ? "<th>🏆</th>" : ""}</tr>`;
  const peakOvr = Math.max(...history.map(r => r.ovr ?? r.overall ?? 0));
  const rowsHtml = history.slice().reverse().map((row) => {
    const rowOvr = row.ovr ?? row.overall;
    const isCareerBest = rowOvr != null && rowOvr === peakOvr;
    const accCell = hasAcc
      ? `<td style="font-size:.55rem;color:var(--gold);white-space:nowrap">${(row.accolades||[]).map(_accAbbr).filter(Boolean).join(" ")}</td>`
      : "";
    const ovrTd = showOvr
      ? `<td style="color:${isCareerBest?"var(--gold)":"var(--blgray)"};font-weight:${isCareerBest?700:400}">${rowOvr || "—"}</td>`
      : "";
    const reconStyle = row._reconstructed ? "opacity:.65;font-style:italic" : "";
    const teamTxt = row._reconstructed ? `${row.teamName || "Prior teams"} <span style="color:var(--gray);font-size:.55rem">~estimated</span>` : (row.teamName || "");
    return `<tr style="${reconStyle}">
      <td style="color:var(--gray);font-size:.63rem">${row.age ?? "?"}</td>
      <td style="font-size:.62rem;color:var(--gray)">${teamTxt}</td>
      ${ovrTd}
      <td>${row.gp || 0}</td>
      ${cols.map(c => `<td>${row[c.key] || 0}</td>`).join("")}
      ${accCell}
    </tr>`;
  }).join("");
  const totalsColspan = showOvr ? 3 : 2;
  const totalsRow = `<tr style="border-top:2px solid var(--gold);font-weight:700">
    <td colspan="${totalsColspan}" style="color:var(--gold)">CAREER</td>
    <td>${stats.gp || history.reduce((s,r)=>s+(r.gp||0),0)}</td>
    ${cols.map(c => `<td style="color:var(--gold-lt)">${stats[c.key]||0}</td>`).join("")}
    ${hasAcc ? "<td></td>" : ""}
  </tr>`;
  // PLAYOFFS sub-row — only shown if the player has any playoff games on
  // record. careerPlayoffStats is the cumulative store rolled in
  // _rollSeasonStatsToCareer from franchise.seasonPlayoffStats.
  const poStats = p.careerPlayoffStats || {};
  const poGP = +(poStats.gp || 0);
  const playoffRow = poGP > 0 ? `<tr style="font-weight:700;color:#ffc850">
    <td colspan="${totalsColspan}" title="Playoff games only — not double-counted in CAREER above">🏆 PLAYOFFS</td>
    <td>${poGP}</td>
    ${cols.map(c => `<td>${poStats[c.key]||0}</td>`).join("")}
    ${hasAcc ? "<td></td>" : ""}
  </tr>` : "";
  // Trim hint — when careerStats sums to more than the visible rows
  // (older history rows were trimmed for storage), surface a small
  // note so the totals don't read as "doesn't add up". Computed by
  // comparing visible rows' GP sum to stats.gp.
  const visibleGP = history.reduce((s, r) => s + (r.gp || 0), 0);
  const trimGapGP = Math.max(0, (stats.gp || 0) - visibleGP);
  // Estimate "earlier seasons not shown" from a typical 14-game season
  const estEarlierSeasons = Math.round(trimGapGP / 14);
  const trimNote = trimGapGP > 0
    ? `<div style="font-size:.55rem;color:var(--gray);font-style:italic;text-align:right;margin-top:.15rem">+ ~${estEarlierSeasons} earlier season${estEarlierSeasons===1?"":"s"} trimmed — totals reflect full career</div>`
    : "";
  return `<div class="frn-career-card">
    <div style="display:flex;align-items:center;gap:.55rem;margin-bottom:.3rem">
      <div class="frn-card-title" style="margin:0">📊 CAREER · ${p.seasonsPlayed || history.length} season${(p.seasonsPlayed || history.length)>1?"s":""}${(p.seasonsPlayed && p.seasonsPlayed > history.length) ? ` <span style="color:var(--gray);font-weight:400;font-size:.62rem">(showing last ${history.length})</span>` : (trimGapGP > 0 ? ` <span style="color:var(--gray);font-weight:400;font-size:.62rem">(of ~${history.length + estEarlierSeasons} played)</span>` : "")}</div>
      ${trajLabel ? `<span style="font-size:.58rem;color:var(--blgray)">${trajLabel}</span>` : ""}
    </div>
    <div style="overflow-x:auto">
      <table class="frn-pre-roster-table"><thead>${headerHtml}</thead>
        <tbody>${rowsHtml}${totalsRow}${playoffRow}</tbody>
      </table>
    </div>
    ${trimNote}
    <div class="frn-player-meta">
      <div><span class="frn-meta-label">DRAFT</span> ${draftStr(p)}</div>
      <div><span class="frn-meta-label">CAREER $</span> ${careerEarningsStr(p)}</div>
    </div>
  </div>`;
}

function _careerColsFor(pos) {
  if (pos === "QB") return [
    { key:"pass_yds", label:"YDS" }, { key:"pass_td", label:"TD" },
    { key:"pass_int", label:"INT" }, { key:"pass_att", label:"ATT" },
    { key:"rush_yds", label:"RUSH" }, { key:"rush_td", label:"R-TD" },
  ];
  if (pos === "RB") return [
    { key:"rush_yds", label:"YDS" }, { key:"rush_td", label:"TD" },
    { key:"rush_att", label:"ATT" },
    { key:"rec", label:"REC" }, { key:"rec_yds", label:"REC YDS" }, { key:"rec_td", label:"REC TD" },
  ];
  if (pos === "WR" || pos === "TE") return [
    { key:"rec_yds", label:"YDS" }, { key:"rec_td", label:"TD" },
    { key:"rec", label:"REC" }, { key:"rec_tgt", label:"TGT" },
  ];
  if (pos === "DL") return [
    { key:"tkl", label:"TKL" }, { key:"sk", label:"SK" },
    { key:"ff", label:"FF" }, { key:"fr", label:"FR" },
    { key:"pd", label:"PD" }, { key:"def_td", label:"TD" },
  ];
  if (pos === "LB") return [
    { key:"tkl", label:"TKL" }, { key:"sk", label:"SK" },
    { key:"int_made", label:"INT" }, { key:"pd", label:"PD" },
    { key:"ff", label:"FF" }, { key:"def_td", label:"TD" },
  ];
  if (pos === "CB" || pos === "S") return [
    { key:"int_made", label:"INT" }, { key:"pd", label:"PD" },
    { key:"tkl", label:"TKL" }, { key:"ff", label:"FF" },
    { key:"def_td", label:"TD" },
  ];
  if (pos === "K") return [
    { key:"fg_made", label:"FGM" }, { key:"fg_att", label:"FGA" },
    { key:"fg_long", label:"LONG" },
    { key:"xp_made", label:"XPM" }, { key:"xp_att", label:"XPA" },
  ];
  if (pos === "P") return [
    { key:"punts", label:"PNT" }, { key:"punt_yds", label:"YDS" },
    { key:"punt_long", label:"LONG" },
  ];
  if (pos === "OL") return [
    { key:"pancakes", label:"PNK" }, { key:"sacks_allowed", label:"SA" },
    { key:"penalties", label:"PEN" },
  ];
  return [{ key:"gp", label:"GP" }];
}

// ── Injuries ──────────────────────────────────────────────────────────────────
// Per-game injury chance per player on a team, by position. Higher
// numbers for trench positions where contact is constant.
// Per-game per-player CONTACT injury rate. Non-contact injuries (most
// hamstring/calf/groin/achilles + half of ACL tears) fire from a parallel
// stress-driven path — see _rollNonContactInjuries. V11 audit showed
// 9.8 contact + 1.9 non-contact = 11.7 total but split 84/16 vs NFL ~60/40.
// Rates lifted ~50%: Brady audit showed injuries / team-season at 14.7 vs NFL
// band 18-42, and elite QBs were playing 17/17 every season (stacking top-of-
// distribution passing totals). This roller — not the in-play big-hit roller
// — is what the audit measures and what drives franchise-level games-missed.
// Lifting it lands the audit metric in band AND introduces the natural 1-2
// missed-starts attrition that trims elite QB season totals (Brady/Manning/
// Brees pattern).
const INJURY_RATE = { QB:0.013, RB:0.025, WR:0.018, TE:0.021, OL:0.025,
                     DL:0.025, LB:0.022, CB:0.018, S:0.015, K:0.003, P:0.003 };
// Each injury type carries a baseline OVR penalty applied AFTER recovery
// to model the "rehabbing back to full speed" arc. Soft-tissue stuff
// heals clean (penalty 0); structural injuries leave lingering damage.
const INJURY_TYPES = [
  // CONTACT-driven pool (selected by _rollGameInjuries via _POS_INJURY_WEIGHTS):
  { label:"concussion",  min:1, max:2, w:15, severity:"soft",       ovrPenalty:0 },
  { label:"shoulder",    min:2, max:5, w:10, severity:"structural", ovrPenalty:2 },
  { label:"hand/wrist",  min:1, max:3, w:10, severity:"soft",       ovrPenalty:0 },
  { label:"knee",        min:3, max:8, w:10, severity:"structural", ovrPenalty:3 },
  { label:"ankle sprain",min:1, max:4, w:25, severity:"soft",       ovrPenalty:0 },
  { label:"hamstring",   min:1, max:3, w:30, severity:"soft",       ovrPenalty:0 },
  // NON-CONTACT-driven pool (selected by _rollNonContactInjuries via
  // _NON_CONTACT_INJURY_WEIGHTS). Note: ankle / knee / hamstring overlap
  // both pools because they can be both contact and stress-driven (half
  // of ACL tears are non-contact, etc.) — the path tags it via `cause`.
  { label:"calf strain", min:1, max:3, w:0,  severity:"soft",       ovrPenalty:0 },
  { label:"groin pull",  min:1, max:3, w:0,  severity:"soft",       ovrPenalty:0 },
  { label:"achilles",    min:2, max:6, w:0,  severity:"soft",       ovrPenalty:1 },
];
// Catastrophic upgrade variants — 8% of all rolled injuries upgrade to a
// season-altering version. Of those, a small careerEndingChance retires
// the player (Andrew Luck, Bo Jackson arcs). Multi-month durations exceed
// the regular-season length, so the player is functionally lost for the
// season.
const _CATASTROPHIC_VARIANTS = {
  // Career-ending chances bumped after audit V4 showed 1.7 CE/season
  // league-wide vs NFL ~5-10. Doubling these lands at ~8-10/season,
  // matching headline NFL injury news cadence (Luck, Bo Jackson, etc.).
  "knee":         { label:"torn ACL",                     min:12, max:24, ovrPenalty:6, careerEndingChance:0.10 },
  "concussion":   { label:"chronic concussion syndrome",  min:8,  max:16, ovrPenalty:5, careerEndingChance:0.15 },
  "shoulder":     { label:"labrum tear",                  min:12, max:20, ovrPenalty:5, careerEndingChance:0.06 },
  "ankle sprain": { label:"Lisfranc fracture",            min:10, max:18, ovrPenalty:4, careerEndingChance:0.04 },
  // Non-contact catastrophic: torn achilles is the season-ender from the
  // achilles path; chronic hamstring is the lingering soft-tissue that
  // hangs around all year with reduced OVR (DK Metcalf, Adams pattern).
  "achilles":     { label:"torn achilles",                min:16, max:32, ovrPenalty:8, careerEndingChance:0.12 },
  "hamstring":    { label:"chronic hamstring",            min:3,  max:6,  ovrPenalty:3, careerEndingChance:0.01 },
};
// Bumped from 0.08 → 0.12 in audit V5. Only knee/concussion/shoulder/
// ankle are eligible for catastrophic upgrade (~60% of all injuries),
// so the effective catastrophic rate after the !isCatastrophic gate
// is ~7%. Lifts NFL career-ending injuries to ~3-5/season from 1.5.
//
// 2026-05 tuning: prior 0.12 produced ~2.6 career-ending/season —
// below NFL's 5-10. Bumped to 0.20 → lifted toward the lower band edge.
// After the INJURY_RATE table was lifted 1.5x (total injuries 15.1 → 21.4 in
// band), season-ending dropped to 3.3 vs band 4-14 because upgrade chance is
// independent of base rate. Re-tuned to 0.27 to land season-ending at ~4.5/
// team-season — lower band edge, matching NFL's ~5-10 IR placements per team
// per season cadence.
const _CATASTROPHIC_UPGRADE_CHANCE = 0.27;
// Position-aware severity multiplier on the rehab OVR penalty. Speed-
// dependent positions (CB/WR/RB) lose more from structural injuries; OL/K
// lose less because they don't rely on explosiveness.
const _POS_INJURY_PENALTY_MUL = {
  CB: 1.5, WR: 1.5, S: 1.3, RB: 1.3,
  TE: 1.0, LB: 1.0, DL: 1.0, QB: 1.0,
  OL: 0.7, K: 0.5, P: 0.5,
};

// Position-specific CONTACT injury type weights. NFL data: hamstring
// strains are virtually ALL non-contact (sprint mechanics), so they're
// removed from the contact pool here and moved to _NON_CONTACT_INJURY_
// WEIGHTS. Ankle/knee shares roughly halved because the non-contact
// halves of those (cut-and-tear ACL, rolled ankle on a plant) now fire
// from the stress path.
const _POS_INJURY_WEIGHTS = {
  QB: { "ankle sprain":10, "concussion":35, "knee":12, "shoulder":36, "hand/wrist":7 },
  RB: { "ankle sprain":17, "concussion":13, "knee":28, "shoulder":22, "hand/wrist":20 },
  WR: { "ankle sprain":18, "concussion":18, "knee":22, "shoulder":22, "hand/wrist":20 },
  TE: { "ankle sprain":14, "concussion":18, "knee":22, "shoulder":30, "hand/wrist":16 },
  OL: { "ankle sprain":13, "concussion":5,  "knee":17, "shoulder":40, "hand/wrist":25 },
  DL: { "ankle sprain":13, "concussion":12, "knee":22, "shoulder":35, "hand/wrist":18 },
  LB: { "ankle sprain":15, "concussion":20, "knee":22, "shoulder":22, "hand/wrist":21 },
  CB: { "ankle sprain":18, "concussion":15, "knee":25, "shoulder":22, "hand/wrist":20 },
  S:  { "ankle sprain":15, "concussion":32, "knee":18, "shoulder":20, "hand/wrist":15 },
  // K/P keep hamstring in their pool — they get most injuries from kicking
  // mechanics (which IS non-contact, but the simple model treats them as one):
  K:  { "hamstring":40, "ankle sprain":30, "concussion":3,  "knee":12, "shoulder":5,  "hand/wrist":10 },
  P:  { "hamstring":40, "ankle sprain":30, "concussion":3,  "knee":12, "shoulder":5,  "hand/wrist":10 },
};

// Position-specific NON-CONTACT injury weights. Hamstring dominates;
// speed/agility positions skew higher. Achilles is rare but devastating.
const _NON_CONTACT_INJURY_WEIGHTS = {
  QB: { "hamstring":40, "calf strain":15, "groin pull":18, "ankle sprain":12, "knee":10, "achilles":5 },
  RB: { "hamstring":35, "calf strain":13, "groin pull":10, "ankle sprain":15, "knee":20, "achilles":7 },
  WR: { "hamstring":45, "calf strain":15, "groin pull":10, "ankle sprain":12, "knee":12, "achilles":6 },
  TE: { "hamstring":35, "calf strain":14, "groin pull":10, "ankle sprain":15, "knee":18, "achilles":8 },
  OL: { "hamstring":25, "calf strain":15, "groin pull":12, "ankle sprain":18, "knee":22, "achilles":8 },
  DL: { "hamstring":30, "calf strain":15, "groin pull":10, "ankle sprain":15, "knee":22, "achilles":8 },
  LB: { "hamstring":35, "calf strain":15, "groin pull":10, "ankle sprain":15, "knee":18, "achilles":7 },
  CB: { "hamstring":45, "calf strain":15, "groin pull":10, "ankle sprain":12, "knee":12, "achilles":6 },
  S:  { "hamstring":40, "calf strain":15, "groin pull":12, "ankle sprain":13, "knee":12, "achilles":8 },
  K:  { "calf strain":35, "groin pull":35, "hamstring":15, "ankle sprain":10, "knee":3, "achilles":2 },
  P:  { "calf strain":35, "groin pull":35, "hamstring":15, "ankle sprain":10, "knee":3, "achilles":2 },
};

function _pickNonContactInjuryType(position) {
  const weights = _NON_CONTACT_INJURY_WEIGHTS[position];
  if (!weights) return null;
  const total = Object.values(weights).reduce((s, v) => s + v, 0);
  let r = Math.random() * total;
  for (const t of INJURY_TYPES) {
    const w = weights[t.label] ?? 0;
    if (w > 0 && (r -= w) < 0) return t;
  }
  return null;
}

function _pickInjuryType(position) {
  const weights = _POS_INJURY_WEIGHTS[position];
  if (!weights) {
    // Legacy fallback — uniform sample
    const total = INJURY_TYPES.reduce((s,t)=>s+t.w,0);
    let r = Math.random() * total;
    for (const t of INJURY_TYPES) { if ((r -= t.w) < 0) return t; }
    return INJURY_TYPES[0];
  }
  const total = Object.values(weights).reduce((s, v) => s + v, 0);
  let r = Math.random() * total;
  for (const t of INJURY_TYPES) {
    const w = weights[t.label] ?? 1;
    if ((r -= w) < 0) return t;
  }
  return INJURY_TYPES[0];
}

// Roll the QUALITY of a player's recovery from a structural injury.
// Real NFL outcomes span: Adrian Peterson MVP-after-ACL (full bounce or
// stronger), Carson Palmer Pro Bowl Y1 back (standard), Wes Welker
// lingering (worse than original), Robert Griffin III never-recovered
// (career-altering, permanent loss).
// ── BODY-PART WEAR ─────────────────────────────────────────────────────
// Per-region wear (0-100) survives across games like _wear, but lets us
// track where the damage actually is — slick UI visualization in Vitals
// tab shows a body diagram with color-coded regions.
// Flat schema (no nested L/R objects) for clean serialization + UI mapping.
// Left/right symmetric where biology demands (shoulders, knees, etc.).
const _BODY_PARTS = [
  "head", "neck", "chest", "back", "groin",
  "shoulderL", "shoulderR",
  "hipL", "hipR",
  "hamstringL", "hamstringR",
  "kneeL", "kneeR",
  "calfL", "calfR",
  "achillesL", "achillesR",
  "ankleL", "ankleR",
  "handL", "handR",
];
function _ensureBodyWear(p) {
  if (!p._bodyWear) {
    p._bodyWear = {};
    for (const part of _BODY_PARTS) p._bodyWear[part] = 0;
  }
}
// Map an injury label to a body-part. Two-sided parts get a random L/R
// unless the injury history pre-determines it (chronic recurrence). For
// hamstring/shoulder/knee, if the player has a prior injury, 70% chance
// the new injury hits the same side — chronic-side patterns are real.
function _bumpBodyPart(p, label, amount = 35) {
  _ensureBodyWear(p);
  const bw = p._bodyWear;
  // Helper to pick L or R, with recurrence bias on the higher-worn side.
  const pickSide = (Lkey, Rkey) => {
    const lWear = bw[Lkey] || 0, rWear = bw[Rkey] || 0;
    // 70% chance to re-injure the more-worn side
    if (lWear !== rWear && Math.random() < 0.70) return lWear > rWear ? Lkey : Rkey;
    return Math.random() < 0.5 ? Lkey : Rkey;
  };
  const bump = (key) => { bw[key] = Math.min(100, (bw[key] || 0) + amount); };
  switch (label) {
    case "concussion":
    case "chronic concussion syndrome":
      bump("head"); return "head";
    case "shoulder":
    case "labrum tear":
      { const k = pickSide("shoulderL","shoulderR"); bump(k); return k; }
    case "hand/wrist":
      { const k = pickSide("handL","handR"); bump(k); return k; }
    case "knee":
    case "torn ACL":
      { const k = pickSide("kneeL","kneeR"); bump(k); return k; }
    case "ankle sprain":
    case "Lisfranc fracture":
      { const k = pickSide("ankleL","ankleR"); bump(k); return k; }
    case "hamstring":
    case "chronic hamstring":
      { const k = pickSide("hamstringL","hamstringR"); bump(k); return k; }
    case "calf strain":
      { const k = pickSide("calfL","calfR"); bump(k); return k; }
    case "achilles":
    case "torn achilles":
      { const k = pickSide("achillesL","achillesR"); bump(k); return k; }
    case "groin pull":
      bump("groin"); return "groin";
    default:
      return null;
  }
}
// Decay body-part wear weekly. Slower than overall wear because structural
// damage lingers — torn ligaments leave scar tissue, concussions echo.
// Decay is symmetric for all parts (no part-specific recovery rates yet).
function _decayBodyPartWear(p) {
  if (!p._bodyWear) return;
  const age = p.age || 25;
  // Younger bodies repair quickly; vets carry damage longer.
  const decay = age >= 33 ? 0.7 : age >= 30 ? 1.0 : 1.4;
  for (const part of _BODY_PARTS) {
    if (p._bodyWear[part] > 0) {
      p._bodyWear[part] = Math.max(0, p._bodyWear[part] - decay);
    }
  }
}

function _rollRehabOutcome(player) {
  const age = player.age || 27;
  let probFull       = 0.15;
  let probBetter     = 0.03;
  let probStandard   = 0.60;
  let probLingering  = 0.17;
  // careerAltering is the remainder
  if (age <= 25) { probFull += 0.05; probLingering -= 0.03; }
  if (age >= 30) { probFull -= 0.05; probLingering += 0.05; }
  if (player.ironman) probFull += 0.10;
  if (player.coachable) probFull += 0.05;
  probFull = Math.max(0, Math.min(0.45, probFull));
  probLingering = Math.max(0, probLingering);
  const probCareerAlter = Math.max(0, 1 - probFull - probBetter - probStandard - probLingering);
  const r = Math.random();
  let acc = probFull;        if (r < acc) return "full";
  acc += probBetter;         if (r < acc) return "better";
  acc += probStandard;       if (r < acc) return "standard";
  acc += probLingering;      if (r < acc) return "lingering";
  return "career-altering";
}

// Apply rehab OVR penalty when an injury fully resolves. The outcome
// roll picks one of five recovery quality bands — most players recover
// normally, a lucky few bounce back instantly or stronger, a rare few
// never quite recover. Decay handled at offseason.
function _applyRehabPenalty(p, tId, isCatastrophic) {
  const inj = p.injury;
  if (!inj) return;
  const baseOvr = inj._ovrPenalty || 0;
  if (baseOvr <= 0) return;
  const posMul = _POS_INJURY_PENALTY_MUL[p.position] ?? 1.0;
  const basePenalty = Math.max(1, Math.round(baseOvr * posMul));
  const outcome = _rollRehabOutcome(p);
  const myId = franchise.chosenTeamId;
  const isMine = tId === myId;
  const newsName = `${p.name} (${p.position})`;

  if (outcome === "full") {
    if (isMine && typeof _pushNews === "function") {
      _pushNews({ type:"injury",
        label: `✨ ${newsName} — made a clean recovery from ${inj.label}, no rehab penalty` });
    }
    return;
  }
  if (outcome === "better") {
    // Tiny temp penalty + permanent OVR boost on the back end (AP MVP arc)
    const tempPenalty = 2;
    p.overall = Math.max(40, (p.overall || 60) - tempPenalty);
    p._rehabRestore = (p._rehabRestore || 0) + tempPenalty;
    p._rehabSeasons = Math.max(p._rehabSeasons || 0, 1);
    p._rehabPermGain = (p._rehabPermGain || 0) + 1;
    if (isMine && typeof _pushNews === "function") {
      _pushNews({ type:"injury",
        label: `🌟 ${newsName} — comeback story after ${inj.label}, return at −2 OVR but +1 permanent at full health` });
    }
    return;
  }
  const seasonsFor = isCatastrophic ? 2 : 1;
  let penalty = basePenalty;
  let restoreCap = basePenalty;
  let seasons = seasonsFor;
  if (outcome === "lingering") {
    penalty = Math.max(1, Math.round(basePenalty * 1.5));
    restoreCap = penalty;          // fully recovers, just takes longer
    seasons = seasonsFor + 1;
  } else if (outcome === "career-altering") {
    penalty = Math.max(1, Math.round(basePenalty * 2));
    // Only half the penalty ever recovers — the other half is permanent
    restoreCap = Math.round(penalty * 0.5);
    seasons = seasonsFor;
  }
  p.overall = Math.max(40, (p.overall || 60) - penalty);
  p._rehabRestore = (p._rehabRestore || 0) + restoreCap;
  p._rehabSeasons = Math.max(p._rehabSeasons || 0, seasons);
  if (isMine && typeof _pushNews === "function") {
    const tag = outcome === "lingering"      ? "⚠ Lingering damage"
              : outcome === "career-altering"? "💔 Career-altering"
              :                                 "🩹";
    const permNote = outcome === "career-altering" ? ` · ${penalty - restoreCap} OVR permanent loss` : "";
    _pushNews({ type:"injury",
      label: `${tag} ${newsName} — returns from ${inj.label}: −${penalty} OVR, ${seasons}-season rehab${permNote}` });
  }
}

// Soft-tissue injuries recur at +20% per prior incident; structural
// injuries (knee, shoulder, concussion) recur at +40%. Capped at 3x
// the base rate so even chronically banged-up vets aren't auto-injured.
const _SOFT_TISSUE_INJURIES = new Set(["hamstring", "ankle sprain", "hand/wrist"]);
function _injuryRecurrenceMul(p) {
  const hist = p.injuryHistory || [];
  let mul = 1.0;
  for (const past of hist) {
    mul += _SOFT_TISSUE_INJURIES.has(past.label) ? 0.20 : 0.40;
  }
  return Math.min(3.0, mul);
}
function _isInjuryProne(p) {
  return (p.injuryHistory || []).length >= 3;
}
// Locate the injuryHistory entry that produced the player's CURRENT injury so
// the UI can surface "happened W15" instead of just "16 wks out". Matches by
// label + same season, taking the latest week as the onset.
function _currentInjuryOnset(p) {
  if (!p?.injury || !franchise) return null;
  const hist = p.injuryHistory || [];
  let best = null;
  for (const h of hist) {
    if (h.season !== franchise.season) continue;
    if (h.label !== p.injury.label) continue;
    if (!best || (h.week || 0) > (best.week || 0)) best = h;
  }
  return best;
}
// Non-contact injury roll — fires from player's own stress/exertion, not
// from hits. Hamstrings on max-effort sprints, hip flexors on cuts, half
// of ACL tears from plant-and-twist. Per-game, after the contact roll,
// keyed on each player's _stress level (accumulated weekly).
function _rollNonContactInjuries(teamId) {
  const roster = franchise.rosters[teamId] || [];
  for (const p of roster) {
    if (p.injury && p.injury.weeksRemaining > 0) continue;
    const stress = p._stress || 0;
    // Non-contact rate bands. NFL "non-contact IR injuries" run ~30-40%
    // of total IR placements. Each audit pass lifts this:
    //   V11: 16% (too low)
    //   V12-V14: 23% (still under)
    //   V15: ~32% target (lifted bands 1.4-1.5x)
    //   2026-05: handoff §8 noted actual still ~25% — pushing to ~40%
    //   by lifting each band ~25% (high-stress bands lifted most since
    //   stress is the primary non-contact driver per Mai et al. 2017).
    let baseRate = stress >= 80 ? 0.062
                 : stress >= 60 ? 0.042
                 : stress >= 40 ? 0.026
                 : stress >= 20 ? 0.015
                 : stress >= 10 ? 0.010
                 :                0.004;
    // Early-season transition spike — NFL injury data (Mai et al. 2017,
    // PFR injury reports) shows ACL + hamstring incidence is ~2-2.5x
    // higher in Weeks 1-4 than mid-season. Bodies haven't built game-
    // speed neuromuscular control yet — cuts get awkward.
    const wk = franchise.week || 1;
    let earlyMul = wk <= 2 ? 2.0
                 : wk <= 4 ? 1.5
                 : wk <= 6 ? 1.2
                 :           1.0;
    // Player mitigation — veterans know how to prep their bodies, smart
    // players see hits coming and brace, ironmen do extra prep work, and
    // stars with All-Pro resumes treat conditioning as a job. Caps at
    // -60% reduction (vet + smart + ironman + decorated player).
    if (earlyMul > 1.0) {
      const seasons = p.seasonsPlayed || 0;
      const awr = p.stats?.[3] ?? 70;
      const accolades = (p.allPros || 0) + Math.floor((p.proBowls || 0) / 2);
      const condBonus =
          Math.min(0.25, seasons * 0.03)            // each season -3%, cap -25%
        + (awr >= 80 ? 0.07 : awr >= 70 ? 0.03 : 0) // smart prep
        + (p.ironman ? 0.15 : 0)                    // ironman trait big bonus
        + Math.min(0.15, accolades * 0.04);         // stars prep harder
      earlyMul = 1.0 + (earlyMul - 1.0) * (1 - Math.min(0.60, condBonus));
    }
    // Trainer trait: Sports Sci shop reduces early-season spike (modern
    // sports-science offseason programs really do help — Eagles, Bucs
    // famously low early-season ACL rates).
    const trainer = franchise.frontOffice?.[teamId]?.trainer;
    if (trainer?.trait === "Sports Sci") earlyMul = 1.0 + (earlyMul - 1.0) * 0.70;
    baseRate *= earlyMul;
    // Position vulnerability — speed/agility positions tear soft tissue more
    const pos = p.position || "?";
    const posMul = (pos === "WR" || pos === "CB" || pos === "S") ? 1.30
                 : (pos === "RB" || pos === "TE")                ? 1.10
                 : (pos === "LB" || pos === "DL")                ? 0.85
                 : (pos === "QB")                                  ? 0.70
                 : (pos === "OL")                                  ? 0.65
                 :                                                   0.50;
    // Age — older bodies tear easier on the same usage
    const age = p.age || 25;
    const ageMul = age >= 33 ? 1.55 : age >= 30 ? 1.25 : 1.0;
    // Recurrence — prior soft-tissue elevates repeat risk (Andrew Luck arc
    // applies to non-contact too)
    const recMul = (typeof _injuryRecurrenceMul === "function") ? _injuryRecurrenceMul(p) : 1.0;
    // Stamina absorbs some non-contact stress
    const stamina = p.stats?.[12] ?? 70;
    const staMul = clamp(1.3 - stamina/100, 0.7, 1.3);
    const rate = baseRate * posMul * ageMul * recMul * staMul;
    if (Math.random() >= rate) continue;
    let t = _pickNonContactInjuryType(p.position);
    if (!t) continue;
    // Early-season bias: ACLs and hamstrings are the dominant early-season
    // non-contact injury types (NFL data shows preseason→W1-4 ACL/hammy
    // spike from unconditioned cuts). 35% chance to override to knee or
    // hamstring in W1-4.
    if (wk <= 4 && Math.random() < 0.35) {
      const earlyType = Math.random() < 0.55 ? "hamstring" : "knee";
      const found = INJURY_TYPES.find(x => x.label === earlyType);
      if (found) t = found;
    }
    // Non-contact catastrophic — torn achilles or chronic hamstring.
    // 2026-05 tuning: 0.08 → 0.13 to match the catastrophic uplift on
    // the contact path. Non-contact catastrophic ends ~1-1.5 careers
    // per season instead of ~0.6.
    let isCatastrophic = false;
    let careerEnding = false;
    if (Math.random() < 0.13) {
      const variant = _CATASTROPHIC_VARIANTS[t.label];
      if (variant) {
        t = { ...t, ...variant };
        isCatastrophic = true;
        const ceAgeMul = age >= 35 ? 2.0 : age >= 32 ? 1.5 : age >= 30 ? 1.2 : 1.0;
        if (Math.random() < (variant.careerEndingChance || 0) * ceAgeMul) {
          careerEnding = true;
          p._retiringFromInjury = true;
          if (!franchise._careerEndingLog) franchise._careerEndingLog = {};
          const sk = String(franchise.season);
          if (!franchise._careerEndingLog[sk] || typeof franchise._careerEndingLog[sk] === "number") {
            franchise._careerEndingLog[sk] = [];
          }
          franchise._careerEndingLog[sk].push({
            name: p.name, pos: p.position, age: p.age,
            ovr: p.overall || 0, allPros: p.allPros || 0, proBowls: p.proBowls || 0,
            label: t.label, cause: "non_contact", week: franchise.week,
          });
        }
      }
    }
    const wks = careerEnding ? 99 : t.min + Math.floor(Math.random() * (t.max - t.min + 1));
    p.injury = {
      label: t.label, weeksRemaining: wks,
      _ovrPenalty: t.ovrPenalty || 0,
      _catastrophic: isCatastrophic,
      _careerEnding: careerEnding,
      _nonContact: true,
    };
    // Bump body-part wear (specific region damaged) — drives the Vitals
    // UI's color-coded body diagram. Catastrophic injuries bump harder.
    const bodyPart = _bumpBodyPart(p, t.label, isCatastrophic ? 55 : 30);
    p.injuryHistory = p.injuryHistory || [];
    p.injuryHistory.push({
      label: t.label, week: franchise.week, season: franchise.season,
      weeks: wks, duration: wks, catastrophic: isCatastrophic,
      careerEnding, cause: "non_contact", bodyPart,
    });
    if (p.injuryHistory.length > 20) p.injuryHistory = p.injuryHistory.slice(-20);
  }
}

function _rollGameInjuries(teamId) {
  const roster = franchise.rosters[teamId] || [];
  const team = getTeam(teamId);
  // Disciplinarian HC culture: −20% injury rate; Players' Coach: +5%
  const cultureTrait = franchise.coaches?.[teamId]?.hc?.cultureTrait
                    || (franchise.coaches?.[teamId]?.hc?.trait === "Hard-Ass" ? "Disciplinarian" : null);
  const rateMul = cultureTrait === "Disciplinarian" ? 0.80
                : cultureTrait === "Players' Coach" ? 1.05 : 1.0;
  // Front-office trainer reduces injury rate. Elite trainer (99) shaves
  // up to 22% off the base; trait bias adds an extra 5pp shave to the
  // matching specialty (veterans / soft-tissue / catastrophic). Computed
  // once per team per game.
  const trainer = franchise.frontOffice?.[teamId]?.trainer;
  const trainerMul = typeof _foInjuryMul === "function" ? _foInjuryMul(teamId) : 1.0;
  for (const p of roster) {
    if (p.injury && p.injury.weeksRemaining > 0) continue;
    const recMul = _injuryRecurrenceMul(p);
    const ironmanMul = p.ironman ? 0.50 : 1.0;
    // Archetype-aware: slot specialists run shorter routes / less exposure
    // → reduced injury rate. Possession-style WRs / outside CBs use the
    // default rate.
    let archMul = 1.0;
    if (p.position === "WR" && p.archetype === "SLOT")       archMul = 0.82;
    if (p.position === "CB" && p.archetype === "SLOT_CB")    archMul = 0.85;
    if (p.position === "RB" && p.archetype === "RECEIVING")  archMul = 0.85;
    if (p.position === "TE" && p.archetype === "BLOCKING")   archMul = 0.90; // OL-like
    // Trainer trait specialization: Veteran Carer protects 31+; Conditioning
    // shaves an extra 5pp for everyone (already baked into base rating).
    let foMul = trainerMul;
    if (trainer?.trait === "Veteran Carer" && (p.age || 0) >= 31) foMul *= 0.85;
    // Hidden durability — Iron Man (95) lowers chance ~35%; Injury Prone (40)
    // bumps it ~30%. Server-only field in MegaETH port.
    const durability = p._durability ?? 65;
    const durabilityMul = 1.4 - durability / 100;
    // Age-driven injury scaling — NFL data shows 35-year-olds miss ~2x
    // the games of 25-year-olds. Bodies stop bouncing back; soft tissue
    // tears more easily; cumulative wear compounds. Linear ramp from age
    // 30, accelerating past 33. Veteran Carer trait already discounts
    // 31+, so the elite-trainer team still gets some relief.
    const age = p.age || 25;
    const ageMul = age >= 36 ? 1.65
                : age >= 34 ? 1.45
                : age >= 32 ? 1.25
                : age >= 30 ? 1.10
                : 1.0;
    // Wear-driven injury risk — accumulated micro-damage. Doesn't punish
    // fresh players; ramps hard past 70 (the body's been beat up). Coach
    // controls this with load management; auto-manage trims wear ≥70.
    const wear = p._wear || 0;
    const wearMul = wear >= 85 ? 1.60
                  : wear >= 70 ? 1.35
                  : wear >= 50 ? 1.15
                  : 1.0;
    const rate = (INJURY_RATE[p.position] || 0.01) * rateMul * recMul * ironmanMul * archMul * foMul * durabilityMul * ageMul * wearMul;
    if (Math.random() >= rate) continue;
    let t = _pickInjuryType(p.position);
    let isCatastrophic = false;
    let careerEnding = false;
    // Concussion protocol stacking — players with multiple concussions in
    // the same season face longer mandatory rest and elevated catastrophic
    // risk (modern-NFL safety protocol). Reset annually in offseason.
    if (t.label === "concussion") {
      p._concussionsThisSeason = (p._concussionsThisSeason || 0) + 1;
      // Recency multiplier — Second Impact Syndrome research. A
      // concussion ≤3 weeks after the prior one is catastrophically
      // worse; 4-9 weeks is still elevated; 10+ weeks is mostly fresh.
      // Resets between seasons (offseason flush in frnNewSeason).
      const lastWk = p._lastConcussionWeek;
      const curWk = franchise.week;
      const weeksGap = lastWk != null ? Math.max(0, curWk - lastWk) : Infinity;
      let recencyMul = 1.0;
      if (weeksGap <= 3)      recencyMul = 3.5;   // Second Impact zone
      else if (weeksGap <= 6) recencyMul = 2.2;
      else if (weeksGap <= 9) recencyMul = 1.4;
      // 10+: back to baseline
      if (p._concussionsThisSeason >= 2) {
        // 2nd concussion in a season: extended rest (4-8 weeks),
        // longer if recency is bad (8-16 weeks for Second Impact range)
        const baseMin = 4, baseMax = 8;
        t = { ...t, min: Math.round(baseMin * recencyMul / 1.5), max: Math.round(baseMax * recencyMul / 1.5) };
      }
      if (p._concussionsThisSeason >= 3) {
        // 3rd: 40% chance forced into the catastrophic variant (base);
        // recency-scaled up to ~95% if back-to-back
        const cataChance = clamp(0.40 * recencyMul, 0.40, 0.95);
        if (Math.random() < cataChance) {
          t = { ...t, ..._CATASTROPHIC_VARIANTS["concussion"] };
          isCatastrophic = true;
          if (Math.random() < (t.careerEndingChance || 0) * 1.5 * Math.min(2.5, recencyMul)) {
            careerEnding = true;
          }
        }
      }
      // 2nd concussion within Second Impact window (≤3 weeks) — even on
      // the 2nd, the cumulative neuro risk is real. 25% catastrophic
      // upgrade, 5% CE chance even for young players.
      if (p._concussionsThisSeason === 2 && weeksGap <= 3 && !isCatastrophic) {
        if (Math.random() < 0.25) {
          t = { ...t, ..._CATASTROPHIC_VARIANTS["concussion"] };
          isCatastrophic = true;
          if (Math.random() < 0.20) careerEnding = true;
        }
      }
      // CTE arc — career-long concussion count drives independent CE
      // risk on every concussion. 4+ lifetime → 15%; 6+ → 30%; matches
      // research on cumulative head-trauma exit decisions.
      const lifetime = (p._concussionsLifetime || 0) + p._concussionsThisSeason;
      if (lifetime >= 4 && !careerEnding) {
        const cteChance = lifetime >= 6 ? 0.30 : 0.15;
        if (Math.random() < cteChance) {
          t = { ...t, ..._CATASTROPHIC_VARIANTS["concussion"] };
          isCatastrophic = true;
          careerEnding = true;
        }
      }
      // Stamp for next concussion to compute the gap. Use the effective
      // game-week (handles playoffs) computed below for consistency.
      p._lastConcussionWeek = curWk;
    }
    // Catastrophic upgrade — small chance the rolled injury escalates to
    // a season-altering version. Of those, a rare careerEndingChance
    // forces immediate retirement at season's end.
    // Sports Sci trainer reduces catastrophic-upgrade chance by 35%.
    const catMul = trainer?.trait === "Sports Sci" ? 0.65 : 1.0;
    if (!isCatastrophic && Math.random() < _CATASTROPHIC_UPGRADE_CHANCE * catMul) {
      const variant = _CATASTROPHIC_VARIANTS[t.label];
      if (variant) {
        t = { ...t, ...variant };
        isCatastrophic = true;
        // Catastrophic late-career injuries usually end careers (Luck arc,
        // Bo Jackson hip). Scale career-ending probability with age.
        const ceAgeMul = age >= 35 ? 2.0
                       : age >= 32 ? 1.5
                       : age >= 30 ? 1.2
                       : 1.0;
        if (Math.random() < (variant.careerEndingChance || 0) * ceAgeMul) {
          careerEnding = true;
        }
      }
    }
    // Age-driven recovery — older players heal slower (NFL soft-tissue
    // recovery extends 3-6 weeks for 33+ players).
    const recoveryAgeMul = age >= 35 ? 1.35
                         : age >= 32 ? 1.20
                         : age >= 30 ? 1.10
                         : 1.0;
    const wks = careerEnding ? 99
      : Math.ceil((t.min + Math.floor(Math.random() * (t.max - t.min + 1))) * recoveryAgeMul);
    p.injury = {
      label: t.label, weeksRemaining: wks,
      _ovrPenalty: t.ovrPenalty || 0,
      _catastrophic: isCatastrophic,
      _careerEnding: careerEnding,
    };
    if (careerEnding) {
      p._retiringFromInjury = true;
      // League-level CE log (per season) for audit visibility — retired
      // players lose their injuryHistory when migrated to the retired pool.
      // Stores per-event records (age, pos, label, cause) so audits can
      // analyze the age/position distribution.
      if (!franchise._careerEndingLog) franchise._careerEndingLog = {};
      const sk = String(franchise.season);
      if (!franchise._careerEndingLog[sk]) franchise._careerEndingLog[sk] = [];
      // Backward-compat: convert any pre-existing number values to array
      if (typeof franchise._careerEndingLog[sk] === "number") {
        franchise._careerEndingLog[sk] = [];
      }
      franchise._careerEndingLog[sk].push({
        name: p.name, pos: p.position, age: p.age,
        ovr: p.overall || 0, allPros: p.allPros || 0, proBowls: p.proBowls || 0,
        label: t.label, cause: "weekly", week: franchise.week,
      });
    }
    p.injuryHistory = p.injuryHistory || [];
    // Tag with the effective game-week. `franchise.week` doesn't advance
    // during playoff rounds, so without this every playoff injury would
    // stamp the same week and the game-log icon wouldn't line up with
    // the right round.
    let effectiveWeek = franchise.week;
    const pbRound = franchise.playoffBracket?.roundIdx;
    if (franchise.phase === "playoffs" && pbRound != null && typeof FRANCHISE_WEEKS === "number") {
      effectiveWeek = FRANCHISE_WEEKS + pbRound + 1;
    }
    const bodyPart = _bumpBodyPart(p, t.label, isCatastrophic ? 55 : 30);
    p.injuryHistory.push({
      label: t.label, week: effectiveWeek, season: franchise.season,
      weeks: wks, duration: wks, catastrophic: isCatastrophic,
      careerEnding, cause: "weekly", bodyPart,
    });
    if (p.injuryHistory.length > 20) p.injuryHistory = p.injuryHistory.slice(-20);
    const isMine = teamId === franchise.chosenTeamId;
    const grade = scoutGrade(p);
    if (isMine || grade >= 80 || isCatastrophic) {
      const proneTag = _isInjuryProne(p) ? " (injury-prone)" : "";
      const sevTag = careerEnding ? " — CAREER-ENDING"
                   : isCatastrophic ? " — SEASON-ENDING" : "";
      _pushNews({ type:"injury",
        label: `${careerEnding ? "💔" : isCatastrophic ? "🚑" : "🩹"} ${p.name} (${p.position}, ${team?.name||"?"})${proneTag} — ${t.label}, ${wks >= 99 ? "out indefinitely" : `${wks} wk${wks===1?"":"s"}`}${sevTag}` });
    }
  }
}
// ── Kicker / Punter yips ────────────────────────────────────────────────────
// Real-NFL specialists are mentally fragile. A small per-season chance of
// "the yips" — a temporary collapse of accuracy that takes anywhere from
// 3 to 16 weeks to shake. Severe cases can leave permanent damage. The
// mechanic is mostly cosmetic for play-by-play but generates wonderful
// wire entries.
const _YIPS_TRIGGER_CHANCE = 0.05;
// Yips headline templates — inspired by real-NFL kicker/punter moments:
// Cody Parkey's double doink · Norwood's "wide right" · Cundiff's
// 32-yarder · Aguayo's spiral · Vanderjagt's playoff shank · Younghoe
// Koo's redemption · Mason Crosby's 5-miss game · Lawrence Tynes' OT
// walkoffs · Justin Tucker's 66-yarder · Pat McAfee's personality
// punter cult. Each is tagged with eligible position ("any"/"K"/"P")
// so punters get punter-specific mishaps and kickers get kicker-specific.
const _YIPS_ONSET_HEADLINES = [
  { pos:"any", tpl:"💀 {name} ({team}) shanks a 32-yarder wide left in practice — coaches alarmed" },
  { pos:"any", tpl:"🏈 {name} suddenly can't keep it inside the uprights. ST coordinator 'looking into it.'" },
  { pos:"any", tpl:"🪞 {name} 'stares at the ball too long now,' notes the holder. Holder visibly concerned." },
  { pos:"any", tpl:"📺 {name}'s warmup misses go viral. Team PR: 'He hasn't checked Twitter.' He has." },
  { pos:"any", tpl:"🥵 {name} can't kick warm. Or hot. Or after warm-up. Coach baffled." },
  { pos:"any", tpl:"📞 {name}'s mom calls the local sports radio: 'He's a good boy! He'll figure it out!'" },
  { pos:"any", tpl:"🤯 {name} sprays a 25-yarder 15 yards wide right. Reporters thought it was a joke. It wasn't." },
  { pos:"any", tpl:"🎬 {name}'s last four in practice: two wide left, a doink, then somehow another doink." },
  { pos:"any", tpl:"📐 {name} now consults a protractor before each kick. Holder visibly tense." },
  { pos:"any", tpl:"🌧 {name}'s confidence officially declared 'an active weather event' by the locker room." },
  { pos:"any", tpl:"⛪ {name} seen praying in the tunnel pre-game. He hasn't done that before. New ritual." },
  { pos:"any", tpl:"📚 {name} brings a sports psychology book onto the sideline. Coaches keep their distance." },
  { pos:"any", tpl:"🛌 {name} 'hasn't slept this week,' confirms wife. {name} did not deny." },
  { pos:"any", tpl:"🪲 {name} claims he can 'feel a spell' on him. Coach laughs uncomfortably." },
  { pos:"any", tpl:"👻 {name} seeing 'haunted laces.' Equipment manager tries new ball. Same result." },
  { pos:"any", tpl:"📰 BREAKING: {name} pulled aside by GM for a 'long talk.' Door closed for 47 minutes." },
  { pos:"any", tpl:"🧊 {name} now icing both legs. He kicks with one. Just to be safe." },
  { pos:"any", tpl:"🐕 {name}'s dog refuses to fetch his practice kicks. Even the dog knows." },
  { pos:"any", tpl:"🔬 {name}'s mechanics under microscope — ST coordinator now diagramming on a whiteboard at 11 PM." },
  { pos:"any", tpl:"📸 {name}'s {dist}-yard miss is the cover of the morning paper. Front page. Above the fold." },
  { pos:"P",   tpl:"🥾 {name} punts 14 yards in walk-throughs. ST coordinator's smile is forced." },
  { pos:"P",   tpl:"🌬 {name}'s coffin-corner attempts now coming out as flutter balls. Holder concerned. There's no holder." },
];
const _YIPS_MISS_HEADLINES = [
  { pos:"K",   tpl:"💀 DOUBLE DOINK: {name} ({team}) hits the upright, then the crossbar, then nothing. Game over." },
  { pos:"K",   tpl:"🥶 WIDE LEFT from {dist} — {name}'s name now trending. Not the way he hoped." },
  { pos:"any", tpl:"🌪 {name} blames the wind. Game is indoor. Reporters note this. {name} maintains." },
  { pos:"K",   tpl:"🪦 {name} shanks the game-winner. Coach hugs him. It feels less like a hug, more like grief counseling." },
  { pos:"K",   tpl:"📺 {name} pushes a 22-yard chip shot WIDE RIGHT. Twitter declares a national emergency." },
  { pos:"K",   tpl:"🏃 {name} kicks. Ball goes 4 yards. Long snapper begins jogging. Wrong direction." },
  { pos:"any", tpl:"🎬 {name}'s {dist}-yard miss is the #3 trending topic. Locker room avoids his side." },
  { pos:"K",   tpl:"🤡 {name} hits the upright, recovers his own miss, kicks it AGAIN. Whistle blows. Penalty: bewilderment." },
  { pos:"K",   tpl:"🏆 {name} misses the game-winner. Opposing fans serenade him with applause. He bows. Unclear if joke." },
  { pos:"any", tpl:"🎤 {name} post-game: 'I knew the moment I struck it that… well, I don't know what I knew, honestly.'" },
  { pos:"any", tpl:"📸 ESPN cuts to {name}'s mom in the stands. She's covering her eyes. We all are." },
  { pos:"any", tpl:"🌬 {name}'s {dist}-yard try sails 3 feet forward, then 35 feet sideways. Crowd uncertain how to react." },
  { pos:"any", tpl:"🎭 {name} bows to the crowd after another shank. Reporters: 'Is he… is he okay?'" },
  { pos:"K",   tpl:"🧪 {name} 'experimenting with eyes closed,' confirms holder. Holder reportedly updating résumé." },
  { pos:"K",   tpl:"🥨 {name} hooks it left, then over-corrects right on the do-over. Both attempts wide. Geometry weeping." },
  { pos:"K",   tpl:"📉 {name} misses FIVE field goals in one game. Coach declines comment. ESPN doesn't decline." },
  { pos:"K",   tpl:"🚀 {name} kicks 75 yards. Wrong direction. Crowd at midfield ducks." },
  { pos:"any", tpl:"🤐 {name}'s post-game presser cut short after 30 seconds. He looked at the floor the whole time." },
  { pos:"any", tpl:"🧙 {name} now consulting 'a spiritual advisor.' GM declines to confirm or deny." },
  { pos:"K",   tpl:"📰 BREAKING: {name} misses extra point. The XP. Coach quietly puts head in hands." },
  { pos:"K",   tpl:"🎢 {name} doinks one, drains the next from 53, then misses a 19-yarder. Football refuses to make sense." },
  { pos:"K",   tpl:"🛑 {name}'s {dist}-yarder lands 12 feet short. Holder reportedly checked the ball for air pressure." },
  { pos:"any", tpl:"📞 Coach pulled {name} aside after the miss. {name} 'nodded a lot,' say sources. Nothing else." },
  { pos:"K",   tpl:"🎯 {name} aims left. Ball goes right. He aims right. Ball goes farther right. {name} confused." },
  { pos:"K",   tpl:"🤔 {name} kicks at the uprights and somehow misses both. Stadium engineer 'looking into it.'" },
  { pos:"P",   tpl:"🥾 {name} ({team}) punts 8 yards on 4th-and-22. Coach 'speechless.'" },
  { pos:"P",   tpl:"🪂 {name}'s punt sails 14 yards BACKWARD. Defenders begin laughing. Then run." },
  { pos:"P",   tpl:"💨 {name} catches snap, runs forward 2 yards, falls. Officially a 'designed' punt." },
  { pos:"P",   tpl:"🎪 {name} attempts fake-punt pass. Lands at his own feet. Crowd assumes it was a joke." },
  { pos:"P",   tpl:"🥎 {name}'s coffin-corner punt hits the goalpost. {team} record book confused." },
  { pos:"P",   tpl:"🦶 {name} ({team}) punts off the side of his foot. Ball goes out of bounds at his own 31. He punted from the 34." },
];
const _YIPS_RECOVERY_HEADLINES = [
  { pos:"any", tpl:"✨ {name} ({team}) drills 6 straight in practice. Coaches 'cautiously optimistic.'" },
  { pos:"any", tpl:"🧘 {name}'s yoga retreat paying off — nails a 55-yarder cleanly. Locker room weeps quietly." },
  { pos:"any", tpl:"🍀 {name} now wearing lucky socks (3 layers, inside out). Whatever works." },
  { pos:"K",   tpl:"🏆 {name} nails the game-winner. Locker room throws him in the ice tub. He emerges grinning." },
  { pos:"any", tpl:"👨‍⚕️ {name} cleared by team psychologist — 'he just needed to talk it out.' He talked for 90 minutes." },
  { pos:"any", tpl:"🎯 {name} tells reporters: 'I just had to remember who I am.' Reporters note that's all anyone wants." },
  { pos:"any", tpl:"📚 {name} read 'The Inner Game of Tennis.' Says it's about kicking. Coach doesn't correct him." },
  { pos:"any", tpl:"🐈 {name} adopts a cat. Cat is named Doink. {name} now 7-for-7. Coincidence?" },
  { pos:"any", tpl:"🎤 {name}'s redemption arc featured on local TV. Pre-game speech may have been rehearsed." },
  { pos:"any", tpl:"🪙 {name} declared 'a totally new kicker' by HC. Holder mouths 'thank god' on camera." },
  { pos:"K",   tpl:"📺 {name} nails a 56-yarder. Color commentary: 30 seconds of stunned silence." },
  { pos:"any", tpl:"🛐 {name} discovers Pilates. ST coordinator follows suit. Both back to normal now." },
  { pos:"any", tpl:"🎬 {name}'s 'comeback game' goes viral. He's holding back tears in the post-game presser." },
  { pos:"any", tpl:"🌅 {name} 'found his swing again,' he tells the team chaplain. Chaplain confirms." },
  { pos:"any", tpl:"🪄 {name} brought back his college routine — chew gum, three deep breaths, kick. Money the rest of the way." },
  { pos:"P",   tpl:"🦅 {name} punts 62 yards with hangtime to spare. Coverage team can't believe it. Crowd can't either." },
  { pos:"P",   tpl:"📐 {name} pins the opponent inside the 5 — twice in a row. Coach hugs him. Punter hug." },
];
const _YIPS_LINGERING_HEADLINES = [
  { pos:"any", tpl:"📉 {name} ({team}) never quite shakes the yips — accuracy stays diminished" },
  { pos:"any", tpl:"⚠ {name} 'isn't the same kicker' — ST coordinator quietly evaluating UDFAs" },
  { pos:"any", tpl:"🪦 {name} 'plays through it' but a fundamental confidence has been lost" },
  { pos:"any", tpl:"📞 {name}'s agent reportedly fielding calls — 'a fresh start might help'" },
  { pos:"any", tpl:"📰 {name} 'still on the roster, for now,' says GM. The 'for now' is doing a lot of work." },
];
function _pickYipsHeadline(p, list, dist) {
  const pos = p.position;
  const eligible = list.filter(h => h.pos === "any" || h.pos === pos);
  const tpl = (eligible[Math.floor(Math.random() * eligible.length)] || list[0]).tpl;
  const team = (() => {
    for (const [tid, roster] of Object.entries(franchise.rosters || {})) {
      if (roster.some(rp => rp === p || rp.name === p.name)) return getTeam(Number(tid))?.name || "?";
    }
    return "?";
  })();
  return tpl
    .replace(/\{name\}/g, p.name)
    .replace(/\{team\}/g, team)
    .replace(/\{dist\}/g, dist || (28 + Math.floor(Math.random() * 28)));
}
function _maybeTriggerYips(p) {
  if (p.position !== "K" && p.position !== "P") return false;
  if (p._yips) return false;
  // STC effect: Mr. Reliable trait halves yips chance; otherwise the
  // STC's rating reduces yips up to 30% for a 90-rated STC.
  let chance = _YIPS_TRIGGER_CHANCE;
  for (const [tid, roster] of Object.entries(franchise.rosters || {})) {
    if (!roster.includes(p)) continue;
    const stc = franchise.coaches?.[tid]?.stc;
    if (stc) {
      if (stc.trait === "Mr. Reliable") chance *= 0.50;
      chance *= Math.max(0.70, 1 - ((stc.rating || 60) - 45) / 150);
    }
    break;
  }
  if (Math.random() >= chance) return false;
  const sev = Math.random();
  const weeks = sev < 0.3 ? 3 + Math.floor(Math.random() * 3)
              : sev < 0.7 ? 6 + Math.floor(Math.random() * 4)
              :             10 + Math.floor(Math.random() * 6);
  const severity = sev < 0.3 ? "mild" : sev < 0.7 ? "moderate" : "severe";
  const accPenalty = sev < 0.3 ? 5 : sev < 0.7 ? 12 : 18;
  p._yips = { weeksRemaining: weeks, severity };
  p._yipsAccPenalty = accPenalty;
  p.stats = p.stats || [];
  p.stats[3] = Math.max(20, (p.stats[3] || 70) - accPenalty);
  // Lower OVR via stat change naturally; recompute if calcOverall exists
  if (typeof calcOverall === "function") {
    p.overall = calcOverall(p.position, p.stats);
  }
  if (typeof _pushNews === "function") {
    _pushNews({ type: "injury", label: _pickYipsHeadline(p, _YIPS_ONSET_HEADLINES) });
  }
  return true;
}
function _tickYipsForWeek() {
  for (const [tid, roster] of Object.entries(franchise.rosters || {})) {
    for (const p of roster) {
      if (!p._yips || p._yips.weeksRemaining <= 0) continue;
      const isMine = Number(tid) === franchise.chosenTeamId;
      p._yips.weeksRemaining -= 1;
      // 20% chance per week of a hilarious in-public miss while yips persist.
      // Dedup: same kicker can't generate two MISS headlines within 4 weeks,
      // even if the random roll fires repeatedly — keeps the wire from
      // turning into a 7-entry Cody Parkey marathon.
      if (isMine && Math.random() < 0.20) {
        const lastMissWeek = p._yipsLastMissWeek ?? -10;
        if ((franchise.week || 1) - lastMissWeek >= 4) {
          if (typeof _pushNews === "function") {
            _pushNews({ type: "injury", label: _pickYipsHeadline(p, _YIPS_MISS_HEADLINES) });
          }
          p._yipsLastMissWeek = franchise.week || 1;
        }
      }
      if (p._yips.weeksRemaining <= 0) {
        const wasSevere = p._yips.severity === "severe";
        // Restore accuracy penalty (~70% chance full, 25% partial, 5% none)
        const recoveryRoll = Math.random();
        const restorePct = recoveryRoll < 0.70 ? 1.0
                         : recoveryRoll < 0.95 ? 0.5
                         :                       0.0;
        const restore = Math.round((p._yipsAccPenalty || 0) * restorePct);
        if (restore > 0 && p.stats) {
          p.stats[3] = Math.min(99, (p.stats[3] || 70) + restore);
          if (typeof calcOverall === "function") p.overall = calcOverall(p.position, p.stats);
        }
        delete p._yips; delete p._yipsAccPenalty;
        if (isMine && typeof _pushNews === "function") {
          if (restorePct === 1.0) {
            _pushNews({ type: "injury", label: _pickYipsHeadline(p, _YIPS_RECOVERY_HEADLINES) });
          } else if (restorePct === 0) {
            _pushNews({ type: "injury", label: _pickYipsHeadline(p, _YIPS_LINGERING_HEADLINES) });
          } else {
            _pushNews({ type: "injury",
              label: `⚠ ${p.name} works back from yips but isn't quite the same — partial recovery` });
          }
        }
      }
    }
  }
}

function _tickInjuriesForWeek() {
  // Active rosters AND injured reserve — IR'd players must heal on schedule too,
  // otherwise designated-to-return players never become activation-eligible.
  const groups = [franchise.rosters || {}, franchise.ir || {}];
  for (const group of groups) {
    for (const [tid, roster] of Object.entries(group)) {
      for (const p of roster) {
        if (!p.injury || p.injury.weeksRemaining <= 0) continue;
        p.injury.weeksRemaining -= 1;
        if (p.injury.weeksRemaining <= 0) {
          // Apply post-recovery rehab penalty BEFORE clearing the injury,
          // so we still have access to severity metadata.
          if (!p.injury._careerEnding) {
            _applyRehabPenalty(p, Number(tid), !!p.injury._catastrophic);
          }
          p.injury = null;
        }
      }
    }
  }
}

// ── News ticker ──────────────────────────────────────────────────────────────
function _pushNews(item) {
  if (!franchise.news) franchise.news = [];
  franchise.news.push({ week: franchise.week || 0, season: franchise.season, ...item });
  // Cap kept high so a multi-season wire history survives. Each entry
  // is ~120 bytes so 500 entries is still small in localStorage.
  if (franchise.news.length > 500) franchise.news = franchise.news.slice(-500);
}

// One-time migration: recompute contract.aav from baseSalaries +
// signingBonus when assignContracts' legacy-retrofit pass overwrote it
// (it scaled aav to market value but left baseSalaries / bonusProration
// alone). Only writes back when the implied AAV differs from the stored
// one by ≥ $0.5M, so clean contracts aren't touched.
function _repairClobberedAavs() {
  if (!franchise?.rosters) return;
  for (const roster of Object.values(franchise.rosters)) {
    for (const p of roster) {
      const c = p?.contract;
      if (!c || !Array.isArray(c.baseSalaries) || !c.years) continue;
      const baseSum = c.baseSalaries.reduce((s, v) => s + (+v || 0), 0);
      const sigBonus = +c.signingBonus || 0;
      const realAav = Math.round(((baseSum + sigBonus) / c.years) * 10) / 10;
      if (realAav > 0 && Math.abs(realAav - (c.aav || 0)) >= 0.5) {
        c.aav = realAav;
        if (c.signedAav == null || Math.abs(c.signedAav - realAav) >= 0.5) c.signedAav = realAav;
        if (c.guaranteedAAV == null) c.guaranteedAAV = realAav;
      } else if (c.signedAav == null) {
        c.signedAav = c.aav;
      }
    }
  }
}

// One-time repair: "_long" stats were summed across games / seasons
// instead of taking the max. Rebuild current-season totals from the
// per-game blobs (now-fixed mergeSeasonStats takes max), recompute
// career-long maxima from careerHistory rows, and clamp any past row
// whose long-stat exceeds 99 — physically impossible for a single play.
function _repairLongStats() {
  if (!franchise) return;
  const LONG_KEYS = ["pass_long","rush_long","rec_long","fg_long","int_long","punt_long","kr_long","pr_long"];
  // 1) Rebuild current season's seasonStats from per-game blobs.
  franchise._mergedGameKeys = null;
  if (typeof _repairSeasonStatsFromSchedule === "function") _repairSeasonStatsFromSchedule();
  // 2) Walk every roster: clamp historical careerHistory rows, then
  //    recompute careerStats long fields from the (corrected) rows.
  for (const roster of Object.values(franchise.rosters || {})) {
    for (const p of roster) {
      const hist = p.careerHistory || [];
      for (const row of hist) {
        for (const k of LONG_KEYS) {
          if (typeof row[k] === "number" && row[k] > 99) row[k] = 99;
        }
      }
      if (p.careerStats) {
        for (const k of LONG_KEYS) {
          const max = hist.reduce((m, r) => Math.max(m, +r[k] || 0), 0);
          if (max > 0) p.careerStats[k] = max;
          else if (p.careerStats[k] > 99) p.careerStats[k] = 99;
        }
      }
    }
  }
}

// One-time repair v3: clean up careerHistory corruption from earlier
// bugs (overwritten age/ovr, phantom calendar-year rows) and backfill
// careerEarnings for players who served years but never had earnings
// ticked. Runs once per save (gated by _careerHistoryRepaired_v3).
// NOTE: the original v3 stripped ALL calendar-year rows on the theory
// they were phantoms. That was overreach — FA-pool veterans
// legitimately have calendar-year mock history from generateCareer.
// v3 now only dedupes BY season-value (keep most-complete row per
// unique season key) without discriminating calendar vs integer.
// _restorePriorCareerHistories_v4 handles the recovery for saves
// that were over-stripped by the original v3.
function _repairCareerHistoryAndEarnings_v3() {
  if (!franchise?.rosters) return;
  const seasonNum = franchise.season || 1;
  let repaired = 0;
  for (const [tidStr, roster] of Object.entries(franchise.rosters)) {
    for (const p of roster) {
      if (!p?.careerHistory) continue;
      const hist = p.careerHistory;
      if (!hist.length) continue;
      // 1) Keep every row with a valid season identifier (either
      //    integer franchise-season OR calendar-year mock-history).
      //    Drop only rows with no season at all.
      const filtered = hist.filter(r => r && r.season != null);
      // 2) Dedupe by season — keep the row with most GP per unique
      //    season key. Calendar-year rows and integer-season rows
      //    can coexist (they represent different periods of the
      //    player's career — pre-acquisition vs played-for-us).
      const bySeason = new Map();
      for (const row of filtered) {
        const cur = bySeason.get(row.season);
        if (!cur || (row.gp || 0) > (cur.gp || 0)) bySeason.set(row.season, row);
      }
      const deduped = [...bySeason.values()].sort((a, b) => (a.season || 0) - (b.season || 0));
      // 3) Detect age corruption: every row showing the same age across
      //    multiple seasons is the signature of the merge-overwrites bug.
      //    Recompute ages from the player's current age, decremented by
      //    seasons-since.
      if (deduped.length > 1) {
        const ages = deduped.map(r => r.age).filter(a => a != null);
        const allSame = ages.length === deduped.length && ages.every(a => a === ages[0]);
        if (allSame && p.age != null) {
          for (const row of deduped) {
            const seasonsAgo = (seasonNum - row.season);
            // The most recent rolled row (matching franchise.season) gets
            // the player's age at that season's end. Older rows step back.
            const ageAtSeason = (p.age - 1) - Math.max(0, seasonsAgo); // -1 because age was bumped post-season
            row.age = Math.max(18, ageAtSeason);
          }
          repaired++;
        }
      }
      if (deduped.length !== hist.length) {
        p.careerHistory = deduped;
        if (deduped.length !== hist.length) repaired++;
      } else {
        p.careerHistory = deduped;
      }
      // 4) Backfill careerEarnings if zero/missing but the player has
      //    careerHistory rows. Estimate as: number of real seasons ×
      //    current contract AAV × 0.65 (conservative — pay scales over
      //    a career; this is a one-shot estimate, not gospel).
      const yearsServed = p.careerHistory.length;
      if (yearsServed > 0 && (!p.careerEarnings || p.careerEarnings === 0)) {
        const aav = p.contract?.aav || 0;
        if (aav > 0) {
          p.careerEarnings = Math.round(yearsServed * aav * 0.65 * 10) / 10;
        }
      }
    }
  }
  if (repaired > 0) console.log(`[career repair v3] cleaned ${repaired} player histories`);
}

// v4: restore prior-career rows on saves where the over-aggressive v3
// stripped legitimate calendar-year mock-history rows from FA-pool vets.
// Detect via: careerStats.gp >> sum of visible row GPs. Synthesizes
// reconstructed rows that sum to the missing stats so the career card
// reads as a coherent narrative instead of "2 seasons, 12,497 yds."
function _restorePriorCareerHistories_v4() {
  if (!franchise?.rosters) return;
  const LONG_KEYS = new Set(["pass_long","rush_long","rec_long","fg_long","int_long","punt_long","kr_long","pr_long"]);
  let restored = 0;
  for (const roster of Object.values(franchise.rosters)) {
    for (const p of roster) {
      if (!p?.careerHistory || !p?.careerStats) continue;
      const hist = p.careerHistory;
      const stats = p.careerStats;
      const visibleGP = hist.reduce((s, r) => s + (r.gp || 0), 0);
      const totalGP = stats.gp || 0;
      const missingGP = totalGP - visibleGP;
      // Only repair when the gap is meaningful (≥ 10 games unaccounted for).
      if (missingGP < 10) continue;
      // Estimate missing seasons from GP gap (~14 reg-season games).
      const wpsConst = (typeof FRANCHISE_WEEKS === "number" ? FRANCHISE_WEEKS : 14);
      const missingCount = Math.max(1, Math.min(15, Math.round(missingGP / wpsConst)));
      // Compute per-row distribution: each new row gets stats/missingCount.
      const newRows = [];
      const oldestVisibleSeason = hist.length ? Math.min(...hist.map(r => r.season || Infinity)) : (franchise.season || 1);
      const playerCurrAge = p.age || 27;
      for (let i = 0; i < missingCount; i++) {
        const seasonsAgo = missingCount - i;
        const row = {
          season: oldestVisibleSeason - seasonsAgo,
          age: Math.max(22, playerCurrAge - seasonsAgo - hist.length),
          ovr: null,
          teamId: null,
          teamName: "Prior teams",
          pos: p.position,
          _reconstructed: true,
        };
        // Distribute summed stats evenly across reconstructed rows.
        for (const k of Object.keys(stats)) {
          if (typeof stats[k] !== "number") continue;
          if (LONG_KEYS.has(k)) continue; // long stats are season maxes, not totals
          const visibleSum = hist.reduce((s, r) => s + (r[k] || 0), 0);
          const missing = (stats[k] || 0) - visibleSum;
          if (missing > 0) row[k] = Math.round(missing / missingCount);
        }
        // Long fields: stamp the career max so single-game records survive
        for (const k of LONG_KEYS) {
          if (stats[k]) row[k] = stats[k];
        }
        newRows.push(row);
      }
      // Prepend reconstructed rows so they appear before the user-team rows
      p.careerHistory = [...newRows, ...hist];
      restored++;
    }
  }
  if (restored > 0) console.log(`[career repair v4] reconstructed prior history for ${restored} player(s)`);
}

// One-time repair: signed FAs whose careerHistory was collapsed to a
// single team (the user's) by the now-fixed assignCareerTeams clobber.
// Detect via systemYears < careerHistory.length (player joined after
// some pre-team seasons) AND all rows pointing to the same teamId.
// Re-stamp with the FA-seeded prior-team / last-team distribution so
// the player's pre-acquisition career reads correctly again.
function _repairSignedFaCareerHistories() {
  if (!franchise?.rosters) return;
  let repaired = 0;
  for (const [tidStr, roster] of Object.entries(franchise.rosters)) {
    const teamId = Number(tidStr);
    for (const p of roster) {
      if (p._careerTeamsAssigned) continue;
      const hist = p.careerHistory || [];
      if (hist.length < 2) { p._careerTeamsAssigned = true; continue; }
      const sysYrs = p.systemYears;
      if (sysYrs == null || sysYrs >= hist.length) {
        // Original player (drafted by team, never moved) — leave intact.
        p._careerTeamsAssigned = true;
        continue;
      }
      const ids = new Set(hist.map(r => r.teamId).filter(x => x != null));
      // Only collapse-bug pattern: every row shows the current team.
      if (ids.size === 1 && ids.has(teamId)) {
        _assignFACareerTeams(p);
        // Overlay the most recent `systemYears` rows with the current
        // team — those are seasons actually played for us. systemYears=0
        // (just signed, no season played yet) overlays nothing, so the
        // last careerHistory row stays as the FA's previous team.
        const showHere = Math.min(hist.length, sysYrs || 0);
        if (showHere > 0) {
          const team = getTeam(teamId);
          const teamName = team ? `${team.city} ${team.name}` : "?";
          for (let i = hist.length - showHere; i < hist.length; i++) {
            hist[i].teamId = teamId;
            hist[i].teamName = teamName;
          }
        }
        repaired++;
      }
      p._careerTeamsAssigned = true;
    }
  }
  if (repaired > 0) console.log(`[fa career repair] re-stamped ${repaired} signed-FA histories`);
}

// One-time migration: news/_faLastNews entries written before the
// FA pid-leak fix have the FA's pid in place of the name. Walk every
// player we still know about (rosters, PS, FA pool, active negotiations,
// HOF, alumni), build a pid → name map, and replace any matching 8-char
// base-36 token in each label. Anyone we no longer have a record of
// (signed elsewhere then released, etc.) stays as-is.
function _repairNewsPidNames() {
  if (!franchise) return;
  const pidToName = {};
  const collect = (pool) => {
    for (const p of (pool || [])) {
      if (p?.pid && p?.name) pidToName[p.pid] = p.name;
    }
  };
  for (const r of Object.values(franchise.rosters || {})) collect(r);
  for (const ps of Object.values(franchise.practiceSquads || {})) collect(ps);
  collect(franchise.freeAgents);
  for (const n of Object.values(franchise.faNegotiations || {})) {
    if (n?.fa?.pid && n?.fa?.name) pidToName[n.fa.pid] = n.fa.name;
  }
  collect(franchise.hallOfFame);
  collect(franchise.alumni);
  const pidRe = /\b[a-z0-9]{8}\b/g;
  const fix = (s) => typeof s === "string"
    ? s.replace(pidRe, (m) => pidToName[m] || m) : s;
  for (const item of (franchise.news || [])) item.label = fix(item.label);
  if (franchise._faLastNews) {
    for (const k of ["signed", "lost"]) {
      for (const e of (franchise._faLastNews[k] || [])) {
        if (e?.name && pidToName[e.name]) e.name = pidToName[e.name];
      }
    }
  }
}

// Detail card for a single player — shown in Scout right side panel.
// Deliberately hides OVR. Uses scout grade, combine measurables, draft
// pedigree, and career earnings — same data a real scouting report works
// from, none of which is the simulator's hidden rating directly.
function _isOwnedPlayer(p) {
  const myId = franchise?.chosenTeamId;
  if (myId == null) return false;
  const roster = franchise?.rosters?.[myId] || [];
  return roster.some(rp => rp === p || rp.name === p.name);
}

// Production-ready human label for an archetype. Prefers the
// position-specific archetype table's `.label` (e.g.
// "Dual Threat", "Field General"); falls back to title-casing
// the raw key. Never returns the underscore-form like
// "DUAL_THREAT" to UI.
function _archetypeLabel(p) {
  if (!p || !p.archetype) return "";
  const tables = {
    QB: typeof QB_ARCHETYPES !== "undefined" ? QB_ARCHETYPES : null,
    RB: typeof RB_ARCHETYPES !== "undefined" ? RB_ARCHETYPES : null,
    WR: typeof WR_ARCHETYPES !== "undefined" ? WR_ARCHETYPES : null,
    TE: typeof TE_ARCHETYPES !== "undefined" ? TE_ARCHETYPES : null,
    OL: typeof OL_ARCHETYPES !== "undefined" ? OL_ARCHETYPES : null,
    DL: typeof DL_ARCHETYPES !== "undefined" ? DL_ARCHETYPES : null,
    LB: typeof LB_ARCHETYPES !== "undefined" ? LB_ARCHETYPES : null,
    CB: typeof CB_ARCHETYPES !== "undefined" ? CB_ARCHETYPES : null,
    S:  typeof S_ARCHETYPES  !== "undefined" ? S_ARCHETYPES  : null,
    K:  typeof K_ARCHETYPES  !== "undefined" ? K_ARCHETYPES  : null,
    P:  typeof P_ARCHETYPES  !== "undefined" ? P_ARCHETYPES  : null,
  };
  const entry = (tables[p.position] || {})[p.archetype];
  if (entry?.label) return entry.label;
  // Fallback: title-case the raw key, replace underscores with spaces.
  return String(p.archetype)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

// Per-position stat keys to highlight. SPD/STR/AGI/AWR/THR/CAT/BLK/PRS/COV/TCK/KPW.
const _STAT_INDEX = { SPD:0, STR:1, AGI:2, AWR:3, THR:4, CAT:5, BLK:6, PRS:7, COV:8, TCK:9, KPW:10 };
const _OWNED_STATS_BY_POS = {
  QB: ["AWR","THR","SPD","AGI","STR"],
  RB: ["SPD","STR","AGI","CAT","AWR"],
  WR: ["SPD","CAT","AGI","AWR","STR"],
  TE: ["CAT","BLK","STR","SPD","AWR"],
  OL: ["STR","BLK","AWR","AGI"],
  DL: ["STR","PRS","TCK","SPD","AWR"],
  LB: ["TCK","PRS","COV","SPD","AWR"],
  CB: ["SPD","COV","AGI","AWR","TCK"],
  S:  ["SPD","COV","TCK","AWR","AGI"],
  K:  ["KPW","AWR"],
  P:  ["KPW","AWR"],
};

function _buildOwnedStatsPanel(p) {
  const keys = _OWNED_STATS_BY_POS[p.position] || ["SPD","STR","AGI","AWR"];
  const stats = p.stats || [];
  const rows = keys.map(k => {
    const v = stats[_STAT_INDEX[k]] ?? 0;
    return `<div class="frn-rawstat-row">
      <span class="frn-rawstat-key">${k}</span>
      <span class="frn-rawstat-bar"><span class="frn-rawstat-bar-fill" style="width:${Math.max(0, Math.min(100, v))}%"></span></span>
      <span class="frn-rawstat-val">${v}</span>
    </div>`;
  }).join("");
  return `<div class="frn-pcard-section">
    <div class="frn-card-title">
      MEASURED RATINGS <span class="frn-pcard-private-badge">🔒 INTERNAL</span>
    </div>
    ${rows}
    <div style="color:var(--gray);font-size:.6rem;margin-top:.35rem;font-style:italic">
      Your training staff sees these — opponents only see the noisy grade.
    </div>
  </div>`;
}

// ── PLAYER VITALS UI ────────────────────────────────────────────────
// Renders an SVG body diagram with color-coded regions showing per-part
// wear, plus a recent-injury timeline. Surfaces in the player modal.
function _vitalsColor(wearVal) {
  // 0-30: green (healthy), 30-60: yellow (managed), 60-85: orange,
  // 85+: red (immediate concern). Smooth gradient.
  if (wearVal < 5)  return "#1ec96b";   // fresh green
  if (wearVal < 30) return "#3fdf83";
  if (wearVal < 50) return "#d4dc5a";   // yellow
  if (wearVal < 70) return "#f0a93a";   // orange
  if (wearVal < 85) return "#ed6a3a";   // dark orange
  return                  "#e6373a";    // red
}
function _vitalsLabel(wearVal) {
  if (wearVal < 30) return "Healthy";
  if (wearVal < 50) return "Managed";
  if (wearVal < 70) return "Worn";
  if (wearVal < 85) return "Stressed";
  return                  "Critical";
}
// Position-shaped body parameters. Each position gets a unique frame
// profile — OL/DL bulky, WR/CB lean, QB tall, RB compact muscular.
// Then height/weight of the SPECIFIC player nudges from the position
// baseline. This is what makes a 6'7"/325 lb OL look different from a
// 5'10"/195 lb CB on the same body diagram.
const _VITALS_BODY_PROFILES = {
  // shoulderWidth: 0.7-1.3 multiplier on the half-body width
  // chestWidth, hipWidth, thighWidth: same scale
  // headRadius: usually 28 base
  QB: { shoulderW: 1.02, chestW: 0.95, hipW: 0.92, thighW: 0.94, heightStretch: 1.04 },
  RB: { shoulderW: 1.00, chestW: 1.00, hipW: 1.04, thighW: 1.12, heightStretch: 0.95 },
  WR: { shoulderW: 0.92, chestW: 0.90, hipW: 0.88, thighW: 0.90, heightStretch: 1.02 },
  TE: { shoulderW: 1.10, chestW: 1.05, hipW: 1.00, thighW: 1.02, heightStretch: 1.03 },
  OL: { shoulderW: 1.30, chestW: 1.28, hipW: 1.20, thighW: 1.22, heightStretch: 1.05 },
  DL: { shoulderW: 1.25, chestW: 1.20, hipW: 1.12, thighW: 1.18, heightStretch: 1.02 },
  LB: { shoulderW: 1.10, chestW: 1.08, hipW: 1.04, thighW: 1.10, heightStretch: 1.00 },
  CB: { shoulderW: 0.88, chestW: 0.88, hipW: 0.86, thighW: 0.92, heightStretch: 1.00 },
  S:  { shoulderW: 1.00, chestW: 0.98, hipW: 0.96, thighW: 1.00, heightStretch: 1.00 },
  K:  { shoulderW: 0.90, chestW: 0.92, hipW: 0.90, thighW: 0.95, heightStretch: 0.98 },
  P:  { shoulderW: 0.92, chestW: 0.92, hipW: 0.90, thighW: 0.95, heightStretch: 1.00 },
};
function _vitalsBodyFrame(p) {
  const profile = _VITALS_BODY_PROFILES[p.position] || _VITALS_BODY_PROFILES.WR;
  // Player-specific nudges from height/weight. NFL average ~225 lbs.
  const wDelta = ((p.weight || 225) - 225) / 100;  // -0.4 → +1.0
  const widthBase = 1.0 + wDelta * 0.12;            // each 100lb up = +12% width
  const hDelta = ((p.height || 73) - 73) / 10;     // 67-79 → -0.6 → 0.6
  return {
    shoulderW: profile.shoulderW * widthBase,
    chestW:    profile.chestW    * widthBase,
    hipW:      profile.hipW      * widthBase,
    thighW:    profile.thighW    * widthBase * (1 + Math.max(0, wDelta * 0.05)),
    yStretch:  profile.heightStretch * (1 + hDelta * 0.02),
  };
}
// Vitruvian-inspired anatomical body diagram. Single smooth-curve
// silhouette path defines the body shape; color regions overlay inside
// via clipPath so they stay within anatomy. Internal muscle lines add
// the "drawn" anatomical feel (collarbone, pec divide, abs, quads, etc.).
// Position frame scales body proportions; line-art aesthetic throughout.
function _buildVitalsBodyDiagram(p) {
  const bw = p._bodyWear || {};
  const get = (k) => bw[k] || 0;
  const stress = p._stress || 0;
  const wear = p._wear || 0;
  const frame = _vitalsBodyFrame(p);
  // Scale: each frame multiplier nudges that body part's width
  const sH = frame.shoulderW;
  const sC = frame.chestW;
  const sP = frame.hipW;
  const sT = frame.thighW;
  // Body landmarks (240x520 canvas, body centered at cx=120)
  // These are the natural-proportion anchor points; widths scaled per frame.
  const lm = {
    cx: 120,
    head: { cy: 56, rx: 20, ry: 26 },
    neck: { top: 80, bot: 102, wTop: 13, wBot: 16 },
    shoulder: { y: 116, w: 50 * sH },
    chest: { yTop: 122, yBot: 196, wTop: 38 * sC, wBot: 30 * sC, midY: 158 },
    waist: { y: 218, w: 26 * sC },
    hip: { yTop: 232, yBot: 270, w: 38 * sP },
    crotch: { y: 268, w: 4 },
    thigh: { yTop: 268, yBot: 348, wTop: 24 * sT, wBot: 18 * sT, inset: 4 },
    knee:  { yTop: 348, yBot: 372, w: 16 * sT },
    calf:  { yTop: 372, yBot: 446, wTop: 19 * sT, wBot: 13 * sT },
    ankle: { yTop: 446, yBot: 462, w: 11 },
    foot:  { yTop: 462, yBot: 486, w: 17 },
    arm: { shoulderY: 122, elbowY: 226, wristY: 308, handY: 336,
           shoulderW: 14, upperArmW: 12 * sH, forearmW: 10 * sH, handW: 11 },
  };
  const cx = lm.cx;
  // ── SILHOUETTE PATH: single smooth-curve body outline ─────────────
  // Goes CLOCKWISE from top of head, down right side, across feet,
  // back up left side. Uses cubic beziers for organic curves.
  // Naming: each `C x1 y1, x2 y2, x y` is a curve with two control points.
  const sil = `
    M ${cx} ${lm.head.cy - lm.head.ry}
    C ${cx + lm.head.rx*0.9} ${lm.head.cy - lm.head.ry}, ${cx + lm.head.rx} ${lm.head.cy - lm.head.ry*0.4}, ${cx + lm.head.rx} ${lm.head.cy}
    C ${cx + lm.head.rx} ${lm.head.cy + lm.head.ry*0.7}, ${cx + lm.head.rx*0.7} ${lm.head.cy + lm.head.ry}, ${cx + lm.neck.wTop} ${lm.neck.top}
    L ${cx + lm.neck.wBot} ${lm.neck.bot}
    C ${cx + lm.shoulder.w*0.5} ${lm.neck.bot + 4}, ${cx + lm.shoulder.w*0.85} ${lm.shoulder.y - 6}, ${cx + lm.shoulder.w} ${lm.shoulder.y + 6}
    C ${cx + lm.shoulder.w + 2} ${lm.shoulder.y + 18}, ${cx + lm.arm.upperArmW + lm.chest.wTop*0.6} ${lm.shoulder.y + 24}, ${cx + lm.chest.wTop} ${lm.chest.yTop + 4}
    C ${cx + lm.chest.wTop + 2} ${lm.chest.midY}, ${cx + lm.chest.wBot + 2} ${lm.chest.yBot - 4}, ${cx + lm.chest.wBot} ${lm.chest.yBot}
    C ${cx + lm.waist.w + 2} ${lm.waist.y - 4}, ${cx + lm.waist.w} ${lm.waist.y}, ${cx + lm.waist.w} ${lm.waist.y + 4}
    C ${cx + lm.hip.w*0.85} ${lm.hip.yTop}, ${cx + lm.hip.w} ${lm.hip.yTop + 8}, ${cx + lm.hip.w - 2} ${lm.hip.yBot - 8}
    C ${cx + lm.hip.w - 6} ${lm.hip.yBot}, ${cx + lm.thigh.wTop + 4} ${lm.thigh.yTop + 2}, ${cx + lm.thigh.wTop} ${lm.thigh.yTop + 8}
    C ${cx + lm.thigh.wBot + 4} ${lm.thigh.yBot - 20}, ${cx + lm.thigh.wBot + 2} ${lm.thigh.yBot - 4}, ${cx + lm.knee.w + 2} ${lm.knee.yTop}
    C ${cx + lm.knee.w} ${lm.knee.yTop + 6}, ${cx + lm.knee.w} ${lm.knee.yBot - 6}, ${cx + lm.knee.w} ${lm.knee.yBot}
    C ${cx + lm.calf.wTop} ${lm.calf.yTop + 4}, ${cx + lm.calf.wTop + 2} ${lm.calf.yTop + 30}, ${cx + lm.calf.wTop} ${lm.calf.yTop + 40}
    C ${cx + lm.calf.wBot + 1} ${lm.calf.yBot - 12}, ${cx + lm.calf.wBot} ${lm.calf.yBot - 4}, ${cx + lm.ankle.w + 3} ${lm.ankle.yTop}
    C ${cx + lm.ankle.w + 1} ${lm.ankle.yTop + 8}, ${cx + lm.ankle.w} ${lm.ankle.yBot - 4}, ${cx + lm.ankle.w} ${lm.ankle.yBot}
    C ${cx + lm.foot.w} ${lm.foot.yBot - 16}, ${cx + lm.foot.w + 1} ${lm.foot.yBot - 4}, ${cx + lm.foot.w + 1} ${lm.foot.yBot}
    L ${cx + 1} ${lm.foot.yBot}
    L ${cx + 1} ${lm.crotch.y}
    L ${cx - 1} ${lm.crotch.y}
    L ${cx - 1} ${lm.foot.yBot}
    L ${cx - lm.foot.w - 1} ${lm.foot.yBot}
    C ${cx - lm.foot.w - 1} ${lm.foot.yBot - 4}, ${cx - lm.foot.w} ${lm.foot.yBot - 16}, ${cx - lm.ankle.w} ${lm.ankle.yBot}
    C ${cx - lm.ankle.w} ${lm.ankle.yBot - 4}, ${cx - lm.ankle.w - 1} ${lm.ankle.yTop + 8}, ${cx - lm.ankle.w - 3} ${lm.ankle.yTop}
    C ${cx - lm.calf.wBot} ${lm.calf.yBot - 4}, ${cx - lm.calf.wBot - 1} ${lm.calf.yBot - 12}, ${cx - lm.calf.wTop} ${lm.calf.yTop + 40}
    C ${cx - lm.calf.wTop - 2} ${lm.calf.yTop + 30}, ${cx - lm.calf.wTop} ${lm.calf.yTop + 4}, ${cx - lm.knee.w} ${lm.knee.yBot}
    C ${cx - lm.knee.w} ${lm.knee.yBot - 6}, ${cx - lm.knee.w} ${lm.knee.yTop + 6}, ${cx - lm.knee.w - 2} ${lm.knee.yTop}
    C ${cx - lm.thigh.wBot - 2} ${lm.thigh.yBot - 4}, ${cx - lm.thigh.wBot - 4} ${lm.thigh.yBot - 20}, ${cx - lm.thigh.wTop} ${lm.thigh.yTop + 8}
    C ${cx - lm.thigh.wTop - 4} ${lm.thigh.yTop + 2}, ${cx - lm.hip.w + 6} ${lm.hip.yBot}, ${cx - lm.hip.w + 2} ${lm.hip.yBot - 8}
    C ${cx - lm.hip.w} ${lm.hip.yTop + 8}, ${cx - lm.hip.w*0.85} ${lm.hip.yTop}, ${cx - lm.waist.w} ${lm.waist.y + 4}
    C ${cx - lm.waist.w} ${lm.waist.y}, ${cx - lm.waist.w - 2} ${lm.waist.y - 4}, ${cx - lm.chest.wBot} ${lm.chest.yBot}
    C ${cx - lm.chest.wBot - 2} ${lm.chest.yBot - 4}, ${cx - lm.chest.wTop - 2} ${lm.chest.midY}, ${cx - lm.chest.wTop} ${lm.chest.yTop + 4}
    C ${cx - lm.arm.upperArmW - lm.chest.wTop*0.6} ${lm.shoulder.y + 24}, ${cx - lm.shoulder.w - 2} ${lm.shoulder.y + 18}, ${cx - lm.shoulder.w} ${lm.shoulder.y + 6}
    C ${cx - lm.shoulder.w*0.85} ${lm.shoulder.y - 6}, ${cx - lm.shoulder.w*0.5} ${lm.neck.bot + 4}, ${cx - lm.neck.wBot} ${lm.neck.bot}
    L ${cx - lm.neck.wTop} ${lm.neck.top}
    C ${cx - lm.head.rx*0.7} ${lm.head.cy + lm.head.ry}, ${cx - lm.head.rx} ${lm.head.cy + lm.head.ry*0.7}, ${cx - lm.head.rx} ${lm.head.cy}
    C ${cx - lm.head.rx} ${lm.head.cy - lm.head.ry*0.4}, ${cx - lm.head.rx*0.9} ${lm.head.cy - lm.head.ry}, ${cx} ${lm.head.cy - lm.head.ry}
    Z`;
  // Arm silhouettes (separate hanging shapes — outside the central torso path)
  const armL = `
    M ${cx - lm.shoulder.w} ${lm.shoulder.y + 6}
    C ${cx - lm.shoulder.w - 2} ${lm.shoulder.y + 30}, ${cx - lm.shoulder.w - 4} ${lm.arm.elbowY - 10}, ${cx - lm.shoulder.w - 2} ${lm.arm.elbowY}
    C ${cx - lm.shoulder.w - 6} ${lm.arm.elbowY + 18}, ${cx - lm.shoulder.w - 8} ${lm.arm.wristY - 20}, ${cx - lm.shoulder.w - 6} ${lm.arm.wristY}
    C ${cx - lm.shoulder.w - 12} ${lm.arm.handY - 6}, ${cx - lm.shoulder.w - 10} ${lm.arm.handY + 6}, ${cx - lm.shoulder.w - 4} ${lm.arm.handY + 4}
    C ${cx - lm.shoulder.w + lm.arm.handW - 4} ${lm.arm.handY + 4}, ${cx - lm.shoulder.w + lm.arm.handW - 2} ${lm.arm.handY - 6}, ${cx - lm.shoulder.w + lm.arm.forearmW - 2} ${lm.arm.wristY}
    C ${cx - lm.shoulder.w + lm.arm.forearmW + 4} ${lm.arm.wristY - 20}, ${cx - lm.shoulder.w + lm.arm.upperArmW + 4} ${lm.arm.elbowY + 18}, ${cx - lm.shoulder.w + lm.arm.upperArmW} ${lm.arm.elbowY}
    C ${cx - lm.shoulder.w + lm.arm.upperArmW + 2} ${lm.arm.elbowY - 10}, ${cx - lm.shoulder.w + lm.arm.upperArmW} ${lm.shoulder.y + 30}, ${cx - lm.shoulder.w + lm.arm.upperArmW} ${lm.shoulder.y + 14}
    Z`;
  // Mirror arm: substitute (cx - X) with (cx + X) by transforming
  const armR = armL.replace(/\$\{cx - ([^\}]+)\}/g, (_, expr) => `\${cx + ${expr}}`);
  // Actually since armL is already evaluated, just do string-replace on
  // the result. Use the cx position numerically.
  const armRTransform = `scale(-1,1) translate(${-2*cx}, 0)`;
  // ── INNER ANATOMICAL DETAIL LINES ─────────────────────────────────
  // Subtle line-art for muscle/bone divides — gives the "drawn" feel.
  const innerLines = `
    <g stroke="rgba(255,255,255,.16)" stroke-width="0.7" fill="none" stroke-linecap="round">
      <!-- collarbone -->
      <path d="M ${cx - lm.chest.wTop*0.85} ${lm.chest.yTop + 6} Q ${cx} ${lm.chest.yTop + 2}, ${cx + lm.chest.wTop*0.85} ${lm.chest.yTop + 6}"/>
      <!-- sternum -->
      <path d="M ${cx} ${lm.chest.yTop + 8} L ${cx} ${lm.chest.yBot - 4}"/>
      <!-- pec divides (subtle) -->
      <path d="M ${cx - lm.chest.wTop*0.6} ${lm.chest.midY - 10} Q ${cx - lm.chest.wTop*0.15} ${lm.chest.midY - 6}, ${cx - 4} ${lm.chest.midY}"/>
      <path d="M ${cx + lm.chest.wTop*0.6} ${lm.chest.midY - 10} Q ${cx + lm.chest.wTop*0.15} ${lm.chest.midY - 6}, ${cx + 4} ${lm.chest.midY}"/>
      <!-- abs divides (3 horizontal hints) -->
      <path d="M ${cx - 12} ${lm.chest.yBot - 24} L ${cx + 12} ${lm.chest.yBot - 24}"/>
      <path d="M ${cx - 14} ${lm.chest.yBot - 8} L ${cx + 14} ${lm.chest.yBot - 8}"/>
      <path d="M ${cx - 14} ${lm.waist.y - 8} L ${cx + 14} ${lm.waist.y - 8}"/>
      <!-- hip / groin V -->
      <path d="M ${cx - lm.hip.w*0.6} ${lm.hip.yTop + 12} Q ${cx} ${lm.crotch.y - 4}, ${cx + lm.hip.w*0.6} ${lm.hip.yTop + 12}"/>
      <!-- quad inseams -->
      <path d="M ${cx - lm.thigh.wTop*0.4} ${lm.thigh.yTop + 8} L ${cx - lm.knee.w*0.5} ${lm.thigh.yBot - 10}"/>
      <path d="M ${cx + lm.thigh.wTop*0.4} ${lm.thigh.yTop + 8} L ${cx + lm.knee.w*0.5} ${lm.thigh.yBot - 10}"/>
      <!-- knee cap circles -->
      <circle cx="${cx - lm.knee.w*0.3}" cy="${(lm.knee.yTop + lm.knee.yBot)/2}" r="4"/>
      <circle cx="${cx + lm.knee.w*0.3}" cy="${(lm.knee.yTop + lm.knee.yBot)/2}" r="4"/>
      <!-- calf muscle hint -->
      <path d="M ${cx - lm.calf.wTop*0.6} ${lm.calf.yTop + 14} Q ${cx - lm.calf.wTop*0.85} ${lm.calf.yTop + 26}, ${cx - lm.calf.wTop*0.5} ${lm.calf.yTop + 38}"/>
      <path d="M ${cx + lm.calf.wTop*0.6} ${lm.calf.yTop + 14} Q ${cx + lm.calf.wTop*0.85} ${lm.calf.yTop + 26}, ${cx + lm.calf.wTop*0.5} ${lm.calf.yTop + 38}"/>
      <!-- shoulder deltoid divide -->
      <path d="M ${cx - lm.shoulder.w*0.5} ${lm.shoulder.y + 6} Q ${cx - lm.shoulder.w*0.85} ${lm.shoulder.y + 18}, ${cx - lm.shoulder.w*0.7} ${lm.shoulder.y + 30}"/>
      <path d="M ${cx + lm.shoulder.w*0.5} ${lm.shoulder.y + 6} Q ${cx + lm.shoulder.w*0.85} ${lm.shoulder.y + 18}, ${cx + lm.shoulder.w*0.7} ${lm.shoulder.y + 30}"/>
    </g>`;
  // Career injury counts per body part (lifetime — drives the scar
  // markers on the diagram + tooltips).
  const careerCounts = {};
  for (const h of (p.injuryHistory || [])) {
    if (h.bodyPart) careerCounts[h.bodyPart] = (careerCounts[h.bodyPart] || 0) + 1;
  }
  // ── COLOR REGIONS — overlay paths INSIDE the body, clipped to it ──
  // Each region is a path roughly matching that body part's position.
  // Wrapped in <g clip-path="url(#bodyClip)"> so they never escape the
  // body silhouette. Region opacity scales with wear so healthy parts
  // fade into the base color. Career injury count appears in tooltip.
  const region = (key, label, d) => {
    const v = get(key);
    const fill = _vitalsColor(v);
    const op = v < 5 ? 0.18 : v < 30 ? 0.42 : v < 60 ? 0.66 : 0.85;
    const careerN = careerCounts[key] || 0;
    const titleStr = careerN
      ? `${label}: ${v.toFixed(0)} · ${_vitalsLabel(v)} · ${careerN} career injur${careerN===1?"y":"ies"}`
      : `${label}: ${v.toFixed(0)} · ${_vitalsLabel(v)}`;
    return `<path d="${d}" fill="${fill}" fill-opacity="${op}" data-vitals-part="${key}">
      <title>${titleStr}</title></path>`;
  };
  const regions = `
    ${region("head", "Head", `M ${cx} ${lm.head.cy - lm.head.ry} a ${lm.head.rx} ${lm.head.ry} 0 1 1 0 ${lm.head.ry*2} a ${lm.head.rx} ${lm.head.ry} 0 1 1 0 -${lm.head.ry*2} Z`)}
    ${region("neck", "Neck", `M ${cx - lm.neck.wTop} ${lm.neck.top} L ${cx + lm.neck.wTop} ${lm.neck.top} L ${cx + lm.neck.wBot} ${lm.neck.bot} L ${cx - lm.neck.wBot} ${lm.neck.bot} Z`)}
    ${region("shoulderL", "Left shoulder",
      `M ${cx - lm.neck.wBot} ${lm.neck.bot} L ${cx - lm.shoulder.w} ${lm.shoulder.y + 6} L ${cx - lm.shoulder.w + lm.arm.upperArmW} ${lm.shoulder.y + 24} L ${cx - lm.chest.wTop + 4} ${lm.chest.yTop + 8} Z`)}
    ${region("shoulderR", "Right shoulder",
      `M ${cx + lm.neck.wBot} ${lm.neck.bot} L ${cx + lm.shoulder.w} ${lm.shoulder.y + 6} L ${cx + lm.shoulder.w - lm.arm.upperArmW} ${lm.shoulder.y + 24} L ${cx + lm.chest.wTop - 4} ${lm.chest.yTop + 8} Z`)}
    ${region("chest", "Chest / pec",
      `M ${cx - lm.chest.wTop + 4} ${lm.chest.yTop + 8} L ${cx + lm.chest.wTop - 4} ${lm.chest.yTop + 8} L ${cx + lm.chest.wBot - 2} ${lm.chest.yBot - 18} L ${cx - lm.chest.wBot + 2} ${lm.chest.yBot - 18} Z`)}
    ${region("back", "Lower back / core",
      `M ${cx - lm.chest.wBot + 2} ${lm.chest.yBot - 18} L ${cx + lm.chest.wBot - 2} ${lm.chest.yBot - 18} L ${cx + lm.waist.w} ${lm.waist.y} L ${cx - lm.waist.w} ${lm.waist.y} Z`)}
    ${region("handL", "Left hand / wrist",
      `M ${cx - lm.shoulder.w - 10} ${lm.arm.wristY - 6} L ${cx - lm.shoulder.w + lm.arm.handW - 4} ${lm.arm.wristY - 6} L ${cx - lm.shoulder.w + lm.arm.handW - 2} ${lm.arm.handY + 6} L ${cx - lm.shoulder.w - 8} ${lm.arm.handY + 6} Z`)}
    ${region("handR", "Right hand / wrist",
      `M ${cx + lm.shoulder.w + 10} ${lm.arm.wristY - 6} L ${cx + lm.shoulder.w - lm.arm.handW + 4} ${lm.arm.wristY - 6} L ${cx + lm.shoulder.w - lm.arm.handW + 2} ${lm.arm.handY + 6} L ${cx + lm.shoulder.w + 8} ${lm.arm.handY + 6} Z`)}
    ${region("hipL", "Left hip",
      `M ${cx - lm.waist.w} ${lm.waist.y} L ${cx - lm.hip.w + 2} ${lm.hip.yTop + 6} L ${cx - 8} ${lm.hip.yBot - 4} L ${cx - 4} ${lm.waist.y + 4} Z`)}
    ${region("hipR", "Right hip",
      `M ${cx + lm.waist.w} ${lm.waist.y} L ${cx + lm.hip.w - 2} ${lm.hip.yTop + 6} L ${cx + 8} ${lm.hip.yBot - 4} L ${cx + 4} ${lm.waist.y + 4} Z`)}
    ${region("groin", "Groin",
      `M ${cx - 6} ${lm.hip.yTop + 4} L ${cx + 6} ${lm.hip.yTop + 4} L ${cx + 4} ${lm.crotch.y} L ${cx - 4} ${lm.crotch.y} Z`)}
    ${region("hamstringL", "Left hamstring / thigh",
      `M ${cx - lm.thigh.wTop} ${lm.thigh.yTop + 6} L ${cx - 4} ${lm.thigh.yTop + 6} L ${cx - lm.knee.w*0.6} ${lm.thigh.yBot - 6} L ${cx - lm.thigh.wBot - 2} ${lm.thigh.yBot - 6} Z`)}
    ${region("hamstringR", "Right hamstring / thigh",
      `M ${cx + lm.thigh.wTop} ${lm.thigh.yTop + 6} L ${cx + 4} ${lm.thigh.yTop + 6} L ${cx + lm.knee.w*0.6} ${lm.thigh.yBot - 6} L ${cx + lm.thigh.wBot + 2} ${lm.thigh.yBot - 6} Z`)}
    ${region("kneeL", "Left knee",
      `M ${cx - lm.thigh.wBot - 2} ${lm.knee.yTop} L ${cx - lm.knee.w*0.4} ${lm.knee.yTop} L ${cx - lm.knee.w*0.4} ${lm.knee.yBot} L ${cx - lm.knee.w - 2} ${lm.knee.yBot} Z`)}
    ${region("kneeR", "Right knee",
      `M ${cx + lm.thigh.wBot + 2} ${lm.knee.yTop} L ${cx + lm.knee.w*0.4} ${lm.knee.yTop} L ${cx + lm.knee.w*0.4} ${lm.knee.yBot} L ${cx + lm.knee.w + 2} ${lm.knee.yBot} Z`)}
    ${region("calfL", "Left calf",
      `M ${cx - lm.knee.w - 2} ${lm.calf.yTop} L ${cx - lm.knee.w*0.5} ${lm.calf.yTop} L ${cx - lm.calf.wBot*0.5} ${lm.calf.yBot - 4} L ${cx - lm.calf.wTop} ${lm.calf.yBot - 4} Z`)}
    ${region("calfR", "Right calf",
      `M ${cx + lm.knee.w + 2} ${lm.calf.yTop} L ${cx + lm.knee.w*0.5} ${lm.calf.yTop} L ${cx + lm.calf.wBot*0.5} ${lm.calf.yBot - 4} L ${cx + lm.calf.wTop} ${lm.calf.yBot - 4} Z`)}
    ${region("achillesL", "Left achilles",
      `M ${cx - lm.calf.wTop + 2} ${lm.calf.yBot - 4} L ${cx - lm.calf.wBot*0.5 - 1} ${lm.calf.yBot - 4} L ${cx - lm.ankle.w + 2} ${lm.ankle.yTop + 6} L ${cx - lm.ankle.w - 1} ${lm.ankle.yTop + 6} Z`)}
    ${region("achillesR", "Right achilles",
      `M ${cx + lm.calf.wTop - 2} ${lm.calf.yBot - 4} L ${cx + lm.calf.wBot*0.5 + 1} ${lm.calf.yBot - 4} L ${cx + lm.ankle.w - 2} ${lm.ankle.yTop + 6} L ${cx + lm.ankle.w + 1} ${lm.ankle.yTop + 6} Z`)}
    ${region("ankleL", "Left ankle / foot",
      `M ${cx - lm.ankle.w - 1} ${lm.ankle.yTop + 6} L ${cx - lm.ankle.w + 4} ${lm.ankle.yTop + 6} L ${cx - 4} ${lm.foot.yBot - 2} L ${cx - lm.foot.w} ${lm.foot.yBot - 2} Z`)}
    ${region("ankleR", "Right ankle / foot",
      `M ${cx + lm.ankle.w + 1} ${lm.ankle.yTop + 6} L ${cx + lm.ankle.w - 4} ${lm.ankle.yTop + 6} L ${cx + 4} ${lm.foot.yBot - 2} L ${cx + lm.foot.w} ${lm.foot.yBot - 2} Z`)}
  `;
  // Position + H/W chips
  const positionChip = `<g>
    <rect x="8" y="8" rx="3" ry="3" width="40" height="16" fill="rgba(255,255,255,.10)" stroke="rgba(255,255,255,.15)" stroke-width=".5"/>
    <text x="28" y="20" fill="rgba(255,255,255,.85)" font-size="9.5" font-family="-apple-system,Inter,monospace" text-anchor="middle" letter-spacing="1" font-weight="700">${p.position || "?"}</text>
  </g>`;
  const hwText = (p.height && p.weight) ?
    `${Math.floor(p.height/12)}'${p.height%12}" · ${p.weight} lb` : "";
  const hwChip = hwText ? `<text x="232" y="20" fill="rgba(255,255,255,.55)" font-size="9" font-family="-apple-system,Inter,monospace" text-anchor="end" letter-spacing="1">${hwText}</text>` : "";
  const bgDefs = `
    <defs>
      <linearGradient id="vit-bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"  stop-color="#1a1410"/>
        <stop offset="100%" stop-color="#0d0a08"/>
      </linearGradient>
      <radialGradient id="vit-vignette" cx="50%" cy="40%" r="60%">
        <stop offset="0%" stop-color="rgba(255,235,200,.04)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,.45)"/>
      </radialGradient>
      <clipPath id="bodyClip-${p.pid||p.name?.replace(/\W/g,"")||"x"}">
        <path d="${sil}"/>
        <path d="${armL}"/>
        <use href="#armR-${p.pid||p.name?.replace(/\W/g,"")||"x"}"/>
      </clipPath>
      <g id="armR-${p.pid||p.name?.replace(/\W/g,"")||"x"}"><path d="${armL}" transform="${armRTransform}"/></g>
    </defs>
    <rect x="0" y="0" width="240" height="520" rx="10" fill="url(#vit-bg)"/>
    <rect x="0" y="0" width="240" height="520" rx="10" fill="url(#vit-vignette)"/>`;
  // Body BASE — dark anatomical line drawing
  const bodyBase = `
    <g fill="rgba(218,196,162,.06)" stroke="rgba(218,196,162,.45)" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">
      <path d="${sil}"/>
      <path d="${armL}"/>
      <path d="${armL}" transform="${armRTransform}"/>
    </g>`;
  // ── CAREER SCAR MARKERS ─────────────────────────────────────────
  // Small numbered dots on body parts injured 2+ times in career.
  // Tells the chronic-injury story visually — "this RB has hurt his
  // L knee 3 times, R hamstring 2 times". Anchor points roughly match
  // the body landmark coords.
  const _SCAR_ANCHORS = {
    head:        [cx, lm.head.cy - 4],
    neck:        [cx, (lm.neck.top + lm.neck.bot)/2],
    chest:       [cx, lm.chest.midY],
    back:        [cx, lm.waist.y + 4],
    groin:       [cx, lm.crotch.y - 4],
    shoulderL:   [cx - lm.shoulder.w*0.6, lm.shoulder.y + 18],
    shoulderR:   [cx + lm.shoulder.w*0.6, lm.shoulder.y + 18],
    hipL:        [cx - lm.hip.w*0.55, lm.hip.yBot - 12],
    hipR:        [cx + lm.hip.w*0.55, lm.hip.yBot - 12],
    hamstringL:  [cx - lm.thigh.wTop*0.5, (lm.thigh.yTop + lm.thigh.yBot)/2],
    hamstringR:  [cx + lm.thigh.wTop*0.5, (lm.thigh.yTop + lm.thigh.yBot)/2],
    kneeL:       [cx - lm.knee.w*0.3, (lm.knee.yTop + lm.knee.yBot)/2],
    kneeR:       [cx + lm.knee.w*0.3, (lm.knee.yTop + lm.knee.yBot)/2],
    calfL:       [cx - lm.calf.wTop*0.5, lm.calf.yTop + 30],
    calfR:       [cx + lm.calf.wTop*0.5, lm.calf.yTop + 30],
    achillesL:   [cx - lm.ankle.w*0.5, (lm.calf.yBot + lm.ankle.yTop)/2],
    achillesR:   [cx + lm.ankle.w*0.5, (lm.calf.yBot + lm.ankle.yTop)/2],
    ankleL:      [cx - lm.ankle.w*0.4, lm.ankle.yBot + 4],
    ankleR:      [cx + lm.ankle.w*0.4, lm.ankle.yBot + 4],
    handL:       [cx - lm.shoulder.w - 2, lm.arm.handY],
    handR:       [cx + lm.shoulder.w + 2, lm.arm.handY],
  };
  const scarMarkers = Object.entries(careerCounts)
    .filter(([k, n]) => n >= 2 && _SCAR_ANCHORS[k])
    .map(([k, n]) => {
      const [x, y] = _SCAR_ANCHORS[k];
      const fill = n >= 4 ? "#e6373a" : n >= 3 ? "#ed6a3a" : "#f0a93a";
      return `<g>
        <circle cx="${x}" cy="${y}" r="6" fill="${fill}" stroke="rgba(0,0,0,.6)" stroke-width="0.8"/>
        <text x="${x}" y="${y + 2.5}" fill="#fff" font-size="8" font-weight="800" font-family="-apple-system,monospace" text-anchor="middle">${n}</text>
      </g>`;
    }).join("");
  // Career-summary line (under footer)
  const totalCareerInjuries = Object.values(careerCounts).reduce((s, n) => s + n, 0);
  const mostInjured = Object.entries(careerCounts).sort((a, b) => b[1] - a[1])[0];
  const careerSummary = totalCareerInjuries > 0
    ? `<text x="120" y="496" fill="rgba(218,196,162,.5)" font-size="8" font-family="-apple-system,Inter,monospace" text-anchor="middle" letter-spacing="1">${totalCareerInjuries} career injur${totalCareerInjuries===1?"y":"ies"}${mostInjured ? ` · most-hit: ${_VITALS_PART_NAMES?.[mostInjured[0]] || mostInjured[0]} (${mostInjured[1]})` : ""}</text>`
    : "";
  return `<svg viewBox="0 0 240 520" width="240" height="460" xmlns="http://www.w3.org/2000/svg"
    style="border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.45), inset 0 0 0 1px rgba(218,196,162,.10)">
    ${bgDefs}
    ${positionChip}${hwChip}
    ${bodyBase}
    <g>
      ${regions}
    </g>
    ${innerLines}
    ${scarMarkers}
    ${careerSummary}
    <text x="120" y="510" fill="rgba(218,196,162,.65)" font-size="9.5" font-family="-apple-system,Inter,Georgia,serif" text-anchor="middle" letter-spacing="2" font-weight="600">
      WEAR ${wear.toFixed(0)}  ·  STRESS ${stress.toFixed(0)}
    </text>
  </svg>`;
}
// Pretty part-name labels (used across all vitals sections)
const _VITALS_PART_NAMES = {
  head: "Head", neck: "Neck", chest: "Chest", back: "Lower back", groin: "Groin",
  shoulderL: "Left shoulder", shoulderR: "Right shoulder",
  hipL: "Left hip", hipR: "Right hip",
  hamstringL: "Left hamstring", hamstringR: "Right hamstring",
  kneeL: "Left knee", kneeR: "Right knee",
  calfL: "Left calf", calfR: "Right calf",
  achillesL: "Left achilles", achillesR: "Right achilles",
  ankleL: "Left ankle", ankleR: "Right ankle",
  handL: "Left hand", handR: "Right hand",
};
// CSS-section header for the clinical panel
function _vSectionTitle(label, badge) {
  const b = badge ? `<span style="color:var(--gray);font-weight:500">${badge}</span>` : "";
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;font-size:.6rem;letter-spacing:1.2px;color:var(--gray);margin:.55rem 0 .25rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:.15rem">
    <span style="font-weight:700">${label}</span>${b}
  </div>`;
}
// ACTIVE INJURY block — if currently hurt, render a full status card
function _buildVitalsActiveInjury(p) {
  if (!p.injury || !p.injury.weeksRemaining) {
    return `<div style="display:flex;align-items:center;gap:.4rem;font-size:.66rem;color:#3fdf83;font-weight:600">
      <span style="font-size:.8rem">●</span> ACTIVE — cleared to play
    </div>`;
  }
  const inj = p.injury;
  const sev = inj._careerEnding ? "CAREER-ENDING"
            : inj._catastrophic ? "CATASTROPHIC"
            : "QUESTIONABLE";
  const sevColor = inj._careerEnding ? "#e6373a"
                 : inj._catastrophic ? "#ed6a3a" : "#f0a93a";
  const onset = (typeof _currentInjuryOnset === "function") ? _currentInjuryOnset(p) : null;
  const causeText = inj._nonContact ? "non-contact" : inj._bigHit ? "big hit" : "contact";
  const ovrTag = inj._ovrPenalty ? ` · −${inj._ovrPenalty} OVR on return` : "";
  return `<div style="background:rgba(${inj._careerEnding ? '230,55,58' : inj._catastrophic ? '237,106,58' : '240,169,58'},.10);border-left:3px solid ${sevColor};padding:.5rem .65rem;border-radius:2px;margin-bottom:.3rem">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.2rem">
      <span style="font-weight:800;color:${sevColor};letter-spacing:.5px;font-size:.7rem">${sev}</span>
      <span style="font-size:.62rem;color:var(--gray)">${inj.weeksRemaining}w out${onset?.week?` · onset W${onset.week}`:""}</span>
    </div>
    <div style="font-size:.72rem;font-weight:600;margin-bottom:.15rem">${inj.label}</div>
    <div style="font-size:.6rem;color:var(--gray)">${causeText}${ovrTag}</div>
  </div>`;
}
// CONCERNS — top body-part risk areas. Show ≥20 wear; if all healthy
// the diagram already tells that story so just say so.
function _buildVitalsConcerns(p) {
  const bw = p._bodyWear || {};
  const entries = Object.entries(bw).filter(([, v]) => v >= 20)
    .sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (!entries.length) {
    return `<div style="color:#3fdf83;font-size:.66rem;font-weight:600;padding:.3rem 0">⊕ No active concerns</div>`;
  }
  return entries.map(([k, v]) => {
    const color = _vitalsColor(v);
    const lbl = _vitalsLabel(v);
    // Injury risk multiplier (matches wearMul in _rollGameInjuries)
    const riskTag = v >= 85 ? "+60% risk" : v >= 70 ? "+35% risk" : v >= 50 ? "+15% risk" : "monitor";
    return `<div style="display:flex;align-items:center;gap:.4rem;font-size:.66rem;padding:.18rem 0;border-bottom:1px dashed rgba(255,255,255,.05)">
      <span style="color:${color};font-weight:700;font-size:.85rem">●</span>
      <span style="flex:1;font-weight:500">${_VITALS_PART_NAMES[k] || k}</span>
      <span style="color:${color};font-weight:700;min-width:24px;text-align:right">${v.toFixed(0)}</span>
      <span style="color:var(--gray);min-width:55px;text-align:right">${lbl}</span>
      <span style="color:${color};font-size:.6rem;font-weight:600;min-width:60px;text-align:right">${riskTag}</span>
    </div>`;
  }).join("");
}
// INJURY HISTORY — last 6 entries with full detail
function _buildVitalsInjuryTimeline(p) {
  const hist = (p.injuryHistory || []).slice(-6).reverse();
  if (!hist.length) return `<div style="color:var(--gray);font-size:.66rem;font-style:italic;padding:.3rem 0">No injury history on file</div>`;
  const rows = hist.map(h => {
    const part = h.bodyPart ? (_VITALS_PART_NAMES[h.bodyPart] || h.bodyPart) : "";
    const wks = h.weeks ?? h.duration ?? "?";
    const sevTag = h.careerEnding ? `<span style="color:#e6373a;font-weight:700;font-size:.55rem">CAREER-END</span>`
                : h.catastrophic ? `<span style="color:#ed6a3a;font-weight:700;font-size:.55rem">CATA</span>`
                : "";
    const causeChip = h.cause === "non_contact"
      ? `<span style="background:rgba(80,140,200,.15);color:#90c4ec;padding:.05rem .3rem;border-radius:2px;font-size:.55rem;letter-spacing:.3px">N-C</span>`
      : h.cause === "sack"
      ? `<span style="background:rgba(230,140,80,.15);color:#f0a96b;padding:.05rem .3rem;border-radius:2px;font-size:.55rem;letter-spacing:.3px">SACK</span>`
      : h.cause === "big_hit"
      ? `<span style="background:rgba(230,80,80,.15);color:#ec9090;padding:.05rem .3rem;border-radius:2px;font-size:.55rem;letter-spacing:.3px">HIT</span>`
      : `<span style="background:rgba(140,140,140,.10);color:#aaa;padding:.05rem .3rem;border-radius:2px;font-size:.55rem;letter-spacing:.3px">WK</span>`;
    const mech = h.mechanism ? (
      h.mechanism === "head_on" ? "head-on" :
      h.mechanism === "high"    ? "high hit" :
      h.mechanism === "low"     ? "low / cut" :
      h.mechanism === "side"    ? "side" :
      h.mechanism === "behind"  ? "blindside" : h.mechanism
    ) : "";
    const tacklerNote = h.tackler ? ` · by ${h.tackler}` : "";
    const mechTooltip = mech ? ` title="Mechanism: ${mech}${tacklerNote}"` : (h.tackler ? ` title="${tacklerNote.slice(3)}"` : "");
    return `<div${mechTooltip} style="display:flex;justify-content:space-between;align-items:center;gap:.4rem;font-size:.63rem;padding:.22rem 0;border-bottom:1px solid rgba(255,255,255,.05)">
      <span style="color:var(--gray);min-width:50px">S${h.season} W${h.week}</span>
      <span style="flex:1;font-weight:500">${h.label}${part ? `<span style="color:var(--gray);font-weight:400"> · ${part}</span>` : ""}${mech ? `<span style="color:rgba(255,255,255,.4);font-weight:400;font-size:.58rem"> · ${mech}</span>` : ""}</span>
      ${causeChip}
      <span style="color:var(--gray);min-width:24px;text-align:right">${wks}w</span>
      ${sevTag}
    </div>`;
  }).join("");
  return rows;
}
// RISK FACTORS — career-long stuff a trainer would flag
function _buildVitalsRiskFactors(p) {
  const items = [];
  // Concussions
  const lifetime = (p._concussionsLifetime || 0) + (p._concussionsThisSeason || 0);
  if (lifetime > 0) {
    const color = lifetime >= 6 ? "#e6373a" : lifetime >= 4 ? "#ed6a3a" : lifetime >= 2 ? "#f0a93a" : "rgba(255,255,255,.7)";
    const note = lifetime >= 6 ? "CTE risk 30%/concussion"
              : lifetime >= 4 ? "CTE risk 15%/concussion"
              : lifetime >= 2 ? "watchlist" : "";
    items.push({ color, label: "Concussions", value: `${lifetime}`, note });
  }
  // RB career touches
  if (p.position === "RB") {
    const t = p._careerTouches || 0;
    if (t > 0) {
      const color = t >= 3000 ? "#e6373a" : t >= 2500 ? "#ed6a3a" : t >= 2000 ? "#f0a93a" : "rgba(255,255,255,.7)";
      const note = t >= 3000 ? "+3yr retire offset"
                : t >= 2500 ? "+2yr retire offset"
                : t >= 2000 ? "+1yr retire offset" : "below burnout threshold";
      items.push({ color, label: "Career touches", value: `${t.toLocaleString()}`, note });
    }
  }
  // Prior injuries
  const priorCount = (p.injuryHistory || []).length;
  if (priorCount > 0) {
    const isProne = priorCount >= 3;
    const color = isProne ? "#ed6a3a" : priorCount >= 2 ? "#f0a93a" : "rgba(255,255,255,.7)";
    const note = isProne ? "INJURY-PRONE · +40% recurrence" : priorCount >= 2 ? "1 from injury-prone" : "";
    items.push({ color, label: "Prior injuries", value: `${priorCount}`, note });
  }
  // Career ejections — repeat-offender flag for hits
  const ej = p.ejections || 0;
  if (ej > 0) {
    const color = ej >= 3 ? "#e6373a" : ej >= 2 ? "#ed6a3a" : "#f0a93a";
    const note = ej >= 3 ? "REPEAT OFFENDER · suspension risk"
              : ej >= 2 ? "watchlist"
              :           "career ejections";
    items.push({ color, label: "Ejections", value: `${ej}`, note });
  }
  // Age cliff
  const age = p.age || 25;
  if (age >= 30) {
    const color = age >= 35 ? "#ed6a3a" : age >= 33 ? "#f0a93a" : "rgba(255,255,255,.7)";
    const note = age >= 35 ? "1.65× injury rate · slow recovery"
              : age >= 33 ? "1.45× injury rate"
              : age >= 32 ? "1.25× injury rate"
              :             "1.10× injury rate";
    items.push({ color, label: "Age curve", value: `${age}y`, note });
  }
  if (!items.length) return `<div style="color:var(--gray);font-size:.66rem;font-style:italic;padding:.3rem 0">No long-term risk markers</div>`;
  return items.map(i => `<div style="display:flex;align-items:center;gap:.4rem;font-size:.65rem;padding:.18rem 0">
    <span style="color:${i.color};font-weight:700;font-size:.85rem">●</span>
    <span style="flex:1">${i.label}</span>
    <span style="color:${i.color};font-weight:700">${i.value}</span>
    <span style="color:var(--gray);min-width:140px;text-align:right;font-size:.6rem">${i.note}</span>
  </div>`).join("");
}
// RECOVERY GUIDANCE — auto-recommendation based on current state
function _buildVitalsGuidance(p) {
  const recs = [];
  const wear = p._wear || 0;
  const stress = p._stress || 0;
  if (p.injury && p.injury.weeksRemaining > 0) {
    recs.push({ icon: "🚑", text: `IR / scratch this week — wear decays −25 instead of −2 if rested`, urgent: true });
  } else {
    if (wear >= 85) recs.push({ icon: "⚠", text: `Wear critical — sit this week or risk catastrophic; full backup snaps`, urgent: true });
    else if (wear >= 70) recs.push({ icon: "▶", text: `Reduce snap share to 50% or scratch the next low-leverage game`, urgent: false });
    if (stress >= 80) recs.push({ icon: "⚠", text: `Stress critical — limit max-speed reps; hamstring/calf risk elevated`, urgent: true });
    else if (stress >= 60) recs.push({ icon: "▶", text: `Stress elevated — manage explosive-play count this week`, urgent: false });
  }
  const lifetime = (p._concussionsLifetime || 0) + (p._concussionsThisSeason || 0);
  if (lifetime >= 4) recs.push({ icon: "🧠", text: `CTE watchlist — flag concussion symptoms aggressively`, urgent: lifetime >= 6 });
  if (!recs.length) return `<div style="color:#3fdf83;font-size:.66rem;font-weight:500;padding:.3rem 0">⊕ Cleared for full participation</div>`;
  return recs.map(r => `<div style="display:flex;align-items:flex-start;gap:.4rem;font-size:.64rem;padding:.2rem 0;color:${r.urgent ? '#f0a93a' : 'rgba(255,255,255,.75)'}">
    <span style="font-size:.75rem">${r.icon}</span>
    <span style="flex:1;line-height:1.35">${r.text}</span>
  </div>`).join("");
}
function _buildVitalsBlock(p) {
  // Overall health weights three signals so the bar matches the body
  // diagram + active-injury state:
  //   • Active injury → score = 0 ("OUT") regardless of decay
  //   • _wear / _stress (acute load) — what the trainer sees Sunday
  //   • Worst body-part scar — chronic recurrence risk (R knee at 50
  //     after 2 prior ACLs should show in the score even after rest)
  // Without the body-part term, a player who tore their ACL last year
  // and decayed wear/stress to 0 reads as "100 health" — misleading.
  const wear   = p._wear || 0;
  const stress = p._stress || 0;
  const maxBodyWear = Math.max(0, ...Object.values(p._bodyWear || {}));
  const isInjured = !!(p.injury && p.injury.weeksRemaining > 0);
  let overallScore, overallLabel;
  if (isInjured) {
    overallScore = 0;
    overallLabel = p.injury._careerEnding ? "CAREER-END" :
                   p.injury._catastrophic ? "OUT (CATA)" :
                   `OUT ${p.injury.weeksRemaining}w`;
  } else {
    // Blend: acute load + worst chronic scar × 0.55 (scars matter but
    // don't dominate). max() of the three so the worst signal wins.
    overallScore = Math.max(0, 100 - Math.max(wear, stress, maxBodyWear * 0.55));
    overallLabel = overallScore >= 85 ? "Healthy"
                : overallScore >= 70 ? "Managed"
                : overallScore >= 50 ? "Worn"
                : overallScore >= 30 ? "Stressed"
                :                       "Critical";
  }
  const overallColor = isInjured ? "#e6373a" : _vitalsColor(100 - overallScore);
  return `<div class="frn-pcard-section">
    <div class="frn-card-title" style="display:flex;justify-content:space-between;align-items:baseline">
      <span>VITALS</span>
      <span style="color:var(--gray);font-size:.6rem;font-weight:500;letter-spacing:1px">TRAINER'S REPORT</span>
    </div>
    <div style="display:flex;gap:1rem;align-items:flex-start">
      <div style="flex-shrink:0">
        ${_buildVitalsBodyDiagram(p)}
      </div>
      <div style="flex:1;min-width:0">
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);padding:.5rem .6rem;border-radius:4px;margin-bottom:.3rem">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span style="font-size:.62rem;letter-spacing:1.2px;color:var(--gray)">OVERALL HEALTH</span>
            <span style="display:flex;align-items:baseline;gap:.5rem">
              <span style="color:${overallColor};font-size:.6rem;font-weight:700;letter-spacing:.5px">${overallLabel}</span>
              <span style="color:${overallColor};font-size:1.1rem;font-weight:800">${overallScore.toFixed(0)}<span style="color:var(--gray);font-size:.7rem;font-weight:500">/100</span></span>
            </span>
          </div>
          <div style="height:6px;border-radius:3px;background:rgba(0,0,0,.4);overflow:hidden;margin-top:.3rem">
            <div style="height:100%;width:${overallScore}%;background:${overallColor};transition:width .3s"></div>
          </div>${maxBodyWear >= 25 && !isInjured ? `
          <div style="margin-top:.25rem;font-size:.55rem;color:var(--gray);letter-spacing:.3px">
            Active wear ${wear.toFixed(0)} · Stress ${stress.toFixed(0)} · Chronic scar ${maxBodyWear.toFixed(0)}
          </div>` : ""}
        </div>
        ${_vSectionTitle("Status")}
        ${_buildVitalsActiveInjury(p)}
        ${_vSectionTitle("Concerns", "body-part wear ≥ 20")}
        ${_buildVitalsConcerns(p)}
        ${_vSectionTitle("Recovery Guidance")}
        ${_buildVitalsGuidance(p)}
        ${_vSectionTitle("Risk Factors", "career")}
        ${_buildVitalsRiskFactors(p)}
        ${_vSectionTitle("Injury History", "last 6")}
        ${_buildVitalsInjuryTimeline(p)}
      </div>
    </div>
  </div>`;
}

function _buildArchetypeBlock(p) {
  // Best-effort: look up ARCHETYPE_BY_POS in window if available.
  let entry = null;
  try {
    const byPos = {
      QB: typeof QB_ARCHETYPES !== "undefined" ? QB_ARCHETYPES : null,
      RB: typeof RB_ARCHETYPES !== "undefined" ? RB_ARCHETYPES : null,
      WR: typeof WR_ARCHETYPES !== "undefined" ? WR_ARCHETYPES : null,
      TE: typeof TE_ARCHETYPES !== "undefined" ? TE_ARCHETYPES : null,
      OL: typeof OL_ARCHETYPES !== "undefined" ? OL_ARCHETYPES : null,
      DL: typeof DL_ARCHETYPES !== "undefined" ? DL_ARCHETYPES : null,
      LB: typeof LB_ARCHETYPES !== "undefined" ? LB_ARCHETYPES : null,
      CB: typeof CB_ARCHETYPES !== "undefined" ? CB_ARCHETYPES : null,
      S:  typeof S_ARCHETYPES  !== "undefined" ? S_ARCHETYPES  : null,
      K:  typeof K_ARCHETYPES  !== "undefined" ? K_ARCHETYPES  : null,
      P:  typeof P_ARCHETYPES  !== "undefined" ? P_ARCHETYPES  : null,
    };
    entry = (byPos[p.position] || {})[p.archetype];
  } catch {}
  if (!entry) return "";
  return `<div class="frn-pcard-archetype">
    <div class="frn-pcard-archetype-name">${(entry.label || p.archetype || "").toUpperCase()}</div>
    <div class="frn-pcard-archetype-blurb">${entry.blurb || ""}</div>
  </div>`;
}

// PPR fantasy points for a single stat line. Single source of truth so
// season totals, per-game lines, and rank calculations all agree.
function _fantasyPPR(line, pos) {
  if (!line) return 0;
  let f = 0;
  if (pos === "QB") f += (line.pass_yds||0)*0.04 + (line.pass_td||0)*4 - (line.pass_int||0)*2;
  f += (line.rush_yds||0)*0.1 + (line.rush_td||0)*6;
  f += (line.rec||0)*1 + (line.rec_yds||0)*0.1 + (line.rec_td||0)*6;
  f += (line.tkl||0)*1 + (line.sk||0)*2 + (line.int_made||0)*4 + (line.ff||0)*2 + (line.fr||0)*2 + (line.pd||0)*0.5;
  f += (line.fg_made||0)*3 + (line.xp_made||0)*1;
  // Bonus PPR yardage tiers — closer to standard fantasy with TD-only bonus
  if ((line.pass_yds||0) >= 300) f += 3;
  if ((line.rush_yds||0) >= 100) f += 3;
  if ((line.rec_yds||0) >= 100) f += 3;
  return Math.round(f * 10) / 10;
}

// Position-rank by total FPTS across every roster in the league.
// Returns { rank, total } where total = number of players at that pos
// who have logged any stats this season.
function _fantasyPositionRank(playerName, pos) {
  const seasonStats = franchise?.seasonStats || {};
  // Position-specific qualifying thresholds — only count meaningful
  // contributors so "of N" reflects starters/co-starters, not every
  // backup who threw a kneel-down or every WR4 who caught one pass.
  const qualifies = (line) => {
    const gp = +line.gp || 0;
    if (pos === "QB") return (line.pass_att || 0) >= 100 || gp >= 8;
    if (pos === "RB") return (line.rush_att || 0) >= 80  || gp >= 8;
    if (pos === "WR" || pos === "TE") return (line.rec_tgt || 0) >= 30 || gp >= 8;
    if (pos === "K")  return (line.fg_att || 0) >= 10 || gp >= 8;
    return gp >= 6;
  };
  // Dedup by name (a traded player appears in both team buckets) by
  // aggregating their stats across all buckets before qualifying.
  const agg = new Map();
  for (const players of Object.values(seasonStats)) {
    for (const [name, line] of Object.entries(players || {})) {
      if (!line || line.pos !== pos) continue;
      const cur = agg.get(name) || { name, pos, gp: 0 };
      const MAX = new Set(["pass_long","rush_long","rec_long","fg_long"]);
      for (const [k, v] of Object.entries(line)) {
        if (typeof v !== "number") continue;
        if (MAX.has(k)) cur[k] = Math.max(cur[k] || 0, v);
        else            cur[k] = (cur[k] || 0) + v;
      }
      agg.set(name, cur);
    }
  }
  const bucket = [...agg.values()]
    .filter(qualifies)
    .map(line => ({ name: line.name, fpts: _fantasyPPR(line, pos) }));
  if (!bucket.length) return null;
  bucket.sort((a, b) => b.fpts - a.fpts);
  const idx = bucket.findIndex(b => b.name === playerName);
  if (idx === -1) return null;
  return { rank: idx + 1, total: bucket.length, fpts: bucket[idx].fpts };
}

// Simple passer rating from CMP/ATT/YDS/TD/INT. NFL formula, clamped.
function _passerRating(comp, att, yds, td, int_) {
  if (!att) return 0;
  const a = Math.max(0, Math.min(2.375, ((comp/att) - 0.3) * 5));
  const b = Math.max(0, Math.min(2.375, ((yds/att) - 3) * 0.25));
  const c = Math.max(0, Math.min(2.375, (td/att) * 20));
  const d = Math.max(0, Math.min(2.375, 2.375 - (int_/att) * 25));
  return Math.round(((a + b + c + d) / 6) * 100 * 10) / 10;
}

// Sum per-game stat lines for one player across a list of played games
// (regular-season schedule entries or playoff bracket matches). Returns
// the aggregate stat blob (gp, summed counting stats, max for long stats)
// + an ordered list of per-game FPTS for the best/worst-week display.
function _aggregateLines(p, games) {
  const MAX = new Set(["pass_long","rush_long","rec_long","fg_long","int_long","punt_long","kr_long","pr_long"]);
  const agg = { name: p.name, pos: p.position, gp: 0 };
  const candidateKeys = [p.name, p.nickname].filter(Boolean);
  const perGame = [];
  for (const g of games) {
    if (!g?.stats) continue;
    let line = null;
    for (const key of candidateKeys) {
      line = g.stats.home?.players?.[key] || g.stats.away?.players?.[key];
      if (line) break;
    }
    if (!line) continue;
    agg.gp++;
    for (const [k, v] of Object.entries(line)) {
      if (typeof v !== "number") continue;
      if (MAX.has(k)) agg[k] = Math.max(agg[k] || 0, v);
      else            agg[k] = (agg[k] || 0) + v;
    }
    perGame.push({ week: g.week, label: g._label || `W${g.week}`, fpts: _fantasyPPR(line, p.position) });
  }
  return { agg, perGame };
}

function _buildSeasonStatsBlock(p) {
  if (!franchise) return "";
  // Regular season — every played game on the schedule
  const regGames = (franchise.schedule || []).filter(g => g.played && g.stats);
  // Playoffs — every played match in the current bracket, week-tagged so
  // the fantasy block's best/worst-week labels carry round names.
  const playoffGames = [];
  const pb = franchise.playoffBracket;
  if (pb && Array.isArray(pb.rounds)) {
    const roundsLen = pb.rounds.length;
    const labelFor = (idx) => {
      if (roundsLen === 3) return ["WC","SF","SB"][idx] || `PR${idx+1}`;
      if (roundsLen === 4) return ["WC","DIV","CC","SB"][idx] || `PR${idx+1}`;
      return `PR${idx+1}`;
    };
    pb.rounds.forEach((rd, rIdx) => {
      if (!Array.isArray(rd)) return;
      for (const m of rd) {
        if (!m?.stats || m.homeScore == null || m.awayScore == null) continue;
        playoffGames.push({ stats: m.stats, week: FRANCHISE_WEEKS + rIdx + 1, _label: labelFor(rIdx) });
      }
    });
  }
  const reg = _aggregateLines(p, regGames);
  const po  = _aggregateLines(p, playoffGames);
  // Render regular-season panel first, then playoffs panel if any. Falls
  // back to franchise.seasonStats if per-game lines are missing (e.g.
  // legacy saves) so the panel still appears.
  let regBlock = "";
  if (reg.agg.gp > 0) {
    regBlock = _buildStatScopeBlock(p, reg.agg, `📈 REGULAR SEASON · ${reg.agg.gp} GP`, reg.perGame);
  } else {
    // Legacy fallback — pre-split seasonStats blob (regular + playoff lumped).
    for (const ts of Object.values(franchise.seasonStats || {})) {
      if (ts && ts[p.name]) { reg.agg = ts[p.name]; break; }
    }
    if (reg.agg && reg.agg.gp) {
      regBlock = _buildStatScopeBlock(p, reg.agg, `📈 SEASON TOTALS · ${reg.agg.gp} GP`, []);
    }
  }
  const poBlock = po.agg.gp > 0
    ? _buildStatScopeBlock(p, po.agg, `🏆 PLAYOFFS · ${po.agg.gp} GP`, po.perGame)
    : "";
  return regBlock + poBlock;
}

// Renders one stat panel (position-specific stat lines + fantasy block for
// skill positions). Pulled out so the same renderer serves regular season
// and playoffs. Pass `title` (e.g. "REGULAR SEASON · 15 GP") and `perGame`
// (already filtered to the scope) so the fantasy "BEST WK"/"WORST WK"
// labels point at the right slice.
function _buildStatScopeBlock(p, stat, title, perGame) {
  if (!stat || !stat.gp) return "";
  const pos = p.position;
  const fmtTuples = [];
  const num = k => +(stat[k] || 0);
  const gp = num("gp") || stat.gp || 1;
  const per = v => (v / gp).toFixed(1);
  if (pos === "QB") {
    const cmp = num("pass_comp"), att = num("pass_att"), yds = num("pass_yds");
    fmtTuples.push(["CMP/ATT", `${cmp}/${att}`]);
    fmtTuples.push(["CMP %", att ? `${(cmp/att*100).toFixed(1)}%` : "—"]);
    fmtTuples.push(["PASS YDS", yds]);
    fmtTuples.push(["YDS/GAME", per(yds)]);
    fmtTuples.push(["Y/A", att ? (yds/att).toFixed(1) : "—"]);
    fmtTuples.push(["PASS TD", num("pass_td")]);
    fmtTuples.push(["INT", num("pass_int")]);
    fmtTuples.push(["RATING", _passerRating(cmp, att, yds, num("pass_td"), num("pass_int"))]);
    if (num("pass_long")) fmtTuples.push(["LONG", num("pass_long")]);
    if (num("sacks_taken")) fmtTuples.push(["SACKED", `${num("sacks_taken")} (-${num("sack_yds")})`]);
    if (num("fumbles")) fmtTuples.push(["FUM", `${num("fumbles")}${num("fumbles_lost")?` · ${num("fumbles_lost")} LOST`:""}`]);
    if (num("snaps")) fmtTuples.push(["SNAPS", num("snaps")]);
    if (num("rush_att")) { fmtTuples.push(["RUSH ATT", num("rush_att")]); fmtTuples.push(["RUSH YDS", num("rush_yds")]); }
    if (num("rush_td")) fmtTuples.push(["RUSH TD", num("rush_td")]);
  } else if (pos === "RB") {
    const car = num("rush_att"), yds = num("rush_yds");
    fmtTuples.push(["CAR", car]);
    fmtTuples.push(["RUSH YDS", yds]);
    fmtTuples.push(["YPC", car ? (yds/car).toFixed(1) : "—"]);
    fmtTuples.push(["YDS/GAME", per(yds)]);
    fmtTuples.push(["RUSH TD", num("rush_td")]);
    if (num("rush_long")) fmtTuples.push(["LONG", num("rush_long")]);
    if (num("broken_tackles")) fmtTuples.push(["BROKEN TKL", num("broken_tackles")]);
    if (num("fumbles")) fmtTuples.push(["FUM", `${num("fumbles")}${num("fumbles_lost")?` · ${num("fumbles_lost")} LOST`:""}`]);
    if (num("snaps")) fmtTuples.push(["SNAPS", num("snaps")]);
    if (num("rec")) {
      fmtTuples.push(["REC", `${num("rec")}/${num("rec_tgt")||num("rec")}`]);
      fmtTuples.push(["REC YDS", num("rec_yds")]);
      fmtTuples.push(["REC TD", num("rec_td")]);
      if (num("rec_long")) fmtTuples.push(["REC LONG", num("rec_long")]);
    }
  } else if (pos === "WR" || pos === "TE") {
    const rec = num("rec"), yds = num("rec_yds"), tgt = num("rec_tgt");
    fmtTuples.push(["REC", rec]);
    fmtTuples.push(["TGT", tgt]);
    fmtTuples.push(["REC YDS", yds]);
    fmtTuples.push(["YPR", rec ? (yds/rec).toFixed(1) : "—"]);
    fmtTuples.push(["YDS/GAME", per(yds)]);
    fmtTuples.push(["REC TD", num("rec_td")]);
    fmtTuples.push(["CATCH %", tgt ? `${(rec/tgt*100).toFixed(1)}%` : "—"]);
    if (num("rec_long")) fmtTuples.push(["LONG", num("rec_long")]);
    if (num("rec_drops")) fmtTuples.push(["DROPS", num("rec_drops")]);
    if (num("fumbles")) fmtTuples.push(["FUM", `${num("fumbles")}${num("fumbles_lost")?` · ${num("fumbles_lost")} LOST`:""}`]);
    if (num("snaps")) fmtTuples.push(["SNAPS", num("snaps")]);
    if (num("rush_att")) { fmtTuples.push(["RUSH ATT", num("rush_att")]); fmtTuples.push(["RUSH YDS", num("rush_yds")]); }
  } else if (pos === "DL" || pos === "LB" || pos === "CB" || pos === "S") {
    const tklN = num("tkl"), missN = num("missed_tkl");
    fmtTuples.push(["TKL", tklN]);
    fmtTuples.push(["TKL/GAME", per(tklN)]);
    if (missN) fmtTuples.push(["MISS TKL", missN]);
    if (missN || tklN) {
      const total = tklN + missN;
      fmtTuples.push(["TKL%", total ? `${((tklN / total) * 100).toFixed(0)}%` : "—"]);
    }
    if (num("sk")) {
      fmtTuples.push(["SK", num("sk")]);
      if (num("sk_yds")) fmtTuples.push(["SK YDS", num("sk_yds")]);
    }
    if (num("int_made")) {
      fmtTuples.push(["INT", num("int_made")]);
      if (num("int_yds")) fmtTuples.push(["INT YDS", num("int_yds")]);
      if (num("int_long")) fmtTuples.push(["INT LONG", num("int_long")]);
      if (num("int_td")) fmtTuples.push(["INT TD", num("int_td")]);
    }
    if (num("pd")) fmtTuples.push(["PD", num("pd")]);
    if (num("ff")) fmtTuples.push(["FF", num("ff")]);
    if (num("fr")) fmtTuples.push(["FR", num("fr")]);
    if (num("def_td") && !num("int_td")) fmtTuples.push(["DEF TD", num("def_td")]);
  } else if (pos === "K") {
    fmtTuples.push(["FG", `${num("fg_made")}/${num("fg_att")}`]);
    fmtTuples.push(["FG %", num("fg_att") ? `${(num("fg_made")/num("fg_att")*100).toFixed(1)}%` : "—"]);
    fmtTuples.push(["LONG", num("fg_long")]);
    fmtTuples.push(["XP", `${num("xp_made")}/${num("xp_att")}`]);
  } else if (pos === "P") {
    // Punter — built on the special-teams stat fields rolled in by
    // mergeSeasonStats. Net avg is approximate (total minus return yds
    // would be cleaner but those aren't summed here yet).
    const punts = num("punt_att"), pYds = num("punt_yds");
    fmtTuples.push(["PUNTS", punts]);
    fmtTuples.push(["PUNT YDS", pYds]);
    fmtTuples.push(["AVG", punts ? (pYds / punts).toFixed(1) : "—"]);
    fmtTuples.push(["LONG", num("punt_long")]);
    if (num("punts_in_20")) fmtTuples.push(["IN-20", num("punts_in_20")]);
    if (num("touchbacks")) fmtTuples.push(["TB", num("touchbacks")]);
    if (num("blk_kick")) fmtTuples.push(["BLOCKED", num("blk_kick")]);
  } else if (pos === "OL") {
    fmtTuples.push(["PANCAKES", num("pancakes")]);
    fmtTuples.push(["SACKS ALLOWED", num("sacks_allowed")]);
    if (num("penalties")) fmtTuples.push(["PENALTIES", num("penalties")]);
  }
  // Snap counts — appended to every skill / defensive position. Uses the
  // raw cumulative `snaps` field from the per-game merge.
  if (["QB","RB","WR","TE","DL","LB","CB","S"].includes(pos) && num("snaps")) {
    fmtTuples.push(["SNAPS", num("snaps")]);
    fmtTuples.push(["SNAPS/GAME", per(num("snaps"))]);
  }
  // Return contributions — surface if the player ever returned anything
  // this season, regardless of position (CBs/Ss often return kicks).
  if (num("kr_att") || num("pr_att") || num("kr_td") || num("pr_td")) {
    if (num("kr_att")) {
      const kr = num("kr_att"), kyd = num("kr_yds");
      fmtTuples.push(["KR", kr]);
      fmtTuples.push(["KR YDS", kyd]);
      fmtTuples.push(["KR AVG", kr ? (kyd / kr).toFixed(1) : "—"]);
      if (num("kr_long")) fmtTuples.push(["KR LONG", num("kr_long")]);
      if (num("kr_td")) fmtTuples.push(["KR TD", num("kr_td")]);
    }
    if (num("pr_att")) {
      const pr = num("pr_att"), pyd = num("pr_yds");
      fmtTuples.push(["PR", pr]);
      fmtTuples.push(["PR YDS", pyd]);
      fmtTuples.push(["PR AVG", pr ? (pyd / pr).toFixed(1) : "—"]);
      if (num("pr_long")) fmtTuples.push(["PR LONG", num("pr_long")]);
      if (num("pr_td")) fmtTuples.push(["PR TD", num("pr_td")]);
    }
  }
  if (!fmtTuples.length) return "";

  // Fantasy stats — appended after position-specific stats. Uses the
  // scope-filtered perGame list (regular OR playoff) so best/worst week
  // reflects only that scope.
  let fantasyHtml = "";
  if (["QB","RB","WR","TE","K"].includes(pos)) {
    const games = perGame || [];
    let totalFpts = games.reduce((s, x) => s + x.fpts, 0);
    // Fallback: if no per-game lines were supplied but the aggregate has
    // production, compute FPTS off the aggregate so the line never reads
    // 0.0 when the player clearly produced.
    if (games.length === 0 && stat && (stat.gp || 0) > 0) {
      const aggFpts = _fantasyPPR(stat, pos);
      if (aggFpts > 0) totalFpts = aggFpts;
    }
    const gpForAvg = games.length || (stat?.gp || 0);
    const fptsPg = gpForAvg > 0 ? (totalFpts / gpForAvg).toFixed(1) : "0.0";
    const best = games.length ? games.reduce((a, b) => b.fpts > a.fpts ? b : a) : null;
    const worst = games.length ? games.reduce((a, b) => b.fpts < a.fpts ? b : a) : null;
    const rank = _fantasyPositionRank(p.name, pos);
    // Opportunities = touches (carries + targets) — top fantasy stat
    const touches = num("rush_att") + num("rec_tgt");
    const fantasyTuples = [
      ["FPTS (PPR)", totalFpts.toFixed(1)],
      ["FPTS / GAME", fptsPg],
    ];
    // POS RANK only meaningful for full-season totals; skip on the
    // playoffs panel (the ranker pulls from franchise.seasonStats which
    // is the merged blob — comparing playoff-only FPTS to season FPTS
    // would be misleading).
    if (rank && /REGULAR SEASON|SEASON TOTALS/.test(title)) {
      fantasyTuples.push([`POS RANK`, `#${rank.rank} of ${rank.total}`]);
    }
    if (touches > 0) fantasyTuples.push(["TOUCHES", touches]);
    if (best) fantasyTuples.push(["BEST GM", `${best.label} (${best.fpts.toFixed(1)})`]);
    if (worst && best && worst.label !== best.label) fantasyTuples.push(["WORST GM", `${worst.label} (${worst.fpts.toFixed(1)})`]);
    const fantasyCells = fantasyTuples.map(([k, v]) =>
      `<div class="k">${k}</div><div class="v">${v}</div>`
    ).join("");
    fantasyHtml = `<div style="margin-top:.5rem;padding-top:.4rem;border-top:1px dashed var(--border)">
      <div class="frn-card-title" style="margin-bottom:.25rem">FANTASY (PPR)</div>
      <div class="frn-pcard-seasonstats">${fantasyCells}</div>
    </div>`;
  }

  const cells = fmtTuples.map(([k, v]) =>
    `<div class="k">${k}</div><div class="v">${v}</div>`
  ).join("");
  // MFF grade chips — render only on the regular-season scope (grades are
  // standardized against the regular-season league pool, so showing them on
  // the playoff scope panel would be misleading).
  const isRegScope = /REGULAR SEASON|SEASON TOTALS/.test(title);
  const mffHtml = (typeof mffGradeChipsHtml === "function" && isRegScope)
    ? mffGradeChipsHtml(p) : "";
  // EPA chips — also regular-season only (the playLog is regular-season
  // only; playoff EPA would need separate retention).
  const epaHtml = (typeof mffPlayerEPAChipsHtml === "function" && isRegScope)
    ? mffPlayerEPAChipsHtml(p) : "";
  return `<div class="frn-pcard-section">
    <div class="frn-card-title">${title}</div>
    <div class="frn-pcard-seasonstats">${cells}</div>
    ${mffHtml}
    ${epaHtml}
    ${fantasyHtml}
  </div>`;
}

// Per-game stat line — walks the franchise schedule, finds every played
// game where this player appeared, returns one row per game with a
// position-appropriate line.
function _buildGameLogBlock(p) {
  if (!franchise?.schedule) return "";
  const pos = p.position;
  const games = [];
  for (const g of franchise.schedule) {
    if (!g.played || !g.stats) continue;
    const homePlayers = g.stats.home?.players || {};
    const awayPlayers = g.stats.away?.players || {};
    let line = null, teamId = null, oppId = null;
    if (homePlayers[p.name]) { line = homePlayers[p.name]; teamId = g.homeId; oppId = g.awayId; }
    else if (awayPlayers[p.name]) { line = awayPlayers[p.name]; teamId = g.awayId; oppId = g.homeId; }
    if (!line) continue;
    games.push({ g, line, teamId, oppId, isPlayoff: false });
  }
  // Append playoff games from the current bracket. The bracket stores
  // matches in franchise.playoffBracket.rounds[roundIdx][matchIdx]; played
  // matches have stats. We synthesize a `week` so the same sort works
  // (FRANCHISE_WEEKS + roundIdx + 1) and attach a roundLabel for display.
  const pb = franchise.playoffBracket;
  if (pb && Array.isArray(pb.rounds)) {
    const roundsLen = pb.rounds.length;
    // 3-round brackets get NFL-style names; otherwise fall back to PR1/PR2...
    const labelFor = (idx) => {
      if (roundsLen === 3) return ["WC","SF","SB"][idx] || `PR${idx+1}`;
      if (roundsLen === 4) return ["WC","DIV","CC","SB"][idx] || `PR${idx+1}`;
      return `PR${idx+1}`;
    };
    pb.rounds.forEach((rd, rIdx) => {
      if (!Array.isArray(rd)) return;
      for (const m of rd) {
        if (!m?.stats || m.homeScore == null || m.awayScore == null) continue;
        const homePlayers = m.stats.home?.players || {};
        const awayPlayers = m.stats.away?.players || {};
        let line = null, teamId = null, oppId = null;
        if (homePlayers[p.name]) { line = homePlayers[p.name]; teamId = m.homeId; oppId = m.awayId; }
        else if (awayPlayers[p.name]) { line = awayPlayers[p.name]; teamId = m.awayId; oppId = m.homeId; }
        if (!line) continue;
        const synthWk = FRANCHISE_WEEKS + rIdx + 1;
        // Synthesize a schedule-shaped object so the row builders can read
        // the same fields they use for regular-season games. Includes stats
        // so the snap-percentage column can look up team-level totals.
        const g = {
          week: synthWk, homeId: m.homeId, awayId: m.awayId,
          homeScore: m.homeScore, awayScore: m.awayScore,
          stats: m.stats,
        };
        games.push({ g, line, teamId, oppId, isPlayoff: true, roundLabel: labelFor(rIdx) });
      }
    });
  }
  if (!games.length) return "";
  // Show newest game first
  games.sort((a, b) => b.g.week - a.g.week);
  // Map of week → injury label for this season so the row where the player
  // got hurt visibly carries that context. Without this the player looks
  // like they "played with a torn ACL" because the badge sits below the log
  // with no tie-back to a specific game.
  const injuryByWeek = {};
  for (const h of (p.injuryHistory || [])) {
    if (h.season !== franchise.season) continue;
    if (h.week == null) continue;
    injuryByWeek[h.week] = h;
  }
  // Detect if older games were trimmed: look up season GP from seasonStats
  let seasonGP = 0;
  for (const ts of Object.values(franchise.seasonStats || {})) {
    if (ts && ts[p.name]) { seasonGP = +(ts[p.name].gp || 0); break; }
  }
  const missing = Math.max(0, seasonGP - games.length);
  const missingNote = missing > 0
    ? (missing === 1
        ? `<div style="font-size:.58rem;color:var(--gray);font-style:italic;margin-bottom:.3rem">1 game not shown (line-level stats unavailable — season totals reflect it).</div>`
        : `<div style="font-size:.58rem;color:var(--gray);font-style:italic;margin-bottom:.3rem">${games.length} of ${seasonGP} games shown — older per-play data trimmed for storage.</div>`)
    : "";
  // If the player suited up for multiple teams this season (mid-season
  // trade), surface a "TM" column so the lineage is visible.
  const distinctTeams = new Set(games.map(x => x.teamId));
  const showTM = distinctTeams.size > 1;
  // Snap %: per game, compare the player's snaps to their team's snaps.
  // Skip the column if no game logged any snap data (legacy saves before
  // the per-snap counter was wired) — keeps the table tidy on old data.
  const hasSnaps = games.some(({ line }) => (line.snaps || 0) > 0);
  const snapHeader = hasSnaps ? `<th>SNAP%</th>` : "";
  const snapCell = ({ line, g, teamId }) => {
    if (!hasSnaps) return "";
    const side = teamId === g.homeId ? "home" : "away";
    const teamSnaps = g.stats?.[side]?.team?.snaps || 0;
    const pct = teamSnaps ? (line.snaps || 0) / teamSnaps * 100 : 0;
    const color = pct >= 85 ? "var(--gold)" : pct >= 60 ? "var(--white)" : "var(--gray)";
    return `<td style="color:${color}">${pct ? pct.toFixed(0) + "%" : "—"}</td>`;
  };
  const tmCell = (teamId) => {
    if (!showTM) return "";
    const t = getTeam(teamId);
    return `<td style="font-weight:800;color:${t?.primary || "var(--gray)"};font-size:.62rem">${t ? _bspnLiveAbbr(t) : "—"}</td>`;
  };
  const tmHeader = showTM ? `<th>TM</th>` : "";
  // Render columns per position
  let headers = [], rowCells = [];
  if (pos === "QB") {
    const hasQBRush = games.some(({ line }) => (line.rush_att || 0) > 0);
    const hasSk    = games.some(({ line }) => (line.sacks_taken || 0) > 0);
    headers = ["WK", ...(showTM ? ["TM"] : []), "OPP","RES","CMP/ATT","YDS","TD","INT","LONG","RTG",
               ...(hasSk ? ["SK"] : []),
               ...(hasQBRush ? ["CAR","RYD","RTD"] : []),
               ...(hasSnaps ? ["SNAP%"] : []),
               "FPTS"];
    rowCells = games.map((row) => {
      const { g, line, teamId, oppId, isPlayoff, roundLabel } = row;
      const opp = getTeam(oppId), my = getTeam(teamId);
      const myHome = teamId === g.homeId;
      const myScore = myHome ? g.homeScore : g.awayScore;
      const themScore = myHome ? g.awayScore : g.homeScore;
      const res = myScore > themScore ? "W" : myScore < themScore ? "L" : "T";
      const resColor = res === "W" ? "var(--green-lt)" : res === "L" ? "#c08080" : "var(--gray)";
      const cmp = +line.pass_comp || 0, att = +line.pass_att || 0;
      const fpts = _fantasyPPR(line, pos);
      return `<tr>
        <td${isPlayoff?' style="color:var(--gold);font-weight:800"':""}>${isPlayoff?(roundLabel||"PO"):`W${g.week}`}${injuryByWeek[g.week] ? ` <span style="color:#ff7070" title="${injuryByWeek[g.week].label} suffered in this game${injuryByWeek[g.week].catastrophic?" (season-ending)":""} — stats above are pre-injury">${injuryByWeek[g.week].catastrophic?"🚑":"🩹"}</span>` : ""}</td>
        ${tmCell(teamId)}
        <td>${myHome ? "vs" : "@"} <span style="color:${opp?.primary}">${(opp?.name||"").slice(0,4)}</span></td>
        <td style="color:${resColor};font-weight:700">${res} ${myScore}-${themScore}</td>
        <td>${cmp}/${att}</td>
        <td>${line.pass_yds||0}</td>
        <td>${line.pass_td||0}</td>
        <td>${line.pass_int||0}</td>
        <td>${line.pass_long||0}</td>
        <td>${_passerRating(cmp, att, line.pass_yds||0, line.pass_td||0, line.pass_int||0)}</td>
        ${hasSk ? `<td>${line.sacks_taken||0}</td>` : ""}
        ${hasQBRush ? `<td>${line.rush_att||0}</td><td>${line.rush_yds||0}</td><td>${line.rush_td||0}</td>` : ""}
        ${snapCell(row)}
        <td style="color:var(--gold);font-weight:700">${fpts.toFixed(1)}</td>
      </tr>`;
    });
  } else if (pos === "RB") {
    const hasBT  = games.some(({ line }) => (line.broken_tackles || 0) > 0);
    const hasRec = games.some(({ line }) => (line.rec || 0) > 0 || (line.rec_td || 0) > 0);
    headers = ["WK", ...(showTM ? ["TM"] : []), "OPP","RES","CAR","YDS","YPC","TD","LONG",
               ...(hasBT?["BT"]:[]),
               ...(hasRec?["REC","REC YDS","REC TD"]:[]),
               ...(hasSnaps ? ["SNAP%"] : []),
               "FPTS"];
    rowCells = games.map((row) => {
      const { g, line, teamId, oppId, isPlayoff, roundLabel } = row;
      const opp = getTeam(oppId);
      const myHome = teamId === g.homeId;
      const myScore = myHome ? g.homeScore : g.awayScore;
      const themScore = myHome ? g.awayScore : g.homeScore;
      const res = myScore > themScore ? "W" : myScore < themScore ? "L" : "T";
      const resColor = res === "W" ? "var(--green-lt)" : res === "L" ? "#c08080" : "var(--gray)";
      const car = +line.rush_att || 0, yds = +line.rush_yds || 0;
      const bt = line.broken_tackles || 0;
      const fpts = _fantasyPPR(line, pos);
      return `<tr>
        <td${isPlayoff?' style="color:var(--gold);font-weight:800"':""}>${isPlayoff?(roundLabel||"PO"):`W${g.week}`}${injuryByWeek[g.week] ? ` <span style="color:#ff7070" title="${injuryByWeek[g.week].label} suffered in this game${injuryByWeek[g.week].catastrophic?" (season-ending)":""} — stats above are pre-injury">${injuryByWeek[g.week].catastrophic?"🚑":"🩹"}</span>` : ""}</td>
        ${tmCell(teamId)}
        <td>${myHome ? "vs" : "@"} <span style="color:${opp?.primary}">${(opp?.name||"").slice(0,4)}</span></td>
        <td style="color:${resColor};font-weight:700">${res} ${myScore}-${themScore}</td>
        <td>${car}</td>
        <td>${yds}</td>
        <td>${car ? (yds/car).toFixed(1) : "—"}</td>
        <td>${line.rush_td||0}</td>
        <td>${line.rush_long||0}</td>
        ${hasBT ? `<td style="color:${bt>0?"var(--green-lt)":"var(--gray)"}">${bt}</td>` : ""}
        ${hasRec ? `<td>${line.rec||0}</td><td>${line.rec_yds||0}</td><td style="color:${(line.rec_td||0)>0?"var(--green-lt)":""}">${line.rec_td||0}</td>` : ""}
        ${snapCell(row)}
        <td style="color:var(--gold);font-weight:700">${fpts.toFixed(1)}</td>
      </tr>`;
    });
  } else if (pos === "WR" || pos === "TE") {
    headers = ["WK", ...(showTM ? ["TM"] : []), "OPP","RES","REC","TGT","YDS","YPR","TD","LONG",
               ...(hasSnaps ? ["SNAP%"] : []),
               "FPTS"];
    rowCells = games.map((row) => {
      const { g, line, teamId, oppId, isPlayoff, roundLabel } = row;
      const opp = getTeam(oppId);
      const myHome = teamId === g.homeId;
      const myScore = myHome ? g.homeScore : g.awayScore;
      const themScore = myHome ? g.awayScore : g.homeScore;
      const res = myScore > themScore ? "W" : myScore < themScore ? "L" : "T";
      const resColor = res === "W" ? "var(--green-lt)" : res === "L" ? "#c08080" : "var(--gray)";
      const rec = +line.rec || 0, yds = +line.rec_yds || 0;
      const fpts = _fantasyPPR(line, pos);
      return `<tr>
        <td${isPlayoff?' style="color:var(--gold);font-weight:800"':""}>${isPlayoff?(roundLabel||"PO"):`W${g.week}`}${injuryByWeek[g.week] ? ` <span style="color:#ff7070" title="${injuryByWeek[g.week].label} suffered in this game${injuryByWeek[g.week].catastrophic?" (season-ending)":""} — stats above are pre-injury">${injuryByWeek[g.week].catastrophic?"🚑":"🩹"}</span>` : ""}</td>
        ${tmCell(teamId)}
        <td>${myHome ? "vs" : "@"} <span style="color:${opp?.primary}">${(opp?.name||"").slice(0,4)}</span></td>
        <td style="color:${resColor};font-weight:700">${res} ${myScore}-${themScore}</td>
        <td>${rec}</td>
        <td>${line.rec_tgt||0}</td>
        <td>${yds}</td>
        <td>${rec ? (yds/rec).toFixed(1) : "—"}</td>
        <td>${line.rec_td||0}</td>
        <td>${line.rec_long||0}</td>
        ${snapCell(row)}
        <td style="color:var(--gold);font-weight:700">${fpts.toFixed(1)}</td>
      </tr>`;
    });
  } else if (pos === "DL" || pos === "LB" || pos === "CB" || pos === "S") {
    headers = ["WK", ...(showTM ? ["TM"] : []), "OPP","RES","TKL","MISS","SK","INT","PD","FF",
               ...(hasSnaps ? ["SNAP%"] : []),
               "FPTS"];
    rowCells = games.map((row) => {
      const { g, line, teamId, oppId, isPlayoff, roundLabel } = row;
      const opp = getTeam(oppId);
      const myHome = teamId === g.homeId;
      const myScore = myHome ? g.homeScore : g.awayScore;
      const themScore = myHome ? g.awayScore : g.homeScore;
      const res = myScore > themScore ? "W" : myScore < themScore ? "L" : "T";
      const resColor = res === "W" ? "var(--green-lt)" : res === "L" ? "#c08080" : "var(--gray)";
      const fpts = _fantasyPPR(line, pos);
      const miss = line.missed_tkl || 0;
      return `<tr>
        <td${isPlayoff?' style="color:var(--gold);font-weight:800"':""}>${isPlayoff?(roundLabel||"PO"):`W${g.week}`}${injuryByWeek[g.week] ? ` <span style="color:#ff7070" title="${injuryByWeek[g.week].label} suffered in this game${injuryByWeek[g.week].catastrophic?" (season-ending)":""} — stats above are pre-injury">${injuryByWeek[g.week].catastrophic?"🚑":"🩹"}</span>` : ""}</td>
        ${tmCell(teamId)}
        <td>${myHome ? "vs" : "@"} <span style="color:${opp?.primary}">${(opp?.name||"").slice(0,4)}</span></td>
        <td style="color:${resColor};font-weight:700">${res} ${myScore}-${themScore}</td>
        <td>${line.tkl||0}</td>
        <td style="color:${miss > 0 ? "#c08080" : "var(--gray)"}">${miss}</td>
        <td>${line.sk||0}</td>
        <td>${line.int_made||0}</td>
        <td>${line.pd||0}</td>
        <td>${line.ff||0}</td>
        ${snapCell(row)}
        <td style="color:var(--gold);font-weight:700">${fpts.toFixed(1)}</td>
      </tr>`;
    });
  } else if (pos === "K") {
    headers = ["WK", ...(showTM ? ["TM"] : []), "OPP","RES","FG","LONG","XP","FPTS"];
    rowCells = games.map(({ g, line, teamId, oppId, isPlayoff, roundLabel }) => {
      const opp = getTeam(oppId);
      const myHome = teamId === g.homeId;
      const myScore = myHome ? g.homeScore : g.awayScore;
      const themScore = myHome ? g.awayScore : g.homeScore;
      const res = myScore > themScore ? "W" : myScore < themScore ? "L" : "T";
      const resColor = res === "W" ? "var(--green-lt)" : res === "L" ? "#c08080" : "var(--gray)";
      const fpts = _fantasyPPR(line, pos);
      return `<tr>
        <td${isPlayoff?' style="color:var(--gold);font-weight:800"':""}>${isPlayoff?(roundLabel||"PO"):`W${g.week}`}${injuryByWeek[g.week] ? ` <span style="color:#ff7070" title="${injuryByWeek[g.week].label} suffered in this game${injuryByWeek[g.week].catastrophic?" (season-ending)":""} — stats above are pre-injury">${injuryByWeek[g.week].catastrophic?"🚑":"🩹"}</span>` : ""}</td>
        ${tmCell(teamId)}
        <td>${myHome ? "vs" : "@"} <span style="color:${opp?.primary}">${(opp?.name||"").slice(0,4)}</span></td>
        <td style="color:${resColor};font-weight:700">${res} ${myScore}-${themScore}</td>
        <td>${line.fg_made||0}/${line.fg_att||0}</td>
        <td>${line.fg_long||0}</td>
        <td>${line.xp_made||0}/${line.xp_att||0}</td>
        <td style="color:var(--gold);font-weight:700">${fpts.toFixed(1)}</td>
      </tr>`;
    });
  } else if (pos === "OL") {
    headers = ["WK", ...(showTM ? ["TM"] : []), "OPP","RES","PNK","SA","PEN"];
    rowCells = games.map(({ g, line, teamId, oppId, isPlayoff, roundLabel }) => {
      const opp = getTeam(oppId);
      const myHome = teamId === g.homeId;
      const myScore = myHome ? g.homeScore : g.awayScore;
      const themScore = myHome ? g.awayScore : g.homeScore;
      const res = myScore > themScore ? "W" : myScore < themScore ? "L" : "T";
      const resColor = res === "W" ? "var(--green-lt)" : res === "L" ? "#c08080" : "var(--gray)";
      return `<tr>
        <td${isPlayoff?' style="color:var(--gold);font-weight:800"':""}>${isPlayoff?(roundLabel||"PO"):`W${g.week}`}${injuryByWeek[g.week] ? ` <span style="color:#ff7070" title="${injuryByWeek[g.week].label} suffered in this game${injuryByWeek[g.week].catastrophic?" (season-ending)":""} — stats above are pre-injury">${injuryByWeek[g.week].catastrophic?"🚑":"🩹"}</span>` : ""}</td>
        ${tmCell(teamId)}
        <td>${myHome ? "vs" : "@"} <span style="color:${opp?.primary}">${(opp?.name||"").slice(0,4)}</span></td>
        <td style="color:${resColor};font-weight:700">${res} ${myScore}-${themScore}</td>
        <td>${line.pancakes||0}</td>
        <td style="color:${(line.sacks_allowed||0)>0?"#c08080":"inherit"}">${line.sacks_allowed||0}</td>
        <td>${line.penalties||0}</td>
      </tr>`;
    });
  } else {
    return "";
  }
  return `<div class="frn-pcard-section">
    <div class="frn-card-title">GAME LOG · ${games.length} GAME${games.length===1?"":"S"}</div>
    ${missingNote}
    <div style="overflow-x:auto">
      <table class="frn-gamelog-table">
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${rowCells.join("")}</tbody>
      </table>
    </div>
  </div>`;
}

// Compact strip showing the player's last 3 games with colour-coded FPTS pills.
function _buildRecentFormStrip(p) {
  if (!franchise?.schedule) return "";
  const pos = p.position;
  const played = [];
  for (const g of franchise.schedule) {
    if (!g.played || !g.stats) continue;
    const line = g.stats.home?.players?.[p.name] || g.stats.away?.players?.[p.name];
    if (!line) continue;
    played.push({ week: g.week, line, oppId: g.stats.home?.players?.[p.name] ? g.awayId : g.homeId });
  }
  if (!played.length) return "";
  played.sort((a, b) => b.week - a.week);
  const recent = played.slice(0, 3);
  // Season average FPTS (all played games we have stats for)
  const allFpts = played.map(x => _fantasyPPR(x.line, pos));
  const avgFpts = allFpts.length ? allFpts.reduce((s, v) => s + v, 0) / allFpts.length : 0;
  const pills = recent.map(({ week, line, oppId }) => {
    const fpts = _fantasyPPR(line, pos);
    const opp = getTeam(oppId);
    const oppAbbr = opp ? (opp.abbr || opp.name.slice(0, 4)) : "?";
    let color = "var(--gray)";
    if (avgFpts > 0) {
      if (fpts >= avgFpts * 1.2) color = "var(--green-lt)";
      else if (fpts >= avgFpts * 0.8) color = "var(--gold)";
      else color = "#c08080";
    } else {
      if (fpts >= 15) color = "var(--green-lt)";
      else if (fpts >= 8) color = "var(--gold)";
      else color = "#c08080";
    }
    let secondary = "";
    if (pos === "QB") {
      const rating = _passerRating(+line.pass_comp||0, +line.pass_att||0, +line.pass_yds||0, +line.pass_td||0, +line.pass_int||0);
      secondary = ` · RTG ${rating}`;
    }
    return `<div style="display:inline-flex;align-items:center;gap:.3rem;background:rgba(255,255,255,.05);border:1px solid var(--border);border-radius:.3rem;padding:.15rem .45rem;font-size:.62rem;white-space:nowrap">
      <span style="color:var(--gray)">W${week} vs ${oppAbbr}</span>
      <span style="color:${color};font-weight:700">${fpts.toFixed(1)} pts${secondary}</span>
    </div>`;
  }).join("");
  return `<div class="frn-pcard-section">
    <div class="frn-card-title" style="margin-bottom:.3rem">LAST 3 GAMES</div>
    <div style="display:flex;flex-wrap:wrap;gap:.35rem">${pills}</div>
  </div>`;
}

function _buildContractBreakdownBlock(p) {
  const c = p.contract;
  if (!c || !c.aav) return "";
  const years      = c.years || 1;
  const remaining  = c.remaining || 1;
  const proration  = c.bonusProration || 0;
  const bases      = c.baseSalaries || Array(years).fill(+(c.aav - proration).toFixed(1));
  const curYrIdx   = Math.max(0, years - remaining);
  const guaranteed = c.guaranteedYears || 0;
  const structLabel = c.structure === "FRONTLOADED" ? "⬆ Front-loaded" :
                      c.structure === "BACKLOADED"  ? "⬇ Back-loaded"  : "— Balanced";
  const structColor = c.structure === "FRONTLOADED" ? "var(--green-lt)" :
                      c.structure === "BACKLOADED"  ? "#ff9090"         : "var(--gray)";

  // Build year rows
  const rows = bases.map((base, i) => {
    const capHit    = Math.round((base + proration) * 10) / 10;
    const isCur     = i === curYrIdx;
    const isPast    = i < curYrIdx;
    const isGuarant = i < guaranteed;
    // Dead cap = proration × years left after this cut point
    const deadCap   = proration > 0
      ? Math.round(proration * (Math.min(years, curYrIdx + (years - curYrIdx)) - i) * 10) / 10
      : 0;
    // Actually dead cap if cut at start of this year = proration × remaining years of bonus
    const prorationYears = Math.min(years, 5);
    const prorationRemaining = Math.max(0, prorationYears - i);
    const deadIfCut = Math.round(proration * prorationRemaining * 10) / 10;

    const rowBg = isCur ? "rgba(200,169,0,.12)" : isPast ? "rgba(255,255,255,.02)" : "";
    const textColor = isPast ? "var(--gray)" : isCur ? "var(--white)" : "rgba(255,255,255,.85)";
    const hitColor = isCur ? "var(--gold)" : isPast ? "var(--gray)" : "rgba(255,255,255,.85)";
    return `<tr style="background:${rowBg}">
      <td style="color:${textColor};font-size:.64rem;white-space:nowrap">
        Yr ${i+1}${isCur ? " <span style=\"color:var(--gold);font-size:.55rem\">◀ NOW</span>" : isPast ? " <span style=\"color:var(--gray);font-size:.55rem\">✓</span>" : ""}
        ${isGuarant ? "<span style=\"color:var(--green-lt);font-size:.52rem;margin-left:.2rem\">GTD</span>" : ""}
      </td>
      <td style="color:${textColor};font-size:.64rem;text-align:right">$${base.toFixed(1)}M</td>
      <td style="color:${proration>0?"var(--gold-lt)":"var(--gray)"};font-size:.64rem;text-align:right">
        ${proration > 0 ? `+$${proration.toFixed(1)}M` : "—"}
      </td>
      <td style="color:${hitColor};font-weight:${isCur?"700":"400"};font-size:.64rem;text-align:right">
        $${capHit.toFixed(1)}M
      </td>
      <td style="color:${deadIfCut > 0 ? "#ff9090" : "var(--gray)"};font-size:.62rem;text-align:right">
        ${deadIfCut > 0.05 ? `☠ $${deadIfCut.toFixed(1)}M` : "—"}
      </td>
    </tr>`;
  }).join("");

  const totalGuaranteed = Math.round(c.guaranteedAAV * (c.years||1) * 10) / 10;
  const totalRemaining  = Math.round(c.aav * remaining * 10) / 10;

  return `<div class="frn-pcard-section" style="margin-top:.6rem">
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.35rem;flex-wrap:wrap">
      <div class="frn-card-title">📋 CONTRACT BREAKDOWN</div>
      <span style="color:${structColor};font-size:.6rem;font-weight:700">${structLabel}</span>
      ${c.tradeKicker > 0 ? `<span style="color:var(--gold);font-size:.6rem" title="One-time cap hit if acquired via trade">⚡ Trade kicker $${c.tradeKicker.toFixed(1)}M</span>` : ""}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:.65rem">
      <thead>
        <tr style="border-bottom:1px solid var(--border)">
          <th style="text-align:left;color:var(--gray);font-weight:600;padding:.15rem .2rem;font-size:.58rem">YR</th>
          <th style="text-align:right;color:var(--gray);font-weight:600;padding:.15rem .2rem;font-size:.58rem">BASE</th>
          <th style="text-align:right;color:var(--gray);font-weight:600;padding:.15rem .2rem;font-size:.58rem">BONUS</th>
          <th style="text-align:right;color:var(--gray);font-weight:600;padding:.15rem .2rem;font-size:.58rem">CAP HIT</th>
          <th style="text-align:right;color:var(--gray);font-weight:600;padding:.15rem .2rem;font-size:.58rem">DEAD (IF CUT)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="display:flex;gap:1rem;margin-top:.4rem;flex-wrap:wrap;font-size:.6rem;color:var(--gray)">
      <span>Remaining: <b style="color:var(--white)">$${totalRemaining.toFixed(1)}M</b></span>
      ${c.signingBonus > 0 ? `<span>Sign bonus: <b style="color:var(--gold-lt)">$${c.signingBonus.toFixed(1)}M</b> (÷${Math.min(c.years||1,5)}yr)</span>` : ""}
      ${guaranteed > 0 ? `<span>Guaranteed yrs: <b style="color:var(--green-lt)">${guaranteed}</b></span>` : ""}
    </div>
  </div>`;
}

function _buildAccoladesBanner(p) {
  const chips = [];
  const isHof = (franchise.hallOfFame || []).some(h => h.name === p.name);
  const allAcc  = (p.careerHistory || []).flatMap(h => h.accolades || []);
  const sbMvpCount = allAcc.filter(a => a === "Super Bowl MVP").length;
  const pureRings  = allAcc.filter(a => a === "Super Bowl").length;
  const ap1Count   = allAcc.filter(a => a === "All-Pro").length;
  const ap2Count   = allAcc.filter(a => a === "All-Pro (2nd)").length;
  const purePB     = Math.max(0, (p.proBowls || 0) - ap1Count - ap2Count);
  if (isHof)             chips.push(["🏛", "HOF",                    "var(--gold)"]);
  if ((p.mvps||0) > 0)  chips.push(["🥇", `${p.mvps}× MVP`,         "var(--gold)"]);
  if ((p.opoys||0) > 0) chips.push(["⚡", `${p.opoys}× OPOY`,       "var(--gold)"]);
  if ((p.dpoys||0) > 0) chips.push(["🛡", `${p.dpoys}× DPOY`,       "var(--gold)"]);
  if ((p.roys||0) > 0)  chips.push(["🌟", "ROY",                     "var(--gold-lt)"]);
  if (sbMvpCount > 0)   chips.push(["🏆", `${sbMvpCount}× SB MVP`,  "var(--gold)"]);
  if (pureRings > 0)    chips.push(["💍", `${pureRings}× Ring`,      "var(--gold)"]);
  if (ap1Count > 0)     chips.push(["⭐", `${ap1Count}× AP 1st`,     "var(--gold)"]);
  if (ap2Count > 0)     chips.push(["✦",  `${ap2Count}× AP 2nd`,     "var(--gold-lt)"]);
  if (purePB > 0)       chips.push(["🎳", `${purePB}× Pro Bowl`,     "var(--blgray)"]);
  if (!chips.length) return "";
  return `<div style="display:flex;flex-wrap:wrap;gap:.25rem;margin-top:.3rem">
    ${chips.map(([icon, text, color]) =>
      `<span style="font-size:.58rem;padding:.1rem .4rem;border-radius:4px;background:rgba(255,200,0,.12);color:${color};border:1px solid rgba(255,200,0,.25);white-space:nowrap">${icon} ${text}</span>`
    ).join("")}
  </div>`;
}

function _buildPlayerDetailPanel(p) {
  const g    = scoutGrade(p);
  const gL   = gradeLabel(g);
  const cmb  = combineMeasurables(p);
  const aav  = p.contract?.aav || 0;
  const yrs  = p.contract?.remaining || 0;
  const flav = p.flavor?.desc || "";
  const owned = _isOwnedPlayer(p);

  // Combine measurables — position-aware (QBs skip bench, OL skip 3-cone,
  // K/P see kick-specific block instead). Each cell renders the test
  // value followed by a position-relative letter grade chip (A+/A/B/C/D).
  const isKicker = p.position === "K" || p.position === "P";
  const cg = (typeof combineGrade === "function") ? combineGrade(p) : null;
  const gradeColor = (g) => g === "A+" ? "var(--green-lt)" : g === "A" ? "var(--green-lt)"
                    : g === "B" ? "var(--gold)" : g === "C" ? "#e8a000" : "#c08080";
  const gradeChip = (g) => g ? `<span style="font-size:.55rem;font-weight:800;padding:.05rem .25rem;border-radius:2px;background:rgba(0,0,0,.3);color:${gradeColor(g)};margin-left:.25rem">${g}</span>` : "";
  const ftIn = `${Math.floor(cmb.heightIn/12)}'${cmb.heightIn%12}"`;
  const combineHtml = isKicker
    ? `<div class="frn-combine-grid">
         <div><span class="frn-meta-label">HT/WT</span> ${ftIn} / ${cmb.weightLbs}lb</div>
         <div><span class="frn-meta-label">LEG</span> ${Math.round(70 + (cmb.kpw - 50) * 0.45)} yds</div>
       </div>`
    : (() => {
        const tests = (typeof COMBINE_TESTS_BY_POS === "object" ? COMBINE_TESTS_BY_POS[p.position] : null) || {};
        const cells = [];
        cells.push(`<div><span class="frn-meta-label">HT/WT</span> ${ftIn} / ${cmb.weightLbs}lb</div>`);
        if (tests.fortyTime)   cells.push(`<div><span class="frn-meta-label">40-YD</span> ${cmb.fortyTime}s${gradeChip(cg?.grades?.fortyTime)}</div>`);
        if (tests.benchReps)   cells.push(`<div><span class="frn-meta-label">BENCH</span> ${cmb.benchReps}${gradeChip(cg?.grades?.benchReps)}</div>`);
        if (tests.verticalIn)  cells.push(`<div><span class="frn-meta-label">VERT</span> ${cmb.verticalIn}"${gradeChip(cg?.grades?.verticalIn)}</div>`);
        if (tests.broadJumpIn) cells.push(`<div><span class="frn-meta-label">BROAD</span> ${cmb.broadJumpIn}"${gradeChip(cg?.grades?.broadJumpIn)}</div>`);
        if (tests.coneTime)    cells.push(`<div><span class="frn-meta-label">CONE</span> ${cmb.coneTime}s${gradeChip(cg?.grades?.coneTime)}</div>`);
        if (tests.shuttleTime) cells.push(`<div><span class="frn-meta-label">SHUTTLE</span> ${cmb.shuttleTime}s${gradeChip(cg?.grades?.shuttleTime)}</div>`);
        if (tests.handSizeIn && cmb.handSizeIn) cells.push(`<div><span class="frn-meta-label">HAND</span> ${cmb.handSizeIn}"</div>`);
        if (tests.armLengthIn && cmb.armLengthIn) cells.push(`<div><span class="frn-meta-label">ARM</span> ${cmb.armLengthIn}"</div>`);
        return `<div class="frn-combine-grid">${cells.join("")}</div>`;
      })();

  const overallGrade = cg?.overall;
  const overallChip = overallGrade ? `<span style="font-size:.6rem;font-weight:800;padding:.1rem .4rem;border-radius:2px;background:rgba(0,0,0,.4);color:${gradeColor(overallGrade)};margin-left:.4rem">${overallGrade}</span>` : "";
  const combinePanel = `<div class="frn-pcard-section">
    <div class="frn-card-title">COMBINE${overallChip}</div>
    ${combineHtml}
  </div>`;

  const potTag = potentialTag(p, { known: _isKnownPlayer(p) });
  const archBlock = _buildArchetypeBlock(p);
  const seasonBlock = _buildSeasonStatsBlock(p);
  const recentFormStrip = _buildRecentFormStrip(p);
  const streaksBlock = _buildStreaksBlock(p);
  const gameLogBlock = _buildGameLogBlock(p);
  const contractBlock = _buildContractBreakdownBlock(p);
  const ratingsPanel = owned ? _buildOwnedStatsPanel(p) : "";

  // Right-column content: owned → raw ratings, otherwise scout note.
  const rightPanel = owned ? ratingsPanel : `<div class="frn-pcard-section">
    <div class="frn-card-title">SCOUTING NOTE</div>
    <div style="font-size:.68rem;color:var(--gray);line-height:1.4">
      Internal ratings are hidden for opposing players. Run a joint
      practice against this team to sharpen the
      grade noise from ±8 to ±2.
    </div>
  </div>`;

  return `<div class="frn-player-card">
    <div class="frn-player-card-head" style="display:flex;gap:.9rem;align-items:flex-start;padding-right:2.5rem">
      ${_playerPortrait(p, 110)}
      <div style="flex:1;min-width:0">
        ${(() => {
          const tier = (typeof playerLegendTier === "function") ? playerLegendTier(p) : null;
          const isNickOnly = p.goesByNicknameOnly && p.nickname;
          const displayName = isNickOnly ? p.nickname : p.name;
          // Legal name subtitle for single-name stars (Pelé / Madonna).
          // Builds from firstName/lastName when stored; falls back to
          // p.name if it differs from the nickname (legacy saves where
          // p.name was the legal name before the rewrite).
          let legalName = null;
          if (isNickOnly) {
            if (p.firstName && p.lastName) {
              legalName = p.middleName
                ? `${p.firstName} ${p.middleName} ${p.lastName}`
                : `${p.firstName} ${p.lastName}`;
            } else if (p.name && p.name !== p.nickname) {
              legalName = p.name;
            }
          }
          const legalSub = legalName
            ? `<div style="font-size:.6rem;color:var(--gray);letter-spacing:.5px;margin-top:.1rem;font-style:italic">né ${legalName}</div>`
            : "";
          // Lazy backfill: stamp nicknameOrigin for any player who has a
          // nickname but predates the origin stamp. Stable per player via
          // name hash, so legacy saves get consistent lore across reloads.
          if (p.nickname && !p.nicknameOrigin && typeof _pickNicknameOrigin === "function") {
            const lore = _pickNicknameOrigin(p);
            if (lore) p.nicknameOrigin = lore;
          }
          const originSub = p.nickname && p.nicknameOrigin
            ? `<div style="font-size:.62rem;color:var(--gold-lt);letter-spacing:.3px;margin-top:.25rem;font-style:italic;line-height:1.3;max-width:42ch">“${p.nicknameOrigin}”</div>`
            : "";
          if (!tier) {
            return `<div style="font-size:1.15rem;font-weight:900">${displayName}</div>${legalSub}${originSub}`;
          }
          return `<div class="frn-pname-hero frn-pname-hero-t-${tier.tier}" title="${tier.label}">
            <span class="frn-pname-hero-glyph" aria-hidden="true">${tier.icon}</span>
            <span class="frn-pname-hero-name">${displayName}</span>
            <span class="frn-pname-hero-tag">${tier.label}</span>
          </div>${legalSub}${originSub}`;
        })()}
        ${_buildAccoladesBanner(p)}
        <div style="color:var(--gray);font-size:.72rem;margin-top:.2rem">
          #${jerseyForPlayer(p) || "—"} · ${p.position} · Age ${p.age || "?"}${p.height?` · ${formatHeight(p.height)}, ${p.weight||"?"} lbs`:""}
        </div>
        <div style="color:var(--gray);font-size:.65rem;margin-top:.1rem">${draftStr(p)} · Career ${careerEarningsStr(p)}</div>
        ${p.faStory && !_isOwnedPlayer(p) ? `<div style="margin-top:.2rem;font-size:.62rem;color:var(--gold-lt);font-style:italic">"${p.faStory}"</div>` : ""}
        ${potTag ? `<div style="margin-top:.2rem;font-size:.62rem;color:var(--gold-lt);font-weight:700">${potTag}</div>` : ""}
        ${(() => {
          if (typeof HiddenOracle !== "object") return "";
          const dt = HiddenOracle.read.driveTag?.(p);
          const dr = HiddenOracle.read.durabilityTag?.(p);
          const ct = HiddenOracle.read.clutchTag?.(p);
          const parts = [];
          if (dt) parts.push(`<span style="color:${dt.color}">${dt.label}</span>`);
          if (dr) parts.push(`<span style="color:${dr.color}">${dr.label}</span>`);
          if (ct) parts.push(`<span style="color:${ct.color}" title="Big-moment read — ${ct.confidence}${ct.sample ? ` · ${ct.sample} clutch snaps on tape` : ""}">${ct.label}${ct.confidence === "Unproven" ? " (?)" : ""}</span>`);
          return parts.length
            ? `<div style="margin-top:.18rem;font-size:.6rem;font-weight:600">${parts.join(" · ")}</div>`
            : "";
        })()}
      </div>
      <div style="text-align:right;flex-shrink:0">
        ${(() => {
          if (owned) {
            // Owned players show the exact OVR — staff knows their guys.
            // Letter grade follows underneath as a quick tier read.
            const ovr = p.overall || 0;
            const ovrColor = ovr >= 90 ? "#f5c542" : ovr >= 85 ? "#e8a000" : ovr >= 78 ? "#c8c8c8" : ovr >= 70 ? "#9b9b9b" : "#7a7a7a";
            return `<div style="color:var(--gray);font-size:.55rem;letter-spacing:.5px">OVR</div>
              <div style="font-size:1.9rem;font-weight:900;color:${ovrColor};line-height:1;font-family:'Bebas Neue','Anton',sans-serif"
                title="Real OVR — your staff knows your roster precisely">${ovr}</div>
              <div style="color:var(--gray);font-size:.6rem;margin-top:.1rem">${gL}</div>`;
          }
          return `<div style="color:var(--gray);font-size:.55rem;letter-spacing:.5px">GRADE</div>
            <div style="font-size:1.6rem;font-weight:900;color:var(--gold);line-height:1"
              title="Scout grade — observers' estimate, not exact ability">${gL}</div>`;
        })()}
        <div style="color:var(--gold);font-size:.85rem;font-weight:700;margin-top:.4rem">$${aav.toFixed(1)}M/yr</div>
        <div style="color:var(--gray);font-size:.62rem">${yrs}yr left</div>
      </div>
    </div>
    ${archBlock ? `<div style="margin:.6rem 0">${archBlock}</div>` : ""}
    ${p.injury ? (() => {
      const onset = _currentInjuryOnset(p);
      const cat = !!p.injury._careerEnding ? "career" : !!p.injury._catastrophic ? "cata" : "norm";
      const stripe = cat === "career" ? "#7b2020" : cat === "cata" ? "#a72424" : "#c87a00";
      const bg     = cat === "career" ? "rgba(123,32,32,.18)" : cat === "cata" ? "rgba(167,36,36,.16)" : "rgba(200,122,0,.14)";
      const icon   = cat === "career" ? "💔" : cat === "cata" ? "🚑" : "🩹";
      const sevTag = cat === "career" ? "CAREER-ENDING" : cat === "cata" ? "SEASON-ENDING" : `${p.injury.weeksRemaining}W OUT`;
      const onsetTxt = onset?.week ? `Onset W${onset.week}` : "";
      const cause   = p.injury.cause === "non_contact" ? "non-contact"
                    : p.injury.cause === "big_hit" ? "big-hit collision"
                    : p.injury.cause === "sack" ? "sack"
                    : p.injury.cause || "contact";
      const ovrHit  = p.injury._returnOvrPenalty || p.injury._ovrPenalty
                    || (cat !== "norm" ? "-6" : null);
      return `<div style="margin:.55rem 0;padding:.5rem .7rem;background:${bg};border-left:4px solid ${stripe};border-radius:3px;display:flex;align-items:center;gap:.7rem;flex-wrap:wrap">
        <div style="font-size:1.5rem;line-height:1">${icon}</div>
        <div style="flex:1;min-width:200px">
          <div style="font-size:.85rem;font-weight:900;color:#ffd1d1;letter-spacing:.5px">
            INJURED — ${p.injury.label.toUpperCase()}
          </div>
          <div style="font-size:.62rem;color:#ffb0b0;margin-top:.1rem">
            ${sevTag}${onsetTxt?` · ${onsetTxt}`:""} · ${cause}${ovrHit?` · ${ovrHit} OVR on return`:""}
          </div>
        </div>
        <div style="font-size:1.2rem;font-weight:900;color:#ffd1d1;text-align:right">
          ${p.injury._careerEnding ? "DONE" : `${p.injury.weeksRemaining}w`}
        </div>
      </div>`;
    })() : ""}
    ${(() => {
      // Locker-room fallout banner — surfaces consequences of an ignored
      // extension demand so the user remembers the cost. Only shown for
      // owned players (we know our own roster's state).
      if (!owned) return "";
      const ignSeason = p._ignoredDemandSeason;
      const devFreezeUntil = p._devFreezeUntilSeason;
      const tradeReq = p.tradeRequested;
      const flightRisk = p.flightRisk;
      if (ignSeason == null && !tradeReq && !flightRisk && devFreezeUntil == null) return "";
      const parts = [];
      if (ignSeason != null) parts.push(`ignored extension demand · S${ignSeason}`);
      if (p._ignoreOvrPenalty) parts.push(`-${p._ignoreOvrPenalty} OVR penalty`);
      if (devFreezeUntil != null && (franchise.season ?? 0) <= devFreezeUntil) parts.push(`dev frozen through S${devFreezeUntil}`);
      if (tradeReq) parts.push(`formally requested trade`);
      if (flightRisk) parts.push(`flight risk at expiry · escalator on next demand`);
      return `<div style="margin:.55rem 0;padding:.4rem .55rem;background:rgba(255,90,90,.08);border-left:3px solid #ff5a5a;border-radius:2px;font-size:.65rem;color:#ffb0b0">
        💢 <b style="letter-spacing:.5px">LOCKER ROOM</b> · ${parts.join(" · ")}
      </div>`;
    })()}
    <div class="frn-pcard-split" style="margin-top:.5rem">
      ${combinePanel}
      ${rightPanel}
    </div>
    ${seasonBlock ? `<div style="margin-top:.6rem">${seasonBlock}</div>` : ""}
    ${recentFormStrip ? `<div style="margin-top:.6rem">${recentFormStrip}</div>` : ""}
    ${streaksBlock}
    ${gameLogBlock ? `<div style="margin-top:.6rem">${gameLogBlock}</div>` : ""}
    <div style="margin-top:.6rem">${_buildVitalsBlock(p)}</div>
    ${_isInjuryProne(p) ? `<div style="margin-top:.45rem;font-size:.6rem;color:#ff9090;letter-spacing:.5px;font-weight:700" title="Injured 3+ times — elevated recurrence risk">⚠ INJURY-PRONE · ${(p.injuryHistory||[]).length} prior injuries</div>` : ""}
    ${p.coachable ? `<div style="margin-top:.45rem;font-size:.6rem;color:#7ec8e3;letter-spacing:.5px;font-weight:700" title="Absorbs coaching exceptionally well — amplified TEC growth with a Film Mastermind DC">📋 COACHABLE</div>` : ""}
    ${flav ? `<div class="frn-player-flavor" style="margin-top:.55rem">${flav}</div>` : ""}
    ${contractBlock ? `<div style="margin-top:.6rem">${contractBlock}</div>` : ""}
    ${_buildCareerCard(p)}
  </div>`;
}

// frnReleasePlayer / frnReleasePlayerConfirm / frnReleasePlayerCancel
// live in play-franchise-core.js — they drive the inline _releasePending
// row instead of a browser confirm() dialog.

function frnStartSeason() {
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const used = capUsedByTeam(franchise.chosenTeamId);
  if (used > cap) {
    alert(`Still over the cap by $${(used-cap).toFixed(1)}M. Cut players first.`);
    return;
  }
  // First action of every season: free agency. Generate a fresh pool.
  franchise.phase = "free_agency";
  franchise.freeAgents = _generateFAPool();
  franchise._faOffers = {};
  franchise._faResults = null;
  franchise.tradeOffers = [];
  _seedAITradeBlocks();
  saveFranchise();
  showFranchiseDashboard();
}

// ── Free Agency ───────────────────────────────────────────────────────────────
// First action in every season. A curated pool of veterans, mid-tier
// starters, and wildcards drops onto the market. The user (only) makes
// offers (AAV + years), can pre-flag which players they'd cut to make
// room, and at "End FA" all offers resolve based on whether the offer
// meets the player's demand. AI teams don't compete for now.


// FA pool templates — each kind defines its own age band, draft pedigree,
// pricing, and a story pool. Diamond-in-the-rough kind quietly bumps the
// player's true overall after generation; the scouting noise + low draft
// pedigree keeps the displayed grade conservative so the user has to
// trust their gut on a cheap young guy with "tools".
const FA_POOL_TEMPLATES = [
  // Veteran stars — proven, expensive, won't take a discount easily
  { kind:"vet_star",  count: 15, ageMin:27, ageMax:32, tier:"elite",
    drMin:1, drMax:3, demandMult:1.00, yearsMin:3, yearsMax:5,
    posPool:["QB","WR","WR","RB","OL","OL","OL","DL","DL","LB","CB","CB","TE","S","S"],
    stories:[
      "Former Pro Bowler hitting the open market",
      "Coming off a career year — wants top-of-market",
      "Cap casualty looking for a contender",
      "Wants one more chance to chase a ring",
      "Lost his locker last spring — still has plenty in the tank",
      "Big-money guy looking for a bigger role",
    ] },
  // Steady veterans — depth, decent prices
  { kind:"vet_depth", count: 28, ageMin:27, ageMax:33, tier:"good",
    drMin:2, drMax:5, demandMult:0.95, yearsMin:2, yearsMax:4,
    posPool:["QB","RB","WR","WR","TE","OL","OL","OL","OL","DL","DL","LB","LB","CB","CB","S","S"],
    stories:[
      "Reliable starter looking for a fresh start",
      "Productive rotation piece on his third team",
      "Solid film — needs the right system",
      "Plug-and-play veteran",
      "Pushed out by a 1st-round rookie",
      "Underrated grinder with starts on tape",
    ] },
  // Veteran minimums — cheap depth, locker room glue
  { kind:"vet_min",   count: 45, ageMin:31, ageMax:35, tier:"average",
    drMin:3, drMax:7, demandMult:0.65, yearsMin:1, yearsMax:2,
    posPool:["RB","WR","TE","OL","DL","LB","CB","S","K","P"],
    stories:[
      "Looking for one more shot",
      "Locker room glue guy",
      "Special teams ace on the back nine of his career",
      "Knows three playbooks cold",
      "End of the bench but earns his keep",
      "Wants to mentor a rookie at his position",
    ] },
  // Young camp bodies — cheap, room to grow
  { kind:"camp_body", count: 70, ageMin:22, ageMax:25, tier:"average",
    drMin:5, drMax:7, demandMult:0.55, yearsMin:1, yearsMax:3,
    posPool:["QB","RB","WR","WR","TE","OL","OL","DL","LB","CB","CB","S"],
    stories:[
      "Practice squad standout",
      "Training camp body — last team kept him in the building",
      "Late-round project who never got real reps",
      "Bounced around three rosters last year",
      "Young legs, chip on his shoulder",
      "Quietly impressed in joint practices",
      "Tools look promising — needs a coach",
      "Flashed in limited reps last preseason",
      "Coaches keep saying he's about to break out",
      "Late bloomer waiting for an opportunity",
    ] },
  // UDFAs — bottom of the pool, raw upside
  { kind:"udfa",      count: 40, ageMin:22, ageMax:23, tier:"poor",
    drMin:0, drMax:0, demandMult:0.42, yearsMin:1, yearsMax:2,
    posPool:["RB","WR","WR","WR","TE","OL","DL","LB","CB","S"],
    stories:[
      "Undrafted out of a small school",
      "Pro Day standout who slid through the draft",
      "Workout warrior — needs to translate it",
      "Walked on in college, kept earning reps",
      "Tape doesn't pop but he flies around",
      "All-conference at the FCS level",
    ] },
  // Diamonds in the rough — secretly good young players, undervalued
  // grade. Same story bucket as camp bodies so they don't out themselves.
  { kind:"diamond",   count: 18, ageMin:22, ageMax:25, tier:"good",
    drMin:5, drMax:7, demandMult:0.55, yearsMin:2, yearsMax:3,
    posPool:["QB","RB","WR","TE","OL","DL","LB","CB","S"],
    stories:[
      "Tools look promising — needs a coach",
      "Quietly impressed in joint practices",
      "Late bloomer waiting for an opportunity",
      "Coaches keep saying he's about to break out",
      "Flashed in limited reps last preseason",
      "Training camp body — last team kept him in the building",
    ] },
];

// Assign stable mock team names to an FA player's career history rows.
// FA players never pass through assignCareerTeams (which only runs on
// franchise.rosters), so without this every history row shows "—".
function _assignFACareerTeams(p) {
  const hist = p.careerHistory;
  if (!hist || !hist.length) return;
  const n = hist.length;
  let seed = 0;
  for (const c of (p.pid || p.name || "")) seed = (seed * 31 + c.charCodeAt(0)) | 0;
  seed = Math.abs(seed) ^ 0xfa_cafe;
  const rng = () => {
    seed = (Math.imul(seed | 0, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  const lastTeam = TEAMS[Math.floor(rng() * TEAMS.length)];
  const seasonsOnLast = Math.min(n, 1 + Math.floor(rng() * Math.min(4, n)));
  const priorCount = n - seasonsOnLast;
  const priorTeam  = TEAMS.filter(t => t.id !== lastTeam.id)[Math.floor(rng() * (TEAMS.length - 1))];
  for (let i = 0; i < n; i++) {
    const t = i >= priorCount ? lastTeam : priorTeam;
    hist[i].teamId   = t.id;
    hist[i].teamName = `${t.city} ${t.name}`;
  }
  // Lock in — assignCareerTeams skips players already stamped, so a
  // signed FA's history is preserved instead of being rewritten by the
  // user's-team seed on the next dashboard render.
  p._careerTeamsAssigned = true;
}

// ── FA cap projection ──────────────────────────────────────────────────
// Multi-year cap usage projection for the chosen team, accounting for:
//   · kept roster contracts (with their natural year-by-year decay)
//   · pending FA signings (assume they sign at offered/bid terms)
//   · cuts queued (kept player swapped for dead cap perYear × remaining)
// Cap line per year inflates ~7% per season to match the offseason
// model. Source defaults to "auto" — uses faNegotiations yourBids if
// any active, else _faOffers. Pass "offers" or "negotiations" to force.
function _faMultiYearCapProjection(years = 4, source = "auto") {
  const myId = franchise.chosenTeamId;
  const myRoster = franchise.rosters[myId] || [];
  const baseCap = effectiveSalaryCap(myId);
  // Collect pending signings + cuts from the requested source.
  const cutNames = new Set();
  const signings = []; // { fa, offer }
  const hasNegs = Object.values(franchise.faNegotiations || {})
    .some(n => n.state === "negotiating" && n.yourBid);
  const useNegs = source === "negotiations" || (source === "auto" && hasNegs);
  if (useNegs) {
    for (const [, n] of Object.entries(franchise.faNegotiations || {})) {
      if (n.state !== "negotiating" || !n.yourBid?.aav || !n.yourBid?.years) continue;
      (n.yourBid.cutNames || []).forEach(c => cutNames.add(c));
      signings.push({ fa: n.fa, offer: n.yourBid });
    }
  } else {
    for (const [key, o] of Object.entries(franchise._faOffers || {})) {
      const fa = (franchise.freeAgents || []).find(p => p.pid === key || p.name === key);
      if (!fa || !o?.aav || !o?.years) continue;
      (o.cutNames || []).forEach(c => cutNames.add(c));
      signings.push({ fa, offer: o });
    }
  }
  const usage = new Array(years).fill(0);
  // Kept roster contracts (or dead cap for cut players)
  for (const p of myRoster) {
    const c = p.contract;
    if (!c || c.remaining <= 0) continue;
    if (cutNames.has(p.name)) {
      const { perYear, years: dYrs } = deadCapOnRelease(p);
      for (let i = 0; i < Math.min(years, dYrs); i++) {
        usage[i] += perYear;
      }
      continue;
    }
    const proration = c.bonusProration || 0;
    const bases = c.baseSalaries || [];
    const curIdx = (c.years || 1) - (c.remaining || 1);
    for (let i = 0; i < years && (curIdx + i) < bases.length; i++) {
      usage[i] += (bases[curIdx + i] || 0) + proration;
    }
  }
  // Pending signings — assume all are signed at offered terms
  for (const { fa, offer } of signings) {
    const ovr = scoutGrade(fa);
    const bonus = _signingBonusCalc(offer.aav, offer.years, ovr);
    const struct = offer.structure || _defaultStructure(fa.age || 27, ovr);
    const bases = _baseSalarySchedule(offer.aav, offer.years, struct, bonus.bonusProration);
    for (let i = 0; i < years && i < bases.length; i++) {
      usage[i] += (bases[i] || 0) + bonus.bonusProration;
    }
  }
  return usage.map((v, i) => ({
    year: i,
    usage: Math.round(v * 10) / 10,
    cap: Math.round(baseCap * Math.pow(1.07, i) * 10) / 10,
  }));
}

// Top cut candidates — ranked by a SCORE that combines net savings
// with "should we cut this guy" signals (age, decline, role), NOT
// pure savings (which would always surface the highest-paid player —
// usually your star QB). Hard excludes prevent ever suggesting a
// cornerstone player; soft signals re-rank within the candidate pool.
function _faSuggestedCuts(teamId, alreadyCut, n = 5) {
  const roster = franchise.rosters[teamId] || [];
  const cutSet = new Set(alreadyCut || []);
  // Starters by depth chart — they get extra protection (negative score).
  // Filters out package-only and returner slots so 6th DBs and gunners
  // don't get cut-protected like the actual front 22.
  const dcStarters = new Set();
  for (const [slotKey, slot] of Object.entries(franchise.depthChart?.[teamId] || {})) {
    if (slot?.starter && _isFullTimeStarterSlot(slotKey)) dcStarters.add(slot.starter);
  }
  // Premium positions where you almost never cut a starter. Uses the
  // game's actual position labels (QB, RB, WR, TE, OL, DL, LB, CB, S,
  // K, P) — earlier version had OT/LT/RT/EDGE which don't exist here.
  const PREMIUM = new Set(["QB", "OL", "DL", "CB", "WR"]);

  const candidates = [];
  for (const p of roster) {
    if (!p.contract || cutSet.has(p.name)) continue;
    const aav = p.contract.aav || 0;
    if (aav < 1.5) continue; // sub-$1.5M deals don't move the needle
    const ovr = p.overall || 70;
    const age = p.age || 27;
    const isStarter = dcStarters.has(p.name);

    // ── HARD EXCLUDES — never suggest cutting cornerstone talent ──
    if (ovr >= 82) continue;                         // good starter or better
    if (age <= 25 && ovr >= 75) continue;            // young developing player
    if (p.position === "QB" && isStarter && ovr >= 70) continue; // starting QB unless awful
    if (p.position === "QB" && ovr >= 78) continue;  // any QB at 78+ is a real asset
    if (p.position === "OL" && isStarter && ovr >= 74) continue; // OL starters protect QB — gated lower
    if (isStarter && PREMIUM.has(p.position) && ovr >= 76) continue; // premium starter

    const { perYear: dPY, years: dYrs } = deadCapOnRelease(p);
    const deadTotal = dPY * dYrs;
    const netSavings = aav - dPY; // first-year cap savings (what FA cares about)
    if (netSavings < 1.0) continue;

    // ── Rank score — favors cuts that make football sense ──
    // The savings amount is the base; the bonuses pile on for cuts
    // the user "should" make (aging vets, fell-off-deal players,
    // expensive backups). Penalties for high-value or premium-role
    // players bring their score back down even if savings are big.
    const signedOvr = p.contract?.signedOvr || ovr;
    const declineDelta = Math.max(0, signedOvr - ovr);
    const ageScore   = age >= 34 ? 6 : age >= 32 ? 4 : age >= 30 ? 2 : 0;
    const declineScore = declineDelta * 0.8;
    const depthScore = !isStarter && aav >= 3 ? 2 : 0; // expensive backup
    const ovrPenalty = ovr >= 79 ? -3 : ovr >= 76 ? -1 : 0;
    const positionPenalty = p.position === "QB" ? -8
                          : PREMIUM.has(p.position) && isStarter ? -3 : 0;
    const score = netSavings + ageScore + declineScore + depthScore + ovrPenalty + positionPenalty;
    if (score < 1.5) continue; // don't suggest weak cases

    // Human-readable reason for the suggestion (shown in the widget)
    const reason = age >= 32 ? "aging vet"
                 : declineDelta >= 5 ? "fell off the deal"
                 : !isStarter && aav >= 4 ? "expensive backup"
                 : ovr < 72 ? "depth piece on starter money"
                 : "trim cap space";

    candidates.push({
      player: p,
      aav, deadPY: dPY, deadYrs: dYrs, deadTotal,
      netSavings, score, reason,
      declineRisk: age >= 32 || declineDelta >= 4,
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, n);
}

// Compact comparison card for a pinned FA. Renders alongside the main
// detail panel when the user pins someone to compare. Clicking the
// card SWAPS pinned ↔ selected so the user can toggle which is in
// the main view (current becomes pinned, pinned becomes selected).
function _faCompareCardHtml(fa, chosenTeamId, currentSelKey) {
  if (!fa) return "";
  const sg = scoutGrade(fa);
  const suitors = TEAMS.filter(t => t.id !== chosenTeamId && _faAIInterest(t.id, fa) >= 0.1).length;
  const escKey = (fa.pid || fa.name).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const escSel = (currentSelKey || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `<div style="padding:.45rem .55rem;background:var(--bg2);border:1px dashed var(--gold);border-radius:4px;margin-bottom:.55rem">
    <div style="display:flex;align-items:baseline;gap:.4rem;margin-bottom:.2rem">
      <span style="font-size:.55rem;letter-spacing:1.5px;color:var(--gold);font-weight:700">📌 PINNED FOR COMPARE</span>
      <button class="btn btn-outline" style="font-size:.55rem;padding:.1rem .35rem;margin-left:auto" onclick="frnFAUnpinCompare()">✕ Unpin</button>
    </div>
    <div style="display:flex;align-items:baseline;gap:.4rem;flex-wrap:wrap;cursor:pointer" onclick="frnFASwapCompare('${escKey}','${escSel}')" title="Swap — this FA becomes selected, current selection moves to pin">
      <span style="font-size:.58rem;color:var(--gold);font-weight:700">${fa.position}</span>
      <span style="font-weight:700;color:var(--blwhite);font-size:.78rem">${fa.name}</span>
      ${gradeBadge(fa)}
      <span style="color:var(--gray);font-size:.6rem">Age ${fa.age}</span>
      <span style="color:var(--gold-lt);font-size:.65rem;margin-left:auto;font-weight:700">$${fa.demandedAAV.toFixed(1)}M × ${fa.demandedYears}yr</span>
    </div>
    <div style="font-size:.58rem;color:var(--gray);margin-top:.18rem">
      ${suitors > 0 ? `📈 ${suitors} suitor${suitors!==1?"s":""}` : "Quiet market"}
      · scout grade ${gradeLabel(sg)}
    </div>
  </div>`;
}

// Shared HTML builder for the 4-year cap timeline used on every FA
// screen. Returns the block including the title, bars, and footnote.
// titleSuffix lets the caller tailor the heading (ROSTER + OFFERS,
// ROSTER + ACTIVE BIDS, etc.). hoverNote shows below if there's
// interactivity to advertise.
function _faCapTimelineHtml(proj, titleSuffix, hoverNote) {
  const yearsHtml = proj.map(p => {
    const pct = Math.min(100, (p.usage / Math.max(1, p.cap)) * 100);
    const color = p.usage > p.cap ? "var(--red)" : p.usage > p.cap * 0.90 ? "#e8a000" : "var(--green-lt)";
    return `<div class="frn-resign-cap-year" data-cap-year="${p.year}" data-cap-used="${p.usage}">
      <div class="lbl">Y${p.year+1}</div>
      <div class="bar">
        <div class="fill" style="width:${pct}%;background:${color}"></div>
        <div class="fill-preview" style="left:${pct}%"></div>
      </div>
      <div class="num" style="color:${color}">$${p.usage.toFixed(0)}M<span class="num-preview"></span></div>
    </div>`;
  }).join("");
  return `<div style="background:var(--bg2);border:1px solid var(--border);padding:.45rem .6rem;margin-bottom:.55rem;border-radius:3px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.3rem">
      <span style="font-size:.55rem;color:var(--gold);letter-spacing:1.5px;font-weight:700">📊 CAP TIMELINE · ${titleSuffix}</span>
      ${hoverNote ? `<span style="font-size:.55rem;color:var(--gray);font-style:italic">${hoverNote}</span>` : ""}
    </div>
    <div class="frn-resign-cap-timeline">${yearsHtml}</div>
    <div style="font-size:.55rem;color:var(--gray);margin-top:.2rem;font-style:italic">Cap inflates ~7%/yr · ceiling per year shown</div>
  </div>`;
}

// Per-year cap hit for a single FA offer. Used to populate the
// data-resign-hits attribute on hover-able rows so the existing
// _resignHoverIn/_resignHoverOut handlers can render the preview
// overlay on the cap bars.
function _faPendingHitsByYear(fa, offer, years = 4) {
  if (!fa || !offer || !offer.aav || !offer.years) return new Array(years).fill(0);
  const ovr = scoutGrade(fa);
  const { bonusProration } = _signingBonusCalc(offer.aav, offer.years, ovr);
  const struct = offer.structure || _defaultStructure(fa.age || 27, ovr);
  const bases = _baseSalarySchedule(offer.aav, offer.years, struct, bonusProration);
  const out = new Array(years).fill(0);
  for (let i = 0; i < years && i < bases.length; i++) {
    out[i] = +((bases[i] || 0) + bonusProration).toFixed(1);
  }
  return out;
}

// ── Free-agent motivations (the "people layer") ─────────────────────────────
// Each FA wants something beyond money, and how well YOUR team satisfies it
// bends what they'll accept from you: a contender can sign a ring-chaser for
// less; a rebuilder pays a premium. This turns the cosmetic faStory into a
// real force in both the accept-odds and the weekly winner-selection.
const _FA_MOTIVATIONS = {
  contender: { icon: "🏆", label: "Chase a ring",    want: "a contender",          metGood: "contender",        metBad: "rebuilding" },
  money:     { icon: "💰", label: "Top dollar",      want: "the biggest contract", metGood: "highest bidder",   metBad: "lowball" },
  role:      { icon: "🎯", label: "A starting job",  want: "a clear starting role",metGood: "clear starter",    metBad: "buried on the depth chart" },
  scheme:    { icon: "🧩", label: "Scheme fit",      want: "a system that fits",   metGood: "scheme fit",       metBad: "scheme mismatch" },
};
const _FA_MOTIV_STORIES = {
  contender: ["Wants one more shot at a ring", "Chasing a championship in his prime", "Ringless and running out of time", "Will take a discount for a real contender"],
  money:     ["Coming off a career year — wants top-of-market", "Out to get paid, and he's earned it", "Betting on himself for the biggest deal", "Cap casualty looking to cash in"],
  role:      ["Wants to be the guy, not a rotation piece", "Looking for a clear path to snaps", "Tired of splitting time — wants a starting job", "Believes he's a starter and wants to prove it"],
  scheme:    ["Wants a system that plays to his strengths", "Looking for the right scheme fit", "Productive in the right role — fit matters", "Wants a coach who'll use him right"],
};
function _faWeightedPick(weights) {
  let total = 0; for (const k in weights) total += weights[k];
  let r = Math.random() * total;
  for (const k in weights) { r -= weights[k]; if (r <= 0) return k; }
  return Object.keys(weights)[0];
}
function _rollFAMotivation(p, tmpl) {
  const age = p.age || 27, ovr = p.overall || 70;
  const w = { contender: 1, money: 1, role: 1, scheme: 1 };
  if (age >= 31)               w.contender += 2;    // vets chase rings
  if (ovr >= 84)               w.money     += 1.5;  // stars want to get paid
  if (ovr < 78 && age <= 28)   w.role      += 1.5;  // ascending guys want snaps
  if (tmpl && (tmpl.kind === "vet_min" || tmpl.kind === "camp_body")) w.role += 1; // fringe want a job
  const driver = _faWeightedPick(w);
  const meta = _FA_MOTIVATIONS[driver];
  const pool = _FA_MOTIV_STORIES[driver];
  return {
    driver,
    weight: +(0.8 + Math.random() * 0.5).toFixed(2), // 0.8–1.3 intensity
    icon: meta.icon, label: meta.label, want: meta.want,
    story: pool[Math.floor(Math.random() * pool.length)],
  };
}

// "Winning situation" proxy [0..1], LEAGUE-RELATIVE so there's always a spread
// from rebuilder (→0, pays a premium) to contender (→1, gets a discount), even
// early when absolute roster strength is similar. Top-22 roster strength as a
// z-score across the league, blended with record when available.
function _teamRosterStrength(teamId) {
  const r = franchise.rosters?.[teamId] || [];
  if (!r.length) return 70;
  const top = r.slice().sort((a, b) => (b.overall||0) - (a.overall||0)).slice(0, 22);
  return top.reduce((s, p) => s + (p.overall || 60), 0) / top.length;
}
// Per-pass memo of the league strength distribution — _teamContentionScore is
// called per-team-per-FA in the weekly AI bid round, and recomputing the whole
// league each call was O(calls × 32). Invalidated (set null) at the top of the
// FA render + bid-round + resolution so it rebuilds once per pass.
let _faContentionMemo = null;
function _teamContentionScore(teamId) {
  if (!_faContentionMemo) {
    const strengths = {}; const arr = [];
    for (const t of TEAMS) { const v = _teamRosterStrength(t.id); strengths[t.id] = v; arr.push(v); }
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length) || 1;
    _faContentionMemo = { strengths, mean, sd };
  }
  const m = _faContentionMemo;
  let s = 0.5 + ((m.strengths[teamId] ?? m.mean) - m.mean) / (m.sd * 3); // ±1.5 SD → [0,1]
  const st = franchise.standings?.[teamId];
  if (st && (st.w != null) && (st.l != null)) {
    const games = st.w + st.l + (st.t || 0);
    if (games > 0) s = 0.5 * s + 0.5 * (st.w / games); // blend record once a season's played
  }
  return Math.max(0, Math.min(1, s));
}

// How well a team satisfies an FA's motivation. Returns satisfaction in
// [-1 (poor) … +1 (great)] plus a display label.
function _faMotivationFit(fa, teamId) {
  const m = fa?.faMotivation;
  if (!m) return { sat: 0, label: "", met: null };
  const meta = _FA_MOTIVATIONS[m.driver] || {};
  let sat = 0;
  if (m.driver === "contender") {
    sat = (_teamContentionScore(teamId) - 0.5) * 2;
  } else if (m.driver === "role") {
    const roster = franchise.rosters?.[teamId] || [];
    const best = roster.filter(p => p.position === fa.position).sort((a, b) => b.overall - a.overall)[0];
    if (!best || best.overall <= (fa.overall || 70) - 2)      sat = 1;   // clear starter
    else if (best.overall >= (fa.overall || 70) + 2)          sat = -1;  // buried
    else                                                       sat = 0;   // competition
  } else if (m.driver === "scheme") {
    const bonus = (typeof _draftSchemeBonus === "function") ? _draftSchemeBonus(teamId, fa.position) : 0;
    sat = bonus > 0 ? 1 : 0; // fit = discount; otherwise neutral (no penalty)
  } else { // money — pure auction, no fit discount/premium
    sat = 0;
  }
  const met = sat > 0.25 ? (meta.metGood || "good fit") : sat < -0.25 ? (meta.metBad || "poor fit") : "neutral";
  return { sat, label: met, driver: m.driver };
}

// Per-team effective-demand multiplier from motivation fit. <1 = they'll take
// less from you (good fit); >1 = they want a premium (poor fit). Bounded ±~15%.
function _faTeamDemandMult(fa, teamId) {
  const m = fa?.faMotivation;
  if (!m) return 1;
  const { sat } = _faMotivationFit(fa, teamId);
  const swing = 0.15 * (m.weight || 1);
  return +(1 - sat * swing).toFixed(3);
}
// A bid's "value to the player" — bid AAV over the team's fit-adjusted demand.
// The player signs with the highest-satisfaction bidder that clears threshold.
function _faBidSatisfaction(fa, teamId, aav) {
  const demand = Math.max(0.1, fa?.demandedAAV || 0);
  return aav / (demand * _faTeamDemandMult(fa, teamId));
}

function _generateFAPool() {
  const taken = new Set();
  for (const r of Object.values(franchise.rosters)) r.forEach(p => taken.add(p.name));
  const pool = [];
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const currentYear = new Date().getFullYear() + (franchise.season || 1) - 1;
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  for (const tmpl of FA_POOL_TEMPLATES) {
    for (let i = 0; i < tmpl.count; i++) {
      const pos = pick(tmpl.posPool);
      const p = genUniquePlayer(pos, tmpl.tier, taken);
      taken.add(p.name);

      // Age band per kind
      p.age = tmpl.ageMin + Math.floor(Math.random() * (tmpl.ageMax - tmpl.ageMin + 1));

      // Draft pedigree per kind (0 = undrafted)
      if (tmpl.drMin === 0 && tmpl.drMax === 0) {
        p.draftRound = 0; p.draftPick = null;
      } else {
        const round = tmpl.drMin + Math.floor(Math.random() * (tmpl.drMax - tmpl.drMin + 1));
        p.draftRound = round;
        p.draftPick  = (round - 1) * 32 + 1 + Math.floor(Math.random() * 32);
      }
      p.draftYear = currentYear - (p.age - 22);
      _rollHiddenGem(p);

      // Rebuild career history now that age is locked — genUniquePlayer ran
      // generateCareer with a random internal age which is now stale.
      generateCareer(p);
      // Assign mock team names (FA players skip assignCareerTeams which only
      // runs on franchise.rosters). Use seeded RNG so cards are stable.
      _assignFACareerTeams(p);

      // Diamond bump: real overall pushed higher while draft pedigree
      // stays late. Scouting noise + draft penalty keeps the displayed
      // grade conservative. They'll come at a steep discount.
      if (tmpl.kind === "diamond") {
        const bump = 4 + Math.floor(Math.random() * 3);  // +4..+6
        p.overall = Math.min(99, p.overall + bump);
      }

      // Career earnings reflect years in league
      p.careerEarnings = Math.round((p.age - 22) * computeMarketValue(p, cap) * 0.6 * 10) / 10;

      // What they want
      p.demandedAAV   = Math.round(computeMarketValue(p, cap) * tmpl.demandMult * (0.90 + Math.random() * 0.20) * 10) / 10;
      p.demandedYears = tmpl.yearsMin + Math.floor(Math.random() * (tmpl.yearsMax - tmpl.yearsMin + 1));

      // Motivation — a real driver that bends acceptance by team fit. The
      // story is now derived from it so flavor and mechanic agree.
      p.faMotivation = _rollFAMotivation(p, tmpl);
      p.faStory = p.faMotivation.story;
      p.faKind  = tmpl.kind;  // internal — never displayed directly

      pool.push(p);
    }
  }

  // Sort by demanded AAV desc — heavy hitters at top, scrubs at bottom
  pool.sort((a, b) => b.demandedAAV - a.demandedAAV);
  return pool;
}

// Download the current FA pool as a CSV (opens cleanly in Excel/Sheets).
// Includes combine measurables, scout grade, contract demands, and story.
function frnFAExportCSV() {
  const fas = franchise.freeAgents || [];
  if (!fas.length) { alert("No free agents to export."); return; }
  const headers = [
    "Name", "Pos", "Age", "Height", "Weight (lbs)", "Scout Grade",
    "40-yd (s)", "Bench (reps)", "3-Cone (s)", "Vertical (in)", "Leg/KPW",
    "Archetype",
    "Demanded AAV ($M)", "Demanded Years",
    "Draft Round", "Draft Pick", "Draft Year",
    "Career Earnings ($M)", "Story",
  ];
  const rows = fas.map(p => {
    const c = combineMeasurables(p);
    const g = gradeLabel(scoutGrade(p));
    const heightStr = p.height ? formatHeight(p.height) : "";
    const draftR = p.draftRound === 0 ? "UDFA" : (p.draftRound ?? "");
    return [
      p.name, p.position, p.age, heightStr, p.weight ?? "", g,
      c.fortyTime, c.benchReps, c.coneTime, c.verticalIn, c.kpw,
      p.archetype || "",
      p.demandedAAV, p.demandedYears,
      draftR, p.draftPick ?? "", p.draftYear ?? "",
      p.careerEarnings ?? "", p.faStory || "",
    ];
  });
  const escapeCell = v => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map(r => r.map(escapeCell).join(",")).join("\r\n");
  // BOM so Excel reads UTF-8 names correctly
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fa-pool-season-${franchise.season || 1}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── FA screen helpers ─────────────────────────────────────────────────────────
function _faRosterFit(p, teamId) {
  const pos = p.position;
  const grade = scoutGrade(p);
  const roster = franchise.rosters[teamId] || [];
  const samePos = roster.filter(r => r.position === pos).sort((a,b) => scoutGrade(b) - scoutGrade(a));
  if (!samePos.length) return { label: `No ${pos} on roster — fills a void`, upgrade: true };
  const starter = samePos[0];
  const sg = scoutGrade(starter);
  if (grade >= sg + 3) return { label: `Upgrades ${pos}1 — starts over ${starter.name} (${gradeLabel(sg)})`, upgrade: true };
  if (grade >= sg - 2) return { label: `Competes for ${pos}1 with ${starter.name} (${gradeLabel(sg)})`, compete: true };
  let slot = samePos.length + 1;
  for (let i = 1; i < samePos.length; i++) {
    if (grade >= scoutGrade(samePos[i]) - 2) { slot = i + 1; break; }
  }
  return { label: `${pos}${slot} depth — ${samePos.length} already on roster` };
}

function _faNeedsSnippet(teamId, highlightPos) {
  const rows = ["QB","RB","WR","TE","OL","DL","LB","CB","S"].map(pos => {
    const top = (franchise.rosters[teamId]||[]).filter(p=>p.position===pos).sort((a,b)=>scoutGrade(b)-scoutGrade(a))[0];
    const lvl = _draftNeedLevel(teamId, pos);
    const hl = pos === highlightPos;
    const col = lvl === 2 ? "#ff9090" : lvl === 1 ? "#e8a000" : "var(--gray)";
    const badge = lvl === 2 ? "NEED" : lvl === 1 ? "THIN" : "OK";
    return `<div style="display:flex;align-items:center;gap:.35rem;padding:.1rem ${hl?".35rem":0};${hl?"background:rgba(245,197,66,.1);margin:0 -.35rem;border-radius:3px":""}">
      <span style="font-size:.58rem;font-weight:700;color:${hl?"var(--gold)":"var(--blgray)"};min-width:1.8rem">${pos}</span>
      <span style="font-size:.58rem;color:var(--blgray);flex:1">${top ? gradeLabel(scoutGrade(top)) : "—"}</span>
      <span style="font-size:.52rem;font-weight:700;color:${col}">${badge}</span>
    </div>`;
  }).join("");
  return `<div style="padding:.4rem .45rem;background:var(--bg3);border-radius:4px;border:1px solid var(--border);margin-bottom:.5rem">
    <div style="font-size:.53rem;letter-spacing:.6px;color:var(--blgray);margin-bottom:.22rem">POSITION NEEDS</div>
    ${rows}
  </div>`;
}

function frnFASetFilter(field, value) {
  if (!franchise._faFilters) franchise._faFilters = {};
  franchise._faFilters[field] = value;
  renderFrnFA();
  // Re-focus the search input after re-render so typing flows naturally
  if (field === "search") {
    const input = document.querySelector('.frn-fa-pool-col input[placeholder^="Search"]');
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  }
}

function renderFrnFA(selectedKey) {
  _faContentionMemo = null; // rebuild league-contention once per render
  const { chosenTeamId, freeAgents = [], _faOffers = {}, salaryCap, season } = franchise;
  const cap = effectiveSalaryCap(chosenTeamId);
  const myRoster = franchise.rosters[chosenTeamId] || [];
  const myCapUsed = capUsedByTeam(chosenTeamId);

  // Filters — persisted on franchise so they survive renders
  const filters = (franchise._faFilters = franchise._faFilters || {
    pos: "ALL", age: "ALL", sort: "price", search: "",
  });
  let filtered = freeAgents.slice();
  if (filters.pos && filters.pos !== "ALL") filtered = filtered.filter(p => p.position === filters.pos);
  if (filters.age === "YOUNG") filtered = filtered.filter(p => p.age <= 25);
  else if (filters.age === "VET") filtered = filtered.filter(p => p.age >= 26);
  if (filters.search) {
    const s = filters.search.toLowerCase();
    filtered = filtered.filter(p => p.name.toLowerCase().includes(s));
  }
  if (filters.sort === "age")        filtered.sort((a, b) => a.age - b.age);
  else if (filters.sort === "grade") filtered.sort((a, b) => scoutGrade(b) - scoutGrade(a));
  // default "price" already matches the source ordering (desc)

  // Match by pid (new saves) then by name (legacy saves)
  let selected = selectedKey
    ? (freeAgents.find(p => p.pid === selectedKey) || freeAgents.find(p => p.name === selectedKey))
    : null;
  if (!selected) selected = filtered[0] || freeAgents[0];

  // Filter chip helper
  const chip = (active, label, onclick, color) => `<button onclick="${onclick}" style="padding:.18rem .45rem;font-size:.6rem;letter-spacing:.5px;border:1px solid ${active?"var(--gold)":"var(--border)"};background:${active?"rgba(245,197,66,.15)":"transparent"};color:${active?"var(--gold-lt)":(color||"var(--blgray)")};border-radius:3px;font-family:inherit;cursor:pointer;font-weight:${active?700:400}">${label}</button>`;

  const POS_LIST = ["ALL","QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];
  const posChips = POS_LIST.map(pos =>
    chip(filters.pos === pos, pos === "ALL" ? "ALL" : pos, `frnFASetFilter('pos','${pos}')`)
  ).join("");
  const ageChips = [["ALL","ALL"],["YOUNG","🌱 ≤25"],["VET","26+"]].map(([k,l]) =>
    chip(filters.age === k, l, `frnFASetFilter('age','${k}')`)
  ).join("");
  const sortChips = [["price","$↓"],["age","AGE↑"],["grade","GRADE↓"]].map(([k,l]) =>
    chip(filters.sort === k, l, `frnFASetFilter('sort','${k}')`)
  ).join("");
  const filterBar = `
    <div style="display:flex;flex-wrap:wrap;gap:.2rem;margin-bottom:.4rem;align-items:center">
      <span style="color:var(--blgray);font-size:.55rem;letter-spacing:.5px;margin-right:.15rem">POS</span>${posChips}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:.2rem;margin-bottom:.4rem;align-items:center">
      <span style="color:var(--blgray);font-size:.55rem;letter-spacing:.5px;margin-right:.15rem">AGE</span>${ageChips}
      <span style="color:var(--blgray);font-size:.55rem;letter-spacing:.5px;margin:0 .15rem 0 .4rem">SORT</span>${sortChips}
      <input type="text" placeholder="Search name…" value="${(filters.search || "").replace(/"/g,'&quot;')}"
        oninput="frnFASetFilter('search', this.value)"
        style="flex:1;min-width:6rem;background:var(--bg3);color:var(--white);border:1px solid var(--border);padding:.18rem .35rem;font-family:inherit;font-size:.65rem;border-radius:3px">
    </div>`;

  // FA list (left column)
  const workoutResults = franchise._faWorkoutResults || {};
  const faListHtml = filtered.map(p => {
    const faKey = p.pid || p.name;
    const myOffer = _faOffers[faKey] || _faOffers[p.name];
    const offered = !!myOffer;
    const isSel = selected && (p.pid ? p.pid === selected.pid : p.name === selected.name);
    const escKey = (faKey || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const young = p.age <= 25;
    const wo = workoutResults[p.name];
    const woIcon = wo ? (wo.result === "standout" ? "⭐" : wo.result === "solid" ? "✅" : wo.result === "mixed" ? "〰️" : "❌") : "";
    const pGrade = scoutGrade(p);
    const heatGrade = p._workoutHot ? Math.max(pGrade, 80) : pGrade;
    const hot = heatGrade >= 88, warm = !hot && heatGrade >= 80;
    const needLvl = _draftNeedLevel(chosenTeamId, p.position);
    // Left border: need takes priority over heat
    const borderCol = needLvl === 2 ? "#ff6b6b44" : needLvl === 1 ? "#e8a00044" : hot ? "#ff993344" : "transparent";
    const heatBadge = hot ? `<span style="font-size:.6rem;line-height:1">🔥</span>` : warm ? `<span style="font-size:.6rem;line-height:1">👀</span>` : "";
    const needBadge = needLvl === 2
      ? `<span style="font-size:.5rem;color:#ff9090;font-weight:700;letter-spacing:.2px;flex-shrink:0">NEED</span>`
      : needLvl === 1
      ? `<span style="font-size:.5rem;color:#e8a000;font-weight:700;letter-spacing:.2px;flex-shrink:0">FILL</span>` : "";
    // Show suitor count on the row for hot players (saves a click)
    const rowSuitors = (hot || warm)
      ? TEAMS.filter(t => t.id !== chosenTeamId && _faAIInterest(t.id, p) >= 0.1).length : 0;
    const suitorBit = rowSuitors >= 3
      ? `<span style="font-size:.52rem;color:${rowSuitors>=6?"var(--red)":"#e8a000"};flex-shrink:0">${rowSuitors} teams</span>` : "";
    // Hover preview on the cap timeline below:
    //   · OFFERED FAs already contribute to the bars → use highlight
    //     mode to show which slice of each year's fill is theirs.
    //   · UNOFFERED FAs aren't in the bars → use add mode to preview
    //     what signing them at demanded terms would add.
    const hoverOffer = offered
      ? { aav: myOffer.aav, years: myOffer.years, structure: myOffer.structure }
      : { aav: p.demandedAAV, years: p.demandedYears };
    const hoverHits = _faPendingHitsByYear(p, hoverOffer, 4);
    const hoverMode = offered ? "highlight" : "add";
    const hoverAttr = hoverHits.some(h => h > 0)
      ? `data-resign-hits='${JSON.stringify(hoverHits)}' data-resign-cap='${cap}' data-resign-mode='${hoverMode}' onmouseenter="_resignHoverIn(this)" onmouseleave="_resignHoverOut()"`
      : "";
    return `<div class="frn-fa-row ${isSel?"selected":""} ${offered?"offered":""}"
      style="border-left:3px solid ${borderCol};padding-left:.45rem;cursor:pointer;display:block"
      ${hoverAttr}
      onclick="renderFrnFA('${escKey}')">
      <div style="display:flex;align-items:center;gap:.3rem">
        ${heatBadge ? heatBadge : `<span style="display:inline-block;width:.7rem"></span>`}
        <span style="font-size:.58rem;color:var(--gold);font-weight:700;flex-shrink:0">${p.position}</span>
        ${gradeBadge(p)}
        <span class="frn-fa-name" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.68rem">${p.name}${young?" 🌱":""}${woIcon?` ${woIcon}`:""}</span>
        ${needBadge}
      </div>
      <div style="display:flex;align-items:center;gap:.3rem;margin-top:.06rem;padding-left:1rem">
        <span class="frn-fa-ask" style="font-size:.62rem">$${p.demandedAAV.toFixed(1)}M</span>
        <span style="color:var(--gray);font-size:.55rem">· ${p.age}yr</span>
        ${suitorBit}
        ${offered ? `<span style="font-size:.55rem;color:var(--green-lt);font-weight:700;margin-left:auto">✓ $${myOffer.aav.toFixed(1)}M offered</span>` : ""}
      </div>
    </div>`;
  }).join("");

  // Cap math across ALL active offers
  let totalOfferedAAV = 0;
  const allPlannedCutNames = new Set();
  for (const o of Object.values(_faOffers)) {
    totalOfferedAAV += o.aav;
    (o.cutNames || []).forEach(n => allPlannedCutNames.add(n));
  }
  const totalCutSavings = myRoster.filter(p => allPlannedCutNames.has(p.name))
    .reduce((s, p) => s + (p.contract?.aav || 0), 0);
  const projectedCap = myCapUsed + totalOfferedAAV - totalCutSavings;
  const overCap = projectedCap > cap;

  const selFaKey   = selected ? (selected.pid || selected.name) : "";
  const escSelName = selFaKey.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  // Detail panel + offer form for selected FA
  let detailHtml = "";
  if (selected) {
    const existing = _faOffers[selFaKey] || _faOffers[selected.name];
    const offer = existing || { aav: selected.demandedAAV, years: selected.demandedYears, cutNames: [] };
    const cutSet = new Set(offer.cutNames || []);
    const myProjAfterCuts = myCapUsed + offer.aav -
      myRoster.filter(p => cutSet.has(p.name)).reduce((s,p) => s + (p.contract?.aav||0), 0);
    const room = cap - myProjAfterCuts;
    // Guarded against zero demanded — fall back to score = 1 (neutral)
    // so the UI shows "Likely · 80%" instead of NaN/Infinity.
    const dAavSafe = Math.max(0.1, selected.demandedAAV || 0);
    const dYrsSafe = Math.max(1,   selected.demandedYears || 1);
    // Motivation bends the effective ask for YOUR team — a good fit (you're a
    // contender / he'd start / scheme match) discounts it; a poor fit adds a
    // premium. Same multiplier the weekly resolution uses, so odds = reality.
    const _motivMult = _faTeamDemandMult(selected, chosenTeamId);
    const score = (offer.aav / (dAavSafe * _motivMult)) * Math.min(offer.years / dYrsSafe, 1);
    const likelihood = score >= 1.05 ? "Very likely" : score >= 1.00 ? "Likely" : score >= 0.90 ? "Toss-up" : score >= 0.80 ? "Unlikely" : "Will reject";
    const lkColor = score >= 1.00 ? "var(--green-lt)" : score >= 0.90 ? "#e8a000" : "var(--red)";
    // Continuous accept-odds percentage for the bar visualization.
    // Score 0.5 → 0%, 1.0 → 80%, 1.2+ → 100%. Smooth fill instead of
    // discrete labels so the user can see odds nudge as they tune AAV.
    const acceptPct = Math.round(Math.max(0, Math.min(100, (score - 0.5) * 160)));

    // Player intel
    const potTag  = potentialTag(selected, { known: _isKnownPlayer(selected) });
    const isKnown = _isKnownPlayer(selected);
    const sGrade  = scoutGrade(selected);
    const heatGrade = selected._workoutHot ? Math.max(sGrade, 80) : sGrade;
    const _rivalRanked = TEAMS.filter(t => t.id !== chosenTeamId)
      .map(t => ({ t, intr: _faAIInterest(t.id, selected) }))
      .filter(x => x.intr >= 0.1)
      .sort((a, b) => b.intr - a.intr);
    const suitors = _rivalRanked.length;
    const rivalNames = _rivalRanked.slice(0, 3).map(x => `${x.t.name} ${_teamGM(x.t.id).icon}`);
    // Biggest threat = the most aggressive interested GM (most likely to overpay).
    const _threat = _rivalRanked.slice()
      .sort((a, b) => _teamGM(b.t.id).faAgg - _teamGM(a.t.id).faAgg)[0];
    const threatGM = _threat ? _teamGM(_threat.t.id) : null;
    const threatLine = (threatGM && threatGM.faAgg >= 1.05)
      ? `<div style="font-size:.57rem;color:#e8a000;margin-top:.14rem">⚠ ${_threat.t.name}'s GM is a <b>${threatGM.icon} ${threatGM.label}</b> — ${threatGM.blurb}</div>`
      : "";
    const heatColor = suitors >= 6 ? "var(--red)" : suitors >= 3 ? "#e8a000" : heatGrade >= 80 ? "#e8a000" : "var(--border)";
    const ageStage = selected.age <= 25 ? "🌱 Ascending" : selected.age <= 27 ? "⬆ Young Prime"
                   : selected.age <= 30 ? "★ Prime" : selected.age <= 32 ? "⬇ Late Prime" : "↘ Declining";

    // Workout block
    const wr = (franchise._faWorkoutResults || {})[selected.name];
    const slotsLeft = _workoutSlotsRemaining();
    let workoutHtml = "";
    if (wr) {
      const rCol = { standout:"var(--gold)", solid:"var(--green-lt)", mixed:"#e8a000", bombed:"var(--red)" }[wr.result];
      const rLbl = { standout:"⭐ STANDOUT", solid:"✅ SOLID", mixed:"〰️ MIXED", bombed:"❌ BOMBED" }[wr.result];
      const rGrade = gradeLabel(sGrade), sLabel = gradeLabel(wr.sharpGrade);
      const gradeChanged = rGrade !== sLabel;
      const demandNote = wr.demandDeltaPct > 0
        ? `<span style="color:var(--red);font-size:.62rem">⬆ Demand up ${wr.demandDeltaPct.toFixed(1)}% · $${wr.demandBefore.toFixed(1)}M→$${selected.demandedAAV.toFixed(1)}M</span>`
        : wr.demandDeltaPct < 0
        ? `<span style="color:var(--green-lt);font-size:.62rem">⬇ Demand down ${Math.abs(wr.demandDeltaPct).toFixed(1)}% · $${wr.demandBefore.toFixed(1)}M→$${selected.demandedAAV.toFixed(1)}M</span>` : "";
      const traitHtml = wr.result === "mixed"
        ? `<div style="font-size:.64rem;color:var(--green-lt)">+ ${wr.posTrait}</div><div style="font-size:.64rem;color:var(--red)">− ${wr.negTrait}</div>`
        : wr.result === "bombed"
        ? `<div style="font-size:.64rem;color:var(--red)">− ${wr.negTrait}</div>`
        : `<div style="font-size:.64rem;color:var(--green-lt)">+ ${wr.posTrait}</div>`;
      workoutHtml = `<div style="margin-top:.35rem;padding-top:.35rem;border-top:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:.45rem;flex-wrap:wrap">
          <span style="font-size:.55rem;letter-spacing:.6px;color:var(--blgray)">WORKOUT</span>
          <b style="color:${rCol};font-size:.72rem">${rLbl}</b>
          ${gradeChanged
            ? `<span style="font-size:.6rem;color:var(--blgray)">${rGrade} → <b style="color:${rCol}">${sLabel}</b> <span style="font-size:.56rem">(fog lifted)</span></span>`
            : `<span style="font-size:.6rem;color:var(--gray)">${rGrade} holds under scrutiny</span>`}
        </div>
        ${traitHtml}
        ${demandNote ? `<div style="margin-top:.2rem">${demandNote}</div>` : ""}
      </div>`;
    }

    // Roster fit
    const fit = _faRosterFit(selected, chosenTeamId);
    const needLvl = _draftNeedLevel(chosenTeamId, selected.position);
    const fitIcon = fit.upgrade ? "⬆" : fit.compete ? "⟺" : needLvl === 2 ? "❗" : needLvl === 1 ? "⚠" : "→";
    const fitColor = fit.upgrade ? "var(--green-lt)" : fit.compete ? "var(--gold-lt)" : needLvl === 2 ? "#ff9090" : needLvl === 1 ? "#e8a000" : "var(--blgray)";

    // Market context
    const posAavs = [];
    for (const r of Object.values(franchise.rosters || {}))
      for (const p of r) if (p.position === selected.position && p.contract) posAavs.push(p.contract.aav);
    posAavs.sort((a,b) => b-a);
    let mktHtml = "";
    if (posAavs.length) {
      const top5Avg = posAavs.slice(0,5).reduce((s,v)=>s+v,0) / Math.min(posAavs.length,5);
      const median  = posAavs[Math.floor(posAavs.length/2)] || 0;
      const top1    = posAavs[0] || 0;
      const vGap    = offer.aav - top5Avg;
      const vTag    = vGap < -2 ? "BARGAIN" : vGap < 2 ? "FAIR" : vGap < 6 ? "PREMIUM" : "OVERPRICED";
      const vCol    = vTag === "BARGAIN" ? "var(--green-lt)" : vTag === "FAIR" ? "var(--gold-lt)" : vTag === "PREMIUM" ? "#e8a000" : "var(--red)";
      mktHtml = `<div style="padding:.38rem .5rem;background:var(--bg3);border-radius:4px;border:1px solid var(--border);margin-top:.45rem">
        <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;font-size:.63rem">
          <span style="font-size:.53rem;letter-spacing:.6px;color:var(--blgray)">MARKET CTX</span>
          <b style="color:${vCol}">${vTag}</b>
          <span style="color:var(--border)">|</span>
          <span style="color:var(--blgray)">${selected.position} top5 avg <b style="color:var(--gold-lt)">$${top5Avg.toFixed(1)}M</b> · median <b style="color:var(--gold-lt)">$${median.toFixed(1)}M</b> · top <b style="color:var(--gold)">$${top1.toFixed(1)}M</b></span>
        </div>
      </div>`;
    }

    // Compare pin — shows a compact card for a second FA so the user
    // can visually compare two players. Click the card to swap which
    // one's in the main detail panel (the previous selected becomes
    // pinned). Unpin clears it.
    const pinnedKey = franchise._faComparePin;
    const pinnedFA = pinnedKey && pinnedKey !== selFaKey && pinnedKey !== selected.name
      ? (freeAgents.find(p => p.pid === pinnedKey || p.name === pinnedKey))
      : null;
    const compareCardHtml = pinnedFA ? _faCompareCardHtml(pinnedFA, chosenTeamId, selFaKey) : "";

    // Motivation block — what he wants + how YOUR situation rates + the ask
    // adjustment it produces. _motivMult was computed above for the odds bar.
    let motivHtml = "";
    if (selected.faMotivation) {
      const mv  = selected.faMotivation;
      const mf  = _faMotivationFit(selected, chosenTeamId);
      const pct = Math.round((_motivMult - 1) * 100); // + = premium, − = discount
      const fitCol = mf.sat > 0.25 ? "var(--green-lt)" : mf.sat < -0.25 ? "var(--red)" : "var(--gray)";
      const fitIco = mf.sat > 0.25 ? "✓" : mf.sat < -0.25 ? "✗" : "—";
      const adj = pct < 0 ? `<b style="color:var(--green-lt)">−${Math.abs(pct)}% ask</b>`
                : pct > 0 ? `<b style="color:var(--red)">+${pct}% ask</b>`
                : `<b style="color:var(--gray)">no change</b>`;
      const yourSituation = mv.driver === "money"
        ? `He'll take the highest bid — fit doesn't move him.`
        : `Your situation: <span style="color:${fitCol};font-weight:700">${fitIco} ${mf.label}</span> · ${adj}`;
      motivHtml = `<div style="padding:.4rem .5rem;background:rgba(0,0,0,.15);border:1px solid var(--border);border-left:3px solid ${fitCol};border-radius:4px;margin-bottom:.45rem">
        <div style="font-size:.53rem;letter-spacing:.7px;color:var(--blgray);margin-bottom:.18rem">MOTIVATION</div>
        <div style="font-size:.72rem;font-weight:700">${mv.icon} Wants ${mv.want}</div>
        <div style="font-size:.63rem;color:var(--gray);margin-top:.18rem">${yourSituation}</div>
      </div>`;
    }

    detailHtml = `<div class="frn-fa-detail">
      ${compareCardHtml}

      <!-- ① Identity -->
      <div class="frn-fa-detail-head" style="margin-bottom:.4rem">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:.38rem;flex-wrap:wrap;margin-bottom:.12rem">
            <span style="font-size:1.05rem;font-weight:900;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px"
              onclick="frnOpenPlayerCard('${escSelName}','${(selected.pid||'').replace(/'/g,"\\'")}')"
              title="View full player card">${selected.name}</span>
            ${_posPillHtml(selected.position)}
            ${gradeBadge(selected)}
            ${!wr ? `<button onclick="frnFAInviteWorkout('${escSelName}')" ${slotsLeft<=0?"disabled":""}
              style="background:rgba(245,197,66,.1);border:1px solid var(--gold);color:var(--gold-lt);font-size:.6rem;padding:.14rem .4rem;border-radius:3px;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0;${slotsLeft<=0?"opacity:.4;cursor:not-allowed;":""}">🏋 WORKOUT${slotsLeft<=0?" (0 left)":` (${slotsLeft} left)`}</button>` : ""}
            ${(franchise._faComparePin === selFaKey || franchise._faComparePin === selected.name)
              ? `<button onclick="frnFAUnpinCompare()" style="background:rgba(245,197,66,.2);border:1px solid var(--gold);color:var(--gold);font-size:.6rem;padding:.14rem .4rem;border-radius:3px;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0">📌 PINNED</button>`
              : `<button onclick="frnFAPinCompare('${escSelName}')" style="background:transparent;border:1px solid var(--border);color:var(--gray);font-size:.6rem;padding:.14rem .4rem;border-radius:3px;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0" title="Pin this FA to compare side-by-side with another">📌 Pin to compare</button>`}
            <span style="font-size:.6rem;color:var(--blgray);margin-left:auto">${ageStage} · age ${selected.age}</span>
          </div>
          <div style="color:var(--gray);font-size:.64rem">${_archetypeLabel(selected)||"—"} · ${draftStr(selected)} · ${careerEarningsStr(selected)}</div>
          ${potTag ? `<div style="font-size:.68rem;color:${isKnown?"var(--green-lt)":"var(--gold-lt)"};font-weight:700;margin-top:.2rem">${potTag}</div>` : ""}
          ${selected.faStory ? `<div style="color:var(--gold-lt);font-size:.67rem;margin-top:.18rem;font-style:italic">"${selected.faStory}"</div>` : ""}
        </div>
      </div>

      <!-- ② Market Pulse -->
      <div style="padding:.45rem .55rem;background:rgba(0,0,0,.2);border-left:3px solid ${heatColor};border-radius:0 4px 4px 0;margin-bottom:.45rem">
        <div style="font-size:.53rem;letter-spacing:.7px;color:var(--blgray);margin-bottom:.22rem">MARKET PULSE</div>
        <div style="font-size:.82rem;font-weight:700">$${selected.demandedAAV.toFixed(1)}M / yr × ${selected.demandedYears} yr</div>
        ${suitors > 0
          ? `<div style="font-size:.67rem;color:${heatColor};margin-top:.18rem">${suitors >= 6 ? "🔥" : "👀"} ~${suitors} team${suitors!==1?"s":""} showing ${suitors>=6?"heavy":suitors>=3?"moderate":"some"} interest</div>`
          : `<div style="font-size:.63rem;color:var(--gray);margin-top:.15rem">No known competing interest</div>`}
        ${workoutHtml}
      </div>

      <!-- ③ Roster Fit -->
      <div style="padding:.38rem .5rem;background:rgba(0,0,0,.15);border:1px solid var(--border);border-radius:4px;margin-bottom:.45rem">
        <div style="font-size:.53rem;letter-spacing:.7px;color:var(--blgray);margin-bottom:.18rem">ROSTER FIT</div>
        <div style="font-size:.7rem;color:${fitColor};font-weight:${fit.upgrade||fit.compete?700:400}">${fitIcon} ${fit.label}</div>
      </div>

      <!-- ③a Motivation -->
      ${motivHtml}

      <!-- ③b Stats + Athletic Profile -->
      ${(()=>{
        const lastSzn = (selected.careerHistory||[]).slice(-1)[0];
        const cols = _careerColsFor(selected.position);
        const statCells = lastSzn ? cols.map(c =>
          `<div style="text-align:center"><div style="font-size:.52rem;color:var(--blgray);letter-spacing:.3px">${c.label}</div><div style="font-size:.78rem;font-weight:700;color:var(--blwhite)">${lastSzn[c.key]||0}</div></div>`
        ).join("") : "";
        const combineStr = _draftCombineStr(selected);
        if (!lastSzn && !combineStr) return "";
        return `<div style="padding:.38rem .5rem;background:rgba(0,0,0,.15);border:1px solid var(--border);border-radius:4px;margin-bottom:.45rem">
          ${lastSzn ? `<div style="font-size:.53rem;letter-spacing:.7px;color:var(--blgray);margin-bottom:.22rem">LAST SEASON · ${lastSzn.gp||0} GP · age ${lastSzn.age||"?"}</div>
          <div style="display:flex;gap:.65rem;flex-wrap:wrap;margin-bottom:.25rem">${statCells}</div>` : ""}
          <div style="font-size:.6rem;color:var(--gray)">📐 ${combineStr}</div>
        </div>`;
      })()}

      <!-- ④ Offer Builder -->
      <div class="frn-fa-offer-form"
           data-demanded-aav="${selected.demandedAAV}"
           data-demanded-years="${selected.demandedYears}">
        <label><span class="frn-meta-label">AAV ($M/yr)</span>
          <input type="number" min="0.5" max="60" step="0.5" value="${offer.aav.toFixed(1)}"
            id="faOfferAav" onchange="frnFASetOffer('${escSelName}','aav',this.value)" oninput="frnFACapLiveUpdate(parseFloat(this.value)||0)">
        </label>
        <label><span class="frn-meta-label">YEARS</span>
          <input type="number" min="1" max="${_maxContractYears(selected)}" step="1" value="${offer.years}"
            id="faOfferYears" onchange="frnFASetOffer('${escSelName}','years',this.value)" oninput="frnFACapLiveUpdate(parseFloat(document.getElementById('faOfferAav').value)||0)"
            title="Position+age cap: max ${_maxContractYears(selected)}yr">
        </label>
        <div class="frn-fa-offer-actions">
          <button class="btn btn-gold" onclick="frnFASubmitOffer('${escSelName}')">${existing?"✓ Update Offer":"+ Submit Offer"}</button>
          ${existing?`<button class="btn btn-outline" onclick="frnFAWithdrawOffer('${escSelName}')">Withdraw</button>`:""}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap;margin-top:.35rem">
        <span class="frn-meta-label" style="margin:0">Structure:</span>
        ${["BALANCED","BACKLOADED","FRONTLOADED"].map(s => {
          const cur = offer.structure || _defaultStructure(selected.age||27, scoutGrade(selected));
          const desc = s==="BALANCED"?"flat salaries":s==="BACKLOADED"?"cheap now, costly later":"costly now, cheap later";
          return `<button class="btn ${cur===s?"btn-gold":"btn-outline"}" onclick="frnFASetOffer('${escSelName}','structure','${s}')" style="font-size:.61rem;padding:.18rem .45rem" title="${desc}">${s[0]+s.slice(1).toLowerCase()}</button>`;
        }).join("")}
      </div>

      <!-- ④b Contract Advisor -->
      ${(() => {
        const goals = [{id:"flex",label:"Flexibility"},{id:"capnow",label:"Cap Now"},{id:"lockup",label:"Long Term"},{id:"lowrisk",label:"Low Risk"}];
        const curGoal = (franchise._faPoolAdvisorGoals||{})[selFaKey] || "flex";
        const suggs = _contractAdvisor(selected, curGoal, cap);
        const goalBtns = goals.map(g => {
          const isActive = curGoal === g.id;
          return `<button class="btn ${isActive?"btn-gold":"btn-outline"}" onclick="frnFASetPoolAdvisorGoal('${escSelName}','${g.id}')" style="font-size:.55rem;padding:.13rem .35rem">${g.label}</button>`;
        }).join("");
        const suggHtml = (suggs || []).slice(0, 2).map(s => `<div style="background:var(--bg3);border-radius:4px;padding:.32rem .45rem;margin-top:.22rem;display:flex;justify-content:space-between;align-items:flex-start;gap:.4rem">
          <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:.62rem;color:var(--gold)">${s.label}</div>
            <div style="color:var(--gray);font-size:.55rem;margin-top:.06rem">${s.note}</div></div>
          <button class="btn btn-outline" onclick="frnFAApplyPoolAdvisor('${escSelName}',${s.years},${s.aav},'${s.structure}')" style="font-size:.55rem;padding:.14rem .35rem;white-space:nowrap;flex-shrink:0">Use $${s.aav.toFixed(1)}M × ${s.years}yr</button>
        </div>`).join("");
        return `<div style="margin-top:.42rem;padding:.4rem .5rem;background:rgba(200,169,0,.06);border:1px solid rgba(200,169,0,.2);border-radius:4px">
          <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;margin-bottom:.22rem">
            <span style="font-size:.55rem;color:var(--gold);letter-spacing:1px;font-weight:700">💡 CONTRACT ADVISOR</span>
            <span style="margin-left:auto;display:flex;gap:.18rem;flex-wrap:wrap">${goalBtns}</span>
          </div>
          ${suggHtml}
        </div>`;
      })()}

      <!-- ⑤ Acceptance + Cap Impact -->
      <div id="fa-accept-row" style="padding:.42rem .55rem;background:var(--bg3);border-radius:4px;margin-top:.42rem;border:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.3rem">
          <span style="font-size:.55rem;letter-spacing:1px;color:var(--gold);font-weight:700">ACCEPT ODDS</span>
          <b id="fa-accept-label" style="color:${lkColor};font-size:.78rem;margin-left:auto">${likelihood}</b>
          <b id="fa-accept-pct" style="color:${lkColor};font-size:.95rem;min-width:2.6rem;text-align:right">${acceptPct}%</b>
        </div>
        <div style="background:rgba(0,0,0,.3);height:6px;border-radius:3px;overflow:hidden;margin-bottom:.35rem">
          <div id="fa-accept-bar" style="height:100%;width:${acceptPct}%;background:${lkColor};transition:width .15s,background .15s"></div>
        </div>
        <div style="font-size:.6rem;color:var(--gray);display:flex;gap:.5rem;flex-wrap:wrap;align-items:baseline">
          <span>Your offer vs demand: <b style="color:${score>=1?"var(--green-lt)":"var(--gold-lt)"}">${(score*100).toFixed(0)}%</b></span>
          <span style="margin-left:auto">Cap hit: <b style="color:${room<0?"var(--red)":"var(--green-lt)"}">$${myProjAfterCuts.toFixed(1)}M</b>
            <span> (${room<0?`<b style="color:var(--red)">${Math.abs(room).toFixed(1)}M over</b>`:`$${room.toFixed(1)}M room`})</span></span>
        </div>
      </div>

      <!-- ⑤b Bidding forecast -->
      ${(()=>{
        // Predicted final signing AAV range based on number of interested
        // AI teams. More suitors → price pushed toward knockout multiplier
        // via the existing _faAIBidAmount escalation. Helps user gauge
        // whether their offer will hold or get outbid.
        const dAAV = Math.max(0.1, selected.demandedAAV || 0);
        let lowMult, highMult, label, color;
        if (suitors === 0)     { lowMult=0.95; highMult=1.00; label="Quiet market";       color="var(--green-lt)"; }
        else if (suitors === 1) { lowMult=1.00; highMult=1.10; label="One competitor";    color="var(--gold-lt)"; }
        else if (suitors === 2) { lowMult=1.05; highMult=1.20; label="Light competition"; color="var(--gold)"; }
        else if (suitors <= 4)  { lowMult=1.10; highMult=1.30; label="Heated";            color="#e8a000"; }
        else                    { lowMult=1.20; highMult=1.40; label="KNOCKOUT TERRITORY"; color="var(--red)"; }
        const lowAAV  = (dAAV * lowMult).toFixed(1);
        const highAAV = (dAAV * highMult).toFixed(1);
        // Fit-aware stance: your EFFECTIVE bid is judged against your
        // motivation-adjusted ask, so a good fit makes you competitive at a
        // lower number than the raw range implies (and vice versa).
        const yourMult = offer.aav / (dAAV * _motivMult);
        const stance = yourMult >= highMult * 0.98 ? `<span style="color:var(--green-lt);font-weight:700">YOU'RE ABOVE THE RANGE</span>`
                     : yourMult >= lowMult * 0.98 ? `<span style="color:var(--gold);font-weight:700">YOU'RE IN THE RANGE</span>`
                     : `<span style="color:var(--red);font-weight:700">YOU'LL GET OUTBID</span>`;
        const fitNote = (_motivMult < 0.97) ? ` <span style="color:var(--green-lt);font-size:.55rem">· fit works for you</span>`
                      : (_motivMult > 1.03) ? ` <span style="color:var(--red);font-size:.55rem">· fit works against you</span>` : "";
        const rivalLine = rivalNames.length
          ? `<div style="font-size:.58rem;color:var(--gray);margin-top:.18rem">${suitors >= 5 ? "🔥" : "👀"} In on him: <b style="color:var(--blwhite)">${rivalNames.join(", ")}</b>${suitors > rivalNames.length ? ` +${suitors - rivalNames.length} more` : ""}</div>`
          : "";
        return `<div style="padding:.42rem .55rem;background:var(--bg3);border-radius:4px;margin-top:.42rem;border:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.2rem">
            <span style="font-size:.55rem;letter-spacing:1px;color:var(--gold);font-weight:700">📈 BIDDING FORECAST</span>
            <span style="color:${color};font-size:.65rem;font-weight:700;margin-left:auto">${label}</span>
          </div>
          <div style="font-size:.65rem;color:var(--blwhite);margin-bottom:.18rem">
            Expected final: <b style="color:${color}">$${lowAAV}M–$${highAAV}M / yr</b>
            <span style="color:var(--gray);font-size:.55rem">· ${suitors} competing team${suitors!==1?"s":""}</span>
          </div>
          ${rivalLine}
          ${threatLine}
          <div style="font-size:.6rem;margin-top:.18rem">${stance}${fitNote}</div>
        </div>`;
      })()}

      <!-- ⑤c Position depth-chart preview -->
      ${(()=>{
        const pos = selected.position;
        const same = myRoster.filter(p => p.position === pos)
          .map(p => ({ name: p.name, ovr: p.overall || 60, isYou: false, age: p.age || 27 }))
          .sort((a, b) => b.ovr - a.ovr);
        // Use scout grade as proxy for the FA's "perceived" ovr — the
        // raw ovr isn't visible to the user, so position rank inserts
        // based on what the user can actually compare against.
        const faOvr = scoutGrade(selected);
        const newGuy = { name: selected.name, ovr: faOvr, isYou: true, age: selected.age || 27 };
        // Insert at the right depth slot
        const slotted = same.slice();
        const insertIdx = slotted.findIndex(p => p.ovr < faOvr);
        if (insertIdx === -1) slotted.push(newGuy);
        else slotted.splice(insertIdx, 0, newGuy);
        const displayCount = Math.min(5, slotted.length);
        const rolesByIdx = { 0: "STARTER", 1: "BACKUP", 2: "DEPTH" };
        const rows = slotted.slice(0, displayCount).map((p, i) => {
          const role = rolesByIdx[i] || `#${i+1}`;
          const isOwned = !p.isYou;
          const wasIdx = isOwned ? same.findIndex(s => s.name === p.name) : null;
          const moved = isOwned && wasIdx !== null && wasIdx !== i;
          const moveTag = moved
            ? `<span style="font-size:.55rem;color:#e8a000;margin-left:.3rem">← from ${rolesByIdx[wasIdx] || `#${wasIdx+1}`}</span>`
            : "";
          return `<div style="display:grid;grid-template-columns:4rem 1fr 2.5rem 1.4rem;gap:.4rem;padding:.2rem .35rem;background:${p.isYou?"rgba(0,180,0,.10)":i % 2 === 0 ? "rgba(255,255,255,.025)":"transparent"};font-size:.62rem;align-items:baseline;border-left:${p.isYou?"3px solid var(--green-lt)":"3px solid transparent"};margin-bottom:.1rem">
            <span style="color:${p.isYou?"var(--green-lt)":"var(--gray)"};font-weight:700;font-size:.55rem">${role}</span>
            <span style="color:${p.isYou?"var(--green-lt)":"var(--white)"};font-weight:${p.isYou?700:400}">${p.isYou?"+ ":""}${p.name}${moveTag}</span>
            <span style="color:var(--gold-lt);text-align:right;font-weight:700">${p.isYou?"~"+faOvr:p.ovr}</span>
            <span style="color:var(--gray);font-size:.55rem;text-align:right">${p.age}yr</span>
          </div>`;
        }).join("");
        const overflow = slotted.length > displayCount ? `<div style="font-size:.55rem;color:var(--gray);text-align:center;font-style:italic;padding-top:.15rem">+${slotted.length - displayCount} more at ${pos}</div>` : "";
        return `<div style="padding:.42rem .55rem;background:var(--bg3);border-radius:4px;margin-top:.42rem;border:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem">
            <span style="font-size:.55rem;letter-spacing:1px;color:var(--gold);font-weight:700">📋 DEPTH CHART · ${pos} IF SIGNED</span>
          </div>
          ${rows}
          ${overflow}
        </div>`;
      })()}

      <!-- ⑥ Contract Preview -->
      ${_buildFAOfferContractPreview(selected, offer)}

      <!-- ⑦ Market Context -->
      ${mktHtml}
    </div>`;
  }

  // Right panel: cut list — queued cuts at top with UNDO, safe (no dead cap) shown by default
  const escForSel = selected ? selected.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'") : "";
  // Offers can be keyed by pid or name — check both like the detail panel does
  const _selCutOffer = selected ? (_faOffers[selFaKey] || _faOffers[selected.name]) : null;
  const cutSet = _selCutOffer ? new Set(_selCutOffer.cutNames || []) : new Set();
  const dcStarters = new Set(
    Object.entries(franchise.depthChart?.[chosenTeamId] || {})
      .filter(([k, s]) => s?.starter && _isFullTimeStarterSlot(k))
      .map(([, s]) => s.starter)
  );

  const _cutQueued = myRoster.filter(p => cutSet.has(p.name));
  const _cutSafe   = myRoster.filter(p => {
    if (cutSet.has(p.name)) return false;
    const { perYear, years } = deadCapOnRelease(p);
    return !(years > 0 && perYear > 0);
  }).sort((a, b) => {
    const as = !!(a.pid && dcStarters.has(a.pid)), bs = !!(b.pid && dcStarters.has(b.pid));
    if (as !== bs) return as ? -1 : 1;
    return (b.contract?.aav||0) - (a.contract?.aav||0);
  });
  const _cutDead = myRoster.filter(p => {
    if (cutSet.has(p.name)) return false;
    const { perYear, years } = deadCapOnRelease(p);
    return years > 0 && perYear > 0;
  }).sort((a, b) => (b.contract?.aav||0) - (a.contract?.aav||0));

  const _showDeadCap = !!(window._faCutShowDeadCap);
  const _buildCutRow = (p, isQueued) => {
    const aav = p.contract?.aav || 0;
    const ep   = (p.name || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const epid = (p.pid  || "").replace(/'/g, "\\'");
    const { perYear: dPY, years: dYrs } = deadCapOnRelease(p);
    const hasDead = dYrs > 0 && dPY > 0;
    const isStarter = !!(p.pid && dcStarters.has(p.pid));
    const rowStyle = isQueued
      ? "background:rgba(255,70,70,.1);border-left:3px solid #ff6b6b;padding:.32rem .35rem .32rem .45rem;margin-bottom:.2rem;border-radius:0 3px 3px 0;display:flex;align-items:center;gap:.3rem"
      : "display:flex;align-items:center;gap:.3rem;padding:.22rem .05rem;border-bottom:1px solid rgba(255,255,255,.04)";
    const actionBtn = selected ? (isQueued
      ? `<button onclick="frnFAToggleCut('${escForSel}','${ep}',false)" title="Undo — keep this player"
          style="background:rgba(255,70,70,.18);border:1px solid #ff6b6b;color:#ff9090;font-size:.56rem;padding:.12rem .3rem;border-radius:3px;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0"
          onmouseover="this.style.background='rgba(255,70,70,.35)'" onmouseout="this.style.background='rgba(255,70,70,.18)'">× UNDO</button>`
      : `<button onclick="frnFAToggleCut('${escForSel}','${ep}',true)" title="Flag for cut"
          style="background:none;border:1px solid var(--border);color:var(--gray);font-size:.56rem;padding:.12rem .3rem;border-radius:3px;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0"
          onmouseover="this.style.borderColor='#ff9090';this.style.color='#ff9090'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--gray)'">✂ CUT</button>`
    ) : "";
    return `<div style="${rowStyle}">
      <span style="font-size:.57rem;color:var(--blgray);font-weight:700;min-width:1.5rem">${p.position}</span>
      <span style="flex:1;font-size:.66rem;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;${isQueued?"color:#ffaaaa":""}"
        onclick="event.stopPropagation();frnOpenPlayerCard('${ep}','${epid}')" title="View player card">${p.name}</span>
      <div style="display:flex;flex-direction:column;align-items:center;gap:.03rem">
        ${gradeBadge(p)}
        ${isStarter?`<span style="font-size:.43rem;color:var(--gold);font-weight:700">START</span>`:""}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.03rem;min-width:3.2rem">
        <span style="font-size:.61rem;color:var(--green-lt);font-weight:700">+$${aav.toFixed(1)}M</span>
        ${hasDead?`<span style="font-size:.49rem;color:var(--red)">☠ $${dPY.toFixed(1)}M dead</span>`:""}
      </div>
      ${actionBtn}
    </div>`;
  };

  const _buildQueuedCard = p => {
    const aav  = p.contract?.aav || 0;
    const ep   = (p.name || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const epid = (p.pid  || "").replace(/'/g, "\\'");
    return `<div style="background:rgba(255,60,60,.13);border:1px solid rgba(255,107,107,.55);border-radius:4px;padding:.38rem .48rem;margin-bottom:.28rem">
      <div style="display:flex;align-items:center;gap:.35rem;margin-bottom:.28rem">
        <span style="font-size:.58rem;color:#ff9090;font-weight:700;flex-shrink:0">${p.position}</span>
        <span style="font-size:.74rem;font-weight:900;color:#ffcccc;flex:1;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px"
          onclick="event.stopPropagation();frnOpenPlayerCard('${ep}','${epid}')">${p.name}</span>
        ${gradeBadge(p)}
        <span style="font-size:.62rem;color:var(--green-lt);font-weight:700;flex-shrink:0">+$${aav.toFixed(1)}M</span>
      </div>
      <button onclick="frnFAToggleCut('${escForSel}','${ep}',false)"
        style="width:100%;background:rgba(255,70,70,.22);border:1px solid #ff6b6b;color:#ffaaaa;font-size:.66rem;font-weight:700;padding:.28rem .4rem;border-radius:3px;cursor:pointer;font-family:inherit;letter-spacing:.4px;text-align:center"
        onmouseover="this.style.background='rgba(255,70,70,.38)';this.style.color='#fff'"
        onmouseout="this.style.background='rgba(255,70,70,.22)';this.style.color='#ffaaaa'">
        × UNDO CUT — Keep ${p.name}
      </button>
    </div>`;
  };
  const queuedSection = _cutQueued.length
    ? `<div style="font-size:.55rem;letter-spacing:.6px;color:#ff9090;font-weight:700;margin:.1rem 0 .28rem;display:flex;align-items:center;gap:.35rem">✂ QUEUED TO CUT <span style="background:rgba(255,70,70,.25);border-radius:3px;padding:.05rem .3rem">${_cutQueued.length}</span></div>`
      + _cutQueued.map(_buildQueuedCard).join("")
      + `<div style="height:.3rem;border-bottom:1px solid var(--border);margin-bottom:.4rem"></div>`
    : "";
  const safeSection = _cutSafe.length
    ? _cutSafe.map(p => _buildCutRow(p, false)).join("")
    : `<div style="color:var(--gray);font-size:.64rem;padding:.4rem 0;font-style:italic">No clean contracts available to cut.</div>`;
  const deadSection = _cutDead.length
    ? `<div style="margin-top:.5rem">
        <button onclick="window._faCutShowDeadCap=!window._faCutShowDeadCap;renderFrnFA('${escForSel}')"
          style="background:none;border:none;color:var(--blgray);font-size:.57rem;cursor:pointer;font-family:inherit;padding:.08rem 0;display:flex;align-items:center;gap:.25rem">
          <span style="color:var(--red)">⚠</span> ${_showDeadCap ? "▾" : "▸"} ${_cutDead.length} player${_cutDead.length!==1?"s":""} with dead cap ${_showDeadCap ? "" : "— show anyway"}
        </button>
        ${_showDeadCap ? `<div style="margin-top:.25rem;padding:.25rem .3rem;background:rgba(255,70,70,.04);border-left:2px solid rgba(255,70,70,.4);border-radius:0 3px 3px 0">${_cutDead.map(p => _buildCutRow(p, false)).join("")}</div>` : ""}
      </div>`
    : "";
  const rosterHtml = queuedSection
    + `<div style="font-size:.53rem;letter-spacing:.5px;color:var(--blgray);font-weight:700;margin-bottom:.22rem">SAFE CUTS · NO DEAD CAP</div>`
    + safeSection + deadSection;

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <button class="btn btn-outline" onclick="renderFrnStartScreen()" style="font-size:.7rem;padding:.2rem .5rem" title="Return to franchise home">⌂</button>
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🆓 FREE AGENCY · Season ${season}</div>
      <div style="font-size:.6rem;color:var(--blgray);letter-spacing:.4px;padding:.18rem .45rem;border:1px solid var(--border);border-radius:3px">
        🏋 WORKOUTS <b style="color:${_workoutSlotsRemaining()>0?"var(--gold-lt)":"var(--red)"}">${_workoutSlotsRemaining()}/${WORKOUT_SLOTS_PER_FA_SEASON}</b>
      </div>
      <button class="btn btn-outline" onclick="frnFAExportCSV()" style="margin-left:auto;font-size:.7rem">
        📊 Export Pool CSV
      </button>
      <button class="btn btn-gold-big" onclick="frnFAProcessOffers()">
        ⏭ END FA & ADVANCE WEEK →
      </button>
    </div>
    <div class="frn-fa-summary" id="frn-fa-summary-bar">
      <span>Roster: <b>$${myCapUsed.toFixed(1)}M</b></span>
      <span style="color:var(--gold)">+ Offers: <b>$${totalOfferedAAV.toFixed(1)}M</b></span>
      <span style="color:var(--gold)">− Cuts: <b>$${totalCutSavings.toFixed(1)}M</b></span>
      <span style="color:${overCap?"var(--red)":"var(--green-lt)"}">
        = Projected: <b>$${projectedCap.toFixed(1)}M</b> / $${cap.toFixed(0)}M
        ${overCap ? `(${(projectedCap-cap).toFixed(1)}M OVER)` : `(${(cap-projectedCap).toFixed(1)}M room)`}
      </span>
    </div>
    ${_faCapTimelineHtml(_faMultiYearCapProjection(4, "offers"),
      "ROSTER + OFFERS − CUTS",
      "Hover an unoffered FA to preview impact")}
    <div class="frn-fa-layout">
      <div class="frn-fa-pool-col">
        <div class="frn-card-title">FREE AGENT POOL (${filtered.length}${filtered.length !== freeAgents.length ? ` / ${freeAgents.length}` : ""})</div>
        ${filterBar}
        <div class="frn-fa-pool-list">${faListHtml.length ? faListHtml : `<div style="color:var(--blgray);font-size:.7rem;padding:.6rem;text-align:center;font-style:italic">No free agents match the filters.</div>`}</div>
      </div>
      <div class="frn-fa-mid-col">
        ${detailHtml || `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center;font-style:italic">Select a free agent on the left to make an offer.</div>`}
      </div>
      <div class="frn-fa-roster-col">
        ${(() => {
          // Cut suggestions — top candidates by net first-year savings
          // (aav − dead cap). Helps user find cap space quickly without
          // scrolling the full roster. Each suggestion has a one-click
          // queue button that drops the player into the cut list.
          const sel = selected ? selected.name : null;
          const sugg = _faSuggestedCuts(chosenTeamId, _cutQueued.map(p => p.name), 4);
          if (!sugg.length || !sel) return "";
          const rows = sugg.map(s => {
            const escName = (s.player.name||"").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
            const dead = s.deadTotal >= 0.5
              ? `<span style="color:#ff9090;font-size:.5rem">☠$${s.deadTotal.toFixed(1)}M</span>`
              : `<span style="color:var(--green-lt);font-size:.5rem">clean</span>`;
            return `<div style="display:grid;grid-template-columns:1.5rem 1fr 2.3rem 1.3rem;gap:.3rem;padding:.22rem .3rem;background:rgba(255,255,255,.02);font-size:.6rem;align-items:baseline;margin-bottom:.12rem;border-radius:3px">
              <span style="color:var(--blgray);font-weight:700;font-size:.55rem">${s.player.position}</span>
              <span style="color:var(--blwhite);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.player.name}</span>
              <span style="color:var(--green-lt);font-weight:700;text-align:right;font-size:.6rem">+$${s.netSavings.toFixed(1)}M</span>
              <button onclick="frnFAToggleCut('${sel.replace(/'/g,"\\'")}','${escName}',true)" style="background:rgba(255,70,70,.18);border:1px solid #ff6b6b;color:#ffaaaa;font-size:.52rem;padding:.1rem .25rem;border-radius:3px;cursor:pointer;font-family:inherit;font-weight:700">CUT</button>
              <span style="grid-column:2/4;color:var(--gray);font-size:.5rem;padding-left:0">${dead} · ${s.player.age}yr · OVR ${s.player.overall} · <i style="color:#e8a000">${s.reason}</i></span>
            </div>`;
          }).join("");
          return `<div style="padding:.4rem .5rem;background:rgba(255,107,107,.06);border:1px solid rgba(255,107,107,.18);border-radius:4px;margin-bottom:.5rem">
            <div style="font-size:.55rem;letter-spacing:1px;color:#ff9090;font-weight:700;margin-bottom:.22rem">💸 SUGGESTED CUTS · by net savings</div>
            ${rows}
          </div>`;
        })()}
        <div class="frn-card-title">CUT LIST</div>
        ${_faNeedsSnippet(chosenTeamId, selected?.position ?? null)}
        <div class="frn-fa-roster-list">${rosterHtml}</div>
      </div>
    </div>`;
}

// Build an estimated year-by-year contract breakdown for an FA offer preview.
// Uses scout grade as the OVR proxy (real OVR is hidden at offer stage).
function _buildFAOfferContractPreview(player, offer) {
  const proxyOvr = scoutGrade(player);
  const struct   = offer.structure || _defaultStructure(player.age || 27, proxyOvr);
  const bonus    = _signingBonusCalc(offer.aav, offer.years, proxyOvr);
  const bases    = _baseSalarySchedule(offer.aav, offer.years, struct, bonus.bonusProration);
  const gtdYrs   = _guaranteedYearsForLength(offer.years);
  const synth    = { contract: {
    aav: offer.aav, years: offer.years, remaining: offer.years, structure: struct,
    baseSalaries: bases, bonusProration: bonus.bonusProration,
    signingBonus: bonus.signingBonus, tradeKicker: bonus.tradeKicker,
    guaranteedYears: gtdYrs,
  }};
  const inner = _buildContractBreakdownBlock(synth);
  if (!inner) return "";
  return `<div style="margin-top:.5rem">
    ${inner}
    <div style="font-size:.57rem;color:var(--blgray);margin-top:.2rem;font-style:italic">
      ★ Bonus estimated from scout grade — actual proration may differ by ±1yr
    </div>
  </div>`;
}

function _ensureFAOffer(faKey) {
  if (!franchise._faOffers) franchise._faOffers = {};
  if (franchise._faOffers[faKey]) return franchise._faOffers[faKey];
  // Find by pid (new) or name (legacy)
  const fa = franchise.freeAgents.find(p => p.pid === faKey || p.name === faKey);
  if (!fa) return null;
  const key = fa.pid || fa.name;
  if (!franchise._faOffers[key]) {
    franchise._faOffers[key] = {
      aav: fa.demandedAAV,
      years: fa.demandedYears,
      structure: _defaultStructure(fa.age || 27, fa.overall || 70),
      cutNames: [],
    };
  }
  return franchise._faOffers[key];
}

function frnFASetOffer(faName, field, value) {
  const offer = _ensureFAOffer(faName); if (!offer) return;
  if (field === "aav")       offer.aav       = Math.max(0.5, parseFloat(value) || 0);
  if (field === "years") {
    const fa = (franchise.freeAgents || []).find(p => p.name === faName);
    const posMax = fa ? _maxContractYears(fa) : 6;
    offer.years = Math.max(1, Math.min(posMax, parseInt(value, 10) || 1));
  }
  if (field === "structure") offer.structure = value;
  saveFranchise();
  renderFrnFA(faName);
}

function frnFACapLiveUpdate(newAavForSelected) {
  // Update accept-odds bar live (reads demanded AAV/years off the form)
  const form = document.querySelector(".frn-fa-offer-form");
  if (form) {
    const demandAAV   = parseFloat(form.getAttribute("data-demanded-aav") || "0");
    const demandYears = parseFloat(form.getAttribute("data-demanded-years") || "0");
    const yearsInput  = document.getElementById("faOfferYears");
    const offerYears  = parseFloat(yearsInput?.value || "0") || demandYears;
    if (demandAAV > 0 && demandYears > 0) {
      const safeDemandAAV = Math.max(0.1, demandAAV);
      const score = (newAavForSelected / safeDemandAAV) * Math.min(offerYears / demandYears, 1);
      const acceptPct = Math.round(Math.max(0, Math.min(100, ((isFinite(score) ? score : 1) - 0.5) * 160)));
      const likelihood = score >= 1.05 ? "Very likely" : score >= 1.00 ? "Likely" : score >= 0.90 ? "Toss-up" : score >= 0.80 ? "Unlikely" : "Will reject";
      const lkColor = score >= 1.00 ? "var(--green-lt)" : score >= 0.90 ? "#e8a000" : "var(--red)";
      const barEl = document.getElementById("fa-accept-bar");
      const lblEl = document.getElementById("fa-accept-label");
      const pctEl = document.getElementById("fa-accept-pct");
      if (barEl) { barEl.style.width = acceptPct + "%"; barEl.style.background = lkColor; }
      if (lblEl) { lblEl.textContent = likelihood; lblEl.style.color = lkColor; }
      if (pctEl) { pctEl.textContent = acceptPct + "%"; pctEl.style.color = lkColor; }
    }
  }

  const bar = document.getElementById("frn-fa-summary-bar");
  if (!bar || !franchise) return;
  const myId = franchise.chosenTeamId;
  const cap = effectiveSalaryCap(myId);
  const myCapUsed = capUsedByTeam(myId);
  let totalOfferedAAV = 0;
  const allCutNames = new Set();
  for (const o of Object.values(franchise._faOffers || {})) {
    totalOfferedAAV += o.aav;
    (o.cutNames || []).forEach(n => allCutNames.add(n));
  }
  const myRoster = franchise.rosters[myId] || [];
  const totalCutSavings = myRoster.filter(p => allCutNames.has(p.name)).reduce((s,p)=>s+(p.contract?.aav||0),0);
  const projectedCap = myCapUsed + totalOfferedAAV - totalCutSavings;
  const overCap = projectedCap > cap;
  bar.innerHTML = `
    <span>Roster: <b>$${myCapUsed.toFixed(1)}M</b></span>
    <span style="color:var(--gold)">+ Offers: <b>$${totalOfferedAAV.toFixed(1)}M</b></span>
    <span style="color:var(--gold)">− Cuts: <b>$${totalCutSavings.toFixed(1)}M</b></span>
    <span style="color:${overCap?"var(--red)":"var(--green-lt)"}">
      = Projected: <b>$${projectedCap.toFixed(1)}M</b> / $${cap.toFixed(0)}M
      ${overCap ? `(${(projectedCap-cap).toFixed(1)}M OVER)` : `(${(cap-projectedCap).toFixed(1)}M room)`}
    </span>`;
}

function frnFAToggleCut(faName, cutName, checked) {
  const offer = _ensureFAOffer(faName); if (!offer) return;
  if (!Array.isArray(offer.cutNames)) offer.cutNames = [];
  if (checked && !offer.cutNames.includes(cutName)) offer.cutNames.push(cutName);
  else offer.cutNames = offer.cutNames.filter(n => n !== cutName);
  saveFranchise();
  renderFrnFA(faName);
}

function frnFAPinCompare(faKey) {
  if (!franchise) return;
  franchise._faComparePin = faKey;
  saveFranchise();
  renderFrnFA();
}
function frnFAUnpinCompare() {
  if (!franchise) return;
  franchise._faComparePin = null;
  saveFranchise();
  renderFrnFA();
}
// Swap pinned with selected — clicking the pinned card promotes the
// pinned FA to selected AND demotes the previously-selected FA into
// the pin slot. Lets the user toggle which is in the main view.
function frnFASwapCompare(newSelKey, newPinKey) {
  if (!franchise) return;
  franchise._faComparePin = newPinKey;
  saveFranchise();
  renderFrnFA(newSelKey);
}
function frnFAApplyPoolAdvisor(faKey, years, aav, structure) {
  if (!franchise._faOffers) franchise._faOffers = {};
  if (!franchise._faOffers[faKey]) {
    const fa = (franchise.freeAgents || []).find(p => p.pid === faKey || p.name === faKey);
    if (!fa) return;
    franchise._faOffers[faKey] = { aav, years, structure, cutNames: [] };
  } else {
    franchise._faOffers[faKey].aav = aav;
    franchise._faOffers[faKey].years = years;
    franchise._faOffers[faKey].structure = structure;
  }
  saveFranchise();
  renderFrnFA(faKey);
}
function frnFASetPoolAdvisorGoal(faKey, goal) {
  franchise._faPoolAdvisorGoals = franchise._faPoolAdvisorGoals || {};
  franchise._faPoolAdvisorGoals[faKey] = goal;
  saveFranchise();
  renderFrnFA(faKey);
}

function frnFASubmitOffer(faName) {
  _ensureFAOffer(faName);
  saveFranchise();
  renderFrnFA(faName);
}

function frnFAWithdrawOffer(faName) {
  if (franchise._faOffers) {
    // Delete both pid-keyed and name-keyed entries so legacy saves can't ghost
    delete franchise._faOffers[faName];
    const alt = (franchise.freeAgents || []).find(p => p.pid === faName || p.name === faName);
    if (alt) delete franchise._faOffers[alt.pid || alt.name];
  }
  saveFranchise();
  renderFrnFA(faName);
}

// Convert this season's initial offers + AI interest into ongoing
// negotiations. From here, counter-bidding happens weekly across the
// regular season until a player signs (no raises in a given week) or
// the season ends with negotiations still open (player leaves the
// league). The user can manage their bids any time from the dashboard.
function frnFAProcessOffers() {
  franchise.faNegotiations = {};
  const myId = franchise.chosenTeamId;

  // Seed: every offer you made becomes a negotiation with you as
  // current high bidder.
  for (const [offerKey, offer] of Object.entries(franchise._faOffers || {})) {
    const fa = franchise.freeAgents.find(p => p.pid === offerKey || p.name === offerKey);
    if (!fa) continue;
    const negKey = fa.pid || fa.name;
    franchise.faNegotiations[negKey] = {
      fa,
      state: "negotiating",
      yourBid: { aav: offer.aav, years: offer.years, structure: offer.structure, cutNames: offer.cutNames || [] },
      aiBids: {},
      history: [{ teamId: myId, label: "You", aav: offer.aav, years: offer.years, week: 0 }],
      raisedThisRound: false,
      lastRaiseWeek: 0,
    };
  }

  // Run an initial AI bid round (week 0) so the user sees competition
  // immediately. AI can bid on FAs the user offered for AND on FAs the
  // user ignored.
  _faAIBidRound(0, /*isInitial=*/true);

  // Surface a news item showing how many AI-only negotiations opened
  const aiOnlyCount = Object.values(franchise.faNegotiations || {})
    .filter(n => !n.yourBid && Object.keys(n.aiBids || {}).length > 0).length;
  if (aiOnlyCount > 0) {
    _pushNews({ type: "fa_activity", label: `📋 ${aiOnlyCount} free agent${aiOnlyCount > 1 ? "s" : ""} entered AI-only negotiations — act before they sign.` });
  }

  // Players the AI didn't bid on either become negotiations with no
  // bids (drop) — they leave the pool.
  franchise._faOffers = {};
  franchise.freeAgents = [];
  // We jump straight into regular-season Week 1 — the dashboard banner
  // surfaces the open negotiations. If the user is over cap they go to
  // the cuts screen first.
  const cap = effectiveSalaryCap(myId);
  const used = capUsedByTeam(myId);
  if (used > cap) {
    franchise._faResults = { signed: [], lost: [] };
    franchise.phase = "free_agency_results";
  } else {
    franchise.phase = "regular";
  }
  saveFranchise();
  showFranchiseDashboard();
}

// Probability that a given AI team enters / counter-bids on a given FA.
// ── GM archetypes (the other half of the people layer) ──────────────────────
// Each AI team's GM has a persistent personality that bends how they bid in FA
// and trade in the draft — so the market is a room full of characters, not one
// calculator. The user can read these tendencies and exploit them: sell high to
// a Win-Now GM, trade down with a Hoarder, find value a Star-Hunter ignores.
//   faAgg    — FA bid ceiling + pursuit aggression (0.8 disciplined … 1.2 reckless)
//   faStar   — extra pursuit of ELITE FAs specifically
//   tradeUp  — draft willingness to move UP (mortgage to climb)
//   tradeDown— draft willingness to move DOWN (stockpile)
//   future   — how they value FUTURE picks (0.7 win-now … 1.25 hoarder)
const _GM_ARCHETYPES = {
  win_now:     { label: "Win-Now",     icon: "🎰", blurb: "pushes the chips in — overpays and trades up",  faAgg: 1.20, faStar: 1.05, tradeUp: 0.90, tradeDown: 0.30, future: 0.70 },
  hoarder:     { label: "Hoarder",     icon: "🗃", blurb: "stockpiles picks — loves to trade down",         faAgg: 0.85, faStar: 0.90, tradeUp: 0.20, tradeDown: 0.95, future: 1.25 },
  value_hawk:  { label: "Value Hawk",  icon: "📊", blurb: "disciplined — won't overpay",                    faAgg: 0.80, faStar: 0.85, tradeUp: 0.40, tradeDown: 0.65, future: 1.05 },
  star_hunter: { label: "Star Hunter", icon: "⭐", blurb: "chases the elite — aggressive for stars",         faAgg: 1.10, faStar: 1.60, tradeUp: 0.80, tradeDown: 0.40, future: 0.85 },
  stand_pat:   { label: "Stand Pat",   icon: "🛡", blurb: "steady — rarely makes a splash",                 faAgg: 0.95, faStar: 1.00, tradeUp: 0.35, tradeDown: 0.50, future: 1.00 },
};
function _ensureGMArchetypes() {
  if (franchise._gmArchetypes) return;
  const keys = Object.keys(_GM_ARCHETYPES);
  // Seeded, balanced round-robin over a deterministic shuffle: every league
  // gets a good mix, and a given playthrough is stable.
  let r = (((franchise.chosenTeamId || 1) * 2654435761) >>> 0) || 1;
  const rng = () => (r = (r * 1664525 + 1013904223) >>> 0) / 4294967296;
  const ids = TEAMS.map(t => t.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const map = {};
  ids.forEach((tid, i) => { map[tid] = keys[i % keys.length]; });
  franchise._gmArchetypes = map;
}
function _teamGMKey(teamId) { _ensureGMArchetypes(); return franchise._gmArchetypes[teamId]; }
function _teamGM(teamId)    { return _GM_ARCHETYPES[_teamGMKey(teamId)] || _GM_ARCHETYPES.stand_pat; }

function _faAIInterest(teamId, fa) {
  const cap   = effectiveSalaryCap(teamId);
  const used  = capUsedByTeam(teamId);
  const room  = cap - used;
  if (room < fa.demandedAAV * 0.6) return 0;        // no chance of affording
  const grade = scoutGrade(fa);
  let base = 0.04;
  if (grade >= 88) base = 0.28;
  else if (grade >= 80) base = 0.16;
  else if (grade >= 72) base = 0.12;
  if (fa._workoutHot) base = Math.min(0.55, base * 1.6); // standout workout drew league-wide attention
  // Team-need factor: teams weaker at this FA's position bid more
  const roster = franchise.rosters[teamId] || [];
  const same = roster.filter(p => p.position === fa.position);
  const bestSame = same.sort((a,b) => b.overall - a.overall)[0];
  if (bestSame && bestSame.overall < fa.overall - 3) base *= 1.8;
  if (room < fa.demandedAAV) base *= 0.4;            // tight cap dampens
  // Motivation fit nudges pursuit — a team that satisfies the FA's motivation
  // chases harder (a contender goes after a ring-chaser; a starting job draws
  // the guy who wants snaps). ±30% swing.
  const _fitSat = (typeof _faMotivationFit === "function") ? _faMotivationFit(fa, teamId).sat : 0;
  base *= 1 + 0.30 * _fitSat;
  // GM personality — Star-Hunters chase the elite hard; aggressive GMs pursue
  // more broadly; disciplined GMs less.
  const _gm = _teamGM(teamId);
  if (grade >= 82) base *= _gm.faStar;     // star bias applies only to the upper tier
  base *= 0.85 + 0.15 * _gm.faAgg;         // mild overall aggression tilt
  return Math.max(0, Math.min(0.55, base));
}

// Decide what an AI bid would be given the current high. Returns
// { aav, years } or null if they can't / won't bid.
function _faAIBidAmount(teamId, fa, currentHighAav) {
  const cap   = effectiveSalaryCap(teamId);
  const room  = cap - capUsedByTeam(teamId);
  const demand = fa.demandedAAV;
  // Floor: just above current high if any, else ~95% of demand
  const floor = currentHighAav ? currentHighAav + 0.5 : demand * 0.92;
  // Knockout chance: high-need team with cap room may go nuclear past
  // 1.35× to lock the player in immediately (≥1.5× triggers knockout sign).
  const roster = franchise.rosters[teamId] || [];
  const same = roster.filter(p => p.position === fa.position);
  const bestSame = same.sort((a,b) => b.overall - a.overall)[0];
  const bigNeed = !bestSame || bestSame.overall < fa.overall - 5;
  const ampleRoom = room >= demand * 1.6;
  // GM personality drives how high they'll go and how likely they blow it up.
  const gm = _teamGM(teamId);
  const goNuclear = bigNeed && ampleRoom && Math.random() < 0.08 * gm.faAgg;
  // Knockout war: any team that has already bid in this neg and has
  // sunk-cost commitment will fight past their normal ceiling.
  const neg = franchise.faNegotiations?.[_negKey(fa)];
  const knockoutWar = neg?.knockoutWar;
  const isWarParticipant = knockoutWar
    && ((neg.aiBids?.[teamId]?.aav || 0) >= demand * FA_KNOCKOUT_MULT * 0.7);
  let ceilMul = goNuclear ? 1.7 : 1.35;
  if (isWarParticipant) ceilMul = 2.1;
  ceilMul *= gm.faAgg;       // Win-Now GMs push higher; disciplined GMs cap lower
  const ceil  = Math.min(demand * ceilMul, room);
  if (floor > ceil) return null;
  // Nuclear / war bids skew toward the top of the range so they actually escalate
  const skewTop = goNuclear || isWarParticipant;
  const t = skewTop ? 0.6 + Math.random() * 0.4 : Math.random();
  const aav = Math.round((floor + t * (ceil - floor)) * 10) / 10;
  const posMax = _maxContractYears(fa);
  const years = Math.max(2, Math.min(fa.demandedYears, 5, posMax));
  return { aav, years };
}

// Stable key for faNegotiations — pid when available, name as fallback.
function _negKey(fa) { return (fa && (fa.pid || fa.name)) || ""; }

// Run one AI bidding round. If isInitial, AI can also OPEN negotiations
// on FAs the user didn't bid on. Otherwise AI only counter-bids on FAs
// already in negotiations.
function _faAIBidRound(week, isInitial) {
  _faContentionMemo = null; // rebuild league-contention once per bid round
  const negs = franchise.faNegotiations || {};
  const candidates = isInitial
    ? [...(franchise.freeAgents || []), ...Object.values(negs).map(n => n.fa)]
    : Object.values(negs).filter(n => n.state === "negotiating").map(n => n.fa);

  for (const fa of candidates) {
    const neg = negs[_negKey(fa)];
    // Current high across yourBid + aiBids
    let highAav = 0, highId = null;
    if (neg?.yourBid) { highAav = neg.yourBid.aav; highId = franchise.chosenTeamId; }
    if (neg) {
      for (const [tid, b] of Object.entries(neg.aiBids || {})) {
        if (b.aav > highAav) { highAav = b.aav; highId = Number(tid); }
      }
    }

    const koThreshold = fa.demandedAAV * FA_KNOCKOUT_MULT;
    for (const t of TEAMS) {
      if (t.id === franchise.chosenTeamId) continue;
      // War participants (teams that already crossed the knockout threshold)
      // skip the interest roll — they have sunk cost and stay in the fight.
      const isWarParticipant = neg?.knockoutWar
        && (neg.aiBids?.[t.id]?.aav || 0) >= koThreshold * 0.7;
      if (!isWarParticipant && Math.random() > _faAIInterest(t.id, fa)) continue;
      // If this AI team is already the high bidder, don't outbid themselves
      if (t.id === highId) continue;
      const bid = _faAIBidAmount(t.id, fa, highAav);
      if (!bid) continue;
      // Lazy-create negotiation if AI is opening a new one
      const nk = _negKey(fa);
      let n = negs[nk];
      if (!n) {
        n = negs[nk] = {
          fa, state: "negotiating", yourBid: null, aiBids: {},
          history: [], raisedThisRound: true, lastRaiseWeek: week,
        };
      }
      n.aiBids[t.id] = bid;
      n.history.push({ teamId: t.id, label: `${t.city} ${t.name}`, aav: bid.aav, years: bid.years, week });
      n.raisedThisRound = true;
      n.lastRaiseWeek = week;
      highAav = bid.aav; highId = t.id;
    }
  }
  // After every team has had its turn, resolve knockouts: solo-knockout
  // signs immediately; contested 150%+ bids escalate into a war.
  for (const fa of candidates) {
    const nk = _negKey(fa);
    if (negs[nk]?.state === "negotiating") _faTryKnockout(nk);
  }
}

// At the end of every regular-season week: resolve any negotiation
// where nobody raised this round. Highest standing bid signs the
// player (if it meets demand). Then mark all negotiations
// raisedThisRound=false so next week is a fresh raise window. If the
// week was the LAST week of the season, force-close all remaining
// negotiations as unsigned.
function _faResolveAfterWeek(week, isSeasonEnd) {
  _faContentionMemo = null; // rebuild league-contention once per resolution pass
  const negs = franchise.faNegotiations || {};
  const myId = franchise.chosenTeamId;
  const newsSigned = [];
  const newsLost   = [];

  for (const [negKey, n] of Object.entries(negs)) {
    if (n.state !== "negotiating") continue;
    const name = n.fa.name; // display name — negKey is the pid-or-name lookup key

    // Pick the winner by VALUE TO THE PLAYER — bid over the team's fit-adjusted
    // demand — not raw dollars. A contender (or a team where he'd start / fits
    // the scheme) can beat a higher bid from a poor-fit team. "money"-motivated
    // FAs have a flat multiplier, so they just go to the top bid. bestSat is the
    // winner's satisfaction ratio (≥ threshold = he signs).
    let highAav = 0, highYrs = 0, highId = null, highIsYou = false, bestSat = -Infinity;
    const _consider = (tid, b, isYou) => {
      const sat = _faBidSatisfaction(n.fa, tid, b.aav);
      if (sat > bestSat) { bestSat = sat; highAav = b.aav; highYrs = b.years; highId = tid; highIsYou = isYou; }
    };
    if (n.yourBid) _consider(myId, n.yourBid, true);
    for (const [tid, b] of Object.entries(n.aiBids)) _consider(Number(tid), b, false);

    // signFn is referenced from BOTH the stable-round branch and the
    // active-bidding else-branch below, so it must be hoisted out of
    // either block. (Previously declared inside the !raisedThisRound
    // arm — calling it from the else-branch threw ReferenceError and
    // aborted the rest of end-of-week resolution.)
    const signFn = () => {
      const _faStruct1 = n.yourBid?.structure || _defaultStructure(n.fa.age || 27, n.fa.overall || 70);
      const _faBonus1  = _signingBonusCalc(highAav, highYrs, n.fa.overall || 70);
      n.fa.contract = {
        years: highYrs, remaining: highYrs, aav: highAav,
        structure: _faStruct1,
        baseSalaries: _baseSalarySchedule(highAav, highYrs, _faStruct1, _faBonus1.bonusProration),
        signingBonus: _faBonus1.signingBonus, bonusProration: _faBonus1.bonusProration,
        guaranteedYears: _guaranteedYearsForLength(highYrs),
        guaranteedAAV: highAav,
        incentives: _generateIncentives(n.fa, highAav),
        // signedAav prevents assignContracts' legacy-save retrofit pass
        // from clobbering this AAV back down to computed market value.
        signedAav: highAav,
        startSeason: (franchise.season || 1) + 1, // FA signings start next season
        signedOvr: n.fa.overall || 70,
      };
      _clearGrudgeFlags(n.fa);
      n.state = "signed";
      n.signedToTeamId = highId;
      n.history.push({ teamId: highId,
        label: highIsYou ? "You SIGN" : `${getTeam(highId)?.name || "?"} SIGN`,
        aav: highAav, years: highYrs, week });
      n.fa.systemYears = 0; // new system — familiarity resets
      franchise.rosters[highId].push(n.fa);
      const signTeam = getTeam(highId);
      if (highIsYou) {
        const myRoster = franchise.rosters[myId];
        for (const cut of (n.yourBid?.cutNames || [])) {
          const i = myRoster.findIndex(p => p.name === cut);
          if (i !== -1) myRoster.splice(i, 1);
        }
        // Comp-pick accounting — each qualifying ($3M+) FA signing offsets
        // one of your declined re-signings for next-draft comp picks.
        franchise._faSignsPending = franchise._faSignsPending || {};
        franchise._faSignsPending[myId] = franchise._faSignsPending[myId] || [];
        franchise._faSignsPending[myId].push({
          name, pos: n.fa.position, aav: highAav, season: franchise.season,
        });
        newsSigned.push({ name, pos: n.fa.position, aav: highAav, years: highYrs });
        _pushNews({ type:"fa_sign",
          label: `🆓 You signed ${n.fa.position} ${name} — $${highAav.toFixed(1)}M × ${highYrs}yr` });
      } else {
        n.signedToTeamName = `${signTeam.city} ${signTeam.name}`;
        _pushNews({ type:"fa_sign",
          label: `🆓 ${signTeam.name} sign ${n.fa.position} ${name} — $${highAav.toFixed(1)}M × ${highYrs}yr` });
      }
    };

    if (!n.raisedThisRound) {
      // Stable round → player signs to the standing high bidder if
      // it meets demand (95% threshold). Otherwise the FA lowers
      // their asking and stays on the market.
      // Roster Builder HC lowers the acceptance threshold — FAs take less to play here.
      const _myHcSpec     = franchise.coaches?.[myId]?.hc?.specialtyTrait;
      const _acceptThresh = (highIsYou && _myHcSpec === "Roster Builder") ? 0.80 : 0.95;
      if (highId != null && bestSat >= _acceptThresh) {
        signFn();
      } else {
        // FA didn't get a satisfactory offer this week — they lower
        // their asking. Slow drop if someone's at least bidding;
        // faster if there are no bids at all.
        n.fa.originalDemandAAV ??= n.fa.demandedAAV;
        const floor = +(n.fa.originalDemandAAV * 0.65).toFixed(1);
        const dropMul = highId != null ? 0.93 : 0.88;  // 7% w/ bids, 12% without
        const newDemand = Math.max(floor, n.fa.demandedAAV * dropMul);
        const atFloor = (n.fa.demandedAAV - floor) < 0.05;
        if (atFloor) {
          // Already at the floor and nobody's biting → off the market
          n.state = "unsigned";
          newsLost.push({ name, pos: n.fa.position });
          _pushNews({ type:"fa_unsigned",
            label: `🆓 ${n.fa.position} ${name} went unsigned — no takers at his floor of $${n.fa.demandedAAV.toFixed(1)}M` });
        } else {
          const prev = n.fa.demandedAAV;
          n.fa.demandedAAV = Math.round(newDemand * 10) / 10;
          n.fa.demandDropsCount = (n.fa.demandDropsCount || 0) + 1;
          _pushNews({ type:"fa_demand_drop",
            label: `🆓📉 ${n.fa.position} ${name} drops asking $${prev.toFixed(1)}M → $${n.fa.demandedAAV.toFixed(1)}M${highId == null ? " (no offers)" : ""}` });
          // Re-check sign threshold against the lowered demand (satisfaction
          // shifts as demand drops).
          if (highId != null && _faBidSatisfaction(n.fa, highId, highAav) >= 0.95) signFn();
        }
      }
    } else if (isSeasonEnd) {
      // Continuous counter-bidding all season → never signs
      n.state = "unsigned";
      newsLost.push({ name, pos: n.fa.position, reason: "endless negotiation" });
    } else {
      // Active bidding week: demand still drifts down slowly (3%) even with
      // counter-bids, then check if the high bid now clears the threshold.
      // This prevents infinite negotiation when AI teams keep making tiny
      // incremental counter-bids that reset the stable-round clock.
      n.fa.originalDemandAAV ??= n.fa.demandedAAV;
      const slowFloor = +(n.fa.originalDemandAAV * 0.65).toFixed(1);
      const driftedDemand = Math.max(slowFloor, Math.round(n.fa.demandedAAV * 0.97 * 10) / 10);
      if (driftedDemand < n.fa.demandedAAV) {
        n.fa.demandedAAV = driftedDemand;
        n.fa.demandDropsCount = (n.fa.demandDropsCount || 0) + 1;
      }
      // If the standing high bid now clears 95% of the drifted (fit-adjusted)
      // demand → sign
      if (highId != null && _faBidSatisfaction(n.fa, highId, highAav) >= 0.95) {
        signFn();
      } else {
        n.raisedThisRound = false;
      }
    }
  }
  franchise._faLastNews = { week, signed: newsSigned, lost: newsLost };
}

// ── User actions on the negotiations screen ──────────────────────────────────
function frnFANegotiationOpen(name) {
  renderFrnFANegotiations(name);
}
function frnFARaiseBid(name, byAmount) {
  const n = franchise.faNegotiations?.[name]; if (!n) return;
  const cur = n.yourBid?.aav || _faNegCurrentHigh(n)?.aav || n.fa.demandedAAV * 0.95;
  const newAav = Math.round((cur + byAmount) * 10) / 10;
  n.yourBid = {
    aav: newAav,
    years: n.yourBid?.years || n.fa.demandedYears,
    cutNames: n.yourBid?.cutNames || [],
  };
  n.history.push({ teamId: franchise.chosenTeamId, label: "You", aav: newAav, years: n.yourBid.years, week: franchise.week });
  n.raisedThisRound = true;
  n.lastRaiseWeek = franchise.week;
  _faTryKnockout(name);
  saveFranchise();
  renderFrnFANegotiations(n.state === "signed" ? null : name);
}
function frnFAMatchHigh(name) {
  const n = franchise.faNegotiations?.[name]; if (!n) return;
  const high = _faNegCurrentHigh(n);
  if (!high) return;
  n.yourBid = {
    aav: high.aav + 0.5,
    years: high.years,
    cutNames: n.yourBid?.cutNames || [],
  };
  n.history.push({ teamId: franchise.chosenTeamId, label: "You (raise)", aav: n.yourBid.aav, years: n.yourBid.years, week: franchise.week });
  n.raisedThisRound = true;
  n.lastRaiseWeek = franchise.week;
  _faTryKnockout(name);
  saveFranchise();
  renderFrnFANegotiations(n.state === "signed" ? null : name);
}
async function frnFAFoldNeg(negKey) {
  const n = franchise.faNegotiations?.[negKey]; if (!n) return;
  if (!await _frnConfirm(`Withdraw from negotiations for ${n.fa.name}?`)) return;
  n.yourBid = null;
  n.history.push({ teamId: franchise.chosenTeamId, label: "You FOLDED", aav: 0, years: 0, week: franchise.week });
  saveFranchise();
  renderFrnFANegotiations();
}
function _faNegCurrentHigh(n) {
  let high = null;
  if (n.yourBid) high = { teamId: franchise.chosenTeamId, ...n.yourBid, isYou: true };
  for (const [tid, b] of Object.entries(n.aiBids)) {
    if (!high || b.aav > high.aav) high = { teamId: Number(tid), ...b, isYou: false };
  }
  return high;
}

// Knockout sign: if exactly ONE standing bid clears 150% of demand the FA
// accepts on the spot. If TWO+ teams clear the threshold, a bidding war
// is declared (knockoutWar=true) and the negotiation continues; both
// teams will need to keep raising. Returns "signed" | "war" | "none".
const FA_KNOCKOUT_MULT = 1.5;
function _faTryKnockout(negKey) {
  const n = franchise.faNegotiations?.[negKey];
  if (!n || n.state !== "negotiating") return "none";
  const name = n.fa.name; // display name — negKey is the pid-or-name lookup key
  // Round to 0.1 to match the rounding applied to bid AAVs — otherwise
  // demand × 1.5 can produce a value an ULP above the rounded bid
  // (e.g. 18.6 × 1.5 → 27.900000000000002 vs bid 27.9) and the >=
  // comparison silently fails.
  const threshold = Math.round(n.fa.demandedAAV * FA_KNOCKOUT_MULT * 10) / 10;
  const ko = [];
  if (n.yourBid && n.yourBid.aav >= threshold)
    ko.push({ teamId: franchise.chosenTeamId, ...n.yourBid, isYou: true });
  for (const [tid, b] of Object.entries(n.aiBids))
    if (b.aav >= threshold) ko.push({ teamId: Number(tid), ...b, isYou: false });
  if (ko.length === 0) return "none";
  if (ko.length > 1) {
    if (!n.knockoutWar) {
      n.knockoutWar = true;
      _pushNews({ type:"fa_war",
        label: `🆓⚔ KNOCKOUT WAR — ${ko.length} teams over $${threshold.toFixed(1)}M for ${n.fa.position} ${name}` });
    }
    return "war";
  }
  // Solo knockout — sign immediately
  const high = ko[0];
  const _faStruct2 = high.structure || _defaultStructure(n.fa.age || 27, n.fa.overall || 70);
  const _faBonus2  = _signingBonusCalc(high.aav, high.years, n.fa.overall || 70);
  n.fa.contract = {
    years: high.years, remaining: high.years, aav: high.aav,
    structure: _faStruct2,
    baseSalaries: _baseSalarySchedule(high.aav, high.years, _faStruct2, _faBonus2.bonusProration),
    signingBonus: _faBonus2.signingBonus, bonusProration: _faBonus2.bonusProration,
    guaranteedYears: _guaranteedYearsForLength(high.years),
    guaranteedAAV: high.aav,
    incentives: _generateIncentives(n.fa, high.aav),
    signedAav: high.aav,
    startSeason: (franchise.season || 1) + 1,
    signedOvr: n.fa.overall || 70,
  };
  _clearGrudgeFlags(n.fa);
  n.state = "signed";
  n.signedToTeamId = high.teamId;
  n.history.push({ teamId: high.teamId,
    label: high.isYou ? "You KNOCKOUT" : `${getTeam(high.teamId)?.name || "?"} KNOCKOUT`,
    aav: high.aav, years: high.years, week: franchise.week });
  n.fa.systemYears = 0; // new system — familiarity resets
  franchise.rosters[high.teamId].push(n.fa);
  const signTeam = getTeam(high.teamId);
  if (high.isYou) {
    const myId = franchise.chosenTeamId;
    const myRoster = franchise.rosters[myId];
    for (const cut of (n.yourBid?.cutNames || [])) {
      const i = myRoster.findIndex(p => p.name === cut);
      if (i !== -1) myRoster.splice(i, 1);
    }
    _pushNews({ type:"fa_sign",
      label: `🆓💥 KNOCKOUT — You signed ${n.fa.position} ${name} for $${high.aav.toFixed(1)}M × ${high.years}yr (over market)` });
  } else {
    n.signedToTeamName = `${signTeam.city} ${signTeam.name}`;
    _pushNews({ type:"fa_sign",
      label: `🆓💥 KNOCKOUT — ${signTeam.name} sign ${n.fa.position} ${name} for $${high.aav.toFixed(1)}M × ${high.years}yr` });
  }
  return "signed";
}

function frnFAOpenSelf() { renderFrnFANegotiations(); }

function frnNegToggleCut(negKey, cutName, checked) {
  const n = franchise.faNegotiations?.[negKey]; if (!n) return;
  if (!n.yourBid) n.yourBid = { aav: 0, years: n.fa.demandedYears, cutNames: [] };
  if (!Array.isArray(n.yourBid.cutNames)) n.yourBid.cutNames = [];
  if (checked && !n.yourBid.cutNames.includes(cutName)) n.yourBid.cutNames.push(cutName);
  else n.yourBid.cutNames = n.yourBid.cutNames.filter(c => c !== cutName);
  saveFranchise();
  renderFrnFANegotiations(negKey);
}

function renderFrnFANegotiations(selectedName) {
  const negs = franchise.faNegotiations || {};
  const myId = franchise.chosenTeamId;
  const cap = effectiveSalaryCap(myId);
  const myCapUsed = capUsedByTeam(myId);
  const myRoster = franchise.rosters[myId] || [];

  const active   = Object.entries(negs).filter(([, n]) => n.state === "negotiating");
  const resolved = Object.entries(negs).filter(([, n]) => n.state !== "negotiating" && n.yourBid);

  // ── Results section (concluded negotiations you bid on) ──────────────────
  const _buildResultsHtml = () => {
    if (!resolved.length) return "";
    const items = resolved.map(([name, n]) => {
      const won      = n.state === "signed" && n.signedToTeamId === myId;
      const unsigned = n.state === "unsigned";
      const statusColor = won ? "var(--green-lt)" : unsigned ? "var(--gray)" : "var(--red)";
      const statusLabel = won ? "✓ WON" : unsigned ? "UNSIGNED" : "✗ LOST";
      let aav, years;
      if (won) { aav = n.yourBid.aav; years = n.yourBid.years; }
      else if (n.state === "signed") {
        const lastH = n.history.slice().reverse().find(h => h.teamId === n.signedToTeamId);
        aav = lastH ? lastH.aav : (n.history[n.history.length-1]?.aav || 0);
        years = lastH ? lastH.years : (n.history[n.history.length-1]?.years || "?");
      } else { aav = n.fa.demandedAAV || 0; years = "—"; }
      const destStr = won
        ? `$${aav.toFixed?aav.toFixed(1):aav}M × ${years}yr · your roster`
        : unsigned ? `Went unsigned`
        : `${n.signedToTeamName || "rival"} · $${aav.toFixed?aav.toFixed(1):aav}M × ${years}yr`;
      const borderCol = won ? "rgba(75,189,100,.35)" : unsigned ? "var(--border)" : "rgba(220,50,50,.35)";
      return `<div style="padding:.3rem .45rem;border-left:3px solid ${borderCol};margin-bottom:.22rem;background:var(--bg2)">
        <div style="display:flex;align-items:center;gap:.3rem">
          <span style="font-size:.58rem;color:var(--gold);font-weight:700;flex-shrink:0">${n.fa.position}</span>
          ${gradeBadge(n.fa)}
          <span style="font-size:.68rem;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.fa.name}</span>
          <span style="font-size:.58rem;font-weight:700;color:${statusColor};flex-shrink:0">${statusLabel}</span>
        </div>
        <div style="font-size:.58rem;color:var(--gray);margin-top:.1rem;padding-left:1.8rem;white-space:normal;line-height:1.3">${destStr}</div>
      </div>`;
    }).join("");
    return `<div style="margin-top:.6rem;border-top:1px solid var(--border);padding-top:.5rem">
      <div style="font-size:.53rem;letter-spacing:.6px;color:var(--blgray);font-weight:700;margin-bottom:.28rem">CONCLUDED</div>
      ${items}
    </div>`;
  };

  if (active.length === 0) {
    $("frnHomeContent").innerHTML = `
      <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
        <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="font-size:.7rem;padding:.2rem .5rem">⌂</button>
        <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🆓 FA TRACKER · Week ${franchise.week}</div>
      </div>
      ${_buildResultsHtml() || `<div style="text-align:center;padding:1.5rem 1rem">
        <div style="font-size:1.05rem;font-weight:700;color:var(--gold)">No active free-agent negotiations.</div>
        <div style="color:var(--gray);font-size:.78rem;margin-top:.4rem">Submit bids during FA to track outcomes here.</div>
      </div>`}`;
    return;
  }

  // ── Selected negotiation ──────────────────────────────────────────────────
  let selKey = selectedName && negs[selectedName]?.state === "negotiating" ? selectedName : null;
  if (!selKey) selKey = active.find(([, n]) => n.yourBid)?.[0] || active[0][0];
  const selNeg = negs[selKey];
  const selHigh = _faNegCurrentHigh(selNeg);
  const escSel  = selKey.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const fa = selNeg.fa;

  // ── Bid state ─────────────────────────────────────────────────────────────
  const yourCur   = selNeg.yourBid?.aav || 0;
  const yourYrs   = selNeg.yourBid?.years || fa.demandedYears;
  const beingOutbid = selHigh && !selHigh.isYou && selNeg.yourBid;
  const baseKO    = +(fa.demandedAAV * FA_KNOCKOUT_MULT).toFixed(1);
  const isKWar    = !!selNeg.knockoutWar;
  const minKBid   = +(Math.max(baseKO, (selHigh?.aav || 0) + 0.5)).toFixed(1);
  const knockoutNeed = Math.max(0, +(minKBid - yourCur).toFixed(1));
  const koLabel   = isKWar ? `⚔ TOP WAR $${minKBid.toFixed(1)}M` : `💥 KNOCKOUT $${minKBid.toFixed(1)}M`;

  // ── Cap math ──────────────────────────────────────────────────────────────
  const cutNamesSet = new Set(selNeg.yourBid?.cutNames || []);
  const cutSavings  = myRoster.filter(p => cutNamesSet.has(p.name)).reduce((s,p)=>s+(p.contract?.aav||0),0);
  const proj        = myCapUsed + yourCur - cutSavings;
  const overCap     = proj > cap;

  // ── Left column: negotiation list rows ───────────────────────────────────
  const listHtml = active.map(([name, n]) => {
    const high = _faNegCurrentHigh(n);
    const isSel = name === selKey;
    const escName = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const youLead = high?.isYou;
    const outbid  = n.yourBid && high && !high.isYou;
    const war     = n.knockoutWar;
    const borderCol = war ? "#ff6b6b44" : outbid ? "#ff6b6b44" : youLead ? "#4dbd6444" : "transparent";
    const statusBadge = war
      ? `<span style="font-size:.5rem;color:var(--red);font-weight:700;flex-shrink:0">⚔ WAR</span>`
      : outbid
      ? `<span style="font-size:.5rem;color:var(--red);font-weight:700;flex-shrink:0">OUTBID</span>`
      : youLead
      ? `<span style="font-size:.5rem;color:var(--green-lt);font-weight:700;flex-shrink:0">YOU LEAD</span>`
      : n.yourBid ? `<span style="font-size:.5rem;color:var(--blgray);flex-shrink:0">BIDDING</span>` : "";
    const heatBadge = war ? `<span style="font-size:.6rem;line-height:1">⚔</span>`
      : outbid ? `<span style="font-size:.6rem;line-height:1">🔥</span>`
      : youLead ? `<span style="font-size:.6rem;line-height:1">👀</span>`
      : `<span style="display:inline-block;width:.7rem"></span>`;
    // Hover preview on cap timeline:
    //   · yourBid negotiations: highlight mode shows which slice of
    //     each year's fill is theirs in the "if you win all bids" view.
    //   · AI-only negotiations (no yourBid yet): add mode shows what
    //     jumping in at the current high bid would cost.
    let hoverOffer = null, hoverMode = "add";
    if (n.yourBid) {
      hoverOffer = { aav: n.yourBid.aav, years: n.yourBid.years, structure: n.yourBid.structure };
      hoverMode = "highlight";
    } else if (high) {
      hoverOffer = { aav: high.aav, years: high.years || n.fa.demandedYears };
      hoverMode = "add";
    }
    const hoverHits = hoverOffer ? _faPendingHitsByYear(n.fa, hoverOffer, 4) : [];
    const hoverAttr = hoverHits.some(h => h > 0)
      ? `data-resign-hits='${JSON.stringify(hoverHits)}' data-resign-cap='${cap}' data-resign-mode='${hoverMode}' onmouseenter="_resignHoverIn(this)" onmouseleave="_resignHoverOut()"`
      : "";
    return `<div class="frn-fa-row ${isSel?"selected":""} ${n.yourBid?"offered":""}"
      style="border-left:3px solid ${borderCol};padding-left:.45rem;cursor:pointer;display:block"
      ${hoverAttr}
      onclick="renderFrnFANegotiations('${escName}')">
      <div style="display:flex;align-items:center;gap:.3rem">
        ${heatBadge}
        <span style="font-size:.58rem;color:var(--gold);font-weight:700;flex-shrink:0">${n.fa.position}</span>
        ${gradeBadge(n.fa)}
        <span class="frn-fa-name" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.68rem">${n.fa.name}</span>
        ${statusBadge}
      </div>
      <div style="display:flex;align-items:center;gap:.3rem;margin-top:.06rem;padding-left:1rem">
        <span class="frn-fa-ask" style="font-size:.62rem">$${high?high.aav.toFixed(1):"—"}M high</span>
        <span style="color:var(--gray);font-size:.55rem">· ${n.fa.age}yr</span>
        ${n.yourBid ? `<span style="font-size:.55rem;color:var(--gold-lt);font-weight:700;margin-left:auto">Your: $${(n.yourBid.aav||0).toFixed(1)}M</span>` : ""}
      </div>
    </div>`;
  }).join("");

  // ── Middle column ─────────────────────────────────────────────────────────
  const potTag   = potentialTag(fa, { known: _isKnownPlayer(fa) });
  const isKnown  = _isKnownPlayer(fa);
  const sGrade   = scoutGrade(fa);
  const ageStage = fa.age<=25?"🌱 Ascending":fa.age<=27?"⬆ Young Prime":fa.age<=30?"★ Prime":fa.age<=32?"⬇ Late Prime":"↘ Declining";

  const posAavs = [];
  for (const r of Object.values(franchise.rosters||{})) for (const p of r) if (p.position===fa.position && p.contract) posAavs.push(p.contract.aav);
  posAavs.sort((a,b)=>b-a);
  const top5Avg  = posAavs.length ? posAavs.slice(0,5).reduce((s,v)=>s+v,0)/Math.min(posAavs.length,5) : 0;
  const mktMedian = posAavs.length ? posAavs[Math.floor(posAavs.length/2)] : 0;
  const mktTop1   = posAavs[0] || 0;
  const valueGap  = top5Avg ? fa.demandedAAV - top5Avg : 0;
  const valueTag  = valueGap < -2 ? "BARGAIN" : valueGap < 2 ? "FAIR" : valueGap < 6 ? "PREMIUM" : "OVERPRICED";
  const vCol      = valueTag==="BARGAIN"?"var(--green-lt)":valueTag==="FAIR"?"var(--gold-lt)":valueTag==="PREMIUM"?"#e8a000":"var(--red)";
  const recMul    = _injuryRecurrenceMul(fa);

  const fit = _faRosterFit(fa, myId);
  const needLvl = _draftNeedLevel(myId, fa.position);
  const fitIcon  = fit.upgrade?"⬆":fit.compete?"⟺":needLvl===2?"❗":needLvl===1?"⚠":"→";
  const fitColor = fit.upgrade?"var(--green-lt)":fit.compete?"var(--gold-lt)":needLvl===2?"#ff9090":needLvl===1?"#e8a000":"var(--blgray)";

  const lastSzn = (fa.careerHistory||[]).slice(-1)[0];
  const cols = _careerColsFor(fa.position);
  const statCells = lastSzn ? cols.map(c=>`<div style="text-align:center"><div style="font-size:.52rem;color:var(--blgray);letter-spacing:.3px">${c.label}</div><div style="font-size:.78rem;font-weight:700;color:var(--blwhite)">${lastSzn[c.key]||0}</div></div>`).join("") : "";
  const combineStr = _draftCombineStr(fa);

  const histHtml = selNeg.history.slice(-12).reverse().map(h=>`
    <tr>
      <td style="color:var(--gray);font-size:.6rem">W${h.week}</td>
      <td style="font-size:.65rem">${h.label}</td>
      <td style="color:var(--gold);font-size:.65rem">$${h.aav.toFixed(1)}M</td>
      <td style="color:var(--gray);font-size:.62rem">${h.years||"—"}yr</td>
    </tr>`).join("");

  const detailHtml = `<div class="frn-fa-detail">

    <div class="frn-fa-detail-head" style="margin-bottom:.4rem">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:.38rem;flex-wrap:wrap;margin-bottom:.12rem">
          <span style="font-size:1.05rem;font-weight:900;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px"
            onclick="frnOpenPlayerCard('${escSel}','${(fa.pid||"").replace(/'/g,"\\'")}')">${fa.name}</span>
          ${_posPillHtml(fa.position)}
          ${gradeBadge(fa)}
          <span style="font-size:.6rem;color:var(--blgray);margin-left:auto">${ageStage} · age ${fa.age}</span>
        </div>
        <div style="color:var(--gray);font-size:.64rem">${_archetypeLabel(fa)||"—"} · ${draftStr(fa)} · ${careerEarningsStr(fa)}</div>
        ${potTag?`<div style="font-size:.68rem;color:${isKnown?"var(--green-lt)":"var(--gold-lt)"};font-weight:700;margin-top:.18rem">${potTag}</div>`:""}
        ${fa.faStory?`<div style="color:var(--gold-lt);font-size:.67rem;margin-top:.18rem;font-style:italic">"${fa.faStory}"</div>`:""}
      </div>
    </div>

    <div style="padding:.45rem .55rem;background:rgba(0,0,0,.2);border-left:3px solid ${isKWar?"var(--red)":selHigh?.isYou?"var(--green-lt)":beingOutbid?"var(--red)":"var(--border)"};border-radius:0 4px 4px 0;margin-bottom:.45rem">
      <div style="font-size:.53rem;letter-spacing:.7px;color:var(--blgray);margin-bottom:.22rem">BID STATUS · Week ${franchise.week}</div>
      <div style="font-size:.82rem;font-weight:700">
        $${selHigh?selHigh.aav.toFixed(1):"—"}M × ${selHigh?selHigh.years:"—"}yr
        <span style="font-size:.62rem;font-weight:400;color:${selHigh?.isYou?"var(--green-lt)":"var(--gray)"}">
          by ${selHigh ? (selHigh.isYou ? "YOU" : (getTeam(selHigh.teamId)?.name||"?")) : "—"}
        </span>
      </div>
      ${selNeg.yourBid ? `
        <div style="font-size:.68rem;color:${beingOutbid?"var(--red)":"var(--green-lt)"};margin-top:.16rem">
          ${beingOutbid?"⚠ You're being outbid":"✓ You're the high bidder"}
          · Your bid: <b>$${yourCur.toFixed(1)}M × ${selNeg.yourBid.years}yr</b>
        </div>` : `
        <div style="font-size:.65rem;color:var(--gray);margin-top:.16rem">You have not entered a bid on this player.</div>`}
      <div style="font-size:.62rem;color:var(--gray);margin-top:.14rem">
        ${selNeg.raisedThisRound
          ? "<span style='color:var(--gold-lt)'>↑ Raise this round — won't sign until next week</span>"
          : "<span style='color:var(--green-lt)'>Stable — signs at end of week if no raise</span>"}
      </div>
      <div style="font-size:.6rem;color:var(--gray);margin-top:.1rem">
        ${isKWar
          ? `⚔ <b style="color:var(--red)">KNOCKOUT WAR</b> — multiple teams over $${baseKO.toFixed(1)}M.`
          : `💥 Sole offer ≥ <b style="color:var(--gold)">$${baseKO.toFixed(1)}M</b> wins instantly (${(FA_KNOCKOUT_MULT*100).toFixed(0)}% of demand).`}
      </div>
    </div>

    <div style="padding:.38rem .5rem;background:rgba(0,0,0,.15);border:1px solid var(--border);border-radius:4px;margin-bottom:.45rem">
      <div style="font-size:.53rem;letter-spacing:.7px;color:var(--blgray);margin-bottom:.18rem">ROSTER FIT</div>
      <div style="font-size:.7rem;color:${fitColor};font-weight:${fit.upgrade||fit.compete?700:400}">${fitIcon} ${fit.label}</div>
    </div>

    ${(lastSzn||combineStr)?`<div style="padding:.38rem .5rem;background:rgba(0,0,0,.15);border:1px solid var(--border);border-radius:4px;margin-bottom:.45rem">
      ${lastSzn?`<div style="font-size:.53rem;letter-spacing:.7px;color:var(--blgray);margin-bottom:.22rem">LAST SEASON · ${lastSzn.gp||0} GP · age ${lastSzn.age||"?"}</div>
        <div style="display:flex;gap:.65rem;flex-wrap:wrap;margin-bottom:.25rem">${statCells}</div>`:""}
      ${combineStr?`<div style="font-size:.6rem;color:var(--gray)">📐 ${combineStr}</div>`:""}
    </div>`:""}

    <div class="frn-fa-offer-form" style="gap:.35rem;flex-direction:column">
      <div style="display:flex;flex-wrap:wrap;gap:.3rem;align-items:center">
        ${selNeg.yourBid ? `
          <button class="btn btn-gold" onclick="frnFARaiseBid('${escSel}',1)">↑ +$1M</button>
          <button class="btn btn-gold" onclick="frnFARaiseBid('${escSel}',3)">↑ +$3M</button>
          ${beingOutbid?`<button class="btn btn-gold" onclick="frnFAMatchHigh('${escSel}')">⟺ Match +$0.5M</button>`:""}
          <button class="btn btn-gold" onclick="frnFAKnockoutBid('${escSel}')"
            style="background:var(--gold);color:#000;font-weight:900">${koLabel}${knockoutNeed>0?` (+$${knockoutNeed.toFixed(1)}M)`:""}</button>
          <button class="btn btn-outline" onclick="frnFAFoldNeg('${escSel}')" style="color:var(--red);margin-left:auto">✗ Fold</button>
        ` : `
          <button class="btn btn-gold" onclick="frnFAEnterBid('${escSel}')">+ Enter Bid</button>
          <button class="btn btn-gold" onclick="frnFAKnockoutBid('${escSel}')"
            style="background:var(--gold);color:#000;font-weight:900">${koLabel}</button>
        `}
      </div>
      <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
        <span class="frn-meta-label" style="margin:0">YEARS</span>
        <button class="btn btn-outline" onclick="frnFASetNegotiationYears('${escSel}',${Math.max(1,yourYrs-1)})" style="font-size:.65rem;padding:.18rem .45rem">−</button>
        <span style="color:var(--gold-lt);font-weight:700;min-width:2.4rem;text-align:center">${yourYrs}yr</span>
        <button class="btn btn-outline" onclick="frnFASetNegotiationYears('${escSel}',${Math.min(7,yourYrs+1)})" style="font-size:.65rem;padding:.18rem .45rem">+</button>
        <span style="color:var(--gray);font-size:.6rem">FA wants ${fa.demandedYears}yr</span>
      </div>
      <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap">
        <span class="frn-meta-label" style="margin:0">STRUCTURE</span>
        ${["BALANCED","BACKLOADED","FRONTLOADED"].map(s=>{
          const cur = selNeg.yourBid?.structure||_defaultStructure(fa.age||27,fa.overall||70);
          return `<button class="btn ${cur===s?"btn-gold":"btn-outline"}" onclick="frnFASetStructure('${escSel}','${s}')" style="font-size:.6rem;padding:.18rem .42rem">${s[0]+s.slice(1).toLowerCase()}</button>`;
        }).join("")}
      </div>
    </div>

    <div style="display:flex;align-items:center;gap:.6rem;padding:.42rem .55rem;background:var(--bg3);border-radius:4px;margin-top:.42rem;flex-wrap:wrap;border:1px solid var(--border)">
      <div style="font-size:.72rem">If you win: <b style="color:${overCap?"var(--red)":"var(--green-lt)"}">$${proj.toFixed(1)}M</b>
        <span style="font-size:.6rem;color:var(--gray)"> / $${cap.toFixed(0)}M ${overCap?`(${(proj-cap).toFixed(1)}M over)`:`(${(cap-proj).toFixed(1)}M room)`}</span>
      </div>
      ${cutSavings?`<span style="font-size:.62rem;color:var(--gold)">− $${cutSavings.toFixed(1)}M planned cuts</span>`:""}
    </div>

    ${(()=>{
      const goals = [{id:"flex",label:"Flexibility"},{id:"capnow",label:"Cap Now"},{id:"lockup",label:"Long Term"},{id:"lowrisk",label:"Low Risk"}];
      const suggs = _contractAdvisor(fa, selNeg._advisorGoal||"flex", cap);
      const goalBtns = goals.map(g=>{
        const isActive=(selNeg._advisorGoal||"flex")===g.id;
        return `<button class="btn ${isActive?"btn-gold":"btn-outline"}" onclick="frnFASetAdvisorGoal('${escSel}','${g.id}')" style="font-size:.58rem;padding:.15rem .38rem">${g.label}</button>`;
      }).join("");
      const suggHtml = suggs.map(s=>`<div style="background:var(--bg3);border-radius:4px;padding:.38rem .5rem;margin-top:.28rem;display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem">
        <div><div style="font-weight:700;font-size:.67rem;color:var(--gold)">${s.label}</div>
          <div style="color:var(--gray);font-size:.59rem;margin-top:.08rem">${s.note}</div></div>
        <button class="btn btn-outline" onclick="frnFAApplyAdvisor('${escSel}',${s.years},${s.aav},'${s.structure}')" style="font-size:.58rem;padding:.15rem .4rem;white-space:nowrap">Use $${s.aav.toFixed(1)}M × ${s.years}yr</button>
      </div>`).join("");
      return `<div style="margin-top:.6rem;padding:.45rem .55rem;background:rgba(200,169,0,.06);border:1px solid rgba(200,169,0,.2);border-radius:6px">
        <div style="font-size:.67rem;font-weight:700;color:var(--gold);margin-bottom:.35rem">🤝 CONTRACT ADVISOR</div>
        <div style="display:flex;flex-wrap:wrap;gap:.22rem">${goalBtns}</div>
        ${suggHtml}
      </div>`;
    })()}

    <div style="padding:.4rem .5rem;background:var(--bg3);border:1px solid var(--border);border-radius:4px;margin-top:.55rem">
      <div style="font-size:.53rem;letter-spacing:.6px;color:var(--blgray);margin-bottom:.22rem">SCOUT VERDICT</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.4rem;font-size:.68rem">
        <div><span class="frn-meta-label">PRICE</span><b style="color:${vCol}">${valueTag}</b></div>
        <div><span class="frn-meta-label">GRADE</span><b style="color:var(--gold)">${gradeLabel(sGrade)}</b></div>
        <div><span class="frn-meta-label">STAGE</span><b>${fa.age<=27?"Ascending":fa.age<=30?"Prime":fa.age<=32?"Late Prime":"Declining"}</b></div>
        <div><span class="frn-meta-label">INJ RISK</span><b style="color:${recMul>1.4?"#ff9090":"var(--white)"}">${recMul>1.2?`${(recMul*100-100).toFixed(0)}% ↑`:"Normal"}</b></div>
      </div>
      ${posAavs.length?`<div style="font-size:.6rem;color:var(--gray);margin-top:.3rem">
        ${fa.position} market — top5 avg <b style="color:var(--gold-lt)">$${top5Avg.toFixed(1)}M</b> · median <b style="color:var(--gold-lt)">$${mktMedian.toFixed(1)}M</b> · top <b style="color:var(--gold)">$${mktTop1.toFixed(1)}M</b>.
        Demand: <b style="color:var(--gold-lt)">$${fa.demandedAAV.toFixed(1)}M</b>${fa.originalDemandAAV&&fa.originalDemandAAV>fa.demandedAAV?` <span style="color:#ff9090">(was $${fa.originalDemandAAV.toFixed(1)}M, dropped ${fa.demandDropsCount}×)</span>`:""}.
      </div>`:""}
    </div>

    <div style="margin-top:.6rem">
      <div style="font-size:.53rem;letter-spacing:.6px;color:var(--blgray);font-weight:700;margin-bottom:.25rem">BID HISTORY</div>
      <table class="frn-pre-roster-table">
        <thead><tr><th>Wk</th><th>By</th><th>AAV</th><th>Yrs</th></tr></thead>
        <tbody>${histHtml}</tbody>
      </table>
    </div>

  </div>`;

  // ── Right column: cut list tied to this negotiation ───────────────────────
  const dcStarters = new Set(
    Object.entries(franchise.depthChart?.[myId]||{})
      .filter(([k, s]) => s?.starter && _isFullTimeStarterSlot(k))
      .map(([, s]) => s.starter)
  );
  const _cutQueued = myRoster.filter(p => cutNamesSet.has(p.name));
  const _cutSafe   = myRoster.filter(p => {
    if (cutNamesSet.has(p.name)) return false;
    const { perYear, years } = deadCapOnRelease(p);
    return !(years>0 && perYear>0);
  }).sort((a,b)=>{
    const as=!!(a.pid&&dcStarters.has(a.pid)), bs=!!(b.pid&&dcStarters.has(b.pid));
    if (as!==bs) return as?-1:1;
    return (b.contract?.aav||0)-(a.contract?.aav||0);
  });
  const _cutDead = myRoster.filter(p => {
    if (cutNamesSet.has(p.name)) return false;
    const { perYear, years } = deadCapOnRelease(p);
    return years>0 && perYear>0;
  }).sort((a,b)=>(b.contract?.aav||0)-(a.contract?.aav||0));
  const _showDeadCap = !!(window._faCutShowDeadCap);

  const _negCutRow = p => {
    const ep   = (p.name||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    const epid = (p.pid||"").replace(/'/g,"\\'");
    const aav  = p.contract?.aav||0;
    const {perYear:dPY,years:dYrs} = deadCapOnRelease(p);
    const hasDead = dYrs>0&&dPY>0;
    const isStarter = !!(p.pid&&dcStarters.has(p.pid));
    const isQueued = cutNamesSet.has(p.name);
    const rowStyle = isQueued
      ? "background:rgba(255,70,70,.1);border-left:3px solid #ff6b6b;padding:.32rem .35rem .32rem .45rem;margin-bottom:.2rem;border-radius:0 3px 3px 0;display:flex;align-items:center;gap:.3rem"
      : "display:flex;align-items:center;gap:.3rem;padding:.22rem .05rem;border-bottom:1px solid rgba(255,255,255,.04)";
    const actionBtn = isQueued
      ? `<button onclick="frnNegToggleCut('${escSel}','${ep}',false)"
          style="background:rgba(255,70,70,.18);border:1px solid #ff6b6b;color:#ff9090;font-size:.56rem;padding:.12rem .3rem;border-radius:3px;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0"
          onmouseover="this.style.background='rgba(255,70,70,.35)'" onmouseout="this.style.background='rgba(255,70,70,.18)'">× UNDO</button>`
      : `<button onclick="frnNegToggleCut('${escSel}','${ep}',true)"
          style="background:none;border:1px solid var(--border);color:var(--gray);font-size:.56rem;padding:.12rem .3rem;border-radius:3px;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0"
          onmouseover="this.style.borderColor='#ff9090';this.style.color='#ff9090'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--gray)'">✂ CUT</button>`;
    return `<div style="${rowStyle}">
      <span style="font-size:.57rem;color:var(--blgray);font-weight:700;min-width:1.5rem">${p.position}</span>
      <span style="flex:1;font-size:.66rem;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;${isQueued?"color:#ffaaaa":""}"
        onclick="event.stopPropagation();frnOpenPlayerCard('${ep}','${epid}')">${p.name}</span>
      <div style="display:flex;flex-direction:column;align-items:center;gap:.03rem">
        ${gradeBadge(p)}${isStarter?`<span style="font-size:.43rem;color:var(--gold);font-weight:700">START</span>`:""}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.03rem;min-width:3.2rem">
        <span style="font-size:.61rem;color:var(--green-lt);font-weight:700">+$${aav.toFixed(1)}M</span>
        ${hasDead?`<span style="font-size:.49rem;color:var(--red)">☠ $${dPY.toFixed(1)}M dead</span>`:""}
      </div>
      ${actionBtn}
    </div>`;
  };

  const _negQueuedCard = p => {
    const ep   = (p.name||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    const epid = (p.pid||"").replace(/'/g,"\\'");
    const aav  = p.contract?.aav||0;
    return `<div style="background:rgba(255,60,60,.13);border:1px solid rgba(255,107,107,.55);border-radius:4px;padding:.38rem .48rem;margin-bottom:.28rem">
      <div style="display:flex;align-items:center;gap:.35rem;margin-bottom:.28rem">
        <span style="font-size:.58rem;color:#ff9090;font-weight:700;flex-shrink:0">${p.position}</span>
        <span style="font-size:.74rem;font-weight:900;color:#ffcccc;flex:1;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px"
          onclick="event.stopPropagation();frnOpenPlayerCard('${ep}','${epid}')">${p.name}</span>
        ${gradeBadge(p)}
        <span style="font-size:.62rem;color:var(--green-lt);font-weight:700;flex-shrink:0">+$${aav.toFixed(1)}M</span>
      </div>
      <button onclick="frnNegToggleCut('${escSel}','${ep}',false)"
        style="width:100%;background:rgba(255,70,70,.22);border:1px solid #ff6b6b;color:#ffaaaa;font-size:.66rem;font-weight:700;padding:.28rem .4rem;border-radius:3px;cursor:pointer;font-family:inherit;letter-spacing:.4px;text-align:center"
        onmouseover="this.style.background='rgba(255,70,70,.38)';this.style.color='#fff'"
        onmouseout="this.style.background='rgba(255,70,70,.22)';this.style.color='#ffaaaa'">
        × UNDO CUT — Keep ${p.name}
      </button>
    </div>`;
  };

  const queuedSection = _cutQueued.length
    ? `<div style="font-size:.55rem;letter-spacing:.6px;color:#ff9090;font-weight:700;margin:.1rem 0 .28rem;display:flex;align-items:center;gap:.35rem">✂ QUEUED TO CUT <span style="background:rgba(255,70,70,.25);border-radius:3px;padding:.05rem .3rem">${_cutQueued.length}</span></div>`
      + _cutQueued.map(_negQueuedCard).join("")
      + `<div style="height:.3rem;border-bottom:1px solid var(--border);margin-bottom:.4rem"></div>`
    : "";
  const safeSection = _cutSafe.length
    ? _cutSafe.map(p=>_negCutRow(p)).join("")
    : `<div style="color:var(--gray);font-size:.64rem;padding:.4rem 0;font-style:italic">No clean contracts to cut.</div>`;
  const deadSection = _cutDead.length
    ? `<div style="margin-top:.5rem">
        <button onclick="window._faCutShowDeadCap=!window._faCutShowDeadCap;renderFrnFANegotiations('${escSel}')"
          style="background:none;border:none;color:var(--blgray);font-size:.57rem;cursor:pointer;font-family:inherit;padding:.08rem 0;display:flex;align-items:center;gap:.25rem">
          <span style="color:var(--red)">⚠</span> ${_showDeadCap?"▾":"▸"} ${_cutDead.length} player${_cutDead.length!==1?"s":""} with dead cap ${_showDeadCap?"":"— show anyway"}
        </button>
        ${_showDeadCap?`<div style="margin-top:.25rem;padding:.25rem .3rem;background:rgba(255,70,70,.04);border-left:2px solid rgba(255,70,70,.4);border-radius:0 3px 3px 0">${_cutDead.map(p=>_negCutRow(p)).join("")}</div>`:""}
      </div>` : "";
  const rosterHtml = queuedSection
    + `<div style="font-size:.53rem;letter-spacing:.5px;color:var(--blgray);font-weight:700;margin-bottom:.22rem">SAFE CUTS · NO DEAD CAP</div>`
    + safeSection + deadSection;

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="font-size:.7rem;padding:.2rem .5rem" title="Return to franchise home">⌂</button>
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🆓 FA NEGOTIATIONS · Week ${franchise.week}</div>
      <div style="font-size:.6rem;color:var(--blgray);letter-spacing:.4px;padding:.18rem .45rem;border:1px solid var(--border);border-radius:3px">
        ${active.length} active · ${resolved.length} concluded
      </div>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto;font-size:.7rem">← Dashboard</button>
    </div>
    <div class="frn-fa-summary">
      <span>Roster: <b>$${myCapUsed.toFixed(1)}M</b></span>
      ${yourCur?`<span style="color:var(--gold)">+ This bid: <b>$${yourCur.toFixed(1)}M</b></span>`:""}
      ${cutSavings?`<span style="color:var(--gold)">− Cuts: <b>$${cutSavings.toFixed(1)}M</b></span>`:""}
      <span style="color:${overCap?"var(--red)":"var(--green-lt)"}">
        = Projected: <b>$${proj.toFixed(1)}M</b> / $${cap.toFixed(0)}M
        ${overCap?`(${(proj-cap).toFixed(1)}M OVER)`:`(${(cap-proj).toFixed(1)}M room)`}
      </span>
    </div>
    ${_faCapTimelineHtml(_faMultiYearCapProjection(4, "negotiations"),
      "ROSTER + ACTIVE BIDS − CUTS",
      "Assumes you win every active bid")}
    <div class="frn-fa-layout">
      <div class="frn-fa-pool-col">
        <div class="frn-card-title">ACTIVE NEGOTIATIONS (${active.length})</div>
        <div class="frn-fa-pool-list">${listHtml}</div>
        ${_buildResultsHtml()}
      </div>
      <div class="frn-fa-mid-col">
        ${detailHtml}
      </div>
      <div class="frn-fa-roster-col">
        <div class="frn-card-title">CUT LIST</div>
        ${_faNeedsSnippet(myId, fa.position)}
        <div class="frn-fa-roster-list">${rosterHtml}</div>
      </div>
    </div>`;

}

function frnFAEnterBid(name) {
  const n = franchise.faNegotiations?.[name]; if (!n) return;
  const high = _faNegCurrentHigh(n);
  const aav = high ? Math.round((high.aav + 0.5) * 10) / 10 : n.fa.demandedAAV;
  n.yourBid = { aav, years: n.fa.demandedYears, cutNames: [] };
  n.history.push({ teamId: franchise.chosenTeamId, label: "You (joined)", aav, years: n.fa.demandedYears, week: franchise.week });
  n.raisedThisRound = true;
  n.lastRaiseWeek = franchise.week;
  _faTryKnockout(name);
  saveFranchise();
  renderFrnFANegotiations(n.state === "signed" ? null : name);
}

// Drop a knockout bid: at minimum 150% of demand, but in an ongoing war
// it must clear the current high by $0.5M. Triggers instant sign only
// if you're the SOLE team over the knockout threshold; otherwise the
// war keeps escalating.
async function frnFAKnockoutBid(negKey) {
  const n = franchise.faNegotiations?.[negKey]; if (!n) return;
  const name = n.fa.name; // display name — negKey is the pid-or-name lookup key
  const baseKO  = n.fa.demandedAAV * FA_KNOCKOUT_MULT;
  const curHigh = _faNegCurrentHigh(n);
  const minBid  = Math.max(baseKO, (curHigh?.aav || 0) + 0.5);
  const knockoutAav = Math.round(minBid * 10) / 10;
  const myId = franchise.chosenTeamId;
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const room = cap - capUsedByTeam(myId);
  const cutSavings = (n.yourBid?.cutNames || []).reduce((s, cutName) => {
    const p = (franchise.rosters[myId] || []).find(x => x.name === cutName);
    return s + (p?.contract?.aav || 0);
  }, 0);
  if (knockoutAav - cutSavings > room) {
    alert(`Not enough cap room: knockout needs $${knockoutAav.toFixed(1)}M, you have $${(room + cutSavings).toFixed(1)}M (after planned cuts).`);
    return;
  }
  const isWar = !!n.knockoutWar;
  const label = isWar ? "TOP KNOCKOUT" : "KNOCKOUT BID";
  if (!await _frnConfirm(`💥 ${label} — pay $${knockoutAav.toFixed(1)}M × ${n.yourBid?.years || n.fa.demandedYears}yr for ${name}?${isWar ? "\n\nThis is a bidding war — other teams may keep raising next week." : ""}`)) return;
  n.yourBid = {
    aav: knockoutAav,
    years: n.yourBid?.years || n.fa.demandedYears,
    cutNames: n.yourBid?.cutNames || [],
  };
  n.history.push({ teamId: myId, label: `You (${label})`, aav: knockoutAav, years: n.yourBid.years, week: franchise.week });
  n.raisedThisRound = true;
  n.lastRaiseWeek = franchise.week;
  const result = _faTryKnockout(negKey);
  if (result === "war") {
    alert(`⚔ BIDDING WAR — another team is also over $${baseKO.toFixed(1)}M for ${name}. Keep raising next week to outlast them.`);
  }
  saveFranchise();
  renderFrnFANegotiations(n.state === "signed" ? null : negKey);
}

// Adjust contract length on an active offer. Capped at 1..7 years.
// A longer contract reads as more commitment to the FA, but each
// year also adds dead-money risk for the team — the AI agents
// weight years × aav when picking the winning bid, so this is a
// real lever for the user, not just cosmetic.
function frnFASetStructure(name, structure) {
  const n = franchise.faNegotiations?.[name]; if (!n) return;
  if (!n.yourBid) n.yourBid = { aav: 0, years: n.fa.demandedYears, cutNames: [] };
  n.yourBid.structure = structure;
  saveFranchise();
  renderFrnFANegotiations(name);
}

function frnFASetNegotiationYears(name, years) {
  const n = franchise.faNegotiations?.[name]; if (!n) return;
  const y = Math.max(1, Math.min(7, Math.round(Number(years) || 1)));
  if (!n.yourBid) {
    // Allow setting years before placing a bid — they apply on entry.
    n.yourBid = { aav: 0, years: y, cutNames: [] };
  } else {
    n.yourBid.years = y;
  }
  n.history.push({ teamId: franchise.chosenTeamId, label: `You (years → ${y})`,
    aav: n.yourBid.aav || 0, years: y, week: franchise.week });
  n.raisedThisRound = true;
  n.lastRaiseWeek = franchise.week;
  saveFranchise();
  renderFrnFANegotiations(name);
}

function frnFASetAdvisorGoal(name, goal) {
  const n = franchise.faNegotiations?.[name]; if (!n) return;
  n._advisorGoal = goal;
  saveFranchise();
  renderFrnFANegotiations(name);
}

function frnFAApplyAdvisor(name, years, aav, structure) {
  const n = franchise.faNegotiations?.[name]; if (!n) return;
  if (!n.yourBid) n.yourBid = { aav: 0, years, cutNames: [], structure };
  n.yourBid.years = years;
  n.yourBid.aav   = aav;
  n.yourBid.structure = structure;
  n.raisedThisRound = true;
  n.lastRaiseWeek = franchise.week;
  n.history.push({ teamId: franchise.chosenTeamId, label: `You (advisor: $${aav}M × ${years}yr)`, aav, years, week: franchise.week });
  saveFranchise();
  renderFrnFANegotiations(name);
}

function renderFrnFAResults() {
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const used = capUsedByTeam(franchise.chosenTeamId);
  const overCap = used > cap;
  const { signed = [], lost = [] } = franchise._faResults || {};

  const signedHtml = signed.length ? `
    <div class="frn-card-box" style="margin-top:.6rem">
      <div class="frn-card-title">✓ SIGNED (${signed.length})</div>
      ${signed.map(s => `<div style="font-size:.78rem;padding:.3rem 0;border-bottom:1px solid var(--border)">
        <b style="color:var(--gold-lt)">${s.name}</b> (${s.pos}) — $${s.aav.toFixed(1)}M/yr × ${s.years}yr
        ${s.cut.length ? `<div style="color:var(--gray);font-size:.65rem;margin-top:.15rem">Released: ${s.cut.join(", ")}</div>` : ""}
      </div>`).join("")}
    </div>` : "";
  const lostHtml = lost.length ? `
    <div class="frn-card-box" style="margin-top:.6rem">
      <div class="frn-card-title">✗ DECLINED (${lost.length})</div>
      ${lost.map(l => `<div style="font-size:.78rem;padding:.3rem 0;border-bottom:1px solid var(--border)">
        <b>${l.name}</b> (${l.pos}) — offered $${l.offered.toFixed(1)}M, wanted $${l.demanded.toFixed(1)}M
      </div>`).join("")}
    </div>` : "";

  $("frnHomeContent").innerHTML = `
    <div style="text-align:center;margin-bottom:1rem">
      <div style="font-size:1.2rem;font-weight:900;color:var(--gold)">📋 FREE AGENCY RESULTS</div>
      <div style="color:var(--gray);font-size:.78rem">A week has passed. Here's how your offers landed.</div>
    </div>
    ${signedHtml || `<div style="color:var(--gray);text-align:center;font-size:.78rem">No new players signed.</div>`}
    ${lostHtml}
    ${_faCapTimelineHtml(_faMultiYearCapProjection(4, "offers"),
      "POST-FA ROSTER", "")}
    <div class="frn-card-box" style="margin-top:.6rem">
      <div class="frn-card-title">CAP STATUS</div>
      <div style="font-size:.85rem;padding:.4rem 0">
        Cap used: <b style="color:${overCap?"var(--red)":"var(--white)"}">$${used.toFixed(1)}M</b>
        / <b style="color:var(--gold)">$${cap.toFixed(0)}M</b>
        ${overCap
          ? `<div style="color:var(--red);font-weight:700;margin-top:.4rem">
              ⚠ OVER CAP by $${(used-cap).toFixed(1)}M.
              You have one grace week — start the season anyway, but you must be cap-legal before Week 2.
            </div>`
          : `<div style="color:var(--green-lt);margin-top:.3rem">✓ Cap-legal — ready for Week 1.</div>`}
      </div>
    </div>
    <div class="frn-actions" style="justify-content:center;margin-top:1rem">
      ${overCap
        ? `<button class="btn btn-gold-big" onclick="frnFAGoToCuts()">→ MAKE CUTS NOW</button>
           <button class="btn btn-outline" onclick="frnFAStartWithGrace()" style="color:var(--gold)">Defer cuts — start Week 1 anyway</button>`
        : `<button class="btn btn-gold-big" onclick="frnConfirmFAFinish()">▶ START WEEK 1</button>`}
    </div>`;
}

function frnFAGoToCuts() {
  franchise.phase = "fa_cuts";
  saveFranchise();
  renderFrnFACuts();
}

async function frnFAStartWithGrace() {
  // 1-week grace: deadline is end of Week 1
  franchise.capGraceDeadline = 2;
  frnFAFinish();
}

// ── Custom dialog wrapper ─────────────────────────────────────────────
// Confirm wrapper — Promise<boolean>-returning shim that routes to the styled
// modal (_frnConfirmModal in play-franchise-core.js). Drop-in replacement for
// confirm(): same single-arg signature, just `await` it instead of treating
// the return value as sync. Optional 2nd-arg object for title/danger/etc.
//
// Callers should be `async` and use `if (!await _frnConfirm(msg))`. Existing
// sync-style usage `if (!_frnConfirm(msg))` will silently fail (always truthy
// Promise) — the conversion to await is mechanical and we've done a sweep.
async function _frnConfirm(msg, opts) {
  const o = opts || {};
  if (typeof _frnConfirmModal === "function") {
    return _frnConfirmModal({
      title: o.title || "Confirm",
      body: msg,
      confirmLabel: o.confirmLabel || (o.danger ? "Yes, do it" : "Continue"),
      cancelLabel:  o.cancelLabel  || "Cancel",
      danger: !!o.danger,
      requireTypeName: o.requireTypeName || null,
    });
  }
  // Fallback to native if the modal helper isn't loaded yet (shouldn't happen
  // since both live on the franchise pages).
  return window.confirm(msg);
}
function _frnAlert(msg) {
  return window.alert(msg);
}

// Decision helpers — one shared utility computes the cut economics for
// each player so the UI, sorter, and auto-cut algorithm all see the
// same numbers. The public _faCutEconomics is a memo wrapper around
// _faCutEconomicsImpl; cache is reset at the top of renderFrnFACuts so
// each render starts fresh but all the filter/sort/render passes share.
let _faCutEconCache = null;
function _faCutEconReset() { _faCutEconCache = new Map(); }
function _faCutEconomics(player) {
  if (!_faCutEconCache) _faCutEconCache = new Map();
  if (_faCutEconCache.has(player)) return _faCutEconCache.get(player);
  const e = _faCutEconomicsImpl(player);
  _faCutEconCache.set(player, e);
  return e;
}
function _faCutEconomicsImpl(player) {
  const hit  = (typeof currentYearCapHit === "function") ? currentYearCapHit(player) : (player.contract?.aav || 0);
  const dead = (typeof deadCapOnRelease === "function") ? deadCapOnRelease(player) : { perYear: 0, years: 0 };
  // When cut, all remaining proration accelerates to current year. The
  // current-year hit's proration stays; the FUTURE years' worth become
  // dead cap on top of the released base salary.
  const totalDeadOnCut = (dead.perYear || 0) * Math.max(0, (dead.years || 0));
  const yearsLeft = player.contract?.remaining || player.contract?.years || 1;
  // Net cap relief = current hit - dead cap that lands on this year.
  // For a 1-yr deal: yearsLeft=1, dead = 1×proration, hit = base+proration.
  // Relief = base+proration - 1×proration = base. Correct.
  // For a 4-yr deal with 3 left: dead = 3×proration, hit = base+proration.
  // Relief = base+proration - 3×proration = base - 2×proration.
  // This can go NEGATIVE when proration is heavy on a long deal — cap-cut
  // would COST the team. We surface that explicitly.
  const netRelief = hit - totalDeadOnCut;
  return { hit, totalDeadOnCut, netRelief, yearsLeft, perYearDead: dead.perYear || 0 };
}

// Restructure preview for a single player. Mirrors frnRestructure's
// math without committing — caller renders the freed amount inline as
// a button label. Eligibility rules match the existing logic:
//   - ≥ 2 years remaining on the deal
//   - ≥ $2M of current-year base salary to convert
//   - not already restructured this offseason
function _faRestructurePreview(player) {
  const c = player?.contract;
  if (!c) return { eligible: false, reason: "no contract" };
  const remaining = c.remaining || 0;
  if (remaining < 2) return { eligible: false, reason: "<2 yrs left" };
  if (c.restructuredSeason === franchise.season) return { eligible: false, reason: "already restructured" };
  const yearIndex = Math.max(0, (c.years || 1) - remaining);
  const currentBase = c.baseSalaries?.[yearIndex] ?? (c.aav - (c.bonusProration || 0));
  if (currentBase < 2.0) return { eligible: false, reason: "base too low" };
  const newProration = Math.round(currentBase / remaining * 10) / 10;
  const freed = Math.round((currentBase - newProration) * 10) / 10;
  return { eligible: true, freed, newProration, currentBase, remaining };
}

// Execute a restructure inline from the cuts screen. Mirrors the
// commit half of the analytics-screen flow but re-renders the cuts
// screen so the user stays in the cut-decision context.
function frnFARestructureFromCuts(name, pos) {
  const myId = franchise.chosenTeamId;
  const roster = franchise?.rosters?.[myId];
  const p = roster?.find(q => q.name === name && q.position === pos);
  if (!p?.contract) return;
  const prev = _faRestructurePreview(p);
  if (!prev.eligible) {
    _frnAlert(`Can't restructure ${name}: ${prev.reason}.`);
    return;
  }
  const msg = `Restructure ${name}?\n\n`
            + `Convert $${prev.currentBase.toFixed(1)}M of current-year base salary into a $${prev.newProration.toFixed(1)}M/yr signing bonus across ${prev.remaining} years.\n\n`
            + `Frees $${prev.freed.toFixed(1)}M of cap now.\n`
            + `Adds $${prev.newProration.toFixed(1)}M/yr in dead money if cut later.\n\n`
            + `Limited to once per player per offseason.`;
  if (!_frnConfirm(msg)) return;
  const c = p.contract;
  const yearIndex = Math.max(0, (c.years || 1) - (c.remaining || 1));
  if (c.baseSalaries) c.baseSalaries[yearIndex] = 0;
  c.bonusProration     = Math.round(((c.bonusProration || 0) + prev.newProration) * 10) / 10;
  c.signingBonus       = Math.round(((c.signingBonus   || 0) + prev.currentBase) * 10) / 10;
  c.restructuredSeason = franchise.season;
  saveFranchise();
  if (typeof _pushNews === "function") {
    _pushNews({ type: "restructure",
      label: `🔀 Restructured ${p.position} ${name} — freed $${prev.freed.toFixed(1)}M, added $${prev.newProration.toFixed(1)}M/yr dead` });
  }
  renderFrnFACuts();
}

// Open the trade hub with a hint that this player is on the block.
// frnOpenTrade itself doesn't take a player param, but we can drop a
// breadcrumb on franchise so the trade renderer can preselect.
function frnFATradeFromCuts(name, pos) {
  franchise._tradeBlockHint = { name, pos };
  if (typeof frnOpenTrade === "function") frnOpenTrade();
}

// Decision recommendation for a single player. Synthesizes the
// "should I cut this guy" decision tree into a single verdict:
//   - EASY CUT   = overpaid + low ceiling/age + position safe
//   - JUDGMENT   = trade-offs exist (good player overpaid, etc.)
//   - KEEP       = ceiling/youth/role outweighs cap pain
//   - COSTS $    = cutting loses money on the cap
// Returns { verdict, label, color, reason } so the Notes column can
// render a one-line synthesis.
function _faCutVerdict(player, econ, positionDepth, restructure, tradeTag) {
  const ovr = player.overall || 60;
  const age = player.age || 25;
  const tier = (typeof HiddenOracle === "object" && HiddenOracle?.read?.ceilingTier)
    ? HiddenOracle.read.ceilingTier(player).grade
    : "B";
  const protect = player.captain || player.personality === "captain"
                || (player.allPros || 0) >= 2 || (player.proBowls || 0) >= 3;

  // Cutting costs money outright — surface the alternative if there
  // is one (restructure is the natural fix for proration-heavy deals).
  if (econ.netRelief < -0.5) {
    if (restructure?.eligible) {
      return { verdict: "costs",
               label: `Restructure first · save $${restructure.freed.toFixed(1)}M`,
               color: "#5ed4d4",
               reason: `cut loses $${Math.abs(econ.netRelief).toFixed(1)}M — convert base to bonus instead` };
    }
    return { verdict: "costs",
             label: `Cut costs $${Math.abs(econ.netRelief).toFixed(1)}M`,
             color: "#ff8a8a",
             reason: "dead money exceeds salary relief" };
  }

  // Trade-asset chip — when a player is undervalued vs market, trading
  // them is often better than cutting (you get assets back, not just
  // cap). Only surfaces when there's meaningful trade value AND the
  // player isn't a clear easy-cut.
  if (tradeTag === "asset" && econ.netRelief < 10 && ovr >= 75) {
    return { verdict: "judgment",
             label: `Trade > cut · positive value`,
             color: "#5ed4d4",
             reason: "under-market — recoups picks/players, not just cap" };
  }

  // Position floor — would dropping this player breach it?
  if (positionDepth && positionDepth.delta <= 0 && ovr >= 65) {
    return { verdict: "keep",
             label: `${player.position} at floor`,
             color: "#ff8a8a",
             reason: "position would be below roster minimum" };
  }

  // Protected players (captain/elite) — flag as judgment, never auto
  if (protect && econ.netRelief < 8) {
    return { verdict: "keep",
             label: "Locker-room cost > cap relief",
             color: "#ff8a8a",
             reason: "captain or multi-AllPro — release tax steep" };
  }

  // Young high-ceiling — keep (years of upside)
  if (age <= 25 && (tier === "S" || tier === "A")) {
    return { verdict: "keep",
             label: `${tier}-tier ceiling, age ${age}`,
             color: "#ff8a8a",
             reason: "upside not realized yet — sunk cost rebound" };
  }

  // Aged-out + low ceiling + meaningful relief — easy cut
  if (age >= 30 && (tier === "C" || tier === "D") && econ.netRelief >= 3) {
    return { verdict: "easy",
             label: `Easy cut · $${econ.netRelief.toFixed(1)}M saved`,
             color: "#86e0a3",
             reason: "aging, capped ceiling, meaningful relief" };
  }

  // Big cap relief regardless of other factors
  if (econ.netRelief >= 10) {
    return { verdict: "easy",
             label: `Big saver · $${econ.netRelief.toFixed(1)}M`,
             color: "#86e0a3",
             reason: "cap relief alone justifies it" };
  }

  // Solid saver but with caveats
  if (econ.netRelief >= 4) {
    return { verdict: "judgment",
             label: `Judgment · $${econ.netRelief.toFixed(1)}M relief`,
             color: "#ffc850",
             reason: "depends on what you replace him with" };
  }

  // Marginal save
  if (econ.netRelief >= 1) {
    return { verdict: "judgment",
             label: `Marginal · $${econ.netRelief.toFixed(1)}M`,
             color: "#ffc850",
             reason: "small relief, weigh against position depth" };
  }

  // Default — weak cut
  return { verdict: "keep",
           label: "Low cap relief",
           color: "#ffc850",
           reason: "the juice isn't worth the squeeze" };
}

// ── Squarified treemap layout ─────────────────────────────────────────
// Bruls/Huijsmans/van Wijk 2000 — squarified algorithm. Lays out a list
// of {value, ...payload} items as rectangles in a canvas (w × h) such
// that each rectangle's area = value (scaled) and aspect ratios stay
// close to square. Returns [{x, y, w, h, item}].
//
// Lean inline impl — avoids pulling D3. Used by the cap-treemap to
// turn the roster's cap-hit list into a 2D block visualization.
function _faSquarify(items, w, h) {
  if (!items.length || w <= 0 || h <= 0) return [];
  const totalValue = items.reduce((s, i) => s + (i.value || 0), 0);
  if (totalValue <= 0) return [];
  const totalArea = w * h;
  const scale = totalArea / totalValue;

  const result = [];
  // Worst aspect ratio of a row (greater = worse). Used as the
  // squarify heuristic to know when to close a row.
  const worst = (row, side) => {
    if (!row.length) return Infinity;
    let mx = -Infinity, mn = Infinity, sum = 0;
    for (const r of row) { if (r > mx) mx = r; if (r < mn) mn = r; sum += r; }
    if (sum === 0 || mn === 0) return Infinity;
    return Math.max((side * side * mx) / (sum * sum), (sum * sum) / (side * side * mn));
  };
  // Place a closed row along the shorter side of the available rect.
  // wideShorter=true means width<=height: row stretches across the
  // top, items fan out horizontally, row consumes vertical space.
  // wideShorter=false: row stretches down the left, items fan out
  // vertically, row consumes horizontal space.
  // Returns rowSize — the perpendicular extent consumed.
  const placeRow = (rowValues, rowItems, x, y, side, wideShorter) => {
    const rowSum = rowValues.reduce((s, v) => s + v, 0);
    if (rowSum === 0 || side === 0) return 0;
    const rowSize = rowSum / side; // perpendicular extent
    let cur = wideShorter ? x : y;
    for (let i = 0; i < rowValues.length; i++) {
      const itemAlong = rowValues[i] / rowSize; // dimension along the shorter side
      if (wideShorter) {
        // Pack across width: each item gets (cur..cur+itemAlong, y..y+rowSize)
        result.push({ x: cur, y, w: itemAlong, h: rowSize, item: rowItems[i] });
      } else {
        // Pack down height: each item gets (x..x+rowSize, cur..cur+itemAlong)
        result.push({ x, y: cur, w: rowSize, h: itemAlong, item: rowItems[i] });
      }
      cur += itemAlong;
    }
    return rowSize;
  };

  const recurse = (remainingItems, x, y, ww, hh) => {
    if (!remainingItems.length || ww <= 0 || hh <= 0) return;
    const values = remainingItems.map(i => (i.value || 0) * scale);
    const wideShorter = ww <= hh;
    const side = wideShorter ? ww : hh;
    const row = [];
    const rowItems = [];
    let i = 0;
    while (i < remainingItems.length) {
      const candidate = [...row, values[i]];
      if (row.length === 0 || worst(candidate, side) <= worst(row, side)) {
        row.push(values[i]);
        rowItems.push(remainingItems[i]);
        i++;
      } else {
        break;
      }
    }
    if (!row.length) return;
    const consumed = placeRow(row, rowItems, x, y, side, wideShorter);
    if (i < remainingItems.length) {
      if (wideShorter) recurse(remainingItems.slice(i), x, y + consumed, ww, hh - consumed);
      else             recurse(remainingItems.slice(i), x + consumed, y, ww - consumed, hh);
    }
  };
  recurse(items, 0, 0, w, h);
  return result;
}

// Position color palette — keeps the treemap visually mapped to where
// money's going on the field. Skill positions warm, line positions
// cool, specialists muted.
const _FA_POS_COLORS = {
  QB:"#f5c542", RB:"#ef8a4d", WR:"#e85c98", TE:"#ba68c8",
  OL:"#5fb1d4", LT:"#5fb1d4", LG:"#5fb1d4", C:"#5fb1d4", RG:"#5fb1d4", RT:"#5fb1d4",
  DL:"#ff6b6b", LB:"#ffb14c", CB:"#86e0a3", S:"#4dc7a8",
  K:"#888", P:"#888",
};
function _faPosColor(pos) { return _FA_POS_COLORS[pos] || "#999"; }

// Treemap color modes — what the cube color encodes. User picks via
// chip toggle below the treemap. Each mode returns { fill, label }
// for the per-cube fill color + a short legend label.
function _faTreemapColor(player, mode, econ, verdict) {
  if (mode === "verdict") {
    const v = verdict?.verdict || "judgment";
    if (v === "easy")     return { fill: "#5e9c70" };
    if (v === "keep")     return { fill: "#b14b4b" };
    if (v === "costs")    return { fill: "#ef5350" };
    if (v === "pending")  return { fill: "#6b6b6b" };
    return { fill: "#c79f3a" }; // judgment / default
  }
  if (mode === "ceiling") {
    const tier = (typeof HiddenOracle === "object" && HiddenOracle?.read?.ceilingTier)
      ? HiddenOracle.read.ceilingTier(player).grade
      : "B";
    if (tier === "S") return { fill: "#f5c542" };  // gold
    if (tier === "A") return { fill: "#5ed4d4" };  // cyan
    if (tier === "B") return { fill: "#86e0a3" };  // green
    if (tier === "C") return { fill: "#c08070" };  // amber
    if (tier === "D") return { fill: "#7a5050" };  // dim red
    return { fill: "#666" };
  }
  if (mode === "age") {
    const age = player.age || 25;
    if (age <= 23) return { fill: "#5ed4d4" };  // very young
    if (age <= 26) return { fill: "#86e0a3" };  // young
    if (age <= 29) return { fill: "#f5c542" };  // prime
    if (age <= 32) return { fill: "#ef8a4d" };  // aging
    return { fill: "#b14b4b" };                  // 33+
  }
  if (mode === "agePot") {
    // 2D combined: young+high-ceiling = bright green keeper;
    // old+low-ceiling = deep red cut candidate. Heat-map style.
    const age = player.age || 25;
    const tier = (typeof HiddenOracle === "object" && HiddenOracle?.read?.ceilingTier)
      ? HiddenOracle.read.ceilingTier(player).grade
      : "B";
    const tierScore = { S: 4, A: 3, B: 2, C: 1, D: 0 }[tier] ?? 1;
    const youngScore = age <= 23 ? 4 : age <= 26 ? 3 : age <= 29 ? 2 : age <= 32 ? 1 : 0;
    const heat = tierScore + youngScore; // 0..8
    if (heat >= 7) return { fill: "#3aa84a" };  // future cornerstone
    if (heat >= 5) return { fill: "#86e0a3" };  // keeper
    if (heat >= 3) return { fill: "#c79f3a" };  // judgment
    if (heat >= 1) return { fill: "#c87050" };  // fading
    return { fill: "#7a3030" };                  // cut candidate
  }
  // default: position
  return { fill: _faPosColor(player.position) };
}

// Risk badges for each roster row — surfaced as small chips so a GM
// scanning the cut list knows what they're trading away.
function _faRiskBadges(player) {
  const out = [];
  if (player.captain || player.personality === "captain") out.push({ tag: "⭐ CAPT", col: "var(--gold)" });
  if (player.locker_cancer || player.personality === "locker_cancer") out.push({ tag: "☢ CANCER", col: "#ff8a8a" });
  if (player.injury && player.injury.weeksRemaining > 0) out.push({ tag: `🩹 ${player.injury.weeksRemaining}w`, col: "#ffc850" });
  if ((player.allPros || 0) >= 2 || (player.proBowls || 0) >= 3) out.push({ tag: "🏆 ELITE", col: "var(--gold-lt)" });
  if ((player.age || 0) >= (player.declineAge ?? 33)) out.push({ tag: "📉 DECLINE", col: "#ffc850" });
  if (player.coachable) out.push({ tag: "🎯 COACH", col: "#86e0a3" });
  if ((player._tradedAtSeason != null) && (franchise.season - player._tradedAtSeason <= 1)) out.push({ tag: "🔄 NEW", col: "#5ed4d4" });
  // Trade-reaction badge — only shown AFTER reveal (delayed visibility: player's
  // first season under the boost/penalty has to play out before the tag appears).
  if (player._tradeReactionRevealed && player._tradeReaction === "CHIP") {
    out.push({ tag: player._cancerRedeemed ? "🔥 REDEEMED" : "🔥 CHIPPED", col: "#ff8c42" });
  } else if (player._tradeReactionRevealed && player._tradeReaction === "SULK") {
    out.push({ tag: "😒 SULKING", col: "#9a8db5" });
  }
  return out;
}

// Position scarcity weight — used by auto-cut to avoid stripping a
// position to the bone. Higher = harder to lose. ROSTER_SLOTS is the
// floor; we don't auto-cut below floor.
function _faPositionDepth(roster, pendingCutNames) {
  const out = {};
  const cuts = pendingCutNames instanceof Set ? pendingCutNames : new Set(pendingCutNames || []);
  for (const [pos, need] of Object.entries(ROSTER_SLOTS || {})) {
    const have = roster.filter(p => p.position === pos && !cuts.has(p.name)).length;
    out[pos] = { have, need, delta: have - need };
  }
  return out;
}

// Greedy auto-cut: builds a recommended cut list that frees enough cap
// to be legal while preserving position floors and elite-tier players.
// Scoring: prefer players whose AAV/OVR ratio is high (overpaid) and
// whose net relief is positive. Skip captains, elites, and players
// whose cut would push a position below the ROSTER_SLOTS floor.
function frnFAAutoCutSuggest() {
  const myId = franchise.chosenTeamId;
  const myRoster = (franchise.rosters[myId] || []).slice();
  const cap = effectiveSalaryCap(myId);
  const used = capUsedByTeam(myId);
  const need = used - cap;
  if (need <= 0) {
    _frnAlert("You're already cap-legal — no cuts needed.");
    return;
  }
  franchise._pendingCuts = franchise._pendingCuts || [];
  const pending = new Set(franchise._pendingCuts);

  // Build sorted candidate list, best-cut-first
  // Two-tier filtering: prefer positive-relief candidates, but fall
  // back to ANY candidate if none exist. A team that's heavily over
  // cap with proration-heavy deals sometimes has no clean cut; the
  // user still needs SOMETHING to consider.
  const allCandidates = myRoster
    .filter(p => !pending.has(p.name))
    .map(p => {
      const econ = _faCutEconomics(p);
      const ovr = p.overall || 60;
      const overpayRatio = (p.contract?.aav || 0) / Math.max(40, ovr);
      const protect = (p.captain || p.personality === "captain") ? 50
                    : (p.allPros || 0) >= 2 || (p.proBowls || 0) >= 3 ? 30
                    : 0;
      return { p, econ, score: econ.netRelief * 0.6 + overpayRatio * 4 - protect };
    })
    .sort((a, b) => b.score - a.score);
  const positiveOnly = allCandidates.filter(c => c.econ.netRelief > 0.5);
  const fellBack = positiveOnly.length === 0;
  const candidates = positiveOnly.length ? positiveOnly : allCandidates.filter(c => c.econ.netRelief > -3);

  // Greedy fill — add until target met or no candidates left
  let freed = 0;
  const recs = [];
  for (const c of candidates) {
    if (freed >= need) break;
    // Position floor check — don't drop below ROSTER_SLOTS
    const wouldHave = myRoster.filter(q => q.position === c.p.position
      && !pending.has(q.name)
      && !recs.some(r => r.p.name === q.name)
      && q.name !== c.p.name).length;
    if (wouldHave < (ROSTER_SLOTS[c.p.position] || 0)) continue;
    recs.push(c);
    freed += c.econ.netRelief;
  }
  if (!recs.length) {
    _frnAlert("No safe auto-cuts available. Every candidate would either drop a position below the roster floor or hit a protected player (captain/multi-AllPro). Try manually, or consider restructuring contracts instead.");
    return;
  }
  const fallbackNote = fellBack
    ? "\n\n⚠ Every cuttable contract has heavy dead money — these picks LOSE money on the cap but free roster space. Consider restructures first."
    : "";
  if (freed < need) {
    if (!_frnConfirm(`Auto-cut suggests ${recs.length} cuts freeing $${freed.toFixed(1)}M, but you still need to free $${(need - freed).toFixed(1)}M more. Stage these and pick more manually?${fallbackNote}`)) return;
  } else {
    if (!_frnConfirm(`Auto-cut will stage ${recs.length} cuts freeing $${freed.toFixed(1)}M (need $${need.toFixed(1)}M). Stage them now? You'll still need to confirm before they go through.${fallbackNote}`)) return;
  }
  for (const r of recs) franchise._pendingCuts.push(r.p.name);
  saveFranchise();
  renderFrnFACuts();
}

// Sort key for the roster table — persisted on franchise so the user's
// preference survives toggles + re-renders.
function frnFACutsSort(key) {
  franchise._faCutsSort = key;
  renderFrnFACuts();
}
// Treemap color mode: "position" / "verdict" / "ceiling" / "age" / "agePot"
function frnFACutsSetColorMode(mode) {
  franchise._faCutsColorMode = mode;
  renderFrnFACuts();
}
// Filter mode: "assets" / "blockers" / "cuttable" / "costly" / null.
// Clicking the same filter again clears it (toggle behavior).
function frnFACutsSetFilter(key) {
  franchise._faCutsFilter = (franchise._faCutsFilter === key) ? null : key;
  renderFrnFACuts();
}
// Position filter from the depth-grid pill click. Same toggle pattern.
function frnFACutsSetPosFilter(pos) {
  franchise._faCutsPosFilter = (franchise._faCutsPosFilter === pos) ? null : pos;
  renderFrnFACuts();
}
function frnFACutsClearFilters() {
  franchise._faCutsFilter = null;
  franchise._faCutsPosFilter = null;
  renderFrnFACuts();
}

// Bulk-action on the currently-filtered subset. Action picks itself
// based on the active filter mode so the button always does the
// useful thing for what the user is looking at.
function frnFACutsBulkApply() {
  const myId = franchise.chosenTeamId;
  const cap = effectiveSalaryCap(myId);
  const myRoster = franchise.rosters[myId] || [];
  const filterMode = franchise._faCutsFilter;
  const posFilter  = franchise._faCutsPosFilter;
  const pending = new Set(franchise._pendingCuts || []);
  // Build the same filtered set the table is showing.
  const filtered = myRoster.filter(p => {
    if (posFilter && p.position !== posFilter) return false;
    if (filterMode === "assets")      return _tradeValueTag(p, cap) === "asset";
    if (filterMode === "blockers")    return _tradeValueTag(p, cap) === "blocker";
    if (filterMode === "cuttable")    return _faCutEconomics(p).netRelief > 1;
    if (filterMode === "costly")      return _faCutEconomics(p).netRelief < -0.5;
    if (filterMode === "restructure") return _faRestructurePreview(p).eligible;
    return true;
  }).filter(p => !pending.has(p.name));
  if (!filtered.length) {
    _frnAlert("Nothing to bulk-apply: filtered set is empty.");
    return;
  }
  // Pick the right action per filter mode.
  if (filterMode === "restructure") {
    const total = filtered.reduce((s, p) => s + (_faRestructurePreview(p).freed || 0), 0);
    if (!_frnConfirm(`Restructure ${filtered.length} player${filtered.length===1?"":"s"}? Frees ~$${total.toFixed(1)}M total now, adds dead-money risk if any are cut later.`)) return;
    let did = 0;
    for (const p of filtered) {
      const prev = _faRestructurePreview(p);
      if (!prev.eligible) continue;
      const c = p.contract;
      const yearIndex = Math.max(0, (c.years || 1) - (c.remaining || 1));
      if (c.baseSalaries) c.baseSalaries[yearIndex] = 0;
      c.bonusProration     = Math.round(((c.bonusProration || 0) + prev.newProration) * 10) / 10;
      c.signingBonus       = Math.round(((c.signingBonus   || 0) + prev.currentBase) * 10) / 10;
      c.restructuredSeason = franchise.season;
      did++;
    }
    if (typeof _pushNews === "function") {
      _pushNews({ type: "restructure", label: `🔀 Bulk restructure: ${did} players, freed ~$${total.toFixed(1)}M` });
    }
    saveFranchise();
    renderFrnFACuts();
    return;
  }
  if (filterMode === "assets") {
    if (!_frnConfirm(`Move ${filtered.length} asset${filtered.length===1?"":"s"} to your trade block? They'll be listed publicly when the next week tick happens.`)) return;
    for (const p of filtered) p.onTradeBlock = true;
    saveFranchise();
    renderFrnFACuts();
    return;
  }
  // Default: stage all as pending cuts. Covers cuttable / blockers /
  // costly / position-only / all filters.
  const totalRelief = filtered.reduce((s, p) => s + _faCutEconomics(p).netRelief, 0);
  if (!_frnConfirm(`Stage ${filtered.length} player${filtered.length===1?"":"s"} for cut? Net cap relief: ${totalRelief>=0?'+':'−'}$${Math.abs(totalRelief).toFixed(1)}M. Cuts are still pending until you confirm.`)) return;
  franchise._pendingCuts = franchise._pendingCuts || [];
  for (const p of filtered) {
    if (!franchise._pendingCuts.includes(p.name)) franchise._pendingCuts.push(p.name);
  }
  saveFranchise();
  renderFrnFACuts();
}
function frnFACutsTogglePending(name) {
  franchise._pendingCuts = franchise._pendingCuts || [];
  const idx = franchise._pendingCuts.indexOf(name);
  if (idx === -1) franchise._pendingCuts.push(name);
  else franchise._pendingCuts.splice(idx, 1);
  saveFranchise();
  renderFrnFACuts();
}
function frnFACutsClearPending() {
  franchise._pendingCuts = [];
  saveFranchise();
  renderFrnFACuts();
}
function frnFACutsConfirm() {
  const myId = franchise.chosenTeamId;
  const roster = franchise.rosters[myId] || [];
  const pending = (franchise._pendingCuts || []).slice();
  if (!pending.length) {
    _frnAlert("No pending cuts to confirm.");
    return;
  }
  const totalFreed = pending.reduce((s, n) => {
    const p = roster.find(q => q.name === n);
    return s + (p ? _faCutEconomics(p).netRelief : 0);
  }, 0);
  if (!_frnConfirm(`Release ${pending.length} player${pending.length===1?"":"s"} now? Frees ~$${totalFreed.toFixed(1)}M in cap. This is final.`)) return;
  for (const name of pending) {
    const idx = roster.findIndex(p => p.name === name);
    if (idx !== -1) roster.splice(idx, 1);
  }
  franchise._pendingCuts = [];
  saveFranchise();
  renderFrnFACuts();
}

function renderFrnFACuts() {
  // Reset the cut-economics memo cache so this render starts fresh.
  // Per-player econ is then computed at most once across all the
  // filter/sort/render passes that need it.
  _faCutEconReset();
  const myId = franchise.chosenTeamId;
  const cap = effectiveSalaryCap(myId);
  const myRoster = franchise.rosters[myId] || [];
  const used = capUsedByTeam(myId);
  const room = cap - used;
  const overCap = used > cap;
  const pending = new Set(franchise._pendingCuts || []);

  // Pending-cuts impact
  const pendingEconList = (franchise._pendingCuts || []).map(name => {
    const p = myRoster.find(q => q.name === name);
    return p ? { p, econ: _faCutEconomics(p) } : null;
  }).filter(Boolean);
  const pendingFreed = pendingEconList.reduce((s, e) => s + e.econ.netRelief, 0);
  const postCutUsed = used - pendingFreed;
  const postCutOver = Math.max(0, postCutUsed - cap);
  const needToFree  = Math.max(0, used - cap);
  const remainingNeed = Math.max(0, needToFree - pendingFreed);
  const willBeLegal = pendingFreed >= needToFree;

  // Cap progress bar — anchored $0 → cap. Bar maxes out at 100% (the
  // cap line IS the right edge). Over-cap is surfaced as a red chip
  // outside the bar AND a pulse-tint on the fill, not by extending the
  // canvas (which was confusing — "why does the bar end at $312M?").
  const usedPct      = Math.min(100, (used / cap) * 100);
  const postCutPct   = Math.min(100, Math.max(0, (postCutUsed / cap) * 100));
  const overAmt      = Math.max(0, used - cap);
  const postCutOverAmt = Math.max(0, postCutUsed - cap);

  // Position depth after pending cuts
  const depth = _faPositionDepth(myRoster, pending);

  // Sort key — default to highest net relief
  const sortKey = franchise._faCutsSort || "relief";
  const sortedRoster = myRoster.slice().sort((a, b) => {
    const ea = _faCutEconomics(a);
    const eb = _faCutEconomics(b);
    if (sortKey === "relief")  return eb.netRelief - ea.netRelief;
    if (sortKey === "aav")     return (b.contract?.aav||0) - (a.contract?.aav||0);
    if (sortKey === "dead")    return eb.totalDeadOnCut - ea.totalDeadOnCut;
    if (sortKey === "ovr")     return (a.overall||0) - (b.overall||0);
    if (sortKey === "age")     return (b.age||0) - (a.age||0);
    if (sortKey === "pos")     return (a.position||"").localeCompare(b.position||"");
    if (sortKey === "restruct") return (_faRestructurePreview(b).freed || 0) - (_faRestructurePreview(a).freed || 0);
    return 0;
  });

  // Filters — applied AFTER sort so the user's sort preference holds.
  const filterMode = franchise._faCutsFilter;     // "assets" / "blockers" / "cuttable" / "costly" / null
  const posFilter  = franchise._faCutsPosFilter;  // position string or null
  const filterCounts = {
    all: sortedRoster.length,
    assets:   sortedRoster.filter(p => _tradeValueTag(p, cap) === "asset").length,
    blockers: sortedRoster.filter(p => _tradeValueTag(p, cap) === "blocker").length,
    cuttable: sortedRoster.filter(p => _faCutEconomics(p).netRelief > 1).length,
    costly:   sortedRoster.filter(p => _faCutEconomics(p).netRelief < -0.5).length,
    restructure: sortedRoster.filter(p => _faRestructurePreview(p).eligible).length,
  };
  // When the restructure filter is active, override sort to highlight
  // the biggest cap-relief opportunities. User-chosen sort still works
  // via the Sort chips above the table.
  let workingRoster = sortedRoster;
  if (filterMode === "restructure" && franchise._faCutsSort == null) {
    workingRoster = sortedRoster.slice().sort((a, b) =>
      (_faRestructurePreview(b).freed || 0) - (_faRestructurePreview(a).freed || 0));
  }
  const filteredRoster = workingRoster.filter(p => {
    if (posFilter && p.position !== posFilter) return false;
    if (filterMode === "assets")      return _tradeValueTag(p, cap) === "asset";
    if (filterMode === "blockers")    return _tradeValueTag(p, cap) === "blocker";
    if (filterMode === "cuttable")    return _faCutEconomics(p).netRelief > 1;
    if (filterMode === "costly")      return _faCutEconomics(p).netRelief < -0.5;
    if (filterMode === "restructure") return _faRestructurePreview(p).eligible;
    return true;
  });

  const cleanName = (n) => (n||"").replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  // — HERO BLOCK —
  const heroHtml = `
    <div class="frn-cuts-hero ${overCap ? "over" : "legal"}">
      <div class="frn-cuts-hero-row">
        <div class="frn-cuts-hero-left">
          <div class="frn-cuts-hero-eyebrow">FREE AGENCY · FINAL ROSTER CHECK</div>
          <div class="frn-cuts-hero-title">${overCap ? "⚠ CUT TO BE CAP-LEGAL" : "✓ CAP-LEGAL"}</div>
          <div class="frn-cuts-hero-sub">
            ${overCap
              ? `You need to free <b style="color:#ff8a8a">$${needToFree.toFixed(1)}M</b> before Week 1 kicks off.`
              : `Roster is locked in at <b style="color:#86e0a3">$${room.toFixed(1)}M</b> under the cap. Hit START to lock the season.`}
          </div>
        </div>
        <div class="frn-cuts-hero-right">
          <div class="frn-cuts-cap-num" style="color:${overCap?'#ff8a8a':'#86e0a3'}">
            $${used.toFixed(1)}<span class="frn-cuts-cap-num-sub">M</span>
          </div>
          <div class="frn-cuts-cap-cap">/ $${cap.toFixed(0)}M cap</div>
        </div>
      </div>
      ${(() => {
        // ── CAP TREEMAP ──
        // Each player is a rectangle with area ∝ current-year cap hit.
        // Squarified layout fills the canvas; cap-line marker shows
        // where the legal-cap boundary falls along the cumulative spend.
        // Clicking a cube opens that player's card. Hover surfaces a
        // tooltip with name + hit + verdict.
        const colorMode = franchise._faCutsColorMode || "position";
        // Taller canvas (720×300) so mid-tier contracts carry their
        // secondary "$X.XM · POS" label without falling below threshold.
        const tmW = 720, tmH = 300;
        // Sort by cap hit descending so big contracts dominate the
        // canvas and squarify produces clean tiles.
        const rosterByHit = myRoster.slice()
          .map(p => ({ p, hit: _faCutEconomics(p).hit }))
          .filter(o => o.hit > 0)
          .sort((a, b) => b.hit - a.hit);
        const treemapItems = rosterByHit.map(o => ({ value: o.hit, payload: o.p }));
        const tiles = _faSquarify(treemapItems, tmW, tmH);
        // The cap line — vertical position where cumulative hit crosses cap.
        // Since squarify packs along shorter side, "cumulative" is tricky;
        // we instead surface the overall over-cap state via the bar tint +
        // overflow chip, and add a "cap-coverage" badge that says
        // e.g. "89% / cap covered" within the treemap.
        const capCoverage = Math.min(100, (cap / Math.max(used, 0.0001)) * 100);
        // Filter-state set — tiles outside the active filter dim out so
        // the treemap matches the table the user is focused on below.
        const activePosFilter = franchise._faCutsPosFilter;
        const activeStatusFilter = franchise._faCutsFilter;
        const tileMatchesFilter = (p) => {
          if (activePosFilter && p.position !== activePosFilter) return false;
          if (activeStatusFilter === "assets")      return _tradeValueTag(p, cap) === "asset";
          if (activeStatusFilter === "blockers")    return _tradeValueTag(p, cap) === "blocker";
          if (activeStatusFilter === "cuttable")    return _faCutEconomics(p).netRelief > 1;
          if (activeStatusFilter === "costly")      return _faCutEconomics(p).netRelief < -0.5;
          if (activeStatusFilter === "restructure") return _faRestructurePreview(p).eligible;
          return true;
        };
        const anyFilter = !!(activePosFilter || activeStatusFilter);
        const tilesHtml = tiles.map((t, idx) => {
          const p = t.item.payload;
          const econ = _faCutEconomics(p);
          const verdict = pending.has(p.name)
            ? { verdict: "pending" }
            : _faCutVerdict(p, econ, depth[p.position],
                            _faRestructurePreview(p), _tradeValueTag(p, cap));
          const col = _faTreemapColor(p, colorMode, econ, verdict);
          const isPending = pending.has(p.name);
          const dimmed = anyFilter && !tileMatchesFilter(p);
          // Cap-overflow: tiles with cumulative-hit beyond cap get a
          // diagonal warn-stripe. We tag the OVER-tier tiles by a
          // simple rule — players whose hit is in the overflow $.
          // For correctness, mark tiles whose RANK pushes cumsum > cap.
          // (Computed once in a side pass.)
          return { t, p, econ, verdict, col, isPending, dimmed };
        });
        // Compute over-cap tiles by cumulative spend
        let cum = 0;
        for (const row of tilesHtml) {
          cum += row.econ.hit;
          row.isOver = cum > cap;
          row.cum = cum;
        }
        const cleanN = (n) => (n||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
        const renderedTiles = tilesHtml.map(row => {
          const { t, p, econ, col, isPending, isOver, dimmed, verdict } = row;
          const wPct = (t.w / tmW) * 100;
          const hPct = (t.h / tmH) * 100;
          const xPct = (t.x / tmW) * 100;
          const yPct = (t.y / tmH) * 100;
          // Only show name/hit when tile is large enough. With the
          // taller 300px canvas the thresholds are looser than before.
          const tileArea = t.w * t.h;
          const showName = tileArea > 1500;
          const showHit  = tileArea > 3000;
          const cls = `frn-cuts-tm-tile${isPending?' pending':''}${isOver?' over':''}${dimmed?' dimmed':''}`;
          return `<div class="${cls}"
            style="left:${xPct.toFixed(2)}%;top:${yPct.toFixed(2)}%;width:${wPct.toFixed(2)}%;height:${hPct.toFixed(2)}%;background:${col.fill}"
            onclick="frnOpenPlayerCard('${cleanN(p.name)}')"
            title="${p.name} (${p.position}) · $${econ.hit.toFixed(1)}M hit · ${verdict.verdict==='pending'?'PENDING CUT':(verdict.label||'')}"
            >
            ${showName ? `<div class="frn-cuts-tm-name">${p.name}</div>` : ""}
            ${showHit  ? `<div class="frn-cuts-tm-hit">$${econ.hit.toFixed(1)}M · ${p.position}</div>` : ""}
          </div>`;
        }).join("");
        const overTilesCount = tilesHtml.filter(r => r.isOver).length;
        const colorModes = [
          { key: "position", lbl: "Position" },
          { key: "verdict",  lbl: "Verdict" },
          { key: "ceiling",  lbl: "Ceiling" },
          { key: "age",      lbl: "Age" },
          { key: "agePot",   lbl: "Age × Potential" },
        ];
        const modeChips = colorModes.map(m =>
          `<button class="frn-cuts-tm-mode${colorMode===m.key?' active':''}" onclick="frnFACutsSetColorMode('${m.key}')">${m.lbl}</button>`
        ).join("");
        // Legend keys per mode
        const legendByMode = {
          position: [
            ["QB","#f5c542"],["RB","#ef8a4d"],["WR","#e85c98"],["TE","#ba68c8"],
            ["OL","#5fb1d4"],["DL","#ff6b6b"],["LB","#ffb14c"],["DB","#86e0a3"],
            ["K/P","#888"],
          ],
          verdict: [
            ["EASY CUT","#5e9c70"],["JUDGMENT","#c79f3a"],["KEEP","#b14b4b"],["COSTS $","#ef5350"],["PENDING","#6b6b6b"],
          ],
          ceiling: [
            ["S","#f5c542"],["A","#5ed4d4"],["B","#86e0a3"],["C","#c08070"],["D","#7a5050"],
          ],
          age: [
            ["≤23","#5ed4d4"],["24–26","#86e0a3"],["27–29","#f5c542"],["30–32","#ef8a4d"],["33+","#b14b4b"],
          ],
          agePot: [
            ["Cornerstone","#3aa84a"],["Keeper","#86e0a3"],["Judgment","#c79f3a"],["Fading","#c87050"],["Cut bait","#7a3030"],
          ],
        };
        const legend = (legendByMode[colorMode] || []).map(([k,c]) =>
          `<span class="frn-cuts-tm-legend-item"><span class="dot" style="background:${c}"></span>${k}</span>`
        ).join("");
        return `<div class="frn-cuts-treemap-wrap">
          <div class="frn-cuts-treemap-head">
            <span class="frn-cuts-tm-title">CAP BLOCK · ${myRoster.length} contracts</span>
            <span class="frn-cuts-tm-sub">${overCap ? `${overTilesCount} tile${overTilesCount===1?'':'s'} in the over-cap zone — click any to inspect` : `${capCoverage.toFixed(0)}% of cap used`}</span>
            ${overCap ? `<span class="frn-cuts-overflow-chip" title="You're $${overAmt.toFixed(1)}M past the cap">+$${overAmt.toFixed(1)}M OVER</span>` : `<span class="frn-cuts-room-chip" title="Cap room">$${room.toFixed(1)}M ROOM</span>`}
          </div>
          <div class="frn-cuts-treemap-canvas ${overCap?'over':'legal'}" style="aspect-ratio:${tmW}/${tmH}">
            ${renderedTiles}
          </div>
          <div class="frn-cuts-tm-controls">
            <span class="frn-cuts-tm-controls-label">Color by:</span>
            ${modeChips}
            <span class="frn-cuts-tm-legend">${legend}</span>
          </div>
        </div>`;
      })()}
      <div class="frn-cuts-hero-actions">
        ${overCap ? `<button class="frn-cuts-auto-btn" onclick="frnFAAutoCutSuggest()">✨ AUTO-CUT TO LEGAL</button>` : ""}
        <div class="frn-cuts-sort-wrap">
          <span class="frn-cuts-sort-label">Sort:</span>
          ${["relief","aav","dead","restruct","ovr","age","pos"].map(k => {
            const lbl = { relief:"Cap Relief", aav:"AAV", dead:"Dead $", restruct:"♻ Restruct $", ovr:"Worst OVR", age:"Oldest", pos:"Position" }[k];
            return `<button class="frn-cuts-sort-chip${sortKey===k?" active":""}" onclick="frnFACutsSort('${k}')">${lbl}</button>`;
          }).join("")}
        </div>
      </div>
    </div>`;

  // — PENDING CUTS PANEL —
  const pendingPanelHtml = pendingEconList.length ? `
    <div class="frn-cuts-pending">
      <div class="frn-cuts-pending-header">
        <span class="frn-cuts-pending-title">📋 PENDING CUTS · ${pendingEconList.length}</span>
        <span class="frn-cuts-pending-freed" style="color:${willBeLegal?'#86e0a3':'#ffc850'}">
          Frees <b>$${pendingFreed.toFixed(1)}M</b>${overCap?` of <b>$${needToFree.toFixed(1)}M</b> needed`:""}
          ${overCap && willBeLegal ? `<span class="frn-cuts-legal-pill">✓ WILL BE LEGAL</span>` : ""}
          ${overCap && !willBeLegal ? `<span class="frn-cuts-short-pill">$${remainingNeed.toFixed(1)}M short</span>` : ""}
        </span>
      </div>
      <div class="frn-cuts-pending-rows">
        ${pendingEconList.map(e => {
          const p = e.p, econ = e.econ;
          const dead = econ.totalDeadOnCut > 0 ? `<span style="color:#ffc850">−$${econ.totalDeadOnCut.toFixed(1)}M dead</span>` : `<span style="color:#86e0a3">$0 dead</span>`;
          return `<div class="frn-cuts-pending-row">
            <span class="frn-cuts-pos">${p.position}</span>
            <span class="frn-cuts-name">${p.name}</span>
            <span class="frn-cuts-ovr">${p.overall||"-"}</span>
            <span class="frn-cuts-econ">$${econ.hit.toFixed(1)}M hit · ${dead} · <b style="color:#86e0a3">+$${econ.netRelief.toFixed(1)}M net</b></span>
            <button class="frn-cuts-undo-btn" onclick="frnFACutsTogglePending('${cleanName(p.name)}')">✕ undo</button>
          </div>`;
        }).join("")}
      </div>
      <div class="frn-cuts-pending-cta">
        <button class="frn-cuts-clear-btn" onclick="frnFACutsClearPending()">Reset</button>
        <button class="frn-cuts-confirm-btn${willBeLegal||!overCap?" ready":""}" onclick="frnFACutsConfirm()">
          ✓ CONFIRM CUTS
        </button>
      </div>
    </div>` : "";

  // — POSITION DEPTH BAR — chips are clickable filters.
  const depthHtml = `
    <div class="frn-cuts-depth">
      <div class="frn-cuts-depth-title">POSITION DEPTH <span class="frn-cuts-depth-sub">click a position to filter the roster · floor = ROSTER_SLOTS minimum</span></div>
      <div class="frn-cuts-depth-grid">
        ${Object.entries(depth).map(([pos, d]) => {
          const status = d.delta < 0 ? "below" : d.delta === 0 ? "floor" : d.delta <= 1 ? "thin" : "ok";
          const icon = status === "below" ? "✗" : status === "floor" ? "⚠" : status === "thin" ? "·" : "✓";
          const active = posFilter === pos;
          return `<button type="button" class="frn-cuts-depth-chip ${status}${active?" active":""}"
            onclick="frnFACutsSetPosFilter('${pos}')"
            title="${active ? `Clear ${pos} filter` : `Show only ${pos} (${d.have}/${d.need} rostered)`}">
            <span class="frn-cuts-depth-icon">${icon}</span>
            <span class="frn-cuts-depth-pos">${pos}</span>
            <span class="frn-cuts-depth-val">${d.have}/${d.need}</span>
          </button>`;
        }).join("")}
      </div>
    </div>`;

  // — FILTER STRIP — sits above the table. Two rows of chips: trade-
  // status filters + active filter clear indicator.
  const filterStripHtml = `
    <div class="frn-cuts-filter-strip">
      <span class="frn-cuts-filter-label">Show:</span>
      <button class="frn-cuts-filter-chip${!filterMode?" active":""}" onclick="frnFACutsSetFilter(null)">All <span class="cnt">${filterCounts.all}</span></button>
      <button class="frn-cuts-filter-chip${filterMode==="assets"?" active":""}" onclick="frnFACutsSetFilter('assets')"
        title="Under-market deals — better traded than cut">💰 Assets <span class="cnt">${filterCounts.assets}</span></button>
      <button class="frn-cuts-filter-chip${filterMode==="blockers"?" active":""}" onclick="frnFACutsSetFilter('blockers')"
        title="Overpaid contracts — anchor on cap, hard to move">⚓ Blockers <span class="cnt">${filterCounts.blockers}</span></button>
      <button class="frn-cuts-filter-chip${filterMode==="cuttable"?" active":""}" onclick="frnFACutsSetFilter('cuttable')"
        title="Cut saves ≥ $1M of net cap">✓ Cuttable <span class="cnt">${filterCounts.cuttable}</span></button>
      <button class="frn-cuts-filter-chip${filterMode==="costly"?" active":""}" onclick="frnFACutsSetFilter('costly')"
        title="Cut would LOSE money on the cap — restructure first">⚠ Costly <span class="cnt">${filterCounts.costly}</span></button>
      <button class="frn-cuts-filter-chip restruct${filterMode==="restructure"?" active":""}" onclick="frnFACutsSetFilter('restructure')"
        title="Restructure-eligible — sorted by biggest cap freed when active">♻ Restructures <span class="cnt">${filterCounts.restructure}</span></button>
      ${posFilter ? `<span class="frn-cuts-active-filter">${posFilter} only · <a onclick="frnFACutsSetPosFilter(null)">clear</a></span>` : ""}
      ${(filterMode || posFilter) ? `<button class="frn-cuts-clear-all" onclick="frnFACutsClearFilters()">✕ Reset filters</button>` : ""}
      ${(() => {
        // Bulk-action button — only shown when a filter is active AND the
        // filtered set has actionable items. Label morphs by filter mode.
        if (!filterMode && !posFilter) return "";
        if (filteredRoster.length === 0) return "";
        const visibleNotPending = filteredRoster.filter(p => !pending.has(p.name)).length;
        if (visibleNotPending === 0) return "";
        let label;
        if (filterMode === "restructure")    label = `♻ Restructure all ${visibleNotPending}`;
        else if (filterMode === "assets")    label = `🔀 Block all ${visibleNotPending} for trade`;
        else                                  label = `✗ Stage all ${visibleNotPending} for cut`;
        return `<button class="frn-cuts-bulk-btn" onclick="frnFACutsBulkApply()">${label}</button>`;
      })()}
      <span class="frn-cuts-filter-meta">${filteredRoster.length} of ${myRoster.length} shown</span>
    </div>`;

  // — ROSTER TABLE —
  const _hasOracle = (typeof HiddenOracle === "object" && HiddenOracle?.read?.ceilingTier);
  const rowsHtml = filteredRoster.length ? filteredRoster.map(p => {
    const econ = _faCutEconomics(p);
    const badges = _faRiskBadges(p);
    const isPending = pending.has(p.name);
    const reliefCol = econ.netRelief > 0 ? "#86e0a3" : econ.netRelief < -0.5 ? "#ff8a8a" : "var(--gray)";
    const yrs = p.contract?.remaining ?? p.contract?.years ?? 1;
    const ageStr = p.age != null ? `${p.age}` : "?";
    const ovrStr = p.overall || "?";
    const ovrCol = (p.overall||0) >= 82 ? "var(--green-lt)"
                 : (p.overall||0) >= 72 ? "var(--gold-lt)"
                 : (p.overall||0) >= 62 ? "var(--gray)"
                 : "#ff8a8a";
    const positionDepth = depth[p.position];
    // Alternatives — restructure preview + trade-value tag. Both feed
    // into the verdict so the recommendation prefers a less-destructive
    // path when one exists.
    const restructure = _faRestructurePreview(p);
    const tradeTag = (typeof _tradeValueTag === "function") ? _tradeValueTag(p, cap) : null;
    const verdict = isPending
      ? { verdict: "pending", label: "PENDING CUT", color: "#ff8a8a", reason: "queued for release" }
      : _faCutVerdict(p, econ, positionDepth, restructure, tradeTag);
    // Ceiling tier — hidden potential bucket (S/A/B/C/D). Sourced via
    // HiddenOracle so the security model holds (no raw ceiling number
    // ever surfaces). Falls back to "?" if oracle isn't available.
    const tier = _hasOracle ? HiddenOracle.read.ceilingTier(p) : { grade: "?", color: "var(--gray)" };
    const tierBadge = `<span class="frn-cuts-tier tier-${tier.grade}" style="color:${tier.color};border-color:${tier.color}55" title="Hidden ceiling tier · S best, D worst — your scouts can be wrong">${tier.grade}</span>`;
    // Inline trade-value chip — surfaces "ASSET" (positive value vs
    // contract) or "BLOCKER" (negative value, anchor on cap).
    const tradeChip = tradeTag === "asset"
      ? `<span class="frn-cuts-trade-chip asset" title="Player is under-market — trade returns assets, not just cap relief">💰 ASSET</span>`
      : tradeTag === "blocker"
      ? `<span class="frn-cuts-trade-chip blocker" title="Bad contract — trade partners will demand picks to take this on">⚓ BLOCKER</span>`
      : "";

    return `<tr class="${isPending?"pending":""} verdict-${verdict.verdict}">
      <td class="frn-cuts-td-pos">${p.position}</td>
      <td class="frn-cuts-td-name">
        <span class="frn-cuts-name-link" onclick="frnOpenPlayerCard('${cleanName(p.name)}')" title="${p.name} — click for full card · ceiling, contract, career history">${p.name}</span>
        ${badges.length ? `<span class="frn-cuts-badges">${badges.map(b => `<span class="frn-cuts-badge" style="color:${b.col};border-color:${b.col}55">${b.tag}</span>`).join("")}</span>` : ""}
      </td>
      <td class="frn-cuts-td-ovr" style="color:${ovrCol}">${ovrStr}</td>
      <td class="frn-cuts-td-ceil">${tierBadge}</td>
      <td class="frn-cuts-td-age">${ageStr}</td>
      <td class="frn-cuts-td-yrs">${yrs}yr</td>
      <td class="frn-cuts-td-aav">$${(p.contract?.aav||0).toFixed(1)}M</td>
      <td class="frn-cuts-td-hit">$${econ.hit.toFixed(1)}M</td>
      <td class="frn-cuts-td-dead" style="color:${econ.totalDeadOnCut>0?'#ffc850':'var(--gray)'}">${econ.totalDeadOnCut>0?`−$${econ.totalDeadOnCut.toFixed(1)}M`:"—"}</td>
      <td class="frn-cuts-td-net" style="color:${reliefCol};font-weight:900">${econ.netRelief>=0?'+':'−'}$${Math.abs(econ.netRelief).toFixed(1)}M</td>
      <td class="frn-cuts-td-note">
        <span style="color:${verdict.color};font-weight:700">${verdict.label}</span>
        ${verdict.reason ? `<span class="frn-cuts-verdict-reason"> · ${verdict.reason}</span>` : ""}
        ${tradeChip}
      </td>
      <td class="frn-cuts-td-action">
        <div class="frn-cuts-action-cluster">
          ${(!isPending && restructure.eligible) ? `<button class="frn-cuts-row-btn restruct" onclick="frnFARestructureFromCuts('${cleanName(p.name)}','${p.position}')" title="Convert $${restructure.currentBase.toFixed(1)}M base → $${restructure.newProration.toFixed(1)}M/yr bonus. Frees cap now, adds dead-money risk later.">♻ +$${restructure.freed.toFixed(1)}M</button>` : ""}
          ${(!isPending && tradeTag) ? `<button class="frn-cuts-row-btn trade" onclick="frnFATradeFromCuts('${cleanName(p.name)}','${p.position}')" title="Open the trade hub with ${p.name} on the block">🔀 trade</button>` : ""}
          <button class="frn-cuts-row-btn ${isPending?"undo":"cut"}" onclick="frnFACutsTogglePending('${cleanName(p.name)}')">
            ${isPending ? "← undo" : "✗ cut"}
          </button>
        </div>
      </td>
    </tr>`;
  }).join("") : `<tr><td colspan="12" style="text-align:center;padding:1.2rem;color:var(--gray);font-style:italic">No players match the current filters. ${(filterMode || posFilter) ? `<a onclick="frnFACutsClearFilters()" style="color:var(--gold-lt);cursor:pointer;text-decoration:underline">Clear filters →</a>` : ""}</td></tr>`;

  const tableHtml = `
    <div class="frn-cuts-table-wrap">
      <table class="frn-cuts-table">
        <thead>
          <tr>
            <th>Pos</th><th>Player</th><th>OVR</th>
            <th title="Hidden ceiling tier (S best → D worst). Your scouts may be wrong; click a player to dig deeper.">Ceil</th>
            <th>Age</th><th>Yrs</th>
            <th>AAV</th><th>'25 Hit</th><th>Dead $</th><th>Net Relief</th>
            <th>Recommendation</th><th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;

  // — FINAL FOOTER —
  const footerHtml = `
    <div class="frn-cuts-footer">
      <button class="btn btn-gold-big ${(!overCap || willBeLegal)?"":"disabled"}"
        ${(overCap && !willBeLegal)?`disabled style="opacity:.45;cursor:not-allowed" title="Stage enough cuts to clear $${remainingNeed.toFixed(1)}M before starting Week 1."`:""}
        onclick="${(!overCap || willBeLegal)?"frnConfirmFAFinish()":"return false"}">
        ▶ START WEEK 1
      </button>
      ${overCap && !willBeLegal ? `<div class="frn-cuts-footer-warn">Stage at least $${remainingNeed.toFixed(1)}M more in cuts to start the season.</div>` : ""}
    </div>`;

  $("frnHomeContent").innerHTML = `
    ${heroHtml}
    ${pendingPanelHtml}
    ${depthHtml}
    ${filterStripHtml}
    ${tableHtml}
    ${footerHtml}`;
}

// Legacy direct-cut shim — staging is the new primary path, but this is
// still referenced from FA flows that want to release immediately
// (e.g., the FA negotiations "cut to make room" panel uses it directly).
async function frnFACutPlayer(name, pos) {
  if (!await _frnConfirm(`Release ${name}? They free up their cap immediately.`)) return;
  const roster = franchise.rosters[franchise.chosenTeamId];
  const idx = roster.findIndex(p => p.name === name && p.position === pos);
  if (idx !== -1) roster.splice(idx, 1);
  saveFranchise();
  renderFrnFACuts();
}

function frnFAFinish() {
  franchise.phase = "regular";
  franchise._faResults = null;
  saveFranchise();
  showFranchiseDashboard();
}

// ── League chat ───────────────────────────────────────────────────────────────
// Single-player today, but the data model maps cleanly onto the MegaETH
// chat contract: messages are events keyed by (season, week, teamId).
// The on-chain version swaps frnPostMessage for a contract write +
// substitutes _generateAITrashTalk with subscribed event ingestion.
function frnPostMessage(text) {
  const t = (text || "").trim();
  if (!t) return;
  if (!franchise.chat) franchise.chat = [];
  franchise.chat.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    ts: Date.now(),
    season: franchise.season,
    week:   franchise.week,
    teamId: franchise.chosenTeamId,
    text:   t.slice(0, 280),
  });
  // Cap to 200 entries
  if (franchise.chat.length > 200) franchise.chat = franchise.chat.slice(-200);
  saveFranchise();
  renderFrnChat();
}

const TRASH_TALK_LINES = {
  blowout_win:    ["Got 'em.", "Talked all week, played like that.", "Mercy rule should be a thing.", "Cancel the rest of the season."],
  blowout_loss:   ["We had a bye week, right?", "I'm benching everybody.", "Trade block just doubled."],
  upset_win:      ["Underdog who??", "We told you. Y'all didn't listen.", "Powerhouses are overrated."],
  upset_loss:     ["Soft schedule, my bad.", "Wake-up call.", "Heads will roll Monday."],
  trade_made:     ["Wheelin' and dealin'.", "Sometimes you gotta restock.", "Mortgaging futures, baby."],
  signing:        ["Welcome to the squad.", "We got our guy.", "Big pickup."],
  generic:        ["Anyone wanna scrimmage?", "Free agency is wild this year.", "Need a corner. Trades open."],
};

function _generateAITrashTalk() {
  if (!franchise.chat) franchise.chat = [];
  // Look at last week's news for talking points; post 0-3 AI messages per advance
  const lastWeek = franchise.week - 1;
  const recent = (franchise.news || []).filter(n => n.season === franchise.season && n.week === lastWeek);
  const myId = franchise.chosenTeamId;
  const posted = new Set();
  const choose = arr => arr[Math.floor(Math.random() * arr.length)];

  for (const n of recent) {
    if (Math.random() > 0.35) continue;
    // Pick a random team that wasn't the user
    const t = TEAMS.filter(x => x.id !== myId)[Math.floor(Math.random() * (TEAMS.length - 1))];
    if (posted.has(t.id)) continue;
    posted.add(t.id);
    let pool = TRASH_TALK_LINES.generic;
    if (n.type === "blowout") pool = TRASH_TALK_LINES.blowout_win;
    else if (n.type === "upset") pool = TRASH_TALK_LINES.upset_win;
    else if (n.type === "trade") pool = TRASH_TALK_LINES.trade_made;
    else if (n.type === "signing") pool = TRASH_TALK_LINES.signing;
    franchise.chat.push({
      id: `ai-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      ts: Date.now(),
      season: franchise.season,
      week:   franchise.week,
      teamId: t.id,
      text:   choose(pool),
    });
  }
  if (franchise.chat.length > 200) franchise.chat = franchise.chat.slice(-200);
}

