# Hashmark Heroes — Gameplay Loop & UX Map
*(originally documented as "GridironChain"; renamed 2026-05)*

> **Purpose.** The durable map of the franchise-mode gameplay loop: every
> screen, the systems on it, the pacing, and the navigation (next / back /
> home) — so we can optimize the UX deliberately, unify navigation, and make
> sure every engine system actually surfaces to the player. Companion to
> `AUDIT.md` (which covers sim *realism*); this covers the *experience*.
>
> Line numbers are references into large files and may drift — grep the
> function name to re-locate.

---

## TL;DR

- The loop is a **phase machine** (`franchise.phase`): `preseason → free_agency
  → (free_agency_results → fa_cuts) → regular → playoffs → awards → offseason →
  draft (preshow → board → UDFA → grade) → new season → …`.
- **Forward navigation is solid** (every screen has a clear primary CTA).
- **Back / home is NOT unified** — some screens have a back button (and
  shouldn't, e.g. mid-playoffs/mid-draft), others lack one (and should), some
  return to the dashboard, some are hard-locked, and confirms are raw
  `window.confirm()`. **This is the #1 UX fix.**
- **Most engine systems surface**; two don't: **13 personnel (JUMBO) is
  invisible**, and **per-game fatigue is invisible**.

---

## 1. The full loop (in order)

Entry: **Mode select** (Franchise vs Testing, `play.html` `modeFranchiseBtn`) →
**Start/Load** (`renderFrnStartScreen`, core ~4102) → **Team picker**
(`renderFrnTeamPicker`, season ~352) → **`startFranchise()`** → dashboard router
(`showFranchiseDashboard`) which dispatches by `franchise.phase`.

| # | Phase | Screen / render fn | What the player does | Forward CTA → fn | Systems on screen |
|---|---|---|---|---|---|
| 0 | preseason | `renderFrnPreseason` (season ~640) | review roster/depth/cap, scout | "▶ START SEASON" → `frnStartSeason` | roster, depth chart, **cap**, archetypes, over-cap wizard |
| 1 | free_agency | `renderFrnFA` (season ~5322) | bid on FAs (AAV/years), preview odds | "END FREE AGENCY" → `frnConfirmFAFinish` | **cap/contracts**, FA market, offer odds |
| 2 | free_agency_results | `renderFrnFAResults` (season ~7103) | review signed/declined | "▶ START WEEK 1" → `frnFAFinish` / "→ MAKE CUTS" → `frnFAGoToCuts` | cap timeline |
| 3 | fa_cuts *(only if over cap)* | `renderFrnFACuts` (season ~7748) | cut/restructure to fit cap | "START WEEK 1" → `frnFAFinish` | **cap treemap**, dead-cap, restructure |
| 4 | regular (Wk 1-14) | app shell `_frnRenderActiveTab` (render.js) | sim games, manage roster | "ADVANCE WEEK" → `frnAdvanceWeek`; auto → playoffs | games, **injuries**, standings, stats, trades, scouting, **weather** (in-game) |
| 4b | week recap (modal) | `_showWeekRecapIfReady` | watch top plays | dismiss → `frnDismissWeekRecap` | highlights |
| 5 | season recap *(milestone)* | `renderFrnSeasonRecap` (stats ~6569) | review season + bracket | "→ WILD CARD" → `startFrnPlayoffs` / "→ OFFSEASON" → `startFrnOffseason` | standings, award race, seed |
| 6 | playoffs | `renderFrnPlayoffs` (offseason ~4567) | sim bracket | "→ NEXT ROUND" → `frnAdvancePlayoffRound` | 8-team bracket, All-Pro Bowl |
| 7 | awards | `showFrnAwards`/`renderFrnAwards` (offseason ~5004/8484) | view MVP/All-Pro/HOF | "→ BEGIN OFFSEASON" → `startFrnOffseason` | awards, **HOF**, accolades, **coach** grades |
| 8 | offseason | `renderFrnResignings` (~7644) → `renderFrnOffseason` (~13558) | re-sign, resolve holdouts | "→ DRAFT" → `frnConfirmGoToDraft` | **contracts/cap**, holdouts, trades |
| 9 | draft preshow | `renderFrnDraftPreshow` (~18294) | watch combine, pin watchlist | "BEGIN DRAFT" → `renderFrnDraft` | class grades, mock, **archetypes** |
| 10 | draft board | `renderFrnDraft` (~20730) | make picks | pick → `frnDraftPick` / `frnAutoPickThisSlot` | scouting, film grade, **archetypes** |
| 11 | UDFA scramble | `renderFrnUDFAScramble` (~22594) | claim UDFAs | "✓ FINISH DRAFT" → `frnDraftFinishScramble` → `_draftFinalize` | positional needs |
| 12 | post-draft grade | `_renderPostDraftGrade` (~21599) | read draft report card | "▶ BEGIN NEW SEASON" → `frnConfirmDraftContinueToSeason` → `frnNewSeason` | grade, value/reach |
| → | new season | `frnNewSeason` (~13983) | — | loops to phase 1 | aging, retirement, **cap inflation**, coaching carousel |

---

## 2. Navigation gap analysis (the unification target)

**Back-button behavior is inconsistent screen-to-screen:**

| Screen | Back button? | Problem |
|---|---|---|
| Preseason | only in scout sub-view | inconsistent |
| FA / FA results / FA cuts | none (hard/soft lock) | no escape hatch, no clear messaging |
| Regular season | contextual `frnReturnBtn` | shows in some views, not others |
| Season recap | none (forced) | full-screen takeover but `phase` is still `regular` (confusing state) |
| Playoffs | "‹ Return to Main Screen" | **exits mid-bracket with no warning** |
| Awards | none (forced) | fine, but inconsistent with playoffs |
| Offseason | internal "← Back to edit" only | no global home; nested holdout modals can trap |
| Draft board | `frnReturnBtn` if visible | **exits mid-draft with no warning** |
| UDFA / post-draft grade | none | forced forward |

**Other issues:** confirms are raw `window.confirm()`; `frnReturnBtn` visibility
is ad-hoc; milestone screens (season recap, post-draft grade) aren't real phases
(rendered off booleans like `seasonOver`/`preshowDone`), which is fragile.

### Proposed unified pattern
1. **One persistent nav bar** on every full-screen phase with a consistent
   slot layout: `[← Back/Home]   [phase title + step]   [Primary CTA →]`.
2. **Back semantics by screen class:**
   - *Loop/milestone screens* (season recap, awards, post-draft grade): Back =
     **Home to dashboard** (read-only return), never "undo the phase."
   - *Locked transactional screens* (FA, FA cuts, mid-draft, mid-playoffs):
     replace the dangerous back with **"Home (progress saved)"** that returns to
     the dashboard without losing bracket/draft state — or disable + tooltip.
   - *Dashboard tabs* (regular season): Back is a no-op; the tab bar IS the nav.
3. **Replace `window.confirm()`** with one styled modal component
   (title/body/confirm/cancel) used by all `frnConfirm*`.
4. **Promote milestones to real phases** (`season_recap`, `draft_grade`) so the
   router — not booleans — drives them; eliminates the "phase says regular but
   we're on the recap" confusion.
5. **Standardize `frnReturnBtn`**: present on every non-dashboard full-screen,
   labeled "Home", always routing to `showFranchiseDashboard()`.

---

## 3. Pacing (clicks per full season cycle)

| Segment | Fast path | Engaged path |
|---|---|---|
| Preseason → FA → results/cuts | ~12 | ~20 |
| Regular season (14 wk) | ~7 (sim-all) | ~100 (manual games + mgmt) |
| Recap → playoffs → APB → awards | ~8 | ~12 |
| Offseason (re-sign/holdouts) | ~6 | ~20 |
| Draft (preshow/board/UDFA/grade) | ~8 + watch | ~40 |
| New-season confirm | 1 | 1 |
| **Total** | **~40-60 clicks + 5-10 min watching** | **~150-200 clicks + 30-60 min** |

No forced pauses; every screen is click-through or auto-advances. Opportunity:
the fast path is good; the friction is **accidental traps** (no home on locked
screens) and **redundant raw confirms**, not click count.

---

## 4. Engine → UI surfacing (do the systems reach the player?)

**Surfaced ✓**
- **Archetypes** — player cards + depth-chart "fit" badges (season ~3814, stats ~3739).
- **Injuries** — card + vitals "OUT Xw / CAREER-END" (season ~1240, ~3738).
- **Weather** — field badge + rain/snow/wind particles (render ~262-328).
- **Salary cap / contracts** — roster AAV, offseason cap hit (season ~474, ~704).
- **Coaching traits** — HC culture/specialty, coach market (stats ~2989, ~9667).
- **Dual-threat QB runs** — play-by-play "{QB} keeps it for X yds" (engine ~6027).
- **Stamina (base stat)** — snap charts "STAM XXX" + ⚠ conflict flags (stats ~4865).
- **Wear / stress** — feed injury risk; in the player data export (stats ~5247).

**NOT surfaced — punch list**
1. ✅ **13 personnel / JUMBO — SURFACED.** Play-by-play chips (`play-broadcast.js`
   `_pbpChips`): the offensive "tell" package (gold "13 pers" for JUMBO; ghost-blue
   12/10/01/21; vanilla 11 omitted) AND the defensive sub-package faced (red-toned
   "NICKEL"/"DIME"/"QUARTER"; vanilla 4-3 omitted) — so the matchup reads at a
   glance. TE-targeting (`pickReceiver`, play-data.js): TE2 already had a share in
   HEAVY/JUMBO; TE3 now gets ~7% in JUMBO (move-TE 50 / TE2 33 / TE3 17 of the TE
   share), so a 3-TE set is no longer a pure blocking label. (Engine-metric-neutral
   within gate tolerance — verified.)
2. ✅ **Per-game fatigue (0-100) — SURFACED** as an "F" bar in the live-bio HUD
   (`play-broadcast.js` `LiveBioPanel._row`, alongside Wear/Stress), green→amber→
   red. Engine plumbing: `GameSimulator._statsSnapWithFatigue()` enriches each
   play's `statsSnap` with per-player `_fatigueLevel` (otherwise engine-internal).
   A workhorse RB hits ~67/100 by game end → visible amber bar. *Still open:*
   fatigue only shows once a player has a stat-snapshot entry (early game sparse).
3. **Wear/stress are data-only** beyond the live-bio W/S bars — no clean
   player-facing "load/health" readout on the vitals/franchise screens. *Fix
   (optional):* a load meter on the vitals screen.

---

## 5. Action items (executed — full 6-step UX plan shipped 2026-05)

This is the original prioritized plan. All 6 steps shipped in this session.

| step | what | commit(s) |
|---|---|---|
| ✅ 1 | **Banner removed** — ASCII-art "GRIDIRON CHAIN" header gone from play.html. Brand identity carried by browser tab title + welcome card title for new users / `frnAppShell` team nameplate for returning users. Frees the prime above-the-fold real estate. | `7c8e5b3` |
| ✅ 2 | **Testing tools demoted** — `🏈 Franchise Mode / 🧪 Testing Tools` tabs no longer on front page (new-player trap). Reachable via discreet `🛠 dev tools` footer link or `?dev=1` URL param. Testing panel gets its own `← Back to Franchise` button. | `7c8e5b3` |
| ✅ 3 | **Delete safety** — Slot row `[▶ Load] [✎] [✗]` → `[▶ Load] [⋯]` with Rename + Delete inside a popover menu (kills misclick chain). `_frnConfirmModal(opts)` styled async modal with rich slot summary (team, season, record, last saved) + red "cannot be undone" warning + **type-the-name gate for franchises ≥ 5 seasons**. | `c14f4ee` |
| ✅ 4 | **Your Story new-player flow** — `🚀 QUICK START` (random powerhouse team → skip preseason → Week 1 in 30s) + `Choose Your Story →` (3 archetypes: 🏆 WIN NOW / ⚡ RISING / 🔧 REBUILD, each with 3 hand-picked teams + Roster OVR + pitch + difficulty hint) + `Browse All 32 Teams →` (legacy picker). Replaces "32-team grid with no context" cold-start. | `e2a5e02` |
| ✅ 5 | **Unified in-loop nav rail** — `<div id="frnNavBar">` between `frnAppShell` and `frnHomeContent`, populated by `_frnUpdateNavBar()` called from `showFranchiseDashboard` (single touch point, NOT N render fns). Layout: `[← Home]   Title · Season N · step`. Two variants: `milestone` (neutral gold border, "← Home") for awards/recap/grade screens; `locked` (gold-amber gradient, "← Home (saved)") for FA/playoffs/draft/offseason where progress IS preserved. `_frnGoHome()` saves + clears active + returns to start screen — never an undo. Universal escape hatch — even renders above error-fallback screens. | `4c2afde` |
| ✅ 6 | **All raw confirm() → styled modal** — 40 native `window.confirm()` callsites across 4 files swapped to `await _frnConfirm(msg)` (Promise<boolean>-returning shim routing through `_frnConfirmModal`). 41 enclosing functions marked async via deterministic walk-back. The wrapper at season.js:7252 stays as fallback to `window.confirm` if the modal helper isn't loaded. Inline onclick at stats.js:3874 handled via `data-confirm-msg` + async IIFE. | (this session) |

**Also done this session:**
- 🏈 **Rebrand**: GridironChain → Hashmark Heroes — American Football Manager. User-facing strings only; codebase identifiers (directory, CSS classes, var names) preserved to avoid massive non-UX churn.
- 🔧 **UX verification harness**: `_ux_snapshot.js` (Playwright) — see `AUDIT.md`. Standard verification loop for any UX edit; produces directly-readable PNGs in `/tmp/ux/`.

**Queued / next** (post-talent-retune polish):
1. **Office-mode aesthetic** — diegetic GM-at-a-desk treatment (inbox / spreadsheet / formal-document framings). Long arc, multi-session.
2. **Surface per-game fatigue** in the in-game player chips / snap chart (the recovery fix from earlier has no UI).
3. **Defensive-coding pass** — `renderFrnPlayoffs` crashed on minimal stub during step 5 verification; suggests other render functions have similar non-defensive assumptions about `franchise.playoffBracket.rounds` etc.
5. Replace remaining `window.confirm()` calls.
