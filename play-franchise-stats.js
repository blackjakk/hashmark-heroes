// ── League Wire archive (reimagined) ─────────────────────────────────────────
// Front-page lead stories + topic filter pills + MY TEAM/LEAGUE scope toggle
// + storyline auto-grouping + cross-season view. State persists across
// re-renders so closing a deep link / replay doesn't reset your spot.
let _frnWireTopic    = "all";
let _frnWireScope    = "league"; // "team" | "league"
let _frnWireExpanded = new Set();
let _frnWireHideMinor = false;   // when true, hides dev_surge + rehab for non-user teams
function frnSetWireTopic(t) { _frnWireTopic = t; renderFrnNewsArchive(); }
function frnSetWireScope(s) { _frnWireScope = s; renderFrnNewsArchive(); }
function frnToggleWireMinor() { _frnWireHideMinor = !_frnWireHideMinor; renderFrnNewsArchive(); }
function frnToggleStoryline(key) {
  if (_frnWireExpanded.has(key)) _frnWireExpanded.delete(key);
  else _frnWireExpanded.add(key);
  renderFrnNewsArchive();
}

// Comprehensive icon for every news type pushed via _pushNews.
function _wireIcon(t) {
  const map = {
    // Trades / roster
    trade:"🔀", extension:"📝", restructure:"♻", tag:"🏷",
    // FA
    fa_sign:"🆓", fa_unsigned:"❌", fa_war:"⚔",
    fa_activity:"📋", fa_demand_drop:"📉",
    holdout:"😤", holdout_demand:"💰",
    workout:"💪", scout_reveal:"👀",
    // Coaches
    coach_hire:"🎩", coach_depart:"🚪",
    coach_bond:"🤝", coach_decline:"📉",
    coach_grow:"📈", hot_seat:"🔥",
    // Players
    injury:"🩹", age_cliff:"⏳", decline:"📉",
    breakout:"⭐",
    // Practice squad
    ps_flash:"✨", ps_gem:"💎", ps_lost:"💔",
    ps_poach:"🪤", ps_promote:"⬆", ps_scout:"🔍",
    // League
    hof:"🏛", draft:"📋",
    blowout:"🔥", upset:"⚡", scrimmage:"🏟",
    // New (post-overhaul) types
    milestone:"🏛", award_special:"🏆", storyline:"📊",
    rehab:"✅", dev_surge:"📈",
  };
  return map[t] || "📰";
}

// Topic groupings for the filter pills.
const _WIRE_TOPICS = [
  { key:"all",        label:"All" },
  { key:"trades",     label:"Trades",     types:["trade"] },
  { key:"fa",         label:"FA",         types:["fa_sign","fa_unsigned","fa_war","fa_activity","fa_demand_drop","holdout","holdout_demand","workout","scout_reveal","extension","restructure","tag"] },
  { key:"coaches",    label:"Coaches",    types:["coach_hire","coach_depart","coach_bond","coach_decline","coach_grow","hot_seat"] },
  { key:"injuries",   label:"Injuries",   types:["injury","age_cliff","decline","rehab"] },
  { key:"awards",     label:"Awards",     types:["breakout","blowout","upset","award_special"] },
  { key:"milestones", label:"Milestones", types:["milestone"] },
  { key:"storylines", label:"Storylines", types:["storyline"] },
  { key:"dev",        label:"Dev",        types:["dev_surge"] },
  { key:"hof",        label:"HOF",        types:["hof"] },
  { key:"draft",      label:"Draft",      types:["draft","ps_gem","ps_flash","ps_lost","ps_poach","ps_promote","ps_scout"] },
];
function _wireTopicOf(type) {
  for (const t of _WIRE_TOPICS) {
    if (t.types && t.types.includes(type)) return t.key;
  }
  return "misc";
}

// Lead-story weighting. Higher = goes to the front-page hero band.
// Boosted when the user's team is involved (detected via label text).
// Freshness decay layered on top — older entries lose lead priority.
function _wireWeight(item, myTeamNames) {
  const baseByType = {
    hof: 14, milestone: 11, trade: 9, fa_war: 8, award_special: 8,
    draft: 7, breakout: 7, upset: 7, coach_depart: 7, coach_hire: 7,
    storyline: 6, holdout: 6, hot_seat: 6,
    fa_sign: 5, ps_gem: 5,
    blowout: 4, injury: 4, tag: 4, coach_decline: 4, ps_lost: 4,
    ps_poach: 4, rehab: 4,
    extension: 3, dev_surge: 3, age_cliff: 3, decline: 3, ps_promote: 3,
    restructure: 2, fa_unsigned: 2, ps_flash: 2, workout: 2,
    coach_bond: 2, coach_grow: 2, scout_reveal: 2,
    fa_activity: 1, fa_demand_drop: 1, ps_scout: 1, scrimmage: 1,
  };
  let w = baseByType[item.type] || 1;
  // Big-dollar FA signings (>$8M AAV detection from label)
  if (item.type === "fa_sign" && /\$\d{2,}\.\d+M/.test(item.label || "")) w += 2;
  // Boost if user's team is mentioned in the label
  if (myTeamNames) {
    for (const n of myTeamNames) {
      if (item.label && item.label.includes(n)) { w += 3; break; }
    }
  }
  // Freshness decay: stories from previous weeks lose lead priority.
  // 5% off per week-of-age, floored at 30% of base weight. Computed
  // against current season/week; cross-season items are heavily
  // decayed unless they're high-tier (HoF, milestone).
  const curSeason = franchise?.season || 1;
  const curWeek   = franchise?.week || 1;
  if (item.season != null) {
    const seasonGap = curSeason - item.season;
    const weekGap   = seasonGap * 25 + Math.max(0, curWeek - (item.week || 0));
    const decay = Math.max(0.30, 1 - weekGap * 0.05);
    w *= decay;
  }
  return w;
}

// Better week labels. Numeric weeks 1..FRANCHISE_WEEKS stay; postseason
// gets named rounds; week 0 / non-numeric handled by phase context.
function _wireWeekLabel(item, sel) {
  const w = item.week;
  if (w == null) return "OFFSEASON";
  if (w >= 1 && w <= FRANCHISE_WEEKS) return `WEEK ${w}`;
  // Past the reg-season window — assume playoffs
  const idx = w - FRANCHISE_WEEKS - 1;
  const ROUNDS = ["WILD CARD","DIVISIONAL","CHAMPIONSHIP"];
  if (idx >= 0 && idx < ROUNDS.length) return ROUNDS[idx];
  if (w === 0) return "OFFSEASON";
  return `WEEK ${w}`;
}

// Decorate a label: team names get a color chip, known player names get
// a clickable link. Both are best-effort — escape carefully and don't
// touch already-decorated content.
function _decorateWireLabel(rawLabel, teamSet, playerSet) {
  if (!rawLabel) return "";
  let out = rawLabel;
  // Team chip — longest match first to avoid prefix collisions ("New" vs "New York")
  const teamNames = [...teamSet.keys()].sort((a, b) => b.length - a.length);
  for (const name of teamNames) {
    const team = teamSet.get(name);
    // Match the team name only when it's bounded by non-word chars or string
    // start/end. Skip if already inside our chip span.
    const re = new RegExp(`(^|[^A-Za-z>])(${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=[^A-Za-z<]|$)`, "g");
    out = out.replace(re, (m, pre, hit) => `${pre}<span class="frn-wire-team" style="color:${team.primary}">${hit}</span>`);
  }
  // Player link — same boundary trick. Iterate longest-first.
  const players = [...playerSet].sort((a, b) => b.length - a.length);
  for (const name of players) {
    if (name.length < 5) continue; // skip very short / ambiguous strings
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reN = new RegExp(`(^|[^A-Za-z>])(${esc})(?=[^A-Za-z<]|$)`);
    if (!reN.test(out)) continue;
    const escClick = name.replace(/'/g, "\\'");
    out = out.replace(reN, (m, pre, hit) =>
      `${pre}<span class="frn-wire-player" onclick="frnOpenPlayerCard('${escClick}')">${hit}</span>`);
  }
  return out;
}

// Detect storylines in a list of items. Returns [{ key, title, items[] }].
// Rules:
//  - 3+ trades in same week → "Trade Deadline · WEEK N"
//  - 5+ fa_sign in same week → "FA Frenzy · WEEK N"
//  - 3+ items mentioning the same player name across the season → player thread
//  - 3+ coach_hire/depart in the same week → "Coaching Carousel · WEEK N"
function _wireStorylines(items, playerSet) {
  const lines = [];
  // Week-based clusters
  const byWeekType = {};
  for (const it of items) {
    const k = `${it.week}|${_wireTopicOf(it.type)}`;
    (byWeekType[k] ||= []).push(it);
  }
  for (const [k, list] of Object.entries(byWeekType)) {
    const [wk, topic] = k.split("|");
    if (topic === "trades" && list.length >= 3) {
      lines.push({ key:`trade-${wk}`, title:`🔀 Trade Activity · ${_wireWeekLabel({week:+wk||null})}`, items:list });
    }
    if (topic === "fa" && list.filter(x => x.type==="fa_sign").length >= 5) {
      lines.push({ key:`fa-${wk}`, title:`🆓 FA Frenzy · ${_wireWeekLabel({week:+wk||null})}`, items:list.filter(x=>x.type==="fa_sign") });
    }
    if (topic === "coaches" && list.length >= 3) {
      lines.push({ key:`coach-${wk}`, title:`🎩 Coaching Carousel · ${_wireWeekLabel({week:+wk||null})}`, items:list });
    }
  }
  // Per-player thread — count appearances by name substring match.
  const playerHits = {};
  for (const name of playerSet) {
    if (name.length < 5) continue;
    const hits = items.filter(x => x.label && x.label.includes(name));
    if (hits.length >= 3) playerHits[name] = hits;
  }
  for (const [name, hits] of Object.entries(playerHits)) {
    lines.push({ key:`p-${name}`, title:`📰 ${name} — ${hits.length} mentions this season`, items:hits });
  }
  // Milestone cluster — 3+ career milestones in the same week
  for (const [k, list] of Object.entries(byWeekType)) {
    const [wk, topic] = k.split("|");
    if (topic === "milestones" && list.length >= 3) {
      lines.push({ key:`mile-${wk}`, title:`🏛 Milestone Week · ${_wireWeekLabel({week:+wk||null})}`, items:list });
    }
  }
  // Dynasty thread — same team won SB in 2+ consecutive seasons.
  if (franchise.history?.length >= 2) {
    const recent = franchise.history.slice(-6); // last 6 seasons
    const teamCounts = {};
    for (const h of recent) {
      if (h.champion != null) teamCounts[h.champion] = (teamCounts[h.champion] || 0) + 1;
    }
    for (const [tidStr, cnt] of Object.entries(teamCounts)) {
      if (cnt >= 2) {
        const tid = Number(tidStr);
        const tm = getTeam(tid);
        const champItems = items.filter(x => x.label && tm && (x.label.includes(tm.name) || x.label.includes(tm.city)));
        if (champItems.length >= 2) {
          lines.push({ key:`dyn-${tidStr}`, title:`👑 DYNASTY WATCH — ${tm?.city || ""} ${tm?.name || ""} (${cnt} SBs in 6 yrs)`, items: champItems.slice(0, 6) });
        }
      }
    }
  }
  // Position-room thread — 3+ injury/breakout entries at the same team's
  // same position. Detected by parsing the label for "POS NAME (Team..."
  // patterns. Soft heuristic — only fires when very visible.
  // (Skipped for simplicity — would require label parsing; lower
  // marginal value than the above.)
  // Sort: highest-impact first (longest list wins, ties broken by week recency)
  lines.sort((a, b) => b.items.length - a.items.length);
  return lines;
}

function renderFrnNewsArchive(season) {
  const myId = franchise?.chosenTeamId;
  const myTeam = myId != null ? getTeam(myId) : null;
  const allSeasons = Array.from(new Set((franchise.news || [])
    .map(n => n.season))).sort((a, b) => b - a);
  if (!allSeasons.length) allSeasons.push(franchise.season);
  // Season selector accepts "all" for cross-season view (Tier 3)
  const sel = season != null ? (season === "all" ? "all" : Number(season)) : allSeasons[0];

  // Build lookup sets
  const teamSet = new Map();
  for (const t of TEAMS) {
    teamSet.set(t.name, t);
    if (t.city && t.city !== t.name) teamSet.set(`${t.city} ${t.name}`, t);
  }
  const playerSet = new Set();
  for (const roster of Object.values(franchise.rosters || {})) {
    for (const p of roster) if (p?.name) playerSet.add(p.name);
  }
  for (const h of (franchise.hallOfFame || [])) if (h?.name) playerSet.add(h.name);
  // My-team name patterns for "involvement" detection (label text-based)
  const myTeamNames = myTeam ? [myTeam.name, `${myTeam.city} ${myTeam.name}`] : [];

  // Filter source by season selection
  const seasonFiltered = (franchise.news || [])
    .filter(n => sel === "all" || n.season === sel);

  // Filter by scope (MY TEAM / LEAGUE)
  const isMyItem = (n) => myTeamNames.some(name => (n.label || "").includes(name));
  const _MINOR_TYPES = new Set(["dev_surge","rehab","scout_reveal","fa_activity","fa_demand_drop","workout"]);
  const scopeFiltered = (() => {
    let base = _frnWireScope === "team"
      ? seasonFiltered.filter(isMyItem)
      : seasonFiltered;
    // Hide-minor filter: drop low-impact entries that don't mention the
    // user's team. Lets the user de-clutter the global firehose without
    // losing major events (milestones / awards / trades / etc.).
    if (_frnWireHideMinor) {
      base = base.filter(n => !_MINOR_TYPES.has(n.type) || isMyItem(n));
    }
    return base;
  })();

  // Filter by topic
  const topicFiltered = _frnWireTopic === "all"
    ? scopeFiltered
    : scopeFiltered.filter(n => _wireTopicOf(n.type) === _frnWireTopic);

  // Sort newest first (season desc, then week desc)
  const sorted = topicFiltered.slice().sort((a, b) =>
    (b.season - a.season) || ((b.week || 0) - (a.week || 0)));

  // ── Front page leads (always from scopeFiltered — not affected by topic
  //    filter, so the front page still represents the whole season) ───
  const leadPool = scopeFiltered
    .map(it => ({ it, w: _wireWeight(it, myTeamNames) }))
    .sort((a, b) => b.w - a.w);
  const leads = leadPool.slice(0, 5).map(x => x.it);

  // ── This Week hero — top entry from the current season+week ──────────
  // Replaces silence with a "what's the headline RIGHT NOW" beat. Drops
  // out when viewing past seasons or when current week has no entries.
  const curSeason = franchise?.season || 1;
  const curWeek   = franchise?.week   || 0;
  const isCurrentSeasonView = sel === "all" || sel === curSeason;
  const thisWeekTop = isCurrentSeasonView ? (() => {
    const recent = scopeFiltered.filter(n =>
      n.season === curSeason && (n.week || 0) >= Math.max(0, curWeek - 1)
    );
    if (!recent.length) return null;
    const ranked = recent.map(it => ({ it, w: _wireWeight(it, myTeamNames) }))
      .sort((a, b) => b.w - a.w);
    return ranked[0]?.it;
  })() : null;

  // ── Storylines (from the scope-filtered, not topic-filtered, source) ─
  const storylines = _wireStorylines(scopeFiltered, playerSet);

  // ── Build HTML ──────────────────────────────────────────────────────

  // Season selector (adds "ALL" option)
  const seasonNav = [
    ...allSeasons.map(s => `<button class="bspnlive-nav-item ${s===sel?"active":""}"
        style="background:transparent;border:0;font-family:inherit;cursor:pointer;padding:0;${s===sel?"color:var(--blwhite)":""}"
        onclick="renderFrnNewsArchive(${s})">[S${s}]</button>`),
    `<button class="bspnlive-nav-item ${sel==='all'?"active":""}"
      style="background:transparent;border:0;font-family:inherit;cursor:pointer;padding:0;${sel==='all'?"color:var(--blwhite)":""}"
      onclick="renderFrnNewsArchive('all')">[ALL SEASONS]</button>`,
  ].join(" ");

  // Topic pills
  const topicPills = _WIRE_TOPICS.concat([{ key:"misc", label:"Misc" }]).map(t => {
    const count = t.key === "all" ? scopeFiltered.length
      : scopeFiltered.filter(n => _wireTopicOf(n.type) === t.key).length;
    return `<button class="frn-hl-pill${_frnWireTopic===t.key?" active":""}"
              onclick="frnSetWireTopic('${t.key}')"
              ${count===0 && t.key!=='all'?'disabled':''}>
      ${t.label}<span class="frn-hl-pill-count">${count}</span>
    </button>`;
  }).join("");

  // Scope toggle + hide-minor checkbox
  const scopeHtml = `
    <div class="frn-hl-scope">
      <button class="${_frnWireScope==='team'?"active":""}"  onclick="frnSetWireScope('team')">MY TEAM</button>
      <button class="${_frnWireScope==='league'?"active":""}" onclick="frnSetWireScope('league')">LEAGUE</button>
      <button class="${_frnWireHideMinor?"active":""}" onclick="frnToggleWireMinor()" title="Hide low-impact dev / rehab / scout-reveal events for non-user teams" style="margin-left:.5rem">${_frnWireHideMinor?"✓":"○"} Hide minor</button>
    </div>`;

  // This-Week hero — single dominant entry from the current week
  const thisWeekHtml = (thisWeekTop && _frnWireTopic === "all") ? `
    <div class="frn-wire-thisweek">
      <div class="frn-wire-thisweek-eyebrow">📡 THIS WEEK · ${_wireWeekLabel(thisWeekTop)}</div>
      <div class="frn-wire-thisweek-body">
        <div class="frn-wire-thisweek-icon">${_wireIcon(thisWeekTop.type)}</div>
        <div class="frn-wire-thisweek-headline">${_decorateWireLabel(thisWeekTop.label || "", teamSet, playerSet)}</div>
      </div>
    </div>` : "";

  // Front-page leads — only show when not filtered down by a non-all topic
  const leadsHtml = (leads.length && _frnWireTopic === "all") ? `
    <div class="frn-wire-leads-wrap">
      <div class="frn-wire-leads-eyebrow">📰 FRONT PAGE${_frnWireScope==='team'?" — YOUR TEAM":""}</div>
      <div class="frn-wire-leads-grid">
        ${leads.map((it, i) => {
          const decorated = _decorateWireLabel(it.label || "", teamSet, playerSet);
          const isHero = i === 0;
          return `<article class="frn-wire-lead${isHero?" hero":""}">
            <div class="frn-wire-lead-icon">${_wireIcon(it.type)}</div>
            <div class="frn-wire-lead-body">
              <div class="frn-wire-lead-meta">S${it.season} · ${_wireWeekLabel(it)}</div>
              <div class="frn-wire-lead-headline">${decorated}</div>
            </div>
          </article>`;
        }).join("")}
      </div>
    </div>` : "";

  // Storylines section
  const storylinesHtml = (storylines.length && _frnWireTopic === "all") ? `
    <div class="frn-wire-storylines">
      <div class="frn-wire-storylines-head">🧵 STORYLINES <span class="sub">recurring threads this season</span></div>
      ${storylines.map(s => {
        const isOpen = _frnWireExpanded.has(s.key);
        const escKey = s.key.replace(/'/g, "\\'");
        return `<div class="frn-wire-storyline${isOpen?" open":""}">
          <button class="frn-wire-storyline-head" onclick="frnToggleStoryline('${escKey}')">
            <span class="caret">${isOpen?"▾":"▸"}</span>
            <span class="title">${s.title}</span>
            <span class="count">${s.items.length}</span>
          </button>
          ${isOpen ? `<ul class="frn-wire-storyline-list">${s.items.slice().sort((a,b)=>(b.week||0)-(a.week||0)).map(it => `
            <li class="frn-wire-item">
              <span class="frn-wire-icon">${_wireIcon(it.type)}</span>
              <span class="frn-wire-label">${_decorateWireLabel(it.label||"",teamSet,playerSet)}</span>
              <span class="frn-wire-when">${_wireWeekLabel(it)}</span>
            </li>`).join("")}</ul>` : ""}
        </div>`;
      }).join("")}
    </div>` : "";

  // Chronological feed — group by (season, week)
  const grouped = {};
  for (const n of sorted) {
    const k = `${n.season}|${n.week}`;
    (grouped[k] ||= []).push(n);
  }
  const groupKeys = Object.keys(grouped).sort((a, b) => {
    const [as, aw] = a.split("|").map(Number);
    const [bs, bw] = b.split("|").map(Number);
    return (bs - as) || ((bw || 0) - (aw || 0));
  });
  const weekBlocks = groupKeys.length ? groupKeys.map(k => {
    const [s, w] = k.split("|").map(Number);
    const items = grouped[k];
    const wkLabel = _wireWeekLabel({ week: w });
    return `<div class="frn-wire-week">
      <div class="frn-wire-week-head">${sel==='all'?`SEASON ${s} · `:""}${wkLabel}</div>
      <ul class="frn-wire-list">
        ${items.map(n => `
          <li class="frn-wire-item frn-wire-type-${n.type||""}">
            <span class="frn-wire-icon">${_wireIcon(n.type)}</span>
            <span class="frn-wire-label">${_decorateWireLabel(n.label||"", teamSet, playerSet)}</span>
          </li>`).join("")}
      </ul>
    </div>`;
  }).join("")
    : `<div style="color:var(--blgray);padding:1rem;text-align:center;font-style:italic">No entries match this view.</div>`;

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">LEAGUE WIRE${sel==='all'?" — ALL SEASONS":""}</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("WIRE")}</nav>
      </header>
      <div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:.55rem;flex-wrap:wrap;align-items:center">
        <button class="bspn-back" onclick="showFranchiseDashboard()">‹ Return to Main Screen</button>
        ${seasonNav}
        ${scopeHtml}
      </div>
      <div style="padding:.5rem 1.4rem;border-bottom:1px solid var(--blborder);color:var(--blgray);font-size:.7rem;letter-spacing:.5px">
        ${sel==='all' ? `${(franchise.news||[]).length} entries across ${allSeasons.length} season${allSeasons.length===1?"":"s"}` : `Season ${sel} · ${seasonFiltered.length} entr${seasonFiltered.length===1?"y":"ies"}`}
        · Showing ${sorted.length} in <b>${(_WIRE_TOPICS.find(x=>x.key===_frnWireTopic)?.label||"Misc")}</b>
      </div>
      <div style="padding:1rem 1.4rem;display:flex;flex-direction:column;gap:1rem">
        ${thisWeekHtml}
        ${leadsHtml}
        <div class="frn-hl-pills" style="margin-bottom:0">${topicPills}</div>
        ${storylinesHtml}
        <section class="bspn-panel" style="padding:.7rem 1rem">
          <div class="bspn-panel-title" style="color:var(--blgold);font-size:.75rem;letter-spacing:2px">CHRONOLOGICAL FEED</div>
          <div class="frn-wire-scroll">${weekBlocks}</div>
        </section>
      </div>
    </div>`;
}

// ── Projected free agents: everyone whose contract expires after this season ──
// Sorted by scout grade, grouped into "Your expiring deals" + "League pool".
// Lets the user plan re-signs and identify likely opening-day FA targets.
function renderFrnProjectedFAs(sort) {
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const sortBy = sort || "grade";
  // A player is a "projected FA" if their contract has only 1 year left
  // (they hit the market next offseason). Rookies on their first deal
  // and just-signed FAs typically have more years, so this picks the
  // right cohort.
  const collect = teamId => (franchise.rosters[teamId] || [])
    .filter(p => p.contract && p.contract.remaining === 1)
    .map(p => ({ ...p, _teamId: teamId }));
  const mine = collect(myId);
  const league = TEAMS.filter(t => t.id !== myId).flatMap(t => collect(t.id));
  const sorters = {
    grade: (a, b) => scoutGrade(b) - scoutGrade(a),
    age:   (a, b) => (a.age||0) - (b.age||0),
    pos:   (a, b) => (a.position||"").localeCompare(b.position||"") || (scoutGrade(b)-scoutGrade(a)),
    aav:   (a, b) => (b.contract?.aav||0) - (a.contract?.aav||0),
  };
  mine.sort(sorters[sortBy]); league.sort(sorters[sortBy]);
  const sortBtn = (id, label) =>
    `<button class="frn-ana-tab ${sortBy===id?"active":""}" onclick="renderFrnProjectedFAs('${id}')">${label}</button>`;
  const sortBar = `<div class="frn-ana-tabs" style="margin-bottom:.6rem">
    ${sortBtn("grade","Grade")}${sortBtn("age","Age")}${sortBtn("pos","Position")}${sortBtn("aav","AAV")}
  </div>`;
  const row = p => {
    const tm = getTeam(p._teamId);
    return `<tr>
      <td style="color:var(--gold);font-size:.62rem">${p.position}</td>
      <td style="font-weight:700">${playerLink(p)}</td>
      <td>${gradeBadge(p)}</td>
      <td style="color:var(--gray)">${p.age||"?"}</td>
      <td style="color:var(--gray);font-size:.62rem">${draftStr(p)}</td>
      <td style="color:var(--gold)">$${(p.contract?.aav||0).toFixed(1)}M</td>
      <td style="color:var(--gray);font-size:.62rem">${tm ? tm.name : "—"}</td>
      ${p.injury ? `<td style="color:#ff9090;font-size:.62rem">🩹 ${_bspnEsc(p.injury.label)}</td>` : `<td></td>`}
    </tr>`;
  };
  const tableHead = `<thead><tr>
    <th>Pos</th><th>Player</th><th>Grade</th><th>Age</th>
    <th>Draft</th><th>AAV</th><th>Team</th><th></th>
  </tr></thead>`;
  const mineHtml = mine.length ? `
    <table class="frn-pre-roster-table">
      ${tableHead}
      <tbody>${mine.map(row).join("")}</tbody>
    </table>` : `<div style="color:var(--gray);padding:.5rem;text-align:center;font-style:italic">
      No players on your roster have an expiring deal — your books are clean.
    </div>`;
  const leagueHtml = league.length ? `
    <table class="frn-pre-roster-table">
      ${tableHead}
      <tbody>${league.map(row).join("")}</tbody>
    </table>` : `<div style="color:var(--gray);padding:.5rem;text-align:center;font-style:italic">
      No projected free agents league-wide.
    </div>`;
  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">📅 PROJECTED FREE AGENTS</div>
      <div style="color:var(--gray);font-size:.7rem">Players whose contract expires after Season ${franchise.season}</div>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto">← Back</button>
    </div>
    ${sortBar}
    <div class="frn-card-title" style="margin-bottom:.4rem">${myTeam.city.toUpperCase()} ${myTeam.name.toUpperCase()} · ${mine.length} expiring</div>
    ${mineHtml}
    <div class="frn-card-title" style="margin-top:1rem;margin-bottom:.4rem">LEAGUE POOL · ${league.length} expiring</div>
    ${leagueHtml}`;
}

// ── Injury report: every injured player on your roster + key opponents ────────
// ── Practice squad UI ────────────────────────────────────────────────────────
function renderFrnPracticeSquad(tab) {
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const ps = franchise.practiceSquads?.[myId] || [];
  const tabId = tab || "mine";
  const visitsLeft = _scoutVisitsRemaining(myId);
  const psCost = psCostForTeam(myId);
  const autoSpend = franchise.autoSpendScouts !== false;
  const alerts = (franchise.psPoachAlerts || [])
    .filter(a => a.ownerTeamId === myId && a.deadlineWeek >= franchise.week);
  const tabs = [
    { id: "mine",     label: `🏈 MY PS (${ps.length}/${PS_SLOTS})` },
    { id: "league",   label: "🌐 LEAGUE PS" },
    { id: "scouted",  label: `🔍 SCOUTED (${Object.keys(franchise.scoutedPS||{}).filter(n=>franchise.scoutedPS[n].byTeamId===myId).length})` },
  ];
  const tabBar = tabs.map(t =>
    `<button class="frn-ana-tab ${t.id===tabId?"active":""}" onclick="renderFrnPracticeSquad('${t.id}')">${t.label}</button>`
  ).join("");

  let body = "";
  if (tabId === "mine") body = _renderPSMyTab(myId, ps, alerts);
  else if (tabId === "league") body = _renderPSLeagueTab(myId, visitsLeft);
  else body = _renderPSScoutedTab(myId);

  const banner = `
    <div style="display:flex;align-items:center;gap:.8rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🏈 PRACTICE SQUAD</div>
      <div style="color:var(--gray);font-size:.7rem">
        ${myTeam.city} ${myTeam.name} · Week ${franchise.week} ·
        Cost <b style="color:var(--gold-lt)">$${psCost.toFixed(1)}M</b> ·
        Scout visits <b style="color:var(--gold-lt)">${visitsLeft}/${SCOUT_VISITS_PER_WEEK}</b>
      </div>
      <label style="color:var(--gray);font-size:.65rem;display:flex;align-items:center;gap:.3rem;margin-left:auto">
        <input type="checkbox" ${autoSpend?"checked":""} onchange="frnTogglePSAutoSpend(this.checked)">
        Auto-spend remaining scouts on advance
      </label>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()">← Back</button>
    </div>
    <div class="frn-ana-tabs">${tabBar}</div>`;

  $("frnHomeContent").innerHTML = banner + body;
}

function _renderPSMyTab(myId, ps, alerts) {
  const alertHtml = alerts.length ? `
    <div style="background:rgba(255,80,80,0.08);border:1px solid var(--red);padding:.6rem;margin-bottom:.7rem">
      <div style="color:#ff9090;font-weight:700;margin-bottom:.3rem">⚠️ POACH ALERTS (${alerts.length})</div>
      ${alerts.map(a => `
        <div style="font-size:.72rem;padding:.2rem 0">
          ${getTeam(a.suitorTeamId)?.name} wants ${a.position} ${a.playerName} —
          <button class="frn-pcard-yrbtn" onclick="frnPSPromote('${a.playerName.replace(/'/g,"\\'")}')">Promote Now</button>
          or lose him after week ${a.deadlineWeek}
        </div>`).join("")}
    </div>` : "";

  if (!ps.length) {
    return alertHtml + `<div style="color:var(--gray);font-style:italic;padding:1.5rem;text-align:center">Your practice squad is empty. Sign players from cuts or draft them onto the PS.</div>`;
  }
  const rows = ps.map(p => {
    const flashes = (p._psFlashLog || []).filter(f => f.season === franchise.season);
    const hasGem = flashes.some(f => f.kind === "gem");
    const hasWow = flashes.some(f => f.kind === "wow");
    const tag = hasGem ? `<span style="color:var(--gold);font-weight:700">💎 GEM</span>`
              : hasWow ? `<span style="color:var(--gold-lt);font-weight:700">⭐ FLASH</span>`
              : "";
    const escName = (p.name || "").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    return `<tr>
      <td style="color:var(--gold);font-size:.62rem">${p.position}</td>
      <td style="font-weight:700">${playerLink(p)} ${tag}</td>
      <td>${gradeBadge(p)}</td>
      <td style="color:var(--gray)">${p.age||"?"}</td>
      <td style="color:var(--gray);font-size:.62rem">${draftStr(p)}</td>
      <td style="color:var(--gold);font-size:.65rem">${flashes.length} flash${flashes.length===1?"":"es"}</td>
      <td><button class="frn-pcard-yrbtn" onclick="frnPSPromote('${escName}')">Promote</button>
          <button class="frn-pcard-yrbtn" style="border-color:var(--red);color:#ff9090" onclick="frnPSRelease('${escName}')">Release</button></td>
    </tr>`;
  }).join("");
  return alertHtml + `<table class="frn-pre-roster-table">
    <thead><tr><th>POS</th><th>Player</th><th>Grade</th><th>Age</th><th>Draft</th><th>Practice</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function _renderPSLeagueTab(myId, visitsLeft) {
  const teams = TEAMS.filter(t => t.id !== myId);
  const sections = teams.map(t => {
    const ps = franchise.practiceSquads?.[t.id] || [];
    if (!ps.length) return "";
    const rows = ps.map(p => {
      const escName = (p.name || "").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
      const intel = franchise.scoutedPS?.[p.name];
      const scoutedByMe = intel && intel.byTeamId === myId;
      // Without scouting: only show position, age, draft, noisy grade.
      // With scouting: also show flash count + potential ceiling.
      const flashes = scoutedByMe ? (p._psFlashLog || []).filter(f => f.season === franchise.season).length : null;
      // Practice-squad scouted player potential — show tier letter,
      // never the raw OVR band. Numeric band (~75-81) trivially
      // leaked the ceiling within ±3 OVR; replaced with the same
      // S/A/B/C/D system used in the development report.
      const potentialCell = scoutedByMe
        ? (() => {
            const t = _ceilingTier(p.potential || p.overall, p.draftRound);
            return `<td style="font-size:.62rem"><b style="color:${t.color}">${t.grade}</b> <span style="color:var(--gray);font-size:.55rem">tier</span></td>`;
          })()
        : `<td style="color:var(--gray);font-size:.62rem">—</td>`;
      const flashCell = scoutedByMe
        ? `<td style="color:var(--gold-lt);font-size:.62rem">${flashes} flash${flashes===1?"":"es"}</td>`
        : `<td style="color:var(--gray)">—</td>`;
      const scoutBtn = scoutedByMe
        ? `<span style="color:var(--gold);font-size:.62rem">✓ scouted</span>`
        : `<button class="frn-pcard-yrbtn" ${visitsLeft<=0?"disabled":""} onclick="frnPSScout('${escName}')">🔍 Scout</button>`;
      return `<tr>
        <td style="color:var(--gold);font-size:.62rem">${p.position}</td>
        <td style="font-weight:600">${p.name}</td>
        <td>${gradeBadge(p)}</td>
        <td style="color:var(--gray)">${p.age||"?"}</td>
        <td style="color:var(--gray);font-size:.62rem">${draftStr(p)}</td>
        ${potentialCell}
        ${flashCell}
        <td>${scoutBtn}</td>
      </tr>`;
    }).join("");
    return `<div class="frn-card-title" style="margin-top:.5rem;color:${t.primary}">${t.city.toUpperCase()} ${t.name.toUpperCase()} · ${ps.length}/${PS_SLOTS}</div>
      <table class="frn-pre-roster-table">
        <thead><tr><th>POS</th><th>Player</th><th>Grade</th><th>Age</th><th>Draft</th><th>Ceiling</th><th>Practice</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).filter(Boolean).join("");
  return sections || `<div style="color:var(--gray);padding:1rem;text-align:center;font-style:italic">No league PS data available.</div>`;
}

function _renderPSScoutedTab(myId) {
  const myScouted = Object.entries(franchise.scoutedPS || {})
    .filter(([name, info]) => info.byTeamId === myId)
    .map(([name, info]) => {
      for (const [tIdStr, ps] of Object.entries(franchise.practiceSquads || {})) {
        const found = ps.find(p => p.name === name);
        if (found) return { p: found, teamId: Number(tIdStr), info };
      }
      return null;
    }).filter(Boolean);
  if (!myScouted.length) {
    return `<div style="color:var(--gray);font-style:italic;padding:1.5rem;text-align:center">No scouted PS players yet. Visit the League PS tab and spend visits.</div>`;
  }
  const rows = myScouted.map(({ p, teamId, info }) => {
    const team = getTeam(teamId);
    const flashes = (p._psFlashLog || []).filter(f => f.season === franchise.season);
    // Tier-only ceiling display (was ~${low}-${high} which leaked the
    // ceiling within ±3 OVR). Privacy rule: ceiling number is never
    // exposed in any UI surface.
    const tier = _ceilingTier(p.potential || p.overall, p.draftRound);
    return `<tr>
      <td style="color:var(--gold);font-size:.62rem">${p.position}</td>
      <td style="font-weight:700">${p.name}</td>
      <td style="color:var(--gray);font-size:.62rem">${team?.name||"?"}</td>
      <td>${gradeBadge(p)}</td>
      <td style="font-size:.62rem"><b style="color:${tier.color}">${tier.grade}</b> <span style="color:var(--gray);font-size:.55rem">tier</span></td>
      <td style="color:var(--gold-lt);font-size:.62rem">${flashes.length}</td>
      <td style="color:var(--gray);font-size:.6rem">W${info.week}</td>
    </tr>`;
  }).join("");
  return `<table class="frn-pre-roster-table">
    <thead><tr><th>POS</th><th>Player</th><th>Team</th><th>Grade</th><th>Ceiling</th><th>Flashes</th><th>Scouted</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function frnPSPromote(name) {
  const myId = franchise.chosenTeamId;
  const ps = franchise.practiceSquads?.[myId] || [];
  const p = ps.find(x => x.name === name);
  if (!p) return;
  const cap = effectiveSalaryCap(myId);
  if (capUsedByTeam(myId) + 1.0 > cap) {
    if (!await _frnConfirm(`Promoting ${name} pushes you over the cap. Continue?`)) return;
  }
  _psPromote(myId, p);
  saveFranchise();
  renderFrnPracticeSquad("mine");
}
async function frnPSRelease(name) {
  if (!await _frnConfirm(`Release ${name} from the practice squad?`)) return;
  const myId = franchise.chosenTeamId;
  const ps = franchise.practiceSquads?.[myId] || [];
  const idx = ps.findIndex(x => x.name === name);
  if (idx === -1) return;
  ps.splice(idx, 1);
  saveFranchise();
  renderFrnPracticeSquad("mine");
}
function frnPSScout(name) {
  const myId = franchise.chosenTeamId;
  if (!_psScout(myId, name)) { alert("No scouting visits remaining this week."); return; }
  saveFranchise();
  renderFrnPracticeSquad("league");
}
function frnTogglePSAutoSpend(on) {
  franchise.autoSpendScouts = !!on;
  saveFranchise();
}

function renderFrnInjuryReport() {
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const collect = teamId => (franchise.rosters[teamId] || [])
    .filter(p => p.injury && p.injury.weeksRemaining > 0)
    .sort((a, b) => (b.injury.weeksRemaining||0) - (a.injury.weeksRemaining||0));
  const mine = collect(myId);
  const acrossLeague = TEAMS
    .filter(t => t.id !== myId)
    .map(t => ({ team: t, injured: collect(t.id) }))
    .filter(x => x.injured.length);
  // IR action cell for the user's own injured players (manual IR management).
  const irActionCell = (p) => {
    if (typeof irEligibility !== "function") return "<td></td>";
    const elig = irEligibility(myId, p);
    if (!elig.ok) {
      const why = elig.reason === "career-ending — retires off roster" ? "career-ending"
                : elig.reason === "no return slots left" ? "no IR slots"
                : "too short for IR";
      return `<td style="color:var(--gray);font-size:.6rem;font-style:italic">${why}</td>`;
    }
    const label = elig.designation === "season" ? "IR · Season" : "IR · Return";
    const tip = elig.designation === "season"
      ? "Out for the year — frees the roster spot, keeps the cap hit"
      : `Designated to return — out a minimum of ${IR_RETURN_MIN_WEEKS} weeks, uses 1 of your ${irReturnSlotsLeft(myId)} return slots`;
    return `<td><button class="btn btn-outline" style="font-size:.6rem;padding:.18rem .5rem" title="${tip}"
      onclick="frnPlaceOnIr('${_bspnEsc(p.name).replace(/'/g,"\\'")}','${elig.designation}')">🚑 ${label}</button></td>`;
  };
  const rowHtml = (p, opp) => `
    <tr>
      <td style="font-weight:700">${playerLink(p)}</td>
      <td style="color:var(--gray)">${p.position}</td>
      <td style="color:var(--gray)">${p.age||"?"}</td>
      <td style="color:#ff9090">🩹 ${_bspnEsc(p.injury.label||"Injury")}</td>
      <td style="color:#ff9090;font-weight:700">${p.injury.weeksRemaining} wk${p.injury.weeksRemaining===1?"":"s"}</td>
      ${opp ? `<td style="color:var(--gray);font-size:.62rem">${opp.city} ${opp.name}</td>` : irActionCell(p)}
    </tr>`;
  const mineHtml = mine.length ? `
    <table class="frn-pre-roster-table" style="width:100%">
      <thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>Injury</th><th>Weeks Out</th><th>IR</th></tr></thead>
      <tbody>${mine.map(p => rowHtml(p, null)).join("")}</tbody>
    </table>` : `<div style="color:var(--green-lt);padding:.8rem;text-align:center">No injuries on the active roster.</div>`;
  const leagueHtml = acrossLeague.length ? `
    <table class="frn-pre-roster-table" style="width:100%">
      <thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>Injury</th><th>Weeks Out</th><th>Team</th></tr></thead>
      <tbody>${acrossLeague.flatMap(({team, injured}) =>
        injured.map(p => rowHtml(p, team))).join("")}</tbody>
    </table>` : `<div style="color:var(--gray);padding:.5rem;text-align:center;font-style:italic">No injuries reported league-wide.</div>`;
  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🩹 INJURY REPORT</div>
      <div style="color:var(--gray);font-size:.7rem">Week ${franchise.week} · ${mine.length} on your roster</div>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto">← Back</button>
    </div>
    <div class="frn-card-title" style="margin-bottom:.4rem">${myTeam.city.toUpperCase()} ${myTeam.name.toUpperCase()}</div>
    ${mineHtml}
    <div class="frn-card-title" style="margin-top:1rem;margin-bottom:.4rem">LEAGUE-WIDE</div>
    ${leagueHtml}`;
}

// ── Injured Reserve management (user's own team) ────────────────────────────
function renderFrnInjuredReserve() {
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const list = (typeof irListForTeam === "function") ? irListForTeam(myId) : [];
  const open = (typeof rosterSpotsOpen === "function") ? rosterSpotsOpen(myId) : 0;
  const slots = (typeof irReturnSlotsLeft === "function") ? irReturnSlotsLeft(myId) : 0;
  const active = (typeof activeRosterCount === "function") ? activeRosterCount(myId) : 0;

  const statusCell = (p) => {
    const m = p._ir || {};
    if (m.designation === "season") return `<span style="color:var(--gray)">Out for the year</span>`;
    const healed = !p.injury || !(p.injury.weeksRemaining > 0);
    if (typeof irActivationEligible === "function" && irActivationEligible(p)) {
      const dis = open <= 0 ? "disabled" : "";
      const tip = open <= 0 ? "No open roster spot — cut or IR a player first" : "Activate to the 53-man roster";
      return `<button class="btn btn-gold" style="font-size:.6rem;padding:.18rem .55rem" ${dis} title="${tip}"
        onclick="frnActivateFromIr('${_bspnEsc(p.name).replace(/'/g,"\\'")}')">↩︎ Activate</button>`;
    }
    if (!healed) return `<span style="color:#ff9090">🩹 ${p.injury.weeksRemaining} wk left</span>`;
    const wait = Math.max(0, (m.minReturnWeek || 0) - (franchise.week || 1));
    return `<span style="color:var(--gray)">Eligible wk ${m.minReturnWeek||"?"} (${wait} to go)</span>`;
  };
  const rows = list.map(p => `
    <tr>
      <td style="font-weight:700">${playerLink(p)}</td>
      <td style="color:var(--gray)">${p.position}</td>
      <td style="color:var(--gray)">${(p._ir&&p._ir.designation)==="season"?"Season":"Return"}</td>
      <td style="color:#ff9090">${p.injury?_bspnEsc(p.injury.label||"Injury"):"—"}</td>
      <td>${statusCell(p)}</td>
    </tr>`).join("");
  const listHtml = list.length ? `
    <table class="frn-pre-roster-table" style="width:100%">
      <thead><tr><th>Player</th><th>Pos</th><th>Type</th><th>Injury</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>` : `<div style="color:var(--gray);padding:.8rem;text-align:center;font-style:italic">No players on Injured Reserve.</div>`;

  // Open-spot helper: sign a veteran-minimum replacement at a chosen position.
  const POS = ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];
  const fillHtml = open > 0 ? `
    <div style="margin-top:.7rem;padding:.5rem .6rem;background:rgba(255,255,255,.03);border-radius:4px">
      <div style="font-size:.7rem;color:var(--gold-lt);font-weight:700;margin-bottom:.3rem">${open} open roster spot${open===1?"":"s"} — sign a veteran-minimum replacement:</div>
      <div style="display:flex;gap:.3rem;flex-wrap:wrap">
        ${POS.map(pos => `<button class="btn btn-outline" style="font-size:.6rem;padding:.18rem .45rem"
          onclick="frnSignIrReplacement('${pos}')">+ ${pos}</button>`).join("")}
      </div>
      <div style="font-size:.58rem;color:var(--gray);margin-top:.3rem;font-style:italic">Or use Free Agency / Practice Squad to sign a better player.</div>
    </div>` : "";

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🚑 INJURED RESERVE</div>
      <div style="color:var(--gray);font-size:.7rem">Active ${active}/${ACTIVE_ROSTER_LIMIT} · ${list.length} on IR · ${slots} return slot${slots===1?"":"s"} left</div>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto">← Back</button>
    </div>
    <div style="font-size:.64rem;color:var(--gray);margin-bottom:.5rem;line-height:1.4">
      IR opens a roster spot for a healthy replacement while the injured player still counts against the cap.
      <b>Season</b> = out for the year (returns next season). <b>Return</b> = designated to return, out a minimum of ${IR_RETURN_MIN_WEEKS} weeks (limited slots).
      Place players on IR from the <b>Injury Report</b> tab.
    </div>
    <div class="frn-card-title" style="margin-bottom:.4rem">${myTeam.city.toUpperCase()} ${myTeam.name.toUpperCase()}</div>
    ${listHtml}
    ${fillHtml}`;
}

// Find a player by name on the user's active roster / IR list.
function _frnFindOnRoster(name) {
  return ((franchise.rosters||{})[franchise.chosenTeamId]||[]).find(p => p.name === name);
}
function _frnFindOnIr(name) {
  return (typeof irListForTeam==="function" ? irListForTeam(franchise.chosenTeamId) : []).find(p => p.name === name);
}
function frnPlaceOnIr(name, designation) {
  const myId = franchise.chosenTeamId;
  const p = _frnFindOnRoster(name);
  if (!p || typeof placeOnIr !== "function") return;
  const elig = irEligibility(myId, p);
  if (!elig.ok) { if (typeof toast === "function") toast("Can't place on IR: " + elig.reason); return; }
  placeOnIr(myId, p, designation || elig.designation);
  if (typeof _pushNews === "function") {
    const tag = (designation||elig.designation) === "season" ? "(season)" : "(designated to return)";
    _pushNews({ type:"ir", label:`🚑 You placed ${p.position} ${p.name} on IR ${tag}` });
  }
  if (typeof saveFranchise === "function") saveFranchise();
  // Move the user to the IR tab so they can sign a replacement into the open spot.
  if (typeof frnSetRosterSubTab === "function") frnSetRosterSubTab("ir");
  else renderFrnInjuredReserve();
}
function frnActivateFromIr(name) {
  const myId = franchise.chosenTeamId;
  const p = _frnFindOnIr(name);
  if (!p || typeof activateFromIr !== "function") return;
  if (!irActivationEligible(p)) { if (typeof toast==="function") toast("Not eligible to activate yet."); return; }
  if (rosterSpotsOpen(myId) <= 0) { if (typeof toast==="function") toast("No open roster spot — cut or IR a player first."); return; }
  activateFromIr(myId, p);
  if (typeof _pushNews === "function") _pushNews({ type:"ir", label:`↩︎ You activated ${p.position} ${p.name} off IR` });
  if (typeof saveFranchise === "function") saveFranchise();
  renderFrnRosterHome();
}
function frnSignIrReplacement(pos) {
  const myId = franchise.chosenTeamId;
  if (typeof _signReplacementForInjury !== "function") return;
  if (rosterSpotsOpen(myId) <= 0) { if (typeof toast==="function") toast("Roster is full."); return; }
  const ok = _signReplacementForInjury(myId, pos);
  if (!ok) { if (typeof toast==="function") toast("No "+pos+" available on the practice squad or FA pool."); return; }
  if (typeof saveFranchise === "function") saveFranchise();
  renderFrnInjuredReserve();
}

function renderFrnChat() {
  const myId = franchise.chosenTeamId;
  const all = (franchise.chat || []).slice().sort((a,b) => a.ts - b.ts);
  // Group by week label for visual breaks
  let lastLabel = "";
  const msgs = all.map(m => {
    const team = getTeam(m.teamId);
    const isMe = m.teamId === myId;
    const label = `S${m.season} W${m.week}`;
    const divider = label !== lastLabel
      ? `<div class="frn-chat-divider">${label}</div>` : "";
    lastLabel = label;
    return `${divider}
      <div class="frn-chat-msg ${isMe?"mine":""}">
        <div class="frn-chat-head" style="border-left:3px solid ${team?.primary||"var(--gold)"};padding-left:.4rem">
          <span style="color:${isMe?"var(--gold-lt)":"var(--gold)"};font-weight:700">${team?.name||"?"}</span>
          <span style="color:var(--gray);font-size:.55rem">${new Date(m.ts).toLocaleTimeString()}</span>
        </div>
        <div class="frn-chat-body">${_escHtml(m.text)}</div>
      </div>`;
  }).join("") || `<div style="color:var(--gray);font-style:italic;font-size:.78rem;padding:1rem;text-align:center">No messages yet. Start the trash talk.</div>`;

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">💬 LEAGUE CHAT</div>
      <div style="color:var(--gray);font-size:.72rem">Season ${franchise.season}, Week ${franchise.week}</div>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto">← Back</button>
    </div>
    <div class="frn-chat-list">${msgs}</div>
    <div class="frn-chat-compose">
      <input type="text" id="frnChatInput" placeholder="Post to the league…" maxlength="280"
        onkeydown="if(event.key==='Enter'){ frnPostMessage(this.value); this.value=''; }">
      <button class="btn btn-gold" onclick="(function(){const i=document.getElementById('frnChatInput');frnPostMessage(i.value);i.value='';})()">Post</button>
    </div>`;
  // Auto-scroll to bottom + focus the input
  const list = document.querySelector(".frn-chat-list");
  if (list) list.scrollTop = list.scrollHeight;
  const inp = document.getElementById("frnChatInput");
  if (inp) inp.focus();
}

// ── Universal hover tooltips: players & teams ─────────────────────────────────
// Anywhere a player/team name is rendered, wrapping it with
// playerLink(p) or teamLink(team) gives it hover-card + click-to-open
// behavior via document-level event delegation. Doesn't bloat each
// render site with handlers.

// Composite legacy tier for a player — drives visual treatment across
// every name surface. Tier ladder (any-of):
//   LEGEND: 2+ MVPs OR 4+ rings OR 8+ All-Pros — Brady tier
//   ICON:   1+ MVP OR 3+ rings OR 5+ All-Pros OR 8+ Pro Bowls
//   ELITE:  1+ ring OR 2+ All-Pros OR 5+ Pro Bowls
//   PRO:    1+ Pro Bowl OR 1+ All-Pro
// Returns null for un-decorated standard players.
function playerLegendTier(p) {
  if (!p) return null;
  const mvps = p.mvps     || 0;
  const aps  = p.allPros  || 0;
  const sbs  = p.sbRings  || 0;
  const pbs  = p.proBowls || 0;
  if (mvps >= 2 || sbs >= 4 || aps >= 8) {
    return { tier:"legend", icon:"👑", label:"LEGEND" };
  }
  if (mvps >= 1 || sbs >= 3 || aps >= 5 || pbs >= 8) {
    return { tier:"icon", icon:"🏛", label:"ICON" };
  }
  if (sbs >= 1 || aps >= 2 || pbs >= 5) {
    return { tier:"elite", icon:"⭐", label:"ELITE" };
  }
  if (pbs >= 1 || aps >= 1) {
    return { tier:"pro", icon:"✦", label:"PRO" };
  }
  return null;
}

function playerLink(p) {
  if (!p) return "";
  const escName = String(p.name || "").replace(/"/g, "&quot;");
  const pidAttr = p.pid ? ` data-player-pid="${p.pid}"` : "";
  const tier = playerLegendTier(p);
  const tierCls = tier ? ` frn-pname-t-${tier.tier}` : "";
  const tierTitle = tier ? ` title="${tier.label}"` : "";
  const iconHtml = tier ? `<span class="frn-pname-glyph" aria-hidden="true">${tier.icon}</span>` : "";
  // Madonna/Pelé tier — display ONLY the nickname (p.name stays intact
  // for lookups). Falls through to legal name when no nickname.
  const display = (p.goesByNicknameOnly && p.nickname) ? p.nickname : p.name;
  return `<span class="frn-pname${tierCls}" data-player-name="${escName}"${pidAttr}${tierTitle}>${iconHtml}${display}</span>`;
}
function playerLinkByName(name) {
  if (!name) return "";
  const escName = String(name).replace(/"/g, "&quot;");
  return `<span class="frn-pname" data-player-name="${escName}">${name}</span>`;
}
// Prefer a live-player lookup so pid is embedded for collision-free hover.
// Falls back to name-only link for retired / historical players not on any roster.
function _playerLinkSmart(name) {
  if (!name) return "";
  const live = _findPlayer(name);
  if (live) return playerLink(live);
  // Try HOF / alumni pools so retired legends still get their tier badge
  const hof = (franchise?.hallOfFame || []).find(h => h.name === name);
  if (hof) {
    const synth = {
      name: hof.name, pid: hof.pid,
      mvps: hof.accolades?.mvps || 0,
      allPros: hof.accolades?.allPros || 0,
      proBowls: hof.accolades?.proBowls || 0,
      sbRings: hof.accolades?.sbRings || 0,
    };
    return playerLink(synth);
  }
  return playerLinkByName(name);
}
function teamLink(team, full) {
  if (!team) return "";
  const label = full ? `${team.city} ${team.name}` : team.name;
  return `<span class="frn-tname" data-team-id="${team.id}">${label}</span>`;
}

// Locate a player by pid (preferred — collision-proof) or by name.
function _findPlayerByPid(pid) {
  if (!pid) return null;
  for (const roster of Object.values(franchise?.rosters || {})) {
    const p = roster.find(rp => rp.pid === pid);
    if (p) return p;
  }
  return null;
}
function _findPlayer(nameOrPid, pid) {
  // Try pid first so same-name players on different teams never collide.
  const byPid = _findPlayerByPid(pid);
  if (byPid) return byPid;
  // Active roster — by name first, then by nickname (covers records /
  // wire entries that were stamped under a player's legal name before
  // a (now-fixed) rewrite pointed p.name at their nickname).
  for (const roster of Object.values(franchise?.rosters || {})) {
    const p = roster.find(rp => rp.name === nameOrPid);
    if (p) return p;
  }
  for (const roster of Object.values(franchise?.rosters || {})) {
    const p = roster.find(rp => rp.nickname === nameOrPid);
    if (p) return p;
  }
  // Free agents + practice squads
  for (const pool of [franchise?.freeAgents, ...Object.values(franchise?.practiceSquads || {})]) {
    if (!pool) continue;
    const p = pool.find(rp => (pid && rp.pid === pid) || rp.name === nameOrPid || rp.nickname === nameOrPid);
    if (p) return p;
  }
  // Draft class — covers prospects clicked from the pre-show, mock round,
  // or live draft board. Without this, frnOpenPlayerCard would silently
  // bail on every prospect.
  const dClass = franchise?.draft?.class;
  if (dClass) {
    const p = dClass.find(rp => (pid && rp.pid === pid) || rp.name === nameOrPid || rp.nickname === nameOrPid);
    if (p) return p;
  }
  return null;
}

// Resolve a name to a HOF or alumni-snapshot synthesis. Returns null if
// the name doesn't match a retired/historical record. The synth carries
// enough fields to render a minimal retired-player modal without
// crashing live-player-shaped render helpers.
function _findRetiredPlayer(name) {
  if (!name || !franchise) return null;
  const hof = (franchise.hallOfFame || []).find(h => h.name === name);
  if (hof) {
    return {
      name: hof.name, position: hof.pos, age: hof.age,
      overall: hof.peakOvr || 70,
      stats: [70,70,70,70,70,70,70,70,70,70,70],
      careerStats: hof.careerStats || {},
      careerHistory: hof.careerHistory || [],
      careerEarnings: hof.careerEarnings || 0,
      mvps: hof.accolades?.mvps || 0,
      opoys: 0, dpoys: 0, roys: hof.accolades?.roys || 0,
      proBowls: hof.accolades?.proBowls || 0,
      allPros: hof.accolades?.allPros || 0,
      sbRings: hof.accolades?.sbRings || 0,
      _retiredAt: hof.season,
      _retiredHOF: true,
      _retiredTeamName: hof.teamName,
    };
  }
  // Scan recent roster snapshots — last seen wins.
  const snaps = franchise.rosterSnapshots || [];
  for (let i = snaps.length - 1; i >= 0; i--) {
    const byTeam = snaps[i].byTeam || {};
    for (const [tid, rows] of Object.entries(byTeam)) {
      const r = (rows || []).find(x => x.name === name);
      if (r) {
        const team = getTeam(Number(tid));
        return {
          name: r.name, position: r.pos, age: r.age,
          overall: r.overall || 70,
          stats: [70,70,70,70,70,70,70,70,70,70,70],
          careerStats: {}, careerHistory: [],
          proBowls: 0, allPros: 0, sbRings: 0, mvps: 0, opoys: 0, dpoys: 0, roys: 0,
          _retiredAt: snaps[i].season,
          _retiredTeamName: team ? `${team.city} ${team.name}` : "",
        };
      }
    }
  }
  return null;
}
function _findPlayerTeam(p) {
  if (!p) return null;
  for (const [tid, roster] of Object.entries(franchise?.rosters || {})) {
    if (roster.some(rp => rp === p || rp.name === p.name)) return getTeam(Number(tid));
  }
  return null;
}

// AI-generated portrait (same one the single-game tooltip uses).
// `size` is an output box edge in px. Falls back to the canvas-drawn
// anime mugshot when the PNG isn't on disk, then to a flat color when
// even that fails (so we never show a broken-image icon).
function _playerPortrait(p, size) {
  const sz = size || 96;
  const team = _findPlayerTeam(p);
  let src = "";
  try { src = portraitFileForPlayer(p); } catch {}
  const safe = src ? src.split("/").map(encodeURIComponent).join("/") : "";
  let fallback = "";
  // generateMugshotDataUrl looks up gameResult; if absent it still works
  // with a fallback color. Wrap in try/catch since this is non-critical.
  try { fallback = generateMugshotDataUrl(p); } catch {}
  const flatBg = team?.primary || "#222";
  const onErr = fallback
    ? `this.onerror=null;this.src='${fallback}';`
    : `this.onerror=null;this.style.background='${flatBg}';this.removeAttribute('src');`;
  if (!safe) {
    return `<div class="frn-portrait" style="width:${sz}px;height:${sz*9/8}px;background:${flatBg}"></div>`;
  }
  return `<img class="frn-portrait" src="portraits/${safe}"
    width="${sz}" height="${Math.round(sz * 9/8)}"
    alt="${(p.name||"").replace(/"/g,'&quot;')}"
    style="object-fit:cover;background:${flatBg}"
    onerror="${onErr}">`;
}

function frnPlayerTipShow(anchorEl, name, pid) {
  const p = _findPlayer(name, pid);
  if (!p) return;
  const team = _findPlayerTeam(p);
  const tip = _getHoverTip();
  const g = scoutGrade(p), gL = gradeLabel(g), gCls = gradeClass(g);
  const aav = p.contract?.aav || 0;
  const yrs = p.contract?.remaining || 0;
  // Compact accolade line for tooltip
  const tipAccoladeLine = (() => {
    const acc = (p.careerHistory || []).flatMap(h => h.accolades || []);
    const parts = [];
    if ((p.mvps||0) > 0) parts.push(`${p.mvps}×MVP`);
    const pureRings = acc.filter(a => a === "Super Bowl").length;
    if (pureRings > 0) parts.push(`${pureRings}×Ring`);
    const ap1 = acc.filter(a => a === "All-Pro").length;
    const ap2 = acc.filter(a => a === "All-Pro (2nd)").length;
    if (ap1 > 0) parts.push(`${ap1}×AP1`);
    if (ap2 > 0) parts.push(`${ap2}×AP2`);
    const pb = Math.max(0, (p.proBowls || 0) - ap1 - ap2);
    if (pb > 0) parts.push(`${pb}×PB`);
    return parts.length
      ? `<div style="font-size:.57rem;color:var(--gold);margin-top:.1rem">${parts.join(" · ")}</div>`
      : "";
  })();
  // Build a compact "this season" stat line from seasonStats
  let seasonLine = "";
  {
    let stat = null;
    for (const ts of Object.values(franchise?.seasonStats || {})) {
      if (ts && ts[p.name]) { stat = ts[p.name]; break; }
    }
    if (stat && (+(stat.gp || 0)) >= 1) {
      const pos = p.position;
      const num = k => +(stat[k] || 0);
      const gp = num("gp") || 1;
      if (pos === "QB") {
        const ypg = (num("pass_yds") / gp).toFixed(1);
        seasonLine = `${ypg} YPG · ${num("pass_td")} TD`;
      } else if (pos === "RB") {
        const ypg = (num("rush_yds") / gp).toFixed(1);
        const bt = num("broken_tackles");
        seasonLine = `${ypg} RY/G · ${num("rush_td")} TD${bt ? ` · ${bt} BT` : ""}`;
      } else if (pos === "WR" || pos === "TE") {
        const ypg = (num("rec_yds") / gp).toFixed(1);
        seasonLine = `${ypg} REC Y/G · ${num("rec_td")} TD`;
      } else if (pos === "DL" || pos === "LB" || pos === "CB" || pos === "S") {
        const tklpg = (num("tkl") / gp).toFixed(1);
        seasonLine = `${tklpg} TKL/G · ${num("sk")} SK`;
      } else if (pos === "K") {
        const made = num("fg_made"), att = num("fg_att");
        const pct = att ? (made / att * 100).toFixed(1) : "0.0";
        seasonLine = `${made}/${att} FG · ${pct}%`;
      }
    }
  }
  tip.innerHTML = `
    <div class="frn-ptip-head">
      ${_playerPortrait(p, 56)}
      <div style="flex:1;min-width:0">
        <div style="font-weight:900;font-size:.9rem">${p.name}</div>
        <div style="color:var(--gray);font-size:.62rem">
          ${p.position} · Age ${p.age||"?"} · ${team?.name||"?"}
        </div>
        <div style="color:var(--gray);font-size:.62rem">${_archetypeLabel(p) || "—"}</div>
        ${tipAccoladeLine}
      </div>
      <div style="text-align:right">
        <span class="tt-ovr tier-${gCls}" style="font-size:.85rem;padding:.15rem .5rem">${gL}</span>
      </div>
    </div>
    <div class="frn-ptip-meta">
      <div><span class="frn-meta-label">DRAFT</span> ${draftStr(p)}</div>
      <div><span class="frn-meta-label">$/YR</span> $${aav.toFixed(1)}M · ${yrs}yr</div>
      <div><span class="frn-meta-label">CAREER $</span> ${careerEarningsStr(p)}</div>
      ${p.injury?.weeksRemaining ? `<div style="color:#ff9090">🩹 ${p.injury.label} · ${p.injury.weeksRemaining}wk</div>` : ""}
      ${p.onTradeBlock ? `<div style="color:#e8a000">●BLOCK</div>` : ""}
      ${seasonLine ? `<div style="color:var(--gold-lt);font-size:.62rem">${seasonLine}</div>` : ""}
    </div>
    <div class="frn-tip-foot">Click for full career</div>
  `;
  _positionTip(tip, anchorEl);
}

function frnTeamTipShow2(anchorEl, teamId) {
  const team = getTeam(Number(teamId));
  if (!team) return;
  const tip = _getHoverTip();
  const rtg = frnTeamRating(team.id);
  const tier = franchise?.teamTiers?.[team.id] || "average";
  const tierLabel = (typeof TIER_LABEL !== "undefined" && TIER_LABEL[tier]) || tier;
  const scouted = franchise?.scoutingIntel?.[team.id]?.season === franchise?.season;
  // If scouted: include top 3 players + grades
  let scoutLines = "";
  if (scouted) {
    const top = (franchise.rosters[team.id] || [])
      .slice().sort((a,b) => scoutGrade(b) - scoutGrade(a)).slice(0, 3);
    scoutLines = top.map(p =>
      `<div class="frn-tip-bullet">${p.position} ${p.name} (${gradeLabel(scoutGrade(p))})</div>`
    ).join("");
  }
  // Record so far
  const s = franchise?.standings?.[team.id];
  const rec = s ? `${s.w}-${s.l}${s.t?`-${s.t}`:""}` : "—";
  tip.innerHTML = `
    <div class="frn-tip-head">
      <span style="font-size:1.4rem;color:${team.primary}">${teamAscii(team)}</span>
      <div>
        <div style="font-weight:900">${team.city} ${team.name}</div>
        <div style="color:var(--gray);font-size:.62rem">${team.conference} ${team.division}</div>
      </div>
    </div>
    <div class="frn-tip-tier tier-${tier}">${tierLabel}${scouted ? " · 🏟 SCOUTED" : ""}</div>
    <div class="frn-tip-ratings">
      OFF <b style="color:var(--gold)">${rtg.off}</b> ·
      DEF <b style="color:var(--gold)">${rtg.def}</b> ·
      Rec ${rec}
    </div>
    ${scoutLines || `<div class="frn-tip-bullet" style="color:var(--gray);font-style:italic">Run a joint practice to scout this team.</div>`}
    <div class="frn-tip-foot">Click to scout this team</div>
  `;
  _positionTip(tip, anchorEl);
}

function _getHoverTip() {
  let tip = document.getElementById("frn-hover-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "frn-hover-tip";
    tip.className = "frn-team-tooltip frn-player-tip";
    document.body.appendChild(tip);
  }
  return tip;
}
function _positionTip(tip, anchor) {
  tip.style.display = "block";
  const rect = anchor.getBoundingClientRect();
  const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
  let left = rect.right + 8;
  if (left + tipW > window.innerWidth - 8) left = rect.left - tipW - 8;
  if (left < 8) left = 8;
  let top = rect.top;
  if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8;
  if (top < 8) top = 8;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}
function frnHoverTipHide() {
  const tip = document.getElementById("frn-hover-tip");
  if (tip) tip.style.display = "none";
}

// Click handlers
// Player click opens a modal overlay anchored at the dashboard — no
// page-swap, no phase mutation. Closing returns you to whatever
// screen you were already on.
// Minimal modal for retired / historical players (HOF inductees and
// alumni who no longer appear on any active roster). Surfaces the
// data we DO have — accolades, career stats, last team — without
// trying to render contract/season-stats/game-log panels that
// require live-player state.
function _frnOpenRetiredPlayerModal(p) {
  frnHoverTipHide();
  frnClosePlayerModal();
  const tier = (typeof playerLegendTier === "function") ? playerLegendTier(p) : null;
  const cs = p.careerStats || {};
  let highlights = "";
  const pos = p.position;
  if (pos === "QB") highlights = `${cs.pass_yds||0} yds · ${cs.pass_td||0} TD · ${cs.pass_int||0} INT`;
  else if (pos === "RB") highlights = `${cs.rush_yds||0} rush yds · ${cs.rush_td||0} TD`;
  else if (pos === "WR" || pos === "TE") highlights = `${cs.rec||0} rec · ${cs.rec_yds||0} yds · ${cs.rec_td||0} TD`;
  else if (pos === "DL" || pos === "LB") highlights = `${cs.tkl||0} tkl · ${cs.sk||0} sk`;
  else if (pos === "CB" || pos === "S") highlights = `${cs.int_made||0} INT · ${cs.pd||0} PD · ${cs.tkl||0} tkl`;
  else if (pos === "K") highlights = `${cs.fg_made||0} FG · ${cs.xp_made||0} XP`;
  else if (["OL","LT","LG","C","RG","RT"].includes(pos)) highlights = `${cs.pancakes||0} pancakes · ${cs.sacks_allowed||0} SA`;
  const accChips = [
    (p.mvps    || 0) > 0 ? `${p.mvps}× MVP` : "",
    (p.sbRings || 0) > 0 ? `${p.sbRings}× 💍` : "",
    (p.allPros || 0) > 0 ? `${p.allPros}× All-Pro` : "",
    (p.proBowls|| 0) > 0 ? `${p.proBowls}× Pro Bowl` : "",
    (p.roys    || 0) > 0 ? `ROY` : "",
  ].filter(Boolean).join(" · ");
  const overlay = document.createElement("div");
  overlay.className = "frn-pcard-overlay";
  overlay.id = "frn-pcard-overlay";
  const tag = p._retiredHOF
    ? `<span style="color:var(--gold);font-size:.6rem;letter-spacing:1px;font-weight:800;border:1px solid var(--gold);padding:.1rem .4rem;margin-left:.5rem">🏛 HALL OF FAME</span>`
    : `<span style="color:var(--gray);font-size:.6rem;letter-spacing:1px;font-weight:600;border:1px solid var(--gray);padding:.1rem .4rem;margin-left:.5rem">RETIRED</span>`;
  const heroName = tier
    ? `<div class="frn-pname-hero frn-pname-hero-t-${tier.tier}" title="${tier.label}">
        <span class="frn-pname-hero-glyph" aria-hidden="true">${tier.icon}</span>
        <span class="frn-pname-hero-name">${p.name}</span>
        <span class="frn-pname-hero-tag">${tier.label}</span>
       </div>`
    : `<div style="font-size:1.15rem;font-weight:900">${p.name}</div>`;
  overlay.innerHTML = `
    <div class="frn-pcard-overlay-inner">
      <button class="frn-pcard-close" onclick="frnClosePlayerModal()" title="Close">×</button>
      <div class="frn-player-card" style="padding:.8rem 1rem">
        <div class="frn-player-card-head" style="display:flex;gap:.9rem;align-items:flex-start;padding-right:2.5rem">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;flex-wrap:wrap">${heroName}${tag}</div>
            <div style="color:var(--gray);font-size:.72rem;margin-top:.2rem">${p.position} · Last team: ${p._retiredTeamName || "—"}${p._retiredAt?` · Retired S${p._retiredAt}`:""}</div>
            ${accChips ? `<div style="color:var(--gold);font-size:.66rem;margin-top:.35rem">${accChips}</div>` : ""}
            ${highlights ? `<div style="color:var(--gold-lt);font-size:.66rem;margin-top:.1rem">${highlights}</div>` : ""}
          </div>
        </div>
        ${(p.careerHistory || []).length ? (() => {
          const hist = p.careerHistory.slice().reverse();
          const cols = (typeof _careerColsFor === "function") ? _careerColsFor(p.position) : [];
          const usedCols = cols.filter(c => hist.some(r => (r[c.key] || 0) > 0));
          if (!usedCols.length) return "";
          return `<div style="margin-top:.6rem">
            <div class="frn-card-title" style="margin-bottom:.3rem">📊 CAREER · ${p.careerHistory.length} seasons</div>
            <div style="overflow-x:auto"><table class="frn-pre-roster-table">
              <thead><tr><th>S</th><th>AGE</th>${usedCols.map(c => `<th>${c.label}</th>`).join("")}</tr></thead>
              <tbody>${hist.map(r => `<tr>
                <td style="color:var(--gray);font-size:.62rem">S${r.season ?? "?"}</td>
                <td style="color:var(--gray);font-size:.62rem">${r.age ?? "?"}</td>
                ${usedCols.map(c => `<td>${r[c.key] || 0}</td>`).join("")}
              </tr>`).join("")}</tbody>
            </table></div>
          </div>`;
        })() : ""}
      </div>
    </div>`;
  overlay.addEventListener("click", e => { if (e.target === overlay) frnClosePlayerModal(); });
  document.body.appendChild(overlay);
}

// ── Watchlist ────────────────────────────────────────────────────────
// User-curated list of player NAMES they want to follow. Works on any
// player (own roster, other teams, free agents). Separate from the
// college pin system (franchise.pinnedProspects) which auto-targets
// prospects at the draft — watchlist is just a "follow" flag.
function frnIsPlayerWatched(name) {
  if (!franchise || !name) return false;
  return (franchise.watchedPlayers || []).includes(name);
}

function frnToggleWatchPlayer(name) {
  if (!franchise || !name) return;
  franchise.watchedPlayers ||= [];
  const idx = franchise.watchedPlayers.indexOf(name);
  if (idx >= 0) franchise.watchedPlayers.splice(idx, 1);
  else franchise.watchedPlayers.push(name);
  saveFranchise();
  // Refresh: if the player card is open, re-render to update the button
  // label. If a SHOP MARKET filter is on, refresh that too.
  const ov = document.getElementById("frn-pcard-overlay");
  if (ov) {
    const pid = ov.getAttribute("data-pid") || "";
    frnClosePlayerModal();
    frnOpenPlayerCard(name, pid);
  }
  if (document.querySelector(".frn-trade-market") && typeof renderFrnTrade === "function") {
    renderFrnTrade();
  }
}

// "🔀 Trade for" CTA on the player card — closes the modal, jumps to
// SHOP MARKET → PROPOSE TRADE with this player pre-loaded as youReceive.
// Reuses frnShopProposeForPlayer which handles the confirm() prompt
// when the user has an in-progress deal with another partner.
//
// Lazy-init: frnShopProposeForPlayer bails on missing _tradeProp. If
// the user hasn't opened the Trade screen yet this session, kick
// frnOpenTrade first to initialize the prop, then run the propose flow.
function frnTradeForFromCard(teamId, name) {
  frnClosePlayerModal();
  if (typeof frnOpenTrade === "function" && !franchise._tradeProp) {
    frnOpenTrade(teamId, "propose");
  }
  if (typeof frnShopProposeForPlayer === "function") {
    frnShopProposeForPlayer(teamId, name);
  }
}

// Open the trade center with one of MY players pre-selected on the "you
// send" side. User picks a target team + receives whatever the trade
// builder offers. Convenience entry from the player card.
function frnShopMyPlayerFromCard(name) {
  frnClosePlayerModal();
  // Open trade center with no specific target — user picks via the
  // existing partner selector. Seed the offer with this player.
  if (typeof frnOpenTrade === "function") frnOpenTrade(null, "propose");
  // Add the player to youSend on the prop, if the system supports it.
  if (franchise._tradeProp && !franchise._tradeProp.youSend?.some(x => x.name === name)) {
    franchise._tradeProp.youSend = franchise._tradeProp.youSend || [];
    franchise._tradeProp.youSend.push({ name });
    if (typeof renderFrnTrade === "function") renderFrnTrade();
  }
}

// Toggle a player on/off the trade block from within the player card.
// Same effect as the trade-center toggle — flips p.onTradeBlock and lets
// the weekly AI inquiry roller pick them up.
function frnToggleBlockFromCard(name) {
  if (typeof frnToggleBlock === "function") frnToggleBlock(name);
  // Re-open the player card so the button label flips ON BLOCK / off.
  if (typeof frnOpenPlayerCard === "function") frnOpenPlayerCard(name);
}

function frnOpenPlayerCard(name, pid) {
  let p = _findPlayer(name, pid);
  if (!p) {
    // Fall through to retired/historical lookup — HOF entries + alumni
    // roster snapshots — so records-broken / history links don't dead-end.
    const retired = _findRetiredPlayer(name);
    if (retired) return _frnOpenRetiredPlayerModal(retired);
    return;
  }
  frnHoverTipHide();
  frnClosePlayerModal();
  const team = _findPlayerTeam(p);
  const overlay = document.createElement("div");
  overlay.className = "frn-pcard-overlay";
  overlay.id = "frn-pcard-overlay";
  overlay.setAttribute("data-pid", p.pid || "");
  const teamLine = team
    ? `<div class="frn-pcard-team-link">
         ${team.city} ${team.name} ·
         <a href="javascript:void(0)" style="color:var(--gold)"
            onclick="frnClosePlayerModal();frnOpenTeamCard(${team.id})">
           View team →
         </a>
       </div>`
    : "";
  // One-shot compare: this button opens the dedicated compare modal
  // pre-populated with this player on the left and a position-filtered
  // picker on the right. No hidden multi-step state.
  const escapedPid = (p.pid || "").replace(/'/g, "\\'");
  const escName = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  // HTML-attribute-safe variant for `title=""` and innerHTML interpolation.
  // Names with HTML special chars (&, <, ", >) would break the attribute
  // otherwise. Player generator doesn't produce these today, but defense
  // in depth is cheap.
  const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const nameAttr = escAttr(name);
  const compareTag = `<button class="frn-pcard-yrbtn" onclick="frnSelectForCompare('${escName}','${escapedPid}')">⚖ Compare</button>`;

  // Watch toggle — works for any non-retired player on any team or as
  // a free agent. Stored in franchise.watchedPlayers (a name list).
  const watched = typeof frnIsPlayerWatched === "function" && frnIsPlayerWatched(name);
  const watchTag = `<button class="frn-pcard-yrbtn${watched?" active":""}" onclick="frnToggleWatchPlayer('${escName}')" title="${watched?"Remove from your watchlist":"Add to your watchlist — appears on SHOP MARKET filter + flagged with 👁"}">${watched?"👁 Watching":"👁 Watch"}</button>`;

  // Trade buttons — context-aware by team ownership:
  //   • OWN player → "Shop player" (open trade center to offer them)
  //                + "Trade block" toggle (mark as available, AI offers roll in)
  //   • OTHER team's player → "Trade for" (open trade center to acquire)
  //   • Prospect / FA → no trade button
  let tradeBtn = "";
  let blockBtn = "";
  const myId = (typeof franchise === "object" && franchise) ? franchise.chosenTeamId : null;
  const isOnOtherTeam = team && team.id !== myId;
  const isMyPlayer = team && team.id === myId;
  const isProspect = p?.isProspect || !!p?.collegeYear;
  if (isOnOtherTeam && !isProspect) {
    let untouchable = false;
    if (typeof _aiTeamPlayerStance === "function") {
      try { untouchable = _aiTeamPlayerStance(team.id, p) === "untouchable"; } catch {}
    }
    const teamAttr = escAttr(`${team.city} ${team.name}`);
    tradeBtn = untouchable
      ? `<button class="frn-pcard-yrbtn" disabled title="${teamAttr} won't move this player — franchise face / recent high pick" style="opacity:.5">⛔ Won't trade</button>`
      : `<button class="frn-pcard-yrbtn" onclick="frnTradeForFromCard(${team.id},'${escName}')" title="Open SHOP MARKET → Propose with ${nameAttr} pre-selected as the player you want">🔀 Trade for</button>`;
  } else if (isMyPlayer && !isProspect) {
    // Own player — Shop opens trade center with this player pre-selected
    // as the piece you're offering; Trade Block toggles the listing flag.
    tradeBtn = `<button class="frn-pcard-yrbtn" onclick="frnShopMyPlayerFromCard('${escName}')" title="Open trade center → propose this player as part of your offer">🔀 Shop player</button>`;
    const blocked = !!p.onTradeBlock;
    blockBtn = `<button class="frn-pcard-yrbtn${blocked?" active":""}" onclick="frnToggleBlockFromCard('${escName}')" title="${blocked?"Listed on trade block — AI teams may make weekly inquiry offers. Click to remove.":"Mark this player as available — AI teams will roll inquiry offers each week."}">${blocked?"●ON BLOCK":"📋 Trade block"}</button>`;
  }
  const actionRow = `<div class="frn-pcard-actions">${compareTag}${watchTag}${tradeBtn}${blockBtn}</div>`;

  overlay.innerHTML = `
    <div class="frn-pcard-overlay-inner">
      <div class="frn-pcard-action-bar">${actionRow}</div>
      <button class="frn-pcard-close" onclick="frnClosePlayerModal()" title="Close">×</button>
      ${_buildPlayerDetailPanel(p)}
      ${teamLine}
    </div>`;
  overlay.addEventListener("click", e => {
    if (e.target === overlay) frnClosePlayerModal();
  });
  document.body.appendChild(overlay);
  // ESC closes
  if (!window.__frnPCardEscBound) {
    window.__frnPCardEscBound = true;
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") frnClosePlayerModal();
    });
  }
}
function frnClosePlayerModal() {
  const ov = document.getElementById("frn-pcard-overlay");
  if (ov) ov.remove();
}
function frnCloseCompareModal() {
  const ov = document.getElementById("frn-compare-overlay");
  if (ov) ov.remove();
}
// One-shot compare: clicking "⚖ Compare" on a player opens the modal
// IMMEDIATELY with player A on the left + an inline searchable picker
// for player B on the right. No hidden multi-step state, no navigating
// away to find the second player. Pick from the dropdown (filtered by
// position by default), the right side fills in with the detail panel.
function frnSelectForCompare(name, pid) {
  frnOpenCompareModal(name, null, pid);
}
function frnOpenCompareModal(nameA, nameB, pidA) {
  const pA = _findPlayer(nameA, pidA);
  if (!pA) return;
  frnCloseCompareModal();
  const overlay = document.createElement("div");
  overlay.className = "frn-pcard-overlay";
  overlay.id = "frn-compare-overlay";
  overlay.innerHTML = _bspnCompareInner(pA, nameB ? _findPlayer(nameB) : null);
  overlay.addEventListener("click", e => { if (e.target === overlay) frnCloseCompareModal(); });
  document.body.appendChild(overlay);
}

// Build the inner markup for the compare modal. Left side = player A
// (locked). Right side = either a player detail panel (when B is set)
// or a picker UI: a position-filter dropdown + a player list (search
// pre-filters by team and position so the user finds the right guy fast).
function _bspnCompareInner(pA, pB) {
  const myId = franchise?.chosenTeamId;
  // Collect every player league-wide for the picker.
  const allPlayers = [];
  for (const [tidStr, roster] of Object.entries(franchise?.rosters || {})) {
    for (const p of roster) allPlayers.push({ ...p, _teamId: Number(tidStr) });
  }
  // Default filter: same position as player A.
  const defaultFilter = pA.position || "ALL";
  const filtered = allPlayers
    .filter(p => p.name !== pA.name)
    .filter(p => defaultFilter === "ALL" || p.position === defaultFilter)
    .sort((a, b) => (b.overall || 0) - (a.overall || 0));
  const POS_OPTIONS = ["ALL","QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];
  const posSelect = POS_OPTIONS.map(p =>
    `<option value="${p}" ${p === defaultFilter ? "selected" : ""}>${p}</option>`
  ).join("");
  const playerOptions = filtered.slice(0, 200).map(p => {
    const team = getTeam(p._teamId);
    const isMine = p._teamId === myId;
    const ovrTag = isMine ? ` · ${p.overall||"?"} OVR` : ` · ${gradeLabel(scoutGrade(p))} grade`;
    const escName = (p.name || "").replace(/"/g, "&quot;");
    return `<option value="${escName}">${p.position} · ${p.name} · ${team?.name || "?"}${ovrTag}</option>`;
  }).join("");
  const rightPane = pB
    ? `<div style="padding:.5rem">
         <div style="margin-bottom:.4rem;display:flex;justify-content:space-between;align-items:center">
           <span style="color:var(--gray);font-size:.65rem;letter-spacing:.5px">COMPARING WITH</span>
           <button onclick="_bspnCompareClearB()" style="background:transparent;border:1px solid var(--border);color:var(--gray);font-family:inherit;cursor:pointer;font-size:.65rem;padding:.15rem .45rem">← Pick a different player</button>
         </div>
         ${_buildPlayerDetailPanel(pB)}
       </div>`
    : `<div style="padding:1rem;display:flex;flex-direction:column;gap:.55rem">
         <div style="color:var(--gold);font-size:.7rem;letter-spacing:.5px;font-weight:700;text-transform:uppercase">Pick a player to compare</div>
         <div style="color:var(--gray);font-size:.66rem">Filtered by ${defaultFilter} by default — switch position to widen the list.</div>
         <div style="display:flex;gap:.4rem;align-items:center">
           <span style="color:var(--gray);font-size:.65rem">Position:</span>
           <select id="bspn-compare-pos" onchange="_bspnCompareRefilter()" style="background:var(--bg3);color:var(--white);border:1px solid var(--border);padding:.25rem .35rem;font-family:inherit;font-size:.72rem">${posSelect}</select>
         </div>
         <select id="bspn-compare-player" size="14" onchange="_bspnCompareSelectB()" style="background:var(--bg3);color:var(--white);border:1px solid var(--border);padding:.35rem;font-family:inherit;font-size:.72rem">
           ${playerOptions || `<option disabled>No players at this position</option>`}
         </select>
         <div style="color:var(--gray);font-size:.6rem;font-style:italic">Tip: click a player's name anywhere in the app first to pre-select A, then choose B here.</div>
       </div>`;
  // Compact A panel: use the existing detail panel but keep some breathing room.
  return `
    <div class="frn-pcard-overlay-inner" style="max-width:1180px;width:96vw">
      <button class="frn-pcard-close" onclick="frnCloseCompareModal()">×</button>
      <div style="padding:.55rem 1rem;border-bottom:1px solid var(--border);font-weight:700;color:var(--gold)">
        ⚖ Player Comparison · <span style="color:var(--gray);font-weight:400;font-size:.7rem">${pA.position} ${pA.name} vs ${pB ? pB.name : "?"}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">
        <div style="border-right:1px dashed var(--border);padding:.4rem">${_buildPlayerDetailPanel(pA)}</div>
        ${rightPane}
      </div>
    </div>`;
}
// Stash player A's name so the inline picker handlers can refer to it.
function _bspnCompareCurrentA() {
  const head = document.querySelector("#frn-compare-overlay .frn-pcard-overlay-inner > div:nth-child(2)");
  if (!head) return null;
  const m = head.textContent.match(/^\s*⚖ Player Comparison · \w+ (.+?) vs/);
  return m ? m[1].trim() : null;
}
function _bspnCompareRefilter() {
  // Re-render the modal preserving A but with a different position filter.
  const aName = _bspnCompareCurrentA();
  const select = document.getElementById("bspn-compare-pos");
  if (!aName || !select) return;
  const overlay = document.getElementById("frn-compare-overlay");
  const pA = _findPlayer(aName);
  if (!pA || !overlay) return;
  // Rebuild with the new position filter applied via a temp re-shape.
  // Easiest: just monkey-patch by replacing the player select options.
  const playerSelect = document.getElementById("bspn-compare-player");
  if (!playerSelect) return;
  const filter = select.value;
  const all = [];
  for (const [tidStr, roster] of Object.entries(franchise?.rosters || {})) {
    for (const p of roster) all.push({ ...p, _teamId: Number(tidStr) });
  }
  const myId = franchise?.chosenTeamId;
  const filtered = all
    .filter(p => p.name !== pA.name)
    .filter(p => filter === "ALL" || p.position === filter)
    .sort((a, b) => (b.overall || 0) - (a.overall || 0));
  playerSelect.innerHTML = filtered.slice(0, 200).map(p => {
    const team = getTeam(p._teamId);
    const isMine = p._teamId === myId;
    const ovrTag = isMine ? ` · ${p.overall||"?"} OVR` : ` · ${gradeLabel(scoutGrade(p))} grade`;
    const escName = (p.name || "").replace(/"/g, "&quot;");
    return `<option value="${escName}">${p.position} · ${p.name} · ${team?.name || "?"}${ovrTag}</option>`;
  }).join("") || `<option disabled>No players at this position</option>`;
}
function _bspnCompareSelectB() {
  const aName = _bspnCompareCurrentA();
  const select = document.getElementById("bspn-compare-player");
  if (!aName || !select) return;
  frnOpenCompareModal(aName, select.value);
}
function _bspnCompareClearB() {
  const aName = _bspnCompareCurrentA();
  if (aName) frnOpenCompareModal(aName, null);
}
// Team click still uses the existing scout page — but only when it
// makes sense (preseason/regular/playoffs). In offseason/draft/FA
// screens, fall back to a small alert noting scouting is paused.
function frnOpenTeamCard(teamId) {
  frnHoverTipHide();
  renderFrnPreseason("scout", Number(teamId));
}

// Global event delegation — players & teams hover/click handlers
function _frnInstallHoverDelegation() {
  if (window.__frnHoverInstalled) return;
  window.__frnHoverInstalled = true;
  document.addEventListener("mouseover", e => {
    const el = e.target.closest?.("[data-player-name],[data-team-id]");
    if (!el) return;
    if (el.dataset.playerName) frnPlayerTipShow(el, el.dataset.playerName, el.dataset.playerPid);
    else if (el.dataset.teamId) frnTeamTipShow2(el, el.dataset.teamId);
  });
  document.addEventListener("mouseout", e => {
    const el = e.target.closest?.("[data-player-name],[data-team-id]");
    if (el) frnHoverTipHide();
  });
  // Safety: any click that ISN'T on a tracked name clears the tooltip
  // (covers cases where the source span gets re-rendered away before
  // mouseout fires).
  document.addEventListener("click", e => {
    if (!e.target.closest?.("[data-player-name],[data-team-id]")) frnHoverTipHide();
  });
  document.addEventListener("click", e => {
    const el = e.target.closest?.("[data-player-name],[data-team-id]");
    if (!el) return;
    // If inside a parent with its own onclick, only intercept when the
    // click landed directly on the tracked element itself (not the parent row).
    // This lets schedule rows open the game viewer but frn-pname spans still
    // open the player card regardless of their container.
    const insideParentOnclick = el.parentElement?.closest("[onclick]");
    if (insideParentOnclick) {
      // Only intercept if the click target IS the tracked element itself
      if (e.target !== el && !el.classList.contains("frn-pname") && !el.classList.contains("frn-tname")) return;
    }
    if (el.dataset.playerName) {
      e.preventDefault(); e.stopPropagation();
      frnOpenPlayerCard(el.dataset.playerName, el.dataset.playerPid);
    } else if (el.dataset.teamId) {
      e.preventDefault(); e.stopPropagation();
      frnOpenTeamCard(el.dataset.teamId);
    }
  });
}
_frnInstallHoverDelegation();

function _escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Joint Practices ───────────────────────────────────────────────────────────
// Between weeks, you can propose a joint practice to another team. The
// initiator picks an intensity; the receiver picks theirs; the
// resolved intensity is the MIN of the two (the conservative side has
// veto power, matching how real NFL joint-practice negotiations
// shake out). The offer model is multiplayer-shaped — in single
// player the AI receiver auto-responds the same tick, but the same
// store maps onto an async transport later.
const JP_INTENSITIES = {
  walkthrough: {
    rank: 1, slotCost: 0.5, label: "Walk-through", icon: "🚶",
    desc: "Scheme + tendencies only · ½ slot · zero injury risk",
    revealsGrades: false, injuryChance: 0, awrRolls: 0,
  },
  joint: {
    rank: 2, slotCost: 1.0, label: "Joint Practice", icon: "🤝",
    desc: "Full intel (combine + grade sharpening) · 1 slot · minimal injury risk",
    revealsGrades: true,  injuryChance: 0.005, awrRolls: 1,
  },
  live: {
    rank: 3, slotCost: 1.0, label: "Live Pads", icon: "💥",
    desc: "Full intel + tendency report + AWR boost · 1 slot · real injury risk",
    revealsGrades: true,  injuryChance: 0.015, awrRolls: 2,
  },
};
const JP_ORDER = ["walkthrough", "joint", "live"];
const JP_SEASON_CAP = 4;

function _jpMin(a, b) { return JP_INTENSITIES[a].rank < JP_INTENSITIES[b].rank ? a : b; }
function _jpUsedSlots(season) {
  return (franchise.scrimmagesDone || [])
    .filter(s => s.season === season)
    .reduce((sum, s) => sum + (JP_INTENSITIES[s.intensity]?.slotCost ?? 1), 0);
}
function _jpRemainingSlots(season) { return Math.max(0, JP_SEASON_CAP - _jpUsedSlots(season)); }

// AI receiver's preferred intensity given the initiator's pick.
// Conservative when underdog (avoid injuries); aggressive when ahead
// (scout the upset hopefuls); matches initiator when roughly even.
function _jpAiResponderIntensity(receiverId, initiatorId) {
  const myRtg = frnTeamRating(receiverId);
  const themRtg = frnTeamRating(initiatorId);
  const gap = (myRtg.off + myRtg.def) - (themRtg.off + themRtg.def);
  if (gap < -8) return "walkthrough";
  if (gap >  8 && Math.random() < 0.5) return "live";
  return "joint";
}

// Module-level UI state for the inline intensity picker.
let _jpPickerTeam = null;
function frnJpShowPicker(otherId) { _jpPickerTeam = Number(otherId); renderFrnScrimmages(); }
function frnJpCancelPicker() { _jpPickerTeam = null; renderFrnScrimmages(); }

function frnScrimmageInterest(otherId) {
  // AI willingness based on relative talent + their own week's bye
  const myId = franchise.chosenTeamId;
  if (otherId === myId) return 0;
  const myRtg = frnTeamRating(myId);
  const otherRtg = frnTeamRating(otherId);
  const gap = Math.abs((myRtg.off + myRtg.def) - (otherRtg.off + otherRtg.def));
  // Closer ratings = more interest. Mid-tier teams more curious than elites.
  let interest = 0.55;
  if (gap > 25) interest *= 0.5;
  else if (gap > 12) interest *= 0.8;
  // Already practiced this season? Refuse a rematch.
  if ((franchise.scrimmagesDone || []).some(s =>
       s.season === franchise.season && s.teamId === otherId)) return 0;
  return Math.min(0.85, interest);
}

// Convert an OVR score to a letter (matches gradeLabel logic locally so
// the report doesn't depend on importer order — pure mapping).
function _gradeLetter(score) { return gradeLabel(score); }

// Detect each opponent player whose perceived grade moves meaningfully
// after the intel boost. Mutates franchise.scoutingIntel — flip it
// before/after to read both grade snapshots.
function _practiceIntelDiscoveries(oppId) {
  const oppRoster = (franchise.rosters[oppId] || []).slice();
  if (!oppRoster.length) return [];
  if (!franchise.scoutingIntel) franchise.scoutingIntel = {};
  const prevIntel = franchise.scoutingIntel[oppId];
  // Force unscouted view to measure "before"
  delete franchise.scoutingIntel[oppId];
  const before = oppRoster.map(p => ({ p, g: scoutGrade(p) }));
  // Now scouted view
  franchise.scoutingIntel[oppId] = { season: franchise.season, gainedWeek: franchise.week };
  const after = oppRoster.map(p => ({ p, g: scoutGrade(p) }));
  // Restore prevIntel snapshot so we don't mutate twice (final write happens at call site)
  if (prevIntel) franchise.scoutingIntel[oppId] = prevIntel;
  else delete franchise.scoutingIntel[oppId];
  const movers = oppRoster.map((p, i) => ({
    pid: p.pid, name: p.name, pos: p.position,
    age: p.age, overall: p.overall,
    beforeScore: before[i].g, afterScore: after[i].g,
    before: _gradeLetter(before[i].g),
    after:  _gradeLetter(after[i].g),
    delta:  after[i].g - before[i].g,
  })).filter(x => x.before !== x.after && Math.abs(x.delta) >= 1)
     .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
     .slice(0, 8);
  return movers;
}

// Pull 3–4 highlight-worthy plays from the practice game. Lighter
// version of captureGameHighlights — same heuristic, no storage in
// seasonHighlights (practices shouldn't pollute the season tape).
function _practiceHighlights(plays, homeId, awayId) {
  if (!Array.isArray(plays) || !plays.length) return [];
  const homeName = getTeam(homeId)?.name || "HOME";
  const awayName = getTeam(awayId)?.name || "AWAY";
  const hl = [];
  const recentBuf = [];
  const trimPlay = (p, isHl) => ({
    sit: p.down ? `${p.down}${(p.down === 1 ? "st" : p.down === 2 ? "nd" : p.down === 3 ? "rd" : "th")} & ${p.ytg ?? "?"}` : "",
    desc: p.desc || p.kind || "",
    hs: p.homeScore ?? 0, as: p.awayScore ?? 0,
    q: p.quarter, t: p.time, hi: !!isHl,
  });
  for (const p of plays) {
    let w = 0, label = "";
    if (p.kind === "score") {
      const scorer = p.poss === "home" ? homeName : awayName;
      const isTd = !!(p.passer || p.rusher || p.receiver) || (p.desc && /touchdown/i.test(p.desc));
      w = isTd ? 6 : 2.5;
      label = p.rusher ? `${p.rusher} TD rush`
            : (p.passer && p.receiver) ? `${p.passer}→${p.receiver} TD`
            : `${scorer} ${isTd ? "TD" : "FG"}`;
    } else if (p.kind === "int" && p.isPickSix) { w = 14; label = `PICK-SIX! ${p.defender || "DEF"}`; }
    else if (p.kind === "int")                  { w = 7;  label = `INT — ${p.defender || "DEF"}`; }
    else if (p.kind === "fumble")               { w = 5;  label = `FUM — ${p.forcedBy || p.defender || "DEF"}`; }
    else if (p.kind === "run" && (p.yards || 0) >= 25)       { w = 4; label = `${p.rusher || "RB"} ${p.yards}-yd run`; }
    else if (p.kind === "complete" && (p.yards || 0) >= 30)  { w = 4; label = `${p.passer || "QB"}→${p.receiver || "WR"} ${p.yards} yds`; }
    else if (p.kind === "sack" && (p.sackLoss || 0) >= 8)    { w = 3.5; label = `${p.dlName || "DEF"} sack`; }
    if (w > 0) {
      const clip = [...recentBuf.slice(-2).map(cp => trimPlay(cp, false)), trimPlay(p, true)];
      hl.push({ weight: w, label, desc: p.desc || "", clip,
        quarter: p.quarter, time: p.time,
        homeScore: p.homeScore, awayScore: p.awayScore });
    }
    recentBuf.push(p); if (recentBuf.length > 4) recentBuf.shift();
  }
  return hl.sort((a, b) => b.weight - a.weight).slice(0, 4);
}

// Tendency snapshot mined from a single practice's plays — what a
// walk-through reveals. No grade/combine info, just situational
// percentages a film-study staffer would call out the next morning.
function _practiceTendencies(plays, oppId) {
  if (!Array.isArray(plays) || !plays.length) return [];
  // Only count plays where the opponent had the ball (poss === "away"
  // since we're always home in practices).
  const oppPlays = plays.filter(p => p.poss === "away" && (p.kind === "run" || p.kind === "complete" || p.kind === "incomplete" || p.kind === "sack" || p.kind === "int" || p.kind === "fumble"));
  if (!oppPlays.length) return [];
  const passKinds = new Set(["complete","incomplete","sack","int"]);
  const total      = oppPlays.length;
  const passes     = oppPlays.filter(p => passKinds.has(p.kind)).length;
  const passRate   = passes / total;
  const first      = oppPlays.filter(p => p.down === 1);
  const firstPassRate = first.length ? first.filter(p => passKinds.has(p.kind)).length / first.length : 0;
  const third      = oppPlays.filter(p => p.down === 3);
  const thirdPassRate = third.length ? third.filter(p => passKinds.has(p.kind)).length / third.length : 0;
  const redZone    = oppPlays.filter(p => (p.yardLine || 0) >= 80);
  const rzRunRate  = redZone.length ? redZone.filter(p => p.kind === "run").length / redZone.length : 0;
  const sacks      = oppPlays.filter(p => p.kind === "sack").length;
  return [
    { label: "Overall pass rate",  value: `${Math.round(passRate*100)}%`,
      note: passRate > 0.62 ? "pass-heavy" : passRate < 0.42 ? "run-heavy" : "balanced" },
    { label: "1st-down pass",      value: `${Math.round(firstPassRate*100)}%`,
      note: firstPassRate > 0.55 ? "aggressive early" : firstPassRate < 0.40 ? "establish the run" : "" },
    { label: "3rd-down pass",      value: `${Math.round(thirdPassRate*100)}%`,
      note: thirdPassRate > 0.85 ? "almost always throws" : thirdPassRate < 0.70 ? "willing to run" : "" },
    { label: "Red-zone run rate",  value: redZone.length ? `${Math.round(rzRunRate*100)}%` : "—",
      note: redZone.length === 0 ? "no RZ trips" : rzRunRate > 0.65 ? "pounds it" : rzRunRate < 0.35 ? "throws TDs" : "" },
    { label: "Pressures taken",    value: `${sacks} sack${sacks===1?"":"s"} in ${total} plays`,
      note: sacks >= 4 ? "OL leaks" : sacks === 0 ? "OL holds up" : "" },
  ];
}

// Roll incidental injuries for a Live Pads practice. Caps at 2 per
// side so it never wrecks a roster. Returns the list of affected
// players (mutates franchise.rosters to stamp the injury).
function _practiceInjuriesRoll(myId, oppId, chance, capPerSide = 2) {
  if (!chance || chance <= 0) return [];
  const out = [];
  const rollSide = (teamId) => {
    const roster = franchise.rosters[teamId] || [];
    // Only roll for the top 22 by overall — the guys actually taking
    // first-team reps. Everyone else is on a back field.
    const starters = roster.slice().sort((a, b) => (b.overall||0) - (a.overall||0)).slice(0, 22);
    let hits = 0;
    for (const p of starters) {
      if (hits >= capPerSide) break;
      if (p.injury && p.injury.weeksRemaining > 0) continue;
      if (Math.random() < chance) {
        const weeks = 1 + Math.floor(Math.random() * 2); // 1–2 weeks
        const label = Math.random() < 0.6 ? "Tweaked hammy" : Math.random() < 0.5 ? "Stinger" : "Bruised ribs";
        p.injury = { label, weeksRemaining: weeks };
        out.push({ teamId, pid: p.pid, name: p.name, pos: p.position, label, weeks });
        hits++;
      }
    }
  };
  rollSide(myId);
  rollSide(oppId);
  return out;
}

// Award practice-driven AWR rolls to under-25 players on both teams
// (Live = 2 rolls, Joint = 1, Walkthrough = 0). Each roll has a
// modest chance to nudge AWR up by 1, capped at _awrCeiling.
function _practiceAwrBoost(myId, oppId, rolls) {
  if (!rolls || rolls <= 0) return { my: 0, opp: 0 };
  const bump = (teamId) => {
    let n = 0;
    for (const p of (franchise.rosters[teamId] || [])) {
      if ((p.age || 25) > 25) continue;
      if (!Array.isArray(p.stats)) continue;
      if ((p.stats[3] ?? 70) >= (p._awrCeiling ?? 85)) continue;
      for (let i = 0; i < rolls; i++) {
        if (Math.random() < 0.18) {
          p.stats[3] = Math.min(p._awrCeiling ?? 85, (p.stats[3] ?? 70) + 1);
          n++;
          break; // one bump max per practice per player
        }
      }
    }
    return n;
  };
  return { my: bump(myId), opp: bump(oppId) };
}

// Open the inline intensity picker. Called by the Request button on
// each row. The user picks one of the three intensities, which sends
// an "offer" to the (AI) receiver. Same shape as multiplayer.
function frnRequestScrimmage(otherId) {
  otherId = Number(otherId);
  const allDone = (franchise.scrimmagesDone || []);
  const thisWeek = allDone.filter(s => s.season === franchise.season && s.week === franchise.week);
  if (thisWeek.length >= 1) {
    alert("You've already run a joint practice this week. Only one per week.");
    renderFrnScrimmages();
    return;
  }
  if (_jpRemainingSlots(franchise.season) < JP_INTENSITIES.walkthrough.slotCost) {
    alert(`You've used all ${JP_SEASON_CAP} joint-practice slots for the season.`);
    renderFrnScrimmages();
    return;
  }
  const interest = frnScrimmageInterest(otherId);
  if (Math.random() > interest) {
    alert("They turned down the request — schedule too tight.");
    renderFrnScrimmages();
    return;
  }
  // They're willing — let the user pick intensity now.
  frnJpShowPicker(otherId);
}

// Send the offer at the chosen intensity and (in single player) let
// the AI receiver respond immediately. Resolved intensity = min of
// both picks. Same code path will plug into an async transport later
// — the offer object outlives the request.
function frnJpSendOffer(otherId, initiatorIntensity) {
  otherId = Number(otherId);
  if (!JP_INTENSITIES[initiatorIntensity]) return;
  _jpPickerTeam = null;
  const remaining = _jpRemainingSlots(franchise.season);
  if (JP_INTENSITIES[initiatorIntensity].slotCost > remaining + 0.01) {
    alert(`Not enough slot budget left — only ${remaining.toFixed(1)} remaining.`);
    renderFrnScrimmages();
    return;
  }
  const myId = franchise.chosenTeamId;
  if (!franchise.jointPracticeOffers) franchise.jointPracticeOffers = [];
  const offer = {
    id: `${franchise.season}-W${franchise.week}-${myId}-${otherId}-${Date.now()}`,
    season: franchise.season, week: franchise.week,
    fromTeamId: myId, toTeamId: otherId,
    fromIntensity: initiatorIntensity,
    status: "pending", createdAt: Date.now(),
  };
  franchise.jointPracticeOffers.push(offer);
  // AI receiver auto-responds same tick in single player.
  const receiverPref = _jpAiResponderIntensity(otherId, myId);
  offer.toIntensity   = receiverPref;
  offer.status        = "accepted";
  offer.respondedAt   = Date.now();
  offer.resolvedIntensity = _jpMin(initiatorIntensity, receiverPref);
  _jpRunPractice(offer);
}

// Actually run the resolved practice. Builds the report, awards
// intel + AWR + injuries per the intensity rules, stamps news.
function _jpRunPractice(offer) {
  const intensity = JP_INTENSITIES[offer.resolvedIntensity];
  const myId  = offer.fromTeamId;
  const oppId = offer.toTeamId;
  const r = frnSimPractice(myId, oppId);
  // Compute intel BEFORE flipping the scoutingIntel flag.
  const discoveries = intensity.revealsGrades ? _practiceIntelDiscoveries(oppId) : [];
  const tendencies  = (offer.resolvedIntensity !== "joint") ? _practiceTendencies(r.full?.plays || [], oppId) : [];
  const highlights  = (offer.resolvedIntensity !== "walkthrough") ? _practiceHighlights(r.full?.plays || [], myId, oppId) : [];
  const injuries    = _practiceInjuriesRoll(myId, oppId, intensity.injuryChance);
  const awrBoost    = _practiceAwrBoost(myId, oppId, intensity.awrRolls);
  if (intensity.revealsGrades) {
    if (!franchise.scoutingIntel) franchise.scoutingIntel = {};
    franchise.scoutingIntel[oppId] = {
      season: franchise.season,
      gainedWeek: franchise.week,
      intensity: offer.resolvedIntensity, // "joint" or "live" — band check reads this
    };
    // Coverage asymmetry: Standard JP stamps only the depth-chart
    // starters; Live Pads stamps the entire roster (full-contact
    // bench reps too). Per-player flag also lets the band check pick
    // up the intensity without scanning team metadata.
    const oppRoster = franchise.rosters[oppId] || [];
    const isLive = offer.resolvedIntensity === "live";
    let targets;
    if (isLive) {
      targets = oppRoster;
    } else {
      // Pull starter pids from the depth chart; if missing for any
      // reason, fall back to top-of-roster by OVR per position.
      const dc = franchise.depthChart?.[oppId];
      if (dc) {
        // Exclude package-only extras and returners so opponent scouting
        // reflects the 22 starters, not deep-roster goal-line/dime/return
        // contributors.
        const starterPids = new Set();
        for (const [slotKey, slot] of Object.entries(dc)) {
          if (slot?.starter && _isFullTimeStarterSlot(slotKey)) starterPids.add(slot.starter);
        }
        targets = oppRoster.filter(p => starterPids.has(p.pid));
      } else {
        const byPos = {};
        for (const p of oppRoster) (byPos[p.position] ||= []).push(p);
        const starters = [];
        for (const list of Object.values(byPos)) {
          list.sort((a, b) => (b.overall || 0) - (a.overall || 0));
          starters.push(...list.slice(0, 1));
        }
        targets = starters;
      }
    }
    for (const p of targets) {
      p._jpScoutedSeason = franchise.season;
      p._jpScoutedIntensity = offer.resolvedIntensity;
    }
  }
  if (!franchise.scrimmagesDone) franchise.scrimmagesDone = [];
  const report = {
    season: franchise.season, week: franchise.week, teamId: oppId,
    homeScore: r.homeScore, awayScore: r.awayScore,
    score: `${r.homeScore}-${r.awayScore}`,
    intensity: offer.resolvedIntensity,
    requestedIntensity: offer.fromIntensity,
    receiverIntensity:  offer.toIntensity,
    slotCost: intensity.slotCost,
    discoveries, tendencies, highlights, injuries, awrBoost,
    offerId: offer.id,
  };
  franchise.scrimmagesDone.push(report);
  offer.reportIdx = franchise.scrimmagesDone.length - 1;
  const oppTeam = getTeam(oppId);
  const intensityNote = offer.fromIntensity !== offer.resolvedIntensity ? ` (downgraded by ${oppTeam?.name})` : "";
  _pushNews({ type:"scrimmage",
    label: `🏟 ${intensity.label} with ${oppTeam.name}${intensityNote} — ${intensity.revealsGrades?"scouting intel":"tendency notes"} gathered (final: ${r.homeScore}-${r.awayScore})` });
  saveFranchise();
  renderFrnPracticeReport(report.offerId ? franchise.scrimmagesDone.length - 1 : 0);
}

// Render the report card for a completed joint practice. Reused by the
// practice log (click any past practice to re-read it). Adapts panels
// to the resolved intensity — Walkthrough hides highlights + grade
// revisions, Live adds an injuries panel + AWR boost note.
function renderFrnPracticeReport(idx) {
  frnHoverTipHide(); _frnHoverTipPgHide && _frnHoverTipPgHide();
  const all = franchise.scrimmagesDone || [];
  const report = all[idx];
  if (!report) { renderFrnScrimmages(); return; }
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const oppTeam = getTeam(report.teamId);
  const intensityKey = report.intensity || "joint"; // legacy reports default
  const intensity = JP_INTENSITIES[intensityKey] || JP_INTENSITIES.joint;
  const discoveries = report.discoveries || [];
  const tendencies  = report.tendencies  || [];
  const highlights  = report.highlights  || [];
  const injuries    = report.injuries    || [];
  const awrBoost    = report.awrBoost    || { my: 0, opp: 0 };
  const downgraded  = report.requestedIntensity && report.requestedIntensity !== intensityKey;
  const deltaCol = (d) => d > 0 ? "var(--green-lt)" : d < 0 ? "#ff8a8a" : "var(--gray)";

  const intelPanel = intensity.revealsGrades
    ? `<div style="background:var(--bg2);border:1px solid var(--border);border-left:3px solid var(--gold);padding:.5rem .7rem">
        <div style="font-size:.55rem;letter-spacing:.6px;color:var(--gold);font-weight:800">SCOUTING INTEL GAINED</div>
        <div style="font-size:.7rem;color:var(--blwhite);margin-top:.18rem">Full roster combine measurables revealed and grades sharpen ±8 → ±2 for the rest of Season ${report.season}.</div>
      </div>`
    : `<div style="background:var(--bg2);border:1px solid var(--border);border-left:3px solid var(--blgray);padding:.5rem .7rem">
        <div style="font-size:.55rem;letter-spacing:.6px;color:var(--blgray);font-weight:800">TENDENCY-ONLY (WALK-THROUGH)</div>
        <div style="font-size:.7rem;color:var(--blwhite);margin-top:.18rem">No live reps — grades stay noisy and combines stay estimated. You got their playcall tendencies (see below) and that's it.</div>
      </div>`;

  const intelRows = discoveries.length
    ? discoveries.map(d => `<tr>
        <td style="padding:.18rem .4rem;font-size:.66rem"><b>${d.pos}</b> <span style="color:var(--blwhite)">${d.name}</span> <span style="color:var(--gray);font-size:.58rem">age ${d.age||"?"}</span></td>
        <td style="padding:.18rem .4rem;color:var(--gray);font-size:.62rem">was <b>${d.before}</b></td>
        <td style="padding:.18rem .4rem;font-size:.62rem">→ <b style="color:${deltaCol(d.delta)}">${d.after}</b></td>
        <td style="padding:.18rem .4rem;font-size:.58rem;color:${deltaCol(d.delta)};font-weight:800;text-align:right">${d.delta > 0 ? "+" : ""}${d.delta}</td>
      </tr>`).join("")
    : "";
  const gradeBlock = intensity.revealsGrades
    ? `<div class="frn-card-title" style="margin-top:.8rem">📋 GRADE REVISIONS (${discoveries.length})</div>
       <div style="font-size:.58rem;color:var(--gray);margin-bottom:.25rem">Players whose perceived grade moved. + = your scouts undervalued them; − = the tape was hiding warts.</div>
       ${discoveries.length
         ? `<table style="width:100%;border-collapse:collapse;background:var(--bg2);border:1px solid var(--border)">${intelRows}</table>`
         : `<div style="color:var(--gray);font-style:italic;font-size:.65rem">Your scouts had them dialed in — no meaningful revisions.</div>`}`
    : "";

  const tendenciesBlock = tendencies.length
    ? `<div class="frn-card-title" style="margin-top:.8rem">🎯 TENDENCIES (${oppTeam?.name||"opponent"})</div>
       <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.3rem">
         ${tendencies.map(t => `<div style="background:var(--bg2);border:1px solid var(--border);padding:.32rem .5rem">
           <div style="font-size:.52rem;letter-spacing:.6px;color:var(--blgray);font-weight:700">${t.label.toUpperCase()}</div>
           <div style="font-size:.86rem;font-weight:900;color:var(--gold-lt);font-family:'IBM Plex Mono','JetBrains Mono',monospace">${t.value}</div>
           ${t.note ? `<div style="font-size:.55rem;color:var(--gray);font-style:italic">${t.note}</div>` : ""}
         </div>`).join("")}
       </div>` : "";

  const highlightCards = highlights.length
    ? highlights.map(h => {
        const clipLines = (h.clip || []).map(c =>
          `<div style="font-size:.58rem;color:${c.hi?"var(--gold-lt)":"var(--blgray)"};padding:.08rem 0">${c.sit ? `<span style="color:var(--gray);margin-right:.4rem">${c.sit}</span>` : ""}${c.desc || ""}</div>`
        ).join("");
        return `<div style="background:var(--bg2);border:1px solid var(--border);border-left:3px solid var(--gold);padding:.4rem .55rem;margin-bottom:.3rem">
          <div style="font-size:.7rem;font-weight:900;color:var(--gold);margin-bottom:.2rem">▶ ${h.label}</div>
          ${clipLines}
          ${h.homeScore != null ? `<div style="font-size:.54rem;color:var(--gray);margin-top:.18rem">Q${h.quarter||"?"} · ${myTeam.name} ${h.homeScore} — ${oppTeam.name} ${h.awayScore}</div>` : ""}
        </div>`;
      }).join("")
    : "";
  const highlightsBlock = intensityKey !== "walkthrough"
    ? `<div class="frn-card-title" style="margin-top:.8rem">🎬 HIGHLIGHTS</div>
       ${highlightCards || `<div style="color:var(--gray);font-style:italic;font-size:.65rem">No marquee plays — clean controlled practice.</div>`}`
    : "";

  const injuriesBlock = injuries.length
    ? `<div class="frn-card-title" style="margin-top:.8rem;color:#ff8a8a">🚑 INJURIES (LIVE PADS)</div>
       <div style="font-size:.58rem;color:var(--gray);margin-bottom:.25rem">Reps in pads come with a cost — these guys missed snaps. Yours are flagged on your depth chart now.</div>
       <div style="display:flex;flex-direction:column;gap:.2rem">
         ${injuries.map(i => `<div style="background:var(--bg2);border:1px solid #ff6b6b33;border-left:3px solid #ff8a8a;padding:.3rem .55rem;font-size:.66rem">
           <b style="color:${i.teamId===myId?"var(--gold)":"var(--blwhite)"}">${i.teamId===myId ? "YOU" : oppTeam?.name}</b>
           · <b>${i.pos}</b> ${i.name} — ${i.label} (${i.weeks}w)
         </div>`).join("")}
       </div>`
    : "";

  const awrBlock = (awrBoost.my + awrBoost.opp) > 0
    ? `<div style="background:var(--bg2);border:1px solid var(--border);border-left:3px solid var(--green-lt);padding:.4rem .6rem;margin-top:.6rem">
        <div style="font-size:.55rem;letter-spacing:.6px;color:var(--green-lt);font-weight:800">⬆ AWR DEVELOPMENT</div>
        <div style="font-size:.66rem;color:var(--blwhite);margin-top:.18rem">${awrBoost.my} of your under-25 players bumped AWR · ${awrBoost.opp} on ${oppTeam?.name}'s side.</div>
      </div>`
    : "";

  const intensityChip = `<span style="background:var(--bg3);border:1px solid var(--border);padding:.18rem .42rem;font-size:.58rem;letter-spacing:.6px;color:var(--gold-lt);font-weight:800">
    ${intensity.icon} ${intensity.label.toUpperCase()} · ${intensity.slotCost} SLOT${intensity.slotCost===1?"":""}
  </span>`;
  const downgradeBanner = downgraded
    ? `<div style="background:rgba(232,160,0,.08);border:1px solid rgba(232,160,0,.35);padding:.3rem .5rem;font-size:.6rem;color:var(--gold-lt);margin-bottom:.5rem">
        ⚠ You requested <b>${JP_INTENSITIES[report.requestedIntensity]?.label}</b>; ${oppTeam?.name} answered <b>${JP_INTENSITIES[report.receiverIntensity]?.label}</b>. The lower intensity wins — you ran a <b>${intensity.label}</b>.
      </div>` : "";

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🏟 PRACTICE REPORT</div>
      ${intensityChip}
      <div style="color:var(--gray);font-size:.72rem">Wk ${report.week} · vs <b style="color:${oppTeam?.primary||"var(--gold)"}">${oppTeam?.city||""} ${oppTeam?.name||"?"}</b></div>
      <button class="btn btn-outline" onclick="renderFrnScrimmages()" style="margin-left:auto">← Back to practices</button>
    </div>
    ${downgradeBanner}
    <div style="display:grid;grid-template-columns:auto 1fr;gap:.6rem;align-items:start;margin-bottom:.6rem">
      <div style="background:var(--bg2);border:1px solid var(--border);padding:.55rem .8rem;text-align:center">
        <div style="font-size:.5rem;letter-spacing:.7px;color:var(--gray)">FINAL</div>
        <div style="font-size:1.6rem;font-weight:900;font-family:'IBM Plex Mono','JetBrains Mono',monospace">
          <span style="color:${myTeam?.primary||"var(--gold)"}">${report.homeScore}</span>
          <span style="color:var(--gray);margin:0 .35rem">—</span>
          <span style="color:${oppTeam?.primary||"var(--blwhite)"}">${report.awayScore}</span>
        </div>
        <div style="font-size:.52rem;color:var(--gray);margin-top:.15rem">Exhibition · no W/L</div>
      </div>
      ${intelPanel}
    </div>
    ${gradeBlock}
    ${tendenciesBlock}
    ${highlightsBlock}
    ${injuriesBlock}
    ${awrBlock}`;
}

function renderFrnScrimmages() {
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const myConfDiv = `${myTeam?.conference}-${myTeam?.division}`;
  const done = (franchise.scrimmagesDone || []).filter(s => s.season === franchise.season);
  const allDoneIdx = (franchise.scrimmagesDone || []).map((s, i) => ({ s, i }))
    .filter(({ s }) => s.season === franchise.season);
  const doneThisWeek = done.filter(s => s.week === franchise.week);
  const doneByTeam = new Map(done.map(s => [s.teamId, s]));
  const usedSlots = _jpUsedSlots(franchise.season);
  const remainingSlots = JP_SEASON_CAP - usedSlots;
  const lockedThisWeek = doneThisWeek.length >= 1;
  const lockedThisSeason = remainingSlots < JP_INTENSITIES.walkthrough.slotCost;
  // Pending inbox offers (multiplayer-ready; single player auto-resolves
  // so this almost always empty, but the shape is the same).
  const pendingIncoming = (franchise.jointPracticeOffers || [])
    .filter(o => o.status === "pending" && o.toTeamId === myId);

  // Schedule context: which teams do I play this season, and when?
  const remainingWeekByOpp = new Map();
  for (const g of (franchise.schedule || [])) {
    if (g.played) continue;
    if (g.homeId === myId)      remainingWeekByOpp.set(g.awayId, g.week);
    else if (g.awayId === myId) remainingWeekByOpp.set(g.homeId, g.week);
  }
  const playedThisSeason = new Set();
  for (const g of (franchise.schedule || [])) {
    if (!g.played) continue;
    if (g.homeId === myId) playedThisSeason.add(g.awayId);
    else if (g.awayId === myId) playedThisSeason.add(g.homeId);
  }

  const candidates = TEAMS.filter(t => t.id !== myId).map(t => {
    const interest  = frnScrimmageInterest(t.id);
    const rtg       = frnTeamRating(t.id);
    const upcomingWk = remainingWeekByOpp.get(t.id) ?? null;
    const isDivision = `${t.conference}-${t.division}` === myConfDiv;
    const isUpcoming = upcomingWk != null && upcomingWk - franchise.week <= 4;
    const alreadyDone = doneByTeam.has(t.id);
    const alreadyPlayed = playedThisSeason.has(t.id);
    // Strategic value: future opponents > division foes > others; demoted if
    // we already scrimmaged or already played them.
    let priority = 0;
    if (alreadyDone)        priority -= 100;
    if (upcomingWk != null) priority += 30 - Math.min(20, upcomingWk - franchise.week);
    if (isUpcoming)         priority += 15;
    if (isDivision)         priority += 10;
    if (alreadyPlayed)      priority -= 5;
    priority += interest * 5;
    return { t, interest, rtg, upcomingWk, isDivision, isUpcoming, alreadyDone, alreadyPlayed, priority };
  }).sort((a, b) => b.priority - a.priority);

  const renderRow = (c) => {
    const { t, interest, rtg, upcomingWk, isDivision, isUpcoming, alreadyDone, alreadyPlayed } = c;
    const willTag = alreadyDone ? `<span style="color:var(--gray);font-size:.6rem">— scrimmaged W${doneByTeam.get(t.id)?.week} —</span>`
      : interest >= 0.55 ? `<span style="color:var(--green-lt);font-size:.6rem;font-weight:700">VERY WILLING</span>`
      : interest >= 0.35 ? `<span style="color:#e8a000;font-size:.6rem;font-weight:700">OPEN</span>`
      : interest > 0     ? `<span style="color:#c08080;font-size:.6rem;font-weight:700">UNLIKELY</span>`
      :                    `<span style="color:var(--gray);font-size:.6rem">REFUSED</span>`;
    const chips = [];
    if (upcomingWk != null) {
      const wksAway = upcomingWk - franchise.week;
      const col = wksAway <= 2 ? "#ff6b6b" : wksAway <= 4 ? "#e8a000" : "var(--gold-lt)";
      chips.push(`<span class="frn-jp-chip" style="border-color:${col};color:${col}" title="On your remaining schedule — practice here pays off Week ${upcomingWk}">▶ WK ${upcomingWk}${wksAway <= 4 ? ` (${wksAway}w)` : ""}</span>`);
    }
    if (isDivision)   chips.push(`<span class="frn-jp-chip" style="border-color:var(--gold);color:var(--gold)" title="Division foe — you'll see them again">🏟 DIVISION</span>`);
    if (alreadyPlayed)chips.push(`<span class="frn-jp-chip muted" title="Already played them this season — intel is less actionable">✓ PLAYED</span>`);
    if (alreadyDone)  chips.push(`<span class="frn-jp-chip muted" title="Intel already gained">📋 INTEL</span>`);
    const disabled = alreadyDone || lockedThisWeek || lockedThisSeason;
    const intel = alreadyDone
      ? `<span style="color:var(--gold);font-size:.58rem">✓ ${doneByTeam.get(t.id)?.discoveries?.length || 0} grade revisions</span>`
      : `<span style="color:var(--gray);font-size:.58rem">Reveals combine + sharpens ~${(franchise.rosters[t.id]||[]).length} grades</span>`;
    const actionCell = alreadyDone
      ? `<button class="btn btn-outline" style="font-size:.6rem;padding:.2rem .55rem"
           onclick="renderFrnPracticeReport(${allDoneIdx.find(({s}) => s.teamId === t.id)?.i ?? -1})">View report →</button>`
      : `<button class="btn btn-gold" style="font-size:.62rem;padding:.2rem .55rem${disabled?";opacity:.4;cursor:not-allowed":""}"
           ${disabled?"disabled":""}
           onclick="frnRequestScrimmage(${t.id})">Request →</button>`;
    return `<tr class="frn-jp-row${isUpcoming?" upcoming":""}${isDivision?" division":""}">
      <td style="font-weight:700;padding:.3rem .45rem">
        ${teamLink(t, true)}
        <div style="display:flex;flex-wrap:wrap;gap:.2rem;margin-top:.15rem">${chips.join("")}</div>
      </td>
      <td style="color:var(--gray);font-size:.62rem;padding:.3rem .45rem">OFF ${rtg.off} · DEF ${rtg.def}</td>
      <td style="padding:.3rem .45rem">${willTag}<div>${intel}</div></td>
      <td style="padding:.3rem .45rem;text-align:right">${actionCell}</td>
    </tr>`;
  };

  const rows = candidates.map(renderRow).join("");

  const capBanner = lockedThisSeason
    ? `<div class="frn-pre-warn">⚠ You've used all ${JP_SEASON_CAP} joint-practice slots for the season.</div>`
    : lockedThisWeek
    ? `<div class="frn-pre-warn" style="border-color:var(--gold-lt);color:var(--gold-lt);background:rgba(200,169,0,0.10)">
         ✓ You already ran a joint practice this week with ${getTeam(doneThisWeek[0].teamId)?.name||"a team"}. Next slot opens at week start.
       </div>`
    : "";

  // Inline intensity picker — opens when the user clicks Request on a row.
  let pickerHtml = "";
  if (_jpPickerTeam) {
    const picked = getTeam(_jpPickerTeam);
    pickerHtml = `<div class="frn-jp-picker">
      <div style="display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap;margin-bottom:.4rem">
        <span style="font-size:.85rem;font-weight:900;color:var(--gold)">PICK INTENSITY</span>
        <span style="color:var(--gray);font-size:.7rem">vs <b style="color:${picked?.primary||"var(--gold)"}">${picked?.city} ${picked?.name}</b></span>
        <button class="btn btn-outline" onclick="frnJpCancelPicker()" style="margin-left:auto;font-size:.6rem">Cancel</button>
      </div>
      <div style="font-size:.58rem;color:var(--gray);margin-bottom:.45rem">
        ${picked?.name} also picks an intensity privately. The <b>lower</b> of the two is what you actually run — the conservative side has veto power.
      </div>
      <div class="frn-jp-picker-grid">
        ${JP_ORDER.map(key => {
          const i = JP_INTENSITIES[key];
          const canAfford = i.slotCost <= remainingSlots + 0.01;
          return `<button class="frn-jp-int-btn${!canAfford?" disabled":""}"
            ${!canAfford?"disabled":""}
            onclick="frnJpSendOffer(${_jpPickerTeam}, '${key}')">
            <div class="frn-jp-int-head"><span class="frn-jp-int-icon">${i.icon}</span><span class="frn-jp-int-label">${i.label}</span></div>
            <div class="frn-jp-int-cost">${i.slotCost === 0.5 ? "½" : i.slotCost} slot${i.slotCost===1?"":""}</div>
            <div class="frn-jp-int-desc">${i.desc}</div>
            ${!canAfford ? `<div class="frn-jp-int-warn">not enough slot budget</div>` : ""}
          </button>`;
        }).join("")}
      </div>
    </div>`;
  }

  // Pending incoming offers (multiplayer hook — in single player these
  // auto-resolve immediately so this is normally empty).
  const inboxHtml = pendingIncoming.length
    ? `<div class="frn-jp-inbox">
        <div style="font-size:.55rem;letter-spacing:.6px;color:#ffb347;font-weight:800;margin-bottom:.25rem">📬 INCOMING REQUESTS (${pendingIncoming.length})</div>
        ${pendingIncoming.map(o => {
          const from = getTeam(o.fromTeamId);
          const i = JP_INTENSITIES[o.fromIntensity];
          return `<div class="frn-jp-inbox-row">
            <span><b style="color:${from?.primary||"var(--gold)"}">${from?.name}</b> requested ${i.icon} <b>${i.label}</b> · Wk ${o.week}</span>
            <span style="margin-left:auto;color:var(--gray);font-size:.58rem">awaiting response</span>
          </div>`;
        }).join("")}
      </div>`
    : "";

  const logHtml = allDoneIdx.length
    ? `<div class="frn-card-title" style="margin-top:.9rem">📓 PRACTICES THIS SEASON</div>
       <div style="display:flex;flex-direction:column;gap:.25rem">
         ${allDoneIdx.slice().reverse().map(({ s, i }) => {
           const opp = getTeam(s.teamId);
           const ikey = s.intensity || "joint";
           const intensity = JP_INTENSITIES[ikey] || JP_INTENSITIES.joint;
           const revs = s.discoveries?.length || 0;
           const hls  = s.highlights?.length  || 0;
           const inj  = s.injuries?.length    || 0;
           const meta = [`${intensity.icon} ${intensity.label}`,
             revs ? `${revs} revisions` : "",
             hls  ? `${hls} highlights` : "",
             inj  ? `🚑 ${inj} injuries` : "",
           ].filter(Boolean).join(" · ");
           return `<div class="frn-jp-log-row" onclick="renderFrnPracticeReport(${i})">
             <span class="frn-jp-log-wk">W${s.week}</span>
             <span class="frn-jp-log-opp" style="color:${opp?.primary||"var(--gold)"}">vs ${opp?.name||"?"}</span>
             <span class="frn-jp-log-score">${s.homeScore != null ? `${s.homeScore}-${s.awayScore}` : (s.score || "")}</span>
             <span class="frn-jp-log-meta">${meta}</span>
             <span class="frn-jp-log-arrow">›</span>
           </div>`;
         }).join("")}
       </div>`
    : "";

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🏟 JOINT PRACTICES</div>
      <div style="color:var(--gray);font-size:.72rem">
        One per week · ${usedSlots.toFixed(1)}/${JP_SEASON_CAP} slot budget used (Live Pads + Joint = 1 each, Walk-through = ½)
      </div>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto">← Back</button>
    </div>
    <div class="frn-fa-summary">
      Joint practices are exhibitions — no W/L, no stat lines, no season-stat pollution. Three intensities: <b>🚶 Walk-through</b> (tendencies only, ½ slot, zero risk), <b>🤝 Joint Practice</b> (full intel, 1 slot), <b>💥 Live Pads</b> (full intel + AWR boost, 1 slot, real injury risk). Resolved intensity is the MIN of your pick and theirs.
    </div>
    ${inboxHtml}
    ${capBanner}
    ${pickerHtml}
    <table class="frn-pre-roster-table" style="margin-top:.5rem">
      <thead><tr><th>Team</th><th>Rating</th><th>Willingness · Intel</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${logHtml}`;
}

// ── Past-game viewer ──────────────────────────────────────────────────────────
// ── Legacy / all-time records ─────────────────────────────────────────────────
// Top nav shared across every BSPN broadcast page (standings, leaders,
// legacy, wire). Each entry is a real navigable button. Pass `active`
// to highlight the current page (e.g. "STANDINGS", "STATS").
const _BSPN_NAV_LINKS = [
  { id: "SCORECENTER", action: "showFranchiseDashboard()" },
  { id: "STANDINGS",   action: "renderFrnStandings()" },
  { id: "STATS",       action: "renderFrnLeaders()" },
  { id: "LEGACY",      action: "renderFrnLegacy()" },
  { id: "WIRE",        action: "renderFrnNewsArchive()" },
];
function _bspnNavHtml(activeId) {
  return _BSPN_NAV_LINKS.map(({ id, action }) =>
    `<button class="bspnlive-nav-item ${id === activeId ? "active" : ""}"
      style="background:transparent;border:0;font-family:inherit;cursor:pointer;padding:0;${id===activeId?"color:var(--blwhite)":""}"
      onclick="${action}">[${id}]</button>`
  ).join(" ");
}

// ── BSPN STANDINGS PAGE ─────────────────────────────────────────────────────
// Compute a team's playoff status (clinched div / clinched playoff /
// in hunt / eliminated) by comparing wins-possible against the seed-5
// (first-out) team in their conference. Pure W-L math — tiebreakers
// applied only at the divisional level.
function _playoffClinchStatus(teamId, sorted) {
  const target = sorted.find(s => s.id === teamId);
  if (!target) return null;
  const gp = (target.w || 0) + (target.l || 0) + (target.t || 0);
  const gamesLeft = Math.max(0, FRANCHISE_WEEKS - gp);
  if (gamesLeft >= FRANCHISE_WEEKS) return null; // season hasn't started
  const conf = target.team.conference;
  const confTeams = sorted.filter(s => s.team.conference === conf);
  const seedCount = PLAYOFF_TEAMS / 2;
  const bubble     = confTeams[seedCount - 1];
  const firstOut   = confTeams[seedCount];
  if (!bubble) return null;
  const _maxWins = s => (s.w || 0) + Math.max(0, FRANCHISE_WEEKS - ((s.w||0)+(s.l||0)+(s.t||0)));
  const _minWins = s => (s.w || 0);
  const targetMin = _minWins(target);
  const targetMax = _maxWins(target);
  // Division clinch — leader's min wins beat #2 in division max wins
  const divTeams = confTeams.filter(s => s.team.division === target.team.division);
  const divLeader = divTeams[0];
  const divSecond = divTeams[1];
  if (divLeader && target.id === divLeader.id && divSecond && targetMin > _maxWins(divSecond)) {
    return { tag: "CLINCHED DIV", color: "var(--blgold)" };
  }
  // Playoff clinch
  if (firstOut && targetMin > _maxWins(firstOut)) {
    return { tag: "CLINCHED", color: "var(--blgreen)" };
  }
  // Eliminated
  if (bubble && target.id !== bubble.id && targetMax < _minWins(bubble)) {
    return { tag: "ELIMINATED", color: "#ff7676" };
  }
  // In the hunt (late-season + within striking distance)
  if (gamesLeft <= 5 && gamesLeft > 0 && targetMax >= _minWins(bubble)) {
    return { tag: "IN HUNT", color: "#e8a000" };
  }
  return null;
}

// Broadcast-styled league standings — uses the BSPN scoped CSS already
// loaded for the box-score page. Grouped by conference + division with
// the user's team highlighted. Tiebreakers from standingsSorted (which
// runs NFL-style W-L% → div → conf → H2H → PD).
function renderFrnStandings() {
  frnHoverTipHide(); _frnHoverTipPgHide && _frnHoverTipPgHide();
  const myId = franchise.chosenTeamId;
  const seasonDone = franchise.week > FRANCHISE_WEEKS;
  const sorted = standingsSorted();
  const sortedById = new Map(sorted.map((s, i) => [s.id, { ...s, rank: i + 1 }]));
  // Group by conference + division
  const groupKey = t => `${t.conference}|${t.division}`;
  const divisions = {};
  for (const t of TEAMS) {
    const k = groupKey(t);
    (divisions[k] ||= { conference: t.conference, division: t.division, teams: [] }).teams.push(t);
  }
  // Sort each division by W-L% etc., re-using the global sort order
  for (const g of Object.values(divisions)) {
    g.teams.sort((a, b) => (sortedById.get(a.id)?.rank || 99) - (sortedById.get(b.id)?.rank || 99));
  }

  const renderDivisionTable = (g) => {
    const rows = g.teams.map((t, i) => {
      const s = sortedById.get(t.id) || {};
      const detailed = s.detailed || {};
      const recStr  = `${s.w||0}-${s.l||0}${s.t?`-${s.t}`:""}`;
      const divRec  = `${detailed.divW||0}-${detailed.divL||0}${detailed.divT?`-${detailed.divT}`:""}`;
      const confRec = `${detailed.confW||0}-${detailed.confL||0}${detailed.confT?`-${detailed.confT}`:""}`;
      const pd = detailed.pointDiff || 0;
      const pdColor = pd > 0 ? "var(--blgreen)" : pd < 0 ? "#ff7676" : "var(--blgray)";
      const isMine = t.id === myId;
      const clinch = _playoffClinchStatus(t.id, sorted);
      const clinchPill = clinch
        ? `<span style="color:${clinch.color};font-size:.5rem;letter-spacing:.6px;border:1px solid ${clinch.color};padding:.05rem .3rem;margin-left:.4rem;border-radius:2px">${clinch.tag}</span>`
        : "";
      return `<tr ${isMine ? `style="background:rgba(245,197,66,0.08)"` : ""}>
        <td style="color:var(--blgold);font-weight:900;width:1.5rem">${i + 1}</td>
        <td>
          <span class="bspnlive-num" style="color:${t.primary};font-weight:700">${t.abbr || t.name.slice(0,3).toUpperCase()}</span>
          <span style="color:${isMine ? "var(--blgold)" : "var(--blwhite)"};font-weight:${isMine?900:600};margin-left:.45rem;font-family:'Bebas Neue','Anton',sans-serif;letter-spacing:1px;font-size:.95rem">${t.city} ${t.name}</span>
          ${isMine ? `<span style="color:var(--blgold);font-size:.55rem;letter-spacing:.5px;margin-left:.4rem">YOU</span>` : ""}
          ${clinchPill}
        </td>
        <td class="bspnlive-num" style="text-align:right;font-weight:700">${recStr}</td>
        <td class="bspnlive-num" style="text-align:right;color:var(--blgray)">${divRec}</td>
        <td class="bspnlive-num" style="text-align:right;color:var(--blgray)">${confRec}</td>
        <td class="bspnlive-num" style="text-align:right">${s.pf || 0}</td>
        <td class="bspnlive-num" style="text-align:right">${s.pa || 0}</td>
        <td class="bspnlive-num" style="text-align:right;color:${pdColor};font-weight:700">${pd > 0 ? "+" : ""}${pd}</td>
      </tr>`;
    }).join("");
    return `<section class="bspn-panel" style="padding:.6rem .8rem">
      <div class="bspn-panel-title">${g.conference} ${g.division.toUpperCase()}</div>
      <table class="bspnlive-mini-table" style="font-size:.7rem;width:100%">
        <thead>
          <tr>
            <th></th>
            <th style="text-align:left">TEAM</th>
            <th style="text-align:right">W-L</th>
            <th style="text-align:right">DIV</th>
            <th style="text-align:right">CONF</th>
            <th style="text-align:right">PF</th>
            <th style="text-align:right">PA</th>
            <th style="text-align:right">DIFF</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  };

  const renderConferenceOutlook = (conf) => {
    const teams = sorted.filter(s => s.team?.conference === conf);
    const rows = teams.map((s, i) => {
      const isMine = s.id === myId;
      const inPlayoffs = i < (PLAYOFF_TEAMS / 2);
      const recStr = `${s.w||0}-${s.l||0}${s.t?`-${s.t}`:""}`;
      const seedTag = inPlayoffs
        ? `<span style="color:var(--blgold);font-weight:900;font-size:.85rem;font-family:'Bebas Neue',sans-serif">#${i+1}</span>`
        : `<span style="color:var(--blgray);font-weight:600">${i+1}</span>`;
      const clinch = _playoffClinchStatus(s.id, sorted);
      const clinchPill = clinch
        ? `<span style="color:${clinch.color};font-size:.5rem;letter-spacing:.6px;border:1px solid ${clinch.color};padding:.05rem .3rem;margin-left:.4rem;border-radius:2px">${clinch.tag}</span>`
        : "";
      return `<tr ${isMine ? `style="background:rgba(245,197,66,0.08)"` : ""}>
        <td style="width:2.2rem;text-align:center">${seedTag}</td>
        <td>
          <span class="bspnlive-num" style="color:${s.team.primary};font-weight:700">${s.team.abbr || s.team.name.slice(0,3).toUpperCase()}</span>
          <span style="margin-left:.4rem;color:${isMine?"var(--blgold)":"var(--blwhite)"};font-family:'Bebas Neue','Anton',sans-serif;letter-spacing:1px">${s.team.name}</span>
          ${clinchPill}
        </td>
        <td class="bspnlive-num" style="text-align:right;font-weight:700">${recStr}</td>
      </tr>`;
    }).join("");
    return `<section class="bspn-panel" style="padding:.6rem .8rem">
      <div class="bspn-panel-title" style="color:#ff5a5a">${conf} PLAYOFF PICTURE</div>
      <table class="bspnlive-mini-table" style="font-size:.7rem;width:100%">
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:.4rem;padding-top:.35rem;border-top:1px dashed var(--blborder);font-size:.55rem;color:var(--blgray);letter-spacing:1px">
        TOP ${PLAYOFF_TEAMS/2} IN EACH CONFERENCE → PLAYOFFS
      </div>
    </section>`;
  };

  const sortedConfDivs = Object.values(divisions).sort((a, b) =>
    a.conference.localeCompare(b.conference) || a.division.localeCompare(b.division));
  const afcDivs = sortedConfDivs.filter(g => g.conference === "AFC");
  const nfcDivs = sortedConfDivs.filter(g => g.conference === "NFC");

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">LEAGUE STANDINGS · SEASON ${franchise.season}</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("STANDINGS")}</nav>
      </header>
      <div style="padding:.6rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:1rem;align-items:center">
        <button class="bspn-back" onclick="showFranchiseDashboard()">‹ Return to Main Screen</button>
        <span style="color:var(--blgray);font-size:.7rem;letter-spacing:.5px">
          Week ${Math.min(franchise.week, FRANCHISE_WEEKS)} of ${FRANCHISE_WEEKS}${seasonDone ? " · REGULAR SEASON COMPLETE" : ""}
        </span>
      </div>
      <div style="padding:1rem 1.4rem">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-bottom:.7rem">
          ${renderConferenceOutlook("AFC")}
          ${renderConferenceOutlook("NFC")}
        </div>
        <div style="font-family:'Bebas Neue','Anton',sans-serif;color:var(--blwhite);font-size:1.4rem;letter-spacing:2px;margin:1rem 0 .35rem 0">AFC DIVISIONS</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">
          ${afcDivs.map(renderDivisionTable).join("")}
        </div>
        <div style="font-family:'Bebas Neue','Anton',sans-serif;color:var(--blwhite);font-size:1.4rem;letter-spacing:2px;margin:1rem 0 .35rem 0">NFC DIVISIONS</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">
          ${nfcDivs.map(renderDivisionTable).join("")}
        </div>
      </div>
    </div>`;
}

// ── BSPN LEAGUE LEADERS PAGE ───────────────────────────────────────────────
// Top-10 leaders league-wide for the current season in: passing yards,
// Aggregate a player's season stats across all team buckets — handles traded
// players whose games are split across two team entries in franchise.seasonStats.
function _playerSeasonStatsAgg(name) {
  const agg = {};
  for (const players of Object.values(franchise.seasonStats || {})) {
    const entry = players[name];
    if (!entry) continue;
    for (const [k, v] of Object.entries(entry)) {
      if (typeof v === "number") agg[k] = (agg[k] || 0) + v;
      else if (!agg[k]) agg[k] = v;
    }
  }
  return Object.keys(agg).length ? agg : null;
}

// passing TDs, rushing yards, rushing TDs, receiving yards, receiving TDs,
// sacks, tackles, INTs, FG made. Built from franchise.seasonStats which
// already aggregates per-player numeric totals across played games.
function renderFrnLeaders(tab) {
  frnHoverTipHide(); _frnHoverTipPgHide && _frnHoverTipPgHide();
  const myId = franchise.chosenTeamId;
  // Flatten every player + team into a single list with team context,
  // aggregating across buckets so traded players show full-season totals.
  const seen = new Set();
  const all = [];
  for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
    const tid = Number(tidStr);
    const team = getTeam(tid);
    if (!team) continue;
    for (const [name, p] of Object.entries(players || {})) {
      if (seen.has(name)) continue; // already added via aggregation
      seen.add(name);
      const agg = _playerSeasonStatsAgg(name);
      // Find current team for display (where the player is on the live roster)
      let currentTeam = team;
      for (const t of TEAMS) {
        if ((franchise.rosters[t.id] || []).some(r => r.name === name)) { currentTeam = getTeam(t.id) || team; break; }
      }
      all.push({ ...agg, _teamId: currentTeam.id, _team: currentTeam });
    }
  }
  const cats = [
    { id: "passing",   label: "PASSING YARDS",  key: "pass_yds",  scope: "QB",
      extra: r => `${r.pass_td||0} TD · ${r.pass_int||0} INT` },
    { id: "passingTd", label: "PASSING TDs",    key: "pass_td",   scope: "QB",
      extra: r => `${r.pass_yds||0} YDS` },
    { id: "rushing",   label: "RUSHING YARDS",  key: "rush_yds",  scope: "RB",
      extra: r => `${r.rush_att||0} CAR · ${r.rush_td||0} TD` },
    { id: "rushingTd", label: "RUSHING TDs",    key: "rush_td",   scope: "RB",
      extra: r => `${r.rush_yds||0} YDS` },
    { id: "receiving", label: "RECEIVING YARDS",key: "rec_yds",   scope: ["WR","TE"],
      extra: r => `${r.rec||0} REC · ${r.rec_td||0} TD` },
    { id: "receivingTd", label: "RECEIVING TDs",key: "rec_td",    scope: ["WR","TE"],
      extra: r => `${r.rec_yds||0} YDS` },
    { id: "sacks",     label: "SACKS",          key: "sk",        scope: ["DL","LB","CB","S"],
      extra: r => `${r.tkl||0} TKL` },
    { id: "tackles",   label: "TACKLES",        key: "tkl",       scope: ["LB","S","CB","DL"],
      extra: r => `${r.sk||0} SK · ${r.int_made||0} INT` },
    { id: "ints",      label: "INTERCEPTIONS",  key: "int_made",  scope: ["CB","S","LB"],
      extra: r => `${r.pd||0} PD · ${r.tkl||0} TKL` },
    { id: "fg",        label: "FIELD GOALS",    key: "fg_made",   scope: "K",
      extra: r => `${r.fg_att||0} ATT · LNG ${r.fg_long||0}` },
    { id: "fgPct",     label: "FG ACCURACY",    key: "_fgPct",    scope: "K",
      derive: r => (r.fg_att||0) >= 10 ? Math.round(((r.fg_made||0)/r.fg_att)*1000)/10 : 0,
      extra: r => `${r.fg_made||0}/${r.fg_att||0}${(r.fg_att||0)>=10?"":" (need 10+ att)"}`,
      formatVal: v => v ? `${v.toFixed(1)}%` : "—" },
    { id: "krYds",     label: "KICK RETURN YARDS", key: "kr_yds", scope: ["WR","RB","CB","S"],
      extra: r => `${r.kr_td||0} TD` },
    { id: "prYds",     label: "PUNT RETURN YARDS", key: "pr_yds", scope: ["WR","RB","CB","S"],
      extra: r => `${r.pr_td||0} TD` },
    { id: "pancakes",  label: "PANCAKE BLOCKS", key: "pancakes",  scope: ["OL","LT","LG","C","RG","RT"],
      extra: r => `${r.sacks_allowed||0} SA` },
    { id: "sacksAllowed", label: "SACKS ALLOWED (OL)", key: "sacks_allowed", scope: ["OL","LT","LG","C","RG","RT"],
      extra: r => `${r.pancakes||0} pancakes`, sortAsc: true },
  ];
  const activeTab = tab && cats.find(c => c.id === tab) ? tab : cats[0].id;
  const cat = cats.find(c => c.id === activeTab) || cats[0];
  const scopeMatches = pos => Array.isArray(cat.scope) ? cat.scope.includes(pos) : cat.scope === pos;
  const _catValue = r => cat.derive ? cat.derive(r) : (r[cat.key] || 0);
  const filtered = all.filter(r => scopeMatches(r.pos) && _catValue(r) > 0);
  filtered.sort((a, b) => cat.sortAsc
    ? _catValue(a) - _catValue(b)
    : _catValue(b) - _catValue(a));
  const top10 = filtered.slice(0, 10);

  const tabBar = cats.map(c =>
    `<button class="bspnlive-nav-item ${c.id === activeTab ? "active" : ""}"
       style="background:transparent;border:0;font-family:inherit;cursor:pointer;padding:0;${c.id===activeTab?"color:var(--blwhite)":""}"
       onclick="renderFrnLeaders('${c.id}')">[${c.label}]</button>`
  ).join(" ");

  const rows = top10.length ? top10.map((r, i) => {
    const isMine = r._teamId === myId;
    return `<tr ${isMine ? `style="background:rgba(245,197,66,0.08)"` : ""}>
      <td style="color:var(--blgold);font-weight:900;width:2rem;text-align:center;font-family:'Bebas Neue','Anton',sans-serif;font-size:1.1rem">${i + 1}</td>
      <td>
        <span style="font-family:'Bebas Neue','Anton',sans-serif;letter-spacing:1px;font-size:1rem;color:${isMine?"var(--blgold)":"var(--blwhite)"}">${_playerLinkSmart(r.name)}</span>
        <span style="color:${r._team.primary};font-weight:700;margin-left:.45rem;font-size:.7rem">${r._team.abbr || r._team.name.slice(0,3).toUpperCase()}</span>
        <span style="color:var(--blgray);font-size:.6rem;margin-left:.4rem">${r.pos}</span>
      </td>
      <td style="text-align:right;font-family:'Anton','Teko','Impact',sans-serif;font-size:1.5rem;line-height:1;font-weight:900;color:var(--blwhite)">${cat.formatVal ? cat.formatVal(_catValue(r)) : _catValue(r)}</td>
      <td style="text-align:right;color:var(--blgray);font-size:.65rem;letter-spacing:.4px;padding-left:.7rem">${cat.extra(r)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="4" style="color:var(--blgray);font-style:italic;text-align:center;padding:1.5rem">No qualifying players yet — sim more games.</td></tr>`;

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">LEAGUE LEADERS · SEASON ${franchise.season}</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("STATS")}</nav>
      </header>
      <div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:.55rem;flex-wrap:wrap;align-items:center">
        <button class="bspn-back" onclick="showFranchiseDashboard()">‹ Return to Main Screen</button>
        ${tabBar}
      </div>
      <div style="padding:.5rem 1.4rem;border-bottom:1px solid var(--blborder);color:var(--blgray);font-size:.7rem;letter-spacing:.5px">
        Week ${Math.min(franchise.week, FRANCHISE_WEEKS)} of ${FRANCHISE_WEEKS} · Top 10 in ${cat.label.toLowerCase()}
      </div>
      <div style="padding:1rem 1.4rem">
        <section class="bspn-panel" style="padding:.7rem 1rem">
          <div class="bspn-panel-title" style="color:var(--blgold);font-size:.85rem;letter-spacing:2px">${cat.label}</div>
          <table style="width:100%;border-collapse:collapse">
            <tbody>${rows}</tbody>
          </table>
        </section>
      </div>
    </div>`;
}

function renderFrnLegacy(tab) {
  frnHoverTipHide(); _frnHoverTipPgHide && _frnHoverTipPgHide();
  tab = tab || "champions";
  const tabs = [
    { id:"champions",   label:"🏆 CHAMPIONS" },
    { id:"hof",         label:"🏛 HALL OF FAME" },
    { id:"career",      label:"📚 CAREER LEADERS" },
    { id:"season",      label:"📊 SINGLE-SEASON" },
    { id:"records",     label:"📖 RECORD BOOK" },
    { id:"awards",      label:"⭐ AWARDS HISTORY" },
  ];
  const tabHtml = tabs.map(t =>
    `<button class="frn-ana-tab ${t.id===tab?"active":""}" onclick="renderFrnLegacy('${t.id}')">${t.label}</button>`
  ).join("");

  let body = "";
  if (tab === "champions") body = _legacyChampions();
  else if (tab === "hof") body = _legacyHOF();
  else if (tab === "career") body = _legacyCareer();
  else if (tab === "season") body = _legacySeason();
  else if (tab === "records") body = _legacyRecordBook();
  else if (tab === "awards") body = _legacyAwards();

  // BSPN broadcast chrome for the legacy/awards page — typography +
  // nav match the standings + leaders pages so the "watch the
  // league" surface feels cohesive across screens.
  const navHtml = tabs.map(t => `
    <button class="bspnlive-nav-item ${t.id===tab?"active":""}"
      style="background:transparent;border:0;font-family:inherit;cursor:pointer;padding:0;${t.id===tab?"color:var(--blwhite)":""}"
      onclick="renderFrnLegacy('${t.id}')">[${t.label}]</button>
  `).join(" ");

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">LEGACY · ${franchise.season} SEASON${franchise.season===1?"":"S"}</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("LEGACY")}</nav>
      </header>
      <div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:.55rem;flex-wrap:wrap;align-items:center">
        <button class="bspn-back" onclick="showFranchiseDashboard()">‹ Return to Main Screen</button>
        ${navHtml}
      </div>
      <div style="padding:1rem 1.4rem">
        <section class="bspn-panel" style="padding:.8rem 1rem;background:var(--blbg2)">
          ${body}
        </section>
      </div>
    </div>`;
}

function _legacyChampions() {
  const history = (franchise.history || []).slice().reverse();
  if (!history.length) return `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center;font-style:italic">No champion crowned yet — finish a season to start the record book.</div>`;
  return `<table class="frn-ana-table"><thead>
    <tr><th>Season</th><th>Champion</th><th>League MVP</th><th>SB MVP</th><th>Coach</th></tr>
  </thead><tbody>
    ${history.map(h => {
      const champTeam = getTeam(h.champion);
      // Find coach who was with the team that season (best-effort: current coach if still there)
      const hc = franchise.coaches?.[h.champion]?.hc;
      return `<tr>
        <td style="color:var(--gold);font-weight:700">S${h.season}</td>
        <td style="font-weight:700">${champTeam ? teamLink(champTeam) : "?"}</td>
        <td>${h.leagueMVP ? _playerLinkSmart(h.leagueMVP.name) + ` <span style="color:var(--gray);font-size:.62rem">(${h.leagueMVP.pos})</span>` : "—"}</td>
        <td>${h.superBowlMVP ? _playerLinkSmart(h.superBowlMVP.name) : "—"}</td>
        <td style="color:var(--gray);font-size:.66rem">${hc?.name || "—"}</td>
      </tr>`;
    }).join("")}
  </tbody></table>`;
}

function _legacyHOF() {
  const list = (franchise.hallOfFame || []).slice();
  const eligible = (franchise._hofEligible || []).slice();
  if (!list.length && !eligible.length) return `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center;font-style:italic">The Hall of Fame opens with the first elite retirement.</div>`;
  const _renderInductee = (h) => {
    const cs = h.careerStats || {};
    const yrs = h.careerYears ?? h.careerHistory?.length ?? 0;
    let highlights = "";
    if (h.pos === "QB") highlights = `${cs.pass_yds||0} yds · ${cs.pass_td||0} TD · ${cs.pass_int||0} INT`;
    else if (h.pos === "RB") highlights = `${cs.rush_yds||0} rush yds · ${cs.rush_td||0} TD`;
    else if (h.pos === "WR" || h.pos === "TE") highlights = `${cs.rec||0} rec · ${cs.rec_yds||0} yds · ${cs.rec_td||0} TD`;
    else if (h.pos === "DL" || h.pos === "LB") highlights = `${cs.tkl||0} tkl · ${cs.sk||0} sk · ${cs.ff||0} FF`;
    else if (h.pos === "CB" || h.pos === "S") highlights = `${cs.int_made||0} INT · ${cs.pd||0} PD · ${cs.tkl||0} tkl`;
    else if (h.pos === "K") highlights = `${cs.fg_made||0} FG (long ${cs.fg_long||0}) · ${cs.xp_made||0} XP`;
    else if (["OL","LT","LG","C","RG","RT"].includes(h.pos)) highlights = `${cs.pancakes||0} pancakes · ${cs.sacks_allowed||0} sacks allowed`;
    const a = h.accolades || {};
    const accChips = [
      (a.mvps    || 0) > 0 ? `${a.mvps}× MVP` : "",
      (a.sbRings || 0) > 0 ? `${a.sbRings}× 💍` : "",
      (a.allPros || 0) > 0 ? `${a.allPros}× All-Pro` : "",
      (a.proBowls|| 0) > 0 ? `${a.proBowls}× PB`    : "",
    ].filter(Boolean).join(" · ");
    const fbBadge = h.firstBallot
      ? `<span style="color:var(--gold);font-weight:900;font-size:.52rem;letter-spacing:1px;background:rgba(200,169,0,.15);padding:.08rem .35rem;border:1px solid var(--gold);margin-left:.4rem">FIRST BALLOT</span>`
      : (h.yearsOnBallot && h.yearsOnBallot > 1)
        ? `<span style="color:var(--gray);font-size:.55rem;margin-left:.4rem">Yr ${h.yearsOnBallot}</span>`
        : "";
    const voteBadge = h.votePct
      ? `<span style="color:var(--gray);font-size:.58rem;margin-left:.4rem">${h.votePct}%</span>`
      : "";
    return `<div class="frn-hof-row">
      <div style="font-size:1.6rem;color:var(--gold)">🏛</div>
      <div style="flex:1">
        <div style="font-weight:900;font-size:.95rem">${h.name}
          <span style="color:var(--gray);font-size:.62rem;font-weight:400">(${h.pos})</span>${fbBadge}${voteBadge}
        </div>
        <div style="color:var(--gray);font-size:.66rem">${h.teamName} · ${yrs} season${yrs===1?"":"s"} · enshrined S${h.classSeason || h.season} · $${(h.careerEarnings||0).toFixed(1)}M career</div>
        ${accChips ? `<div style="color:var(--gold);font-size:.62rem;margin-top:.1rem">${accChips}</div>` : ""}
        <div style="color:var(--gold-lt);font-size:.66rem;margin-top:.1rem">${highlights}</div>
      </div>
    </div>`;
  };
  // Group by class season (newest first); legacy entries with no
  // classSeason cluster under their enshrinement season.
  const byClass = {};
  for (const h of list) {
    const k = h.classSeason ?? h.season ?? 0;
    (byClass[k] ||= []).push(h);
  }
  const classKeys = Object.keys(byClass).map(Number).sort((a,b) => b - a);
  const classBlocks = classKeys.map(season => {
    const klass = byClass[season];
    return `<div style="margin-bottom:1rem">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.4rem;padding-bottom:.3rem;border-bottom:1px solid var(--blborder)">
        <div style="font-family:'Bebas Neue','Anton',sans-serif;color:var(--gold);font-size:1.2rem;letter-spacing:2px">CLASS OF S${season}</div>
        <div style="color:var(--gray);font-size:.6rem;letter-spacing:.5px">${klass.length} inductee${klass.length===1?"":"s"}</div>
      </div>
      ${klass.map(_renderInductee).join("")}
    </div>`;
  }).join("");
  // Active ballot — candidates eligible but not yet inducted
  const ballotBlock = eligible.length ? (() => {
    const visible = eligible
      .filter(c => franchise.season >= (c.firstEligible || (c.retiredSeason + 1)))
      .map(c => ({ c, voteScore: (c.baseScore || 0) - Math.max(0, ((c.yearsOnBallot || 0) - 0)) * 2 }))
      .sort((a, b) => b.voteScore - a.voteScore)
      .slice(0, 12);
    if (!visible.length) return "";
    return `<div style="margin-top:1.2rem;padding-top:.6rem;border-top:1px dashed var(--blborder)">
      <div style="font-family:'Bebas Neue','Anton',sans-serif;color:var(--gray);font-size:1rem;letter-spacing:2px;margin-bottom:.4rem">ON THE BALLOT (top 12)</div>
      <div style="font-size:.6rem;color:var(--gray);margin-bottom:.4rem">Threshold to induct: ${_HOF_INDUCT_THRESHOLD}. Max class size: ${_HOF_MAX_CLASS}/yr. Candidates drop after ${_HOF_MAX_BALLOT_YEARS} years on ballot.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.3rem">
        ${visible.map(({ c, voteScore }) => `
          <div style="padding:.35rem .5rem;background:rgba(255,255,255,.03);border-left:2px solid ${voteScore >= _HOF_INDUCT_THRESHOLD ? "var(--gold)" : "var(--gray)"};font-size:.62rem">
            <span style="font-weight:700;color:var(--blwhite)">${c.name}</span>
            <span style="color:var(--gray)"> (${c.pos}) · score ${Math.round(voteScore)} · yr ${c.yearsOnBallot || 0}</span>
          </div>
        `).join("")}
      </div>
    </div>`;
  })() : "";
  return `${classBlocks || `<div style="color:var(--gray);font-size:.78rem;padding:.4rem;font-style:italic">No class enshrined yet — first vote runs after the first retirement wave.</div>`}${ballotBlock}`;
}

function _allKnownPlayers() {
  // Active rosters + HOF (HOF entries hold their final stats)
  const out = [];
  for (const roster of Object.values(franchise.rosters || {})) {
    for (const p of roster) out.push({
      name: p.name, pos: p.position, careerStats: p.careerStats || {}, isHOF: false, _live: p,
    });
  }
  for (const h of (franchise.hallOfFame || [])) {
    // Skip dupes (shouldn't happen — retired players are removed from roster)
    if (out.some(x => x.name === h.name)) continue;
    out.push({ name: h.name, pos: h.pos, careerStats: h.careerStats || {}, isHOF: true });
  }
  return out;
}

function _legacyCareer() {
  const all = _allKnownPlayers();
  if (!all.length || all.every(p => Object.keys(p.careerStats).length === 0)) {
    return `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center;font-style:italic">No career stats accumulated yet. Play through your first season.</div>`;
  }
  const cats = [
    { label:"PASSING YARDS",    key:"pass_yds",  posFilter:p => p.pos === "QB" },
    { label:"PASSING TDs",      key:"pass_td",   posFilter:p => p.pos === "QB" },
    { label:"RUSHING YARDS",    key:"rush_yds",  posFilter:p => p.pos === "RB" || p.pos === "QB" },
    { label:"RUSHING TDs",      key:"rush_td",   posFilter:p => p.pos === "RB" || p.pos === "QB" },
    { label:"RECEIVING YARDS",  key:"rec_yds",   posFilter:p => p.pos === "WR" || p.pos === "TE" || p.pos === "RB" },
    { label:"RECEIVING TDs",    key:"rec_td",    posFilter:p => p.pos === "WR" || p.pos === "TE" || p.pos === "RB" },
    { label:"SACKS",            key:"sk",        posFilter:p => p.pos === "DL" || p.pos === "LB" },
    { label:"TACKLES",          key:"tkl",       posFilter:p => ["DL","LB","CB","S"].includes(p.pos) },
    { label:"INTERCEPTIONS",    key:"int_made",  posFilter:p => ["CB","S","LB"].includes(p.pos) },
    { label:"FIELD GOALS",      key:"fg_made",   posFilter:p => p.pos === "K" },
    { label:"PANCAKE BLOCKS",   key:"pancakes",  posFilter:p => ["OL","LT","LG","C","RG","RT"].includes(p.pos) },
  ];
  return cats.map(c => {
    const list = all
      .filter(p => c.posFilter(p) && (p.careerStats[c.key] || 0) > 0)
      .sort((a,b) => (b.careerStats[c.key]||0) - (a.careerStats[c.key]||0))
      .slice(0, 10);
    if (!list.length) return "";
    return `<div class="frn-pg-card" style="margin-bottom:.5rem">
      <div class="frn-pg-card-title">${c.label}</div>
      <table class="frn-ana-table">
        <thead><tr><th>#</th><th>Player</th><th>${c.label}</th></tr></thead>
        <tbody>${list.map((p,i) => `<tr>
          <td style="color:var(--gold)">${i+1}</td>
          <td>${_playerLinkSmart(p.name)} ${p.isHOF?'<span style="color:var(--gold);font-size:.55rem">🏛</span>':''} <span style="color:var(--gray);font-size:.6rem">(${p.pos})</span></td>
          <td style="color:var(--gold-lt);font-weight:700">${p.careerStats[c.key] || 0}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>`;
  }).join("");
}

function _legacySeason() {
  // Collect every (player, season) row from active careerHistory + HOF snapshots
  const rows = [];
  for (const roster of Object.values(franchise.rosters || {})) {
    for (const p of roster) {
      for (const r of (p.careerHistory || [])) {
        rows.push({ name: p.name, pos: p.position, ...r });
      }
    }
  }
  for (const h of (franchise.hallOfFame || [])) {
    for (const r of (h.careerHistory || [])) {
      rows.push({ name: h.name, pos: h.pos, ...r });
    }
  }
  if (!rows.length) {
    return `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center;font-style:italic">Single-season records appear once you've completed a season.</div>`;
  }
  const cats = [
    { label:"PASSING YARDS (SEASON)",   key:"pass_yds" },
    { label:"PASSING TDs (SEASON)",     key:"pass_td" },
    { label:"RUSHING YARDS (SEASON)",   key:"rush_yds" },
    { label:"RECEIVING YARDS (SEASON)", key:"rec_yds" },
    { label:"SACKS (SEASON)",           key:"sk" },
    { label:"INTERCEPTIONS (SEASON)",   key:"int_made" },
    { label:"PANCAKE BLOCKS (SEASON)",  key:"pancakes" },
  ];
  return cats.map(c => {
    const list = rows.filter(r => (r[c.key]||0) > 0)
      .sort((a,b) => (b[c.key]||0) - (a[c.key]||0))
      .slice(0, 10);
    if (!list.length) return "";
    return `<div class="frn-pg-card" style="margin-bottom:.5rem">
      <div class="frn-pg-card-title">${c.label}</div>
      <table class="frn-ana-table">
        <thead><tr><th>#</th><th>Player</th><th>Season</th><th>Team</th><th>${c.label.split(" (")[0]}</th></tr></thead>
        <tbody>${list.map((r,i) => `<tr>
          <td style="color:var(--gold)">${i+1}</td>
          <td>${_playerLinkSmart(r.name)} <span style="color:var(--gray);font-size:.6rem">(${r.pos})</span></td>
          <td>S${r.season}</td>
          <td style="color:var(--gray);font-size:.66rem">${r.teamName || "—"}</td>
          <td style="color:var(--gold-lt);font-weight:700">${r[c.key] || 0}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>`;
  }).join("");
}

function _legacyRecordBook() {
  const rec = franchise.records || {};
  const sg = rec.singleGame || {};
  const ss = rec.singleSeason || {};
  if (!Object.keys(sg).length && !Object.keys(ss).length) {
    return `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center;font-style:italic">The record book is empty. Play through a season to start the books.</div>`;
  }

  const renderRow = (def, entry, isSingleGame) => {
    if (!entry) return "";
    const t = entry.teamId ? getTeam(entry.teamId) : null;
    const opp = isSingleGame && entry.oppId ? getTeam(entry.oppId) : null;
    return `<tr>
      <td style="color:var(--gold);font-weight:700">${def.label}</td>
      <td style="font-family:'Anton','Teko','Impact',sans-serif;font-size:1.3rem;color:var(--gold-lt);font-weight:900">${entry.value}</td>
      <td>${_playerLinkSmart(entry.playerName)} <span style="color:var(--gray);font-size:.6rem">(${entry.pos})</span></td>
      <td style="color:var(--gray);font-size:.66rem">${t ? `${t.city} ${t.name}` : "—"}</td>
      <td style="color:var(--gray);font-size:.66rem">S${entry.season}${isSingleGame ? ` · W${entry.week}` : ""}${opp ? ` · vs ${opp.name}` : ""}${entry.isPlayoff ? " · (PO)" : ""}</td>
    </tr>`;
  };

  const buildTable = (title, source, isSingleGame) => {
    const rows = _RECORD_CATS
      .filter(def => isSingleGame ? true : def.key !== "fg_long")
      .map(def => renderRow(def, source[def.key], isSingleGame))
      .filter(Boolean)
      .join("");
    if (!rows) return "";
    return `<div class="frn-pg-card" style="margin-bottom:.6rem">
      <div class="frn-pg-card-title">${title}</div>
      <table class="frn-ana-table">
        <thead><tr><th>Record</th><th>Value</th><th>Holder</th><th>Team</th><th>When</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  };

  return `${buildTable("📖 SINGLE-GAME RECORDS", sg, true)}
          ${buildTable("📅 SINGLE-SEASON RECORDS", ss, false)}`;
}

function _legacyAwards() {
  const history = (franchise.history || []).slice().reverse();
  if (!history.length) return `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center;font-style:italic">No awards handed out yet.</div>`;
  return `<table class="frn-ana-table"><thead>
    <tr><th>Season</th><th>League MVP</th><th>SB MVP</th><th>Champ-Team MVP</th></tr>
  </thead><tbody>
    ${history.map(h => `<tr>
      <td style="color:var(--gold);font-weight:700">S${h.season}</td>
      <td>${h.leagueMVP ? `${_playerLinkSmart(h.leagueMVP.name)} <span style="color:var(--gray);font-size:.62rem">(${h.leagueMVP.pos}, ${h.leagueMVP.teamName})</span>` : "—"}</td>
      <td>${h.superBowlMVP ? `${_playerLinkSmart(h.superBowlMVP.name)} <span style="color:var(--gray);font-size:.62rem">(${h.superBowlMVP.pos})</span>` : "—"}</td>
      <td>${h.champTeamMVP ? `${_playerLinkSmart(h.champTeamMVP.name)} <span style="color:var(--gray);font-size:.62rem">(${h.champTeamMVP.pos})</span>` : "—"}</td>
    </tr>`).join("")}
  </tbody></table>`;
}

// ── Coaches view + hire/fire ──────────────────────────────────────────────────
function renderFrnCoaches() {
  frnHoverTipHide(); _frnHoverTipPgHide && _frnHoverTipPgHide();
  if (!franchise.coaches) _initCoachingStaff();
  if (!franchise._coachingFAs) franchise._coachingFAs = [
    _rollCoach(), _rollCoach(), _rollCoach(), _rollCoach()
  ];
  const myId = franchise.chosenTeamId;
  const myHc = franchise.coaches[myId]?.hc;
  const myTeam = getTeam(myId);

  const traitDesc = key => COACH_TRAITS.find(t => t.key === key)?.desc || "";

  const leagueRows = TEAMS.map(t => {
    const hc = franchise.coaches[t.id]?.hc;
    const isMe = t.id === myId;
    return `<tr style="${isMe?"background:rgba(200,169,0,0.10)":""}">
      <td style="font-weight:${isMe?700:400}">${teamLink(t)}</td>
      <td>${hc?.name || "—"}</td>
      <td style="color:var(--gold);font-size:.66rem">${hc?.specialtyTrait || hc?.trait || "—"}</td>
      <td style="color:var(--gray)">${hc?.age || "?"}</td>
      <td style="color:var(--gray);font-size:.65rem">${hc?.yearsWithTeam ?? 0}yr</td>
      <td>${hc?.record?.w || 0}-${hc?.record?.l || 0}${hc?.record?.championships ? " · 🏆"+hc.record.championships : ""}</td>
    </tr>`;
  }).join("");

  const fasHtml = franchise._coachingFAs.map((c, i) => `
    <div class="frn-coach-fa">
      <div style="flex:1">
        <div style="font-weight:700">${c.name}</div>
        <div style="color:var(--gray);font-size:.66rem">Age ${c.age} · <span style="color:var(--gold)">${c.trait}</span></div>
        <div style="color:var(--gray);font-size:.6rem">${traitDesc(c.trait)}</div>
      </div>
      <button class="btn btn-gold" style="font-size:.65rem;padding:.25rem .65rem"
        onclick="frnHireCoach(${i})">Hire</button>
    </div>
  `).join("") || `<div style="color:var(--gray);font-size:.7rem;font-style:italic;padding:.4rem">No coaches on the market right now.</div>`;

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🎩 COACHING STAFF</div>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto">← Back</button>
    </div>
    <div class="frn-pg-row">
      <div class="frn-pg-card" style="flex:1">
        <div class="frn-pg-card-title">YOUR HEAD COACH · ${myTeam.name}</div>
        ${myHc ? `
          <div style="padding:.45rem 0">
            <div style="font-size:1rem;font-weight:900">${myHc.name}</div>
            <div style="color:var(--gold);font-size:.78rem;margin-top:.15rem">
              ${myHc.specialtyTrait || myHc.trait || "—"}
              ${myHc.cultureTrait ? `<span style="color:var(--gray);margin-left:.4rem">· ${myHc.cultureTrait}</span>` : ""}
            </div>
            ${myHc.rating != null ? `<div style="color:var(--gray);font-size:.62rem">Rating: <b>${myHc.rating}</b></div>` : ""}
            <div style="color:var(--gray);font-size:.66rem;margin-top:.3rem">
              Age ${myHc.age} · ${myHc.yearsWithTeam}yr with team · Record ${myHc.record.w}-${myHc.record.l}
              ${myHc.record.championships ? " · 🏆 "+myHc.record.championships : ""}
            </div>
          </div>
          <button class="btn btn-outline" onclick="frnFireCoach()" style="color:var(--red);font-size:.65rem;padding:.25rem .65rem">
            ✗ Fire coach (forfeit experience)
          </button>
          <button class="btn btn-outline" onclick="renderFrnCoachingStaff()" style="font-size:.65rem;padding:.25rem .65rem;margin-top:.3rem">
            View Full Staff
          </button>` : `<div style="color:var(--gray);font-style:italic">No head coach. Hire from free agents below.</div>`}
      </div>
      <div class="frn-pg-card" style="flex:1.2">
        <div class="frn-pg-card-title">FREE AGENT COACHES</div>
        ${fasHtml}
      </div>
    </div>
    <div class="frn-pg-card">
      <div class="frn-pg-card-title">LEAGUE HEAD COACHES</div>
      <table class="frn-pg-totals">
        <thead><tr><th>Team</th><th>Coach</th><th>Trait</th><th>Age</th><th>Tenure</th><th>Record</th></tr></thead>
        <tbody>${leagueRows}</tbody>
      </table>
    </div>`;
}

async function frnHireCoach(idx) {
  const pool = franchise._coachingFAs || [];
  const hire = pool[idx];
  if (!hire) return;
  if (!await _frnConfirm(`Hire ${hire.name} (${hire.trait})?`)) return;
  const myId = franchise.chosenTeamId;
  const oldHc = franchise.coaches[myId]?.hc;
  if (oldHc) pool.push(oldHc); // released coach lands back on the FA market
  hire.yearsWithTeam = 0;
  franchise.coaches[myId] = { hc: hire };
  pool.splice(idx, 1);
  // Refill the pool with a fresh roll
  while (pool.length < 4) pool.push(_rollCoach());
  saveFranchise();
  renderFrnCoaches();
}

async function frnFireCoach() {
  const myId = franchise.chosenTeamId;
  const hc = franchise.coaches[myId]?.hc;
  if (!hc) return;
  if (!await _frnConfirm(`Fire ${hc.name}? They'll go back to the FA pool.`)) return;
  if (!franchise._coachingFAs) franchise._coachingFAs = [];
  franchise._coachingFAs.push(hc);
  franchise.coaches[myId] = { hc: null };
  saveFranchise();
  renderFrnCoaches();
}

// ── Alumni view — recent former players of the user's team ──────────────────
function renderFrnAlumni(yearsBackArg) {
  frnHoverTipHide(); _frnHoverTipPgHide && _frnHoverTipPgHide();
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  // Persist selection so re-renders (e.g. after profile close) keep the range.
  if (yearsBackArg !== undefined) franchise._alumniYearsBack = yearsBackArg;
  const yearsBack = franchise._alumniYearsBack ?? 3;
  const alumni = _computeAlumni(myId, yearsBack);
  const grouped = { team: [], hof: [], retired: [], unsigned: [] };
  for (const a of alumni) (grouped[a.location] || (grouped[a.location] = [])).push(a);
  const totalSnapshots = (franchise.rosterSnapshots || []).length;
  // Range options — only show options that have snapshots backing them.
  const rangeOptions = [
    { label: "Last 3", val: 3 },
    { label: "Last 5", val: 5 },
    { label: "Last 10", val: 10 },
    { label: "All-time", val: "all" },
  ];
  const rangeChips = rangeOptions.map(r => {
    const active = (yearsBack === r.val) ? "active" : "";
    // Disable options that exceed current snapshot depth (cosmetic only;
    // _computeAlumni handles the case gracefully)
    const disabled = (r.val !== "all" && r.val > totalSnapshots) ? "disabled" : "";
    return `<button class="bspnlive-nav-item ${active}"
      style="background:transparent;border:1px solid ${active?'var(--blgold)':'var(--blborder)'};border-radius:3px;font-family:inherit;cursor:${disabled?'default':'pointer'};padding:.2rem .55rem;${active?'color:var(--blwhite);font-weight:700':disabled?'color:var(--blgray);opacity:.45':''}"
      ${disabled ? "" : `onclick="renderFrnAlumni(${r.val === 'all' ? "'all'" : r.val})"`}
      >${r.label}${r.val !== 'all' && r.val > totalSnapshots ? ` <span style="font-size:.55rem">(${totalSnapshots} avail)</span>` : ""}</button>`;
  }).join("");

  const findCurrentPlayer = (name) => {
    for (const r of Object.values(franchise.rosters || {})) {
      const p = r.find(rp => rp.name === name);
      if (p) return p;
    }
    return null;
  };

  const renderEntry = (a) => {
    const live = findCurrentPlayer(a.name);
    let locationCell = "";
    if (a.location === "team" && a.currentTeam) {
      locationCell = `<span style="color:${a.currentTeam.primary};font-weight:700">→ ${a.currentTeam.city} ${a.currentTeam.name}</span>`;
    } else if (a.location === "hof") {
      locationCell = `<span style="color:var(--blgold);font-weight:700">🏛 HALL OF FAME</span>`;
    } else if (a.location === "retired") {
      locationCell = `<span style="color:var(--blgray)">Retired</span>`;
    } else {
      locationCell = `<span style="color:var(--blgray);font-style:italic">Unsigned</span>`;
    }
    return `<tr>
      <td>${_playerLinkSmart(a.name)} <span style="color:var(--blgray);font-size:.62rem">(${a.pos})</span></td>
      <td style="color:var(--blgray);font-size:.66rem">S${a.lastSeasonWithUs}</td>
      <td>${locationCell}</td>
      <td style="color:${live ? "var(--blwhite)" : "var(--blgray)"};font-size:.66rem">${live ? "Age " + (live.age || "?") : "—"}</td>
    </tr>`;
  };

  const buildSection = (label, list, color) => {
    if (!list.length) return "";
    return `<div class="frn-pg-card" style="margin-bottom:.6rem;border-left:3px solid ${color}">
      <div class="frn-pg-card-title">${label} · ${list.length}</div>
      <table class="frn-ana-table">
        <thead><tr><th>Player</th><th>Last season w/ us</th><th>Now</th><th></th></tr></thead>
        <tbody>${list.map(renderEntry).join("")}</tbody>
      </table>
    </div>`;
  };

  const body = alumni.length ? `
    ${buildSection("ON ANOTHER TEAM",      grouped.team,     "#1a5fb4")}
    ${buildSection("HALL OF FAME",         grouped.hof,      "var(--blgold)")}
    ${buildSection("RETIRED",              grouped.retired,  "#8898a8")}
    ${buildSection("CURRENTLY UNSIGNED",   grouped.unsigned, "#a0a0a0")}
  ` : `<div style="color:var(--blgray);font-size:.78rem;padding:1.5rem;text-align:center;font-style:italic">No alumni yet — players who leave your roster (trade, release, free agency, retirement) will show up here once a season has rolled over.</div>`;

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">${myTeam.city.toUpperCase()} ${myTeam.name.toUpperCase()} · ALUMNI · LAST 3 SEASONS</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("LEGACY")}</nav>
      </header>
      <div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:.55rem;flex-wrap:wrap;align-items:center">
        <button class="bspn-back" onclick="showFranchiseDashboard()">‹ Return to Main Screen</button>
        <span style="color:var(--blgray);font-size:.62rem;letter-spacing:1px;font-weight:700;margin-left:.6rem">RANGE:</span>
        <div style="display:flex;gap:.3rem;flex-wrap:wrap">${rangeChips}</div>
        <div style="color:var(--blgray);font-size:.65rem;margin-left:auto">${totalSnapshots} season snapshot${totalSnapshots===1?"":"s"} on file · cap 25</div>
      </div>
      <div style="padding:1rem 1.4rem">${body}</div>
    </div>`;
}

// ── Visual depth chart for your own team ──────────────────────────────────────
// Maps each position group to its ordered slot keys in franchise.depthChart.
// Order within slots[] defines depth order (index 0 = starter / most snaps).
const DEPTH_POS_GROUPS = [
  { pos:"QB",  label:"QUARTERBACK",    slots:["QB"],                    unit:"OFF" },
  { pos:"RB",  label:"RUNNING BACK",   slots:["RB1","RB2"],             unit:"OFF" },
  { pos:"WR",  label:"WIDE RECEIVER",  slots:["WR1","WR2","WR3","WR4"], unit:"OFF" },
  { pos:"TE",  label:"TIGHT END",      slots:["TE1","TE2"],             unit:"OFF" },
  { pos:"OL",  label:"OFFENSIVE LINE", slots:["LT","LG","C","RG","RT"], unit:"OFF" },
  { pos:"DL",  label:"DEFENSIVE LINE", slots:["DL1","DL2","DL3","DL4","DL5","DL6"], unit:"DEF" },
  { pos:"LB",  label:"LINEBACKER",     slots:["LB1","LB2","LB3"],                   unit:"DEF" },
  { pos:"CB",  label:"CORNERBACK",     slots:["CB1","CB2","NB","NB2"],              unit:"DEF" },
  { pos:"S",   label:"SAFETY",         slots:["SS","FS"],               unit:"DEF" },
  { pos:"K",   label:"KICKER",         slots:["K"],                     unit:"ST"  },
  { pos:"P",   label:"PUNTER",         slots:["P"],                     unit:"ST"  },
  { pos:"RET", label:"RETURNERS",      slots:["KR1","PR1"],             unit:"ST"  },
];

const DEPTH_UNIT_LABELS = {
  OFF: { name:"OFFENSE",        icon:"⚡", color:"var(--gold)" },
  DEF: { name:"DEFENSE",        icon:"🛡", color:"#7ac8e8" },
  ST:  { name:"SPECIAL TEAMS",  icon:"🦵", color:"#c08fff" },
  PKG: { name:"PACKAGES",       icon:"⛺", color:"#ff9a4d" },
};

// Defensive personnel packages. Each lists the 11 slots on the field.
// Most slots are SHARED with the regular depth chart (same DL1 across all
// packages), but a few are package-only (NB2 dime back, DL5/DL6 goal-line).
// In real NFL, the "base" defense varies by team scheme — here we treat
// Nickel as the de facto modern base (5 DBs, ~70% of NFL snaps).
const PERSONNEL_PACKAGES = [
  {
    key: "BASE_43",
    name: "Base 4-3",
    desc: "4 DL · 3 LB · 2 CB · 2 S — vs. heavy run looks, early downs",
    slots: ["DL1","DL2","DL3","DL4","LB1","LB2","LB3","CB1","CB2","SS","FS"],
  },
  {
    key: "NICKEL",
    name: "Nickel",
    desc: "4 DL · 2 LB · 5 DB — modern base, slot CB on the field",
    slots: ["DL1","DL2","DL3","DL4","LB1","LB2","CB1","CB2","NB","SS","FS"],
  },
  {
    key: "DIME",
    name: "Dime",
    desc: "4 DL · 1 LB · 6 DB — obvious passing downs, heavy coverage",
    slots: ["DL1","DL2","DL3","DL4","LB1","CB1","CB2","NB","NB2","SS","FS"],
  },
  {
    key: "GOAL_LINE",
    name: "Goal-line",
    desc: "6 DL · 2 LB · 3 DB — short yardage, must-stop run",
    slots: ["DL1","DL2","DL3","DL4","DL5","DL6","LB1","LB2","CB1","SS","FS"],
  },
];

let _dcActivePkg = "NICKEL";
function frnDepthSetPkg(pkgKey) {
  if (!PERSONNEL_PACKAGES.find(p => p.key === pkgKey)) return;
  _dcActivePkg = pkgKey;
  renderFrnDepthChart();
}

function _depthSlotLabel(slotKey, idx) {
  const named = {
    LT:"★ LT", LG:"★ LG", C:"★ C", RG:"★ RG", RT:"★ RT",
    SS:"★ SS", FS:"★ FS", NB:"NICKEL", NB2:"DIME ⛺",
    DL5:"GL-LINE ⛺", DL6:"GL-LINE ⛺",
    K:"★ KICKER", P:"★ PUNTER",
    KR1:"★ KICK RETURN", PR1:"★ PUNT RETURN",
    RB1:"★ RB", RB2:"#2 RB",
  };
  if (named[slotKey]) return named[slotKey];
  return idx === 0 ? "★ STARTER" : `#${idx + 1}`;
}

// Build the "if this starter is injured" cascade chain as plain text
// (uses \n for the browser's native tooltip line breaks). Walks the
// depth chart starting from slotKey: backup steps up, if backup is a
// starter elsewhere then that slot needs filling too, repeat. Stops
// when no further fill is needed or there's no replacement.
function _buildInjuryCascadeText(slotKey, dc, byPid) {
  const chain = [];
  let curKey = slotKey;
  const visited = new Set();
  while (curKey && !visited.has(curKey)) {
    visited.add(curKey);
    const slot = dc[curKey];
    if (!slot?.starter) break;
    const backupPid = slot.backup;
    const backup = backupPid ? byPid[backupPid] : null;
    if (!backup) {
      chain.push(`${curKey}: ⚠ NO BACKUP — slot empty`);
      break;
    }
    // Check if backup is a starter elsewhere (cascade)
    let cascadeFrom = null;
    for (const [otherKey, otherSlot] of Object.entries(dc)) {
      if (otherKey !== curKey && otherSlot.starter === backupPid) {
        cascadeFrom = otherKey;
        break;
      }
    }
    if (cascadeFrom) {
      chain.push(`${curKey}: ${backup.name} (OVR ${backup.overall}) moves up from ${cascadeFrom}`);
      curKey = cascadeFrom;
    } else {
      chain.push(`${curKey}: ${backup.name} (OVR ${backup.overall}) starts`);
      break;
    }
  }
  if (!chain.length) return "";
  return `If injured — cascade chain:\n${chain.join("\n")}`;
}

// Swap starters at slots[idx] and slots[idx+1] within a position group,
// then reoptimize snap shares so the engine reflects the new order.
function frnDepthSwap(posKey, idx) {
  const myId = franchise.chosenTeamId;
  const dc = franchise.depthChart?.[myId];
  if (!dc) return;
  const group = DEPTH_POS_GROUPS.find(g => g.pos === posKey);
  if (!group || idx < 0 || idx >= group.slots.length - 1) return;
  const keyA = group.slots[idx], keyB = group.slots[idx + 1];
  if (!dc[keyA] || !dc[keyB]) return;
  const tmp = dc[keyA].starter;
  dc[keyA].starter = dc[keyB].starter;
  dc[keyB].starter = tmp;
  _optimizeSnapShares(myId);
  saveFranchise();
  renderFrnDepthChart();
}

// Swap starter↔backup within a single depth chart slot.
function frnDepthSwapInSlot(slotKey) {
  const myId = franchise.chosenTeamId;
  const dc = franchise.depthChart?.[myId];
  if (!dc?.[slotKey]) return;
  const slot = dc[slotKey];
  const tmp = slot.starter;
  slot.starter = slot.backup;
  slot.backup = tmp;
  _optimizeSnapShares(myId);
  saveFranchise();
  renderFrnDepthChart();
}

// Reset the entire depth chart to OVR-sorted defaults.
function frnDepthAutoSetOVR() {
  const myId = franchise.chosenTeamId;
  if (franchise.depthChart) delete franchise.depthChart[myId];
  _initDepthChart(myId);
  saveFranchise();
  renderFrnDepthChart();
}

// Fire depth-chart auto-set from the home dashboard without navigating
// away. Re-renders the dashboard so the badge count updates inline.
function _frnDepthAutoFromHome() {
  const myId = franchise.chosenTeamId;
  if (franchise.depthChart) delete franchise.depthChart[myId];
  _initDepthChart(myId);
  saveFranchise();
  if (typeof renderFrnRegular === "function") renderFrnRegular();
}

// Set a manual snap share for a slot (locks it from the auto-optimizer).
// User can say "I want my RB committee 50/50" — that intent persists
// across roster changes, injuries, and "auto-set by OVR".
async function frnDepthSetSnapShare(slotKey) {
  const myId = franchise.chosenTeamId;
  if (!franchise.snapShares?.[myId]) return;
  const sd = franchise.snapShares[myId][slotKey] || {};
  // Guard against editing snap share for an empty slot — meaningless.
  const dc = franchise.depthChart?.[myId];
  if (!dc?.[slotKey]?.starter) {
    alert(`No starter assigned to ${slotKey} yet. Set a starter first.`);
    return;
  }
  const cur = sd.starterPct ?? 70;
  const floor = sd.snapFloor ?? dc[slotKey].snapFloor ?? 35;
  const ceil  = sd.snapCeil  ?? dc[slotKey].snapCeil  ?? 98;
  const curPlan = sd.contract;  // internal field kept for save-compat
  const curPlanStr = curPlan ? `${curPlan.mode} ${curPlan.target}` : "";
  const input = prompt(
    `Set WORKLOAD PLAN for ${slotKey}.\n\n` +
    `FORMATS:\n` +
    `  • Number (${floor}-${ceil}):  snap share %\n` +
    `  • c<n> or count <n>:           hard snap cap (e.g. "c45")\n` +
    `  • t<n> or touches <n>:         target touches (e.g. "t18")\n` +
    `  • clear:                       reset to auto\n\n` +
    `Current: ${cur}% starter${curPlanStr ? ` · plan: ${curPlanStr}` : ""}` +
    `${sd.manual ? " (manual)" : " (auto)"}.`,
    curPlanStr || String(cur)
  );
  if (input === null) return;
  const trimmed = String(input).trim().toLowerCase();
  if (trimmed === "") return;
  if (trimmed === "clear" || trimmed === "auto" || trimmed === "reset") {
    delete franchise.snapShares[myId][slotKey].manual;
    delete franchise.snapShares[myId][slotKey].contract;
    delete franchise.snapShares[myId][slotKey].autoManaged;
    delete franchise.snapShares[myId][slotKey].autoReason;
    if (typeof _optimizeSnapShares === "function") _optimizeSnapShares(myId);
    saveFranchise();
    renderFrnDepthChart();
    return;
  }
  // Try smart-contract formats
  const countMatch = trimmed.match(/^(?:c|count\s+)(\d+)$/);
  const touchesMatch = trimmed.match(/^(?:t|touches\s+)(\d+)$/);
  if (countMatch || touchesMatch) {
    const m = countMatch ? "count" : "touches";
    const tgt = parseInt((countMatch || touchesMatch)[1], 10);
    if (!Number.isFinite(tgt) || tgt < 1) { alert("Target must be a positive number."); return; }
    if (m === "count" && tgt > 80) { alert("Snap count max is 80 (one team has ~62 snaps/game)."); return; }
    if (m === "touches" && tgt > 35) { alert("Touches max is 35 (huge workload for any player)."); return; }
    franchise.snapShares[myId][slotKey] = {
      ...sd,
      starterPct: sd.starterPct ?? 80,  // keep a baseline for any share-mode fallback
      manual: true,
      contract: { mode: m, target: tgt, smart: true, flexibility: "balanced" },
    };
    saveFranchise();
    renderFrnDepthChart();
    return;
  }
  // Standard share % path
  const parsed = Math.round(Number(trimmed));
  if (!Number.isFinite(parsed)) {
    alert(`Couldn't parse "${input}".\nAccepted: number, c<n>, t<n>, or "clear".`);
    return;
  }
  const newPct = Math.max(floor, Math.min(ceil, parsed));
  if (newPct !== parsed) {
    if (!await _frnConfirm(`Value clamped to slot range (${floor}-${ceil}%): ${parsed}% → ${newPct}%. Continue?`)) return;
  }
  franchise.snapShares[myId][slotKey] = {
    ...sd,
    starterPct: newPct,
    manual: true,
    contract: { mode: "share", target: newPct / 100, smart: true, flexibility: "balanced" },
  };
  saveFranchise();
  renderFrnDepthChart();
}

// Set the team's auto-manage policy (ride / balanced / playoff_push).
// "ride" disables auto-manage; "balanced" trims worn starters; "playoff
// _push" aggressively rests late-season + playoffs.
function frnSetAutoManagePolicy(policy) {
  const myId = franchise.chosenTeamId;
  if (!["ride", "balanced", "playoff_push"].includes(policy)) return;
  if (!franchise.autoManagePolicy) franchise.autoManagePolicy = {};
  const prev = franchise.autoManagePolicy[myId] || "balanced";
  if (prev === policy) return;
  franchise.autoManagePolicy[myId] = policy;
  // When switching TO "ride", clear any auto-managed flags so the legacy
  // optimizer kicks in fresh.
  if (policy === "ride") {
    const ss = franchise.snapShares?.[myId] || {};
    for (const slot of Object.keys(ss)) {
      delete ss[slot].autoManaged;
      delete ss[slot].autoReason;
    }
    if (typeof _optimizeSnapShares === "function") _optimizeSnapShares(myId);
  }
  saveFranchise();
  renderFrnDepthChart();
}

// Clear manual lock — restore to optimizer-computed value.
function frnDepthResetSnapShare(slotKey) {
  const myId = franchise.chosenTeamId;
  if (!franchise.snapShares?.[myId]?.[slotKey]) return;
  delete franchise.snapShares[myId][slotKey].manual;
  _optimizeSnapShares(myId);
  saveFranchise();
  renderFrnDepthChart();
}


let _dcActiveUnit = "OFF"; // persists across re-renders (swap, promote, auto-set)
function frnDepthSetTab(unit) {
  if (!DEPTH_UNIT_LABELS[unit]) return;
  _dcActiveUnit = unit;
  renderFrnDepthChart();
}

async function renderFrnDepthChart() {
  frnHoverTipHide(); _frnHoverTipPgHide && _frnHoverTipPgHide();
  const myId   = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const roster = franchise.rosters[myId] || [];
  if (!franchise.depthChart?.[myId]) _initDepthChart(myId);
  const dc = franchise.depthChart[myId];
  const ss = franchise.snapShares?.[myId] || {};

  const byPid = {};
  for (const p of roster) if (p.pid) byPid[p.pid] = p;

  const assignedPids = new Set();
  for (const slot of Object.values(dc)) {
    if (slot.starter) assignedPids.add(slot.starter);
    if (slot.backup)  assignedPids.add(slot.backup);
  }

  // Dry-run the auto-by-OVR chart so we can flag slots whose current
  // picks differ — those cells light up and the AUTO-SET button shows
  // a count of how many slots would change.
  const autoChart = _computeAutoDepthChart(myId).dc;
  const isStarterMisplaced = (slotKey) =>
    !!(autoChart[slotKey] && dc[slotKey] && autoChart[slotKey].starter !== dc[slotKey].starter);
  const isBackupMisplaced = (slotKey) =>
    !!(autoChart[slotKey] && dc[slotKey] && autoChart[slotKey].backup !== dc[slotKey].backup);
  let autoChangedSlots = 0;
  for (const slotKey of Object.keys(autoChart)) {
    if (isStarterMisplaced(slotKey) || isBackupMisplaced(slotKey)) autoChangedSlots++;
  }

  // Map each pid → every slot it appears in (starter or backup), for cascade labels.
  const pidSlotMap = {};
  for (const [key, slot] of Object.entries(dc)) {
    const add = (pid, role) => {
      if (!pid) return;
      if (!pidSlotMap[pid]) pidSlotMap[pid] = [];
      pidSlotMap[pid].push({ key, role });
    };
    add(slot.starter, "starter");
    add(slot.backup,  "backup");
  }

  // ── Strength helpers ──────────────────────────────────────────────────────
  const _groupOVR = slots => {
    const ovrs = slots.map(k => dc[k]?.starter ? (byPid[dc[k].starter]?.overall || 60) : 0).filter(Boolean);
    return ovrs.length ? Math.round(ovrs.reduce((a,b)=>a+b,0)/ovrs.length) : 0;
  };
  const _strength = ovr => {
    if (ovr >= 82) return { label:"ELITE",  col:"#ffd700" };
    if (ovr >= 77) return { label:"STRONG", col:"#4caf82" };
    if (ovr >= 72) return { label:"SOLID",  col:"#7ac8e8" };
    if (ovr >= 65) return { label:"AVG",    col:"#e8a000" };
    if (ovr  > 0)  return { label:"THIN",   col:"#ff6b6b" };
    return              { label:"EMPTY", col:"#555"    };
  };

  // ── Player cell ───────────────────────────────────────────────────────────
  const playerCell = (p, isStarter, slotKey) => {
    const misplaced = isStarter ? isStarterMisplaced(slotKey) : isBackupMisplaced(slotKey);
    const autoPid   = autoChart[slotKey]?.[isStarter ? "starter" : "backup"];
    const autoP     = autoPid ? byPid[autoPid] : null;
    const misBadge  = (misplaced && autoP)
      ? `<span class="frn-dc-badge mis" title="AUTO-by-OVR would place ${autoP.name} (OVR ${autoP.overall}) here">⚠ ${autoP.name.split(" ").slice(-1)[0]}</span>`
      : "";
    if (!p) {
      return `<div class="frn-dc-player ${isStarter?"s1":"s2"} empty${misplaced?" misplaced":""}">
        <span class="frn-dc-rank ${isStarter?"r1":"r2"}">${isStarter?"★1":"▸2"}</span>
        <span class="frn-dc-empty">— open —</span>
        ${misBadge}
      </div>`;
    }
    const escName    = (p.name||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    const escPid     = (p.pid||"").replace(/'/g,"\\'");
    const isInjured  = (p.injury?.weeksRemaining || 0) > 0;
    const isExpiring = (p.contract?.remaining || 0) <= 1;
    const aav        = (p.contract?.aav||0).toFixed(1);
    const yrs        = p.contract?.remaining || 0;
    // Injury badge — bumped to a clear "OUT Nw" label when a starter
    // is hurt so the user can see the engine will auto-sub. Catastrophic
    // injuries (torn ACL, etc.) get a flag emoji to make it obvious.
    const isCat = isInjured && !!p.injury?._catastrophic;
    const injLabel = isInjured ? (p.injury.label || "injury") : "";
    const injBadge   = isInjured
      ? `<span class="frn-dc-badge red" title="${injLabel} — engine auto-subs the next healthy player at this position">${isCat ? "🚑" : "🚫"} OUT ${p.injury.weeksRemaining}w</span>` : "";
    const expBadge   = isExpiring
      ? `<span class="frn-dc-badge exp">EXP</span>` : "";
    const blkBadge   = p.onTradeBlock
      ? `<span class="frn-dc-badge blk">BLK</span>` : "";
    const potTag     = potentialTag(p, { known: true });
    const potBadge   = potTag
      ? `<span class="frn-dc-badge pot">${potTag}</span>` : "";

    // Archetype badge — shows the player's role (e.g., "Slot CB", "Deep
    // Threat") with a ✓ if it naturally fits this slot. The fit check
    // mirrors the auto-set's archetype bonus, so the badge tells the user
    // "this assignment makes sense scheme-wise" without hiding the data.
    const archLabel = _archetypeLabel(p);
    const archFits  = archLabel && _slotFitsArchetype(p, slotKey);
    const _esc = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const archBadge = archLabel
      ? `<span class="frn-dc-badge arch${archFits?" fit":""}" title="${_esc(archFits?"Archetype fits "+slotKey:"Archetype is "+archLabel)}">${archFits?"✓ ":""}${_esc(archLabel)}</span>`
      : "";

    // Cascade badge: if this player is also a starter in another slot, show it.
    // e.g. WR1 backup row shows "(WR2)" because that player is the WR2 starter.
    const allSlots    = pidSlotMap[p.pid] || [];
    const starterElsewhere = allSlots.find(e => e.key !== slotKey && e.role === "starter");
    const cascadeBadge = (!isStarter && starterElsewhere)
      ? `<span class="frn-dc-badge cascade" title="This player is ${starterElsewhere.key} starter — slides up on injury">⤴ ${starterElsewhere.key}</span>` : "";
    // If cascade, suppress the promote button (they're already a starter elsewhere)
    const isCascade   = !isStarter && !!starterElsewhere;
    const promoteBtn  = (!isStarter && !isCascade)
      ? `<button class="frn-dc-promote" onclick="event.stopPropagation();frnDepthSwapInSlot('${slotKey}')" title="Make starter">▲</button>` : "";

    const rankLabel = isStarter ? "★1" : (isCascade ? "⤴" : "▸2");
    const rankClass = isStarter ? "r1"  : (isCascade ? "rc" : "r2");

    // Injury cascade tooltip — only on starters. Shows the chain of
    // replacements if this player gets hurt (helps user spot fragile
    // positions where a single injury would cascade badly).
    const cascadeTitle = isStarter
      ? _buildInjuryCascadeText(slotKey, dc, byPid)
      : "";
    const titleAttr = cascadeTitle
      ? ` title="${cascadeTitle.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`
      : "";
    return `<div class="frn-dc-player ${isStarter?"s1":isCascade?"sc":"s2"}${isInjured?" injured":""}${misplaced?" misplaced":""}"${titleAttr}>
      <span class="frn-dc-rank ${rankClass}">${rankLabel}</span>
      ${gradeBadge(p)}
      <span class="frn-dc-name" onclick="frnOpenPlayerCard('${escName}','${escPid}')">${p.name}</span>
      <span class="frn-dc-meta">${p.age} · $${aav}M · ${yrs}yr</span>
      ${archBadge}${cascadeBadge}${injBadge}${expBadge}${blkBadge}${potBadge}${misBadge}
      ${promoteBtn}
    </div>`;
  };

  // ── Snap bar ──────────────────────────────────────────────────────────────
  const snapBar = (slotKey) => {
    const sd  = ss[slotKey];
    const pct = sd?.starterPct ?? 70;
    const isManual = !!sd?.manual;
    const plan = sd?.contract;  // workload plan (internal field name)
    const autoReason = sd?.autoReason;
    // For manual overrides, backup gets the full remainder (1:1 split).
    // For auto, the 0.55 multiplier accounts for cascade to 3rd-string.
    const bPct = isManual
      ? Math.max(0, 100 - pct)
      : Math.max(5, Math.round((100 - pct) * 0.55));
    const lockIcon = isManual
      ? `<span class="frn-dc-snap-lock" title="Manual override (locked) — click 🔒 to reset to auto" onclick="event.stopPropagation();frnDepthResetSnapShare('${slotKey}')">🔒</span>`
      : "";
    // Workload plan badge — show mode for non-share plans
    let planBadge = "";
    if (plan && plan.mode === "count") {
      planBadge = `<span class="frn-dc-plan-badge" style="position:absolute;top:2px;right:2px;background:#3a4d5f;color:#fff;font-size:.5rem;padding:.05rem .2rem;border-radius:2px;letter-spacing:.5px;font-weight:700" title="Snap count cap: ${plan.target} snaps">c${plan.target}</span>`;
    } else if (plan && plan.mode === "touches") {
      planBadge = `<span class="frn-dc-plan-badge" style="position:absolute;top:2px;right:2px;background:#5f3a4d;color:#fff;font-size:.5rem;padding:.05rem .2rem;border-radius:2px;letter-spacing:.5px;font-weight:700" title="Touch target: ${plan.target}">t${plan.target}</span>`;
    }
    // Auto-manage reason annotation
    let autoBadge = "";
    if (autoReason && autoReason !== "fresh") {
      const isRest = autoReason.startsWith("REST");
      const color = isRest ? "#e6373a" : "#f0a93a";
      autoBadge = `<span style="position:absolute;bottom:18px;left:2px;color:${color};font-size:.48rem;letter-spacing:.4px;font-weight:700;text-transform:uppercase;line-height:1;pointer-events:none" title="Auto-manage: ${autoReason}">${isRest ? "REST" : "MGD"}</span>`;
    }
    const titleParts = [`${pct}% starter`];
    if (plan) titleParts.push(`${plan.mode}: ${plan.target}`);
    if (autoReason) titleParts.push(`auto: ${autoReason}`);
    return `<div class="frn-dc-snap-col${isManual?" manual":""}" style="position:relative" onclick="frnDepthSetSnapShare('${slotKey}')" title="Click to set workload plan — ${titleParts.join(' · ')}">
      ${lockIcon}
      ${planBadge}
      ${autoBadge}
      <span class="frn-dc-snap-pct s">${pct}%</span>
      <div class="frn-dc-snap-bar">
        <div class="frn-dc-snap-fill" style="height:${pct}%"></div>
      </div>
      <span class="frn-dc-snap-pct b">${bPct}%</span>
    </div>`;
  };

  // ── Control buttons ───────────────────────────────────────────────────────
  const ctrlBtn = (label, onclick, title) =>
    `<button class="frn-dc-ctrl-btn" onclick="${onclick}" title="${title}">${label}</button>`;

  // ── Group sections (split by Offense / Defense / Special Teams) ───────────
  const renderGroup = (group) => {
    const groupOvr = _groupOVR(group.slots);
    const { label: strLabel, col: strCol } = _strength(groupOvr);

    const rows = group.slots.map((slotKey, idx) => {
      const slot    = dc[slotKey];
      const starter = slot?.starter ? byPid[slot.starter] : null;
      const backup  = slot?.backup  ? byPid[slot.backup]  : null;
      const canUp   = idx > 0;
      const canDown = idx < group.slots.length - 1;
      const isEvenRow = idx % 2 === 0;

      return `<div class="frn-dc-row${isEvenRow?"":" alt"}">
        <div class="frn-dc-slot-lbl">
          <span class="frn-dc-slot-name">${slotKey}</span>
        </div>
        ${playerCell(starter, true,  slotKey)}
        ${snapBar(slotKey)}
        ${playerCell(backup,  false, slotKey)}
        <div class="frn-dc-controls">
          ${ctrlBtn("⇅", `frnDepthSwapInSlot('${slotKey}')`, "Swap #1 ↔ #2")}
          ${canUp   ? ctrlBtn("↑", `frnDepthSwap('${group.pos}',${idx-1})`, "Move slot up")   : `<span class="frn-dc-ctrl-spacer"></span>`}
          ${canDown ? ctrlBtn("↓", `frnDepthSwap('${group.pos}',${idx})`,   "Move slot down") : `<span class="frn-dc-ctrl-spacer"></span>`}
        </div>
      </div>`;
    }).join("");

    return `<div class="frn-dc-group">
      <div class="frn-dc-group-hdr" style="border-left:3px solid ${strCol}">
        <span class="frn-dc-group-pos">${group.pos}</span>
        <span class="frn-dc-group-label">${group.label}</span>
        <span class="frn-dc-group-str" style="color:${strCol};border-color:${strCol}44">${groupOvr > 0 ? groupOvr+" " : ""}${strLabel}</span>
      </div>
      ${rows}
    </div>`;
  };

  // Per-unit metrics, for both tab labels and the active unit's header.
  const unitMetrics = {};
  for (const key of Object.keys(DEPTH_UNIT_LABELS)) {
    const groups   = DEPTH_POS_GROUPS.filter(g => g.unit === key);
    const allSlots = groups.flatMap(g => g.slots);
    unitMetrics[key] = {
      ovr:       _groupOVR(allSlots),
      misplaced: allSlots.filter(k => isStarterMisplaced(k) || isBackupMisplaced(k)).length,
      groups,
    };
  }

  const tabsHtml = `<div class="frn-dc-tabs">
    ${Object.entries(DEPTH_UNIT_LABELS).map(([key, u]) => {
      const m = unitMetrics[key];
      const active = key === _dcActiveUnit;
      return `<button class="frn-dc-tab${active?" active":""}" onclick="frnDepthSetTab('${key}')" style="--unit-color:${u.color}">
        <span class="frn-dc-tab-icon">${u.icon}</span>
        <span class="frn-dc-tab-title">${u.name}</span>
        <span class="frn-dc-tab-ovr">${m.ovr || "—"}</span>
        ${m.misplaced ? `<span class="frn-dc-tab-mis" title="${m.misplaced} non-optimal slot${m.misplaced>1?"s":""}">⚠ ${m.misplaced}</span>` : ""}
      </button>`;
    }).join("")}
  </div>`;

  const activeGroups = unitMetrics[_dcActiveUnit].groups;
  const groupSections = activeGroups.map(renderGroup).join("");

  // ── Packages view (alternate render path for the PKG tab) ────────────────
  // Shared with the rest of the depth chart — all slots are sourced from the
  // same `dc` object. Package-specific extras (DL5/DL6/NB2) are also editable
  // in the regular DEF tab; here we visualize how the 11-man lineup looks
  // per personnel package + give each formation a strength rating.
  const renderPackagesView = () => {
    const pkgMetrics = PERSONNEL_PACKAGES.map(pkg => {
      const lineup = pkg.slots.map(slotKey => {
        const slot = dc[slotKey];
        const starter = slot?.starter ? byPid[slot.starter] : null;
        return { slotKey, starter };
      });
      const ovrs = lineup.map(l => l.starter?.overall || 0).filter(o => o > 0);
      const avgOvr = ovrs.length ? Math.round(ovrs.reduce((s, o) => s + o, 0) / ovrs.length) : 0;
      // Scheme fit % — how many of the 11 starters have an archetype that
      // naturally fits their depth chart slot (e.g., SLOT_CB at the NB slot).
      // A high fit % means your roster is built for this formation.
      const filledLineup = lineup.filter(l => l.starter);
      const archFitCount = filledLineup.filter(l => _slotFitsArchetype(l.starter, l.slotKey)).length;
      const archFitPct = filledLineup.length ? Math.round(100 * archFitCount / filledLineup.length) : 0;
      return { pkg, lineup, avgOvr, archFitPct, strength: _strength(avgOvr) };
    });

    const _fitColor = pct => pct >= 70 ? "#4caf82" : pct >= 45 ? "#e8a000" : "#ff6b6b";
    const cards = pkgMetrics.map(({ pkg, avgOvr, archFitPct, strength }) => {
      const active = pkg.key === _dcActivePkg;
      const fitCol = _fitColor(archFitPct);
      return `<button class="frn-dc-pkg-card${active ? " active" : ""}" onclick="frnDepthSetPkg('${pkg.key}')">
        <div class="frn-dc-pkg-card-name">${pkg.name}</div>
        <div class="frn-dc-pkg-card-ovr" style="color:${strength.col}">${avgOvr || "—"} · ${strength.label}</div>
        <div class="frn-dc-pkg-card-fit" style="color:${fitCol}" title="Players whose archetype naturally fits their slot in this package">SCHEME FIT ${archFitPct}%</div>
      </button>`;
    }).join("");

    const active = pkgMetrics.find(m => m.pkg.key === _dcActivePkg)
                || pkgMetrics.find(m => m.pkg.key === "NICKEL")
                || pkgMetrics[0];
    const dlSlots = active.lineup.filter(l => l.slotKey.startsWith("DL"));
    const lbSlots = active.lineup.filter(l => l.slotKey.startsWith("LB"));
    const cbSlots = active.lineup.filter(l => l.slotKey.startsWith("CB") || l.slotKey === "NB" || l.slotKey === "NB2");
    const sSlots  = active.lineup.filter(l => l.slotKey === "SS" || l.slotKey === "FS");

    const renderPkgRow = (label, slots) => {
      if (!slots.length) return "";
      const cells = slots.map(({ slotKey, starter }) => {
        const isPkgOnly = ["DL5","DL6","NB2"].includes(slotKey);
        const pkgIcon = isPkgOnly ? ` <span class="frn-dc-pkg-cell-icon" title="Package-only slot — edit in DEFENSE tab">⛺</span>` : "";
        if (!starter) {
          return `<div class="frn-dc-pkg-cell empty">
            <div class="frn-dc-pkg-cell-slot">${slotKey}${pkgIcon}</div>
            <div class="frn-dc-pkg-cell-name">— empty —</div>
          </div>`;
        }
        const escName = (starter.name||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
        const escPid  = (starter.pid||"").replace(/'/g,"\\'");
        const archLabel = _archetypeLabel(starter);
        const archFits  = archLabel && _slotFitsArchetype(starter, slotKey);
        const _escArch = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
        const archHtml = archLabel
          ? `<div class="frn-dc-pkg-cell-arch${archFits?" fit":""}" title="${archFits?"Scheme fit ✓":"Archetype"}">${archFits?"✓ ":""}${_escArch(archLabel)}</div>`
          : "";
        return `<div class="frn-dc-pkg-cell${isPkgOnly?" pkg-only":""}${archFits?" arch-fit":""}">
          <div class="frn-dc-pkg-cell-slot">${slotKey}${pkgIcon}</div>
          <div class="frn-dc-pkg-cell-name" onclick="frnOpenPlayerCard('${escName}','${escPid}')">${starter.name}</div>
          <div class="frn-dc-pkg-cell-ovr">OVR ${starter.overall}</div>
          ${archHtml}
        </div>`;
      }).join("");
      return `<div class="frn-dc-pkg-row">
        <div class="frn-dc-pkg-row-lbl">${label}</div>
        <div class="frn-dc-pkg-row-cells">${cells}</div>
      </div>`;
    };

    return `<div class="frn-dc-pkg-view">
      <div class="frn-dc-pkg-cards">${cards}</div>
      <div class="frn-dc-pkg-header">
        <span class="frn-dc-pkg-header-name">${active.pkg.name}</span>
        <span class="frn-dc-pkg-header-desc">${active.pkg.desc}</span>
        <span class="frn-dc-pkg-header-ovr" style="color:${active.strength.col};border-color:${active.strength.col}44">AVG OVR ${active.avgOvr || "—"} · ${active.strength.label}</span>
      </div>
      <div class="frn-dc-pkg-lineup">
        ${renderPkgRow("FRONT", dlSlots)}
        ${renderPkgRow("LB", lbSlots)}
        ${renderPkgRow("CB/NB", cbSlots)}
        ${renderPkgRow("S", sSlots)}
      </div>
      <div class="frn-dc-pkg-hint">⛺ = package-only slot. DL5/DL6 (goal-line) and NB2 (dime) are managed in the DEFENSE tab like normal depth — edit which player fills them there.</div>
    </div>`;
  };

  // ── Unassigned panel (filtered to the active unit's positions) ────────────
  const activePositions = new Set(activeGroups.map(g => g.pos));
  const unassigned = roster
    .filter(p => p.pid && !assignedPids.has(p.pid) && activePositions.has(p.position))
    .sort((a,b) => (b.overall||60) - (a.overall||60));
  let unassignedHtml = "";
  if (unassigned.length) {
    const rows = unassigned.map(p => {
      const escName    = (p.name||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
      const escPid     = (p.pid||"").replace(/'/g,"\\'");
      const isExpiring = (p.contract?.remaining||0) <= 1;
      return `<div class="frn-dc-row">
        <div class="frn-dc-slot-lbl">
          <span class="frn-dc-slot-name" style="color:var(--blgray)">${p.position}</span>
        </div>
        <div class="frn-dc-player s1" style="grid-column:2/5">
          ${gradeBadge(p)}
          <span class="frn-dc-name" onclick="frnOpenPlayerCard('${escName}','${escPid}')">${p.name}</span>
          <span class="frn-dc-meta">${p.age} · $${(p.contract?.aav||0).toFixed(1)}M · ${p.contract?.remaining||0}yr</span>
          ${isExpiring ? `<span class="frn-dc-badge exp">EXP</span>` : ""}
        </div>
        <div class="frn-dc-controls"></div>
      </div>`;
    }).join("");
    unassignedHtml = `<div class="frn-dc-group" style="margin-top:.6rem">
      <div class="frn-dc-group-hdr" style="border-left:3px solid var(--border)">
        <span class="frn-dc-group-pos" style="color:var(--blgray)">—</span>
        <span class="frn-dc-group-label">UNASSIGNED</span>
        <span class="frn-dc-group-str" style="color:var(--gray);border-color:var(--border)">${unassigned.length} players not in any slot</span>
      </div>
      ${rows}
    </div>`;
  }

  // ── Unit strength strip ───────────────────────────────────────────────────
  // Strength strip — uses BASE starters only (excludes package-only extras
  // like DL5/DL6/NB2 since those only see the field in specific packages
  // and an empty DL5 shouldn't drag down the "DL" tier rating).
  const unitGroups = [
    { label:"QB", slots:["QB"] },
    { label:"RB", slots:["RB1","RB2"] },
    { label:"WR", slots:["WR1","WR2","WR3","WR4"] },
    { label:"TE", slots:["TE1","TE2"] },
    { label:"OL", slots:["LT","LG","C","RG","RT"] },
    { label:"DL", slots:["DL1","DL2","DL3","DL4"] },
    { label:"LB", slots:["LB1","LB2","LB3"] },
    { label:"CB", slots:["CB1","CB2","NB"] },
    { label:"S",  slots:["SS","FS"] },
  ];
  const strengthStrip = `<div class="frn-dc-strength-strip">
    <span class="frn-dc-strip-label">UNITS</span>
    ${unitGroups.map(u => {
      const ovr = _groupOVR(u.slots);
      const { label, col } = _strength(ovr);
      return `<div class="frn-dc-strip-unit">
        <span class="frn-dc-strip-pos">${u.label}</span>
        <span class="frn-dc-strip-val" style="color:${col};border-color:${col}33">${ovr > 0 ? ovr : "—"}</span>
        <span class="frn-dc-strip-tier" style="color:${col}">${label}</span>
      </div>`;
    }).join("")}
  </div>`;

  // ── Column header bar ─────────────────────────────────────────────────────
  const colHeader = `<div class="frn-dc-col-header">
    <div class="frn-dc-slot-lbl"></div>
    <div class="frn-dc-col-hdr-label">★ STARTER</div>
    <div style="width:52px"></div>
    <div class="frn-dc-col-hdr-label">▸ BACKUP</div>
    <div style="width:68px"></div>
  </div>`;

  const rtg = frnTeamRating(myId);
  const autoBtnLabel = autoChangedSlots > 0
    ? `⟳ AUTO-SET BY OVR <span class="frn-dc-auto-count">${autoChangedSlots} slot${autoChangedSlots>1?"s":""} would change</span>`
    : `⟳ AUTO-SET BY OVR <span class="frn-dc-auto-count optimal">chart is already optimal</span>`;
  const autoBtnConfirm = autoChangedSlots > 0
    ? `Auto-set the depth chart by overall? ${autoChangedSlots} slot${autoChangedSlots>1?"s":""} will change.`
    : `Re-run auto-set? The chart is already optimal by OVR.`;
  $("frnHomeContent").innerHTML = `
    <div class="frn-dc-page-header">
      <div class="frn-dc-title">
        <span style="font-size:1.05rem;font-weight:900;color:var(--gold)">📋 DEPTH CHART</span>
        <span class="frn-dc-team-name">${myTeam.city} ${myTeam.name}</span>
        <span class="frn-dc-ratings">OFF ${rtg.off} · DEF ${rtg.def} · ${roster.length} players</span>
      </div>
      <div style="display:flex;gap:.45rem;align-items:center">
        ${(() => {
          const policy = franchise.autoManagePolicy?.[myId] || "balanced";
          const policyChip = (key, label, tip) => {
            const isActive = policy === key;
            return `<button class="btn btn-outline" style="padding:.35rem .6rem;font-size:.6rem;letter-spacing:.5px;${isActive?'background:var(--gold);color:#000;border-color:var(--gold);font-weight:700':''}" onclick="frnSetAutoManagePolicy('${key}')" title="${tip}">${label}</button>`;
          };
          return `<div style="display:flex;gap:.25rem;align-items:center;border-right:1px solid rgba(255,255,255,.15);padding-right:.5rem;margin-right:.2rem" title="Auto-manage: how aggressively to rest worn/stressed starters">
            <span style="font-size:.55rem;color:var(--gray);letter-spacing:1px;font-weight:700">LOAD MGMT</span>
            ${policyChip("ride",         "Ride",     "Ignore wear — full snap-share, no rest")}
            ${policyChip("balanced",     "Balanced", "Trim wear≥70 by 15%; rest wear≥85; default")}
            ${policyChip("playoff_push", "Playoff",  "From W14+: aggressive rest of wear≥60, save legs for January")}
          </div>`;
        })()}
        <button class="frn-dc-auto-btn${autoChangedSlots>0?" hot":""}" data-confirm-msg="${autoBtnConfirm.replace(/"/g,"&quot;")}" onclick="(async()=>{ if(await _frnConfirm(this.dataset.confirmMsg)) frnDepthAutoSetOVR(); })()">${autoBtnLabel}</button>
        <button class="btn btn-outline" onclick="showFranchiseDashboard()">← Back</button>
      </div>
    </div>
    ${strengthStrip}
    ${tabsHtml}
    ${_dcActiveUnit === "PKG"
      ? `<div class="frn-dc-hint">View how your defense lines up per personnel package. AVG OVR = strength of the 11 on the field. SCHEME FIT % = how many of those 11 have an archetype that naturally fits the slot (e.g., SLOT_CB at the NB).</div>
         ${renderPackagesView()}`
      : `<div class="frn-dc-hint">↑↓ reorder slots · ⇅ swap #1↔#2 · ▲ promote backup · click snap bar to set split (blue = manual) · hover starter for injury cascade · ✓ green badge = archetype fits the slot · ⚠ = auto-by-OVR mismatch</div>
         <div class="frn-dc-table">
           ${colHeader}
           ${groupSections}
           ${unassignedHtml}
         </div>`
    }`;
}

// Compute a team's W-L-T record AS OF a given week (before that week's game).
// confW/confL only count games against teams in the same conference.
function _teamRecordAsOf(teamId, throughWeek) {
  const team = getTeam(teamId);
  let w = 0, l = 0, t = 0, confW = 0, confL = 0;
  for (const g of (franchise.schedule || [])) {
    if (!g.played || g.week >= throughWeek) continue;
    let myScore, oppScore, oppId;
    if (g.homeId === teamId)      { myScore = g.homeScore; oppScore = g.awayScore; oppId = g.awayId; }
    else if (g.awayId === teamId) { myScore = g.awayScore; oppScore = g.homeScore; oppId = g.homeId; }
    else continue;
    const isConf = team && getTeam(oppId)?.conference === team.conference;
    if (myScore > oppScore)      { w++; if (isConf) confW++; }
    else if (myScore < oppScore) { l++; if (isConf) confL++; }
    else                          { t++; }
  }
  return { w, l, t, confW, confL };
}
// Fantasy points (standard PPR) so we can pick top performers per team.
function _fpts(p, pos) {
  let f = 0;
  if (pos === "QB") f += (p.pass_yds||0)*0.04 + (p.pass_td||0)*4 - (p.pass_int||0)*2;
  f += (p.rush_yds||0)*0.1 + (p.rush_td||0)*6;
  f += (p.rec||0)*1 + (p.rec_yds||0)*0.1 + (p.rec_td||0)*6;
  f += (p.tkl||0)*1 + (p.sk||0)*2 + (p.int_made||0)*4 + (p.ff||0)*2 + (p.fr||0)*2 + (p.pd||0)*0.5;
  f += (p.fg_made||0)*3 + (p.xp_made||0)*1;
  return Math.round(f * 10) / 10;
}
// secs left in quarter → "MM:SS"
function _clockMMSS(secs) {
  const s = Math.max(0, Math.round(Number(secs) || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}
// Deterministic crowd size in the 45–75k range based on home/week.
function _attendanceFor(home, week, season) {
  if (!home) return 0;
  let h = (season || 1) * 7919 + week * 31 + home.id * 53;
  for (const c of (home.city + home.name)) h = (h * 31 + c.charCodeAt(0)) | 0;
  const base = 45000;
  const range = 30000;
  return base + Math.abs(h) % range;
}
// Pick top performer in a stat category. Returns null if no one qualifies.
function _topPerformer(players, scoreFn, threshold) {
  let best = null, bestS = -Infinity;
  for (const p of players) {
    const s = scoreFn(p);
    if (s > bestS && s >= (threshold || 0)) { best = p; bestS = s; }
  }
  return best;
}
// Mini helmet glyph used in leader rows (cheap inline SVG).
function _mini_helmet(team) {
  const primary = team?.primary || "#444";
  const secondary = team?.secondary || "#ccc";
  return `<svg class="frn-bs-leader-helm" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="20" cy="19" rx="15" ry="13" fill="${primary}" stroke="${secondary}" stroke-width="1.5"/>
    <rect x="6" y="22" width="20" height="2" fill="${secondary}" rx="1"/>
  </svg>`;
}
// Linear bars for the team-stat-comparison row.
function _bsCompRow(label, aVal, hVal, awayColor, homeColor, fmt) {
  const a = +aVal || 0, h = +hVal || 0;
  const max = Math.max(a, h) || 1;
  const aw = Math.round((a / max) * 100);
  const hw = Math.round((h / max) * 100);
  const fmtFn = fmt || (v => v);
  return `<div class="row">
    <div class="stat">${label}</div>
    <div class="v-left">${fmtFn(a)}</div>
    <div class="frn-bs-bar">
      <div class="frn-bs-bar-l"><span style="width:${aw}%;background:${awayColor}"></span></div>
      <div class="frn-bs-bar-r"><span style="width:${hw}%;background:${homeColor}"></span></div>
    </div>
    <div class="v-right">${fmtFn(h)}</div>
  </div>`;
}
// ── BSPN box-score: adapter + vanilla-JS render ─────────────────────────────
// Mirrors the React BSPN system (src/components/bspn/*) but lives inline in
// play.html so franchise mode can use it without crossing app boundaries.
// _franchiseGameToBSPNData() is the only place that knows the franchise
// schedule game shape; everything below consumes BSPNBoxScoreData only.

function _bspnAbbr(team) {
  if (!team) return "TBD";
  const n = (team.name || "").trim();
  if (n) return n.slice(0, 3).toUpperCase();
  const c = (team.city || "").trim();
  return (c || "TBD").slice(0, 3).toUpperCase();
}
function _bspnEsc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function _bspnTeamFromFranchise(team, recordStr) {
  if (!team) return { id: "tbd", name: "TBD", abbreviation: "TBD",
                      primaryColor: "#888", secondaryColor: "#444" };
  return {
    id: team.id,
    name: team.name,
    city: team.city,
    abbreviation: _bspnAbbr(team),
    record: recordStr || null,
    primaryColor: team.primary,
    secondaryColor: team.secondary,
    asciiMark: null,
  };
}
function _bspnFmtRecord(rec) {
  if (!rec) return null;
  const base = `${rec.w||0}-${rec.l||0}${rec.t ? `-${rec.t}` : ""}`;
  if (rec.confW != null) return `${base} (${rec.confW}-${rec.confL})`;
  return base;
}
function _bspnQuarterScoresFromScoring(scoring) {
  const out = {};
  for (const ev of (scoring || [])) {
    if (ev.isScore === false) continue;
    if (!ev.pts) continue;
    const q = Math.max(1, Math.min(8, ev.qtr || 1));
    out[q] ||= { home: 0, away: 0 };
    if (ev.poss === "home") out[q].home += ev.pts;
    else if (ev.poss === "away") out[q].away += ev.pts;
  }
  const maxQ = Math.max(4, ...Object.keys(out).map(Number));
  const arr = [];
  for (let q = 1; q <= maxQ; q++) {
    arr.push({
      periodLabel: q <= 4 ? `Q${q}` : (q === 5 ? "OT" : `OT${q-4}`),
      away: out[q]?.away || 0, home: out[q]?.home || 0,
    });
  }
  return arr;
}
function _bspnBuildComparisonStats(stats) {
  if (!stats) return [];
  const aT = stats.away?.totals || {};
  const hT = stats.home?.totals || {};
  const fmtTOP = v => `${Math.floor((v||0)/60)}:${String((v||0)%60).padStart(2,"0")}`;
  const fmtRZ = (att, td) => att ? `${td||0}/${att} (${Math.round((td||0)/att*100)}%)` : "0/0";
  const row = (key, label, a, h, fmt) => ({
    key, label,
    awayValue: fmt ? fmt(a) : (a||0),
    homeValue: fmt ? fmt(h) : (h||0),
    awayBarValue: a||0, homeBarValue: h||0,
  });
  // Sum punt totals from the punter row on each side (engine doesn't yet
  // aggregate team-level ST totals, so we derive from the punter's own
  // line). Returns { att, yds, long, in20 } for each side.
  const puntAgg = (side) => {
    const players = stats?.[side]?.players || {};
    let att = 0, yds = 0, long = 0, in20 = 0;
    for (const p of Object.values(players)) {
      if (!p?.punt_att) continue;
      att += p.punt_att; yds += p.punt_yds || 0;
      long = Math.max(long, p.punt_long || 0);
      in20 += p.punts_in_20 || 0;
    }
    return { att, yds, long, in20, avg: att ? yds/att : 0 };
  };
  const aP = puntAgg("away"), hP = puntAgg("home");
  // Field names match the simulator's stats[side].team shape: totalYds,
  // passYds, rushYds, timeOfPoss (seconds), penalties (count), penaltyYds.
  return [
    row("first_downs",   "FIRST DOWNS",       aT.firstDowns,  hT.firstDowns),
    row("total_yards",   "TOTAL YARDS",       aT.totalYds,    hT.totalYds),
    row("passing_yards", "PASSING YARDS",     aT.passYds,     hT.passYds),
    row("rushing_yards", "RUSHING YARDS",     aT.rushYds,     hT.rushYds),
    row("turnovers",     "TURNOVERS",         aT.turnovers,   hT.turnovers),
    row("sacks",         "SACKS",             aT.sacks,       hT.sacks),
    // RZ efficiency renders "TD/ATT (PCT)" directly since fmt() is per-side
    // and we need both att + td together. Bar values use TD% so visual
    // weight tracks efficiency, not volume.
    {
      key: "rz_eff", label: "RED ZONE",
      awayValue: fmtRZ(aT.rz_att, aT.rz_td),
      homeValue: fmtRZ(hT.rz_att, hT.rz_td),
      awayBarValue: aT.rz_att ? (aT.rz_td || 0) / aT.rz_att * 100 : 0,
      homeBarValue: hT.rz_att ? (hT.rz_td || 0) / hT.rz_att * 100 : 0,
    },
    row("punt_avg",      "PUNT AVG",          aP.avg,         hP.avg,
        v => v ? v.toFixed(1) : "—"),
    row("penalties",     "PENALTIES (YDS)",   aT.penaltyYds,  hT.penaltyYds),
    row("top",           "TIME OF POSSESSION", aT.timeOfPoss, hT.timeOfPoss, fmtTOP),
  ];
}
function _bspnBuildStatGroups(sidePlayers, teamId) {
  const players = Object.values(sidePlayers || {});
  if (!players.length) return [];
  const filter = (fn, sortKey) => players
    .filter(fn).sort((a,b) => (b[sortKey]||0) - (a[sortKey]||0));
  const pNameCell = p => {
    // 1. pid lookup — collision-proof for games played after engine fix.
    if (p.pid) {
      const byPid = _findPlayerByPid(p.pid);
      if (byPid) return playerLink(byPid);
    }
    // 2. Team-roster-first — handles old saves without pid: search the
    //    specific side's roster before scanning the whole league.
    if (teamId) {
      const inTeam = (franchise?.rosters?.[teamId] || []).find(rp => rp.name === p.name);
      if (inTeam) return playerLink(inTeam);
    }
    return playerLinkByName(p.name);
  };
  const passingRows = filter(p => (p.pass_att||0) > 0, "pass_yds").map(p => ({
    id: `pass-${p.name}`, cells: {
      player: pNameCell(p),
      cmp: p.pass_comp || 0, att: p.pass_att || 0,
      yds: p.pass_yds || 0, td: p.pass_td || 0, int: p.pass_int || 0,
      rtg: p.pass_att ? (((p.pass_comp||0)/p.pass_att*100*0.5 + (p.pass_yds||0)/p.pass_att*4 + (p.pass_td||0)*5 - (p.pass_int||0)*5).toFixed(1)) : "0.0",
    },
  }));
  const rushingRows = filter(p => (p.rush_att||0) > 0, "rush_yds").map(p => ({
    id: `rush-${p.name}`, cells: {
      player: pNameCell(p),
      att: p.rush_att || 0, yds: p.rush_yds || 0,
      avg: p.rush_att ? ((p.rush_yds||0)/p.rush_att).toFixed(1) : "0.0",
      td: p.rush_td || 0, lng: p.rush_long || 0,
    },
  }));
  const receivingRows = filter(p => (p.rec||0) > 0 || (p.rec_tgt||0) > 0, "rec_yds").map(p => ({
    id: `rec-${p.name}`, cells: {
      player: pNameCell(p),
      rec: p.rec || 0, yds: p.rec_yds || 0,
      avg: p.rec ? ((p.rec_yds||0)/p.rec).toFixed(1) : "0.0",
      td: p.rec_td || 0, lng: p.rec_long || 0,
    },
  }));
  const defRows = filter(p => ((p.tkl||0)+(p.sk||0)+(p.int_made||0)+(p.pd||0)) > 0, "tkl").map(p => ({
    id: `def-${p.name}`, cells: {
      player: pNameCell(p),
      tkl: p.tkl || 0, ast: p.ast || 0, tfl: p.tfl || 0,
      sack: (p.sk || 0).toFixed(1).replace(/\.0$/, ""),
      int: p.int_made || 0, ff: p.ff || 0, fr: p.fr || 0,
    },
  }));
  const kickRows = filter(p => (p.fg_att||0) > 0 || (p.xp_att||0) > 0, "fg_made").map(p => ({
    id: `k-${p.name}`, cells: {
      player: pNameCell(p),
      fgm_fga: `${p.fg_made||0}-${p.fg_att||0}`,
      lng: p.fg_long || 0,
      xp: `${p.xp_made||0}-${p.xp_att||0}`,
      pts: (p.fg_made||0)*3 + (p.xp_made||0),
    },
  }));
  const groups = [];
  const baseCols = key => [
    { key: "player", label: "" },
    ...({
      pass:    [{key:"cmp",label:"CMP",align:"right"},{key:"att",label:"ATT",align:"right"},{key:"yds",label:"YDS",align:"right"},{key:"td",label:"TD",align:"right"},{key:"int",label:"INT",align:"right"},{key:"rtg",label:"RTG",align:"right"}],
      rush:    [{key:"att",label:"ATT",align:"right"},{key:"yds",label:"YDS",align:"right"},{key:"avg",label:"AVG",align:"right"},{key:"td",label:"TD",align:"right"},{key:"lng",label:"LNG",align:"right"}],
      rec:     [{key:"rec",label:"REC",align:"right"},{key:"yds",label:"YDS",align:"right"},{key:"avg",label:"AVG",align:"right"},{key:"td",label:"TD",align:"right"},{key:"lng",label:"LNG",align:"right"}],
      def:     [{key:"tkl",label:"TKL",align:"right"},{key:"ast",label:"AST",align:"right"},{key:"tfl",label:"TFL",align:"right"},{key:"sack",label:"SACK",align:"right"},{key:"int",label:"INT",align:"right"},{key:"ff",label:"FF",align:"right"},{key:"fr",label:"FR",align:"right"}],
      kick:    [{key:"fgm_fga",label:"FGM-FGA",align:"right"},{key:"lng",label:"LONG",align:"right"},{key:"xp",label:"XP",align:"right"},{key:"pts",label:"PTS",align:"right"}],
    })[key],
  ];
  if (passingRows.length)   groups.push({ title: "PASSING",   columns: baseCols("pass"), rows: passingRows });
  if (rushingRows.length)   groups.push({ title: "RUSHING",   columns: baseCols("rush"), rows: rushingRows });
  if (receivingRows.length) groups.push({ title: "RECEIVING", columns: baseCols("rec"),  rows: receivingRows });
  if (defRows.length)       groups.push({ title: "DEFENSE",   columns: baseCols("def"),  rows: defRows });
  if (kickRows.length)      groups.push({ title: "KICKING",   columns: baseCols("kick"), rows: kickRows });
  return groups;
}
function _bspnBuildScoringSummary(scoring, awayT, homeT) {
  const out = [];
  for (const ev of (scoring || [])) {
    if (ev.isScore === false) continue;
    if (!ev.pts) continue;
    const tm = ev.poss === "home" ? homeT : awayT;
    // Classify the score type from stored field or desc string
    const rawType = ev.scoreType || ev.desc || "";
    let type = "TD";
    if (/FG|field goal/i.test(rawType))               type = "FG";
    else if (/Extra Point|extra point/i.test(rawType)) type = "XP";
    else if (/2-Point/i.test(rawType))                 type = "2PT";
    else if (/Safety/i.test(rawType))                  type = "SAF";
    else if (/Punt Return/i.test(rawType))              type = "TD";
    // Subordinate events (XP/2PT) get visually nested under the preceding TD
    const isSub = type === "XP" || type === "2PT";
    // Extract FG distance from desc like "47-yd FG"
    const fgDist = type === "FG" ? (rawType.match(/(\d+)-yd/) || [])[1] : null;
    out.push({
      period: ev.qtr <= 4 ? `Q${ev.qtr}` : "OT",
      teamId: tm.id,
      type, isSub, fgDist,
      scorer: ev.scorer || null,
      passer: ev.passer || null,
      kicker: ev.kicker || null,
      pts: ev.pts,
      awayScore: ev.awayScore,
      homeScore: ev.homeScore,
      awayId: awayT.id,
      homeId: homeT.id,
    });
  }
  return out;
}
function _bspnFantasy(p) {
  const pos = p.pos;
  let f = 0;
  if (pos === "QB") f += (p.pass_yds||0)*0.04 + (p.pass_td||0)*4 - (p.pass_int||0)*2;
  f += (p.rush_yds||0)*0.1 + (p.rush_td||0)*6;
  f += (p.rec||0)*1 + (p.rec_yds||0)*0.1 + (p.rec_td||0)*6;
  f += (p.tkl||0)*1 + (p.sk||0)*2 + (p.int_made||0)*4 + (p.ff||0)*2 + (p.fr||0)*2 + (p.pd||0)*0.5;
  f += (p.fg_made||0)*3 + (p.xp_made||0)*1;
  return Math.round(f*10)/10;
}
function _bspnBuildLeaders(stats, awayT, homeT) {
  if (!stats) return { leaderGroups: [], topPerformers: undefined };
  // Per-game stat records don't carry the jersey number — look it up from
  // the team's roster snapshot. This also surfaces .age, .archetype, etc.
  // if any downstream code wants them.
  const enrich = (slim, team) => {
    const roster = franchise.rosters?.[team.id] || [];
    const rosterP = roster.find(r => r.name === slim.name) || {};
    return { ...slim, _team: team, _rosterP: rosterP };
  };
  const all = [
    ...Object.values(stats.away?.players || {}).map(p => enrich(p, awayT)),
    ...Object.values(stats.home?.players || {}).map(p => enrich(p, homeT)),
  ];
  const top = (scoreFn, threshold) => {
    let best = null, b = -Infinity;
    for (const p of all) {
      const s = scoreFn(p);
      if (s > b && s >= (threshold || 0)) { best = p; b = s; }
    }
    return best;
  };
  const tp = top(p => p.pass_yds||0, 30);
  const tr = top(p => p.rush_yds||0, 20);
  const trc = top(p => p.rec_yds||0, 20);
  const td = top(p => (p.tkl||0)*1 + (p.sk||0)*3 + (p.int_made||0)*5, 4);
  const mkLeader = (label, p, statLine) => p ? {
    label, playerName: p.name, teamId: p._team.id,
    jersey: jerseyForPlayer(p._rosterP || p),
    statLine,
  } : null;
  const offRows = [
    mkLeader("PASSING",  tp,  tp  ? `${tp.pass_comp||0}-${tp.pass_att||0}, ${tp.pass_yds||0} YDS, ${tp.pass_td||0} TD, ${tp.pass_int||0} INT` : ""),
    mkLeader("RUSHING",  tr,  tr  ? `${tr.rush_att||0} ATT, ${tr.rush_yds||0} YDS, ${tr.rush_td||0} TD` : ""),
    mkLeader("RECEIVING", trc, trc ? `${trc.rec||0} REC, ${trc.rec_yds||0} YDS, ${trc.rec_td||0} TD` : ""),
    mkLeader("DEFENSE",  td,  td  ? `${td.tkl||0} TKL, ${td.sk||0} SK${td.int_made?`, ${td.int_made} INT`:""}` : ""),
  ].filter(Boolean);
  const topByFp = [...all].sort((a,b) => _bspnFantasy(b) - _bspnFantasy(a)).slice(0, 4);
  const tpRows = topByFp.map(p => {
    let detail = "";
    const pos = p.pos;
    if (pos === "QB") detail = `${p.pass_yds||0} PASS YDS, ${p.pass_td||0} TD`;
    else if (pos === "RB") detail = `${p.rush_yds||0} RUSH YDS, ${p.rush_td||0} TD`;
    else if (pos === "WR" || pos === "TE") detail = `${p.rec_yds||0} REC YDS, ${p.rec_td||0} TD`;
    else if (pos === "K") detail = `${p.fg_made||0}/${p.fg_att||0} FG`;
    else detail = `${p.tkl||0} TKL, ${p.sk||0} SK`;
    return {
      label: "", playerName: p.name, teamId: p._team.id,
      jersey: jerseyForPlayer(p._rosterP || p),
      statLine: `${_bspnFantasy(p).toFixed(1)} FPTS · ${detail}`,
      value: _bspnFantasy(p),
    };
  });
  return {
    leaderGroups: offRows.length ? [{ title: "OFFENSIVE LEADERS", rows: offRows }] : [],
    topPerformers: tpRows.length ? { title: "GAME LEADERS · TOP PERFORMERS", rows: tpRows } : undefined,
  };
}
function _bspnBuildGameNotes(g, week, awayT, homeT, home, away, homeWon, leaders) {
  const notes = [];
  const { topPerformers } = leaders || {};
  // Conference standings note
  if (home.conference === away.conference) {
    const winner = homeWon ? home : away;
    notes.push(`${winner.city} ${winner.name} improve in conference play.`);
  }
  // Career milestones — simple thresholds from raw stats
  const tp = (leaders.leaderGroups[0]?.rows || []).find(r => r.label === "PASSING");
  if (tp) {
    notes.push(`${tp.playerName} — top passing performance of the day.`);
  }
  notes.push(`Attendance: ${(_attendanceFor(home, week, franchise.season) || 0).toLocaleString()}`);
  if (g.weather && g.weather.label && g.weather.label !== "CLEAR") {
    const w = g.weather;
    notes.push(`Weather: ${w.tempF ? w.tempF+"°F" : ""} ${w.label}${w.windMph ? `, Wind ${w.windMph} mph` : ""}`.trim());
  } else {
    notes.push(`Weather: clear conditions.`);
  }
  // Next game for both teams
  const nextOf = teamId => {
    const ng = (franchise.schedule || [])
      .filter(s => !s.played && (s.homeId === teamId || s.awayId === teamId))
      .sort((a,b) => a.week - b.week)[0];
    if (!ng) return null;
    const opp = getTeam(ng.homeId === teamId ? ng.awayId : ng.homeId);
    const venue = ng.homeId === teamId ? "vs" : "at";
    return `${_bspnAbbr(getTeam(teamId))} ${venue} ${_bspnAbbr(opp)} (Wk ${ng.week})`;
  };
  const nh = nextOf(home.id), na = nextOf(away.id);
  if (nh || na) notes.push(`Next Game: ${[na, nh].filter(Boolean).join(" · ")}`);
  return notes.map((t, i) => ({ id: `n${i}`, text: t }));
}

/** Adapt a franchise schedule entry to BSPNBoxScoreData. */
function _franchiseGameToBSPNData(g, week) {
  const home = getTeam(g.homeId), away = getTeam(g.awayId);
  const homeWon = g.homeScore > g.awayScore;
  // Records as of this game (after applying its result)
  const awayRec = _teamRecordAsOf(g.awayId, week);
  const homeRec = _teamRecordAsOf(g.homeId, week);
  if (homeWon) {
    homeRec.w++; awayRec.l++;
    if (home.conference === away.conference) { homeRec.confW++; awayRec.confL++; }
  } else if (g.awayScore > g.homeScore) {
    awayRec.w++; homeRec.l++;
    if (home.conference === away.conference) { awayRec.confW++; homeRec.confL++; }
  } else {
    awayRec.t++; homeRec.t++;
  }
  const awayT = _bspnTeamFromFranchise(away, _bspnFmtRecord(awayRec));
  const homeT = _bspnTeamFromFranchise(home, _bspnFmtRecord(homeRec));
  const summary = {
    gameId: `wk${week}-${g.homeId}-${g.awayId}`,
    status: `WEEK ${week} · FINAL${g.isRivalry?" · RIVALRY":""}`,
    awayTeam: awayT, homeTeam: homeT,
    awayScore: g.awayScore || 0, homeScore: g.homeScore || 0,
    quarterScores: _bspnQuarterScoresFromScoring(g.scoring),
    winner: homeWon ? "home" : (g.awayScore > g.homeScore ? "away" : "tie"),
  };
  const leaders = _bspnBuildLeaders(g.stats, awayT, homeT);
  return {
    summary,
    comparisonStats: _bspnBuildComparisonStats(g.stats),
    awayBoxScoreGroups: _bspnBuildStatGroups(g.stats?.away?.players, g.awayId),
    homeBoxScoreGroups: _bspnBuildStatGroups(g.stats?.home?.players, g.homeId),
    scoringSummary: _bspnBuildScoringSummary(g.scoring, awayT, homeT),
    leaderGroups: leaders.leaderGroups,
    topPerformers: leaders.topPerformers,
    injuryRecap: _bspnBuildInjuryRecap(g, week, home, away),
    gameNotes: _bspnBuildGameNotes(g, week, awayT, homeT, home, away, homeWon, leaders),
  };
}

// Scan both rosters for injuries logged in THIS game (season+week match)
// and return a rich recap. Pulls cause / mechanism / tackler / body part
// so the trainer narrative is complete.
function _bspnBuildInjuryRecap(g, week, homeTeam, awayTeam) {
  const seasonNum = franchise.season;
  const scan = (teamId, side) => {
    const roster = franchise.rosters?.[teamId] || [];
    const events = [];
    for (const p of roster) {
      for (const h of (p.injuryHistory || [])) {
        if (h.season !== seasonNum) continue;
        if (h.week !== Number(week)) continue;
        events.push({
          name: p.name, pos: p.position, side, teamAbbr: side === "home" ? _bspnLiveAbbr(homeTeam) : _bspnLiveAbbr(awayTeam),
          label: h.label, cause: h.cause, mechanism: h.mechanism,
          bodyPart: h.bodyPart, tackler: h.tackler,
          weeks: h.weeks ?? h.duration,
          catastrophic: !!h.catastrophic, careerEnding: !!h.careerEnding,
        });
      }
    }
    return events;
  };
  const all = [...scan(g.awayId, "away"), ...scan(g.homeId, "home")];
  if (!all.length) return null;
  // Sort: career-ending → catastrophic → standard
  all.sort((a, b) => {
    if (a.careerEnding !== b.careerEnding) return a.careerEnding ? -1 : 1;
    if (a.catastrophic !== b.catastrophic) return a.catastrophic ? -1 : 1;
    return (b.weeks || 0) - (a.weeks || 0);
  });
  return all;
}

function _bspnRenderInjuryRecap(events) {
  if (!events?.length) return "";
  const PART_NAMES = {
    head: "Head", neck: "Neck", chest: "Chest", back: "Lower back", groin: "Groin",
    shoulderL: "L shoulder", shoulderR: "R shoulder",
    hipL: "L hip", hipR: "R hip",
    hamstringL: "L hamstring", hamstringR: "R hamstring",
    kneeL: "L knee", kneeR: "R knee",
    calfL: "L calf", calfR: "R calf",
    achillesL: "L achilles", achillesR: "R achilles",
    ankleL: "L ankle", ankleR: "R ankle",
    handL: "L hand", handR: "R hand",
  };
  const mechName = (m) => m === "head_on" ? "head-on"
                       : m === "high"    ? "high hit"
                       : m === "low"     ? "low / cut"
                       : m === "side"    ? "side"
                       : m === "behind"  ? "blindside" : m;
  const causeChip = (c) => {
    if (c === "non_contact") return `<span style="background:rgba(80,140,200,.18);color:#90c4ec;padding:.05rem .3rem;border-radius:2px;font-size:.55rem;letter-spacing:.4px;font-weight:700">N-C</span>`;
    if (c === "sack")        return `<span style="background:rgba(230,140,80,.18);color:#f0a96b;padding:.05rem .3rem;border-radius:2px;font-size:.55rem;letter-spacing:.4px;font-weight:700">SACK</span>`;
    if (c === "big_hit")     return `<span style="background:rgba(230,80,80,.18);color:#ec9090;padding:.05rem .3rem;border-radius:2px;font-size:.55rem;letter-spacing:.4px;font-weight:700">HIT</span>`;
    return `<span style="background:rgba(140,140,140,.12);color:#aaa;padding:.05rem .3rem;border-radius:2px;font-size:.55rem;letter-spacing:.4px;font-weight:700">WK</span>`;
  };
  const rows = events.map(e => {
    const icon = e.careerEnding ? "💔" : e.catastrophic ? "🚑" : "🩹";
    const part = e.bodyPart ? `<span style="color:var(--gray)"> · ${PART_NAMES[e.bodyPart] || e.bodyPart}</span>` : "";
    const mech = e.mechanism ? `<span style="color:rgba(255,255,255,.4);font-size:.58rem"> · ${mechName(e.mechanism)}</span>` : "";
    const tackler = e.tackler ? `<div style="font-size:.58rem;color:var(--gray);margin-top:.1rem">by ${e.tackler}</div>` : "";
    const sev = e.careerEnding ? `<span style="color:#e6373a;font-weight:800;font-size:.55rem">CAREER-END</span>`
              : e.catastrophic ? `<span style="color:#ed6a3a;font-weight:800;font-size:.55rem">CATA</span>` : "";
    return `<div style="padding:.35rem .5rem;border-bottom:1px solid rgba(255,255,255,.07);font-size:.68rem">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:.4rem">
        <span style="font-weight:600">${icon} ${e.teamAbbr || "—"} · ${e.pos} ${_bspnEsc(e.name)}</span>
        ${causeChip(e.cause)}
      </div>
      <div style="margin-top:.15rem;font-size:.62rem">
        <span>${_bspnEsc(e.label)}${part}${mech}</span>
        <span style="color:var(--gray);float:right">${e.weeks||"?"}w</span>
      </div>
      ${tackler}
      ${sev ? `<div style="margin-top:.1rem">${sev}</div>` : ""}
    </div>`;
  }).join("");
  return `<section class="bspn-panel">
    <div class="bspn-panel-title">🩹 INJURY REPORT</div>
    <div>${rows}</div>
  </section>`;
}

// ── Renderers ──────────────────────────────────────────────────────────────
const _BSPN_NAV = ["Scores","News","Box Score","Stats","Teams","Standings"];

function _bspnRenderHeader() {
  const items = _BSPN_NAV.map(it => {
    const active = it === "Box Score" ? " active" : "";
    return `<button type="button" class="bspn-nav-item${active}">${it}</button>`;
  }).join("");
  return `<header class="bspn-header">
    <div class="bspn-logo">BSPN</div>
    <nav class="bspn-nav">${items}</nav>
    <div class="bspn-header-right" aria-hidden="true">
      <span>⌕</span><span>▶ WATCH</span><span>◯</span><span>≡</span>
    </div>
  </header>`;
}
function _bspnRenderScoreNumeral(value, color, muted) {
  const cls = `bspn-score-numeral${muted ? " muted" : ""}`;
  const style = color && !muted ? `style="--num-color:${color}"` : "";
  return `<span class="${cls}" ${style}>${value}</span>`;
}
function _bspnRenderTeamMark(team) {
  const sz = 80;
  return `<div class="bspn-summary-team-mark" style="width:${sz}px;height:${sz}px;--team-color:${team.primaryColor}">
    <span style='font-family:"Bebas Neue","Anton",sans-serif;font-size:.95rem;letter-spacing:2px'>${_bspnEsc(team.abbreviation)}</span>
  </div>`;
}
function _bspnRenderSummary(s) {
  const awayWon = s.winner === "away", homeWon = s.winner === "home";
  const teamBlock = (t, side) => {
    const isWin = side === "away" ? awayWon : homeWon;
    const otherWon = side === "away" ? homeWon : awayWon;
    const sclass = side === "home" ? " right" : "";
    const score = side === "away" ? s.awayScore : s.homeScore;
    const arrow = isWin
      ? (side === "away"
        ? `<span class="bspn-summary-arrow" style="color:${t.primaryColor}">◄</span>`
        : `<span class="bspn-summary-arrow" style="color:${t.primaryColor}">►</span>`)
      : "";
    const scoreEl = _bspnRenderScoreNumeral(score, isWin ? t.primaryColor : undefined, !isWin && otherWon);
    const recordEl = t.record ? `<span class="bspn-summary-team-record">${_bspnEsc(t.record)}</span>` : "";
    const cityEl = t.city ? `<span class="bspn-summary-team-city">${_bspnEsc(t.city.toUpperCase())}</span>` : "";
    const scoreWrap = side === "home"
      ? `<div class="bspn-summary-score-wrap">${arrow}${scoreEl}</div>`
      : `<div class="bspn-summary-score-wrap">${scoreEl}${arrow}</div>`;
    return `<div class="bspn-summary-team${sclass}" style="--team-color:${t.primaryColor}">
      ${_bspnRenderTeamMark(t)}
      <div class="bspn-summary-team-block">
        ${cityEl}
        <span class="bspn-summary-team-name">${_bspnEsc(t.name.toUpperCase())}</span>
        ${recordEl}
      </div>
      ${scoreWrap}
    </div>`;
  };
  const headerCells = s.quarterScores.map(q => `<th>${q.periodLabel}</th>`).join("");
  const awayCells = s.quarterScores.map(q => `<td>${q.away ?? 0}</td>`).join("");
  const homeCells = s.quarterScores.map(q => `<td>${q.home ?? 0}</td>`).join("");
  return `<section class="bspn-summary">
    ${teamBlock(s.awayTeam, "away")}
    <div class="bspn-summary-center">
      <div class="bspn-summary-status">${_bspnEsc(s.status)}</div>
      <table class="bspn-summary-quarters">
        <thead><tr><th></th>${headerCells}<th>TOTAL</th></tr></thead>
        <tbody>
          <tr><td style="color:${s.awayTeam.primaryColor};font-weight:700">${s.awayTeam.abbreviation}</td>${awayCells}<td class="total">${s.awayScore}</td></tr>
          <tr><td style="color:${s.homeTeam.primaryColor};font-weight:700">${s.homeTeam.abbreviation}</td>${homeCells}<td class="total">${s.homeScore}</td></tr>
        </tbody>
      </table>
    </div>
    ${teamBlock(s.homeTeam, "home")}
  </section>`;
}
function _bspnRenderCompBars(aVal, hVal, aColor, hColor) {
  const a = Math.max(0, Number(aVal) || 0);
  const h = Math.max(0, Number(hVal) || 0);
  const max = Math.max(a, h, 1);
  const aw = Math.round((a/max)*100);
  const hw = Math.round((h/max)*100);
  return `<div class="bspn-comp-bars" aria-hidden="true">
    <div class="bspn-comp-bar-l"><span style="width:${aw}%;background:${aColor};color:${aColor}"></span></div>
    <div class="bspn-comp-bar-divider"></div>
    <div class="bspn-comp-bar-r"><span style="width:${hw}%;background:${hColor};color:${hColor}"></span></div>
  </div>`;
}
function _bspnRenderComparison(stats, awayT, homeT) {
  if (!stats?.length) {
    return `<section class="bspn-panel">
      <div class="bspn-panel-title">TEAM STAT COMPARISON</div>
      <div style="color:var(--bspn-gray);font-size:.7rem;font-style:italic">
        No team totals available for this game.
      </div>
    </section>`;
  }
  const rows = stats.map(s => `<div class="bspn-comp-row">
    <span class="bspn-comp-label">${_bspnEsc(s.label)}</span>
    <span class="bspn-comp-val left bspn-num">${_bspnEsc(s.awayValue)}</span>
    ${_bspnRenderCompBars(s.awayBarValue ?? s.awayValue, s.homeBarValue ?? s.homeValue, awayT.primaryColor, homeT.primaryColor)}
    <span class="bspn-comp-val right bspn-num">${_bspnEsc(s.homeValue)}</span>
  </div>`).join("");
  return `<section class="bspn-panel">
    <div class="bspn-panel-title">TEAM STAT COMPARISON</div>
    <div class="bspn-comp-row" style="border-bottom:1px solid var(--bspn-border-strong)">
      <span class="bspn-comp-label" style="color:var(--bspn-gray)">STAT</span>
      <span class="bspn-comp-val left" style="color:${awayT.primaryColor}">${awayT.abbreviation}</span>
      <span></span>
      <span class="bspn-comp-val right" style="color:${homeT.primaryColor}">${homeT.abbreviation}</span>
    </div>
    ${rows}
  </section>`;
}
function _bspnRenderStatTable(group, accentColor) {
  if (!group || !group.rows?.length) return "";
  const head = group.columns.map(c => `<th data-align="${c.align||"left"}">${_bspnEsc(c.label)}</th>`).join("");
  const rows = group.rows.map(r => `<tr>${
    group.columns.map(c => `<td data-align="${c.align||"left"}">${r.cells?.[c.key] ?? ""}</td>`).join("")
  }</tr>`).join("");
  return `<div class="bspn-stat-group">
    <div class="bspn-stat-group-title" ${accentColor ? `style="color:${accentColor}"` : ""}>
      <span>${_bspnEsc(group.title)}</span>
    </div>
    <table class="bspn-stat-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
function _bspnRenderTeamBox(team, groups) {
  if (!team) return "";
  const tables = (groups || []).map(g => _bspnRenderStatTable(g, team.primaryColor)).join("");
  const empty = (!groups || !groups.length)
    ? `<div style="color:var(--bspn-gray);font-size:.7rem;font-style:italic">No per-player stats recorded.</div>`
    : "";
  const rec = team.record ? `<div class="bspn-team-box-record">${_bspnEsc(team.record)}</div>` : "";
  return `<section class="bspn-panel" style="--team-color:${team.primaryColor}">
    <div class="bspn-team-box-head">
      <div class="bspn-team-box-name">${_bspnEsc((team.name||"").toUpperCase())}</div>
      ${rec}
    </div>
    ${tables}
    ${empty}
  </section>`;
}
function _bspnRenderScoring(plays, teamsById) {
  if (!plays?.length) {
    return `<section class="bspn-panel">
      <div class="bspn-panel-title">SCORING SUMMARY</div>
      <div style="color:var(--bspn-gray);font-size:.7rem;font-style:italic">No scoring events.</div>
    </section>`;
  }
  const TYPE_META = {
    TD:  { label:"TD",  color:"#f5c542", bg:"rgba(245,197,66,.13)"  },
    FG:  { label:"FG",  color:"#4dbdbd", bg:"rgba(77,189,189,.12)"  },
    XP:  { label:"XP",  color:"#888",    bg:"rgba(136,136,136,.08)" },
    "2PT":{ label:"2PT",color:"#a78bfa", bg:"rgba(167,139,250,.12)" },
    SAF: { label:"SAF", color:"#f87171", bg:"rgba(248,113,113,.12)" },
  };

  // Group by quarter
  const byQtr = {};
  for (const p of plays) {
    if (!byQtr[p.period]) byQtr[p.period] = [];
    byQtr[p.period].push(p);
  }

  const rows = [];
  for (const [period, events] of Object.entries(byQtr)) {
    rows.push(`<div class="bspn-scoring-qtr-hdr">${_bspnEsc(period === "Q5" ? "OT" : period)}</div>`);
    for (const p of events) {
      const tm = teamsById[p.teamId];
      const meta = TYPE_META[p.type] || TYPE_META.TD;
      // Scorer line
      let scorerHtml = "";
      if (p.scorer && p.passer) {
        scorerHtml = `${_playerLinkSmart(p.passer)} → ${_playerLinkSmart(p.scorer)}`;
      } else if (p.scorer) {
        scorerHtml = _playerLinkSmart(p.scorer);
      } else if (p.kicker) {
        scorerHtml = _playerLinkSmart(p.kicker);
      }
      const fgLabel = p.fgDist ? ` · ${p.fgDist} yds` : "";
      // Score display — bold the leading team
      const awayLead = p.awayScore > p.homeScore;
      const homeLead = p.homeScore > p.awayScore;
      const awayTm = teamsById[p.awayId];
      const homeTm = teamsById[p.homeId];
      const awayAbbr = awayTm?.abbreviation || "AWY";
      const homeAbbr = homeTm?.abbreviation || "HME";
      const scoreHtml = `
        <span class="bspn-sc-away${awayLead?" bspn-sc-lead":""}"
              style="color:${awayTm?.primaryColor||"var(--bspn-white)"}">
          ${_bspnEsc(awayAbbr)} ${p.awayScore}
        </span>
        <span class="bspn-sc-sep">–</span>
        <span class="bspn-sc-home${homeLead?" bspn-sc-lead":""}"
              style="color:${homeTm?.primaryColor||"var(--bspn-white)"}">
          ${p.homeScore} ${_bspnEsc(homeAbbr)}
        </span>`;
      const ptsBadge = `<span class="bspn-sc-pts">+${p.pts}</span>`;
      rows.push(`
        <div class="bspn-scoring-row${p.isSub?" bspn-scoring-sub":""}"
             style="background:${meta.bg};border-left:3px solid ${meta.color}">
          <div class="bspn-sc-left">
            <span class="bspn-sc-badge" style="color:${meta.color};border-color:${meta.color}">
              ${meta.label}
            </span>
            <span class="bspn-sc-team" style="color:${tm?.primaryColor||"var(--bspn-white)"}">
              ${_bspnEsc(tm?.abbreviation || "")}
            </span>
            <span class="bspn-sc-desc">
              ${scorerHtml}${fgLabel ? `<span style="color:var(--bspn-gray)">${_bspnEsc(fgLabel)}</span>` : ""}
            </span>
          </div>
          <div class="bspn-sc-right">
            ${ptsBadge}
            <div class="bspn-sc-score">${scoreHtml}</div>
          </div>
        </div>`);
    }
  }
  return `<section class="bspn-panel">
    <div class="bspn-panel-title">SCORING SUMMARY</div>
    <div class="bspn-scoring-list">${rows.join("")}</div>
  </section>`;
}
function _bspnRenderLeadersGroup(group, teamsById) {
  if (!group?.rows?.length) return "";
  const rows = group.rows.map(r => {
    const tm = teamsById[r.teamId];
    const nameLink = (typeof _playerLinkSmart === "function") ? _playerLinkSmart(r.playerName) : _bspnEsc(r.playerName);
    return `<div class="bspn-leader-row" style="--team-color:${tm?.primaryColor || "var(--bspn-gold)"}">
      <div class="bspn-leader-helm">${_bspnEsc(tm?.abbreviation || "—")}</div>
      <div class="bspn-leader-meta">
        ${r.label ? `<div class="bspn-leader-cat">${_bspnEsc(r.label)}</div>` : ""}
        <div>
          <span class="bspn-leader-name">${r.jersey ? `#${_bspnEsc(r.jersey)} ` : ""}${nameLink}</span>
          ${tm ? `<span class="bspn-leader-team">${_bspnEsc(tm.abbreviation)}</span>` : ""}
        </div>
        <div class="bspn-leader-stat">${_bspnEsc(r.statLine)}</div>
      </div>
    </div>`;
  }).join("");
  const titleClass = group.title?.includes("LEADERS") ? "accent-gold" : "";
  return `<section class="bspn-panel">
    <div class="bspn-panel-title ${titleClass}">${_bspnEsc(group.title)}</div>
    ${rows}
  </section>`;
}
function _bspnRenderNotes(notes) {
  if (!notes?.length) return "";
  return `<section class="bspn-panel">
    <div class="bspn-panel-title">GAME NOTES</div>
    <ul class="bspn-notes">
      ${notes.map(n => `<li>${_bspnEsc(n.text)}</li>`).join("")}
    </ul>
  </section>`;
}
function _bspnRenderFooter() {
  const fieldL = ` x x x x x  ──────  ┊───┊
                 ┊   ┊
 x x x x x  ──────  ┊───┊`;
  const fieldR = ` ┊───┊  ──────  x x x x x
 ┊   ┊
 ┊───┊  ──────  x x x x x`;
  return `<footer class="bspn-footer">
    <pre class="bspn-footer-field">${fieldL}</pre>
    <div class="bspn-footer-center">
      BSPN ASCII FOOTBALL v1.0
      <span class="sub">GRIDIRON. CODE. GLORY.</span>
    </div>
    <pre class="bspn-footer-field right">${fieldR}</pre>
  </footer>`;
}

function _bspnRenderPage(data) {
  if (!data) return "";
  const { summary, comparisonStats, awayBoxScoreGroups, homeBoxScoreGroups,
    scoringSummary, leaderGroups, topPerformers, injuryRecap, gameNotes } = data;
  const teamsById = {
    [summary.awayTeam.id]: summary.awayTeam,
    [summary.homeTeam.id]: summary.homeTeam,
  };
  return `<div class="bspn-root" style="--away-color:${summary.awayTeam.primaryColor};--home-color:${summary.homeTeam.primaryColor}">
    ${_bspnRenderHeader()}
    <div class="bspn-subbar">
      <button type="button" class="bspn-back" onclick="showFranchiseDashboard()">‹ Return to Main Screen</button>
    </div>
    <div class="bspn-container">
      ${_bspnRenderSummary(summary)}
      <div class="bspn-grid">
        <div>
          ${_bspnRenderComparison(comparisonStats, summary.awayTeam, summary.homeTeam)}
          <div class="bspn-teams-row">
            ${_bspnRenderTeamBox(summary.awayTeam, awayBoxScoreGroups)}
            ${_bspnRenderTeamBox(summary.homeTeam, homeBoxScoreGroups)}
          </div>
        </div>
        <aside>
          ${(leaderGroups || []).map(g => _bspnRenderLeadersGroup(g, teamsById)).join("")}
          ${topPerformers ? _bspnRenderLeadersGroup(topPerformers, teamsById) : ""}
          ${_bspnRenderScoring(scoringSummary, teamsById)}
          ${_bspnRenderInjuryRecap(injuryRecap)}
          ${_bspnRenderNotes(gameNotes)}
        </aside>
      </div>
    </div>
    ${_bspnRenderFooter()}
  </div>`;
}

// Slots whose snap shares the engine actually honors today. Defensive
// + OL/K/P slots can be edited and are stored, but they're advisory
// (engine doesn't rotate those positions per-snap yet).
const SNAP_ENGINE_SLOTS = new Set(["QB","RB1","WR1","WR2","TE1"]);
// Rough snaps per game per side, used for the "≈ X snaps/G" readout.
const SNAPS_PER_GAME = 65;

let _snapActiveUnit = "OFF";
function frnSnapSetTab(unit) {
  if (!DEPTH_UNIT_LABELS[unit]) return;
  _snapActiveUnit = unit;
  renderFrnSnapShares();
}

function frnSnapSet(slotKey, pct) {
  const myId = franchise.chosenTeamId;
  if (!franchise.snapShares) franchise.snapShares = {};
  if (!franchise.snapShares[myId]) franchise.snapShares[myId] = {};
  const slotDef = [...DEPTH_CHART_SLOTS.offense, ...DEPTH_CHART_SLOTS.defense, ...DEPTH_CHART_SLOTS.specialTeams]
    .find(s => s.key === slotKey);
  const floor = slotDef?.snapFloor ?? 35;
  const ceil  = slotDef?.snapCeil  ?? 98;
  const clamped = Math.max(floor, Math.min(ceil, Math.round(+pct || 0)));
  franchise.snapShares[myId][slotKey] = { starterPct: clamped, manual: true };
  saveFranchise();
  renderFrnSnapShares();
}

function frnSnapResetSlot(slotKey) {
  const myId = franchise.chosenTeamId;
  const dc   = franchise.depthChart?.[myId];
  if (!dc || !dc[slotKey]) return;
  const roster = franchise.rosters[myId] || [];
  const starter = roster.find(p => p.pid === dc[slotKey].starter);
  const backup  = roster.find(p => p.pid === dc[slotKey].backup);
  const optimal = _computeOptimalPct(starter, backup, dc[slotKey].snapFloor, dc[slotKey].snapCeil);
  if (!franchise.snapShares) franchise.snapShares = {};
  if (!franchise.snapShares[myId]) franchise.snapShares[myId] = {};
  franchise.snapShares[myId][slotKey] = optimal;
  saveFranchise();
  renderFrnSnapShares();
}

async function frnSnapResetAll() {
  if (!await _frnConfirm("Reset every slot's snap share to the auto-recommended value? Clears all manual edits.")) return;
  _optimizeSnapShares(franchise.chosenTeamId);
  // _optimizeSnapShares skips manual=true slots, so wipe the flags first.
  const ss = franchise.snapShares?.[franchise.chosenTeamId] || {};
  for (const k of Object.keys(ss)) ss[k].manual = false;
  _optimizeSnapShares(franchise.chosenTeamId);
  saveFranchise();
  renderFrnSnapShares();
}

function frnSnapClearManual() {
  const ss = franchise.snapShares?.[franchise.chosenTeamId] || {};
  let cleared = 0;
  for (const k of Object.keys(ss)) {
    if (ss[k].manual) { ss[k].manual = false; cleared++; }
  }
  saveFranchise();
  alert(`Cleared manual flag on ${cleared} slot${cleared===1?"":"s"} — they'll re-optimize automatically on depth-chart changes.`);
  renderFrnSnapShares();
}

function renderFrnSnapShares() {
  frnHoverTipHide(); _frnHoverTipPgHide && _frnHoverTipPgHide();
  const myId   = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const roster = franchise.rosters[myId] || [];
  if (!franchise.depthChart?.[myId]) _initDepthChart(myId);
  const dc = franchise.depthChart[myId];
  const ss = franchise.snapShares?.[myId] || {};

  const byPid = {};
  for (const p of roster) if (p.pid) byPid[p.pid] = p;

  const staminaCol = (s) => s >= 80 ? "var(--green-lt)" : s >= 65 ? "var(--gold-lt)" : "#ff6b6b";
  const staminaWarn = (pct, stam) => (pct > 80 && stam < 55) || (pct > 65 && stam < 65);

  // Rotation backup = best-OVR roster player at this position who isn't
  // already a starter in any slot of the position group. This is what
  // the engine actually subs in per snap (it can't pick someone already
  // on the field). For non-rotating positions we fall back to the
  // depth-chart cascade backup, which represents the injury sub.
  const _rotationBackup = (pos, starterPidsInGroup) => {
    return roster
      .filter(p => p.position === pos && !starterPidsInGroup.has(p.pid))
      .sort((a, b) => (b.overall || 0) - (a.overall || 0))[0] || null;
  };

  // Project each player's total snaps/game across every slot they
  // appear in (starter or rotation backup). Used to surface when one
  // guy is effectively playing 95%+ of snaps from multiple roles.
  const projectedSnaps = {};
  const addSnaps = (pid, n) => { if (pid) projectedSnaps[pid] = (projectedSnaps[pid] || 0) + n; };

  let totalConflicts = 0;
  const manualCount = Object.values(ss).filter(s => s?.manual).length;

  // Per-unit tabs (matches depth-chart pattern)
  const tabsHtml = `<div class="frn-dc-tabs">
    ${Object.entries(DEPTH_UNIT_LABELS).map(([key, u]) => {
      const groups = DEPTH_POS_GROUPS.filter(g => g.unit === key);
      const slots  = groups.flatMap(g => g.slots);
      let conflicts = 0;
      for (const slotKey of slots) {
        const slot = dc[slotKey]; if (!slot?.starter) continue;
        const starter = byPid[slot.starter]; if (!starter) continue;
        const pct = ss[slotKey]?.starterPct ?? 75;
        if (staminaWarn(pct, starter._stamina ?? 75)) conflicts++;
      }
      if (key === _snapActiveUnit) totalConflicts = conflicts;
      const active = key === _snapActiveUnit;
      return `<button class="frn-dc-tab${active?" active":""}" onclick="frnSnapSetTab('${key}')" style="--unit-color:${u.color}">
        <span class="frn-dc-tab-icon">${u.icon}</span>
        <span class="frn-dc-tab-title">${u.name}</span>
        ${conflicts ? `<span class="frn-dc-tab-mis" title="${conflicts} stamina conflict${conflicts>1?"s":""}">⚠ ${conflicts}</span>` : ""}
      </button>`;
    }).join("")}
  </div>`;

  const renderSlotRow = (slotKey, slotDef, groupStarterPids) => {
    const slot    = dc[slotKey] || {};
    const starter = slot.starter ? byPid[slot.starter] : null;
    const cascadeBackup = slot.backup ? byPid[slot.backup] : null;
    const rotates = SNAP_ENGINE_SLOTS.has(slotKey);
    // Engine-rotating slots show the real per-snap sub (next-best player
    // at the position not already starting in any group slot). For
    // non-rotating slots, fall back to the depth-chart cascade (injury sub).
    const backup = rotates ? _rotationBackup(slotDef.pos, groupStarterPids) : cascadeBackup;
    const share   = ss[slotKey] || _computeOptimalPct(starter, cascadeBackup, slotDef.snapFloor, slotDef.snapCeil);
    const pct     = share.starterPct ?? 75;
    const floor   = slotDef.snapFloor ?? 35;
    const ceil    = slotDef.snapCeil  ?? 98;
    const stam    = starter?._stamina ?? 75;
    const isManual  = !!share.manual;
    const isConflict = starter && staminaWarn(pct, stam);
    const sSnaps  = Math.round(SNAPS_PER_GAME * pct / 100);
    const bSnaps  = SNAPS_PER_GAME - sSnaps;
    // Tally projected snaps for the player(s) actually filling this slot.
    addSnaps(starter?.pid, sSnaps);
    if (rotates) addSnaps(backup?.pid, bSnaps);
    const cascadeNote = (rotates && cascadeBackup && cascadeBackup !== backup)
      ? `<span class="frn-snap-cascade" title="Cascade backup (injury sub): ${cascadeBackup.name} — slides up from another slot, can't take per-snap reps">⤴ INJ: ${cascadeBackup.name.split(" ").slice(-1)[0]}</span>`
      : "";
    const playerCell = (p, snaps, faded, kind) => {
      if (!p) return `<div class="frn-snap-player empty"><span class="frn-snap-empty">— open —</span></div>`;
      const escName = (p.name||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
      const escPid  = (p.pid||"").replace(/'/g,"\\'");
      const pStam = p._stamina ?? 75;
      return `<div class="frn-snap-player${faded?" faded":""}" data-pid="${p.pid||""}" data-kind="${kind}">
        <span class="frn-snap-name" onclick="frnOpenPlayerCard('${escName}','${escPid}')">${p.name}</span>
        <span class="frn-snap-meta">${p.position} · ${p.overall||"—"} OVR · age ${p.age||"?"}</span>
        <div class="frn-snap-stam-row">
          <span class="frn-snap-stam" title="Stamina ${pStam}" style="color:${staminaCol(pStam)};border-color:${staminaCol(pStam)}55">STAM ${pStam}</span>
          <span class="frn-snap-snaps">≈ ${snaps} snaps/G</span>
        </div>
        ${kind==="backup" && !rotates ? `<span class="frn-snap-injtag" title="Cascade — slides up only on starter injury, not per-snap rotation">↑ INJ SUB</span>` : ""}
      </div>`;
    };
    return `<div class="frn-snap-row${isConflict?" conflict":""}">
      <div class="frn-snap-slot">
        <div class="frn-snap-slot-key">${slotKey}</div>
        ${!rotates ? `<div class="frn-snap-advisory" title="Engine doesn't rotate this position per-snap yet — preference is stored but not simulated">ADV</div>` : ""}
        ${isManual ? `<div class="frn-snap-manual" title="You've manually set this — it won't re-optimize on depth-chart changes">📌</div>` : ""}
      </div>
      ${playerCell(starter, sSnaps, false, "starter")}
      <div class="frn-snap-slider-col">
        <div class="frn-snap-pct">${pct}%</div>
        <input type="range" class="frn-snap-slider"
               min="${floor}" max="${ceil}" step="1" value="${pct}"
               oninput="this.nextElementSibling.textContent=this.value+'%';"
               onchange="frnSnapSet('${slotKey}', this.value)">
        <div class="frn-snap-range">${floor} — ${ceil}</div>
        ${isConflict ? `<div class="frn-snap-warn" title="High snap share + low stamina = high injury / late-game drop-off risk">⚠ STAMINA</div>` : ""}
        ${cascadeNote}
      </div>
      ${playerCell(backup, bSnaps, true, "backup")}
      <div class="frn-snap-actions">
        <button class="frn-dc-ctrl-btn" onclick="frnSnapResetSlot('${slotKey}')" title="Reset to auto-recommended value">↺</button>
      </div>
    </div>`;
  };

  const activeGroups = DEPTH_POS_GROUPS.filter(g => g.unit === _snapActiveUnit);
  const groupSections = activeGroups.map(group => {
    const slotDefs = [...DEPTH_CHART_SLOTS.offense, ...DEPTH_CHART_SLOTS.defense, ...DEPTH_CHART_SLOTS.specialTeams]
      .filter(s => group.slots.includes(s.key));
    const groupStarterPids = new Set(group.slots.map(k => dc[k]?.starter).filter(Boolean));
    const rows = slotDefs.map(sd => renderSlotRow(sd.key, sd, groupStarterPids)).join("");
    return `<div class="frn-snap-group">
      <div class="frn-snap-group-hdr">
        <span class="frn-snap-group-pos">${group.pos}</span>
        <span class="frn-snap-group-label">${group.label}</span>
      </div>
      ${rows}
    </div>`;
  }).join("");

  // Iron-man load: any player whose total projected snaps in this unit
  // (starter slot + rotation backup slot) is approaching or exceeding
  // game-long usage. Surfaces same-name players doing double duty.
  const ironRows = [];
  for (const [pid, snaps] of Object.entries(projectedSnaps)) {
    if (snaps >= SNAPS_PER_GAME * 0.92) {
      const p = byPid[pid];
      if (p) ironRows.push({ p, snaps });
    }
  }
  ironRows.sort((a, b) => b.snaps - a.snaps);
  const ironStrip = ironRows.length ? `<div class="frn-snap-iron-strip">
    <span class="frn-snap-iron-title">⚙ IRON-MAN LOAD</span>
    ${ironRows.map(({ p, snaps }) => {
      const pStam = p._stamina ?? 75;
      const col = snaps >= SNAPS_PER_GAME ? "#ff6b6b" : "var(--gold-lt)";
      return `<span class="frn-snap-iron-tag" style="border-color:${col}55;color:${col}">${p.name} · ${snaps}/${SNAPS_PER_GAME} snaps · STAM ${pStam}</span>`;
    }).join("")}
  </div>` : "";

  $("frnHomeContent").innerHTML = `
    <div class="frn-dc-page-header">
      <div class="frn-dc-title">
        <span style="font-size:1.05rem;font-weight:900;color:var(--gold)">⚡ SNAP PERCENTAGES</span>
        <span class="frn-dc-team-name">${myTeam.city} ${myTeam.name}</span>
        <span class="frn-dc-ratings">${manualCount} manual · ${totalConflicts} stamina conflict${totalConflicts===1?"":"s"} in this unit</span>
      </div>
      <div style="display:flex;gap:.45rem;align-items:center">
        <button class="frn-dc-auto-btn hot" onclick="frnSnapResetAll()">⟳ AUTO ALL <span class="frn-dc-auto-count">recompute every slot</span></button>
        ${manualCount ? `<button class="btn btn-outline" onclick="frnSnapClearManual()" style="font-size:.6rem">📌 CLEAR ${manualCount} MANUAL</button>` : ""}
        <button class="btn btn-outline" onclick="renderFrnDepthChart()" style="font-size:.6rem">→ DEPTH CHART</button>
        <button class="btn btn-outline" onclick="showFranchiseDashboard()">← Back</button>
      </div>
    </div>
    ${tabsHtml}
    <div class="frn-dc-hint">backup shown = who actually rotates in per snap · ⤴ INJ = different player slides up only on injury · ⚠ = high snaps + low stamina · ADV = preference only · 📌 = manual</div>
    ${ironStrip}
    <div class="frn-snap-table">${groupSections}</div>`;
}

function renderFrnPastGame(week, homeId, awayId) {
  frnHoverTipHide();
  _frnHoverTipPgHide();
  const g = (franchise.schedule || []).find(x =>
    x.week === Number(week) && x.homeId === Number(homeId) && x.awayId === Number(awayId) && x.played);
  if (!g) { alert("Game data not available."); return; }
  const data = _franchiseGameToBSPNData(g, Number(week));
  $("frnHomeContent").innerHTML = _bspnRenderPage(data);
}


function _frnHoverTipPgHide() {
  const tip = document.getElementById("frn-pg-tip");
  if (tip) tip.style.display = "none";
}

// ESPN-parody logo for the box-score header. Block-letter ASCII
// using Unicode box-drawing chars. (Bootleg Sports Programming Network.)
const BSPN_LOGO = `██████╗ ███████╗██████╗ ███╗   ██╗
██╔══██╗██╔════╝██╔══██╗████╗  ██║
██████╔╝███████╗██████╔╝██╔██╗ ██║
██╔══██╗╚════██║██╔═══╝ ██║╚██╗██║
██████╔╝███████║██║     ██║ ╚████║
╚═════╝ ╚══════╝╚═╝     ╚═╝  ╚═══╝`;

function _wxIcon(label) {
  switch (label) {
    case "RAIN":  return "🌧";
    case "SNOW":  return "❄";
    case "WINDY": return "💨";
    case "HOT":   return "☀";
    default:      return "";
  }
}

// Quick hover tooltip on a played-game row in the schedule.
function frnPastGameTipShow(e, week, homeId, awayId) {
  const g = (franchise.schedule || []).find(x =>
    x.week === Number(week) && x.homeId === Number(homeId) && x.awayId === Number(awayId) && x.played);
  if (!g) return;
  let tip = document.getElementById("frn-pg-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "frn-pg-tip";
    tip.className = "frn-team-tooltip";
    document.body.appendChild(tip);
  }
  const home = getTeam(g.homeId), away = getTeam(g.awayId);
  const stats = g.stats;
  let topLines = "";
  if (stats) {
    const allPlayers = [];
    for (const side of ["home","away"]) {
      const players = stats[side]?.players || {};
      for (const p of Object.values(players)) {
        const team = side === "home" ? home : away;
        if ((p.pass_yds||0) >= 200) allPlayers.push(`${p.name} (${team.name}): ${p.pass_yds} pass yds, ${p.pass_td||0} TD`);
        else if ((p.rush_yds||0) >= 80) allPlayers.push(`${p.name} (${team.name}): ${p.rush_yds} rush yds`);
        else if ((p.rec_yds||0) >= 80) allPlayers.push(`${p.name} (${team.name}): ${p.rec_yds} rec yds`);
      }
    }
    topLines = allPlayers.slice(0, 4).map(l => `<div class="frn-tip-bullet">• ${l}</div>`).join("");
  }
  tip.innerHTML = `
    <div class="frn-tip-head"><span style="font-weight:900">W${week}</span></div>
    <div style="margin-bottom:.25rem">
      <b>${away.name} ${g.awayScore}</b> @ <b>${home.name} ${g.homeScore}</b>
    </div>
    ${topLines || `<div class="frn-tip-bullet" style="color:var(--gray)">No stat lines recorded</div>`}
    <div class="frn-tip-foot">Click to see full box score</div>`;
  tip.style.display = "block";
  const rect = e.currentTarget.getBoundingClientRect();
  const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
  let left = rect.right + 8;
  if (left + tipW > window.innerWidth - 8) left = rect.left - tipW - 8;
  let top = rect.top;
  if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8;
  if (top < 8) top = 8;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}
function frnPastGameTipHide() {
  const tip = document.getElementById("frn-pg-tip");
  if (tip) tip.style.display = "none";
}

function _buildWeekReviewCard(week, myId) {
  // Your team's game this week
  const myGame = franchise.schedule.find(g => g.week === week &&
    (g.homeId === myId || g.awayId === myId));
  const isHome = myGame && myGame.homeId === myId;
  const myScore = myGame ? (isHome ? myGame.homeScore : myGame.awayScore) : 0;
  const oppScore = myGame ? (isHome ? myGame.awayScore : myGame.homeScore) : 0;
  const opp = myGame ? getTeam(isHome ? myGame.awayId : myGame.homeId) : null;
  const won = myScore > oppScore;
  const resultTag = won ? `<span style="color:var(--green-lt)">W ${myScore}-${oppScore}</span>`
                        : `<span style="color:var(--red)">L ${myScore}-${oppScore}</span>`;

  // Top result lines: blowouts/upsets this week
  const weekNews = (franchise.news || []).filter(n => n.season === franchise.season && n.week === week).slice(-6);
  const newsLis = weekNews.length ? weekNews.map(n => `<li>${n.label}</li>`).join("")
                : `<li style="color:var(--gray);font-style:italic">Quiet week around the league.</li>`;

  // Weekly tasks count
  const negs = franchise.faNegotiations || {};
  const activeNegs = Object.values(negs).filter(n => n.state === "negotiating");
  const outbidCount = activeNegs.filter(n => {
    if (!n.yourBid) return false;
    const high = _faNegCurrentHigh(n);
    return high && !high.isYou;
  }).length;

  // Your injuries
  const myInjuries = (franchise.rosters[myId] || []).filter(p => p.injury && p.injury.weeksRemaining > 0);

  const tasksHtml = `
    <div class="frn-week-tasks">
      ${outbidCount > 0
        ? `<div class="frn-week-task urgent">
            <span>⚡ ${outbidCount} FA negotiation${outbidCount>1?"s":""} where you've been outbid</span>
            <button class="btn btn-gold" onclick="renderFrnFANegotiations()" style="font-size:.65rem">Respond</button>
          </div>` : ""}
      ${activeNegs.length > outbidCount
        ? `<div class="frn-week-task">
            <span>🆓 ${activeNegs.length - outbidCount} FA negotiation${activeNegs.length-outbidCount>1?"s":""} active</span>
            <button class="btn btn-outline" onclick="renderFrnFANegotiations()" style="font-size:.65rem">View</button>
          </div>` : ""}
      ${myInjuries.length
        ? `<div class="frn-week-task">
            <span>🩹 ${myInjuries.length} player${myInjuries.length>1?"s":""} on injured list</span>
          </div>` : ""}
      ${(() => {
        const pendingTrades = (franchise.tradeOffers||[]).filter(o => o.status === "pending");
        return pendingTrades.length
          ? `<div class="frn-week-task urgent">
              <span>📨 ${pendingTrades.length} trade offer${pendingTrades.length>1?"s":""} pending</span>
              <button class="btn btn-gold" onclick="frnOpenTrade(null,'offers')" style="font-size:.65rem">Review</button>
            </div>`
          : "";
      })()}
      ${week <= TRADE_DEADLINE_WEEK
        ? `<div class="frn-week-task">
            <span>🔀 Trade deadline: Week ${TRADE_DEADLINE_WEEK} (${TRADE_DEADLINE_WEEK - week} weeks left)</span>
            <button class="btn btn-outline" onclick="frnOpenTrade()" style="font-size:.65rem">Trade Block</button>
          </div>` : ""}
    </div>`;

  return `
    <div class="frn-next-card" style="border-color:var(--gold-lt)">
      <div class="frn-next-header">
        <span>WEEK ${week} COMPLETE</span>
        <span class="frn-next-badge">REVIEW</span>
      </div>
      <div style="text-align:center;margin-bottom:.7rem">
        <div style="font-size:.7rem;color:var(--gray);letter-spacing:.5px;margin-bottom:.2rem">YOUR GAME</div>
        <div style="font-size:1.1rem;font-weight:900">
          ${resultTag} ${opp ? `${isHome?"vs":"@"} ${teamLink(opp)}` : ""}
        </div>
      </div>
      <div class="frn-card-title" style="margin-top:.4rem">📰 LEAGUE WIRE — WEEK ${week}</div>
      <ul class="frn-week-news">${newsLis}</ul>
      <div class="frn-card-title" style="margin-top:.6rem">📋 WEEKLY TASKS</div>
      ${tasksHtml}
      <div class="frn-next-actions">
        <button class="btn btn-gold-big" onclick="frnConfirmAdvanceWeek()">▶ ADVANCE TO WEEK ${week + 1}</button>
        ${_renderSimForwardPanel()}
      </div>
    </div>`;
}

// ── Opponent intel block: shown beneath the next-game matchup card ────────────
// Pulls recent form, PPG / PA averages, injury list, current top performers,
// and head-to-head this season — all data we already have. Marked OPP INTEL
// so the user knows where it comes from.
// Late-season "must-win" detection — flagged in opp intel banner.
// True when (a) week ≥ 10 and (b) user trails in division OR on the
// playoff bubble (rank 7 or 8 in their conference).
function _isMustWinForUser(week, nextGame) {
  if (week < 10) return false;
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const oppId = nextGame.homeId === myId ? nextGame.awayId : nextGame.homeId;
  const opp = getTeam(oppId);
  // (a) Division opponent + I'm not currently leading
  if (opp && myTeam && opp.division === myTeam.division && opp.conference === myTeam.conference) {
    const divTeams = standingsSorted().filter(t => t.team?.division === myTeam.division && t.team?.conference === myTeam.conference);
    if (divTeams[0]?.id !== myId) return true;
  }
  // (b) On the playoff bubble in own conference
  const confTeams = standingsSorted().filter(t => t.team?.conference === myTeam.conference);
  const myRank = confTeams.findIndex(t => t.id === myId) + 1;
  if (myRank >= 5 && myRank <= 8) return true;
  return false;
}

function _buildOpponentIntelBlock(oppId, isHome, week, nextGame) {
  const myId = franchise.chosenTeamId;
  const opp = getTeam(oppId);
  if (!opp) return "";
  const oppStand = franchise.standings?.[oppId] || { w:0, l:0, t:0, pf:0, pa:0 };
  const gp = (oppStand.w||0) + (oppStand.l||0) + (oppStand.t||0);
  const ppg = gp ? ((oppStand.pf||0) / gp).toFixed(1) : "—";
  const paPg = gp ? ((oppStand.pa||0) / gp).toFixed(1) : "—";
  const diff = (oppStand.pf||0) - (oppStand.pa||0);
  const diffColor = diff > 0 ? "var(--green-lt)" : diff < 0 ? "#c08080" : "var(--gray)";
  const diffStr = `${diff > 0 ? "+" : ""}${diff}`;
  // Last 3 results
  const lastGames = (franchise.schedule || [])
    .filter(g => g.played && (g.homeId === oppId || g.awayId === oppId))
    .sort((a, b) => b.week - a.week).slice(0, 3);
  const formHtml = lastGames.length ? lastGames.map(g => {
    const oppIsHome = g.homeId === oppId;
    const my = oppIsHome ? g.homeScore : g.awayScore;
    const them = oppIsHome ? g.awayScore : g.homeScore;
    const otherTeam = getTeam(oppIsHome ? g.awayId : g.homeId);
    const wl = my > them ? "W" : my < them ? "L" : "T";
    const wlColor = wl === "W" ? "var(--green-lt)" : wl === "L" ? "#c08080" : "var(--gray)";
    return `<span class="frn-opp-form-pill" style="color:${wlColor}" title="W${g.week} ${oppIsHome?"vs":"@"} ${otherTeam?.name||"?"}">${wl} ${my}-${them}</span>`;
  }).join(" ") : `<span style="color:var(--gray);font-style:italic">No prior games</span>`;

  // Top players — pulled by scout grade with whatever intel level we have
  const myRosterSorted = (franchise.rosters[myId] || []).slice()
    .sort((a, b) => scoutGrade(b) - scoutGrade(a));
  const oppRoster = (franchise.rosters[oppId] || []).slice()
    .sort((a, b) => scoutGrade(b) - scoutGrade(a));
  const scouted = !!franchise.scoutingIntel?.[oppId] &&
    franchise.scoutingIntel[oppId].season === franchise.season;

  // Side-by-side starters comparison
  const keyPositions = ["QB","RB","WR","DL","LB","CB"];
  const myTeam = getTeam(myId);
  const starterRows = keyPositions.map(pos => {
    const myP  = myRosterSorted.find(p => p.position === pos);
    const oppP = oppRoster.find(p => p.position === pos);
    if (!myP && !oppP) return "";
    const myCell = myP
      ? `<span style="font-weight:700;font-size:.68rem">${playerLink(myP)}</span>
         <span>${gradeBadge(myP)}</span>
         <span style="color:var(--gray);font-size:.58rem">Age ${myP.age||"?"}</span>`
      : `<span style="color:var(--gray);font-size:.65rem">—</span>`;
    const oppCell = oppP
      ? `<span style="color:var(--gray);font-size:.58rem">Age ${oppP.age||"?"}</span>
         <span>${gradeBadge(oppP)}</span>
         <span style="font-weight:700;font-size:.68rem">${playerLink(oppP)}</span>`
      : `<span style="color:var(--gray);font-size:.65rem">—</span>`;
    return `<div class="frn-matchup-starters-row">
      <div class="frn-matchup-starter-my">${myCell}</div>
      <span class="frn-opp-keyplayer-pos">${pos}</span>
      <div class="frn-matchup-starter-opp">${oppCell}</div>
    </div>`;
  }).join("");

  // Both teams' injuries
  const myInjured  = myRosterSorted.filter(p => p.injury && p.injury.weeksRemaining > 0).slice(0, 3);
  const oppInjured = oppRoster.filter(p => p.injury && p.injury.weeksRemaining > 0).slice(0, 4);
  const allInjuries = [
    ...myInjured.map(p => ({ side: "YOU", p, color: "#ffb0b0" })),
    ...oppInjured.map(p => ({ side: "OPP", p, color: "#ff9090" })),
  ];
  const injuryHtml = allInjuries.length ? `
    <div class="frn-opp-intel-row">
      <div class="frn-card-title" style="margin-bottom:.3rem">🩹 INJURY REPORT</div>
      ${allInjuries.map(({ side, p, color }) => `
        <div style="font-size:.68rem;color:${color};display:flex;gap:.4rem;align-items:center;padding:.1rem 0">
          <span style="color:${side==="YOU"?"var(--gold-lt)":"#c08080"};font-size:.55rem;font-weight:700;border:1px solid currentColor;padding:.05rem .22rem;flex-shrink:0">${side}</span>
          ${p.position} ${playerLink(p)} — ${_bspnEsc(p.injury.label)} (${p.injury.weeksRemaining}wk)
        </div>`).join("")}
    </div>` : "";

  // ── TRAINER'S PRE-GAME LOAD RISK ─────────────────────────────────
  // For my team only: surface healthy starters with elevated wear or
  // stress so the user knows who's at risk BEFORE they play.
  // Includes a tag for each: CRITICAL / HIGH / ELEVATED.
  const loadRisks = myRosterSorted
    .filter(p => !p.injury || !p.injury.weeksRemaining)
    .map(p => ({
      p,
      wear: p._wear || 0,
      stress: p._stress || 0,
      maxLoad: Math.max(p._wear || 0, p._stress || 0),
    }))
    .filter(x => x.maxLoad >= 50)
    .sort((a, b) => b.maxLoad - a.maxLoad)
    .slice(0, 5);
  const loadHtml = loadRisks.length ? `
    <div class="frn-opp-intel-row">
      <div class="frn-card-title" style="margin-bottom:.3rem">⚕ TRAINER'S LOAD REPORT</div>
      ${loadRisks.map(({ p, wear, stress, maxLoad }) => {
        const tag = maxLoad >= 85 ? `<span style="color:#e6373a;font-weight:800;font-size:.55rem;letter-spacing:.5px">CRITICAL</span>`
                  : maxLoad >= 70 ? `<span style="color:#ed6a3a;font-weight:700;font-size:.55rem;letter-spacing:.5px">HIGH</span>`
                  : `<span style="color:#f0a93a;font-weight:700;font-size:.55rem;letter-spacing:.5px">ELEVATED</span>`;
        const recurrence = (p.injuryHistory || []).filter(h => h.season === franchise.season).length;
        const recurrenceNote = recurrence ? ` · ${recurrence} prior injury${recurrence>1?'ies':''} this season` : "";
        const ageNote = p.age >= 33 ? ` · age ${p.age}` : "";
        const wearBar = `<span style="display:inline-block;background:rgba(255,255,255,.08);height:5px;width:35px;vertical-align:middle;border-radius:1px;position:relative;margin:0 .2rem">
          <span style="position:absolute;left:0;top:0;height:5px;width:${Math.min(100,wear)}%;background:${wear>=85?'#e6373a':wear>=70?'#ed6a3a':wear>=50?'#f0a93a':'#3fdf83'};border-radius:1px"></span></span>`;
        const stressBar = `<span style="display:inline-block;background:rgba(255,255,255,.08);height:5px;width:35px;vertical-align:middle;border-radius:1px;position:relative;margin:0 .2rem">
          <span style="position:absolute;left:0;top:0;height:5px;width:${Math.min(100,stress)}%;background:${stress>=80?'#e6373a':stress>=60?'#ed6a3a':stress>=40?'#f0a93a':'#3fdf83'};border-radius:1px"></span></span>`;
        return `<div style="font-size:.66rem;display:flex;gap:.4rem;align-items:center;padding:.15rem 0;color:rgba(255,255,255,.85)">
          ${tag}
          <span style="flex-shrink:0;color:var(--gray);min-width:32px;font-size:.6rem">${p.position}</span>
          <span style="flex:1;min-width:0;font-weight:600">${playerLink(p)}</span>
          <span style="color:var(--gray);font-size:.55rem;letter-spacing:.5px">W</span>${wearBar}<span style="color:rgba(255,255,255,.7);font-size:.6rem;min-width:24px;text-align:right">${wear.toFixed(0)}</span>
          <span style="color:var(--gray);font-size:.55rem;letter-spacing:.5px;margin-left:.3rem">S</span>${stressBar}<span style="color:rgba(255,255,255,.7);font-size:.6rem;min-width:24px;text-align:right">${stress.toFixed(0)}</span>
        </div>${recurrenceNote || ageNote ? `<div style="font-size:.55rem;color:var(--gray);padding:.05rem 0 .2rem 4rem;font-style:italic">${recurrenceNote}${ageNote}</div>` : ""}`;
      }).join("")}
      <div style="margin-top:.35rem;font-size:.55rem;color:var(--gray);letter-spacing:.3px;font-style:italic">
        Wear = contact damage · Stress = non-contact load (sprints/cuts). Either ≥ 85 fires injury risk +60%.
      </div>
    </div>` : "";

  // Head-to-head this season
  const h2h = (franchise.schedule || []).filter(g => g.played &&
    ((g.homeId === oppId && g.awayId === myId) ||
     (g.awayId === oppId && g.homeId === myId)));
  const h2hHtml = h2h.length ? `
    <div class="frn-opp-intel-row">
      <div class="frn-card-title" style="margin-bottom:.25rem">📜 HEAD-TO-HEAD (S${franchise.season})</div>
      ${h2h.map(g => {
        const youHome = g.homeId === myId;
        const youScore = youHome ? g.homeScore : g.awayScore;
        const themScore = youHome ? g.awayScore : g.homeScore;
        const wl = youScore > themScore ? "W" : youScore < themScore ? "L" : "T";
        const color = wl === "W" ? "var(--green-lt)" : wl === "L" ? "#c08080" : "var(--gray)";
        return `<div style="font-size:.7rem">
          <span style="color:${color};font-weight:700">${wl}</span>
          ${youScore}-${themScore} (Wk ${g.week}, ${youHome?"home":"away"})
          <a href="javascript:void(0)" onclick="renderFrnPastGame(${g.week},${g.homeId},${g.awayId})"
             style="color:var(--gold);margin-left:.3rem">box →</a>
        </div>`;
      }).join("")}
    </div>` : "";

  const intelTag = scouted
    ? `<span class="frn-opp-intel-tag scouted">🏟 SCOUTED — sharp grades</span>`
    : `<span class="frn-opp-intel-tag">noisy grades · run a scrimmage to sharpen</span>`;

  const venueStr = isHome ? `Home — ${getTeam(myId).city}` : `Away @ ${opp.city}`;
  const mustWinTag = _isMustWinForUser(week, nextGame)
    ? `<span style="color:#ff5a5a;background:rgba(255,80,80,0.15);border:1px solid #ff5a5a;padding:.1rem .35rem;margin-left:.4rem;font-size:.55rem;letter-spacing:.5px">🚨 MUST WIN</span>`
    : "";

  return `<div class="frn-opp-intel">
    <div class="frn-opp-intel-head">
      <div class="frn-card-title" style="margin:0">📡 MATCHUP INTEL — ${opp.city} ${opp.name} ${mustWinTag}</div>
      <div style="display:flex;gap:.5rem;align-items:center">
        <span style="color:var(--gray);font-size:.62rem">${venueStr}</span>
        ${intelTag}
      </div>
    </div>
    <div class="frn-opp-intel-grid">
      <div class="frn-opp-intel-row">
        <div class="frn-card-title" style="margin-bottom:.25rem">FORM (LAST 3) · ${opp.name.toUpperCase()}</div>
        <div style="display:flex;gap:.35rem;flex-wrap:wrap">${formHtml}</div>
      </div>
      <div class="frn-opp-intel-row">
        <div class="frn-card-title" style="margin-bottom:.25rem">SCORING · ${opp.name.toUpperCase()}</div>
        <div style="font-size:.7rem">
          PPG <b style="color:var(--gold-lt)">${ppg}</b> · PAPG <b style="color:var(--gold-lt)">${paPg}</b>
          · DIFF <b style="color:${diffColor}">${diffStr}</b>
        </div>
      </div>
    </div>
    <div class="frn-opp-intel-row">
      <div class="frn-matchup-starters-header">
        <span style="color:var(--gold-lt)">${myTeam ? myTeam.name.toUpperCase() : "YOU"}</span>
        <div class="frn-card-title" style="margin:0;border:none;padding:0">KEY STARTERS</div>
        <span style="color:#c08080">${opp.name.toUpperCase()}</span>
      </div>
      <div class="frn-matchup-starters">${starterRows}</div>
    </div>
    ${injuryHtml}
    ${loadHtml}
    ${h2hHtml}
  </div>`;
}

function _buildSchemeMatchupCard(myId, oppId) {
  const myOff  = _getTeamOffScheme(myId);
  const myDef  = _getTeamDefScheme(myId);
  const oppOff = _getTeamOffScheme(oppId);
  const oppDef = _getTeamDefScheme(oppId);

  const offMod = _schemeMatchup(myOff, oppDef);   // +ve = my offense wins
  const defMod = _schemeMatchup(oppOff, myDef);   // +ve = their offense wins (bad for me)

  const modColor = m => m >= 4 ? "#00e676" : m >= 1 ? "#69f0ae" : m >= -2 ? "rgba(255,255,255,.45)" : m >= -5 ? "#ffb74d" : "#ef5350";
  const modLabel = m => m >= 4 ? "FAVORABLE" : m >= 1 ? "SLIGHT EDGE" : m >= -1 ? "NEUTRAL" : m >= -4 ? "DISADVANTAGE" : "TOUGH";

  const row = (label, myScheme, oppScheme, mod, flipped) => {
    const edgeColor = modColor(flipped ? -mod : mod);
    const verdict   = modLabel(flipped ? -mod : mod);
    const arrow     = mod > 2 ? "▲" : mod < -2 ? "▼" : "—";
    const arrowColor = mod > 2 ? "#00e676" : mod < -2 ? "#ef5350" : "rgba(255,255,255,.3)";
    return `<div style="display:flex;align-items:center;gap:.5rem;padding:.3rem 0;border-bottom:1px solid rgba(255,255,255,.06)">
      <div style="flex:1;min-width:0;text-align:right">
        <div style="font-size:.6rem;color:var(--gray);text-transform:uppercase;letter-spacing:.4px;margin-bottom:.15rem">${label}</div>
        ${_schemeBadge(myScheme, true)}
      </div>
      <div style="text-align:center;min-width:44px">
        <div style="font-size:.62rem;font-weight:700;color:${arrowColor}">${arrow}</div>
        <div style="font-size:.58rem;color:${edgeColor};font-weight:700;letter-spacing:.3px">${verdict}</div>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.6rem;color:var(--gray);text-transform:uppercase;letter-spacing:.4px;margin-bottom:.15rem">vs OPP ${label === "MY OFFENSE" ? "DEFENSE" : "OFFENSE"}</div>
        ${_schemeBadge(oppScheme, true)}
      </div>
    </div>`;
  };

  const net = offMod - defMod;
  const netColor = modColor(net);
  const verdict = net >= 5 ? "Schematic edge — exploit it" : net >= 2 ? "Slight scheme advantage" : net <= -5 ? "Scheme disadvantage" : net <= -2 ? "Slight scheme disadvantage" : "Even matchup scheme-wise";

  return `<div style="margin:.6rem 0;padding:.6rem .8rem;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.10);border-radius:6px">
    <div style="font-size:.6rem;font-weight:700;color:var(--gray);letter-spacing:.6px;text-transform:uppercase;margin-bottom:.4rem">SCHEME MATCHUP</div>
    ${row("MY OFFENSE", myOff, oppDef, offMod, false)}
    ${row("MY DEFENSE", myDef, oppOff, defMod, true)}
    <div style="margin-top:.4rem;font-size:.65rem;color:${netColor};font-weight:700">${verdict}</div>
  </div>`;
}

function _buildMatchupStatsStrip(myId, oppId, myStand, oppStand, myRtg, oppRtg) {
  const myGP  = (myStand.w||0)  + (myStand.l||0)  + (myStand.t||0);
  const oppGP = (oppStand.w||0) + (oppStand.l||0) + (oppStand.t||0);
  const myPPG   = myGP  ? ((myStand.pf||0)  / myGP).toFixed(1)  : "—";
  const myPAPG  = myGP  ? ((myStand.pa||0)  / myGP).toFixed(1)  : "—";
  const oppPPG  = oppGP ? ((oppStand.pf||0) / oppGP).toFixed(1) : "—";
  const oppPAPG = oppGP ? ((oppStand.pa||0) / oppGP).toFixed(1) : "—";
  const myDiff  = (myStand.pf||0)  - (myStand.pa||0);
  const oppDiff = (oppStand.pf||0) - (oppStand.pa||0);

  const formPills = (teamId) => {
    const games = (franchise.schedule || [])
      .filter(g => g.played && (g.homeId === teamId || g.awayId === teamId))
      .sort((a, b) => b.week - a.week).slice(0, 3);
    if (!games.length) return `<span style="color:var(--gray)">—</span>`;
    return games.map(g => {
      const isH = g.homeId === teamId;
      const my = isH ? g.homeScore : g.awayScore;
      const them = isH ? g.awayScore : g.homeScore;
      const wl = my > them ? "W" : my < them ? "L" : "T";
      const c = wl === "W" ? "var(--green-lt)" : wl === "L" ? "#c08080" : "var(--gray)";
      return `<span class="frn-opp-form-pill" style="color:${c}">${wl}</span>`;
    }).join("");
  };

  const statRow = (label, myVal, oppVal, higherBetter = true) => {
    const mn = parseFloat(myVal), on = parseFloat(oppVal);
    const myEdge  = !isNaN(mn) && !isNaN(on) && (higherBetter ? mn > on : mn < on);
    const oppEdge = !isNaN(mn) && !isNaN(on) && (higherBetter ? on > mn : on < mn);
    return `<div class="frn-matchup-stat-row">
      <span class="frn-matchup-stat-val ${myEdge ? "edge" : ""}">${myVal}</span>
      <span class="frn-matchup-stat-label">${label}</span>
      <span class="frn-matchup-stat-val ${oppEdge ? "edge" : ""}">${oppVal}</span>
    </div>`;
  };

  // Simple win probability from OFF+DEF delta
  const myTotal  = (myRtg.off  || 0) + (myRtg.def  || 0);
  const oppTotal = (oppRtg.off || 0) + (oppRtg.def || 0);
  const rawPct   = Math.round(50 + (myTotal - oppTotal) * 0.35);
  const myWinPct = Math.min(84, Math.max(16, rawPct));
  const edgeLabel = myWinPct > 53 ? `YOU FAV ${myWinPct}%`
    : myWinPct < 47 ? `OPP FAV ${100 - myWinPct}%`
    : "PICK 'EM";
  const edgeColor = myWinPct > 53 ? "var(--green-lt)"
    : myWinPct < 47 ? "#c08080"
    : "var(--gold)";

  return `<div class="frn-matchup-compare">
    <div class="frn-matchup-compare-title">SEASON STATS MATCHUP</div>
    <div class="frn-matchup-stat-row">
      <div style="display:flex;justify-content:flex-end;gap:.2rem">${formPills(myId)}</div>
      <span class="frn-matchup-stat-label">FORM L3</span>
      <div style="display:flex;justify-content:flex-start;gap:.2rem">${formPills(oppId)}</div>
    </div>
    ${statRow("PPG", myPPG, oppPPG, true)}
    ${statRow("PAPG", myPAPG, oppPAPG, false)}
    ${statRow("PT DIFF", myDiff >= 0 ? `+${myDiff}` : String(myDiff), oppDiff >= 0 ? `+${oppDiff}` : String(oppDiff), true)}
    ${statRow("OFF", myRtg.off, oppRtg.off, true)}
    ${statRow("DEF", myRtg.def, oppRtg.def, true)}
    ${typeof mffTeamEPAStatRows === "function" ? mffTeamEPAStatRows(myId, oppId, statRow) : ""}
    <div class="frn-matchup-edge-row">
      <span></span>
      <span style="color:${edgeColor};font-weight:900;font-size:.62rem;letter-spacing:.5px">⚡ ${edgeLabel}</span>
      <span></span>
    </div>
  </div>`;
}

// ── Highlight Replay Modal ────────────────────────────────────────────────────
function renderHighlightReplay(idx) {
  const h = (franchise.seasonHighlights || [])[idx];
  if (!h) return;
  const { label, type, week, isPlayoff, isClutch, clip,
          homeId, awayId, finalHome, finalAway } = h;
  const homeTeam = getTeam(homeId), awayTeam = getTeam(awayId);
  const homeName = homeTeam?.name || "HOME", awayName = awayTeam?.name || "AWAY";
  const typeColor = type === "def" ? "#4dbdbd" : type === "game" ? "#a78bfa" : "#f5c542";
  const typeBadge = type === "def" ? (isClutch ? "CLUTCH DEF" : "DEF")
                  : type === "game" ? (isClutch ? "OT" : "GAME")
                  : (isClutch ? "CLUTCH" : "OFF");

  // Fallback clip for old saves without stored clip data
  const plays = clip?.length
    ? clip
    : [{ sit: h.quarter ? `Q${h.quarter}${h.time ? " · " + h.time : ""}` : "",
         desc: label, hs: finalHome ?? 0, as: finalAway ?? 0,
         q: h.quarter, t: h.time, hi: true }];

  const playsHtml = plays.map((cp, i) => `
    <div class="frn-replay-play${cp.hi ? " frn-replay-hl" : ""}" style="animation-delay:${i * 0.52}s;border-color:${cp.hi ? typeColor + "44" : "transparent"};background:${cp.hi ? typeColor + "0d" : "transparent"}">
      ${cp.sit ? `<div class="frn-replay-sit">${cp.sit}</div>` : ""}
      <div class="frn-replay-desc ${cp.hi ? "" : "frn-replay-ctx"}">${cp.desc || (cp.hi ? label : "—")}</div>
      ${cp.hi && isClutch ? `<div class="frn-replay-clutch">⚡ CLUTCH MOMENT</div>` : ""}
      ${cp.hi ? `<div class="frn-replay-score-line">${homeName} <strong>${cp.hs}</strong> — ${awayName} <strong>${cp.as}</strong></div>` : ""}
    </div>`).join("");

  const existing = document.getElementById("frn-replay-modal");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.id = "frn-replay-modal";
  el.className = "frn-replay-overlay";
  el.innerHTML = `
    <div class="frn-replay-box">
      <div class="frn-replay-header">
        <div style="display:flex;align-items:center;gap:.65rem">
          <span class="bspnlive-logo" style="font-size:.85rem;padding:.1rem .35rem">BSPN</span>
          <span style="color:var(--blgray);font-size:.68rem;letter-spacing:.8px">${week}${isPlayoff ? " · PLAYOFF" : ""}</span>
          <span class="frn-hl-badge" style="color:${typeColor};border-color:${typeColor}55">${typeBadge}</span>
        </div>
        <button class="frn-replay-close" onclick="_closeHighlightReplay()">✕</button>
      </div>
      <div class="frn-replay-scoreboard">
        <span class="frn-replay-team">${homeName}</span>
        <span class="frn-replay-score-num">${finalHome ?? "?"}</span>
        <span class="frn-replay-score-sep">–</span>
        <span class="frn-replay-score-num">${finalAway ?? "?"}</span>
        <span class="frn-replay-team">${awayName}</span>
      </div>
      <div class="frn-replay-plays" id="frn-replay-plays-${idx}">${playsHtml}</div>
      <div class="frn-replay-footer">
        <button class="frn-cap-btn" onclick="_replayAgain(${idx})" style="font-size:.63rem">▶ Replay</button>
        <button class="frn-cap-btn" onclick="_closeHighlightReplay()" style="font-size:.63rem">Close</button>
      </div>
    </div>`;
  el.addEventListener("click", e => { if (e.target === el) _closeHighlightReplay(); });
  document.body.appendChild(el);
}

function _replayAgain(idx) {
  const list = document.getElementById(`frn-replay-plays-${idx}`);
  if (!list) return;
  list.querySelectorAll(".frn-replay-play").forEach((el, i) => {
    el.style.opacity = "0";
    el.style.animation = "none";
    el.offsetHeight; // force reflow
    el.style.animation = `frn-replay-fade .35s ease ${i * 0.52}s forwards`;
  });
}

function _closeHighlightReplay() {
  const el = document.getElementById("frn-replay-modal");
  if (el) el.remove();
}

function _buildHighlightsSidebar(teamId, seasonHighlights) {
  const allHL = franchise.seasonHighlights || [];
  // Keep track of each highlight's index in the master array for replay lookup
  const myHLIdx = allHL
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.homeId === teamId || h.awayId === teamId);

  if (!myHLIdx.length) return `<div style="color:var(--gray);font-size:.72rem;padding:.5rem 0">Highlights appear as you play.</div>`;

  // Numeric sort key: playoff games rank above regular season
  const weekOrd = h => {
    if (h.weekNum != null) return h.weekNum;
    if (h.isPlayoff) return 100 + (parseInt(h.week?.match(/\d+/)?.[0]) || 0);
    return parseInt(h.week?.match(/\d+/)?.[0]) || 0;
  };

  // Group by game (home-away-week triplet)
  const games = {};
  for (const { h, i } of myHLIdx) {
    const k = `${h.homeId}|${h.awayId}|${h.week}`;
    if (!games[k]) games[k] = { ord: weekOrd(h), items: [] };
    games[k].items.push({ h, i });
  }
  const sortedGames = Object.values(games).sort((a, b) => b.ord - a.ord);

  // Opponent context + win/loss line
  const hlCtx = (h) => {
    const oppId = h.homeId === teamId ? h.awayId : h.homeId;
    const opp   = getTeam(oppId);
    const abbr  = opp?.abbreviation || opp?.name?.slice(0, 3).toUpperCase() || "OPP";
    if (h.finalHome == null) return `vs. ${abbr}`;
    const myPts  = h.homeId === teamId ? h.finalHome : h.finalAway;
    const oppPts = h.homeId === teamId ? h.finalAway  : h.finalHome;
    const wl = myPts > oppPts ? "W" : myPts < oppPts ? "L" : "T";
    return `vs. ${abbr} — ${wl} ${myPts}-${oppPts}`;
  };

  // Visual config per type
  const typeCfg = (h) => {
    if (h.type === "def")  return { badge: h.isClutch ? "CLUTCH DEF" : "DEF",  color: "#4dbdbd" };
    if (h.type === "game") return { badge: h.isClutch ? "OT"          : "GAME", color: "#a78bfa" };
    return                        { badge: h.isClutch ? "CLUTCH"      : "OFF",  color: "#f5c542" };
  };

  // ── Featured card: best moment from most recent game ─────────────────────
  const latestGame = sortedGames[0];
  const latestSorted = latestGame.items.sort((a, b) => b.h.weight - a.h.weight);
  const { h: feat, i: featIdx } = latestSorted[0];
  const { badge: fBadge, color: fColor } = typeCfg(feat);
  const featHtml = `
    <div class="frn-hl-feat" style="border-color:${fColor}33;background:${fColor}0d">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.28rem">
        <span class="frn-hl-badge" style="color:${fColor};border-color:${fColor}55">${fBadge}</span>
        <span style="font-size:.57rem;color:var(--gray);letter-spacing:.3px">${feat.week}${feat.isPlayoff ? " · PLAYOFF" : ""}</span>
      </div>
      <div style="font-size:.6rem;color:var(--gray);margin-bottom:.3rem">${hlCtx(feat)}</div>
      <div style="font-size:.8rem;color:var(--blwhite);font-weight:700;line-height:1.3">${feat.label}</div>
      ${feat.isClutch ? `<div style="font-size:.57rem;color:#f87171;margin-top:.22rem;letter-spacing:.5px">⚡ CLUTCH MOMENT</div>` : ""}
      <button class="frn-replay-btn" onclick="renderHighlightReplay(${featIdx})" style="margin-top:.4rem">▶ Replay</button>
    </div>`;

  // ── Compact rows: top pick from each prior game (up to 4) ────────────────
  const priorBests = sortedGames.slice(1)
    .map(g => g.items.sort((a, b) => b.h.weight - a.h.weight)[0])
    .slice(0, 4);
  const compactHtml = priorBests.map(({ h, i }) => {
    const { badge, color } = typeCfg(h);
    return `
      <div class="frn-hl-row2" style="cursor:pointer" onclick="renderHighlightReplay(${i})">
        <span class="frn-hl2-badge" style="color:${color}">${badge}</span>
        <span class="frn-hl2-label">${h.label}</span>
        <span class="frn-hl2-week">${h.week}</span>
        <span style="font-size:.57rem;color:var(--gray);flex-shrink:0">▶</span>
      </div>`;
  }).join("");

  const totalGames = sortedGames.length;
  const moreBtn = totalGames > 5
    ? `<button class="frn-cap-btn" onclick="renderFrnHighlightsAll()" style="margin-top:.45rem;font-size:.6rem;width:100%">View all ${myHLIdx.length} moments →</button>`
    : "";

  return `
    ${featHtml}
    ${compactHtml ? `<div class="frn-hl-section-sep">SEASON MOMENTS</div>${compactHtml}` : ""}
    ${moreBtn}`;
}

// ── Highlights all-page state ──────────────────────────────────────────────
// Persists across renders so filter pills / scope toggle / reel index
// don't reset when the page re-paints (e.g. after replay close).
let _frnHighlightFilter = "all";   // all / off / def / game / clutch / playoffs
let _frnHighlightScope  = "team";  // team / league
let _frnReelIdx         = null;    // null off | integer index when reel-playing
function frnSetHighlightFilter(f) { _frnHighlightFilter = f; renderFrnHighlightsAll(); }
function frnSetHighlightScope(s)  { _frnHighlightScope  = s; renderFrnHighlightsAll(); }
function frnStartHighlightReel(idx) { _frnReelIdx = idx || 0; renderFrnHighlightsAll(); }
function frnReelStep(delta) {
  _frnReelIdx = (_frnReelIdx || 0) + delta;
  renderFrnHighlightsAll();
}
function frnReelExit() {
  _frnReelIdx = null;
  // Tear down the modal + reel bar before the next render.
  const m = document.getElementById("frn-replay-modal");
  if (m) m.remove();
  const b = document.getElementById("frn-hl-reel-bar");
  if (b) b.remove();
  renderFrnHighlightsAll();
}

function renderFrnHighlightsAll() {
  const { chosenTeamId, season } = franchise;
  const myTeam = getTeam(chosenTeamId);
  const allHL = franchise.seasonHighlights || [];

  // Scope: my team only, or every game in the league
  const inScope = ({ h }) => _frnHighlightScope === "league"
    ? true
    : (h.homeId === chosenTeamId || h.awayId === chosenTeamId);
  const allInScope = allHL.map((h, i) => ({ h, i })).filter(inScope);

  // Apply filter
  const matchesFilter = ({ h }) => {
    switch (_frnHighlightFilter) {
      case "off":      return h.type === "off";
      case "def":      return h.type === "def";
      case "game":     return h.type === "game";
      case "clutch":   return !!h.isClutch;
      case "playoffs": return !!h.isPlayoff;
      default:         return true;
    }
  };
  const filtered = allInScope.filter(matchesFilter);

  // ── Reel mode ───────────────────────────────────────────────────────
  // Sequential playback of filtered highlights in weight order. Wraps
  // the existing replay shell with prev/next/exit.
  if (_frnReelIdx != null) {
    // Sort filtered by weight DESC so the reel leads with the loudest moments
    const reel = filtered.slice().sort((a, b) => b.h.weight - a.h.weight);
    if (!reel.length) { _frnReelIdx = null; }
    else {
      const idx = Math.max(0, Math.min(reel.length - 1, _frnReelIdx));
      _frnReelIdx = idx;
      const { h, i } = reel[idx];
      // Render the existing replay modal for this highlight, then layer
      // the reel control bar on top. Both are cleared / replaced each step.
      const oldBar = document.getElementById("frn-hl-reel-bar");
      if (oldBar) oldBar.remove();
      renderHighlightReplay(i);
      const reelBar = document.createElement("div");
      reelBar.id = "frn-hl-reel-bar";
      reelBar.className = "frn-hl-reel-bar";
      const prevDisabled = idx === 0 ? "disabled" : "";
      const nextDisabled = idx >= reel.length - 1 ? "disabled" : "";
      reelBar.innerHTML = `
        <button class="frn-hl-reel-btn" onclick="frnReelStep(-1)" ${prevDisabled}>◀ Prev</button>
        <span class="frn-hl-reel-progress">REEL ${idx + 1} / ${reel.length}</span>
        <button class="frn-hl-reel-btn primary" onclick="frnReelStep(1)" ${nextDisabled}>Next ▶</button>
        <button class="frn-hl-reel-btn exit" onclick="frnReelExit()">✕ Exit reel</button>`;
      document.body.appendChild(reelBar);
      // Hook ESC to exit reel cleanly
      const escHandler = (e) => {
        if (e.key === "Escape") { document.removeEventListener("keydown", escHandler); frnReelExit(); }
      };
      document.addEventListener("keydown", escHandler);
      return;
    }
  }

  // ── Moment of season — heaviest highlight across all-in-scope ───────
  const moment = allInScope.slice().sort((a, b) => b.h.weight - a.h.weight)[0];
  const momentHtml = moment ? (() => {
    const { h, i } = moment;
    const home = getTeam(h.homeId), away = getTeam(h.awayId);
    const ctxLine = h.finalHome != null
      ? `${home?.abbr || home?.name?.slice(0,3).toUpperCase()} ${h.finalHome}-${h.finalAway} ${away?.abbr || away?.name?.slice(0,3).toUpperCase()} · ${h.week}${h.isPlayoff?" · PLAYOFF":""}`
      : `${h.week}${h.isPlayoff?" · PLAYOFF":""}`;
    return `<div class="frn-hl-moment">
      <div class="frn-hl-moment-eyebrow">🌟 MOMENT OF THE SEASON</div>
      <div class="frn-hl-moment-label">${h.label}</div>
      <div class="frn-hl-moment-ctx">${ctxLine}</div>
      <div class="frn-hl-moment-actions">
        <button class="frn-hl-moment-btn primary" onclick="renderHighlightReplay(${i})">▶ Watch the play</button>
        <button class="frn-hl-moment-btn" onclick="frnStartHighlightReel(0)">🎬 Play full reel (${filtered.length})</button>
      </div>
    </div>`;
  })() : "";

  // ── Filter pills + scope toggle ─────────────────────────────────────
  const filters = [
    { k: "all",      label: "All",       count: allInScope.length },
    { k: "off",      label: "Offense",   count: allInScope.filter(({h}) => h.type === "off").length },
    { k: "def",      label: "Defense",   count: allInScope.filter(({h}) => h.type === "def").length },
    { k: "game",     label: "Capsules",  count: allInScope.filter(({h}) => h.type === "game").length },
    { k: "clutch",   label: "Clutch",    count: allInScope.filter(({h}) => h.isClutch).length },
    { k: "playoffs", label: "Playoffs",  count: allInScope.filter(({h}) => h.isPlayoff).length },
  ];
  const pillsHtml = filters.map(f => `
    <button class="frn-hl-pill${_frnHighlightFilter===f.k?" active":""}"
            onclick="frnSetHighlightFilter('${f.k}')"
            ${f.count===0?"disabled":""}>
      ${f.label}<span class="frn-hl-pill-count">${f.count}</span>
    </button>`).join("");

  const scopeHtml = `
    <div class="frn-hl-scope">
      <button class="${_frnHighlightScope==='team'?"active":""}" onclick="frnSetHighlightScope('team')">MY TEAM</button>
      <button class="${_frnHighlightScope==='league'?"active":""}" onclick="frnSetHighlightScope('league')">LEAGUE</button>
    </div>`;

  // ── Group filtered by game ──────────────────────────────────────────
  const weekOrd = h => {
    if (h.isPlayoff) return 100 + (parseInt(h.week?.match(/\d+/)?.[0]) || 0);
    return parseInt(h.week?.match(/\d+/)?.[0]) || 0;
  };
  const games = {};
  for (const { h, i } of filtered) {
    const k = `${h.homeId}|${h.awayId}|${h.week}`;
    if (!games[k]) games[k] = { ord: weekOrd(h), week: h.week, isPlayoff: h.isPlayoff, homeId: h.homeId, awayId: h.awayId, items: [] };
    games[k].items.push({ h, i });
  }
  const sortedGames = Object.values(games).sort((a, b) => b.ord - a.ord);

  const typeCfg = (h) => {
    if (h.type === "def")  return { badge: h.isClutch ? "CLUTCH DEF" : "DEF",  color: "#4dbdbd" };
    if (h.type === "game") return { badge: h.isClutch ? "OT"          : "GAME", color: "#a78bfa" };
    return                        { badge: h.isClutch ? "CLUTCH"      : "OFF",  color: "#f5c542" };
  };
  const hlCtx = (h) => {
    // League scope: show both teams' abbrs + final
    if (_frnHighlightScope === "league") {
      const home = getTeam(h.homeId), away = getTeam(h.awayId);
      const ha = home?.abbr || home?.name?.slice(0,3).toUpperCase() || "HOM";
      const aa = away?.abbr || away?.name?.slice(0,3).toUpperCase() || "AWY";
      if (h.finalHome == null) return `${ha} vs ${aa}`;
      return `${ha} ${h.finalHome}-${h.finalAway} ${aa}`;
    }
    const oppId = h.homeId === chosenTeamId ? h.awayId : h.homeId;
    const opp   = getTeam(oppId);
    const abbr  = opp?.abbr || opp?.name?.slice(0, 3).toUpperCase() || "OPP";
    if (h.finalHome == null) return `vs. ${abbr}`;
    const myPts  = h.homeId === chosenTeamId ? h.finalHome : h.finalAway;
    const oppPts = h.homeId === chosenTeamId ? h.finalAway  : h.finalHome;
    const wl = myPts > oppPts ? "W" : myPts < oppPts ? "L" : "T";
    return `vs. ${abbr} — ${wl} ${myPts}-${oppPts}`;
  };

  const blocksHtml = sortedGames.map(g => {
    const sorted = g.items.sort((a, b) => b.h.weight - a.h.weight);
    const ctx = hlCtx(sorted[0].h);
    const rows = sorted.map(({ h, i }) => {
      const { badge, color } = typeCfg(h);
      return `
        <div class="frn-hl-row2" style="padding:.35rem 0;cursor:pointer" onclick="renderHighlightReplay(${i})">
          <span class="frn-hl2-badge" style="color:${color}">${badge}</span>
          <span class="frn-hl2-label" style="white-space:normal">${h.label}</span>
          ${h.isClutch ? `<span style="font-size:.57rem;color:#f87171">⚡</span>` : ""}
          <span style="font-size:.57rem;color:var(--blgray);flex-shrink:0">▶</span>
        </div>`;
    }).join("");
    return `
      <section class="bspn-panel" style="margin-bottom:.75rem">
        <div class="bspn-panel-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>${g.week}${g.isPlayoff ? " · PLAYOFF" : ""}</span>
          <span style="color:var(--blgray);font-size:.67rem;font-weight:400">${ctx}</span>
        </div>
        ${rows}
      </section>`;
  }).join("");

  // ── Player honor roll (only meaningful at team scope) ───────────────
  // Aggregate highlight weight per player name extracted from the label.
  // Simple heuristic: tokens like "VINICIUS ADEBAYO TD" → first 2-3
  // capitalized words at the start.
  let honorRollHtml = "";
  if (_frnHighlightScope === "team") {
    const byPlayer = {};
    const playerRe = /^([A-Z][A-Za-z'\-\.]+(?:\s+[A-Z][A-Za-z'\-\.]+){1,2})/;
    for (const { h } of allInScope) {
      if (h.type === "game") continue;            // capsules don't have a single player
      const match = (h.label || "").match(playerRe);
      if (!match) continue;
      const name = match[1].trim();
      // Skip when the "player" is actually the team name (capsule words like
      // "DEFENSE" / "OFFENSE" / etc would catch through here on edge cases).
      if (/^(YOUR|HOME|AWAY|TEAM|OFFENSE|DEFENSE|FINAL|SHUTOUT|SHOOTOUT|REVENGE|UPSET|COMEBACK|CLUTCH|DOMINANT|PICK)/i.test(name)) continue;
      const t = (h.homeId === chosenTeamId) ? h.homeId : h.awayId;
      if (!byPlayer[name]) byPlayer[name] = { name, weight: 0, count: 0, teamId: t };
      byPlayer[name].weight += h.weight;
      byPlayer[name].count += 1;
    }
    const ranked = Object.values(byPlayer)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6);
    if (ranked.length) {
      honorRollHtml = `
        <section class="bspn-panel" style="margin-bottom:.75rem">
          <div class="bspn-panel-title">⭐ HIGHLIGHT HONOR ROLL</div>
          <div style="font-size:.58rem;color:var(--blgray);margin-bottom:.4rem">Players ranked by total highlight impact this season.</div>
          <div class="frn-hl-honor">
            ${ranked.map((r, i) => {
              const t = getTeam(r.teamId);
              return `<div class="frn-hl-honor-row">
                <span class="rank">${i+1}</span>
                <span class="name">${_playerLinkSmart(r.name)}</span>
                <span class="team" style="color:${t?.primary||"var(--blgray)"}">${t?.abbr || t?.name?.slice(0,3).toUpperCase() || ""}</span>
                <span class="count">${r.count} moment${r.count===1?"":"s"}</span>
                <span class="weight">★ ${r.weight.toFixed(0)}</span>
              </div>`;
            }).join("")}
          </div>
        </section>`;
    }
  }

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0;padding-bottom:1rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">SEASON ${season} HIGHLIGHTS</div>
        </div>
        <nav class="bspnlive-nav">${_bspnNavHtml("")}</nav>
      </header>
      <div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;align-items:center;gap:.6rem">
        <button class="bspn-back" onclick="showFranchiseDashboard()">‹ Back to Dashboard</button>
        ${scopeHtml}
      </div>
      <div style="padding:1rem 1.4rem">
        <div style="color:var(--blgold);font-size:.7rem;letter-spacing:1.5px;margin-bottom:.4rem">
          ${_frnHighlightScope === "league" ? `LEAGUE · ${allInScope.length} MOMENTS` : `${myTeam?.name?.toUpperCase()} · ${allInScope.length} MOMENTS ACROSS ${sortedGames.length || Object.keys(games).length} GAMES`}
        </div>
        ${momentHtml}
        <div class="frn-hl-pills">${pillsHtml}</div>
        ${honorRollHtml}
        ${blocksHtml || `<div style="color:var(--blgray);padding:1rem">No highlights match this filter.</div>`}
      </div>
    </div>`;
}

function _buildPostGameHeadline(teamId) {
  const { schedule, seasonHighlights, standings } = franchise;
  const myGames = (schedule || [])
    .filter(g => g.played && (g.homeId === teamId || g.awayId === teamId))
    .sort((a, b) => b.week - a.week);
  if (!myGames.length) return "";

  const g = myGames[0];
  const isHome    = g.homeId === teamId;
  const myScore   = isHome ? g.homeScore : g.awayScore;
  const oppScore  = isHome ? g.awayScore : g.homeScore;
  const oppId     = isHome ? g.awayId   : g.homeId;
  const myTeam    = getTeam(teamId);
  const oppTeam   = getTeam(oppId);
  const myName    = myTeam?.name  || "HOME";
  const oppName   = oppTeam?.name || "AWAY";
  const myCity    = myTeam?.city  || myName;
  const oppCity   = oppTeam?.city || oppName;

  const isWin  = myScore > oppScore;
  const isTie  = myScore === oppScore;
  const margin = Math.abs(myScore - oppScore);
  const isDom  = margin >= 14;
  const isNail = margin <= 3;

  // Highlights for this specific game
  const gameHL = (seasonHighlights || []).filter(h =>
    h.homeId === g.homeId && h.awayId === g.awayId
  );
  const isOT      = gameHL.some(h => h.label?.includes("OT THRILLER"));
  const isShutout = gameHL.some(h => h.label?.includes("SHUTOUT") && isWin);
  const topPlay   = gameHL.filter(h => h.type === "off" || h.type === "def")
                          .sort((a, b) => b.weight - a.weight)[0];

  // Stable pick: same headline each time you open the dashboard for the same game
  const si = (arr) => arr[(g.week * 3 + myScore + oppScore) % arr.length];

  // ── Headline ────────────────────────────────────────────────────────────────
  let headline;
  if (isWin) {
    if (isOT)        headline = si([`${myName} OUTLASTS ${oppName} IN OVERTIME THRILLER`, `OVERTIME MAGIC LIFTS ${myName} PAST ${oppName}`, `${myName} WINS OT CLASSIC AGAINST ${oppName}`]);
    else if (isShutout) headline = si([`LOCKDOWN: ${myName} SHUTS OUT ${oppName}`, `${myName} DEFENSE SUFFOCATES ${oppName}`, `BLANKED: ${myName} HOLDS ${oppName} SCORELESS`]);
    else if (isDom)  headline = si([`${myName} DOMINATES ${oppName} ${myScore}-${oppScore}`, `NO CONTEST: ${myName} ROLLS PAST ${oppName}`, `${myName} PUTS ON A SHOW IN CONVINCING WIN`]);
    else if (isNail) headline = si([`${myName} EDGES ${oppName} IN NAIL-BITER`, `LATE HEROICS LIFT ${myName} PAST ${oppName}`, `${myName} SURVIVES ${oppName} SCARE, WINS ${myScore}-${oppScore}`]);
    else             headline = si([`${myName} HANDLES ${oppName} IN SOLID WIN`, `${myName} TAKES CARE OF BUSINESS AGAINST ${oppName}`, `${myName} DEFEATS ${oppName} ${myScore}-${oppScore}`]);
  } else if (isTie) {
    headline = `${myName} AND ${oppName} PLAY TO A ${myScore}-${oppScore} DRAW`;
  } else {
    if (isOT)        headline = si([`OVERTIME HEARTBREAK FOR ${myName}`, `${oppName} STEALS ONE IN OT FROM ${myName}`, `${myName} FALLS IN HEARTBREAKING OT LOSS`]);
    else if (!isWin && gameHL.some(h => h.label?.includes("SHUTOUT")))
                     headline = si([`OFFENSE GOES DARK: ${myName} BLANKED BY ${oppName}`, `${oppName} HOLDS ${myName} SCORELESS`, `${myName} SHUT OUT IN TOUGH LOSS`]);
    else if (isDom)  headline = si([`${oppName} RUNS OVER ${myName}`, `ROUGH NIGHT: ${myName} FALLS IN BLOWOUT TO ${oppName}`, `${myName} OVERWHELMED IN LOPSIDED DEFEAT`]);
    else if (isNail) headline = si([`${myName} FALLS IN HEARTBREAKER TO ${oppName}`, `SO CLOSE: ${myName} COMES UP SHORT`, `${oppName} EDGES ${myName} IN CLOSE ONE`]);
    else             headline = si([`${myName} DROPS ONE TO ${oppName}`, `${oppName} HANDLES BUSINESS AGAINST ${myName}`, `${myName} SUFFERS DEFEAT AT HANDS OF ${oppName}`]);
  }

  // ── Blurb sentence 1: game flow ─────────────────────────────────────────────
  let s1;
  if (isOT) {
    s1 = isWin
      ? `The ${myName} and ${oppName} needed overtime to settle it, with ${myName} striking for the game-winner after a tense regulation.`
      : `${oppName} broke ${myName} hearts in overtime after the teams played to a stalemate through four quarters.`;
  } else if (isShutout) {
    s1 = `The ${myName} defense turned in a masterclass, suffocating the ${oppName} offense for all 60 minutes.`;
  } else if (isDom && isWin) {
    s1 = `It was never in doubt as the ${myName} controlled both lines of scrimmage from the opening drive and never let up.`;
  } else if (isDom && !isWin) {
    s1 = `${oppName} came in locked in, imposing their will on both sides of the ball and giving ${myName} few answers all night.`;
  } else if (isNail && isWin) {
    s1 = `A hard-fought battle in ${isHome ? myCity : oppCity} went down to the wire before the ${myName} found a way to close it out.`;
  } else if (isNail && !isWin) {
    s1 = `The ${myName} had their chances but ultimately could not convert when it mattered most against a stubborn ${oppName} squad.`;
  } else {
    s1 = isWin
      ? `A balanced performance on both sides of the ball carried the ${myName} to a comfortable victory over ${oppName}.`
      : `${oppName} proved to be too much for the ${myName} to handle on this occasion, putting together a complete game.`;
  }

  // ── Blurb sentence 2: top play reference ───────────────────────────────────
  let s2 = "";
  if (topPlay) {
    const lbl = topPlay.label;
    if (topPlay.type === "def") {
      if (lbl.includes("PICK-SIX"))   s2 = `A pick-six was the highlight-reel moment that swung the momentum decisively.`;
      else if (lbl.includes("INT"))   s2 = `A timely interception gave the ${myName} offense a short field and changed the game's trajectory.`;
      else if (lbl.includes("sacks")) s2 = `A crushing sack at a pivotal moment derailed the opponent's drive and sparked the sideline.`;
      else if (lbl.includes("FUM"))   s2 = `A forced fumble provided the ${myName} with a critical possession change.`;
      else s2 = `The defense delivered a game-changing play that won't be forgotten.`;
    } else {
      const tdPass = lbl.match(/^([A-Za-z'-]+)→([A-Za-z'-]+) TD/);
      const tdRush = lbl.match(/^([A-Za-z'-]+) rush TD/);
      const bigRun = lbl.match(/^([A-Za-z'-]+) (\d+)-yd run/);
      const bigPass= lbl.match(/^([A-Za-z'-]+)→([A-Za-z'-]+) (\d+) yds/);
      const bigFG  = lbl.match(/^([A-Za-z'-]+) (\d+)-yd FG/);
      if (tdPass)    s2 = `${tdPass[1]} connected with ${tdPass[2]} for a touchdown — the signature play of the day.`;
      else if (tdRush) s2 = `${tdRush[1]} punched it in on the ground for a score the crowd will be talking about.`;
      else if (bigRun) s2 = `${bigRun[1]}'s ${bigRun[2]}-yard burst was the defining moment of the running game.`;
      else if (bigPass)s2 = `${bigPass[1]} found ${bigPass[2]} for ${bigPass[3]} yards — a play that moved the chains at a crucial moment.`;
      else if (bigFG)  s2 = `${bigFG[1]}'s ${bigFG[2]}-yard field goal provided the breathing room the ${myName} needed.`;
      else s2 = `The offense delivered the key play when the situation demanded it.`;
    }
    if (topPlay.isClutch && !s2.includes("clutch")) s2 += ` A clutch play in every sense of the word.`;
  }

  // ── Blurb sentence 3: record ────────────────────────────────────────────────
  const stand = standings?.[teamId];
  const rec   = stand ? `${stand.w}-${stand.l}${stand.t ? `-${stand.t}` : ""}` : "";
  const s3 = rec
    ? (isWin ? `The win improves ${myName} to ${rec} on the season.`
             : isTie ? `${myName} now sit at ${rec} on the year.`
                     : `The loss drops ${myName} to ${rec}.`)
    : "";

  const blurb = [s1, s2, s3].filter(Boolean).join(" ");

  // Visual
  const wlColor  = isWin ? "var(--green-lt)"        : isTie ? "var(--gray)" : "var(--red)";
  const wlBorder = isWin ? "rgba(74,222,128,.18)"   : isTie ? "rgba(128,128,128,.15)" : "rgba(220,50,50,.18)";
  const wlBg     = isWin ? "rgba(74,222,128,.04)"   : isTie ? "rgba(128,128,128,.04)" : "rgba(220,50,50,.04)";
  const isPlayoffGame = g.week > FRANCHISE_WEEKS;
  const weekLabel = isPlayoffGame ? "PLAYOFF" : `WEEK ${g.week}`;

  // Slice F: live WP curve + Player of the Game (graceful no-op if there's
  // no playLog for this game — e.g. legacy save, or a playoff game that
  // Slice B skips).
  const wpBlock = (typeof mffPostGameWPBlock === "function") ? mffPostGameWPBlock(teamId) : "";
  return `
    <div class="frn-postgame-headline" style="border-color:${wlBorder};background:${wlBg}">
      <div class="frn-postgame-eyebrow">
        <span style="color:var(--gray);font-size:.62rem;letter-spacing:.5px">${weekLabel} · FINAL</span>
        <span class="frn-postgame-wl" style="color:${wlColor}">${isWin?"W":isTie?"T":"L"} ${myScore}–${oppScore}</span>
      </div>
      <div class="frn-postgame-hed">${headline}</div>
      <div class="frn-postgame-blurb">${blurb}</div>
      ${wpBlock}
    </div>`;
}

function _frnCheckItem(key) {
  const { season, week } = franchise;
  if (!franchise._weeklyChecklist) franchise._weeklyChecklist = {};
  if (!franchise._weeklyChecklist[season]) franchise._weeklyChecklist[season] = {};
  if (!franchise._weeklyChecklist[season][week]) franchise._weeklyChecklist[season][week] = {};
  franchise._weeklyChecklist[season][week][key] = true;
  saveFranchise();
}
function _frnToggleMoreNav() {
  const el = document.getElementById("frn-more-nav");
  if (el) el.classList.toggle("open");
}
// Module-level UI toggle for the pregame-breakdown expander on the
// next-game card. Persists across re-renders within the same session.
let _frnPregameExpanded = false;
function _frnTogglePregame() {
  _frnPregameExpanded = !_frnPregameExpanded;
  renderFrnRegular();
}

// Sim-forward panel state. The two-click model: clicking "Sim Forward"
// opens the panel; a specific sim target inside the panel triggers a
// confirm() before it actually runs. Defaults to a target one week
// past the current week so the input has a sensible value.
let _frnSimPanelOpen = false;
let _frnSimTargetWeek = null;
function _frnToggleSimPanel() {
  _frnSimPanelOpen = !_frnSimPanelOpen;
  if (_frnSimPanelOpen && _frnSimTargetWeek == null) {
    _frnSimTargetWeek = Math.min(franchise.week + 2, FRANCHISE_WEEKS);
  }
  renderFrnRegular();
}
function _frnSetSimTarget(v) {
  const n = Math.max(franchise.week, Math.min(FRANCHISE_WEEKS, Number(v) || franchise.week));
  _frnSimTargetWeek = n;
  // Update displayed value without a full re-render (input keeps focus)
  const el = document.getElementById("frn-sim-target-input");
  if (el && +el.value !== n) el.value = n;
}
function _renderSimForwardPanel() {
  const w = franchise.week;
  if (w > FRANCHISE_WEEKS) return "";
  if (!_frnSimPanelOpen) {
    return `<button class="frn-sim-btn frn-sim-forward-trigger" onclick="_frnToggleSimPanel()">⏭ Sim Forward ▾</button>`;
  }
  const target = _frnSimTargetWeek ?? Math.min(w + 2, FRANCHISE_WEEKS);
  const remaining = FRANCHISE_WEEKS - w;
  return `<div class="frn-sim-panel">
    <div class="frn-sim-panel-head">
      <span>⏭ SIM FORWARD</span>
      <span class="frn-sim-panel-sub">${remaining} regular-season week${remaining===1?"":"s"} left · ${remaining===0?"playoffs next":"playoffs at W"+FRANCHISE_WEEKS}</span>
      <button class="frn-sim-panel-cancel" onclick="_frnToggleSimPanel()">× Cancel</button>
    </div>
    <div class="frn-sim-options">
      <button class="frn-sim-opt" onclick="frnConfirmSimWeek()">
        <span class="frn-sim-opt-icon">⏭</span>
        <span class="frn-sim-opt-label">Finish Week ${w}</span>
        <span class="frn-sim-opt-sub">close out the current week</span>
      </button>
      <div class="frn-sim-opt frn-sim-opt-custom">
        <span class="frn-sim-opt-icon">⏩</span>
        <span class="frn-sim-opt-label">Sim to Week
          <input type="number" id="frn-sim-target-input"
                 min="${w}" max="${FRANCHISE_WEEKS}" value="${target}" step="1"
                 oninput="_frnSetSimTarget(this.value)">
        </span>
        <button class="frn-sim-opt-go" onclick="frnConfirmSimToWeek(_frnSimTargetWeek)">Go →</button>
      </div>
      <button class="frn-sim-opt" onclick="frnConfirmSimToPlayoffs()" ${remaining===0?"disabled":""}>
        <span class="frn-sim-opt-icon">⏭⏭</span>
        <span class="frn-sim-opt-label">Sim to Playoffs</span>
        <span class="frn-sim-opt-sub">finish W${FRANCHISE_WEEKS} · land on bracket</span>
      </button>
      <button class="frn-sim-opt frn-sim-opt-warn" onclick="frnConfirmSimToEndOfSeason()">
        <span class="frn-sim-opt-icon">⚠ ⏭⏭⏭</span>
        <span class="frn-sim-opt-label">Sim to End of Season</span>
        <span class="frn-sim-opt-sub">incl. playoffs · skip all mid-season mgmt</span>
      </button>
    </div>
  </div>`;
}

// ─── App shell + tab routing ────────────────────────────────────────────
// The dashboard is a tabbed app shell during the regular season. Tabs
// route to focused sub-views; the shell itself is just identity +
// tab strip. Each tab is a small router that calls the appropriate
// canonical render. Switching tabs persists in _frnActiveTab.
let _frnActiveTab = "overview";
const _FRN_TABS = [
  { id: "overview",    icon: "⌂",  label: "Overview" },
  { id: "roster",      icon: "👥", label: "Roster" },
  { id: "frontoffice", icon: "📑", label: "Front Office" },
  { id: "league",      icon: "🏟", label: "League" },
  { id: "replays",     icon: "📺", label: "Replays" },
  { id: "tools",       icon: "🛠", label: "Tools" },
];

function frnSetTab(tabId) {
  if (!_FRN_TABS.some(t => t.id === tabId)) return;
  _frnActiveTab = tabId;
  // Tab switching renders directly (not via showFranchiseDashboard's boundary),
  // so guard it here — a crash in one tab shouldn't white-screen the whole app.
  try {
    _frnRenderAppShell();
    _frnRenderActiveTab();
  } catch (err) {
    if (typeof _frnRenderError === "function") _frnRenderError(err, "regular (" + tabId + " tab)");
    else console.error("[frnSetTab] render crash:", err);
  }
}

function _frnRenderAppShell() {
  const el = $("frnAppShell");
  if (!el) return;
  const myTeam = getTeam(franchise.chosenTeamId);
  const stand = franchise.standings?.[franchise.chosenTeamId] || { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
  const rec = `${stand.w}-${stand.l}${stand.t?`-${stand.t}`:""}`;
  // Per-tab badges
  const pendingTrades = (franchise.tradeOffers||[]).filter(o => o.status === "pending").length;
  const pendingJP     = (franchise.jointPracticeOffers||[]).filter(o => o.status === "pending" && o.toTeamId === franchise.chosenTeamId).length;
  const tabBadge = (id) => {
    const count = (id === "frontoffice") ? pendingTrades
                : (id === "tools")       ? pendingJP : 0;
    return count ? `<span class="frn-bb-fnkey-badge">${count}</span>` : "";
  };
  // Active holdout demands → persistent ribbon (legacy) preserved.
  const pendingDemands = (typeof _pendingHoldoutDemands === "function") ? _pendingHoldoutDemands() : [];
  let ribbonHtml = "";
  if (pendingDemands.length) {
    const urgent = pendingDemands.filter(d => (d.deadlineWeek - franchise.week) <= 1).length;
    const cls = urgent ? "frn-shell-ribbon urgent" : "frn-shell-ribbon";
    ribbonHtml = `<div class="${cls}" onclick="frnOpenHoldoutCenter()" title="Click to resolve">
      <span class="ribbon-icon">🗣</span>
      <span class="ribbon-text"><b>${pendingDemands.length}</b> walk-year star${pendingDemands.length===1?"":"s"} demanding extension${pendingDemands.length===1?"":"s"}${urgent?` · <span style="color:var(--red);font-weight:700">${urgent} URGENT</span>`:""}</span>
      <span class="ribbon-cta">Resolve →</span>
    </div>`;
  }

  // ── Ticker content — pulls from franchise.news + the schedule's
  // played games this week (cross-league scoreboard ribbon). Falls
  // back to a "WIRE QUIET" stub when nothing's loaded yet.
  const tickerHtml = _frnBuildTicker();

  // ── Function strip — F1-F6 numbered tabs with badges.
  // _FRN_TABS keys map to F1..F5; F6 is reserved (room for future).
  const fnstripHtml = `
    <div class="frn-bb-fnstrip">
      ${_FRN_TABS.map((t, i) => `<button class="frn-bb-fnkey${t.id===_frnActiveTab?" active":""}" onclick="frnSetTab('${t.id}')">
        <span class="frn-bb-fnkey-num">F${i+1}</span>
        <span>${t.label.toUpperCase()}</span>
        ${tabBadge(t.id)}
      </button>`).join("")}
      <div class="frn-bb-fnkey-spacer"></div>
      <div class="frn-bb-fnkey-cmd">
        <span>S${franchise.season || 1}</span>
        <span>W${Math.min(franchise.week || 1, FRANCHISE_WEEKS)}</span>
        <span><kbd>?</kbd> HELP</span>
      </div>
    </div>`;

  // ── Identity row — team mark + key stats inline. Mark color uses
  // myTeam.primary as background with team abbrev / first letters.
  const abbrev = (myTeam?.abbrev || myTeam?.name?.slice(0,3) || "???").toUpperCase().slice(0, 3);
  const off = (typeof frnTeamRating === "function" && myTeam) ? frnTeamRating(franchise.chosenTeamId) : { off: "—", def: "—" };
  const cap = (typeof effectiveSalaryCap === "function") ? effectiveSalaryCap(franchise.chosenTeamId) : (franchise.salaryCap || 200);
  const capUsed = (typeof capUsedByTeam === "function") ? capUsedByTeam(franchise.chosenTeamId) : 0;
  const capColor = (capUsed / cap >= 0.95) ? "red" : (capUsed / cap >= 0.85) ? "gold" : "green";
  // Form strip — last 5 results.
  const myGames = (franchise.schedule || [])
    .filter(g => g.played && (g.homeId === franchise.chosenTeamId || g.awayId === franchise.chosenTeamId))
    .sort((a, b) => a.week - b.week);
  const formStrip = myGames.slice(-5).map(g => {
    const isHome = g.homeId === franchise.chosenTeamId;
    const my = isHome ? g.homeScore : g.awayScore;
    const their = isHome ? g.awayScore : g.homeScore;
    const r = my > their ? "W" : my < their ? "L" : "T";
    const col = r === "W" ? "var(--green-lt)" : r === "L" ? "var(--red)" : "var(--gray)";
    return `<span style="color:${col}">${r}</span>`;
  }).join("·");
  // Seed.
  const sorted = (typeof standingsSorted === "function") ? standingsSorted() : [];
  const myPos  = sorted.findIndex(s => s.id === franchise.chosenTeamId) + 1;
  const inPO = myPos > 0 && myPos <= (typeof PLAYOFF_TEAMS !== "undefined" ? PLAYOFF_TEAMS : 14);
  const seedHtml = inPO
    ? `<span class="frn-bb-id-stat-val green">#${myPos} IN</span>`
    : `<span class="frn-bb-id-stat-val">#${myPos}</span>`;
  // Decisions count — pendingTrades + pendingJP + holdouts.
  const decisionCount = pendingTrades + pendingJP + pendingDemands.length;
  const alertHtml = decisionCount
    ? `<div class="frn-bb-id-alert" onclick="frnSetTab('overview')" title="Decisions waiting">
        <span>⚠</span><span class="frn-bb-alert-badge">${decisionCount}</span><span>PENDING</span>
       </div>` : "";

  const idHtml = `
    <div class="frn-bb-id">
      <div class="frn-bb-id-team">
        <div class="frn-bb-id-mark" style="background:${myTeam?.primary || "var(--gold)"}">${abbrev}</div>
        <div>
          <div class="frn-bb-id-name">${(myTeam?.city || "").toUpperCase()} ${(myTeam?.name || "TEAM").toUpperCase()}</div>
          <div class="frn-bb-id-sub">${myTeam?.conference || ""} ${myTeam?.division || ""} · S${franchise.season || 1} W${Math.min(franchise.week || 1, FRANCHISE_WEEKS)} of ${FRANCHISE_WEEKS}</div>
        </div>
      </div>
      <div class="frn-bb-id-divider"></div>
      <div class="frn-bb-id-stat"><div class="frn-bb-id-stat-label">RECORD</div><div class="frn-bb-id-stat-val">${rec}</div></div>
      <div class="frn-bb-id-stat"><div class="frn-bb-id-stat-label">SEED</div>${seedHtml}</div>
      <div class="frn-bb-id-stat"><div class="frn-bb-id-stat-label">CAP</div><div class="frn-bb-id-stat-val ${capColor}">$${capUsed.toFixed(0)}M / $${cap.toFixed(0)}M</div></div>
      <div class="frn-bb-id-stat"><div class="frn-bb-id-stat-label">OFF · DEF</div><div class="frn-bb-id-stat-val">${off.off} · ${off.def}</div></div>
      ${formStrip ? `<div class="frn-bb-id-stat"><div class="frn-bb-id-stat-label">FORM</div><div class="frn-bb-id-stat-val" style="letter-spacing:2px">${formStrip}</div></div>` : ""}
      ${alertHtml}
    </div>`;

  el.innerHTML = tickerHtml + fnstripHtml + idHtml + ribbonHtml;

  // ── Footer status bar — persistent bottom strip. Rendered to its
  // own container so it sits below the active tab body regardless of
  // body height (sticky CSS pins it on tall scrolling tabs).
  const footEl = $("frnAppFooter");
  if (footEl) {
    footEl.style.display = "block";
    const saveMsg = (typeof _saveLastError !== "undefined" && _saveLastError)
      ? (_saveLastError.startsWith("idb-only") ? `ℹ IDB only` : `⚠ ${_saveLastError}`)
      : `💾 Saved ${(typeof _saveLastSize !== "undefined" && _saveLastSize) ? `· ${(_saveLastSize/1024/1024).toFixed(2)}MB` : ""}`;
    const saveCls = (typeof _saveLastError !== "undefined" && _saveLastError)
      ? (_saveLastError.startsWith("idb-only") ? "warn" : "err") : "";
    const unread  = (franchise.news || []).filter(n => n.season === franchise.season && n.week >= (franchise.week || 0) - 1).length;
    footEl.innerHTML = `
      <div class="frn-bb-footer">
        <div class="frn-bb-footer-item"><span class="frn-bb-footer-dot ${saveCls}"></span><span>${saveCls === "err" ? "ERROR" : "LIVE"}</span></div>
        <div class="frn-bb-footer-item">⏰ S${franchise.season || 1} · W${Math.min(franchise.week || 1, FRANCHISE_WEEKS)}/${FRANCHISE_WEEKS}</div>
        <div class="frn-bb-footer-item">${saveMsg}</div>
        ${unread ? `<div class="frn-bb-footer-item" style="color:var(--gold)">🔔 ${unread} recent</div>` : ""}
        <div class="frn-bb-footer-spacer"></div>
        <div class="frn-bb-footer-cmd">
          <button onclick="frnExportSave()" style="background:transparent;border:1px solid var(--border);color:var(--gray);padding:1px 6px;font-family:inherit;font-size:8.5px;cursor:pointer;margin-right:.3rem">⬇ EXPORT</button>
          <button onclick="frnImportSave()" style="background:transparent;border:1px solid var(--border);color:var(--gray);padding:1px 6px;font-family:inherit;font-size:8.5px;cursor:pointer;margin-right:.5rem">⬆ IMPORT</button>
          <kbd>F1</kbd>-<kbd>F5</kbd> NAV · <kbd>?</kbd> HELP
        </div>
      </div>`;
  }
}

// Build the ticker content. Surfaces the last ~12 news items as
// scrolling marquee text. Each item: time stamp + colored label.
// Mixes player news, league moves, and game scores from
// franchise.news (last 4 weeks) plus this week's around-the-league
// schedule scoreboard. Falls back to "WIRE QUIET" if nothing yet.
function _frnBuildTicker() {
  const items = [];
  const season = franchise?.season || 1;
  const week = franchise?.week || 1;
  // News items — last 30 wire entries, newest first. Cap noisy
  // categories (KNOCKOUT FA wars repeat heavily during the FA window):
  // at most 3 KO labels per ticker pass, prefer the freshest. Other
  // labels pass through untouched.
  const news = (franchise?.news || []).slice(-30).reverse();
  let koCount = 0;
  const KO_MAX = 3;
  for (const n of news) {
    if (!n.label) continue;
    const text = String(n.label).replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").trim();
    if (!text) continue;
    const isKO = /KNOCKOUT/i.test(text);
    if (isKO) {
      if (koCount >= KO_MAX) continue;
      koCount++;
    }
    const wkAgo = (season - (n.season || season)) * FRANCHISE_WEEKS + (week - (n.week || week));
    const stamp = wkAgo === 0 ? "TODAY" : wkAgo === 1 ? "1w" : `${wkAgo}w`;
    items.push(`<span><span class="frn-bb-ticker-time">${stamp}</span> ${text}</span>`);
    if (items.length >= 15) break;
  }
  // Around-the-league this week — show 5-6 other games
  const otherGames = (franchise?.schedule || [])
    .filter(g => g.week === week && g.homeId !== franchise?.chosenTeamId && g.awayId !== franchise?.chosenTeamId)
    .slice(0, 6);
  for (const g of otherGames) {
    const h = getTeam(g.homeId), a = getTeam(g.awayId);
    if (!h || !a) continue;
    if (g.played) {
      const hW = g.homeScore > g.awayScore;
      const aStr = hW ? `${a.name} ${g.awayScore}` : `<span class="frn-bb-ticker-up">${a.name} ${g.awayScore}</span>`;
      const hStr = hW ? `<span class="frn-bb-ticker-up">${h.name} ${g.homeScore}</span>` : `${h.name} ${g.homeScore}`;
      items.push(`<span><span class="frn-bb-ticker-time">FINAL</span> ${aStr} @ ${hStr}</span>`);
    } else {
      items.push(`<span><span class="frn-bb-ticker-time">W${week}</span> ${a.name} @ ${h.name}</span>`);
    }
  }
  // Triple the items so the marquee feels continuous (browser pauses
  // at end of content before looping otherwise).
  const trackItems = items.length
    ? items.join("") + items.join("") + items.join("")
    : `<span><span class="frn-bb-ticker-time">—</span> WIRE QUIET · advance the week to see news</span>`;
  return `
    <div class="frn-bb-ticker">
      <div class="frn-bb-ticker-label">▶ WIRE</div>
      <div class="frn-bb-ticker-track">
        <div class="frn-bb-ticker-scroll">${trackItems}</div>
      </div>
    </div>`;
}

function _frnRenderActiveTab() {
  switch (_frnActiveTab) {
    case "overview":    return renderFrnRegular();
    case "roster":      return renderFrnRosterHome();
    case "frontoffice": return renderFrnFrontOfficeHome();
    case "league":      return renderFrnLeagueHome();
    case "replays":     return (typeof renderFrnReplayLib === "function") ? renderFrnReplayLib() : renderFrnRegular();
    case "tools":       return _frnRenderTabTools();
    default:            return renderFrnRegular();
  }
}

// ── Roster tab aggregator ─────────────────────────────────────────────
// Sub-nav across the player-management views: depth chart, snap shares,
// injury report, practice squad. Same prepend-subnav pattern as League.
let _frnRosterSubTab = "depth";
const _FRN_ROSTER_TABS = [
  { id: "depth",     label: "Depth Chart",    fn: () => typeof renderFrnDepthChart    === "function" && renderFrnDepthChart() },
  { id: "locker",    label: "🛋 Locker Room", fn: () => typeof renderFrnLockerRoom    === "function" && renderFrnLockerRoom() },
  { id: "snaps",     label: "Snap Shares",    fn: () => typeof renderFrnSnapShares    === "function" && renderFrnSnapShares() },
  { id: "injuries",  label: "Injury Report",  fn: () => typeof renderFrnInjuryReport  === "function" && renderFrnInjuryReport() },
  { id: "ir",        label: "Injured Reserve",fn: () => typeof renderFrnInjuredReserve === "function" && renderFrnInjuredReserve() },
  { id: "ps",        label: "Practice Squad", fn: () => typeof renderFrnPracticeSquad === "function" && renderFrnPracticeSquad() },
];
function frnSetRosterSubTab(id) {
  if (!_FRN_ROSTER_TABS.some(t => t.id === id)) return;
  _frnRosterSubTab = id;
  renderFrnRosterHome();
}
function renderFrnRosterHome() {
  const el = $("frnHomeContent");
  if (el) el.innerHTML = ""; // clear first so an early-returning sub-render can't stack sub-navs
  const active = _FRN_ROSTER_TABS.find(t => t.id === _frnRosterSubTab) || _FRN_ROSTER_TABS[0];
  active.fn();
  const newEl = $("frnHomeContent");
  if (!newEl) return;
  const sub = document.createElement("div");
  sub.className = "frn-subnav";
  sub.innerHTML = _FRN_ROSTER_TABS.map(t =>
    `<button class="frn-subnav-btn${t.id===active.id?" active":""}" onclick="frnSetRosterSubTab('${t.id}')">${t.label}</button>`
  ).join("");
  newEl.insertBefore(sub, newEl.firstChild);
}

// ── Front Office tab aggregator ───────────────────────────────────────
// Sub-nav across the GM-decision pages: trade, free agency, scouting,
// coaching staff, and the cap sheet (via Analytics). Same prepend pattern.
let _frnFOSubTab = "trade";
const _FRN_FO_TABS = [
  { id: "trade",    label: "Trade",       fn: () => typeof frnOpenTrade            === "function" && frnOpenTrade() },
  { id: "fa",       label: "Free Agents", fn: () => typeof renderFrnFANegotiations === "function" && renderFrnFANegotiations() },
  { id: "scouting", label: "🎓 College Scout", fn: () => typeof renderFrnScoutingBoard === "function" && renderFrnScoutingBoard() },
  { id: "coaches",  label: "Coaches",     fn: () => typeof renderFrnCoachingStaff  === "function" && renderFrnCoachingStaff() },
  { id: "cap",      label: "Cap Sheet",   fn: () => typeof renderFrnAnalytics      === "function" && renderFrnAnalytics("mysheet") },
  { id: "draftlog", label: "📋 Draft Log", fn: () => typeof renderFrnDraftReportCard === "function" && renderFrnDraftReportCard() },
];
function frnSetFOSubTab(id) {
  if (!_FRN_FO_TABS.some(t => t.id === id)) return;
  _frnFOSubTab = id;
  renderFrnFrontOfficeHome();
}
function renderFrnFrontOfficeHome() {
  const el = $("frnHomeContent");
  if (el) el.innerHTML = ""; // clear first so an early-returning sub-render can't stack sub-navs
  const active = _FRN_FO_TABS.find(t => t.id === _frnFOSubTab) || _FRN_FO_TABS[0];
  active.fn();
  const newEl = $("frnHomeContent");
  if (!newEl) return;
  const sub = document.createElement("div");
  sub.className = "frn-subnav";
  sub.innerHTML = _FRN_FO_TABS.map(t =>
    `<button class="frn-subnav-btn${t.id===active.id?" active":""}" onclick="frnSetFOSubTab('${t.id}')">${t.label}</button>`
  ).join("");
  newEl.insertBefore(sub, newEl.firstChild);
}

// ── Locker Room view (live morale, mid-season + actionable) ─────────────────
// Agency actions — gate-safe (morale only). The user RESPONDS to morale instead
// of just watching it: a team-wide meeting, a one-on-one, or a role promise
// (a commitment that backfires if broken).
function frnCaptainsMeeting() {
  const myId = franchise.chosenTeamId;
  if (franchise._captainsMeetingSeason === franchise.season) return; // once a season
  franchise._captainsMeetingSeason = franchise.season;
  const roster = franchise.rosters?.[myId] || [];
  const caps = roster.filter(p => p.personality === "captain").length;
  const bump = 4 + Math.min(6, caps * 2);
  for (const p of roster) { if (typeof _initMorale === "function") _initMorale(p); p.morale = Math.min(99, +(((p.morale ?? 62) + bump)).toFixed(1)); }
  if (typeof _pushNews === "function") _pushNews({ type: "morale", label: `📣 Captains' meeting — the room responds (+${bump} morale${caps ? `, ${caps} captain${caps > 1 ? "s" : ""} leading` : ""})` });
  if (typeof saveFranchise === "function") saveFranchise();
  renderFrnLockerRoom();
}
function frnLockerTalk(name) {
  const myId = franchise.chosenTeamId;
  const p = (franchise.rosters?.[myId] || []).find(x => x.name === name);
  if (!p || p._talkedSeason === franchise.season) return;
  p._talkedSeason = franchise.season;
  if (typeof _initMorale === "function") _initMorale(p);
  const culture = franchise.coaches?.[myId]?.hc?.cultureTrait;
  let base = culture === "Players' Coach" ? 12 : culture === "Disciplinarian" ? 7 : 9;
  base = Math.max(3, base - (p._brokenPromises || 0) * 3); // trust erosion from broken promises
  p.morale = Math.min(99, +((p.morale + base)).toFixed(1));
  if (p.morale >= 50 && p._wantsOut) { delete p._wantsOut; p._moraleLowWeeks = 0; }
  if (typeof saveFranchise === "function") saveFranchise();
  renderFrnLockerRoom();
}
function frnLockerPromise(name) {
  const myId = franchise.chosenTeamId;
  const p = (franchise.rosters?.[myId] || []).find(x => x.name === name);
  if (!p || p._promise) return;
  if (typeof _initMorale === "function") _initMorale(p);
  const w = franchise.week || 1;
  p._promise = { week: w, deadline: w + 4 };
  p.morale = Math.min(99, +((p.morale + 15)).toFixed(1));
  if (p._wantsOut) { delete p._wantsOut; p._moraleLowWeeks = 0; }
  if (typeof saveFranchise === "function") saveFranchise();
  renderFrnLockerRoom();
}
function renderFrnLockerRoom() {
  const el = $("frnHomeContent");
  if (!el) return;
  const myId = franchise.chosenTeamId;
  const roster = (franchise.rosters?.[myId] || []).slice();
  if (!roster.length) { el.innerHTML = `<div style="padding:1rem;color:var(--gray)">No roster.</div>`; return; }
  if (typeof _initMorale === "function") roster.forEach(p => _initMorale(p));
  const tierOf = (m) => (typeof _moraleTier === "function") ? _moraleTier(m) : { icon: "😐", label: "—", color: "var(--gray)" };
  const rank = (typeof _starterRankByPos === "function") ? _starterRankByPos(myId) : new Map();
  const reasonOf = (p) => (typeof _moraleReason === "function") ? _moraleReason(p, myId, rank) : "";
  const lr = (typeof _lockerRoom === "function") ? _lockerRoom(myId) : { captains: [], cancers: [], pairs: [] };
  const esc = n => (n || "").replace(/'/g, "&#39;");

  const avg = roster.reduce((s, p) => s + (p.morale ?? 62), 0) / roster.length;
  const mood = tierOf(avg);
  const moodPct = Math.round(Math.max(0, Math.min(100, avg)));
  // Frustrated-or-worse (tier boundary at 50) starters/contributors need attention.
  const disgruntled = roster.filter(p => (p.overall || 0) >= 78 && (p.morale ?? 62) < 50).sort((a, b) => (a.morale ?? 62) - (b.morale ?? 62));
  const sorted = roster.slice().sort((a, b) => (a.morale ?? 62) - (b.morale ?? 62));

  const row = (p) => {
    const t = tierOf(p.morale ?? 62);
    const tag = p.personality === "captain" ? `<span style="color:var(--gold);font-size:.52rem"> ⭐</span>`
              : p.personality === "cancer"  ? `<span style="color:#ff8a8a;font-size:.52rem"> ☢</span>` : "";
    return `<div class="frn-lr-row">
      <span class="frn-lr-name" onclick="frnOpenPlayerCard('${esc(p.name)}')" title="Open ${esc(p.name)}">${p.name}${tag}</span>
      <span class="frn-lr-pos">${p.position}</span>
      <span class="frn-lr-ovr">${p.overall || 0}</span>
      <span class="frn-lr-mood" style="color:${t.color}">${t.icon} ${t.label}</span>
      <span class="frn-lr-reason">${reasonOf(p)}</span>
    </div>`;
  };

  const leaders = [];
  if (lr.captains.length) leaders.push(`<span style="color:var(--gold)">⭐ ${lr.captains.length} captain${lr.captains.length === 1 ? "" : "s"}</span>`);
  if (lr.cancers.length)  leaders.push(`<span style="color:#ff8a8a">☢ ${lr.cancers.length} cancer${lr.cancers.length === 1 ? "" : "s"}</span>`);
  if (lr.pairs.length)    leaders.push(`<span style="color:#86e0a3">🤝 ${lr.pairs.length} mentorship${lr.pairs.length === 1 ? "" : "s"}</span>`);

  const capMeetUsed = franchise._captainsMeetingSeason === franchise.season;
  const capMeetBtn = `<button class="frn-lr-act" ${capMeetUsed ? "disabled" : `onclick="frnCaptainsMeeting()"`} title="${capMeetUsed ? "Already held this season" : "Team-wide morale bump — once per season, stronger with captains"}" style="${capMeetUsed ? "opacity:.4;cursor:not-allowed" : ""}">📣 Captains' Meeting</button>`;
  // Active role promises (and their countdown).
  const promised = roster.filter(p => p._promise);
  const promiseLine = promised.length
    ? `<div style="font-size:.58rem;color:var(--gold-lt);margin-top:.35rem">🎯 Promised a role: ${promised.map(p => `<b>${esc(p.name)}</b> <span style="color:var(--gray)">(${Math.max(0, (p._promise.deadline - (franchise.week || 1)))}wk to deliver)</span>`).join(" · ")}</div>`
    : "";
  // Per-player action buttons for the attention list.
  const actBtns = (p) => {
    const talked = p._talkedSeason === franchise.season;
    const trust = (p._brokenPromises || 0) > 0 ? ` <span style="color:#ff8a8a;font-size:.52rem" title="${p._brokenPromises} broken promise(s) — talks land softer">trust ✗${p._brokenPromises}</span>` : "";
    const talkBtn = `<button class="frn-lr-act" ${talked ? "disabled" : `onclick="frnLockerTalk('${esc(p.name)}')"`} title="${talked ? "Talked this season" : "One-on-one — once a season"}" style="${talked ? "opacity:.4;cursor:not-allowed" : ""}">🗣 Talk</button>`;
    const promiseBtn = p._promise
      ? `<span class="frn-lr-promise">🎯 promised · ${Math.max(0, (p._promise.deadline - (franchise.week || 1)))}wk</span>`
      : `<button class="frn-lr-act" onclick="frnLockerPromise('${esc(p.name)}')" title="Promise a starting role — +morale now, but a 4-week commitment: deliver or it backfires">🎯 Promise role</button>`;
    return `<span class="frn-lr-acts">${talkBtn}${promiseBtn}${trust}</span>`;
  };

  el.innerHTML = `<div style="padding:1rem;max-width:800px;margin:0 auto">
    <div style="display:flex;align-items:baseline;gap:.5rem;margin-bottom:.5rem">
      <span style="font-size:.95rem;font-weight:900;color:var(--gold)">🛋 LOCKER ROOM</span>
      <span style="font-size:.62rem;color:var(--gray)">live team mood — updates every week from results, role &amp; contracts</span>
    </div>
    <div class="frn-lr-mood-card">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.28rem">
        <span style="font-size:.6rem;letter-spacing:1px;color:var(--gold);font-weight:700">TEAM MOOD</span>
        <span style="font-size:.74rem;color:${mood.color};font-weight:700">${mood.icon} ${mood.label} · ${avg.toFixed(0)}</span>
      </div>
      <div class="frn-lr-meter"><div class="frn-lr-meter-fill" style="width:${moodPct}%;background:${mood.color}"></div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:.4rem;gap:.5rem;flex-wrap:wrap">
        ${leaders.length ? `<div style="font-size:.58rem;color:var(--gray);display:flex;gap:.7rem">${leaders.join("")}</div>` : "<span></span>"}
        ${capMeetBtn}
      </div>
      ${promiseLine}
    </div>
    ${disgruntled.length ? `<div class="frn-lr-alert">
      <div style="font-size:.6rem;letter-spacing:.8px;color:#ff8a8a;font-weight:700;margin-bottom:.3rem">⚠ NEEDS ATTENTION (${disgruntled.length})</div>
      ${disgruntled.map(p => { const t = tierOf(p.morale); const wantsOut = p._wantsOut ? ` <span style="color:#ff8a8a;font-weight:800;font-size:.56rem;border:1px solid #ff8a8a;padding:.02rem .25rem">📢 WANTS OUT</span>` : ""; return `<div class="frn-lr-att-row"><div style="font-size:.64rem"><b style="cursor:pointer" onclick="frnOpenPlayerCard('${esc(p.name)}')">${p.name}</b> <span style="color:var(--gold-lt)">${p.position} ${p.overall}</span> · <span style="color:${t.color}">${t.icon} ${t.label}</span> <span style="color:var(--gray)">· ${reasonOf(p)}</span>${wantsOut}</div>${actBtns(p)}</div>`; }).join("")}
      <div style="font-size:.56rem;color:var(--gray);margin-top:.3rem;font-style:italic">Talk to them, promise a role, win games — or move them before it spreads.</div>
    </div>` : `<div style="font-size:.6rem;color:#86e0a3;margin-bottom:.6rem">✓ No disgruntled stars — the room is in a good place.</div>`}
    <div class="frn-lr-list-head">ROSTER MOOD · problems first</div>
    <div class="frn-lr-rows">${sorted.map(row).join("")}</div>
  </div>`;
}

// ── Draft report card (the scouting feedback loop) ──────────────────────────
// Ages each past class the user drafted: where is each pick now, and did the
// pick — and the scouting spent on him — pan out? Round → "a hit at this slot"
// overall, tuned to the league OVR distribution (mean ~77).
const _DRAFT_ROUND_EXPECT = { 1: 82, 2: 78, 3: 74, 4: 71, 5: 68, 6: 65, 7: 63, 0: 60 };
function _draftReportVerdict(pick, cur, seasonsSince) {
  const exp = _DRAFT_ROUND_EXPECT[pick.round] ?? 72;
  if (seasonsSince <= 0) {
    return { key: "tbd", label: "JUST DRAFTED", icon: "🆕", color: "var(--gray)", note: "too early to judge" };
  }
  if (!cur.found) {
    return pick.round >= 6
      ? { key: "depth", label: "OUT", icon: "—", color: "var(--gray)", note: "out of the league — a late dart that missed" }
      : { key: "bust", label: "BUST", icon: "✗", color: "#ff8a8a", note: "washed out of the league" };
  }
  const o = cur.overall || 0;
  if ((cur.age || 25) <= 24 && seasonsSince <= 2 && o < exp) {
    return { key: "dev", label: "DEVELOPING", icon: "⏳", color: "var(--gold-lt)", note: `age ${cur.age}, ${o} OVR — still cooking` };
  }
  if (o >= exp + 6) return { key: "steal", label: "STEAL",  icon: "💎", color: "#86e0a3", note: `${o} OVR — well above a R${pick.round} hit` };
  if (o >= exp - 3) return { key: "hit",   label: "HIT",    icon: "✓",  color: "var(--green-lt)", note: `${o} OVR — solid for the slot` };
  return                { key: "bust",  label: "BUST",   icon: "✗",  color: "#ff8a8a", note: `${o} OVR — below the R${pick.round} bar` };
}
function renderFrnDraftReportCard() {
  const el = $("frnHomeContent");
  if (!el) return;
  const log = franchise.draftLog || {};
  const years = Object.keys(log).map(Number).sort((a, b) => b - a); // newest class first
  const curSeason = franchise.season || 0;
  if (!years.length) {
    el.innerHTML = `<div style="padding:1.2rem;max-width:680px;margin:0 auto">
      <div style="font-size:.95rem;font-weight:900;color:var(--gold);margin-bottom:.4rem">📋 DRAFT REPORT CARD</div>
      <div style="color:var(--gray);font-size:.74rem;line-height:1.5">No draft history yet. Your classes appear here after your first draft and
      <b style="color:var(--gold-lt)">age over the seasons</b> — so you can see whether a pick (and the scouting you spent on him) actually panned out:
      the 3rd-round <b style="color:#86e0a3">steal</b> you found, or the reach that <b style="color:#ff8a8a">busted</b>.</div>
    </div>`;
    return;
  }
  const byPid = {}, byName = {};
  for (const [tid, r] of Object.entries(franchise.rosters || {})) for (const p of (r || [])) {
    if (p.pid != null) byPid[p.pid] = { p, tid: Number(tid) };
    if (!byName[p.name]) byName[p.name] = { p, tid: Number(tid) };
  }
  const myId = franchise.chosenTeamId;
  const findNow = (pick) => {
    const hit = (pick.pid != null && byPid[pick.pid]) || byName[pick.name];
    if (!hit) return { found: false };
    return { found: true, overall: hit.p.overall, age: hit.p.age, teamId: hit.tid, onMyTeam: hit.tid === myId };
  };
  const esc = n => (n || "").replace(/'/g, "&#39;").replace(/"/g, "&quot;");

  const classesHtml = years.map(year => {
    const cls = log[year];
    const seasonsSince = curSeason - (cls.season ?? curSeason);
    let scouted = 0, scoutedHit = 0, steals = 0, hits = 0, busts = 0, devs = 0;
    const rows = (cls.picks || []).map(pick => {
      const cur = findNow(pick);
      const v = _draftReportVerdict(pick, cur, seasonsSince);
      if (v.key === "steal") steals++; else if (v.key === "hit") hits++; else if (v.key === "bust") busts++; else if (v.key === "dev") devs++;
      const wasScouted = (pick.scoutedCats || 0) > 0;
      if (wasScouted && seasonsSince > 0) { scouted++; if (v.key === "steal" || v.key === "hit") scoutedHit++; }
      const gradeStr = (pick.gradeAtDraft != null && typeof gradeLabel === "function") ? gradeLabel(pick.gradeAtDraft) : "—";
      const whereNow = !cur.found ? `<span style="color:var(--gray)">—</span>`
        : cur.onMyTeam ? `<span style="color:var(--gold-lt)">your roster</span>`
        : `<span style="color:var(--gray)">${getTeam(cur.teamId)?.name || "?"}</span>`;
      return `<div class="frn-drc-row">
        <span class="frn-drc-slot">R${pick.round}.${pick.pick}${pick.isComp ? "c" : ""}</span>
        <span class="frn-drc-name" onclick="frnOpenPlayerCard('${esc(pick.name)}')" title="Open ${esc(pick.name)}">${pick.name}</span>
        <span class="frn-drc-pos">${pick.pos}</span>
        <span class="frn-drc-grade" title="Draft-day scout grade">${gradeStr}</span>
        <span class="frn-drc-scout" title="${wasScouted ? pick.scoutedCats + ' scouting report(s) spent' : 'not scouted'}">${wasScouted ? `🔍${pick.scoutedCats}` : ""}</span>
        <span class="frn-drc-now">${whereNow}</span>
        <span class="frn-drc-verdict" style="color:${v.color}" title="${v.note}">${v.icon} ${v.label}</span>
      </div>`;
    }).join("");

    let gradeChip = `<span style="color:var(--gray);font-size:.62rem">TBD</span>`;
    if (seasonsSince > 0) {
      const graded = steals + hits + busts + devs;
      const score = graded ? (steals * 2 + hits * 1 + devs * 0.5 - busts * 1) / graded : 0;
      const g = score >= 1.2 ? ["A", "#f5c542"] : score >= 0.8 ? ["B", "#86e0a3"] : score >= 0.4 ? ["C", "#e0b078"] : score >= 0 ? ["D", "#ff9b9b"] : ["F", "#ff6b6b"];
      gradeChip = `<span style="font-family:'Bebas Neue','Anton',sans-serif;font-size:1.4rem;color:${g[1]};letter-spacing:.5px">${g[0]}</span>`;
    }
    const scoutLine = (seasonsSince > 0 && scouted > 0)
      ? `<div style="font-size:.62rem;color:var(--gray);margin-top:.3rem">🔍 Scouting payoff: <b style="color:${scoutedHit >= Math.ceil(scouted * 0.66) ? "#86e0a3" : "#e0b078"}">${scoutedHit}/${scouted}</b> scouted picks panned out</div>`
      : "";
    const summary = seasonsSince > 0
      ? `<span style="color:#86e0a3">💎 ${steals}</span> · <span style="color:var(--green-lt)">✓ ${hits}</span> · <span style="color:var(--gold-lt)">⏳ ${devs}</span> · <span style="color:#ff8a8a">✗ ${busts}</span>`
      : `<span style="color:var(--gray)">just drafted — check back next season</span>`;

    return `<div class="frn-drc-class">
      <div class="frn-drc-class-head">
        <div>
          <span style="font-size:.8rem;font-weight:900;color:var(--gold)">Class of ${year}</span>
          <span style="font-size:.6rem;color:var(--gray);margin-left:.4rem">${(cls.picks || []).length} picks · ${seasonsSince === 0 ? "this offseason" : seasonsSince + " season" + (seasonsSince === 1 ? "" : "s") + " ago"}</span>
        </div>
        <div style="text-align:right">${gradeChip}</div>
      </div>
      <div style="font-size:.64rem;margin-bottom:.35rem">${summary}</div>
      <div class="frn-drc-rows">${rows}</div>
      ${scoutLine}
    </div>`;
  }).join("");

  el.innerHTML = `<div style="padding:1rem;max-width:760px;margin:0 auto">
    <div style="display:flex;align-items:baseline;gap:.5rem;margin-bottom:.5rem">
      <span style="font-size:.95rem;font-weight:900;color:var(--gold)">📋 DRAFT REPORT CARD</span>
      <span style="font-size:.6rem;color:var(--gray)">did the pick — and the scouting — pan out?</span>
    </div>
    ${classesHtml}
  </div>`;
}

// League tab — sub-nav across the league context (standings, stat
// leaders, wire archive, legacy, alumni). Each sub-tab calls its
// existing canonical render and we prepend the sub-nav strip so the
// shell + sub-nav stay visible while the underlying page swaps in.
let _frnLeagueSubTab = "standings";
const _FRN_LEAGUE_TABS = [
  { id: "standings", label: "Standings",   fn: () => typeof renderFrnStandings    === "function" && renderFrnStandings() },
  { id: "capmap",    label: "Cap Map",     fn: () => typeof renderFrnLeagueCapMap === "function" && renderFrnLeagueCapMap() },
  { id: "stats",     label: "Stat Leaders",fn: () => typeof renderFrnLeaders      === "function" && renderFrnLeaders() },
  { id: "wire",      label: "News Wire",   fn: () => typeof renderFrnNewsArchive  === "function" && renderFrnNewsArchive() },
  { id: "legacy",    label: "Legacy",      fn: () => typeof renderFrnLegacy       === "function" && renderFrnLegacy() },
  { id: "alumni",    label: "Alumni",      fn: () => typeof renderFrnAlumni       === "function" && renderFrnAlumni() },
];
function frnSetLeagueSubTab(id) {
  if (!_FRN_LEAGUE_TABS.some(t => t.id === id)) return;
  _frnLeagueSubTab = id;
  renderFrnLeagueHome();
}
// League-wide Cap Map — treemap of all 32 teams, area = cap used, color
// = cap health. Click a tile → opens that team's stats page (existing
// team-link route). Color modes: Cap Used (default), Roster Strength
// (avg OVR), Division.
let _lcmColorMode = "capused";
function frnLCMSetColorMode(mode) {
  _lcmColorMode = mode;
  renderFrnLeagueCapMap();
}
function renderFrnLeagueCapMap() {
  if (typeof _faSquarify !== "function") {
    $("frnHomeContent").innerHTML = `<div style="padding:1rem;color:var(--gray)">Cap-map helpers not loaded.</div>`;
    return;
  }
  const cap = (typeof effectiveSalaryCap === "function") ? effectiveSalaryCap(franchise.chosenTeamId) : (franchise.salaryCap || SALARY_CAP_BASE);
  const teams = TEAMS.map(t => {
    const used = (typeof capUsedByTeam === "function") ? capUsedByTeam(t.id) : 0;
    const roster = franchise.rosters[t.id] || [];
    const avgOvr = roster.length ? Math.round(roster.reduce((s,p)=>s+(p.overall||0),0)/roster.length) : 0;
    return { t, used, avgOvr, roster };
  }).sort((a,b) => b.used - a.used);
  const totalUsed = teams.reduce((s,x) => s + x.used, 0);
  const overTeams  = teams.filter(x => x.used > cap).length;
  const tightTeams = teams.filter(x => x.used > cap*0.95 && x.used <= cap).length;

  const tmW = 720, tmH = 360;
  const items = teams.map(x => ({ value: Math.max(0.5, x.used), payload: x }));
  const tiles = _faSquarify(items, tmW, tmH);

  const colorFor = (x) => {
    if (_lcmColorMode === "ovr") {
      const o = x.avgOvr;
      if (o >= 82) return "#3aa84a";
      if (o >= 78) return "#86e0a3";
      if (o >= 74) return "#f5c542";
      if (o >= 70) return "#ef8a4d";
      return "#b14b4b";
    }
    if (_lcmColorMode === "division") {
      const div = (x.t.division || "?").toString();
      // Simple hash to pick a hue
      let h = 0; for (let i = 0; i < div.length; i++) h = (h * 31 + div.charCodeAt(i)) | 0;
      const hue = Math.abs(h) % 360;
      return `hsl(${hue},45%,55%)`;
    }
    // Cap used (default): red over, amber tight, gold healthy, green room
    const pct = (x.used / cap) * 100;
    if (pct > 100) return "#ff8a8a";
    if (pct > 95)  return "#ef8a4d";
    if (pct > 85)  return "#f5c542";
    if (pct > 70)  return "#86e0a3";
    return "#3aa84a";
  };

  const cleanN = (s) => (s||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
  const renderedTiles = tiles.map(t => {
    const x = t.item.payload;
    const fill = colorFor(x);
    const wPct = (t.w / tmW) * 100;
    const hPct = (t.h / tmH) * 100;
    const xPct = (t.x / tmW) * 100;
    const yPct = (t.y / tmH) * 100;
    const tileArea = t.w * t.h;
    const isMe = x.t.id === franchise.chosenTeamId;
    const pct = ((x.used / cap) * 100).toFixed(0);
    const overlabel = x.used > cap ? ` (+$${(x.used-cap).toFixed(1)}M)` : "";
    const showName = tileArea > 1200;
    const showSub  = tileArea > 2400;
    return `<div class="frn-lcm-tile${isMe?' me':''}"
      style="left:${xPct.toFixed(2)}%;top:${yPct.toFixed(2)}%;width:${wPct.toFixed(2)}%;height:${hPct.toFixed(2)}%;background:${fill}"
      onclick="frnLCMClick(${x.t.id})"
      title="${x.t.city} ${x.t.name} · $${x.used.toFixed(1)}M / $${cap.toFixed(0)}M (${pct}%${overlabel}) · ${x.avgOvr} avg OVR · ${x.roster.length} rostered">
      ${showName ? `<div class="frn-lcm-name">${x.t.name.toUpperCase()}</div>` : ""}
      ${showSub  ? `<div class="frn-lcm-sub">$${x.used.toFixed(0)}M · ${pct}%</div>` : ""}
    </div>`;
  }).join("");

  const modes = [
    { key: "capused",  lbl: "Cap Used %" },
    { key: "ovr",      lbl: "Roster Strength" },
    { key: "division", lbl: "Division" },
  ];
  const modeChips = modes.map(m =>
    `<button class="frn-cuts-tm-mode${_lcmColorMode===m.key?' active':''}" onclick="frnLCMSetColorMode('${m.key}')">${m.lbl}</button>`
  ).join("");
  const legendByMode = {
    capused: [["Over (>100%)","#ff8a8a"],["Tight (>95%)","#ef8a4d"],["Healthy (>85%)","#f5c542"],["Room (>70%)","#86e0a3"],["Loose (<70%)","#3aa84a"]],
    ovr: [["Elite ≥82","#3aa84a"],["Strong ≥78","#86e0a3"],["Mid ≥74","#f5c542"],["Weak ≥70","#ef8a4d"],["Bad <70","#b14b4b"]],
    division: [["Color = division","#888"]],
  };
  const legend = (legendByMode[_lcmColorMode] || []).map(([k,c]) =>
    `<span class="frn-cuts-tm-legend-item"><span class="dot" style="background:${c}"></span>${k}</span>`
  ).join("");

  $("frnHomeContent").innerHTML = `
    <div class="frn-cuts-treemap-wrap" style="max-width:1100px;margin:0 auto">
      <div class="frn-cuts-treemap-head">
        <span class="frn-cuts-tm-title">🌐 LEAGUE CAP MAP · 32 teams</span>
        <span class="frn-cuts-tm-sub">${overTeams} over · ${tightTeams} tight · click any team to inspect</span>
      </div>
      <div class="frn-cuts-treemap-canvas legal" style="aspect-ratio:${tmW}/${tmH}">
        ${renderedTiles}
      </div>
      <div class="frn-cuts-tm-controls">
        <span class="frn-cuts-tm-controls-label">Color by:</span>
        ${modeChips}
        <span class="frn-cuts-tm-legend">${legend}</span>
      </div>
      <div style="margin-top:.9rem;color:var(--gray);font-size:.65rem;text-align:center">
        Tile area is each team's current cap spend. ${totalUsed.toFixed(0)}M total league-wide ·
        cap: $${cap.toFixed(0)}M/team · ${overTeams ? `<span style="color:#ff8a8a;font-weight:700">${overTeams} team${overTeams===1?"":"s"} need to cut</span>` : "all teams cap-legal"}
      </div>
    </div>`;
}
function frnLCMClick(teamId) {
  // Click → opens that team's roster modal via the existing route used
  // by every other team-tile click site (player card team line, etc.)
  if (typeof frnOpenTeamCard === "function") frnOpenTeamCard(teamId);
}

function renderFrnLeagueHome() {
  const el = $("frnHomeContent");
  if (el) el.innerHTML = ""; // clear first so an early-returning sub-render can't stack sub-navs
  const active = _FRN_LEAGUE_TABS.find(t => t.id === _frnLeagueSubTab) || _FRN_LEAGUE_TABS[0];
  active.fn();
  // Prepend a sub-nav strip so the user can move between league views
  // without leaving the tab. The underlying renders set innerHTML
  // wholesale, so we attach our sub-nav after the fact.
  const newEl = $("frnHomeContent");
  if (!newEl) return;
  const sub = document.createElement("div");
  sub.className = "frn-subnav";
  sub.innerHTML = _FRN_LEAGUE_TABS.map(t =>
    `<button class="frn-subnav-btn${t.id===active.id?" active":""}" onclick="frnSetLeagueSubTab('${t.id}')">${t.label}</button>`
  ).join("");
  newEl.insertBefore(sub, newEl.firstChild);
}

// Tools tab landing — links to existing utility pages (analytics, joint
// practice, future FAs). Keeps related "front-office adjacent" tools
// in one spot.
function _frnRenderTabTools() {
  const pendingJP = (franchise.jointPracticeOffers||[]).filter(o => o.status === "pending" && o.toTeamId === franchise.chosenTeamId).length;
  $("frnHomeContent").innerHTML = `
    <div class="frn-tab-landing">
      <div class="frn-tab-landing-title">🛠 TOOLS</div>
      <div class="frn-tab-landing-grid">
        <button class="frn-tab-tile" onclick="renderFrnAnalytics('mysheet')">
          <span class="frn-tab-tile-icon">📊</span>
          <span class="frn-tab-tile-label">Analytics</span>
          <span class="frn-tab-tile-sub">cap sheet · dead cap · trends</span>
        </button>
        <button class="frn-tab-tile" onclick="renderFrnScrimmages()">
          <span class="frn-tab-tile-icon">🏟</span>
          <span class="frn-tab-tile-label">Joint Practice${pendingJP?` · <span style="color:#ffc850">${pendingJP} pending</span>`:""}</span>
          <span class="frn-tab-tile-sub">scout an opponent in shared reps</span>
        </button>
        <button class="frn-tab-tile" onclick="renderFrnProjectedFAs()">
          <span class="frn-tab-tile-icon">📅</span>
          <span class="frn-tab-tile-label">Future FAs</span>
          <span class="frn-tab-tile-sub">expiring contracts league-wide</span>
        </button>
      </div>
    </div>`;
}

// ── Season Recap (regular → playoffs transition) ─────────────────────────────
// Full-screen interstitial shown after the final regular-season game and
// before the playoff bracket opens. Hero banner + your-season summary +
// final standings + award race + bracket reveal + start-playoffs CTA.
// Replaces the dashboard during this brief window so the moment feels
// like an actual milestone, not just another button to click.
function renderFrnSeasonRecap() {
  const myId    = franchise.chosenTeamId;
  const myTeam  = getTeam(myId);
  const myStand = franchise.standings?.[myId] || { w:0, l:0, t:0, pf:0, pa:0 };
  const sorted  = standingsSorted();
  const myIdx   = sorted.findIndex(s => s.id === myId);
  const seed    = myIdx + 1;
  const inPlayoffs = seed > 0 && seed <= PLAYOFF_TEAMS;
  const myRtg   = frnTeamRating(myId);
  const recStr  = `${myStand.w}-${myStand.l}${myStand.t?`-${myStand.t}`:""}`;
  const pf      = myStand.pf || 0, pa = myStand.pa || 0;
  const diff    = pf - pa;
  // Rank lookups for OFF / DEF — sort by points scored / allowed.
  const ppgSort = (key, asc=false) => Object.entries(franchise.standings || {})
    .map(([tid, s]) => ({ id:+tid, val: s[key] || 0 }))
    .sort((a,b) => asc ? a.val - b.val : b.val - a.val);
  const offRank = ppgSort("pf").findIndex(x => x.id === myId) + 1;
  const defRank = ppgSort("pa", true).findIndex(x => x.id === myId) + 1;

  // Best win / worst loss — search this season's schedule for the user.
  const myGames = (franchise.schedule || []).filter(g =>
    g.played && (g.homeId === myId || g.awayId === myId));
  const gameMargin = g => {
    const isHome = g.homeId === myId;
    const my = isHome ? g.homeScore : g.awayScore;
    const them = isHome ? g.awayScore : g.homeScore;
    const oppId = isHome ? g.awayId : g.homeId;
    return { my, them, oppId, isWin: my > them, isLoss: my < them, margin: my - them, week: g.week };
  };
  const margins = myGames.map(gameMargin);
  const bestWin  = margins.filter(m => m.isWin).sort((a,b) => b.margin - a.margin)[0];
  const worstLoss = margins.filter(m => m.isLoss).sort((a,b) => a.margin - b.margin)[0];
  const formStrip = margins.slice(-6).map(m => {
    const col = m.isWin ? "var(--green-lt)" : m.isLoss ? "#c08080" : "var(--gray)";
    return `<span style="color:${col};font-weight:700">${m.isWin?"W":m.isLoss?"L":"T"}</span>`;
  }).join(" ");

  // ── Hero status callout ────────────────────────────────────────────────
  const statusCallout = inPlayoffs
    ? `<div class="frn-recap-status in" style="--accent:${myTeam.primary||'var(--gold)'}">
        <div class="frn-recap-status-lbl">PLAYOFF BOUND</div>
        <div class="frn-recap-status-main">#${seed} seed</div>
        <div class="frn-recap-status-sub">Heading to ${seed === 1 ? "Wild Card weekend with a top seed" : "Wild Card weekend"}</div>
      </div>`
    : `<div class="frn-recap-status out">
        <div class="frn-recap-status-lbl">SEASON OVER</div>
        <div class="frn-recap-status-main">#${seed} of ${TEAMS.length}</div>
        <div class="frn-recap-status-sub">Missed the cut — top ${PLAYOFF_TEAMS} advance. Offseason work begins.</div>
      </div>`;

  // ── Your-season summary card ───────────────────────────────────────────
  const yourSeasonHtml = `
    <div class="frn-recap-card frn-recap-your" style="--accent:${myTeam.primary||'var(--gold)'}">
      <div class="frn-recap-team-head">
        <div class="frn-recap-team-name">${myTeam.city.toUpperCase()} ${myTeam.name.toUpperCase()}</div>
        <div class="frn-recap-team-rec">${recStr}</div>
      </div>
      <div class="frn-recap-team-grid">
        <div><span class="lbl">PF</span><span class="val">${pf}</span></div>
        <div><span class="lbl">PA</span><span class="val">${pa}</span></div>
        <div><span class="lbl">DIFF</span><span class="val" style="color:${diff>=0?'var(--green-lt)':'#c08080'}">${diff>=0?"+":""}${diff}</span></div>
        <div><span class="lbl">OFF</span><span class="val">#${offRank}</span></div>
        <div><span class="lbl">DEF</span><span class="val">#${defRank}</span></div>
        <div><span class="lbl">OFF RTG</span><span class="val">${myRtg.off}</span></div>
        <div><span class="lbl">DEF RTG</span><span class="val">${myRtg.def}</span></div>
        <div><span class="lbl">SEED</span><span class="val" style="color:${inPlayoffs?'var(--gold)':'var(--gray)'}">${inPlayoffs?`#${seed}`:"—"}</span></div>
      </div>
      <div class="frn-recap-form-row">
        <span class="lbl">LAST 6</span>
        <span class="form">${formStrip || `<span style="color:var(--gray)">—</span>`}</span>
      </div>
      ${(bestWin || worstLoss) ? `<div class="frn-recap-bestworst">
        ${bestWin ? `<div class="bw win"><span class="lbl">SIGNATURE WIN</span> W${bestWin.week} vs <b>${getTeam(bestWin.oppId)?.name||"?"}</b> <span class="score">${bestWin.my}–${bestWin.them}</span></div>`:""}
        ${worstLoss ? `<div class="bw loss"><span class="lbl">WORST LOSS</span> W${worstLoss.week} vs <b>${getTeam(worstLoss.oppId)?.name||"?"}</b> <span class="score">${worstLoss.my}–${worstLoss.them}</span></div>`:""}
      </div>` : ""}
    </div>`;

  // ── Final Standings (32-team compact) ──────────────────────────────────
  const standingsRows = sorted.map((s, i) => {
    const isPlayoff = i < PLAYOFF_TEAMS;
    const isMine    = s.id === myId;
    const t = s.team;
    const gp = s.w + s.l + s.t;
    const pct = gp ? (s.w / gp).toFixed(3).replace(/^0/,"") : ".000";
    const pdiff = (s.pf || 0) - (s.pa || 0);
    return `<tr class="frn-recap-stand-row ${isMine?"mine":""} ${isPlayoff?"playoff":""}">
      <td class="seed">${isPlayoff ? `<span class="seed-pill">${i+1}</span>` : i+1}</td>
      <td class="team" style="color:${t.primary}">${isMine?"» ":""}${t.city} ${t.name}</td>
      <td class="rec">${s.w}-${s.l}${s.t?`-${s.t}`:""}</td>
      <td class="pct">${pct}</td>
      <td class="pf">${s.pf}</td>
      <td class="pa">${s.pa}</td>
      <td class="diff" style="color:${pdiff>=0?'var(--green-lt)':'#c08080'}">${pdiff>=0?"+":""}${pdiff}</td>
    </tr>`;
  }).join("");
  const standingsHtml = `
    <div class="frn-recap-card frn-recap-standings">
      <div class="frn-recap-card-title">FINAL STANDINGS <span class="sub">top ${PLAYOFF_TEAMS} → playoffs</span></div>
      <table class="frn-recap-stand-table">
        <thead><tr><th></th><th>Team</th><th>W-L</th><th>%</th><th>PF</th><th>PA</th><th>±</th></tr></thead>
        <tbody>${standingsRows}</tbody>
      </table>
    </div>`;

  // ── Award race ─────────────────────────────────────────────────────────
  const awardCard = (label, entry, statFn) => {
    if (!entry) return `<div class="frn-recap-award-card empty"><div class="lbl">${label}</div><div class="empty-note">No clear favorite yet</div></div>`;
    const t = getTeam(entry.teamId);
    const isMine = entry.teamId === myId;
    return `<div class="frn-recap-award-card${isMine?" mine":""}">
      <div class="lbl">${label}</div>
      <div class="name">${entry.name}</div>
      <div class="meta">${entry.pos||"?"} · <span style="color:${t?.primary||'var(--gold)'}">${t?.name||"?"}</span></div>
      ${statFn ? `<div class="stat">${statFn(entry)}</div>` : ""}
    </div>`;
  };
  const fmtMVPStat = (e) => {
    const pos = e.pos || "";
    if (pos === "QB") return `${e.pass_yds||0} pyds · ${e.pass_td||0} TD`;
    if (pos === "RB") return `${e.rush_yds||0} ryds · ${e.rush_td||0} TD`;
    if (pos === "WR" || pos === "TE") return `${e.rec_yds||0} ryds · ${e.rec_td||0} TD`;
    return "";
  };
  const fmtDefStat = (e) => `${e.tkl||0} TKL${e.sk?` · ${e.sk} SK`:""}${e.int_made?` · ${e.int_made} INT`:""}`;
  const mvpFav  = (typeof computeLeagueMVP === "function") ? computeLeagueMVP() : null;
  const opoyFav = (typeof _computeOPOY === "function") ? _computeOPOY() : null;
  const dpoyFav = (typeof _computeDPOY === "function") ? _computeDPOY() : null;
  const royFav  = (typeof _computeROY === "function") ? _computeROY() : null;
  const awardsHtml = `
    <div class="frn-recap-card frn-recap-awards">
      <div class="frn-recap-card-title">AWARD RACE <span class="sub">frontrunners going into the playoffs</span></div>
      <div class="frn-recap-award-grid">
        ${awardCard("LEAGUE MVP",     mvpFav,  fmtMVPStat)}
        ${awardCard("OFFENSIVE POY",  opoyFav, fmtMVPStat)}
        ${awardCard("DEFENSIVE POY",  dpoyFav, fmtDefStat)}
        ${awardCard("ROOKIE OF YEAR", royFav,  fmtMVPStat)}
      </div>
      <div class="frn-recap-award-note">Final awards locked in at season's end after the championship.</div>
    </div>`;

  // ── Bracket reveal ─────────────────────────────────────────────────────
  // Show the seeded 8-team bracket pre-render (1v8, 4v5, 2v7, 3v6 → semis → final)
  const top8 = sorted.slice(0, PLAYOFF_TEAMS);
  const mkBracketMatchup = (highSeedIdx, lowSeedIdx) => {
    const hi = top8[highSeedIdx], lo = top8[lowSeedIdx];
    if (!hi || !lo) return `<div class="frn-recap-bracket-match empty">TBD</div>`;
    const hiMine = hi.id === myId, loMine = lo.id === myId;
    const userMatch = hiMine || loMine;
    return `<div class="frn-recap-bracket-match${userMatch?" mine":""}">
      ${userMatch?`<div class="user-tag">⭐ YOUR MATCHUP</div>`:""}
      <div class="team" style="--accent:${hi.team.primary}">
        <span class="seed">${highSeedIdx+1}</span>
        <span class="name">${hi.team.abbr || hi.team.name.slice(0,3).toUpperCase()}</span>
        <span class="rec">${hi.w}-${hi.l}</span>
      </div>
      <div class="vs">vs</div>
      <div class="team" style="--accent:${lo.team.primary}">
        <span class="seed">${lowSeedIdx+1}</span>
        <span class="name">${lo.team.abbr || lo.team.name.slice(0,3).toUpperCase()}</span>
        <span class="rec">${lo.w}-${lo.l}</span>
      </div>
    </div>`;
  };
  // Round 1 in seed pairing: 1v8, 4v5, 2v7, 3v6
  const r1Pairs = [[0,7],[3,4],[1,6],[2,5]];
  const bracketHtml = `
    <div class="frn-recap-card frn-recap-bracket">
      <div class="frn-recap-card-title">PLAYOFF BRACKET <span class="sub">wild card weekend</span></div>
      <div class="frn-recap-bracket-grid">
        ${r1Pairs.map(([h,l]) => mkBracketMatchup(h,l)).join("")}
      </div>
      ${inPlayoffs ? `<div class="frn-recap-bracket-path">
        Win 3 in a row → SEASON ${franchise.season} CHAMPION
      </div>` : ""}
    </div>`;

  // ── CTA ────────────────────────────────────────────────────────────────
  const ctaHtml = `
    <div class="frn-recap-cta-row">
      <button class="frn-recap-cta-btn" onclick="frnConfirmStartPlayoffs()">
        ${inPlayoffs ? "▶ BEGIN WILD CARD WEEKEND" : "▶ START THE PLAYOFFS"}
        <span class="sub">${inPlayoffs ? "Your path to the championship starts now" : "Watch how the bracket plays out"}</span>
      </button>
    </div>`;

  $("frnHomeContent").innerHTML = `
    <div class="frn-recap-wrap">
      <header class="frn-recap-hero">
        <div class="frn-recap-hero-eyebrow">SEASON ${franchise.season}</div>
        <h1 class="frn-recap-hero-title">REGULAR SEASON COMPLETE</h1>
        <div class="frn-recap-hero-sub">${PLAYOFF_TEAMS} teams play on · ${TEAMS.length - PLAYOFF_TEAMS} head into the offseason</div>
        ${statusCallout}
      </header>
      ${yourSeasonHtml}
      <div class="frn-recap-grid">
        ${standingsHtml}
        <div class="frn-recap-grid-side">
          ${awardsHtml}
          ${bracketHtml}
        </div>
      </div>
      ${ctaHtml}
    </div>`;
}

function renderFrnRegular() {
  const { chosenTeamId, season, week, schedule, standings, seasonHighlights } = franchise;
  const myTeam  = getTeam(chosenTeamId);
  const myStand = standings[chosenTeamId] || { w:0, l:0, t:0, pf:0, pa:0 };

  const myGames  = schedule
    .filter(g => g.homeId === chosenTeamId || g.awayId === chosenTeamId)
    .sort((a, b) => a.week - b.week);
  const nextGame = myGames.find(g => !g.played) || null;
  const sorted   = standingsSorted();
  const seasonDone = week > FRANCHISE_WEEKS;
  const recStr  = `${myStand.w}-${myStand.l}${myStand.t ? `-${myStand.t}` : ""}`;
  const myRtg   = frnTeamRating(chosenTeamId);

  const myRoster = franchise.rosters[chosenTeamId] || [];

  // ─── Cap ───────────────────────────────────────────────────────────────
  const cap = effectiveSalaryCap(chosenTeamId);
  const capUsed = capUsedByTeam(chosenTeamId);
  const capPct  = Math.round(capUsed / cap * 100);
  const capColor = capPct >= 95 ? "var(--red)" : capPct >= 85 ? "#e8a000" : "var(--green-lt)";
  const refundsInfo = refundsForTeam(chosenTeamId);
  const refundLine = (refundsInfo.outgoingTotal || refundsInfo.incomingTotal)
    ? ` · ${refundsInfo.outgoingTotal > 0 ? `<span style="color:var(--red);font-size:.6rem">Fees −$${refundsInfo.outgoingTotal.toFixed(1)}M</span>` : ""}${refundsInfo.incomingTotal > 0 ? `<span style="color:var(--green-lt);font-size:.6rem">+$${refundsInfo.incomingTotal.toFixed(1)}M</span>` : ""}`
    : "";

  // ─── FA negotiations ──────────────────────────────────────────────────
  const negs = franchise.faNegotiations || {};
  const activeNegs = Object.values(negs).filter(n => n.state === "negotiating");
  const myActiveNegs = activeNegs.filter(n => n.yourBid);
  const outbidCount  = myActiveNegs.filter(n => { const h = _faNegCurrentHigh(n); return h && !h.isYou; }).length;

  // ─── Contextual data ──────────────────────────────────────────────────
  const injured  = myRoster.filter(p => p.injury && p.injury.weeksRemaining > 0);
  const demands  = (franchise.holdoutDemands || []).filter(d => d.deadlineWeek >= week);
  const psAlerts = (franchise.psPoachAlerts || []).filter(a => a.ownerTeamId === chosenTeamId && a.deadlineWeek >= week).length;

  // Form strip: last 5 results
  const playedGames = myGames.filter(g => g.played).slice(-5);
  const formStrip = playedGames.map(g => {
    const isHome = g.homeId === chosenTeamId;
    const my = isHome ? g.homeScore : g.awayScore;
    const their = isHome ? g.awayScore : g.homeScore;
    const r = my > their ? "W" : my < their ? "L" : "T";
    const col = r === "W" ? "var(--green-lt)" : r === "L" ? "var(--red)" : "var(--gray)";
    return `<span style="color:${col};font-weight:900">${r}</span>`;
  }).join("<span style='color:var(--border)'>·</span>");

  // Playoff position
  const myPos    = sorted.findIndex(s => s.id === chosenTeamId) + 1;
  const inPlayoffs = myPos > 0 && myPos <= PLAYOFF_TEAMS;
  const leader   = sorted[0];
  const gamesBack = leader && leader.id !== chosenTeamId
    ? ((leader.w - myStand.w) - (myStand.l - leader.l)) / 2 : 0;
  const playoffStr = inPlayoffs
    ? `<span style="color:var(--green-lt);font-size:.6rem;font-weight:700">#${myPos} SEED · IN</span>`
    : `<span style="color:var(--gray);font-size:.6rem">#${myPos} · ${gamesBack > 0 ? gamesBack.toFixed(1)+" GB" : "out"}</span>`;

  // Snap/stamina conflicts
  const dcLocal  = franchise.depthChart?.[chosenTeamId] || {};
  const ssLocal  = franchise.snapShares?.[chosenTeamId] || {};
  const byPidDash = {};
  for (const p of myRoster) byPidDash[p.pid] = p;
  let snapConflicts = 0;
  for (const [key, slot] of Object.entries(dcLocal)) {
    const starter = slot.starter ? byPidDash[slot.starter] : null;
    const share   = ssLocal[key];
    if (starter && share) {
      const stam = starter._stamina ?? 75;
      const pct  = share.starterPct ?? 75;
      if ((pct > 80 && stam < 55) || (pct > 65 && stam < 65)) snapConflicts++;
    }
  }

  // POTW
  const potwSeason   = franchise.potw?.[season] || {};
  const potwWks      = Object.keys(potwSeason).map(Number).sort((a,b) => b-a);
  const latestPotwWk = potwWks[0];
  const latestPotw   = latestPotwWk != null ? potwSeason[latestPotwWk] : null;
  const candWeeks    = Object.keys(franchise.potwCandidates?.[season] || {}).map(Number).sort((a,b)=>b-a);
  const votesByWeek  = franchise.potwVotes?.[season] || {};
  const unvotedWeek  = candWeeks.find(w => !votesByWeek[w]);

  // ─── Banner (compact, 3-zone) ─────────────────────────────────────────
  const bannerHtml = `
    <div class="frn-team-banner frn-dash-banner" style="--banner-color:${myTeam.primary}">
      <div class="frn-banner-stripe"></div>
      <div class="frn-banner-ascii">${teamAscii(myTeam)}</div>
      <div class="frn-banner-info">
        <div class="frn-banner-name">${myTeam.city.toUpperCase()} ${myTeam.name.toUpperCase()}</div>
        <div class="frn-banner-sub">
          Season ${season} · Week ${Math.min(week, FRANCHISE_WEEKS)} of ${FRANCHISE_WEEKS} ·
          PF ${myStand.pf} / PA ${myStand.pa} · OFF ${myRtg.off} · DEF ${myRtg.def}
          ${playedGames.length ? ` · <span style="letter-spacing:.1rem">${formStrip}</span>` : ""}
        </div>
        <div class="frn-banner-cap" style="color:${capColor}">
          CAP $${capUsed.toFixed(1)}M / $${cap.toFixed(0)}M
          <span style="color:var(--gray);font-weight:400">· ${capPct}% used</span>${refundLine}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div class="frn-banner-record">${recStr}</div>
        <div class="frn-banner-record-sub">RECORD</div>
        <div style="margin-top:.3rem">${playoffStr}</div>
      </div>
    </div>`;

  // ─── Top nav: 4 primary + overflow ────────────────────────────────────
  const chatUnread = (franchise.chat||[]).filter(m => m.season === season && m.week === week && m.teamId !== chosenTeamId).length;
  const pendingTrades = (franchise.tradeOffers||[]).filter(o => o.status === "pending").length;
  const pendingJP = (franchise.jointPracticeOffers||[]).filter(o => o.status === "pending" && o.toTeamId === chosenTeamId).length;
  const tradeBadge = (pendingTrades || pendingJP) ? `<span class="frn-nav-badge">${pendingTrades + pendingJP}</span>` : "";
  const chatBadge  = chatUnread ? `<span class="frn-nav-badge">${chatUnread}</span>` : "";
  const psBadge    = psAlerts ? `<span class="frn-nav-badge alert">${psAlerts}</span>` : "";
  const quickNavHtml = `
    <div class="frn-quick-nav">
      <button class="frn-cap-btn primary" onclick="renderFrnAnalytics('mysheet')">📊 Analytics</button>
      ${week <= TRADE_DEADLINE_WEEK ? `<button class="frn-cap-btn primary" onclick="frnOpenTrade()">🔀 Trade${tradeBadge}</button>` : ""}
      <button class="frn-cap-btn primary" onclick="renderFrnChat()">💬 Chat${chatBadge}</button>
      <div class="frn-more-nav-wrap">
        <button class="frn-cap-btn primary" onclick="_frnToggleMoreNav()">🛠 More ▾</button>
        <div class="frn-more-nav" id="frn-more-nav">
          <button class="frn-cap-btn" onclick="renderFrnNewsArchive()">📰 Wire</button>
          <button class="frn-cap-btn" onclick="renderFrnStandings()">📊 Standings</button>
          <button class="frn-cap-btn" onclick="renderFrnLeaders()">📈 Leaders</button>
          <button class="frn-cap-btn ${psAlerts?"frn-cap-btn-alert":""}" onclick="renderFrnPracticeSquad()">🏈 Practice Squad${psBadge}</button>
          <button class="frn-cap-btn" onclick="renderFrnCoachingStaff()">🎩 Coaches</button>
          <button class="frn-cap-btn" onclick="renderFrnProjectedFAs()">📅 Future FAs</button>
          <button class="frn-cap-btn" onclick="renderFrnLegacy()">🏆 Legacy</button>
          <button class="frn-cap-btn" onclick="renderFrnAlumni()">🎓 Alumni</button>
        </div>
      </div>
    </div>`;

  // ─── Unified inbox: decisions that want a response + this-week tasks ──
  // Replaces the old alert-strip + checklist split. Two sections in one
  // panel: DECISIONS at the top (anything needing your attention right
  // now, sorted by urgency), TASKS below (standard prep, can be checked
  // off). Once decisions resolve, they drop out; once tasks are done
  // they collapse to a single completed line.
  const cl = franchise._weeklyChecklist?.[season]?.[week] || {};
  const decisions = [];
  const tasks = [];
  const pushItem = (arr, opts) => arr.push(opts);
  // ---- DECISIONS (urgent / async-response items) ----
  demands.forEach(d => {
    const ask = (d.demandedAAV ?? d.marketValue ?? 0);
    const yrs = d.demandedYears || 4;
    pushItem(decisions, {
      icon:"📣", urgency:"high", label:`${d.position} ${d.name} demands extension`,
      sub:`$${ask.toFixed(1)}M × ${yrs}yr asked · Wk ${d.deadlineWeek} deadline`,
      cta:"Resolve →", action:`frnOpenHoldoutCenter()`,
    });
  });
  if (outbidCount) pushItem(decisions, {
    icon:"⚡", urgency:"high", label:`Outbid on ${outbidCount} FA target${outbidCount>1?"s":""}`,
    sub:"Raise your bid or fold before the round closes",
    cta:"View Bids", action:"renderFrnFANegotiations()",
  });
  if (pendingJP) pushItem(decisions, {
    icon:"🏟", urgency:"med", label:`${pendingJP} joint practice request${pendingJP>1?"s":""}`,
    sub:"Another owner is waiting on your intensity pick",
    cta:"Respond", action:"renderFrnScrimmages()",
  });
  if (pendingTrades) pushItem(decisions, {
    icon:"🔀", urgency:"med", label:`${pendingTrades} trade offer${pendingTrades>1?"s":""} in your inbox`,
    sub:"Accept, counter, or reject",
    cta:"Open", action:"frnOpenTrade(null,'offers')",
  });
  if (psAlerts) pushItem(decisions, {
    icon:"🚨", urgency:"med", label:`${psAlerts} PS poach alert${psAlerts>1?"s":""}`,
    sub:"Promote your guys or lose them to a rival",
    cta:"Open PS", action:"renderFrnPracticeSquad()",
  });
  if (unvotedWeek != null) pushItem(decisions, {
    icon:"🗳", urgency:"low", label:`Player-of-the-Week vote ready`,
    sub:`Week ${unvotedWeek} candidates — feeds into POTY race`,
    cta:"Vote", action:`renderPotwVoting(${unvotedWeek})`,
  });
  // Sort decisions: high → med → low
  const urgencyRank = { high:0, med:1, low:2 };
  decisions.sort((a,b) => (urgencyRank[a.urgency]||9) - (urgencyRank[b.urgency]||9));
  // ---- TASKS (standard weekly prep, checkable) ----
  const oppId0   = nextGame ? (nextGame.homeId === chosenTeamId ? nextGame.awayId : nextGame.homeId) : null;
  const oppName0 = oppId0 ? (getTeam(oppId0)?.name || "opponent") : "Bye week";
  const mkTask = (key, icon, label, sub, action, alert = false, badge = 0, extra = "") => ({
    key, icon, label, sub, action, alert, done: !!cl[key], badge, extra,
  });
  // Depth chart auto-set status — surfaced as an inline "AUTO" toggle on
  // the depth-chart task row so the user can fire it without navigating.
  // Mirrors the count the depth-chart page shows: dry-run the auto chart
  // and count slots where the current pick differs.
  let dcAutoChanges = 0;
  try {
    if (typeof _computeAutoDepthChart === "function" && dcLocal && Object.keys(dcLocal).length) {
      const autoChart = _computeAutoDepthChart(chosenTeamId)?.dc || {};
      for (const slotKey of Object.keys(autoChart)) {
        const a = autoChart[slotKey], c = dcLocal[slotKey];
        if (!a || !c) continue;
        if (a.starter !== c.starter || a.backup !== c.backup) dcAutoChanges++;
      }
    }
  } catch (e) {}
  const dcAutoBtnCls = dcAutoChanges > 0 ? "hot" : "optimal";
  const dcAutoBtnLabel = dcAutoChanges > 0 ? `⟳ AUTO · ${dcAutoChanges}` : `⟳ AUTO · ✓`;
  const dcAutoBtnTitle = dcAutoChanges > 0
    ? `${dcAutoChanges} slot${dcAutoChanges>1?"s":""} would change. Click to auto-set by OVR without leaving this page.`
    : `Depth chart is already optimal by OVR — click to re-confirm.`;
  const dcAutoExtra = `<button class="frn-task-auto-btn ${dcAutoBtnCls}" onclick="event.stopPropagation();_frnDepthAutoFromHome()" title="${dcAutoBtnTitle}">${dcAutoBtnLabel}</button>`;

  tasks.push(mkTask("scout",    "🔍","Scout Opponent",    nextGame ? `vs ${oppName0}` : "Bye week",                           `renderFrnPreseason('scout')`));
  tasks.push(mkTask("depth",    "📋","Depth Chart",        "Set your starters",                                                 `renderFrnDepthChart()`, dcAutoChanges > 0, dcAutoChanges, dcAutoExtra));
  tasks.push(mkTask("snaps",    "⚡","Snap Percentages",   snapConflicts ? `⚠ ${snapConflicts} stamina conflict${snapConflicts>1?"s":""}` : "Optimize rotations", `renderFrnSnapShares()`, snapConflicts > 0, snapConflicts));
  tasks.push(mkTask("practice", "🏟","Joint Practice",     "Scout an opponent in shared reps",                                  `renderFrnScrimmages()`));
  if (injured.length) tasks.push(mkTask("injuries", "🩹","Injury Report", `${injured.length} player${injured.length>1?"s":""} out`, `renderFrnInjuryReport()`, true, injured.length));
  tasks.push(mkTask("fa","🆓","FA Activity", activeNegs.length ? `${activeNegs.length} active negotiation${activeNegs.length>1?"s":""}` : "Browse free agents", `renderFrnFANegotiations()`, false, activeNegs.length));
  if (week <= TRADE_DEADLINE_WEEK) tasks.push(mkTask("trade","🔀","Trade Window", `Open until Wk ${TRADE_DEADLINE_WEEK}`, `frnOpenTrade()`));
  const doneCount = tasks.filter(t => t.done).length;
  const totalTasks = tasks.length;

  // ---- Render inbox ----
  const decisionRow = (d) => `<div class="frn-inbox-decision urg-${d.urgency}" onclick="${d.action}">
    <span class="frn-inbox-icon">${d.icon}</span>
    <div class="frn-inbox-body">
      <div class="frn-inbox-label">${d.label}</div>
      ${d.sub ? `<div class="frn-inbox-sub">${d.sub}</div>` : ""}
    </div>
    <span class="frn-inbox-cta">${d.cta} ›</span>
  </div>`;
  const taskRow = (t) => `<div class="frn-checklist-item${t.done?" done":""}${t.alert&&!t.done?" urgent":""}"
    onclick="_frnCheckItem('${t.key}');${t.action}">
    <span class="frn-check-icon">${t.done?"✓":"○"}</span>
    <div class="frn-check-body">
      <div class="frn-check-label">${t.icon} ${t.label}${(t.badge && !t.done) ? `<span class="frn-task-badge">${t.badge}</span>` : ""}</div>
      ${t.sub?`<div class="frn-check-sub">${t.sub}</div>`:""}
    </div>
    ${t.extra || ""}
    <span class="frn-check-arrow">›</span>
  </div>`;

  // ---- FA Wire summary as a quieter info row in the inbox panel ----
  const faNews = franchise._faLastNews;
  const faWireInfo = (faNews && faNews.week === week - 1 && (faNews.signed.length + faNews.lost.length))
    ? `<div class="frn-inbox-info">
        <b style="color:var(--gold)">📰 FA Wire W${faNews.week}</b>
        ${faNews.signed.map(s=>`<span style="color:var(--green-lt)">✓ ${s.name} $${s.aav.toFixed(1)}M</span>`).join(" ")}
        ${faNews.lost.map(l=>`<span style="color:#c08080">✗ Lost ${l.name}</span>`).join(" ")}
      </div>` : "";

  // ─── Unit bars ────────────────────────────────────────────────────────
  const ratings = buildRatings(myRoster);
  const unitRows = [
    ["QB", ratings.qb || Math.round(myRtg.off*.9)],
    ["WR", ratings.wr], ["RB", ratings.rb], ["OL", ratings.ol], ["TE", ratings.te||70],
    ["DL", ratings.dl], ["LB", ratings.lb], ["CB", ratings.cb], ["S", ratings.saf],
  ].map(([lbl, raw]) => {
    const val = Math.round(raw || 0);
    const pct = Math.round(Math.max(0, Math.min(100, (val - 50) / 49 * 100)));
    const col = val >= 82 ? "var(--green-lt)" : val >= 72 ? "var(--gold-lt)" : val >= 62 ? "var(--gray)" : "var(--red)";
    return `<div class="frn-unit-bar-row">
      <span class="frn-unit-bar-label">${lbl}</span>
      <div class="frn-unit-bar-track"><div class="frn-unit-bar-fill" style="width:${pct}%;background:${col}"></div></div>
      <span class="frn-unit-bar-val" style="color:${col}">${val}</span>
    </div>`;
  }).join("");

  // ─── Wire ticker (compact, at the bottom of inbox) ────────────────────
  const wireItems = (franchise.news||[]).filter(n => n.season === season).slice(-3).reverse();
  const wireRow = wireItems.length ? `<div class="frn-inbox-wire">
    <span class="frn-inbox-wire-tag">📰 WIRE</span>
    ${wireItems.map(n => `<span class="frn-inbox-wire-item">W${n.week}: ${n.label}</span>`).join("")}
    <a class="frn-inbox-wire-more" onclick="renderFrnNewsArchive()">Archive →</a>
  </div>` : "";

  // ─── GM Pulse — glanceable indicators a GM scans every week ──────────
  // Cap stress (head/tail color), trade deadline countdown, bye-week
  // proximity, and the team's biggest in-season OVR mover. Each chip
  // shows a one-line headline + a color cue so the eye picks up risk
  // patterns immediately.
  const capRemaining = cap - capUsed;
  const capChipCol = capPct >= 95 ? "#ff8a8a" : capPct >= 85 ? "#ffc850" : "#86e0a3";
  const capChipNote = capPct >= 95 ? "tight" : capPct >= 85 ? "watch" : "healthy";
  const tradeDelta = TRADE_DEADLINE_WEEK - week;
  const tradeChipCol = tradeDelta < 0 ? "var(--gray)"
                     : tradeDelta <= 1 ? "#ff8a8a"
                     : tradeDelta <= 3 ? "#ffc850"
                     :                   "#86e0a3";
  const tradeChipLabel = tradeDelta < 0 ? "Closed"
                        : tradeDelta === 0 ? "TODAY"
                        : `${tradeDelta} wk${tradeDelta===1?"":"s"}`;
  const byeGame = myGames.find(g => g.bye && g.week >= week)
                || (myGames.length < FRANCHISE_WEEKS ? { week: myGames[0]?.bye ?? null } : null);
  // Schedule has 1 implicit bye — find the week number that's in the
  // 1..FRANCHISE_WEEKS range but missing from myGames.
  const myWeekSet = new Set(myGames.map(g => g.week));
  let byeWeek = null;
  for (let w = 1; w <= FRANCHISE_WEEKS; w++) {
    if (!myWeekSet.has(w)) { byeWeek = w; break; }
  }
  const byeDelta = byeWeek != null ? byeWeek - week : null;
  const byeChipCol = byeDelta == null ? "var(--gray)"
                   : byeDelta < 0 ? "var(--gray)"
                   : byeDelta === 0 ? "#86e0a3"
                   : byeDelta <= 2 ? "#ffc850"
                                   : "rgba(255,255,255,.55)";
  const byeChipLabel = byeWeek == null ? "—"
                     : byeDelta === 0 ? "THIS WK"
                     : byeDelta < 0 ? "Used"
                     : `W${byeWeek}`;
  // Starter health: count starters in the depth chart who are NOT
  // currently injured. Pulled from the user's dcLocal + injury status
  // on the matched roster entry. % of starters healthy is a single
  // number a GM would scan first thing.
  let starterTotal = 0, starterHealthy = 0;
  for (const slot of Object.values(dcLocal)) {
    if (!slot?.starter) continue;
    starterTotal++;
    const p = byPidDash[slot.starter];
    if (p && !(p.injury && p.injury.weeksRemaining > 0)) starterHealthy++;
  }
  const healthPct = starterTotal ? Math.round((starterHealthy / starterTotal) * 100) : 100;
  const healthChipCol = healthPct >= 95 ? "#86e0a3" : healthPct >= 88 ? "#ffc850" : "#ff8a8a";
  const healthChipLabel = `${healthPct}%`;
  const healthChipSub = starterTotal
    ? `${starterHealthy}/${starterTotal} starters` : "no chart";

  // Scouting credits — visual gauge of the user's scouting bank. Bank
  // caps at 10; refreshes +3/week. Surfaces "how much intel-purchasing
  // power do I have right now" at a glance.
  const scoutBank = franchise.seasonScoutBank ?? 0;
  const SCOUT_CAP = (typeof _SEASON_SCOUT_BANK_CAP !== "undefined") ? _SEASON_SCOUT_BANK_CAP : 10;
  const SCOUT_REFRESH = (typeof _SEASON_SCOUTS_PER_WEEK !== "undefined") ? _SEASON_SCOUTS_PER_WEEK : 3;
  const scoutPct = SCOUT_CAP > 0 ? Math.round((scoutBank / SCOUT_CAP) * 100) : 0;
  const scoutChipCol = scoutBank >= 6 ? "#5ed4d4" : scoutBank >= 3 ? "#ffc850" : "#ff8a8a";
  const revealCount = Object.keys(franchise.seasonScoutReveals || {}).length;
  const pulseChipHtml = (label, value, sub, col, extra = "") => `
    <div class="frn-pulse-chip">
      <div class="frn-pulse-chip-label">${label}</div>
      <div class="frn-pulse-chip-value" style="color:${col}">${value}</div>
      <div class="frn-pulse-chip-sub">${sub}</div>
      ${extra}
    </div>`;
  // Scouting chip — value+gauge composite. The gauge shows the bank/cap
  // ratio so the user can see "how full" their scouting budget is. Tick
  // dots represent each credit. Clickable → opens preseason scout.
  const scoutGaugeDots = Array.from({ length: SCOUT_CAP }, (_, i) =>
    `<span class="frn-scout-dot${i < scoutBank ? ' active' : ''}"></span>`
  ).join("");
  const scoutExtra = `
    <div class="frn-scout-gauge" title="${scoutBank} of ${SCOUT_CAP} credits · +${SCOUT_REFRESH}/wk · ${revealCount} prospects revealed this season">
      ${scoutGaugeDots}
    </div>`;
  // Click → in-season scouting board (renderFrnScoutingBoard). Was
  // wired to renderFrnPreseason('scout') by mistake which is the
  // OFFSEASON-only draft prep page; mid-season this lands you on the
  // college scouting board where credits are actually spent.
  const scoutChipClick = `onclick="if (typeof renderFrnScoutingBoard === 'function') renderFrnScoutingBoard(); else if (typeof renderFrnPreseason === 'function') renderFrnPreseason('scout')"`;
  const pulseHtml = `
    <div class="frn-card-box frn-pulse-card">
      <div class="frn-card-title">GM PULSE <span class="frn-card-title-sub">at-a-glance</span></div>
      <div class="frn-pulse-grid">
        ${pulseChipHtml("CAP", `$${capRemaining.toFixed(1)}M`, capChipNote, capChipCol)}
        ${pulseChipHtml("TRADE WIN", tradeChipLabel, tradeDelta < 0 ? "deadline passed" : `until W${TRADE_DEADLINE_WEEK}`, tradeChipCol)}
        ${pulseChipHtml("BYE", byeChipLabel, byeDelta == null ? "—" : byeDelta < 0 ? "" : byeDelta === 0 ? "rest week" : `${byeDelta}w out`, byeChipCol)}
        ${pulseChipHtml("HEALTH", healthChipLabel, healthChipSub, healthChipCol)}
        <div class="frn-pulse-chip clickable" ${scoutChipClick} title="Click to open college scouting. ${scoutBank >= SCOUT_CAP ? 'Bank is full — overflow auto-spends on priority prospects (watchlist > top-grade > in-progress).' : 'Overflow auto-spends on priority prospects.'}">
          <div class="frn-pulse-chip-label">🔭 SCOUTING${scoutBank >= SCOUT_CAP ? `<span class="frn-pulse-chip-badge" title="Bank full — overflow auto-spends">!</span>` : (scoutBank >= SCOUT_CAP - 2 ? `<span class="frn-pulse-chip-badge warn" title="Bank nearly full — overflow will auto-spend">!</span>` : "")}</div>
          <div class="frn-pulse-chip-value" style="color:${scoutChipCol}">${scoutBank}<span style="font-size:.65rem;color:var(--gray);font-weight:500"> / ${SCOUT_CAP}</span></div>
          <div class="frn-pulse-chip-sub">+${SCOUT_REFRESH}/wk · ${revealCount} revealed${scoutBank >= SCOUT_CAP ? " · auto-spending" : ""}</div>
          ${scoutExtra}
        </div>
      </div>
    </div>`;

  // ─── Left column: inbox + unit bars + pulse ──────────────────────────
  // Left column — pulse moved to center; sidebar now Inbox + Unit Ratings.
  const leftColHtml = `
    <div>
      <div class="frn-card-box" style="padding:0">
        <div class="frn-inbox-tabs">
          <span class="frn-inbox-tab-label">WEEK ${week} INBOX</span>
          ${decisions.length ? `<span class="frn-inbox-count urg-${decisions[0].urgency}">${decisions.length} need response</span>` : `<span class="frn-inbox-count clean">all clear</span>`}
          <span class="frn-inbox-tasks-pct">${doneCount}/${totalTasks} tasks</span>
        </div>
        ${decisions.length ? `<div class="frn-inbox-section">
          <div class="frn-inbox-section-title">DECISIONS</div>
          ${decisions.map(decisionRow).join("")}
        </div>` : ""}
        <div class="frn-inbox-section">
          <div class="frn-inbox-section-title">PREP TASKS</div>
          <div class="frn-checklist">${tasks.map(taskRow).join("")}</div>
        </div>
        ${faWireInfo}
        ${wireRow}
      </div>
      <div class="frn-card-box" style="margin-top:1rem">
        <div class="frn-card-title">UNIT RATINGS</div>
        ${unitRows}
      </div>
    </div>`;

  // ─── Hero zone — week's headline, win prob, dominant CTA ─────────────
  // Tier-1 visual anchor: one big card the eye lands on first. Combines
  // matchup identity + win probability + top decision teaser + the
  // primary PLAY GAME action. Replaces the standard next-game card
  // when there's an upcoming game this week. Other states (week-done,
  // playoffs, week-pending review) keep their existing renderers.
  let nextCardHtml = "";
  const nextGameIsThisWeek = nextGame && nextGame.week === week;
  if (franchise.weekPending && !seasonDone) {
    nextCardHtml = _buildWeekReviewCard(week, chosenTeamId);
  } else if (nextGameIsThisWeek) {
    const isHome = nextGame.homeId === chosenTeamId;
    const oppId  = isHome ? nextGame.awayId : nextGame.homeId;
    const opp    = getTeam(oppId);
    const oppRtg = frnTeamRating(oppId);
    const oppStand = standings[oppId] || { w:0, l:0 };

    // Win probability — power-rating-driven with home-field bump and a
    // QB-tier modifier. Clamped to 5-95% so even mismatches feel
    // possible. Mirrors the same math we use for board confidence.
    const myPwr  = (myRtg.off  || 60) + (myRtg.def  || 60);
    const oppPwr = (oppRtg.off || 60) + (oppRtg.def || 60);
    const qbAdj  = ((myRtg.qb || 60) - (oppRtg.qb || 60)) * 0.5;
    const homeAdj = isHome ? 3 : -3;
    const diff = (myPwr - oppPwr) + qbAdj + homeAdj;
    const winPct = Math.max(5, Math.min(95, Math.round(50 + diff * 1.2)));
    const wpCol = winPct >= 65 ? "var(--green-lt)"
                : winPct >= 50 ? "var(--gold-lt)"
                : winPct >= 35 ? "#ffc850"
                :                "#ff8a8a";
    const wpLabel = winPct >= 70 ? "HEAVY FAVORITE"
                  : winPct >= 58 ? "FAVORED"
                  : winPct >= 48 ? "COIN FLIP"
                  : winPct >= 35 ? "UNDERDOG"
                  :                "BIG UNDERDOG";

    // Narrative pick — choose the most interesting context line from a
    // priority ladder. Rival > division > playoff race > stat edge >
    // streak > generic. Keeps the hero feeling alive without
    // hand-authoring per-matchup text.
    const isRival = (typeof _areRivals === "function") && _areRivals(chosenTeamId, oppId);
    const myDiv = myTeam.division;
    const oppDiv = opp.division;
    const isDivision = myDiv && oppDiv && myDiv === oppDiv;
    const gp = myStand.w + myStand.l + myStand.t;
    const streak = (() => {
      const last5 = playedGames.slice(-5);
      let s = 0; let dir = null;
      for (let i = last5.length - 1; i >= 0; i--) {
        const g = last5[i];
        const h = g.homeId === chosenTeamId;
        const my = h ? g.homeScore : g.awayScore;
        const tm = h ? g.awayScore : g.homeScore;
        const r = my > tm ? "W" : my < tm ? "L" : "T";
        if (dir == null) dir = r;
        if (r !== dir) break;
        s++;
      }
      return { count: s, dir };
    })();
    const weeksLeft = FRANCHISE_WEEKS - week;
    let narrative = "";
    if (isRival) {
      narrative = `🔥 Rivalry game — these two never play it straight.`;
    } else if (isDivision) {
      const onPace = inPlayoffs ? "stay in the seed picture" : "claw back into the seed picture";
      narrative = `Division tilt — win to ${onPace} in the ${myDiv}.`;
    } else if (streak.count >= 3 && streak.dir === "W") {
      narrative = `${streak.count}-game win streak on the line.`;
    } else if (streak.count >= 3 && streak.dir === "L") {
      narrative = `${streak.count}-game skid — get right or stay buried.`;
    } else if (weeksLeft <= 2 && !inPlayoffs) {
      narrative = `Win-or-go-home territory — every game from here is a playoff game.`;
    } else if (Math.abs(diff) <= 4) {
      narrative = `Power ratings are dead-even — turnovers decide it.`;
    } else if (diff >= 12) {
      narrative = `On paper this is yours to lose — protect the lead, don't get cute.`;
    } else if (diff <= -12) {
      narrative = `Underdog spot — they're better, but anyone can win one game.`;
    } else {
      narrative = `Standard week — execute clean, don't beat yourself.`;
    }

    // Top decision teaser — surface the single highest-urgency item
    // from the inbox into the hero so the user sees "1 thing to handle"
    // without scrolling. If no decisions, show a "clean slate" line.
    const topDec = decisions[0];
    const decisionStripHtml = topDec
      ? `<div class="frn-hero-decision urg-${topDec.urgency}" onclick="${topDec.action}">
          <span class="frn-hero-dec-icon">${topDec.icon}</span>
          <div class="frn-hero-dec-body">
            <div class="frn-hero-dec-label">${topDec.label}</div>
            ${topDec.sub ? `<div class="frn-hero-dec-sub">${topDec.sub}</div>` : ""}
          </div>
          <span class="frn-hero-dec-cta">${topDec.cta} ›</span>
          ${decisions.length > 1 ? `<span class="frn-hero-dec-count">+${decisions.length - 1} more</span>` : ""}
        </div>`
      : `<div class="frn-hero-decision clean">
          <span class="frn-hero-dec-icon">✓</span>
          <div class="frn-hero-dec-body">
            <div class="frn-hero-dec-label">All clear — nothing needs your attention this week.</div>
          </div>
        </div>`;

    const expanded = _frnPregameExpanded;
    const breakdownHtml = expanded
      ? `<div class="frn-pregame-breakdown">
          ${_buildMatchupStatsStrip(chosenTeamId, oppId, myStand, oppStand, myRtg, oppRtg)}
          ${_buildSchemeMatchupCard(chosenTeamId, oppId)}
          ${_buildOpponentIntelBlock(oppId, isHome, week, nextGame)}
        </div>` : "";

    nextCardHtml = `
      <div class="frn-hero-card" style="--accent:${myTeam.primary||'var(--gold)'}">
        <div class="frn-hero-eyebrow">
          <span>WEEK ${nextGame.week} · ${isHome ? "HOME" : "AT"} ${(opp.city||"").toUpperCase()}</span>
          <span class="frn-hero-eyebrow-rec">YOUR ${recStr}${myStand.t?"":""} · ${opp.name} ${oppStand.w}-${oppStand.l}${oppStand.t?"-"+oppStand.t:""}</span>
        </div>
        <div class="frn-hero-body">
          <div class="frn-hero-wp">
            <div class="frn-hero-wp-num" style="color:${wpCol}">${winPct}<span class="frn-hero-wp-pct">%</span></div>
            <div class="frn-hero-wp-label" style="color:${wpCol}">${wpLabel}</div>
            <div class="frn-hero-wp-sub">WIN PROBABILITY</div>
          </div>
          <div class="frn-hero-mid">
            <div class="frn-hero-narrative">${narrative}</div>
            <div class="frn-hero-matchup-row">
              <div class="frn-hero-team you">
                <div class="frn-hero-team-name">${myTeam.name.toUpperCase()}</div>
                <div class="frn-hero-team-rtgs">OFF <b>${myRtg.off}</b> · DEF <b>${myRtg.def}</b> · QB <b>${myRtg.qb}</b></div>
              </div>
              <div class="frn-hero-vs">${isHome ? "vs" : "@"}</div>
              <div class="frn-hero-team opp">
                <div class="frn-hero-team-name">${opp.name.toUpperCase()}</div>
                <div class="frn-hero-team-rtgs">OFF <b>${oppRtg.off}</b> · DEF <b>${oppRtg.def}</b> · QB <b>${oppRtg.qb}</b></div>
              </div>
            </div>
          </div>
        </div>
        <div class="frn-hero-cta-row">
          <button class="frn-hero-play-btn" onclick="frnPlayGame(${nextGame.homeId},${nextGame.awayId},false)">
            ▶ PLAY GAME
            <span class="frn-hero-play-sub">interactive · live simulation</span>
          </button>
          <div class="frn-hero-sims">
            <button class="frn-sim-btn" onclick="frnSimGame(${nextGame.homeId},${nextGame.awayId})">⏩ Sim Game</button>
            ${_renderSimForwardPanel()}
          </div>
        </div>
        ${decisionStripHtml}
        <button class="frn-pregame-toggle" onclick="_frnTogglePregame()">
          ${expanded ? "▴ Hide pregame breakdown" : "▾ Pregame breakdown (matchup stats · schemes · opponent intel)"}
        </button>
        ${breakdownHtml}
      </div>`;
  } else if (seasonDone) {
    nextCardHtml = `
      <div class="frn-next-card" style="text-align:center;border-color:var(--gold-lt)">
        <div style="font-size:1.3rem;font-weight:900;color:var(--gold);margin-bottom:.5rem">REGULAR SEASON COMPLETE</div>
        <div style="color:var(--gray);margin-bottom:1rem">Final record: ${recStr} · PF ${myStand.pf} / PA ${myStand.pa}</div>
        <button class="btn btn-gold-big" onclick="frnConfirmStartPlayoffs()">🏆 START PLAYOFFS</button>
      </div>`;
  } else {
    // User played their game this week; other teams' games pending
    nextCardHtml = `
      <div class="frn-next-card" style="text-align:center;border-style:dashed">
        <div style="color:var(--gold);font-weight:700;margin-bottom:.4rem">Your Week ${week} game is done</div>
        <div style="color:var(--gray);font-size:.8rem;margin-bottom:.8rem">${FRANCHISE_WEEKS - week + 1} weeks of action remaining</div>
        <div class="frn-next-actions" style="justify-content:center">
          ${_renderSimForwardPanel()}
        </div>
      </div>`;
  }

  // ─── Compact schedule strip: last 4 results + next 4 opponents ───────
  const stripPast = myGames.filter(g => g.played).slice(-4);
  const stripUpcoming = myGames.filter(g => !g.played).slice(0, 4);
  const stripChip = (g, kind) => {
    const isHome = g.homeId === chosenTeamId;
    const oppId = isHome ? g.awayId : g.homeId;
    const opp = getTeam(oppId);
    if (kind === "past") {
      const my = isHome ? g.homeScore : g.awayScore;
      const them = isHome ? g.awayScore : g.homeScore;
      const w = my > them, t = my === them;
      const col = w ? "var(--green-lt)" : t ? "var(--gray)" : "#c08080";
      return `<button class="frn-sched-chip past" style="border-color:${col};color:${col}"
        onclick="renderFrnPastGame(${g.week},${g.homeId},${g.awayId})"
        title="W${g.week} ${isHome?'vs':'@'} ${opp?.name} — ${my}-${them}">
        <span class="frn-sched-chip-wk">W${g.week}</span>
        <span class="frn-sched-chip-res">${w?"W":t?"T":"L"} ${my}–${them}</span>
        <span class="frn-sched-chip-opp">${isHome?"vs":"@"} ${(opp?.name||"?").slice(0,5)}</span>
      </button>`;
    }
    const oppRec = standings[oppId];
    const isNext = g === nextGame;
    return `<div class="frn-sched-chip upcoming${isNext?" next":""}" title="W${g.week} ${isHome?'vs':'@'} ${opp?.name}${oppRec?` (${oppRec.w}-${oppRec.l})`:""}">
      <span class="frn-sched-chip-wk">W${g.week}${isNext?" · NEXT":""}</span>
      <span class="frn-sched-chip-opp">${isHome?"vs":"@"} ${(opp?.name||"?").slice(0,5)}</span>
      <span class="frn-sched-chip-rec">${oppRec?`${oppRec.w}-${oppRec.l}`:""}</span>
    </div>`;
  };
  const scheduleStripHtml = (stripPast.length + stripUpcoming.length) ? `
    <div class="frn-sched-strip">
      <div class="frn-sched-strip-group">${stripPast.map(g => stripChip(g, "past")).join("")}</div>
      ${stripPast.length && stripUpcoming.length ? `<div class="frn-sched-strip-divider">|</div>` : ""}
      <div class="frn-sched-strip-group">${stripUpcoming.map(g => stripChip(g, "next")).join("")}</div>
    </div>` : "";

  // ─── Center column: next game + schedule ─────────────────────────────
  // Full schedule is built as a standalone fragment so it can live in
  // the right sidebar (compact rows fit naturally there). Center keeps
  // focus on the Next Up card + the glanceable schedule strip.
  const fullScheduleHtml = `
    <div class="frn-card-box">
      <div class="frn-card-title">FULL SCHEDULE <span class="frn-card-title-sub">${FRANCHISE_WEEKS} games</span></div>
      ${(()=>{
  const schHtml = myGames.map(g => {
    const isHome = g.homeId === chosenTeamId;
    const oppId  = isHome ? g.awayId : g.homeId;
    const opp    = getTeam(oppId);
    const oppRec = standings[oppId];
    const oppRS  = oppRec ? `(${oppRec.w}-${oppRec.l})` : "";
    const isNext = g === nextGame;
    const isRival = _areRivals(g.homeId, g.awayId);
    const rivalTag = isRival ? `<span style="color:var(--gold-lt);font-size:.6rem">🔥</span>` : "";
    const wxTag = g.weather && g.weather.label && g.weather.label !== "CLEAR"
      ? `<span style="font-size:.65rem" title="${g.weather.label}">${_wxIcon(g.weather.label)}</span>` : "";
    if (g.played) {
      const my    = isHome ? g.homeScore : g.awayScore;
      const their = isHome ? g.awayScore : g.homeScore;
      const w = my > their, t = my === their;
      return `<div class="frn-game-row clickable"
        onclick="renderFrnPastGame(${g.week},${g.homeId},${g.awayId})"
        onmouseenter="frnPastGameTipShow(event,${g.week},${g.homeId},${g.awayId})"
        onmouseleave="frnPastGameTipHide()">
        <span class="frn-wk">W${g.week}</span>
        <span class="frn-opp">${rivalTag}${isHome ? "vs" : "@"} ${teamLink(opp)} ${wxTag}</span>
        <span class="frn-res ${w?"w":t?"t":"l"}">${w?"W":t?"T":"L"} ${my}–${their}</span>
      </div>`;
    }
    return `<div class="frn-game-row ${isNext ? "frn-next" : ""}">
      <span class="frn-wk">W${g.week}</span>
      <span class="frn-opp">${rivalTag}${isHome ? "vs" : "@"} ${teamLink(opp)} <span style="color:var(--gray);font-size:.62rem">${oppRS}</span></span>
      ${isNext ? `<span class="frn-res" style="color:var(--gold)">NEXT</span>` : ""}
    </div>`;
  }).join("");
  return schHtml;
      })()}
    </div>`;

  // ─── GM-grade middle-column cards ─────────────────────────────────────
  // High-density metrics a real GM scans every week. Sits below the next-
  // game card and the schedule strip. Three blocks: position x-ray vs
  // next opponent, season hot-board on your team, and a 4-game gauntlet
  // heatmap for upcoming opponents.

  // 1) MATCHUP X-RAY — your unit vs next opponent's unit, 5 fronts.
  // Each row shows your rating, opp rating, delta (gap-colored bar).
  // Only renders when we have a next opponent on the schedule.
  let matchupXrayHtml = "";
  if (nextGame) {
    const oppIdX  = nextGame.homeId === chosenTeamId ? nextGame.awayId : nextGame.homeId;
    const oppRosterX = franchise.rosters[oppIdX] || [];
    const oppRtgsX = buildRatings(oppRosterX);
    const myRtgsX  = ratings; // already computed earlier
    const fronts = [
      // Round all sub-text ratings — buildRatings returns weighted-average
      // floats which were rendering as "76.83333333..." in the sub lines.
      { lbl: "PASS OFF",  me: myRtgsX.qb || (myRtgsX.wr + 60)/2, them: ((oppRtgsX.cb||60)+(oppRtgsX.saf||60))/2, meSub: `${myRtgsX.qb?Math.round(myRtgsX.qb):"-"} QB · ${myRtgsX.wr?Math.round(myRtgsX.wr):"-"} WR`, themSub: `${oppRtgsX.cb?Math.round(oppRtgsX.cb):"-"} CB · ${oppRtgsX.saf?Math.round(oppRtgsX.saf):"-"} S` },
      { lbl: "PASS DEF",  me: ((myRtgsX.cb||60)+(myRtgsX.saf||60))/2, them: oppRtgsX.qb || (oppRtgsX.wr + 60)/2, meSub: `${myRtgsX.cb?Math.round(myRtgsX.cb):"-"} CB · ${myRtgsX.saf?Math.round(myRtgsX.saf):"-"} S`, themSub: `${oppRtgsX.qb?Math.round(oppRtgsX.qb):"-"} QB · ${oppRtgsX.wr?Math.round(oppRtgsX.wr):"-"} WR` },
      { lbl: "RUN OFF",   me: ((myRtgsX.rb||60)+(myRtgsX.ol||60))/2,  them: ((oppRtgsX.dl||60)+(oppRtgsX.lb||60))/2, meSub: `${myRtgsX.rb?Math.round(myRtgsX.rb):"-"} RB · ${myRtgsX.ol?Math.round(myRtgsX.ol):"-"} OL`, themSub: `${oppRtgsX.dl?Math.round(oppRtgsX.dl):"-"} DL · ${oppRtgsX.lb?Math.round(oppRtgsX.lb):"-"} LB` },
      { lbl: "RUN DEF",   me: ((myRtgsX.dl||60)+(myRtgsX.lb||60))/2,  them: ((oppRtgsX.rb||60)+(oppRtgsX.ol||60))/2, meSub: `${myRtgsX.dl?Math.round(myRtgsX.dl):"-"} DL · ${myRtgsX.lb?Math.round(myRtgsX.lb):"-"} LB`, themSub: `${oppRtgsX.rb?Math.round(oppRtgsX.rb):"-"} RB · ${oppRtgsX.ol?Math.round(oppRtgsX.ol):"-"} OL` },
      { lbl: "TRENCHES",  me: ((myRtgsX.ol||60)+(myRtgsX.dl||60))/2,  them: ((oppRtgsX.ol||60)+(oppRtgsX.dl||60))/2, meSub: `${myRtgsX.ol?Math.round(myRtgsX.ol):"-"} OL · ${myRtgsX.dl?Math.round(myRtgsX.dl):"-"} DL`, themSub: `${oppRtgsX.ol?Math.round(oppRtgsX.ol):"-"} OL · ${oppRtgsX.dl?Math.round(oppRtgsX.dl):"-"} DL` },
    ];
    const oppX = getTeam(oppIdX);
    const xRows = fronts.map(f => {
      const me = Math.round(f.me), them = Math.round(f.them);
      const delta = me - them;
      const advCol = delta >= 4 ? "#86e0a3" : delta <= -4 ? "#ff8a8a" : "#ffc850";
      const dStr = delta > 0 ? `+${delta}` : `${delta}`;
      // Bar shows the delta; center is "even". 50% baseline shifts left
      // (opp advantage) or right (your advantage).
      const mag = Math.max(0, Math.min(20, Math.abs(delta)));
      const fillPct = 50 + (delta >= 0 ? mag : -mag) * 2.5; // ±50%
      return `<div class="frn-xray-row">
        <div class="frn-xray-lbl">${f.lbl}</div>
        <div class="frn-xray-side">
          <div class="frn-xray-val">${me}</div>
          <div class="frn-xray-sub">${f.meSub}</div>
        </div>
        <div class="frn-xray-bar-wrap">
          <div class="frn-xray-bar-track">
            <div class="frn-xray-bar-mid"></div>
            ${delta >= 0
              ? `<div class="frn-xray-bar-fill me" style="right:50%;width:${Math.max(2,(fillPct-50))}%;background:${advCol}"></div>`
              : `<div class="frn-xray-bar-fill them" style="left:50%;width:${Math.max(2,(50-fillPct))}%;background:${advCol}"></div>`}
          </div>
          <div class="frn-xray-delta" style="color:${advCol}">${dStr}</div>
        </div>
        <div class="frn-xray-side">
          <div class="frn-xray-val">${them}</div>
          <div class="frn-xray-sub">${f.themSub}</div>
        </div>
      </div>`;
    }).join("");
    // GAME PLAN — computed live based on opponent's DC. Reads the same
    // formula `frnSimOnce` will use at kickoff, so the user sees the same
    // tilt their HC is about to commit to. Reveals coach competence:
    // sub-60-OVR coaches don't ID weaknesses, so the row stays muted.
    let gameplanHtml = "";
    if (typeof _computeWeeklyGameplan === "function") {
      const myPlan = _computeWeeklyGameplan(chosenTeamId, oppIdX);
      const oppPlan = _computeWeeklyGameplan(oppIdX, chosenTeamId);
      const planRow = (label, plan) => {
        if (!plan || (!plan.reason && !plan.passProbDelta)) {
          return `<div class="frn-xray-gp-side">
            <div class="frn-xray-gp-lbl">${label}</div>
            <div class="frn-xray-gp-txt" style="color:var(--gray)">— no scouted edge —</div>
          </div>`;
        }
        const tilt = plan.passProbDelta > 0 ? "+pass" : plan.passProbDelta < 0 ? "+run" : "balanced";
        const tiltCol = plan.passProbDelta > 0 ? "#7ec8e3" : plan.passProbDelta < 0 ? "#e8a000" : "var(--gray)";
        const bumpTag = plan.ovrBump > 0 ? ` · <span style="color:var(--gold);font-weight:700">+${plan.ovrBump} OVR</span>` : "";
        return `<div class="frn-xray-gp-side">
          <div class="frn-xray-gp-lbl">${label}</div>
          <div class="frn-xray-gp-txt"><span style="color:${tiltCol};font-weight:700">${tilt}</span> · ${plan.reason}${bumpTag}</div>
        </div>`;
      };
      gameplanHtml = `
        <div class="frn-xray-gameplan">
          <div class="frn-xray-gp-title">GAME PLAN <span style="color:var(--gray);font-size:.5rem;font-weight:400">(coach OVR gates how aggressive)</span></div>
          ${planRow("YOU", myPlan)}
          ${planRow((oppX?.name||"OPP").toUpperCase(), oppPlan)}
        </div>`;
    }
    matchupXrayHtml = `
      <div class="frn-card-box">
        <div class="frn-card-title">MATCHUP X-RAY <span class="frn-card-title-sub">vs ${oppX?.name || "opp"}</span></div>
        <div class="frn-xray-header">
          <span style="text-align:left">YOU</span>
          <span style="text-align:center;color:var(--gray);font-size:.55rem">EDGE</span>
          <span style="text-align:right">${(oppX?.name||"OPP").toUpperCase()}</span>
        </div>
        <div class="frn-xray-rows">${xRows}</div>
        ${gameplanHtml}
      </div>`;
  }

  // 2) MY GUYS — top performers card with a fantasy-style score, per-game
  //    averages, position-colored avatar, and hot-streak callout. Ranked
  //    by a position-aware composite + PPR-flavored fantasy score for
  //    skill positions. Click → player card.
  const sStats = franchise.seasonStats?.[chosenTeamId] || {};
  // Position-color palette (matches the cap-treemap so colors are
  // consistent across the whole dashboard).
  const _myPosColor = (pos) => ({
    QB:"#f5c542", RB:"#ef8a4d", WR:"#e85c98", TE:"#ba68c8",
    OL:"#5fb1d4", DL:"#ff6b6b", LB:"#ffb14c", CB:"#86e0a3", S:"#4dc7a8",
    K:"#888", P:"#888",
  }[pos] || "#999");
  // PPR-flavored fantasy score for skill positions, IDP-flavored for defense.
  const _ffScore = (p, st) => {
    if (p.position === "QB")
      return 0.04*(st.pass_yds||0) + 4*(st.pass_td||0) - 2*(st.int||0)
           + 0.1*(st.rush_yds||0) + 6*(st.rush_td||0);
    if (p.position === "RB")
      return 0.1*((st.rush_yds||0) + (st.rec_yds||0)) + 6*((st.rush_td||0) + (st.rec_td||0))
           + 1*(st.rec||0);
    if (p.position === "WR" || p.position === "TE")
      return 0.1*(st.rec_yds||0) + 6*(st.rec_td||0) + 1*(st.rec||0);
    if (["DL","LB"].includes(p.position))
      return 1*(st.tkl||0) + 2*(st.sk||0) + 6*(st.int_made||0) + 2*(st.tfl||0);
    if (["CB","S"].includes(p.position))
      return 1*(st.tkl||0) + 6*(st.int_made||0) + 0.5*(st.pd||0);
    if (p.position === "K")
      return 3*(st.fg_made||0) - 1*(st.fg_miss||0);
    return 0;
  };
  const scoredPlayers = [];
  for (const p of myRoster) {
    const st = sStats[p.name];
    if (!st) continue;
    const gp = Math.max(1, st.gp || 1);
    let score = 0, line = "", perGame = "";
    if (p.position === "QB") {
      score = (st.pass_yds || 0) + (st.pass_td || 0) * 25 + (st.rush_yds || 0) * 0.5 - (st.int || 0) * 30;
      line = `${st.pass_yds || 0} yd · ${st.pass_td || 0} TD${st.int?` · ${st.int} INT`:""}`;
      perGame = `${(st.pass_yds/gp).toFixed(0)} y/g · ${(st.pass_td/gp).toFixed(1)} TD/g`;
    } else if (p.position === "RB") {
      const yds = (st.rush_yds || 0) + (st.rec_yds || 0);
      score = yds + (st.rush_td || 0) * 50 + (st.rec_td || 0) * 50;
      line = `${st.rush_yds||0} ru · ${st.rec_yds||0} rec · ${(st.rush_td||0)+(st.rec_td||0)} TD`;
      perGame = `${(yds/gp).toFixed(0)} y/g · ${(((st.rush_td||0)+(st.rec_td||0))/gp).toFixed(1)} TD/g`;
    } else if (p.position === "WR" || p.position === "TE") {
      score = (st.rec_yds || 0) + (st.rec_td || 0) * 50 + (st.rec || 0) * 2;
      line = `${st.rec || 0}/${st.rec_yds || 0}/${st.rec_td || 0}`;
      perGame = `${(st.rec_yds/gp).toFixed(0)} y/g · ${(st.rec/gp).toFixed(1)} rec/g`;
    } else if (["DL","LB"].includes(p.position)) {
      score = (st.sk || 0) * 30 + (st.tkl || 0) * 2 + (st.tfl || 0) * 5;
      line = `${st.sk||0} sk · ${st.tkl||0} tkl${st.tfl?` · ${st.tfl} TFL`:""}`;
      perGame = `${(st.tkl/gp).toFixed(1)} tkl/g · ${(st.sk/gp).toFixed(2)} sk/g`;
    } else if (["CB","S"].includes(p.position)) {
      score = (st.int_made || 0) * 50 + (st.pd || 0) * 8 + (st.tkl || 0) * 2;
      line = `${st.int_made||0} INT · ${st.pd||0} PD · ${st.tkl||0} tkl`;
      perGame = `${(st.tkl/gp).toFixed(1)} tkl/g · ${(st.pd/gp).toFixed(1)} PD/g`;
    } else if (p.position === "K") {
      score = (st.fg_made || 0) * 10 - (st.fg_miss || 0) * 8;
      const att = (st.fg_made||0) + (st.fg_miss||0);
      line = `${st.fg_made||0}/${att} FG`;
      perGame = att > 0 ? `${(((st.fg_made||0)/att)*100).toFixed(0)}% acc` : "no att";
    }
    if (score > 0) {
      const ff = _ffScore(p, st);
      scoredPlayers.push({ p, st, score, line, perGame, gp, ff });
    }
  }
  scoredPlayers.sort((a, b) => b.score - a.score);
  const hotTop = scoredPlayers.slice(0, 6);
  // Offensive + defensive rails — used to fill the side gutters on
  // wide displays where the centered dashboard leaves dead space.
  // Each rail shows the top 6 by score in that position group.
  const OFF_POS = new Set(["QB","RB","WR","TE","OL","LT","LG","C","RG","RT"]);
  const DEF_POS = new Set(["DL","LB","CB","S","K","P"]);
  const offRailTop = scoredPlayers.filter(s => OFF_POS.has(s.p.position)).slice(0, 6);
  const defRailTop = scoredPlayers.filter(s => DEF_POS.has(s.p.position)).slice(0, 6);
  const _hasPortrait = (typeof _playerPortrait === "function");
  const hotBoardHtml = hotTop.length ? `
    <div class="frn-card-box frn-myguys-card">
      <div class="frn-card-title">🏈 PLAYMAKERS <span class="frn-card-title-sub">top performers · S${season} · click any card</span></div>
      <div class="frn-myguys-grid">
        ${hotTop.map((h, i) => {
          const esc = (h.p.name||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
          const pid = (h.p.pid||"").replace(/'/g,"\\'");
          const ovr = h.p.overall || 60;
          const ovrCol = ovr >= 88 ? "#f5c542" : ovr >= 80 ? "#86e0a3" : ovr >= 70 ? "var(--gold-lt)" : "var(--gray)";
          const posCol = _myPosColor(h.p.position);
          const ffPerGame = h.gp > 0 ? (h.ff / h.gp).toFixed(1) : h.ff.toFixed(1);
          // Hot-streak detector: fantasy score per game vs 1.5x league avg
          // (rough heuristic — could refine later)
          const FF_HOT = { QB: 22, RB: 14, WR: 11, TE: 8, DL: 8, LB: 9, CB: 6, S: 6, K: 7 }[h.p.position] || 6;
          const isHot = (h.ff / h.gp) >= FF_HOT;
          // Use the existing _playerPortrait helper to surface real
          // headshot art (falls back to flat-color block + generated
          // mugshot if no portrait file exists). 36px keeps the card
          // compact while making the player feel real.
          const portrait = _hasPortrait ? _playerPortrait(h.p, 36) : "";
          return `<div class="frn-myguy-card" onclick="frnOpenPlayerCard('${esc}','${pid}')">
            <div class="frn-myguy-rank">#${i+1}</div>
            <div class="frn-myguy-portrait" style="border-color:${posCol}">${portrait}</div>
            <div class="frn-myguy-body">
              <div class="frn-myguy-name">${h.p.name}</div>
              <div class="frn-myguy-meta">
                <span class="frn-myguy-pos" style="color:${posCol}">${h.p.position}</span>
                <span class="frn-myguy-ovr" style="color:${ovrCol}">${ovr}</span>
                <span class="frn-myguy-gp">${h.gp} GP</span>
                ${isHot ? `<span class="frn-myguy-fire" title="On a hot streak — fantasy ppg above position threshold">🔥</span>` : ""}
              </div>
              <div class="frn-myguy-stats">${h.line}</div>
              <div class="frn-myguy-pergame">${h.perGame}</div>
            </div>
            <div class="frn-myguy-ff">
              <div class="frn-myguy-ff-val">${ffPerGame}</div>
              <div class="frn-myguy-ff-lbl">FFP/G</div>
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>` : "";

  // Build vertical rail cards (offense left, defense right) for wide
  // displays. Each rail card is a compact playmaker card — portrait,
  // name, key stat, FFP/G — that fills the empty gutter outside the
  // centered dashboard. Same data as PLAYMAKERS just split + condensed.
  const _railCardHtml = (h, i) => {
    const esc = (h.p.name||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    const pid = (h.p.pid||"").replace(/'/g,"\\'");
    const ovr = h.p.overall || 60;
    const posCol = _myPosColor(h.p.position);
    const ffPerGame = h.gp > 0 ? (h.ff / h.gp).toFixed(1) : h.ff.toFixed(1);
    const FF_HOT = { QB: 22, RB: 14, WR: 11, TE: 8, DL: 8, LB: 9, CB: 6, S: 6, K: 7 }[h.p.position] || 6;
    const isHot = (h.ff / h.gp) >= FF_HOT;
    const portrait = _hasPortrait ? _playerPortrait(h.p, 64) : "";
    return `<div class="frn-rail-card" onclick="frnOpenPlayerCard('${esc}','${pid}')">
      <div class="frn-rail-card-top">
        <div class="frn-rail-portrait" style="border-color:${posCol}">${portrait}</div>
        <div class="frn-rail-card-id">
          <div class="frn-rail-card-name">${h.p.name}</div>
          <div class="frn-rail-card-meta">
            <span style="color:${posCol};font-weight:900">${h.p.position}</span>
            <span style="color:var(--gold-lt);font-weight:800">${ovr}</span>
            <span style="color:var(--gray)">${h.gp}gp</span>
            ${isHot ? `<span class="frn-myguy-fire" title="On a hot streak">🔥</span>` : ""}
          </div>
        </div>
      </div>
      <div class="frn-rail-stats">${h.line}</div>
      <div class="frn-rail-pergame">${h.perGame}</div>
      <div class="frn-rail-ff">
        <span class="frn-rail-ff-val">${ffPerGame}</span>
        <span class="frn-rail-ff-lbl">FFP/G</span>
      </div>
    </div>`;
  };
  const _railHtml = (top, sideLabel) => top.length ? `
    <div class="frn-dashboard-rail">
      <div class="frn-rail-title">🏈 ${sideLabel}</div>
      ${top.map((h, i) => _railCardHtml(h, i)).join("")}
    </div>` : "";
  const offRailHtml = _railHtml(offRailTop, "OFFENSE");
  const defRailHtml = _railHtml(defRailTop, "DEFENSE");

  // 3) SCHEDULE + GAUNTLET (combined) — past results as compact chips on
  //    top, upcoming as rich gauntlet cards below. One card eliminates
  //    the duplicate schedule-strip + separate-gauntlet pattern; the
  //    visual size difference between past chips and future cards
  //    makes "you are HERE" jump out.
  const upcoming4 = stripUpcoming.slice(0, 4);
  const _gauntletCard = (g) => {
    const isHome = g.homeId === chosenTeamId;
    const oppId = isHome ? g.awayId : g.homeId;
    const opp = getTeam(oppId);
    const rtg = frnTeamRating(oppId);
    const combined = Math.round(((rtg.off||60)+(rtg.def||60))/2);
    const oppRec = standings[oppId] || {w:0,l:0};
    const tough = combined >= 78 ? "elite"
                : combined >= 72 ? "tough"
                : combined >= 65 ? "even"
                :                  "soft";
    const toughCol = tough==="elite" ? "#ff8a8a"
                   : tough==="tough" ? "#ffc850"
                   : tough==="even"  ? "rgba(255,255,255,.55)"
                   :                   "#86e0a3";
    const isRival = _areRivals(g.homeId, g.awayId);
    return `<div class="frn-gauntlet-card" style="--toughCol:${toughCol}">
      <div class="frn-gauntlet-wk">W${g.week}${isRival?" 🔥":""}</div>
      <div class="frn-gauntlet-opp">${isHome?"vs":"@"} ${opp?.name||"?"}</div>
      <div class="frn-gauntlet-rec">${oppRec.w}-${oppRec.l}</div>
      <div class="frn-gauntlet-rating">
        <span class="frn-gauntlet-rval" style="color:${toughCol}">${combined}</span>
        <span class="frn-gauntlet-rsub">OFF ${rtg.off||"—"} · DEF ${rtg.def||"—"}</span>
      </div>
      <div class="frn-gauntlet-tag" style="background:${toughCol}22;color:${toughCol};border-color:${toughCol}55">${tough.toUpperCase()}</div>
    </div>`;
  };
  const haveAnything = stripPast.length || upcoming4.length;
  const gauntletHtml = haveAnything ? `
    <div class="frn-card-box frn-schedule-card">
      <div class="frn-card-title">
        SCHEDULE
        <span class="frn-card-title-sub">${stripPast.length} past · next ${upcoming4.length} gauntlet</span>
      </div>
      ${stripPast.length ? `
        <div class="frn-schedule-past-row">
          <span class="frn-schedule-row-label">RECENT</span>
          <div class="frn-sched-strip-group">${stripPast.map(g => stripChip(g, "past")).join("")}</div>
        </div>
      ` : ""}
      ${upcoming4.length ? `
        <div class="frn-schedule-future-row">
          <span class="frn-schedule-row-label">UPCOMING</span>
          <div class="frn-gauntlet">${upcoming4.map(_gauntletCard).join("")}</div>
        </div>
      ` : ""}
    </div>` : "";
  // scheduleStripHtml absorbed into gauntletHtml above; suppressed below
  const __unusedScheduleStripHtml = scheduleStripHtml; // keep ref alive
  void __unusedScheduleStripHtml;

  // Center column layout — eye flow top-to-bottom:
  //   HERO (win prob + play CTA + top decision)
  //   GM PULSE (4 chips at-a-glance — moved from left for centrality)
  //   MATCHUP X-RAY (next opponent fronts)
  //   SCHEDULE (past results + gauntlet — combined)
  //   PLAYMAKERS (top performers)
  const centerHtml = `
    ${nextCardHtml}
    ${pulseHtml}
    ${matchupXrayHtml}
    ${gauntletHtml}
    ${hotBoardHtml}`;

  // ─── Sidebar: compact league snapshot + highlights + POTW ───────────
  // Full Standings + Leaders moved to the League tab. Sidebar shows a
  // glanceable snapshot — top 5 + your row if outside top 5 — with a
  // deep link to the League tab for the full picture.
  // Sidebar slimmed — show only top 3 + your row (with 1 above/below
  // for context if you're outside the top 3). Full standings live on
  // the League tab; the sidebar is glanceable position context.
  const top3 = sorted.slice(0, 3);
  const myIdx = sorted.findIndex(s => s.id === chosenTeamId);
  const showMyRow = myIdx >= 5;
  const standRowHtml = (s, i, isMine) => {
    const playoff  = i < PLAYOFF_TEAMS;
    const gp       = s.w + s.l + s.t;
    const pct      = gp === 0 ? ".000" : (s.w / gp).toFixed(3).replace(/^0/, "");
    return `<div class="frn-stand-row ${isMine ? "frn-me" : ""}">
      <span style="color:${playoff?"var(--gold)":"var(--gray)"};width:1.3rem;flex-shrink:0">${i+1}.</span>
      <span style="flex:1">${isMine ? "» " : ""}${teamLink(s.team)}</span>
      <span style="width:3rem;text-align:right">${s.w}-${s.l}${s.t?`-${s.t}`:""}</span>
      <span style="width:2.8rem;text-align:right;color:var(--gray);font-size:.62rem">${pct}</span>
    </div>`;
  };
  const showMyContext = myIdx >= 3; // user is outside the top 3
  let contextRows = "";
  if (showMyContext) {
    const ctxStart = Math.max(3, myIdx - 1);
    const ctxEnd = Math.min(sorted.length, myIdx + 2);
    contextRows = `<div style="text-align:center;color:var(--blgray);font-size:.55rem;letter-spacing:.5px;padding:.1rem 0">···</div>`
      + sorted.slice(ctxStart, ctxEnd)
          .map((s, i) => standRowHtml(s, ctxStart + i, s.id === chosenTeamId))
          .join("");
  }
  const standHtml = top3.map((s, i) => standRowHtml(s, i, s.id === chosenTeamId)).join("") + contextRows;

  const leaders = frnTeamLeaders(chosenTeamId);
  const leadersHtml = leaders.slice(0, 3).map(l => `
    <div class="frn-leader-row">
      <span class="frn-leader-cat">${l.cat}</span>
      <span class="frn-leader-name">${_playerLinkSmart(l.name)}</span>
      <span class="frn-leader-stat">${l.stat}</span>
    </div>`).join("") || `<div style="color:var(--gray);font-size:.72rem;padding:.5rem 0">Play games to see leaders.</div>`;

  const hlHtml = _buildHighlightsSidebar(chosenTeamId, seasonHighlights);

  const potwRowFn = (label, entry) => {
    if (!entry) return "";
    const isMine = entry.teamId === chosenTeamId;
    return `<div class="frn-leader-row" style="${isMine?"background:rgba(245,197,66,0.08)":""}">
      <span class="frn-leader-cat" style="width:2rem;font-size:.58rem">${label}</span>
      <span class="frn-leader-name">${_playerLinkSmart(entry.name)}
        <span style="color:${entry.teamPrimary};font-size:.58rem;margin-left:.25rem">${entry.teamAbbr}</span>
      </span>
      <span class="frn-leader-stat" style="font-size:.62rem;color:var(--gray)">${entry.statLine}</span>
    </div>`;
  };
  const potwRoundLabel = w => {
    if (w <= FRANCHISE_WEEKS) return `WEEK ${w}`;
    const ri = w - FRANCHISE_WEEKS - 1;
    return ["WILD CARD","DIVISIONAL","CHAMPIONSHIP"][ri] || `R${ri+1}`;
  };
  const isLatestVoted = latestPotwWk != null && !!votesByWeek[latestPotwWk];
  const potwHtml = latestPotw ? `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.3rem">
      <span style="color:var(--gray);font-size:.6rem">${potwRoundLabel(latestPotwWk)}</span>
      ${unvotedWeek!=null?`<button class="frn-cap-btn" onclick="renderPotwVoting(${unvotedWeek})" style="background:var(--gold);color:#000;font-weight:900;border:0;font-size:.6rem">🗳 VOTE W${unvotedWeek}</button>`:""}
    </div>
    ${potwRowFn("OFF",latestPotw.offense)}${potwRowFn("DEF",latestPotw.defense)}${potwRowFn("OL",latestPotw.ol)}${potwRowFn("ST",latestPotw.specialTeams)}
  ` : unvotedWeek!=null ? `<button class="frn-cap-btn" onclick="renderPotwVoting(${unvotedWeek})" style="padding:.35rem .9rem;font-size:.7rem;background:var(--gold);color:#000;font-weight:900;border:0">🗳 VOTE — WEEK ${unvotedWeek} READY</button>`
    : `<div style="color:var(--gray);font-size:.72rem;padding:.3rem 0">Awarded each week.</div>`;

  // Sidebar slimmed: dropped FULL SCHEDULE (center has schedule strip
  // + gauntlet covering this), POTW collapsed to a compact slot inside
  // the league snapshot card when there's something to surface,
  // highlights kept as they show outcomes not just news. The
  // "Full League →" deep link points at the league tab for everything
  // dropped from here.
  const potwIsActionable = latestPotw || unvotedWeek != null;
  const potwSlot = potwIsActionable ? `
    <div class="frn-card-title" style="margin-top:.7rem">PLAYER OF THE WEEK</div>
    ${potwHtml}` : "";
  const sidebarHtml = `
    <div style="display:flex;flex-direction:column;gap:1rem">
      <div class="frn-card-box">
        <div class="frn-card-title">LEAGUE SNAPSHOT <span class="frn-card-title-sub">top ${PLAYOFF_TEAMS} → playoffs</span></div>
        ${standHtml}
        <div class="frn-card-title" style="margin-top:.7rem">TEAM LEADERS</div>
        ${leadersHtml}
        ${potwSlot}
        <button class="frn-cap-btn" onclick="frnSetTab('league')" style="margin-top:.5rem;font-size:.6rem">Full League →</button>
      </div>
      <div class="frn-card-box">
        <div class="frn-card-title">HIGHLIGHTS</div>
        ${hlHtml}
      </div>
    </div>`;

  // ─── Final composition ────────────────────────────────────────────────
  const postGameHtml = _buildPostGameHeadline(chosenTeamId);
  // Team identity tags — derived from cumulative game stats. Surface a
  // strong/weak side of the team (red-zone efficiency, punting unit, return
  // game) so the user reads team character at a glance. Tags only emit at
  // statistically meaningful thresholds (need 3+ games of sample).
  const identityTags = (() => {
    const tags = [];
    let rzAtt = 0, rzTd = 0, puntAtt = 0, puntYds = 0, retTd = 0;
    let gamesPlayed = 0;
    for (const g of (franchise.schedule || [])) {
      if (!g.played || !g.stats) continue;
      if (g.homeId !== chosenTeamId && g.awayId !== chosenTeamId) continue;
      gamesPlayed++;
      const side = g.homeId === chosenTeamId ? "home" : "away";
      const t = g.stats[side]?.totals || {};
      rzAtt += t.rz_att || 0;
      rzTd  += t.rz_td  || 0;
      const players = g.stats[side]?.players || {};
      for (const p of Object.values(players)) {
        puntAtt += p.punt_att || 0;
        puntYds += p.punt_yds || 0;
        retTd   += (p.kr_td || 0) + (p.pr_td || 0);
      }
    }
    if (gamesPlayed < 3) return tags;
    if (rzAtt >= 6) {
      const pct = rzTd / rzAtt;
      if (pct >= 0.60) tags.push({ label: `RZ KILLERS · ${Math.round(pct*100)}%`, color: "#86e0a3", title: `Red zone TD on ${rzTd} of ${rzAtt} trips` });
      else if (pct <= 0.35) tags.push({ label: `RZ STALLS · ${Math.round(pct*100)}%`, color: "#ff8a8a", title: `Red zone TD on only ${rzTd} of ${rzAtt} trips` });
    }
    if (puntAtt >= 6) {
      const avg = puntYds / puntAtt;
      if (avg >= 46.5) tags.push({ label: `PUNT FORTRESS · ${avg.toFixed(1)} avg`, color: "#7ec8e3", title: `${puntAtt} punts, ${avg.toFixed(1)} gross avg` });
    }
    if (retTd >= 2) tags.push({ label: `RETURN THREAT · ${retTd} TD`, color: "var(--gold)", title: `${retTd} return TDs this season` });
    return tags;
  })();
  const identityTagsHtml = identityTags.length ? `
    <div class="frn-overview-tags">
      ${identityTags.map(t => `<span class="frn-overview-tag" style="color:${t.color};border-color:${t.color}" title="${t.title}">${t.label}</span>`).join("")}
    </div>` : "";
  // Slim Overview strip — DROPS the team name, cap, and record (already
  // visible in the app shell banner above) and keeps only the unique
  // glanceable info: PF/PA, OFF/DEF, form strip, and playoff seed.
  // Eliminates the prior triple-render of team-name + cap + record.
  const overviewIdentityHtml = `
    <div class="frn-overview-strip" style="--accent:${myTeam.primary||'var(--gold)'}">
      <span class="frn-overview-strip-meta">
        <b style="color:var(--gold)">PF</b> ${myStand.pf}
        · <b style="color:var(--gold)">PA</b> ${myStand.pa}
        · <b style="color:var(--gold)">OFF</b> ${myRtg.off}
        · <b style="color:var(--gold)">DEF</b> ${myRtg.def}
        ${playedGames.length?` · <span style="letter-spacing:.1rem">${formStrip}</span>`:""}
      </span>
      <span class="frn-overview-strip-seed">${playoffStr}</span>
    </div>
    ${identityTagsHtml}`;
  // Wrapper container centers all top-level dashboard content on wide
  // displays (4K monitors were showing everything pinned to the left
  // because the grid had max-width but no auto margins). The shell
  // grid lets side rails (off rail left, def rail right) fill the
  // gutter on really wide displays — they auto-hide below 2000px so
  // the existing centered layout works untouched at normal widths.
  $("frnHomeContent").innerHTML = `
    <div class="frn-dashboard-shell">
      ${offRailHtml}
      <div class="frn-dashboard-page">
        ${overviewIdentityHtml}
        ${postGameHtml}
        <div class="frn-dashboard-grid">
          ${leftColHtml}
          <div>${centerHtml}</div>
          ${sidebarHtml}
        </div>
        <div class="frn-footer-row">
        <div class="frn-footer-info">${(() => {
          if (_saveLastError?.startsWith("idb-only")) return `<span style="color:#e8a000">ℹ Save in IndexedDB only (localStorage full). Data is safe.</span>`;
          if (_saveLastError) return `<span style="color:#ff7070">⚠ Save error: ${_saveLastError}</span>`;
          const mb = (_saveLastSize / 1024 / 1024).toFixed(2);
          return `Auto-saved · ${mb}MB · Reload to keep playing`;
        })()}</div>
        <button class="btn btn-outline" onclick="frnExportSave()" style="font-size:.62rem;color:var(--gray)" title="Download backup .json">⬇ Export</button>
        <button class="btn btn-outline" onclick="frnImportSave()" style="font-size:.62rem;color:var(--gray)" title="Restore from .json">⬆ Import</button>
        <button class="btn btn-outline frn-abandon-btn" onclick="frnAbandon()">× Abandon</button>
        </div>
      </div>
      ${defRailHtml}
    </div>`;
}

// ── Season-long stats / highlights / MVPs ────────────────────────────────────

// Player MVP weight formula. Rewards TDs, yards, takeaways; penalizes turnovers.
// Applied to season-aggregated stats; combined with team-success multiplier for
// the league MVP race.
function mvpScore(p) {
  let s = 0;
  // Offense — pass_yds weighted to match rec_yds parity (0.10/yard).
  // Pre-fix this was 0.05 which made WRs win MVP 60% of seasons
  // because their per-yard weight was double the QB's. Real NFL MVP
  // voting is ~85% QB; this brings the formula back in line.
  s += (p.pass_td       || 0) * 6
     + (p.pass_yds      || 0) * 0.10
     + (p.pass_comp     || 0) * 0.30
     - (p.pass_int      || 0) * 4
     - (p.sk_taken      || 0) * 0.5;
  s += (p.rush_td       || 0) * 6
     + (p.rush_yds      || 0) * 0.08
     + (p.broken_tackles|| 0) * 0.5
     - (p.fumbles_lost  || 0) * 3;
  s += (p.rec_td        || 0) * 6
     + (p.rec_yds       || 0) * 0.10
     + (p.rec           || 0) * 0.5;
  // Defense
  s += (p.tkl           || 0) * 0.6
     + (p.sk            || 0) * 2
     + (p.int_made      || 0) * 5
     + (p.pd            || 0) * 1
     + (p.ff            || 0) * 2
     + (p.fr            || 0) * 2
     + (p.def_td        || 0) * 8;
  // Kicker
  s += (p.fg_made       || 0) * 2
     + (p.xp_made       || 0) * 0.5;
  // MFF Slice I: analytics bonus. Adds EPA + WPA + clutch CPOE on top
  // of the traditional box-score score. The weights are calibrated so a
  // typical elite QB (≈+15 EPA, +5 WPA) earns ~30-40 bonus points —
  // sizable but doesn't dominate the traditional 200-400 baseline. This
  // makes "analytics darlings" (high CPOE / high WPA in close games)
  // compete with traditional counting-stat MVPs.
  if (typeof mffEPAFor === "function" && p.name) {
    try {
      const r = mffEPAFor(p.name);
      if (r) {
        // EPA: 2 points per EPA-unit (sum across season). 15 EPA → +30.
        s += (r.epa || 0) * 2.0;
        // WPA: 8 points per WPA-unit (heavily weighted — clutch matters
        // for MVP). 5 WPA → +40.
        s += (r.wpa || 0) * 8.0;
        // CPOE bonus for QBs (only QBs have attComp): 1 point per CPOE
        // percentage point. +5% CPOE → +5. Modest, since CPOE correlates
        // with the existing pass_comp/yds metrics already.
        if (r.kind === "qb" && r.attComp >= 30) {
          const cpoePct = ((r.actComp - r.xComp) / r.attComp) * 100;
          s += cpoePct * 1.0;
        }
      }
    } catch (e) { /* defensive — never block MVP vote */ }
  }
  return s;
}

function mvpStatLine(p) {
  const parts = [];
  if (p.pass_att)  parts.push(`${p.pass_comp || 0}/${p.pass_att} ${p.pass_yds || 0} pYds ${p.pass_td || 0} pTD${p.pass_int ? ` ${p.pass_int} INT` : ""}`);
  if (p.rush_att)  parts.push(`${p.rush_att} car ${p.rush_yds || 0} yds ${p.rush_td || 0} TD`);
  if (p.rec_tgt)   parts.push(`${p.rec || 0}/${p.rec_tgt} ${p.rec_yds || 0} yds ${p.rec_td || 0} TD`);
  if (p.tkl || p.sk || p.int_made) {
    const d = [];
    if (p.tkl)      d.push(`${p.tkl} TKL`);
    if (p.sk)       d.push(`${(+p.sk).toFixed(1)} SK`);
    if (p.int_made) d.push(`${p.int_made} INT`);
    if (p.ff)       d.push(`${p.ff} FF`);
    if (p.def_td)   d.push(`${p.def_td} TD`);
    parts.push(d.join(", "));
  }
  if (p.fg_att) parts.push(`${p.fg_made || 0}/${p.fg_att} FG`);
  if (p.pancakes || p.sacks_allowed) {
    const ol = [];
    if (p.pancakes)      ol.push(`${p.pancakes} PNK`);
    if (p.sacks_allowed) ol.push(`${p.sacks_allowed} SA`);
    parts.push(ol.join(" / "));
  }
  return parts.join(" · ");
}

// Unique key for a scheduled game — lets mergeSeasonStats stay idempotent
// across reruns (refresh mid-game, Sim Week racing with frnFinishGame, etc.).
function _gameMergeKey(homeId, awayId, isPlayoff) {
  const s = franchise?.season ?? 1;
  if (isPlayoff) {
    const rIdx = franchise?.playoffBracket?.roundIdx ?? 0;
    return `S${s}-PR${rIdx}-${homeId}-${awayId}`;
  }
  return `S${s}-W${franchise?.week ?? 0}-${homeId}-${awayId}`;
}

// Merge a single game's per-player stats into season-long totals.
// gameKey (optional) gates duplicate merges — if the same game is merged
// twice (e.g. user finishes their live game AND a later Sim Week sees the
// schedule entry still marked unplayed), the second call no-ops.
function mergeSeasonStats(homeId, awayId, gameStats, gameKey) {
  if (!gameStats) return;
  if (!franchise.seasonStats) franchise.seasonStats = {};
  if (!franchise.seasonPlayoffStats) franchise.seasonPlayoffStats = {};
  if (!franchise.seasonAllStats) franchise.seasonAllStats = {};
  if (!franchise._mergedGameKeys) franchise._mergedGameKeys = {};
  if (gameKey) {
    if (franchise._mergedGameKeys[gameKey]) {
      console.warn(`[seasonStats] skipping duplicate merge for ${gameKey}`);
      return;
    }
    franchise._mergedGameKeys[gameKey] = true;
  }
  // Three stores split by phase for NFL-comparable career stats:
  //   seasonStats        — REGULAR SEASON only (NFL convention)
  //   seasonPlayoffStats — PLAYOFFS only
  //   seasonAllStats     — combined (regular + playoff)
  // Playoff games get tagged with PR# in the key (_gameMergeKey).
  const isPlayoff = !!(gameKey && /-PR\d+-/.test(gameKey));
  // "Long" stats are per-play maxima, not counting stats. Take the max
  // across games instead of summing — otherwise a player's season-long
  // reception ends up being the sum of every longest catch they had.
  const MAX_STATS = new Set(["pass_long","rush_long","rec_long","fg_long","int_long","punt_long","kr_long","pr_long"]);
  const mergeInto = (store, teamId, side) => {
    if (!side || !side.players) return;
    if (!store[teamId]) store[teamId] = {};
    const ts = store[teamId];
    for (const [name, p] of Object.entries(side.players)) {
      if (!ts[name]) ts[name] = { name, pos: p.pos, gp: 0 };
      ts[name].gp = (ts[name].gp || 0) + 1;
      for (const [k, v] of Object.entries(p)) {
        if (k === "name" || k === "pos") continue;
        if (typeof v !== "number") continue;
        if (MAX_STATS.has(k)) {
          ts[name][k] = Math.max(ts[name][k] || 0, v);
        } else {
          ts[name][k] = (ts[name][k] || 0) + v;
        }
      }
    }
  };
  // Always merge into seasonAllStats (combined view).
  mergeInto(franchise.seasonAllStats, homeId, gameStats.home);
  mergeInto(franchise.seasonAllStats, awayId, gameStats.away);
  // Split: regular → seasonStats, playoff → seasonPlayoffStats.
  if (isPlayoff) {
    mergeInto(franchise.seasonPlayoffStats, homeId, gameStats.home);
    mergeInto(franchise.seasonPlayoffStats, awayId, gameStats.away);
  } else {
    mergeInto(franchise.seasonStats, homeId, gameStats.home);
    mergeInto(franchise.seasonStats, awayId, gameStats.away);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// MFF GRADES — PFF-style 0-99 player grades computed live from the season
// stat blob. Architecture-A "attribution-only": the engine writes per-snap
// rep outcomes (pressures, run_stuffs, cover_comp, …) gated by _MFF_ATTR
// and proven byte-identical by _mff_ab_check.js. mergeSeasonStats persists
// every numeric field generically, so the rate stats are already here.
//
// Honest grade set (positions intentionally omitted are structural limits,
// not tuning misses — see MFF.md "Engine fixes" + finding #3):
//   DL : g_prsh (pass-rush) + g_rstf (run-stuff) → g_dl combined
//   OL : g_ppro (pass-pro)  + g_rblk (run-block) → g_ol combined
//   CB : g_cov (cover-CB),  standardized within CBs
//   LB : g_cov (cover-LB),  standardized within LBs (coverage only — LB
//        run-D is a structural box-score category error; not graded)
//   S  : not graded (engine never assigns a safety as primary cover man;
//        run-support attribution is opportunity-driven, not skill)
//
// EPA (team/QB/WR/RB) is Slice B (needs per-play log retention).

// Two position notions live in this codebase:
//   - per-game stat line  → fine-grained slots (DE/DT, LT/LG/C/RG/RT, FS/SS)
//   - live player object  → group strings     (DL,   OL,                S)
// mergeSeasonStats persists the slot string, but the chip renderer is called
// with the live player object. Accept either form and roll up to group.
const _MFF_DL_POS = new Set(["DE","DT","DL","EDGE","IDL"]);
const _MFF_OL_POS = new Set(["LT","LG","C","RG","RT","OL","T","G"]);
const _MFF_CB_POS = new Set(["CB","NB","DB"]);
const _MFF_LB_POS = new Set(["LB","MLB","OLB","SLB","WLB","ILB"]);
function _mffGroupOf(pos) {
  if (_MFF_DL_POS.has(pos)) return "DL";
  if (_MFF_OL_POS.has(pos)) return "OL";
  if (_MFF_CB_POS.has(pos)) return "CB";
  if (_MFF_LB_POS.has(pos)) return "LB";
  return null;
}

const _MFF_GRADE_CACHE = { key: null, byName: null };

function _mffMean(xs) { return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0; }
function _mffSd(xs, m) {
  if (!xs.length) return 1;
  return Math.sqrt(xs.reduce((a,b)=>a+(b-m)*(b-m),0)/xs.length) || 1;
}
function _mffClampGrade(g) { return Math.max(20, Math.min(99, Math.round(g))); }

// Standardize a pool: writes `key` on each row from rate fns + weights.
// terms: [{fn, w}] — positive w means higher value is better.
function _mffZGrade(rows, key, terms) {
  const stats = terms.map(t => {
    const xs = rows.map(t.fn);
    const m = _mffMean(xs);
    return { m, s: _mffSd(xs, m), fn: t.fn, w: t.w };
  });
  for (const r of rows) {
    let g = 60;
    for (const t of stats) g += t.w * ((t.fn(r) - t.m) / t.s);
    r[key] = _mffClampGrade(g);
  }
}

// Build league-wide grades over franchise.seasonStats (regular season only).
// Pool thresholds are lighter than _mff_audit.js (which used a 31-game
// round-robin) so grades start surfacing by ~week 4-5 of a 17-game season.
function _mffComputeLeagueGrades() {
  if (!franchise?.seasonStats) return new Map();
  const rows = [];
  for (const players of Object.values(franchise.seasonStats)) {
    for (const stat of Object.values(players)) {
      if (!stat || !stat.name) continue;
      rows.push({ name: stat.name, pos: stat.pos, group: _mffGroupOf(stat.pos), stat });
    }
  }
  // Rate helpers — formulas exactly match _mff_audit.js.
  const prRate    = r => (r.stat.pressures||0)         / Math.max(1, r.stat.pass_rush_snaps||0);
  const skRate    = r => (r.stat.sk||0)                / Math.max(1, r.stat.pass_rush_snaps||0);
  const rdNet     = r => ((r.stat.run_stuffs||0) - (r.stat.run_def_losses||0))
                                                       / Math.max(1, r.stat.run_def_snaps||0);
  const paRate    = r => (r.stat.pressures_allowed||0) / Math.max(1, r.stat.pass_pro_snaps||0);
  const saRate    = r => (r.stat.sacks_allowed||0)     / Math.max(1, r.stat.pass_pro_snaps||0);
  const rbNet     = r => ((r.stat.run_block_wins||0) - (r.stat.run_block_losses||0))
                                                       / Math.max(1, r.stat.run_block_snaps||0);
  const compAllow = r => (r.stat.cover_comp||0)        / Math.max(1, r.stat.cover_tgt||0);
  const ydsPerTgt = r => (r.stat.cover_yds||0)         / Math.max(1, r.stat.cover_tgt||0);
  const playmkRt  = r => ((r.stat.pd||0) + 2*(r.stat.int_made||0))
                                                       / Math.max(1, r.stat.cover_tgt||0);

  // Qualified pools. Pool size must hit 6 to standardize (else z-scores are
  // noise). Sub-grade weights match _mff_audit.js; see slice #1-3 validation.
  const rushers  = rows.filter(r => (r.stat.pass_rush_snaps||0) >= 100);
  const runDef   = rows.filter(r => (r.stat.run_def_snaps||0)   >= 80);
  const blockers = rows.filter(r => (r.stat.pass_pro_snaps||0)  >= 100);
  const runBlk   = rows.filter(r => (r.stat.run_block_snaps||0) >= 80);
  const coverers = rows.filter(r => (r.stat.cover_tgt||0)       >= 25);

  if (rushers.length  >= 6) _mffZGrade(rushers,  "g_prsh", [{fn:prRate,w:7},{fn:skRate,w:11},{fn:r=>r.stat.pass_rush_snaps||0,w:3}]);
  if (runDef.length   >= 6) _mffZGrade(runDef,   "g_rstf", [{fn:rdNet,w:14}]);
  if (blockers.length >= 6) _mffZGrade(blockers, "g_ppro", [{fn:paRate,w:-13},{fn:saRate,w:-6}]);
  if (runBlk.length   >= 6) _mffZGrade(runBlk,   "g_rblk", [{fn:rbNet,w:14}]);
  for (const grpName of ["CB","LB"]) {
    const grp = coverers.filter(r => r.group === grpName);
    if (grp.length >= 6) _mffZGrade(grp, "g_cov", [{fn:compAllow,w:-11},{fn:ydsPerTgt,w:-6},{fn:playmkRt,w:7}]);
  }
  // Combined DL / OL — average available sub-grades.
  for (const r of rows) {
    const dl = [r.g_prsh, r.g_rstf].filter(g => g != null);
    const ol = [r.g_ppro, r.g_rblk].filter(g => g != null);
    if (dl.length) r.g_dl = _mffClampGrade(_mffMean(dl));
    if (ol.length) r.g_ol = _mffClampGrade(_mffMean(ol));
  }
  // Index by name. Generated rosters don't repeat names across teams in
  // practice; if collisions ever appear, switch to a teamId:name key.
  const byName = new Map();
  for (const r of rows) {
    if (r.g_prsh != null || r.g_rstf != null || r.g_ppro != null
        || r.g_rblk != null || r.g_cov != null) {
      byName.set(r.name, {
        g_prsh: r.g_prsh, g_rstf: r.g_rstf, g_ppro: r.g_ppro, g_rblk: r.g_rblk,
        g_cov:  r.g_cov,  g_dl:   r.g_dl,   g_ol:   r.g_ol,
        // attribution counts surface in chip tooltips ("X targets" / "Y snaps").
        prs_snaps: r.stat.pass_rush_snaps||0, pp_snaps: r.stat.pass_pro_snaps||0,
        rd_snaps:  r.stat.run_def_snaps||0,   rb_snaps: r.stat.run_block_snaps||0,
        cov_tgt:   r.stat.cover_tgt||0,
      });
    }
  }
  return byName;
}

// Memoize by (season, week, total merged games) — invalidates the moment
// any new game lands in seasonStats.
function mffGradeFor(name) {
  if (!franchise || !name) return null;
  const k = `${franchise.season ?? 0}:${franchise.week ?? 0}:${Object.keys(franchise._mergedGameKeys||{}).length}`;
  if (_MFF_GRADE_CACHE.key !== k) {
    _MFF_GRADE_CACHE.byName = _mffComputeLeagueGrades();
    _MFF_GRADE_CACHE.key = k;
  }
  return _MFF_GRADE_CACHE.byName?.get(name) || null;
}

// HTML chip block for a player's MFF grades — empty string if the player
// has no qualifying grade in the current season (wrong position, not
// enough snaps yet, or pool too small to standardize). Visual idiom
// matches gradeBadge (tt-ovr tier-N) for consistency. Designed to slot
// into _buildStatScopeBlock's regular-season scope only.
function mffGradeChipsHtml(p) {
  if (!p) return "";
  const group = _mffGroupOf(p.position);
  if (!group) return "";
  const g = mffGradeFor(p.name);
  if (!g) return "";
  const cls = (typeof gradeClass === "function") ? gradeClass : ()=>"c";
  const lab = (typeof gradeLabel === "function") ? gradeLabel : (n)=>n;
  const chip = (grade, label, tip) => grade == null ? "" :
    `<span class="tt-ovr tier-${cls(grade)}" title="${tip}" style="margin-right:.35rem">${label} ${lab(grade)}</span>`;
  const chips = [];
  if (group === "DL") {
    chips.push(chip(g.g_prsh, "PASS-RUSH", `pass-rush · ${g.prs_snaps} pass-rush snaps`));
    chips.push(chip(g.g_rstf, "RUN-STUF",  `run-stuff · ${g.rd_snaps} run-def snaps`));
    chips.push(chip(g.g_dl,   "DL",        `combined DL grade (pass-rush + run-stuff)`));
  } else if (group === "OL") {
    chips.push(chip(g.g_ppro, "PASS-PRO", `pass-protect · ${g.pp_snaps} pass-pro snaps`));
    chips.push(chip(g.g_rblk, "RUN-BLK",  `run-block · ${g.rb_snaps} run-block snaps`));
    chips.push(chip(g.g_ol,   "OL",       `combined OL grade (pass-pro + run-block)`));
  } else if (group === "CB" || group === "LB") {
    chips.push(chip(g.g_cov, "COVERAGE",
      `${group === "CB" ? "cornerback coverage" : "cover-LB"} · ${g.cov_tgt} targets faced`));
  }
  const html = chips.filter(Boolean).join("");
  if (!html) return "";
  return `<div style="margin-top:.5rem;padding-top:.4rem;border-top:1px dashed var(--border)">
    <div class="frn-card-title" style="margin-bottom:.25rem">MFF GRADES <span style="opacity:.6;font-weight:normal">(0-99, league-standardized)</span></div>
    <div style="display:flex;flex-wrap:wrap">${html}</div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────
// MFF EPA — Expected Points Added. Built over a compact per-play log
// captured at game-end (franchise.playLog[season]), scored against a baked
// empirical EP table extracted from a 2-season audit round-robin.
//
// FIRST-PRINCIPLES: EP(state) is a property of the engine's RULES (yards-
// per-drive, scoring odds from a state), not of which teams are playing.
// Talent shifts HOW OFTEN a state is reached, not the points-value of being
// there. So a baked table from a large round-robin is the correct estimate;
// a live franchise model would be strictly noisier mid-season (~12k plays
// vs the audit's 64k+/season) without any real fidelity gain.
//
// Validation (from _mff_epa.js audit): EP gradient textbook (own-25 +0.66,
// midfield +2.57, 1st&goal-5 +5.75, 3rd&8-own-10 -1.02, backed-up -0.18).
// Team EPA/play ↔ points/game r=0.94. QB EPA/db ↔ OVR r=0.45.

// Baked EP table — generated by _mff_bake_ep.js (2-season round-robin).
// 3-level fallback: full(d|ytg|yl) → down|yl → yl. Total ~173 entries (~2.8KB).
//   ytg buckets:  0=short(≤3)  1=med(4-6)  2=long(7-10)  3=vlong(11+)
//   yl buckets: 0=own-goal..9=opp-goal (10-yard chunks)
const _MFF_EP_TABLE_FULL = {"1|1|2":1.024,"1|1|3":1.706,"1|1|4":2.329,"1|1|5":3.054,"1|1|6":3.6,"1|1|7":4.469,"1|1|8":4.667,"1|1|9":5.607,"1|2|0":-0.566,"1|2|1":0.294,"1|2|2":0.679,"1|2|3":1.375,"1|2|4":1.934,"1|2|5":2.575,"1|2|6":3.32,"1|2|7":3.827,"1|2|8":4.499,"1|2|9":5.296,"1|3|0":-1.402,"1|3|1":-0.752,"1|3|2":0.435,"1|3|3":1.596,"1|3|4":1.369,"1|3|5":2.393,"1|3|6":3,"1|3|7":3.737,"1|3|8":4.132,"1|3|9":5.071,"2|0|1":0.469,"2|0|2":1.026,"2|0|3":1.327,"2|0|4":2.016,"2|0|5":2.566,"2|0|6":3.328,"2|0|7":3.983,"2|0|8":4.491,"2|0|9":5.563,"2|1|0":-1.211,"2|1|1":0,"2|1|2":0.696,"2|1|3":1.081,"2|1|4":1.895,"2|1|5":2.465,"2|1|6":3.086,"2|1|7":3.866,"2|1|8":4.19,"2|1|9":5.054,"2|2|0":-0.703,"2|2|1":-0.413,"2|2|2":0.265,"2|2|3":0.843,"2|2|4":1.46,"2|2|5":2.101,"2|2|6":2.875,"2|2|7":3.474,"2|2|8":4.045,"2|2|9":4.869,"2|3|0":-1.696,"2|3|1":-0.703,"2|3|2":-0.258,"2|3|3":0.333,"2|3|4":1.158,"2|3|5":1.849,"2|3|6":2.59,"2|3|7":2.94,"2|3|8":3.686,"2|3|9":4.577,"3|0|1":-0.465,"3|0|2":0.352,"3|0|3":0.894,"3|0|4":1.667,"3|0|5":2.305,"3|0|6":2.964,"3|0|7":3.51,"3|0|8":4.113,"3|0|9":4.744,"3|1|1":-0.26,"3|1|2":-0.223,"3|1|3":0.338,"3|1|4":1.045,"3|1|5":1.542,"3|1|6":2.652,"3|1|7":3.349,"3|1|8":3.463,"3|1|9":4.375,"3|2|0":-2.121,"3|2|1":-0.91,"3|2|2":-0.618,"3|2|3":-0.051,"3|2|4":0.761,"3|2|5":1.308,"3|2|6":2.28,"3|2|7":2.815,"3|2|8":3.352,"3|2|9":4.233,"3|3|0":-1.923,"3|3|1":-1.273,"3|3|2":-0.754,"3|3|3":-0.115,"3|3|4":0.524,"3|3|5":1.159,"3|3|6":2.042,"3|3|7":2.484,"3|3|8":3.114,"3|3|9":3.778,"4|0|2":-0.753,"4|0|3":-0.125,"4|0|4":0.764,"4|0|5":1.483,"4|0|6":1.632,"4|0|7":2.44,"4|0|8":2.241,"4|0|9":3.79,"4|1|2":-0.868,"4|1|3":-0.89,"4|1|4":-0.087,"4|1|5":0.879,"4|1|6":1.308,"4|1|9":4.688,"4|2|2":-1.712,"4|2|3":-1.188,"4|2|4":0.083,"4|2|5":0,"4|2|9":4.219};
const _MFF_EP_TABLE_DOWN = {"1||0":-0.661,"1||1":0.134,"1||2":0.673,"1||3":1.389,"1||4":1.917,"1||5":2.573,"1||6":3.311,"1||7":3.83,"1||8":4.487,"1||9":5.298,"2||0":-1.163,"2||1":-0.453,"2||2":0.274,"2||3":0.919,"2||4":1.601,"2||5":2.217,"2||6":2.947,"2||7":3.561,"2||8":4.099,"2||9":5.005,"3||0":-1.884,"3||1":-1.022,"3||2":-0.497,"3||3":0.314,"3||4":1,"3||5":1.588,"3||6":2.485,"3||7":3.064,"3||8":3.526,"3||9":4.373,"4||1":-1.5,"4||2":-0.891,"4||3":-0.31,"4||4":0.501,"4||5":1.155,"4||6":1.527,"4||7":2.293,"4||8":2.265,"4||9":3.974};
const _MFF_EP_TABLE_YARD = {"0":-1.082,"1":-0.35,"2":0.348,"3":0.941,"4":1.582,"5":2.213,"6":2.981,"7":3.554,"8":4.115,"9":4.971};
const _MFF_EPA_PASS_KIND = new Set(["complete","incomplete","sack","int"]);
const _MFF_EPA_RUN_KIND  = new Set(["run","scramble"]);
function _mffEPYtgBucket(y)  { return y<=3?0:y<=6?1:y<=10?2:3; }
function _mffEPYardBucket(yl){ return Math.max(0,Math.min(9,Math.floor(yl/10))); }
function _mffEP(d, y, yl) {
  if (!(d >= 1 && d <= 4) || typeof yl !== "number") return 0;
  const yb = _mffEPYardBucket(yl);
  const kf = d + "|" + _mffEPYtgBucket(y) + "|" + yb;
  if (_MFF_EP_TABLE_FULL[kf] != null) return _MFF_EP_TABLE_FULL[kf];
  const kd = d + "||" + yb;
  if (_MFF_EP_TABLE_DOWN[kd] != null) return _MFF_EP_TABLE_DOWN[kd];
  return _MFF_EP_TABLE_YARD[String(yb)] ?? 0;
}

// Compact per-play record: project sim.plays entries to just what EPA + the
// near-future analytics (WPA, signature-plays leaderboard) need. Sparse —
// optional fields only set when meaningful. Skips non-scrimmage plays.
function _mffCompactPlay(p) {
  if (!p) return null;
  const isPass = _MFF_EPA_PASS_KIND.has(p.kind);
  const isRun  = _MFF_EPA_RUN_KIND.has(p.kind);
  if (!isPass && !isRun) return null;
  if (!(p.down >= 1 && p.down <= 4) || typeof p.yardLine !== "number") return null;
  const r = {
    d:  p.down,
    y:  p.ytg || 10,
    yl: p.yardLine,
    p:  p.poss,                  // "home" | "away"
    q:  p.quarter,
    t:  typeof p.time === "number" ? p.time : 0,   // seconds left in current quarter (for WP)
    k:  p.kind,
    yd: typeof p.yards === "number" ? p.yards : 0,
    hs: p.homeScore || 0,
    as: p.awayScore || 0,
  };
  if (p.passer)   r.qb = p.passer;
  if (p.receiver) r.rc = p.receiver;
  if (p.rusher)   r.ru = p.rusher;
  if (p.tackler)  r.tk = p.tackler;
  // For CPOE: targetDepth (air yards) is set on complete + incomplete only;
  // pressure is set on every play but only meaningful on dropbacks. Sparse —
  // only record when present + nonzero.
  if (typeof p.targetDepth === "number") r.td = p.targetDepth;
  if (typeof p.pressure === "number" && Math.abs(p.pressure) > 0.01) r.pr = +p.pressure.toFixed(2);
  return r;
}

// ── MFF WP/WPA — Win Probability & Win Probability Added ───────────────
// Same first-principles argument as the EP bake: WP(state) is a property
// of the engine's RULES (clock burn, scoring rate from a state), not the
// franchises playing. A baked league-wide table from a 2-season round-robin
// is the correct estimate; a live franchise model would be noisier. EPA
// measures EFFICIENCY (points per play); WPA measures LEVERAGE (how much
// the play actually moved the needle on winning the game). A 5-yard gain
// in Q1 has low WPA; the same 5-yard 4th-down conversion in the last
// minute has huge WPA — that's what makes it the "clutch" metric.
//
// Validation (from _mff_bake_wp.js): start-of-game even = 0.51 (NFL 0.50),
// up 7 with 30s = 1.00 (NFL ~0.95+), FG-range tied with 2:00 = 0.73 (NFL
// 0.70-0.85), up 21 with 5min = 1.00 (NFL ~0.99). Engine slightly
// underweights late comebacks vs NFL — real product signal, but the
// monotonic structure is correct.
//
// Buckets:
//   sd (offense's score diff): 0:≤-17 1:-16..-15 2:-14..-9 3:-8 4:-7
//     5:-6..-4 6:-3..-1 7:0 8:+1..+3 9:+4..+6 10:+7 11:+8 12:+9..+14
//     13:+15..+16 14:≥+17
//   tl (seconds left in regulation): 0:≤30s 1:31-120 2:121-300 3:301-600
//     4:601-1200 5:1201-1800 6:≥1801
//   yl (offensive yardline, 10-yard chunks): 0=own-goal..9=opp-goal
const _MFF_WP_TABLE_FULL = {"0|1|2|1":0,"0|1|2|2":0,"0|1|2|3":0,"0|1|3|1":0,"0|1|3|2":0,"0|1|3|3":0,"0|1|4|1":0,"0|1|4|2":0,"0|1|4|3":0,"0|1|5|1":0,"0|1|5|2":0,"0|1|5|3":0,"0|1|6|1":0,"0|1|6|2":0,"0|1|7|1":0,"0|1|8|1":0,"0|1|8|2":0,"0|2|2|1":0,"0|2|2|2":0,"0|2|2|3":0,"0|2|3|1":0,"0|2|3|2":0,"0|2|3|3":0,"0|2|4|1":0,"0|2|4|2":0,"0|2|4|3":0,"0|2|5|1":0,"0|2|5|2":0,"0|2|5|3":0,"0|2|6|1":0,"0|2|6|2":0,"0|2|6|3":0,"0|2|7|1":0,"0|2|7|2":0,"0|2|8|1":0,"0|3|1|2":0,"0|3|2|1":0,"0|3|2|2":0,"0|3|2|3":0,"0|3|3|1":0,"0|3|3|2":0,"0|3|3|3":0,"0|3|4|1":0,"0|3|4|2":0,"0|3|4|3":0,"0|3|5|1":0,"0|3|5|2":0,"0|3|5|3":0,"0|3|6|1":0,"0|3|6|2":0,"0|3|6|3":0,"0|3|7|1":0,"0|3|7|2":0,"0|3|8|1":0,"0|3|8|2":0,"0|3|8|3":0,"0|3|9|1":0,"0|3|9|2":0,"0|4|1|1":0,"0|4|1|2":0,"0|4|1|3":0,"0|4|2|1":0.006,"0|4|2|2":0.014,"0|4|2|3":0,"0|4|3|1":0.005,"0|4|3|2":0,"0|4|3|3":0.025,"0|4|3|4":0,"0|4|4|1":0.006,"0|4|4|2":0.007,"0|4|4|3":0.011,"0|4|5|1":0.02,"0|4|5|2":0.018,"0|4|5|3":0.033,"0|4|6|1":0.016,"0|4|6|2":0.021,"0|4|6|3":0,"0|4|7|1":0.018,"0|4|7|2":0.024,"0|4|7|3":0,"0|4|8|1":0.044,"0|4|8|2":0.026,"0|4|8|3":0.019,"0|4|9|1":0.06,"0|4|9|2":0.061,"0|4|9|3":0.03,"0|5|1|2":0,"0|5|2|1":0.013,"0|5|2|2":0.012,"0|5|2|3":0.011,"0|5|3|1":0.006,"0|5|3|2":0,"0|5|3|3":0.01,"0|5|4|1":0.015,"0|5|4|2":0.03,"0|5|4|3":0.027,"0|5|5|1":0.01,"0|5|5|2":0.016,"0|5|5|3":0,"0|5|6|1":0,"0|5|6|2":0,"0|5|6|3":0,"0|5|7|1":0,"0|5|7|2":0,"0|5|7|3":0.036,"0|5|8|1":0.049,"0|5|8|2":0.03,"0|5|9|1":0.026,"0|5|9|2":0.034,"0|6|2|1":0.04,"0|6|2|2":0.045,"0|6|2|3":0.028,"0|6|3|1":0.038,"0|6|3|2":0.018,"0|6|3|3":0.013,"0|6|4|1":0.03,"0|6|4|2":0.03,"0|6|4|3":0,"0|6|5|1":0.032,"0|6|5|2":0.018,"0|6|5|3":0,"0|6|6|1":0.062,"0|6|6|2":0.098,"0|6|7|1":0.026,"0|6|7|2":0.051,"0|6|8|1":0.073,"0|6|8|2":0.031,"0|6|8|3":0.036,"10|3|2|1":0.786,"10|3|4|1":0.96,"10|4|2|1":0.904,"10|4|2|2":0.868,"10|4|3|1":0.915,"10|4|3|2":0.897,"10|4|3|3":0.971,"10|4|4|1":0.92,"10|4|4|2":0.889,"10|4|5|1":0.976,"10|4|5|2":0.963,"10|4|6|1":0.9,"10|4|6|2":0.912,"10|4|7|1":0.97,"10|4|8|1":0.964,"10|4|9|1":1,"10|5|2|1":0.871,"10|5|2|2":0.833,"10|5|2|3":0.775,"10|5|3|1":0.88,"10|5|3|2":0.846,"10|5|3|3":0.797,"10|5|4|1":0.897,"10|5|4|2":0.846,"10|5|5|1":0.927,"10|5|5|2":0.944,"10|5|6|1":0.913,"10|5|6|2":0.892,"10|5|7|1":0.912,"10|5|7|2":0.926,"10|5|8|1":1,"10|5|8|2":0.964,"10|5|9|1":0.97,"10|6|0|1":0.83,"10|6|1|1":0.748,"10|6|1|2":0.777,"10|6|1|3":0.786,"10|6|2|1":0.79,"10|6|2|2":0.749,"10|6|2|3":0.733,"10|6|3|1":0.825,"10|6|3|2":0.818,"10|6|3|3":0.802,"10|6|4|1":0.82,"10|6|4|2":0.861,"10|6|4|3":0.803,"10|6|5|1":0.909,"10|6|5|2":0.833,"10|6|5|3":0.856,"10|6|6|1":0.841,"10|6|6|2":0.815,"10|6|6|3":0.824,"10|6|7|1":0.868,"10|6|7|2":0.845,"10|6|7|3":0.797,"10|6|8|1":0.902,"10|6|8|2":0.895,"10|6|8|3":0.864,"10|6|9|1":0.943,"10|6|9|2":0.927,"10|6|9|3":0.891,"11|4|2|1":1,"11|4|3|1":0.969,"11|4|3|2":1,"11|4|4|1":1,"11|4|4|2":0.966,"11|4|6|1":1,"11|5|2|1":0.933,"11|6|2|1":0.94,"11|6|3|1":0.857,"11|6|5|1":0.875,"12|2|2|1":0.975,"12|2|2|2":0.967,"12|2|3|1":1,"12|2|3|2":1,"12|2|3|3":1,"12|2|4|1":1,"12|2|4|2":1,"12|2|5|1":1,"12|2|5|2":1,"12|2|6|1":1,"12|2|7|1":1,"12|2|8|1":1,"12|2|9|1":1,"12|3|1|1":0.917,"12|3|2|1":1,"12|3|2|2":0.983,"12|3|2|3":0.964,"12|3|3|1":1,"12|3|3|2":1,"12|3|3|3":0.982,"12|3|4|1":1,"12|3|4|2":0.984,"12|3|4|3":0.967,"12|3|5|1":1,"12|3|5|2":1,"12|3|5|3":1,"12|3|6|1":1,"12|3|6|2":1,"12|3|6|3":1,"12|3|7|1":1,"12|3|7|2":1,"12|3|8|1":1,"12|3|8|2":1,"12|3|9|1":1,"12|3|9|2":1,"12|4|1|1":0.933,"12|4|1|2":0.968,"12|4|2|1":0.953,"12|4|2|2":0.953,"12|4|2|3":0.939,"12|4|3|1":0.952,"12|4|3|2":0.96,"12|4|3|3":0.958,"12|4|4|1":0.961,"12|4|4|2":0.947,"12|4|4|3":0.909,"12|4|5|1":0.977,"12|4|5|2":0.98,"12|4|5|3":0.958,"12|4|6|1":0.981,"12|4|6|2":0.976,"12|4|6|3":0.978,"12|4|7|1":0.978,"12|4|7|2":0.97,"12|4|7|3":1,"12|4|8|1":0.989,"12|4|8|2":0.985,"12|4|8|3":0.949,"12|4|9|1":0.974,"12|4|9|2":0.954,"12|4|9|3":0.939,"12|5|1|1":0.917,"12|5|1|2":0.933,"12|5|1|3":0.808,"12|5|2|1":0.904,"12|5|2|2":0.896,"12|5|2|3":0.925,"12|5|3|1":0.913,"12|5|3|2":0.928,"12|5|3|3":0.917,"12|5|4|1":0.928,"12|5|4|2":0.899,"12|5|4|3":0.894,"12|5|5|1":0.92,"12|5|5|2":0.923,"12|5|5|3":0.929,"12|5|6|1":0.962,"12|5|6|2":0.957,"12|5|6|3":0.979,"12|5|7|1":0.931,"12|5|7|2":0.952,"12|5|7|3":1,"12|5|8|1":0.919,"12|5|8|2":0.914,"12|5|8|3":0.886,"12|5|9|1":0.985,"12|5|9|2":0.944,"12|5|9|3":0.962,"12|6|0|1":0.771,"12|6|1|1":0.841,"12|6|1|2":0.797,"12|6|1|3":0.696,"12|6|2|1":0.89,"12|6|2|2":0.883,"12|6|2|3":0.849,"12|6|3|1":0.893,"12|6|3|2":0.897,"12|6|3|3":0.849,"12|6|4|1":0.883,"12|6|4|2":0.853,"12|6|4|3":0.853,"12|6|5|1":0.922,"12|6|5|2":0.899,"12|6|5|3":0.909,"12|6|6|1":0.897,"12|6|6|2":0.921,"12|6|6|3":0.894,"12|6|7|1":0.929,"12|6|7|2":0.88,"12|6|7|3":0.873,"12|6|8|1":0.928,"12|6|8|2":0.939,"12|6|8|3":0.935,"12|6|9|1":0.969,"12|6|9|2":0.975,"12|6|9|3":0.938,"13|4|2|1":1,"13|4|3|1":0.962,"13|4|4|1":0.97,"13|4|5|1":1,"13|4|5|2":0.963,"13|4|6|1":1,"13|5|2|1":0.902,"13|5|3|1":0.939,"14|2|2|1":1,"14|2|3|1":1,"14|2|3|2":1,"14|2|4|1":1,"14|2|4|2":1,"14|2|5|1":1,"14|2|5|2":1,"14|2|6|1":1,"14|2|6|2":1,"14|2|7|1":1,"14|2|7|2":1,"14|2|8|1":1,"14|2|8|2":1,"14|2|9|1":1,"14|2|9|2":1,"14|2|9|3":1,"14|3|2|1":1,"14|3|2|2":1,"14|3|2|3":1,"14|3|3|1":1,"14|3|3|2":1,"14|3|3|3":1,"14|3|4|1":1,"14|3|4|2":1,"14|3|4|3":1,"14|3|5|1":1,"14|3|5|2":1,"14|3|5|3":1,"14|3|6|1":1,"14|3|6|2":1,"14|3|6|3":1,"14|3|7|1":1,"14|3|7|2":1,"14|3|7|3":1,"14|3|8|1":1,"14|3|8|2":1,"14|3|8|3":1,"14|3|9|1":1,"14|3|9|2":1,"14|3|9|3":1,"14|4|1|1":1,"14|4|2|1":1,"14|4|2|2":1,"14|4|2|3":1,"14|4|3|1":1,"14|4|3|2":1,"14|4|3|3":1,"14|4|4|1":1,"14|4|4|2":1,"14|4|4|3":1,"14|4|5|1":1,"14|4|5|2":1,"14|4|5|3":1,"14|4|6|1":1,"14|4|6|2":1,"14|4|6|3":1,"14|4|7|1":1,"14|4|7|2":1,"14|4|7|3":1,"14|4|8|1":1,"14|4|8|2":1,"14|4|8|3":1,"14|4|9|1":1,"14|4|9|2":1,"14|4|9|3":1,"14|5|1|1":1,"14|5|1|2":1,"14|5|2|1":0.994,"14|5|2|2":0.987,"14|5|2|3":1,"14|5|3|1":0.992,"14|5|3|2":1,"14|5|3|3":1,"14|5|4|1":0.992,"14|5|4|2":0.986,"14|5|4|3":1,"14|5|5|1":1,"14|5|5|2":1,"14|5|5|3":0.972,"14|5|6|1":1,"14|5|6|2":1,"14|5|6|3":1,"14|5|7|1":1,"14|5|7|2":1,"14|5|7|3":1,"14|5|8|1":1,"14|5|8|2":1,"14|5|8|3":1,"14|5|9|1":1,"14|5|9|2":1,"14|6|1|1":1,"14|6|2|1":0.986,"14|6|2|2":0.98,"14|6|3|1":0.949,"14|6|3|2":0.976,"14|6|3|3":1,"14|6|4|1":0.969,"14|6|4|2":0.963,"14|6|5|1":0.957,"14|6|5|2":0.942,"14|6|6|1":0.972,"14|6|6|2":0.93,"14|6|7|1":0.936,"14|6|7|2":0.941,"14|6|8|1":0.979,"14|6|8|2":0.97,"14|6|9|1":1,"1|3|2|1":0,"1|4|2|1":0,"1|4|2|2":0,"1|4|3|1":0,"1|4|3|2":0.038,"1|4|4|1":0.036,"1|4|4|2":0.04,"1|4|5|1":0,"1|5|2|1":0.063,"1|5|2|2":0.031,"1|5|3|1":0.154,"1|5|3|2":0.04,"1|6|2|1":0.113,"1|6|2|2":0.167,"1|6|3|1":0.034,"2|1|2|1":0,"2|1|2|2":0,"2|1|3|1":0,"2|1|3|2":0,"2|1|4|1":0,"2|1|4|2":0,"2|1|5|1":0.023,"2|1|5|2":0,"2|1|6|1":0.031,"2|1|6|2":0.038,"2|1|8|1":0,"2|1|9|1":0.077,"2|2|2|1":0.014,"2|2|2|2":0,"2|2|2|3":0,"2|2|3|1":0.02,"2|2|3|2":0.028,"2|2|3|3":0.036,"2|2|4|1":0.037,"2|2|4|2":0,"2|2|5|1":0,"2|2|6|1":0.034,"2|2|6|2":0.015,"2|2|7|1":0,"2|2|7|2":0,"2|3|2|1":0.004,"2|3|2|2":0,"2|3|2|3":0,"2|3|3|1":0.041,"2|3|3|2":0.045,"2|3|3|3":0.01,"2|3|4|1":0,"2|3|4|2":0,"2|3|4|3":0.027,"2|3|5|1":0.043,"2|3|5|2":0.044,"2|3|5|3":0.037,"2|3|6|1":0.026,"2|3|7|1":0.143,"2|3|7|2":0.088,"2|3|8|1":0.125,"2|3|8|2":0.231,"2|3|9|1":0.114,"2|3|9|2":0.071,"2|4|1|1":0.021,"2|4|1|2":0.061,"2|4|1|3":0.036,"2|4|2|1":0.055,"2|4|2|2":0.057,"2|4|2|3":0.049,"2|4|3|1":0.08,"2|4|3|2":0.048,"2|4|3|3":0.091,"2|4|4|1":0.082,"2|4|4|2":0.077,"2|4|4|3":0.073,"2|4|5|1":0.099,"2|4|5|2":0.128,"2|4|5|3":0.113,"2|4|6|1":0.117,"2|4|6|2":0.108,"2|4|6|3":0.156,"2|4|7|1":0.141,"2|4|7|2":0.145,"2|4|7|3":0.091,"2|4|8|1":0.212,"2|4|8|2":0.164,"2|4|8|3":0.188,"2|4|9|1":0.241,"2|4|9|2":0.209,"2|4|9|3":0.194,"2|5|1|1":0.125,"2|5|1|2":0.107,"2|5|1|3":0.036,"2|5|2|1":0.095,"2|5|2|2":0.104,"2|5|2|3":0.044,"2|5|3|1":0.126,"2|5|3|2":0.101,"2|5|3|3":0.133,"2|5|4|1":0.099,"2|5|4|2":0.118,"2|5|4|3":0.076,"2|5|5|1":0.127,"2|5|5|2":0.1,"2|5|5|3":0.085,"2|5|6|1":0.104,"2|5|6|2":0.106,"2|5|6|3":0.048,"2|5|7|1":0.189,"2|5|7|2":0.174,"2|5|7|3":0.156,"2|5|8|1":0.11,"2|5|8|2":0.132,"2|5|8|3":0.128,"2|5|9|1":0.105,"2|5|9|2":0.047,"2|5|9|3":0.04,"2|6|1|1":0.118,"2|6|1|2":0.117,"2|6|1|3":0.026,"2|6|2|1":0.125,"2|6|2|2":0.107,"2|6|2|3":0.109,"2|6|3|1":0.171,"2|6|3|2":0.112,"2|6|3|3":0.125,"2|6|4|1":0.137,"2|6|4|2":0.2,"2|6|4|3":0.181,"2|6|5|1":0.145,"2|6|5|2":0.136,"2|6|5|3":0.122,"2|6|6|1":0.178,"2|6|6|2":0.14,"2|6|6|3":0.159,"2|6|7|1":0.168,"2|6|7|2":0.168,"2|6|7|3":0.139,"2|6|8|1":0.164,"2|6|8|2":0.129,"2|6|8|3":0.115,"2|6|9|1":0.177,"2|6|9|2":0.156,"2|6|9|3":0.101,"3|4|2|1":0.05,"3|4|3|1":0,"3|5|2|1":0.043,"3|6|2|1":0.156,"3|6|2|2":0.167,"3|6|3|1":0.2,"3|6|3|2":0.2,"3|6|4|1":0.283,"3|6|4|2":0.232,"3|6|5|1":0.304,"4|3|2|1":0.067,"4|3|3|1":0.143,"4|4|2|1":0.21,"4|4|2|2":0.162,"4|4|3|1":0.232,"4|4|3|2":0.279,"4|4|4|1":0.237,"4|4|5|1":0.219,"4|4|5|2":0.188,"4|4|6|1":0.25,"4|4|7|1":0.309,"4|5|2|1":0.23,"4|5|2|2":0.21,"4|5|2|3":0.208,"4|5|3|1":0.25,"4|5|3|2":0.246,"4|5|3|3":0.162,"4|5|4|1":0.242,"4|5|4|2":0.302,"4|5|4|3":0.2,"4|5|5|1":0.231,"4|5|5|2":0.233,"4|5|5|3":0.196,"4|5|6|1":0.269,"4|5|6|2":0.265,"4|5|7|1":0.431,"4|5|8|1":0.303,"4|5|9|1":0.46,"4|6|0|1":0.286,"4|6|1|1":0.12,"4|6|1|2":0.063,"4|6|1|3":0.107,"4|6|2|1":0.244,"4|6|2|2":0.205,"4|6|2|3":0.176,"4|6|3|1":0.284,"4|6|3|2":0.266,"4|6|3|3":0.209,"4|6|3|4":0.171,"4|6|4|1":0.285,"4|6|4|2":0.278,"4|6|4|3":0.262,"4|6|5|1":0.286,"4|6|5|2":0.297,"4|6|5|3":0.29,"4|6|6|1":0.323,"4|6|6|2":0.283,"4|6|6|3":0.237,"4|6|7|1":0.385,"4|6|7|2":0.369,"4|6|7|3":0.289,"4|6|8|1":0.405,"4|6|8|2":0.436,"4|6|8|3":0.407,"4|6|9|1":0.421,"4|6|9|2":0.457,"4|6|9|3":0.4,"5|1|2|1":0.037,"5|2|2|1":0.256,"5|3|2|1":0.268,"5|3|2|2":0.184,"5|3|3|1":0.225,"5|3|3|2":0.214,"5|3|4|1":0.167,"5|3|5|1":0.5,"5|4|1|1":0.333,"5|4|2|1":0.336,"5|4|2|2":0.361,"5|4|2|3":0.337,"5|4|3|1":0.339,"5|4|3|2":0.355,"5|4|3|3":0.267,"5|4|4|1":0.466,"5|4|4|2":0.411,"5|4|4|3":0.438,"5|4|5|1":0.395,"5|4|5|2":0.393,"5|4|5|3":0.267,"5|4|6|1":0.491,"5|4|6|2":0.5,"5|4|6|3":0.617,"5|4|7|1":0.529,"5|4|7|2":0.417,"5|4|8|1":0.567,"5|4|8|2":0.608,"5|4|8|3":0.54,"5|4|9|1":0.55,"5|4|9|2":0.455,"5|5|2|1":0.3,"5|5|2|2":0.357,"5|5|2|3":0.324,"5|5|3|1":0.359,"5|5|3|2":0.317,"5|5|3|3":0.296,"5|5|4|1":0.324,"5|5|4|2":0.362,"5|5|4|3":0.39,"5|5|5|1":0.411,"5|5|5|2":0.42,"5|5|5|3":0.357,"5|5|6|1":0.37,"5|5|6|2":0.351,"5|5|6|3":0.28,"5|5|7|1":0.368,"5|5|7|2":0.244,"5|5|8|1":0.481,"5|5|8|2":0.5,"5|5|9|1":0.429,"5|5|9|2":0.556,"5|6|1|1":0.215,"5|6|1|2":0.204,"5|6|1|3":0.211,"5|6|2|1":0.322,"5|6|2|2":0.324,"5|6|2|3":0.315,"5|6|3|1":0.338,"5|6|3|2":0.315,"5|6|3|3":0.286,"5|6|4|1":0.354,"5|6|4|2":0.316,"5|6|4|3":0.283,"5|6|5|1":0.373,"5|6|5|2":0.43,"5|6|5|3":0.429,"5|6|6|1":0.432,"5|6|6|2":0.374,"5|6|6|3":0.416,"5|6|7|1":0.38,"5|6|7|2":0.394,"5|6|7|3":0.447,"5|6|8|1":0.467,"5|6|8|2":0.413,"5|6|8|3":0.345,"5|6|9|1":0.444,"5|6|9|2":0.405,"5|6|9|3":0.361,"6|1|2|1":0.157,"6|1|4|1":0.333,"6|2|2|1":0.333,"6|2|3|1":0.464,"6|3|2|1":0.373,"6|3|2|2":0.224,"6|3|3|1":0.511,"6|3|3|2":0.618,"6|3|4|1":0.5,"6|3|5|1":0.344,"6|3|5|2":0.382,"6|3|5|3":0.267,"6|3|6|1":0.56,"6|3|7|1":0.4,"6|4|1|1":0.393,"6|4|2|1":0.343,"6|4|2|2":0.367,"6|4|2|3":0.329,"6|4|3|1":0.368,"6|4|3|2":0.351,"6|4|3|3":0.284,"6|4|4|1":0.422,"6|4|4|2":0.402,"6|4|4|3":0.289,"6|4|5|1":0.563,"6|4|5|2":0.5,"6|4|5|3":0.395,"6|4|6|1":0.596,"6|4|6|2":0.508,"6|4|6|3":0.622,"6|4|7|1":0.491,"6|4|7|2":0.574,"6|4|7|3":0.515,"6|4|8|1":0.63,"6|4|8|2":0.625,"6|4|9|1":0.605,"6|4|9|2":0.517,"6|5|1|1":0.407,"6|5|2|1":0.487,"6|5|2|2":0.427,"6|5|2|3":0.391,"6|5|3|1":0.496,"6|5|3|2":0.511,"6|5|3|3":0.51,"6|5|4|1":0.606,"6|5|4|2":0.519,"6|5|4|3":0.548,"6|5|5|1":0.608,"6|5|5|2":0.507,"6|5|5|3":0.439,"6|5|6|1":0.581,"6|5|6|2":0.569,"6|5|6|3":0.4,"6|5|7|1":0.616,"6|5|7|2":0.513,"6|5|7|3":0.554,"6|5|8|1":0.649,"6|5|8|2":0.643,"6|5|9|1":0.69,"6|6|0|1":0.387,"6|6|1|1":0.402,"6|6|1|2":0.385,"6|6|1|3":0.357,"6|6|2|1":0.44,"6|6|2|2":0.383,"6|6|2|3":0.374,"6|6|3|1":0.479,"6|6|3|2":0.468,"6|6|3|3":0.426,"6|6|3|4":0.455,"6|6|4|1":0.498,"6|6|4|2":0.464,"6|6|4|3":0.4,"6|6|5|1":0.512,"6|6|5|2":0.502,"6|6|5|3":0.509,"6|6|6|1":0.514,"6|6|6|2":0.513,"6|6|6|3":0.5,"6|6|7|1":0.576,"6|6|7|2":0.536,"6|6|7|3":0.563,"6|6|8|1":0.569,"6|6|8|2":0.583,"6|6|8|3":0.528,"6|6|9|1":0.559,"6|6|9|2":0.535,"6|6|9|3":0.471,"7|3|2|1":0.678,"7|3|2|2":0.74,"7|3|3|1":0.483,"7|3|3|2":0.517,"7|4|2|1":0.561,"7|4|2|2":0.578,"7|4|3|1":0.588,"7|4|3|2":0.529,"7|4|4|1":0.612,"7|4|4|2":0.545,"7|4|4|3":0.5,"7|4|5|1":0.663,"7|4|5|2":0.729,"7|4|6|1":0.75,"7|4|6|2":0.635,"7|4|7|1":0.714,"7|4|7|2":0.654,"7|4|8|1":0.677,"7|4|8|2":0.731,"7|5|2|1":0.565,"7|5|2|2":0.53,"7|5|2|3":0.451,"7|5|3|1":0.556,"7|5|3|2":0.642,"7|5|3|3":0.643,"7|5|4|1":0.692,"7|5|4|2":0.637,"7|5|4|3":0.545,"7|5|5|1":0.58,"7|5|5|2":0.647,"7|5|5|3":0.667,"7|5|6|1":0.673,"7|5|6|2":0.667,"7|5|7|1":0.74,"7|5|7|2":0.71,"7|5|8|1":0.742,"7|5|8|2":0.75,"7|5|9|1":0.703,"7|6|0|1":0.516,"7|6|0|2":0.472,"7|6|0|3":0.341,"7|6|1|1":0.541,"7|6|1|2":0.518,"7|6|1|3":0.481,"7|6|2|1":0.509,"7|6|2|2":0.506,"7|6|2|3":0.477,"7|6|3|1":0.553,"7|6|3|2":0.512,"7|6|3|3":0.492,"7|6|3|4":0.457,"7|6|4|1":0.575,"7|6|4|2":0.556,"7|6|4|3":0.53,"7|6|4|4":0.582,"7|6|5|1":0.594,"7|6|5|2":0.581,"7|6|5|3":0.541,"7|6|5|4":0.573,"7|6|6|1":0.634,"7|6|6|2":0.591,"7|6|6|3":0.548,"7|6|6|4":0.4,"7|6|7|1":0.643,"7|6|7|2":0.623,"7|6|7|3":0.608,"7|6|8|1":0.665,"7|6|8|2":0.649,"7|6|8|3":0.604,"7|6|9|1":0.728,"7|6|9|2":0.71,"7|6|9|3":0.727,"7|6|9|4":0.821,"8|3|2|1":0.84,"8|3|2|2":0.806,"8|3|3|1":0.69,"8|3|3|2":0.667,"8|3|4|1":0.725,"8|3|4|2":0.75,"8|3|4|3":0.615,"8|3|5|1":0.847,"8|3|6|1":0.788,"8|3|8|1":0.931,"8|4|2|1":0.658,"8|4|2|2":0.62,"8|4|2|3":0.643,"8|4|3|1":0.713,"8|4|3|2":0.649,"8|4|3|3":0.633,"8|4|4|1":0.747,"8|4|4|2":0.746,"8|4|4|3":0.639,"8|4|5|1":0.739,"8|4|5|2":0.774,"8|4|5|3":0.778,"8|4|6|1":0.821,"8|4|6|2":0.841,"8|4|7|1":0.827,"8|4|7|2":0.837,"8|4|7|3":0.719,"8|4|8|1":0.84,"8|4|8|2":0.833,"8|4|8|3":0.759,"8|4|9|1":0.891,"8|4|9|2":0.875,"8|5|2|1":0.679,"8|5|2|2":0.627,"8|5|2|3":0.625,"8|5|3|1":0.629,"8|5|3|2":0.694,"8|5|3|3":0.613,"8|5|4|1":0.684,"8|5|4|2":0.712,"8|5|4|3":0.675,"8|5|5|1":0.657,"8|5|5|2":0.776,"8|5|5|3":0.73,"8|5|6|1":0.742,"8|5|6|2":0.514,"8|5|7|1":0.713,"8|5|7|2":0.795,"8|5|8|1":0.797,"8|5|8|2":0.706,"8|5|9|1":0.833,"8|5|9|2":0.786,"8|6|0|1":0.475,"8|6|1|1":0.604,"8|6|1|2":0.545,"8|6|1|3":0.581,"8|6|2|1":0.615,"8|6|2|2":0.653,"8|6|2|3":0.635,"8|6|3|1":0.704,"8|6|3|2":0.667,"8|6|3|3":0.601,"8|6|4|1":0.666,"8|6|4|2":0.627,"8|6|4|3":0.63,"8|6|5|1":0.679,"8|6|5|2":0.68,"8|6|5|3":0.603,"8|6|6|1":0.739,"8|6|6|2":0.718,"8|6|6|3":0.653,"8|6|7|1":0.767,"8|6|7|2":0.708,"8|6|7|3":0.667,"8|6|8|1":0.814,"8|6|8|2":0.819,"8|6|8|3":0.75,"8|6|9|1":0.801,"8|6|9|2":0.807,"8|6|9|3":0.781,"9|3|2|1":0.8,"9|3|2|2":0.692,"9|3|3|1":0.839,"9|3|3|2":0.828,"9|3|4|1":1,"9|3|5|1":0.84,"9|3|7|1":0.92,"9|4|2|1":0.788,"9|4|2|2":0.761,"9|4|2|3":0.739,"9|4|3|1":0.841,"9|4|3|2":0.809,"9|4|3|3":0.756,"9|4|4|1":0.788,"9|4|4|2":0.782,"9|4|4|3":0.8,"9|4|5|1":0.823,"9|4|5|2":0.766,"9|4|6|1":0.82,"9|4|6|2":0.816,"9|4|6|3":0.64,"9|4|7|1":0.887,"9|4|7|2":0.878,"9|4|7|3":0.9,"9|4|8|1":0.867,"9|4|8|2":0.875,"9|4|8|3":0.846,"9|4|9|1":0.945,"9|4|9|2":0.917,"9|4|9|3":0.857,"9|5|2|1":0.799,"9|5|2|2":0.784,"9|5|2|3":0.76,"9|5|3|1":0.663,"9|5|3|2":0.795,"9|5|3|3":0.671,"9|5|4|1":0.803,"9|5|4|2":0.742,"9|5|4|3":0.73,"9|5|5|1":0.816,"9|5|5|2":0.75,"9|5|5|3":0.679,"9|5|6|1":0.863,"9|5|6|2":0.83,"9|5|6|3":0.796,"9|5|7|1":0.921,"9|5|7|2":0.905,"9|5|7|3":0.92,"9|5|8|1":0.951,"9|5|8|2":0.929,"9|5|9|1":0.933,"9|5|9|2":0.906,"9|6|1|1":0.689,"9|6|1|2":0.652,"9|6|1|3":0.528,"9|6|2|1":0.746,"9|6|2|2":0.736,"9|6|2|3":0.71,"9|6|3|1":0.766,"9|6|3|2":0.704,"9|6|3|3":0.703,"9|6|4|1":0.807,"9|6|4|2":0.784,"9|6|4|3":0.725,"9|6|5|1":0.811,"9|6|5|2":0.816,"9|6|5|3":0.772,"9|6|6|1":0.832,"9|6|6|2":0.827,"9|6|6|3":0.789,"9|6|7|1":0.83,"9|6|7|2":0.818,"9|6|7|3":0.803,"9|6|8|1":0.863,"9|6|8|2":0.85,"9|6|8|3":0.886,"9|6|9|1":0.884,"9|6|9|2":0.908,"9|6|9|3":0.777};
const _MFF_WP_TABLE_MID  = {"0|0|2":0,"0|0|3":0,"0|0|4":0,"0|0|5":0,"0|0|6":0,"0|0|8":0,"0|0|9":0,"0|1|1":0,"0|1|2":0,"0|1|3":0,"0|1|4":0,"0|1|5":0,"0|1|6":0,"0|1|7":0,"0|1|8":0,"0|1|9":0,"0|2|1":0,"0|2|2":0,"0|2|3":0,"0|2|4":0,"0|2|5":0,"0|2|6":0,"0|2|7":0,"0|2|8":0,"0|2|9":0,"0|3|1":0,"0|3|2":0,"0|3|3":0,"0|3|4":0,"0|3|5":0,"0|3|6":0,"0|3|7":0,"0|3|8":0,"0|3|9":0,"0|4|0":0,"0|4|1":0,"0|4|2":0.007,"0|4|3":0.007,"0|4|4":0.007,"0|4|5":0.021,"0|4|6":0.014,"0|4|7":0.016,"0|4|8":0.031,"0|4|9":0.059,"0|5|1":0,"0|5|2":0.012,"0|5|3":0.005,"0|5|4":0.023,"0|5|5":0.009,"0|5|6":0,"0|5|7":0.009,"0|5|8":0.042,"0|5|9":0.023,"0|6|1":0.075,"0|6|2":0.04,"0|6|3":0.023,"0|6|4":0.022,"0|6|5":0.02,"0|6|6":0.077,"0|6|7":0.04,"0|6|8":0.049,"0|6|9":0.047,"10|2|2":1,"10|2|4":0.931,"10|2|5":0.919,"10|2|6":1,"10|3|2":0.839,"10|3|3":0.882,"10|3|4":0.974,"10|3|5":1,"10|3|6":0.956,"10|4|1":0.741,"10|4|2":0.89,"10|4|3":0.927,"10|4|4":0.892,"10|4|5":0.964,"10|4|6":0.918,"10|4|7":0.937,"10|4|8":0.957,"10|4|9":1,"10|5|2":0.842,"10|5|3":0.847,"10|5|4":0.864,"10|5|5":0.913,"10|5|6":0.916,"10|5|7":0.886,"10|5|8":0.978,"10|5|9":0.986,"10|6|0":0.804,"10|6|1":0.765,"10|6|2":0.768,"10|6|3":0.816,"10|6|4":0.831,"10|6|5":0.873,"10|6|6":0.829,"10|6|7":0.846,"10|6|8":0.893,"10|6|9":0.922,"11|3|2":0.921,"11|3|3":1,"11|3|4":0.929,"11|3|5":1,"11|3|6":1,"11|3|8":1,"11|4|2":1,"11|4|3":0.988,"11|4|4":0.976,"11|4|5":0.981,"11|4|6":1,"11|4|7":1,"11|4|8":1,"11|4|9":1,"11|5|2":0.948,"11|5|3":0.93,"11|5|4":1,"11|5|5":1,"11|5|6":1,"11|5|7":0.97,"11|5|8":1,"11|6|2":0.893,"11|6|3":0.813,"11|6|4":0.913,"11|6|5":0.868,"11|6|6":0.854,"11|6|7":0.938,"11|6|8":0.972,"11|6|9":0.911,"12|1|4":1,"12|1|5":1,"12|2|2":0.967,"12|2|3":1,"12|2|4":1,"12|2|5":1,"12|2|6":1,"12|2|7":1,"12|2|8":1,"12|2|9":1,"12|3|0":1,"12|3|1":0.948,"12|3|2":0.989,"12|3|3":0.995,"12|3|4":0.988,"12|3|5":1,"12|3|6":1,"12|3|7":1,"12|3|8":1,"12|3|9":1,"12|4|0":0.966,"12|4|1":0.949,"12|4|2":0.951,"12|4|3":0.957,"12|4|4":0.948,"12|4|5":0.974,"12|4|6":0.975,"12|4|7":0.981,"12|4|8":0.979,"12|4|9":0.961,"12|5|0":0.864,"12|5|1":0.894,"12|5|2":0.905,"12|5|3":0.916,"12|5|4":0.908,"12|5|5":0.922,"12|5|6":0.964,"12|5|7":0.951,"12|5|8":0.912,"12|5|9":0.969,"12|6|0":0.772,"12|6|1":0.79,"12|6|2":0.88,"12|6|3":0.884,"12|6|4":0.866,"12|6|5":0.908,"12|6|6":0.905,"12|6|7":0.9,"12|6|8":0.933,"12|6|9":0.965,"13|3|2":1,"13|4|2":1,"13|4|3":0.981,"13|4|4":0.955,"13|4|5":0.97,"13|4|6":0.984,"13|4|7":0.946,"13|4|8":0.939,"13|4|9":1,"13|5|2":0.929,"13|5|3":0.923,"13|5|4":0.855,"13|5|5":0.977,"13|5|6":1,"13|5|7":1,"13|5|8":0.967,"13|5|9":1,"13|6|2":0.971,"13|6|3":0.968,"13|6|4":0.933,"13|6|5":0.815,"13|6|8":0.821,"14|1|2":1,"14|1|4":1,"14|1|5":1,"14|1|6":1,"14|1|7":1,"14|2|1":1,"14|2|2":1,"14|2|3":1,"14|2|4":1,"14|2|5":1,"14|2|6":1,"14|2|7":1,"14|2|8":1,"14|2|9":1,"14|3|0":1,"14|3|1":1,"14|3|2":1,"14|3|3":1,"14|3|4":1,"14|3|5":1,"14|3|6":1,"14|3|7":1,"14|3|8":1,"14|3|9":1,"14|4|0":1,"14|4|1":1,"14|4|2":1,"14|4|3":1,"14|4|4":1,"14|4|5":1,"14|4|6":1,"14|4|7":1,"14|4|8":1,"14|4|9":1,"14|5|0":0.889,"14|5|1":1,"14|5|2":0.993,"14|5|3":0.996,"14|5|4":0.992,"14|5|5":0.996,"14|5|6":1,"14|5|7":1,"14|5|8":1,"14|5|9":1,"14|6|1":1,"14|6|2":0.986,"14|6|3":0.967,"14|6|4":0.964,"14|6|5":0.938,"14|6|6":0.95,"14|6|7":0.942,"14|6|8":0.98,"14|6|9":0.983,"1|1|3":0,"1|1|5":0,"1|1|6":0,"1|2|2":0,"1|2|3":0,"1|2|4":0,"1|3|2":0,"1|3|3":0.027,"1|3|4":0.029,"1|3|5":0.056,"1|3|6":0,"1|3|7":0,"1|4|2":0,"1|4|3":0.014,"1|4|4":0.026,"1|4|5":0.015,"1|4|6":0,"1|4|7":0.054,"1|5|2":0.052,"1|5|3":0.094,"1|5|4":0.078,"1|5|5":0.1,"1|5|6":0.068,"1|5|7":0.065,"1|6|2":0.138,"1|6|3":0.027,"1|6|4":0.1,"1|6|5":0.063,"1|6|6":0.071,"1|6|7":0.185,"2|0|5":0,"2|1|1":0,"2|1|2":0,"2|1|3":0,"2|1|4":0,"2|1|5":0.01,"2|1|6":0.027,"2|1|7":0.08,"2|1|8":0,"2|1|9":0.036,"2|2|1":0,"2|2|2":0.007,"2|2|3":0.025,"2|2|4":0.03,"2|2|5":0.027,"2|2|6":0.02,"2|2|7":0,"2|2|8":0,"2|2|9":0.04,"2|3|1":0.016,"2|3|2":0.002,"2|3|3":0.033,"2|3|4":0.006,"2|3|5":0.041,"2|3|6":0.013,"2|3|7":0.105,"2|3|8":0.159,"2|3|9":0.106,"2|4|0":0.063,"2|4|1":0.037,"2|4|2":0.054,"2|4|3":0.073,"2|4|4":0.078,"2|4|5":0.115,"2|4|6":0.121,"2|4|7":0.127,"2|4|8":0.19,"2|4|9":0.219,"2|5|0":0.036,"2|5|1":0.091,"2|5|2":0.089,"2|5|3":0.123,"2|5|4":0.1,"2|5|5":0.109,"2|5|6":0.091,"2|5|7":0.175,"2|5|8":0.121,"2|5|9":0.07,"2|6|0":0.118,"2|6|1":0.093,"2|6|2":0.117,"2|6|3":0.141,"2|6|4":0.165,"2|6|5":0.134,"2|6|6":0.161,"2|6|7":0.163,"2|6|8":0.143,"2|6|9":0.15,"3|3|2":0.1,"3|3|3":0.063,"3|3|4":0.086,"3|3|7":0.069,"3|4|1":0.08,"3|4|2":0.025,"3|4|3":0,"3|4|4":0.047,"3|4|5":0.085,"3|4|6":0.214,"3|5|2":0.028,"3|5|3":0,"3|5|4":0.034,"3|5|5":0.031,"3|5|6":0,"3|6|2":0.165,"3|6|3":0.19,"3|6|4":0.267,"3|6|5":0.307,"3|6|6":0.278,"3|6|7":0.267,"3|6|8":0.25,"3|6|9":0.266,"4|1|2":0.011,"4|1|5":0.232,"4|2|2":0,"4|2|4":0.12,"4|2|7":0.077,"4|3|2":0.055,"4|3|3":0.143,"4|3|4":0.267,"4|3|5":0.067,"4|3|6":0.194,"4|3|7":0.038,"4|4|1":0.179,"4|4|2":0.174,"4|4|3":0.223,"4|4|4":0.25,"4|4|5":0.202,"4|4|6":0.239,"4|4|7":0.3,"4|4|8":0.286,"4|4|9":0.395,"4|5|1":0.25,"4|5|2":0.22,"4|5|3":0.235,"4|5|4":0.246,"4|5|5":0.229,"4|5|6":0.266,"4|5|7":0.388,"4|5|8":0.318,"4|5|9":0.377,"4|6|0":0.321,"4|6|1":0.096,"4|6|2":0.223,"4|6|3":0.257,"4|6|4":0.275,"4|6|5":0.294,"4|6|6":0.29,"4|6|7":0.356,"4|6|8":0.417,"4|6|9":0.425,"5|0|3":0.038,"5|1|2":0.039,"5|1|3":0.179,"5|1|4":0.113,"5|1|5":0.188,"5|1|6":0.211,"5|1|7":0.419,"5|1|8":0.5,"5|2|2":0.224,"5|2|3":0.346,"5|2|4":0.389,"5|2|5":0.333,"5|2|6":0.484,"5|2|9":0.517,"5|3|2":0.226,"5|3|3":0.188,"5|3|4":0.18,"5|3|5":0.371,"5|3|6":0.404,"5|3|7":0.57,"5|3|8":0.323,"5|3|9":0.529,"5|4|1":0.295,"5|4|2":0.346,"5|4|3":0.327,"5|4|4":0.433,"5|4|5":0.364,"5|4|6":0.524,"5|4|7":0.458,"5|4|8":0.575,"5|4|9":0.489,"5|5|1":0.354,"5|5|2":0.319,"5|5|3":0.332,"5|5|4":0.349,"5|5|5":0.402,"5|5|6":0.344,"5|5|7":0.287,"5|5|8":0.491,"5|5|9":0.467,"5|6|0":0.186,"5|6|1":0.21,"5|6|2":0.322,"5|6|3":0.314,"5|6|4":0.33,"5|6|5":0.399,"5|6|6":0.412,"5|6|7":0.395,"5|6|8":0.417,"5|6|9":0.415,"6|0|2":0,"6|0|5":0.179,"6|1|2":0.129,"6|1|3":0.233,"6|1|4":0.313,"6|1|5":0.571,"6|1|6":0.67,"6|1|7":0.625,"6|1|8":0.813,"6|1|9":0.763,"6|2|1":0.423,"6|2|2":0.367,"6|2|3":0.443,"6|2|4":0.375,"6|2|5":0.675,"6|2|6":0.449,"6|2|7":0.556,"6|2|9":0.648,"6|3|2":0.315,"6|3|3":0.524,"6|3|4":0.449,"6|3|5":0.328,"6|3|6":0.377,"6|3|7":0.432,"6|3|8":0.5,"6|3|9":0.686,"6|4|1":0.355,"6|4|2":0.348,"6|4|3":0.345,"6|4|4":0.389,"6|4|5":0.508,"6|4|6":0.57,"6|4|7":0.525,"6|4|8":0.614,"6|4|9":0.584,"6|5|1":0.342,"6|5|2":0.454,"6|5|3":0.506,"6|5|4":0.557,"6|5|5":0.538,"6|5|6":0.539,"6|5|7":0.575,"6|5|8":0.626,"6|5|9":0.65,"6|6|0":0.404,"6|6|1":0.384,"6|6|2":0.413,"6|6|3":0.464,"6|6|4":0.462,"6|6|5":0.515,"6|6|6":0.511,"6|6|7":0.556,"6|6|8":0.564,"6|6|9":0.526,"7|1|2":0.565,"7|1|4":0.588,"7|1|5":0.68,"7|1|7":0.879,"7|2|2":0.459,"7|2|3":0.471,"7|2|4":0.542,"7|2|5":0.643,"7|2|6":0.828,"7|3|2":0.704,"7|3|3":0.527,"7|3|4":0.663,"7|3|5":0.651,"7|3|6":0.526,"7|3|7":0.696,"7|3|8":0.92,"7|4|1":0.5,"7|4|2":0.552,"7|4|3":0.549,"7|4|4":0.558,"7|4|5":0.664,"7|4|6":0.676,"7|4|7":0.678,"7|4|8":0.679,"7|4|9":0.839,"7|5|1":0.487,"7|5|2":0.536,"7|5|3":0.605,"7|5|4":0.632,"7|5|5":0.627,"7|5|6":0.618,"7|5|7":0.724,"7|5|8":0.711,"7|5|9":0.711,"7|6|0":0.473,"7|6|1":0.521,"7|6|2":0.503,"7|6|3":0.523,"7|6|4":0.559,"7|6|5":0.578,"7|6|6":0.597,"7|6|7":0.628,"7|6|8":0.646,"7|6|9":0.725,"8|2|2":0.554,"8|2|3":0.754,"8|2|4":0.886,"8|2|5":0.893,"8|2|6":0.875,"8|2|7":0.93,"8|2|8":0.931,"8|2|9":1,"8|3|1":0.464,"8|3|2":0.832,"8|3|3":0.678,"8|3|4":0.693,"8|3|5":0.796,"8|3|6":0.684,"8|3|7":0.646,"8|3|8":0.915,"8|3|9":0.8,"8|4|1":0.654,"8|4|2":0.641,"8|4|3":0.675,"8|4|4":0.729,"8|4|5":0.748,"8|4|6":0.797,"8|4|7":0.807,"8|4|8":0.819,"8|4|9":0.887,"8|5|1":0.532,"8|5|2":0.657,"8|5|3":0.644,"8|5|4":0.691,"8|5|5":0.715,"8|5|6":0.661,"8|5|7":0.758,"8|5|8":0.768,"8|5|9":0.786,"8|6|0":0.493,"8|6|1":0.578,"8|6|2":0.628,"8|6|3":0.672,"8|6|4":0.646,"8|6|5":0.664,"8|6|6":0.71,"8|6|7":0.723,"8|6|8":0.803,"8|6|9":0.799,"9|2|2":0.909,"9|2|3":0.975,"9|2|4":1,"9|2|5":0.923,"9|2|6":0.891,"9|2|7":0.974,"9|3|2":0.753,"9|3|3":0.816,"9|3|4":0.968,"9|3|5":0.813,"9|3|6":0.981,"9|3|7":0.927,"9|3|8":0.85,"9|3|9":0.942,"9|4|1":0.889,"9|4|2":0.765,"9|4|3":0.807,"9|4|4":0.795,"9|4|5":0.768,"9|4|6":0.785,"9|4|7":0.884,"9|4|8":0.865,"9|4|9":0.902,"9|5|0":0.705,"9|5|1":0.704,"9|5|2":0.789,"9|5|3":0.715,"9|5|4":0.763,"9|5|5":0.765,"9|5|6":0.84,"9|5|7":0.915,"9|5|8":0.94,"9|5|9":0.907,"9|6|0":0.474,"9|6|1":0.632,"9|6|2":0.734,"9|6|3":0.73,"9|6|4":0.781,"9|6|5":0.804,"9|6|6":0.814,"9|6|7":0.824,"9|6|8":0.861,"9|6|9":0.87};
const _MFF_WP_TABLE_COARSE = {"0|0":0,"0|1":0,"0|2":0,"0|3":0,"0|4":0.014,"0|5":0.012,"0|6":0.037,"10|0":1,"10|1":1,"10|2":0.947,"10|3":0.918,"10|4":0.92,"10|5":0.889,"10|6":0.834,"11|0":1,"11|1":1,"11|2":1,"11|3":0.978,"11|4":0.992,"11|5":0.973,"11|6":0.892,"12|0":1,"12|1":1,"12|2":0.995,"12|3":0.993,"12|4":0.963,"12|5":0.923,"12|6":0.89,"13|0":1,"13|1":1,"13|2":1,"13|3":0.942,"13|4":0.969,"13|5":0.94,"13|6":0.889,"14|0":1,"14|1":1,"14|2":1,"14|3":1,"14|4":1,"14|5":0.995,"14|6":0.965,"1|0":0,"1|1":0,"1|2":0.006,"1|3":0.015,"1|4":0.02,"1|5":0.097,"1|6":0.102,"2|0":0,"2|1":0.013,"2|2":0.016,"2|3":0.043,"2|4":0.098,"2|5":0.106,"2|6":0.141,"3|0":0,"3|1":0.085,"3|2":0.089,"3|3":0.109,"3|4":0.059,"3|5":0.039,"3|6":0.23,"4|0":0.092,"4|1":0.126,"4|2":0.09,"4|3":0.159,"4|4":0.233,"4|5":0.255,"4|6":0.283,"5|0":0.051,"5|1":0.224,"5|2":0.352,"5|3":0.311,"5|4":0.413,"5|5":0.357,"5|6":0.353,"6|0":0.201,"6|1":0.453,"6|2":0.486,"6|3":0.416,"6|4":0.449,"6|5":0.521,"6|6":0.479,"7|0":0.53,"7|1":0.732,"7|2":0.634,"7|3":0.649,"7|4":0.62,"7|5":0.616,"7|6":0.57,"8|0":1,"8|1":0.955,"8|2":0.842,"8|3":0.735,"8|4":0.736,"8|5":0.685,"8|6":0.682,"9|0":1,"9|1":1,"9|2":0.953,"9|3":0.859,"9|4":0.817,"9|5":0.8,"9|6":0.78};
function _mffSDBucket(d) {
  if (d <= -17) return 0; if (d <= -15) return 1; if (d <= -9) return 2;
  if (d === -8) return 3; if (d === -7) return 4; if (d >= -6 && d <= -4) return 5;
  if (d >= -3 && d <= -1) return 6; if (d === 0) return 7;
  if (d >= 1 && d <= 3) return 8; if (d >= 4 && d <= 6) return 9;
  if (d === 7) return 10; if (d === 8) return 11;
  if (d >= 9 && d <= 14) return 12; if (d >= 15 && d <= 16) return 13;
  return 14;
}
function _mffTLBucket(s) {
  if (s <= 30) return 0; if (s <= 120) return 1; if (s <= 300) return 2;
  if (s <= 600) return 3; if (s <= 1200) return 4; if (s <= 1800) return 5;
  return 6;
}
function _mffSecondsLeft(q, t) {
  if (q >= 5) return 0;   // OT — treat as endpoint
  return (4 - q) * 900 + Math.max(0, t || 0);
}
function _mffWP(sd, sl, yl, down) {
  if (typeof yl !== "number" || !(down >= 1 && down <= 4)) return 0.5;
  const sdB = _mffSDBucket(sd), tlB = _mffTLBucket(sl), ylB = _mffEPYardBucket(yl);
  const k1 = sdB+"|"+tlB+"|"+ylB+"|"+down;
  if (_MFF_WP_TABLE_FULL[k1] != null) return _MFF_WP_TABLE_FULL[k1];
  const k2 = sdB+"|"+tlB+"|"+ylB;
  if (_MFF_WP_TABLE_MID[k2] != null) return _MFF_WP_TABLE_MID[k2];
  const k3 = sdB+"|"+tlB;
  if (_MFF_WP_TABLE_COARSE[k3] != null) return _MFF_WP_TABLE_COARSE[k3];
  return 0.5;
}
// KNOWN LIMITATION (documented in MFF.md): the empirical WP table has
// natural bucket-cell noise (e.g. MID "5|3|7"=0.57 looks too high for
// "down 4-6 with 5-10min in opp-30s"), and it's NOT perfectly anti-
// symmetric — states arising from "down trying to come back" have
// different empirical base rates than the mirror "leading trying to
// hold on" states. This causes Σ-WPA-across-teams ≈ 9 over a 17-game
// season instead of exactly 0, and lowers team-WPA ↔ wins from the
// theoretical r≈1.0 to r≈0.55 in practice. The PROPER fix is to refit
// the bake as a smoothed logistic / gradient-boosted model (instead of
// raw lookups); for now the metric is shipped with the noise documented.
// Per-play WPA / Player-of-the-Game / signature plays are not materially
// affected — the noise washes out at single-game scale; only multi-game
// aggregates show the bias.

// Football Outsiders success-rate definition (replaces the positive-EPA
// proxy from Slice B). A play is "successful" if it converts enough of
// yards-to-go for its down:
//   1st down: gain ≥ 40% of ytg
//   2nd down: gain ≥ 60% of ytg
//   3rd/4th:  gain ≥ 100% (conversion or score)
// Sacks/INTs are never successful. Score-on-this-play overrides as
// successful regardless of yardage.
function _mffIsSuccess(c, scoredOnThisPlay) {
  if (scoredOnThisPlay) return true;
  if (c.k === "int" || c.k === "sack") return false;
  if (c.k === "incomplete") return false;
  const need = c.d === 1 ? c.y * 0.4
            : c.d === 2 ? c.y * 0.6
            : c.y;
  return (c.yd || 0) >= need;
}

// ── MFF CPOE — Completion Percentage Over Expected ───────────────────
// CPOE = actual_completion - expected_completion, where the expected
// model is SKILL-FREE BY CONSTRUCTION (depends only on throw difficulty:
// targetDepth + pressure, NOT on the QB). This is the whole point —
// CPOE measures what the QB beats expectation by. If we let QB skill
// into the expected model, CPOE would collapse to ~0 for everyone.
//
// Baked from a 2-season round-robin (_mff_bake_xcomp.js). 6 cells.
//
// ENGINE NOTE: in this engine, pressure barely affects completion rate
// (short clean 75.2% vs short pressured 76.7% — opposite of NFL where
// pressure drops completion ~15pts). So CPOE here primarily reflects
// QB DEPTH-SELECTION + accuracy, not pressure-handling. Documented in
// MFF.md as a candidate for future xPressure recalibration (engine fix,
// would need its own A/B gate).
const _MFF_XCOMP_TABLE = {"0|0":0.7517,"0|1":0.767,"1|0":0.6283,"1|1":0.6354,"2|0":0.4041,"2|1":0.4155};
function _mffDepthBucket(td)  { if (td <= 5) return 0; if (td <= 15) return 1; return 2; }
function _mffPressBucket(pr)  { const a = Math.abs(pr || 0); if (a < 0.3) return 0; if (a < 1.0) return 1; return 2; }
function _mffXComp(td, pr) {
  if (typeof td !== "number") return null;
  const k = _mffDepthBucket(td) + "|" + _mffPressBucket(pr);
  // Heavy-pressure cells (pressB=2) weren't sampled in the bake; fall back
  // to the matching depth's pressured-bucket value.
  if (_MFF_XCOMP_TABLE[k] != null) return _MFF_XCOMP_TABLE[k];
  const fb = _mffDepthBucket(td) + "|1";
  return _MFF_XCOMP_TABLE[fb] ?? null;
}

// EPA aggregator. Walks the current season's playLog, builds team and
// per-player tallies. Returns { team:{tid:{epa,wpa,plays,...,sr,srP,srR}},
// qb:Map(name → {epa,wpa,db,suc,xComp,actComp,attComp}),
// rec:Map(name → {epa,wpa,rec,suc}),  rb:Map(name → {epa,wpa,att,suc}),
// totals:{pPass,pRun,ePass,eRun,wPass,wRun,succP,succR,topPlays} }.
//
// EPA(play) = EP_after - EP_before. Score attribution follows _mff_epa.js
// (the audit's logic, empirically validated to produce the textbook EP
// gradient + sensible QB/WR EPA correlations): a score event is recorded
// at the FIRST PLAY where the running score has changed, then for snap c
// we look for the next score whose index is strictly greater than c's and
// at-or-before c's next snap's index. This matches the engine's score-
// timestamp convention (the TD play carries the BEFORE-score; the next
// drive's snap carries the AFTER-score).
//
// End-of-game scores are handled via the __g marker's hf/af (final scores),
// captured in markGamePlayed — without that, a walk-off TD would get no
// EP_after credit because there's no "next snap" in the log to compare.
function _mffComputeEPA() {
  const empty = { team: {}, qb: new Map(), rec: new Map(), rb: new Map(),
                  totals:{pPass:0, pRun:0, ePass:0, eRun:0, wPass:0, wRun:0, succP:0, succR:0, plays:0},
                  topPlays: [], bestPerGame: [] };
  if (!franchise) return empty;
  const season = franchise.season ?? 1;
  const log = franchise.playLog?.[season];
  if (!Array.isArray(log) || !log.length) return empty;
  const teamByHomeAway = (poss, g) => g[poss === "home" ? "homeId" : "awayId"];
  const bump = (map, key, init) => { let r = map.get(key); if (!r){r=init();map.set(key,r);} return r; };
  const out = empty;
  // Top-plays buffer: keep best |WPA| plays for the signature-plays leader-
  // board. Cap to a sane size (200) so a long franchise can't bloat memory.
  // We track only |wpa|>0.05 plays — Q1 dump-offs aren't "signature" by any
  // definition. Final sort happens once at the end.
  const TOPN_SEASON = 200, WPA_NOISE_FLOOR = 0.05;
  const topPool = [];

  let curMeta = null;
  let i = 0;
  let gameIdx = -1;
  while (i < log.length) {
    if (log[i] && log[i].__g) { curMeta = log[i]; gameIdx++; i++; continue; }
    let end = i;
    while (end < log.length && !log[end].__g) end++;
    const game = log.slice(i, end);
    if (game.length) {
      // Build score events: a score is recorded at the first snap whose
      // running hs/as exceeds the previously-seen running pair.
      let runH = 0, runA = 0;
      const scores = []; // {atIdx, team, pts, half}
      for (let j = 0; j < game.length; j++) {
        const c = game[j];
        if ((c.hs|0) !== runH || (c.as|0) !== runA) {
          const team = (c.hs|0) > runH ? "home" : "away";
          const pts  = Math.abs(((c.hs|0) - runH) || ((c.as|0) - runA));
          scores.push({ atIdx: j, team, pts, half: c.q <= 2 ? 1 : 2 });
          runH = c.hs|0; runA = c.as|0;
        }
      }
      // End-of-game safety net: if the meta's final score exceeds the last
      // seen running, the closing TD/FG happened ON or AFTER the last
      // scrimmage snap (e.g. a walk-off). Record it as a synthetic event
      // anchored past the last play, then credit the last play of the
      // scoring offense — that matches the audit's "credit the play that
      // got you here" convention.
      if (curMeta && curMeta.hf != null && curMeta.af != null) {
        const lastSnap = game[game.length - 1];
        if (curMeta.hf > runH || curMeta.af > runA) {
          const team = curMeta.hf > runH ? "home" : "away";
          const pts  = Math.abs((curMeta.hf - runH) || (curMeta.af - runA));
          scores.push({ atIdx: game.length, team, pts, half: lastSnap.q <= 2 ? 1 : 2 });
        }
      }
      let gameBest = null;   // {wpa, epa, c, j} for Player of the Game
      for (let j = 0; j < game.length; j++) {
        const c = game[j];
        const next = game[j+1];
        const half = c.q <= 2 ? 1 : 2;
        // ─── EPA ─── score that fires between c and next.
        let scored = null;
        for (const sc of scores) {
          const inWindow = sc.atIdx > j && (!next || sc.atIdx <= j + 1);
          if (inWindow && sc.half === half) { scored = sc; break; }
        }
        const epB = _mffEP(c.d, c.y, c.yl);
        let epA;
        if (scored) {
          epA = scored.team === c.p ? scored.pts : -scored.pts;
        } else if (next && (next.q <= 2 ? 1 : 2) === half) {
          const nextEP = _mffEP(next.d, next.y, next.yl);
          epA = next.p === c.p ? nextEP : -nextEP;
        } else {
          epA = 0;
        }
        const epa = epA - epB;
        // ─── WPA ─── WP_before/after, from OFFENSE's perspective.
        // WP doesn't reset across halves (unlike EP) — the clock just keeps
        // ticking — so we use next snap regardless of half boundary.
        const sl = _mffSecondsLeft(c.q, c.t);
        const sdOff = c.p === "home" ? ((c.hs|0) - (c.as|0)) : ((c.as|0) - (c.hs|0));
        const wpB = _mffWP(sdOff, sl, c.yl, c.d);
        let wpA;
        if (next) {
          const slN = _mffSecondsLeft(next.q, next.t);
          // sd for the NEXT snap's offense (whoever has the ball at next).
          const sdNextOff = next.p === "home" ? ((next.hs|0) - (next.as|0)) : ((next.as|0) - (next.hs|0));
          const wpNextOff = _mffWP(sdNextOff, slN, next.yl, next.d);
          // If poss didn't flip, next snap's WP IS our WP. If it flipped
          // (TD+kickoff, turnover), our WP is 1 - their WP.
          wpA = next.p === c.p ? wpNextOff : (1 - wpNextOff);
        } else if (curMeta && curMeta.hf != null && curMeta.af != null) {
          // End of game (no next snap in this game). Two cases:
          // (a) The play CAUSED the deciding score (final hf/af differs
          //     from c.hs/as — the play scored, or led to a defensive
          //     score / made-FG before time ran out). Use actual outcome.
          // (b) The play did NOT change the final score — it was just
          //     the last snap before the clock expired (e.g. kneel-down
          //     when up, a low-WP comeback attempt that failed without
          //     more scoring). Use WP_before as the proxy (no swing).
          // Without (b), every team's last play of a loss took the full
          // -0.5 WPA hit even when the loss was already locked in pre-
          // play — that broke the team WPA ↔ wins correlation.
          const scoredOnThis = curMeta.hf !== (c.hs|0) || curMeta.af !== (c.as|0);
          if (scoredOnThis) {
            const off = c.p === "home" ? curMeta.hf : curMeta.af;
            const def = c.p === "home" ? curMeta.af : curMeta.hf;
            wpA = off > def ? 1 : off < def ? 0 : 0.5;
          } else {
            wpA = wpB;
          }
        } else {
          wpA = wpB;
        }
        const wpa = wpA - wpB;
        // ─── Success rate (real Football Outsiders definition) ───
        const scoredByOff = scored && scored.team === c.p;
        const success = _mffIsSuccess(c, scoredByOff);
        // ─── Team aggregates ───
        const offTid = curMeta ? teamByHomeAway(c.p, curMeta) : null;
        const defTid = curMeta ? teamByHomeAway(c.p === "home" ? "away" : "home", curMeta) : null;
        if (offTid != null) {
          const t = out.team[offTid] = out.team[offTid] || { epa:0, wpa:0, plays:0, suc:0, epa_def:0, wpa_def:0, plays_def:0, suc_def:0 };
          t.epa += epa; t.wpa += wpa; t.plays++; if (success) t.suc++;
        }
        if (defTid != null) {
          const t = out.team[defTid] = out.team[defTid] || { epa:0, wpa:0, plays:0, suc:0, epa_def:0, wpa_def:0, plays_def:0, suc_def:0 };
          // Defense's WPA is the NEGATIVE of the offense's (zero-sum: a play
          // that adds 5% to off's WP subtracts 5% from def's).
          t.epa_def += epa; t.wpa_def += (-wpa); t.plays_def++; if (success) t.suc_def++;
        }
        out.totals.plays++;
        if (_MFF_EPA_PASS_KIND.has(c.k)) {
          out.totals.pPass++; out.totals.ePass += epa; out.totals.wPass += wpa;
          if (success) out.totals.succP++;
          if (c.qb) {
            const q = bump(out.qb, c.qb, () => ({epa:0, wpa:0, db:0, suc:0, xComp:0, actComp:0, attComp:0}));
            q.epa += epa; q.wpa += wpa; q.db++; if (success) q.suc++;
            // CPOE: only counted on actual completion attempts (complete or
            // incomplete with a measurable targetDepth). Sacks and INTs are
            // not accuracy events — exclude. Underthrown incompletes ARE.
            if ((c.k === "complete" || c.k === "incomplete") && typeof c.td === "number") {
              const xc = _mffXComp(c.td, c.pr || 0);
              if (xc != null) {
                q.xComp   += xc;
                q.actComp += (c.k === "complete" ? 1 : 0);
                q.attComp += 1;
              }
            }
          }
          if (c.k === "complete" && c.rc) {
            const r = bump(out.rec, c.rc, () => ({epa:0, wpa:0, rec:0, suc:0}));
            r.epa += epa; r.wpa += wpa; r.rec++; if (success) r.suc++;
          }
        } else {
          out.totals.pRun++; out.totals.eRun += epa; out.totals.wRun += wpa;
          if (success) out.totals.succR++;
          if (c.ru) { const r = bump(out.rb, c.ru, () => ({epa:0, wpa:0, att:0, suc:0})); r.epa += epa; r.wpa += wpa; r.att++; if (success) r.suc++; }
        }
        // Top-swings + Player-of-the-Game tracking.
        if (Math.abs(wpa) >= WPA_NOISE_FLOOR) {
          topPool.push({ gameIdx, j, wpa: +wpa.toFixed(3), epa: +epa.toFixed(2),
            poss: c.p, offTid, defTid, week: curMeta?.week,
            qb: c.qb, rc: c.rc, ru: c.ru, k: c.k, yd: c.yd,
            q: c.q, t: c.t, hs: c.hs, as: c.as, d: c.d, y: c.y, yl: c.yl });
        }
        if (wpa > 0 && (!gameBest || wpa > gameBest.wpa)) {
          gameBest = { wpa, epa, c, poss: c.p, offTid, defTid };
        }
      }
      if (gameBest) {
        out.bestPerGame.push({
          gameIdx, week: curMeta?.week,
          homeId: curMeta?.homeId, awayId: curMeta?.awayId,
          wpa: +gameBest.wpa.toFixed(3), epa: +gameBest.epa.toFixed(2),
          poss: gameBest.poss, offTid: gameBest.offTid,
          name: gameBest.c.qb || gameBest.c.rc || gameBest.c.ru,
          k: gameBest.c.k, yd: gameBest.c.yd,
        });
      }
    }
    i = end;
  }
  topPool.sort((a, b) => Math.abs(b.wpa) - Math.abs(a.wpa));
  out.topPlays = topPool.slice(0, TOPN_SEASON);
  return out;
}

// Cache: rebuild only when the playLog changes (new game merged or season
// change). Key: (season, week, total log length).
const _MFF_EPA_CACHE = { key: null, data: null };
function _mffGetEPA() {
  if (!franchise) return null;
  const season = franchise.season ?? 0;
  const len = (franchise.playLog?.[season] || []).length;
  const k = season + ":" + (franchise.week ?? 0) + ":" + len;
  if (_MFF_EPA_CACHE.key !== k) {
    _MFF_EPA_CACHE.data = _mffComputeEPA();
    _MFF_EPA_CACHE.key = k;
  }
  return _MFF_EPA_CACHE.data;
}

// Player-level EPA lookup — used by the chip renderer.
function mffEPAFor(name) {
  if (!franchise || !name) return null;
  const e = _mffGetEPA();
  if (!e) return null;
  if (e.qb.has(name))  return { kind: "qb",  ...e.qb.get(name) };
  if (e.rec.has(name)) return { kind: "rec", ...e.rec.get(name) };
  if (e.rb.has(name))  return { kind: "rb",  ...e.rb.get(name) };
  return null;
}

// Team-level EPA + WPA + success rate (off + def). null only when there's
// truly no data. Either side may be null if that side hasn't accumulated
// plays. Per-play rates for EPA/WPA; success rate as 0-1 fraction.
function mffTeamEPA(teamId) {
  if (!franchise || teamId == null) return null;
  const e = _mffGetEPA();
  const t = e?.team?.[teamId];
  if (!t || (!t.plays && !t.plays_def)) return null;
  return {
    off:    t.plays     ? (t.epa     / t.plays)     : null,
    def:    t.plays_def ? (t.epa_def / t.plays_def) : null,
    wpaOff: t.plays     ? (t.wpa     / t.plays)     : null,
    wpaDef: t.plays_def ? (t.wpa_def / t.plays_def) : null,
    srOff:  t.plays     ? (t.suc     / t.plays)     : null,
    srDef:  t.plays_def ? (t.suc_def / t.plays_def) : null,
    plays: t.plays, plays_def: t.plays_def,
    // Cumulative totals — useful for season-long "clutch" comparison.
    wpaSumOff: t.wpa, wpaSumDef: t.wpa_def,
  };
}

// Top WPA plays of the season (signature-plays leaderboard) + Player of
// the Game per game. Returns the cached raw arrays directly — UI is
// responsible for rendering. Each topPlay record carries enough context
// (down/ytg/yardLine/clock) to render a one-line broadcast description.
function mffTopPlays(limit = 25) {
  const e = _mffGetEPA();
  return e?.topPlays?.slice(0, limit) || [];
}
function mffPlayerOfGame(gameIdx) {
  const e = _mffGetEPA();
  return e?.bestPerGame?.find(g => g.gameIdx === gameIdx) || null;
}
function mffAllPlayerOfGame() {
  return _mffGetEPA()?.bestPerGame || [];
}

// Chip block for a player's EPA — empty string if no qualifying activity.
// Designed to slot into _buildStatScopeBlock alongside mffGradeChipsHtml.
// Per the audit validation:
//   QB:  EPA/dropback is the headline (r ↔ OVR = 0.45)
//   WR:  TOTAL EPA is the WR signal (r ↔ OVR = 0.51); per-rec is noisy
//   RB:  TOTAL EPA shown, but RB EPA is weak by design (audit r = 0.16,
//        matching the analytics consensus that RB output isn't very
//        individually determinative)
function mffPlayerEPAChipsHtml(p) {
  if (!p) return "";
  const r = mffEPAFor(p.name);
  if (!r) return "";
  const fmtSigned = v => (v >= 0 ? "+" : "") + v.toFixed(2);
  const fmtSignedSum = v => (v >= 0 ? "+" : "") + v.toFixed(1);
  const fmtPct = v => (v * 100).toFixed(0) + "%";
  // Hue: positive = green tier, negative = red tier. Use existing tier
  // classes for consistency with gradeBadge styling.
  const tierFromEPA = v => v >= 0.20 ? "a" : v >= 0.05 ? "b" : v >= -0.05 ? "c" : v >= -0.20 ? "d" : "f";
  // WPA tier: per-play WP swing is small, so the bands are tighter.
  // ~0.01/play is elite, ~0.003 is good, near-zero is average.
  const tierFromWPA = v => v >= 0.010 ? "a" : v >= 0.003 ? "b" : v >= -0.003 ? "c" : v >= -0.010 ? "d" : "f";
  // Success rate (FO definition) — NFL avg ~45%, elite ~55%+, poor <40%.
  const tierFromSR  = v => v >= 0.55 ? "a" : v >= 0.48 ? "b" : v >= 0.42 ? "c" : v >= 0.36 ? "d" : "f";
  const chip = (txt, tier, tip) =>
    `<span class="tt-ovr tier-${tier}" title="${tip}" style="margin-right:.35rem">${txt}</span>`;
  const chips = [];
  if (r.kind === "qb" && r.db >= 10) {
    const perDb = r.epa / r.db;
    const wpaPerDb = r.wpa / r.db;
    const srRate = r.suc / r.db;
    chips.push(chip("EPA/DB " + fmtSigned(perDb), tierFromEPA(perDb),
      `Expected points added per dropback · ${r.db} dropbacks`));
    chips.push(chip("WPA " + fmtSignedSum(r.wpa), tierFromWPA(wpaPerDb),
      `Win-probability added (clutch index) · ${(wpaPerDb*100).toFixed(2)}% per dropback`));
    chips.push(chip("SR " + fmtPct(srRate), tierFromSR(srRate),
      `Success rate (Football Outsiders): 1st-down 40% of YTG, 2nd-down 60%, 3rd/4th 100%. NFL avg ~45%.`));
    // CPOE chip — only if we have enough completion attempts to be stable.
    // Threshold matches QB attempts in our engine (~30 attempts/game * 5 games ≈ 150).
    if (r.attComp >= 30) {
      const cpoe = (r.actComp - r.xComp) / r.attComp;
      const tierFromCPOE = v => v >= 0.04 ? "a" : v >= 0.01 ? "b" : v >= -0.01 ? "c" : v >= -0.04 ? "d" : "f";
      const sign = cpoe >= 0 ? "+" : "";
      chips.push(chip("CPOE " + sign + (cpoe * 100).toFixed(1) + "%", tierFromCPOE(cpoe),
        `Completion % Over Expected · skill-free baseline accounts for throw depth + pressure · ${r.attComp} attempts`));
    }
  } else if (r.kind === "rec" && r.rec >= 5) {
    const perRec = r.epa / r.rec;
    const srRate = r.suc / r.rec;
    chips.push(chip("EPA " + fmtSignedSum(r.epa), tierFromEPA(perRec * 2),
      `Total receiving EPA · ${r.rec} catches (per-rec efficiency is QB/scheme-driven, not a clean WR signal)`));
    chips.push(chip("WPA " + fmtSignedSum(r.wpa), tierFromWPA(r.wpa / r.rec / 2),
      `Total win-probability added on catches · ${r.rec} catches`));
    chips.push(chip("SR " + fmtPct(srRate), tierFromSR(srRate),
      `Success rate on catches (FO definition)`));
  } else if (r.kind === "rb" && r.att >= 10) {
    const perAtt = r.epa / r.att;
    const srRate = r.suc / r.att;
    chips.push(chip("EPA " + fmtSignedSum(r.epa), tierFromEPA(perAtt * 3),
      `Total rushing EPA · ${r.att} attempts (RB EPA is a weak signal — audit r=0.16; supplement with film)`));
    chips.push(chip("WPA " + fmtSignedSum(r.wpa), tierFromWPA(r.wpa / r.att / 2),
      `Total win-probability added on carries · ${r.att} attempts`));
    chips.push(chip("SR " + fmtPct(srRate), tierFromSR(srRate),
      `Rushing success rate (FO definition)`));
  }
  if (!chips.length) return "";
  return `<div style="margin-top:.5rem;padding-top:.4rem;border-top:1px dashed var(--border)">
    <div class="frn-card-title" style="margin-bottom:.25rem">EPA · WPA · SR <span style="opacity:.6;font-weight:normal">(efficiency · leverage · consistency)</span></div>
    <div style="display:flex;flex-wrap:wrap">${chips.join("")}</div>
  </div>`;
}

// ── MFF DVOA-style opponent adjustment ──────────────────────────────
// Raw EPA/play tells you how a team did. ADJUSTED EPA tells you how good
// they ACTUALLY are — beating a top defense for +0.05 EPA/play is much
// better than beating a bad defense for +0.10. Standard adjustment:
// iteratively subtract opponent strength (weighted by per-game play
// counts). Converges in 3-4 passes for a 32-team league.
//
// Algorithm (Massey-style iterative):
//   For each iteration:
//     1. Compute league averages (will be ≈0 after first pass; zero-sum).
//     2. For each team T:
//        adj_off[T] = raw_off[T] - (mean opponent def EPA, weighted by
//                                   plays T ran vs that opp) + league_def
//        adj_def[T] = raw_def[T] - (mean opponent off EPA, weighted by
//                                   plays T defended vs that opp) + league_off
//     3. Use updated adj_* as the next iteration's "opponent strength".
// After convergence, adj_off/def represent each team's EPA performance
// LEAGUE-AVERAGE-OPPONENT-NORMALIZED — directly comparable across teams.
function _mffComputeDVOA(maxIter = 4) {
  const e = _mffGetEPA();
  if (!e) return null;
  const teams = Object.keys(e.team).map(Number);
  if (teams.length < 2) return null;
  // Build per-team-pair play counts from the __g markers in playLog.
  const log = franchise.playLog?.[franchise.season ?? 1] || [];
  // oppPlays[T][O] = {off:N, def:M}  — T ran N off plays vs O, defended M of O's off plays.
  const oppPlays = {};
  let curMeta = null;
  for (const entry of log) {
    if (entry?.__g) { curMeta = entry; continue; }
    if (!curMeta || !entry.p) continue;
    const offTid = curMeta[entry.p === "home" ? "homeId" : "awayId"];
    const defTid = curMeta[entry.p === "home" ? "awayId" : "homeId"];
    if (offTid == null || defTid == null) continue;
    (oppPlays[offTid] = oppPlays[offTid] || {})[defTid] = oppPlays[offTid][defTid] || {off:0, def:0};
    (oppPlays[defTid] = oppPlays[defTid] || {})[offTid] = oppPlays[defTid][offTid] || {off:0, def:0};
    oppPlays[offTid][defTid].off++;
    oppPlays[defTid][offTid].def++;
  }
  // Raw rates per team
  const raw = {};
  for (const tid of teams) {
    const t = e.team[tid];
    raw[tid] = {
      off: t.plays     ? (t.epa     / t.plays)     : 0,
      def: t.plays_def ? (t.epa_def / t.plays_def) : 0,
    };
  }
  // Iterate.
  let cur = Object.fromEntries(teams.map(t => [t, {off: raw[t].off, def: raw[t].def}]));
  for (let iter = 0; iter < maxIter; iter++) {
    let leagueOff = 0, leagueDef = 0;
    for (const t of teams) { leagueOff += cur[t].off; leagueDef += cur[t].def; }
    leagueOff /= teams.length; leagueDef /= teams.length;
    const nxt = {};
    for (const t of teams) {
      const opps = oppPlays[t] || {};
      let sosDef = 0, totOff = 0, sosOff = 0, totDef = 0;
      for (const o of Object.keys(opps)) {
        const oid = +o;
        if (cur[oid] == null) continue;
        sosDef += cur[oid].def * opps[o].off; totOff += opps[o].off;
        sosOff += cur[oid].off * opps[o].def; totDef += opps[o].def;
      }
      sosDef = totOff ? sosDef / totOff : leagueDef;
      sosOff = totDef ? sosOff / totDef : leagueOff;
      nxt[t] = {
        off:    raw[t].off - (sosDef - leagueDef),
        def:    raw[t].def - (sosOff - leagueOff),
        sosOff: sosOff,    // opponents' offensive strength T faced (defensive SOS)
        sosDef: sosDef,    // opponents' defensive strength T faced (offensive SOS)
      };
    }
    cur = nxt;
  }
  return cur;
}
const _MFF_DVOA_CACHE = { key: null, data: null };
function mffTeamDVOA(teamId) {
  if (!franchise || teamId == null) return null;
  const season = franchise.season ?? 0;
  const len = (franchise.playLog?.[season] || []).length;
  const k = season + ":" + (franchise.week ?? 0) + ":" + len;
  if (_MFF_DVOA_CACHE.key !== k) {
    _MFF_DVOA_CACHE.data = _mffComputeDVOA();
    _MFF_DVOA_CACHE.key = k;
  }
  return _MFF_DVOA_CACHE.data?.[teamId] || null;
}

// Team EPA + Success Rate rows for the win-prob matchup compare block.
// Returns "" if no data yet (week 1 pre-game, etc.) — render falls back
// gracefully. Each side may be null (e.g. team played only home games this
// season) — show "—" for missing sides so the row still renders.
// WPA is per-game-leverage; team WPA totals would just track wins/losses
// (each team's net WPA over a season ≈ (wins - losses) / 2), so we OMIT
// per-team WPA from the matchup block to avoid double-counting record.
// Success Rate is the consistency complement to EPA's per-play efficiency.
function mffTeamEPAStatRows(myId, oppId, statRow) {
  if (!franchise || !statRow) return "";
  const my   = mffTeamEPA(myId);
  const opp  = mffTeamEPA(oppId);
  if (!my && !opp) return "";
  const myA  = mffTeamDVOA(myId);
  const oppA = mffTeamDVOA(oppId);
  const fmt    = v => v == null ? "—" : ((v >= 0 ? "+" : "") + v.toFixed(2));
  const fmtPct = v => v == null ? "—" : (v * 100).toFixed(0) + "%";
  // Use ADJUSTED EPA as the primary stat (more predictive — accounts for
  // opponent strength). Raw EPA is still useful context — show both rows.
  // Off: higher is better. Def: lower (more negative) is better.
  let rows = "";
  if (myA || oppA) {
    rows += statRow("ADJ EPA/PLAY (OFF)", fmt(myA?.off), fmt(oppA?.off), true);
    rows += statRow("ADJ EPA/PLAY (DEF)", fmt(myA?.def), fmt(oppA?.def), false);
  } else {
    // Pre-DVOA fallback (week 1, very few games)
    rows += statRow("EPA/PLAY (OFF)", fmt(my?.off), fmt(opp?.off), true);
    rows += statRow("EPA/PLAY (DEF)", fmt(my?.def), fmt(opp?.def), false);
  }
  rows += statRow("SUCCESS RATE", fmtPct(my?.srOff), fmtPct(opp?.srOff), true);
  return rows;
}

// Strength-of-schedule summary for a team (the SOS values that drove the
// DVOA adjustment). +0.10 sosDef means opposing defenses averaged +0.10
// EPA/play allowed (weak defenses you faced); negative = tough schedule.
function mffTeamSOS(teamId) {
  const d = mffTeamDVOA(teamId);
  if (!d) return null;
  return { sosOff: d.sosOff, sosDef: d.sosDef };
}

// ── MFF Slice H: production-based development boost ─────────────────
// Returns a multiplier in [0.80, 1.20] applied alongside coachBoost in the
// offseason dev pass. Elite-production players get a small dev tailwind;
// underperformers get a headwind. The metric used depends on position:
//   QB:     EPA/dropback        (Slice B's QB ↔ OVR r=0.47 signal)
//   WR/TE:  total EPA on catches (Slice B's WR ↔ OVR r=0.61)
//   RB:     total EPA on carries (weak signal — small magnitudes only)
//   DL/OL/CB/LB: MFF grade       (Slice A position-group standardized)
// Players with no production data (rookies, didn't play) get 1.0.
// BOUNDED INTENTIONALLY: we don't want a "MVP grows 2x" runaway loop.
// ±20% × the existing coachBoost cap of 2.0× = max ~2.4× total per offseason,
// which is realistic for the absolute best-case scenario (elite producer +
// great staff + coachable trait + captains).
function _mffProductionBoost(p, season) {
  if (!p || !p.name) return 1.0;
  // Try live EPA first (current season's playLog still present at the time
  // dev runs — frnNewSeason freezes summary AFTER dev). Fall back to the
  // frozen summary if the log was already dropped.
  const fromLive = (typeof mffEPAFor === "function") ? mffEPAFor(p.name) : null;
  if (fromLive) {
    if (fromLive.kind === "qb" && fromLive.db >= 50) {
      const epaPerDb = fromLive.epa / fromLive.db;
      if (epaPerDb >=  0.15) return 1.20;
      if (epaPerDb >=  0.05) return 1.10;
      if (epaPerDb >= -0.05) return 1.00;
      if (epaPerDb >= -0.15) return 0.92;
      return 0.85;
    }
    if (fromLive.kind === "rec" && fromLive.rec >= 20) {
      if (fromLive.epa >=  25) return 1.15;
      if (fromLive.epa >=  10) return 1.08;
      if (fromLive.epa >= -10) return 1.00;
      return 0.92;
    }
    if (fromLive.kind === "rb" && fromLive.att >= 60) {
      if (fromLive.epa >=  15) return 1.10;
      if (fromLive.epa >=   5) return 1.05;
      if (fromLive.epa >= -15) return 1.00;
      return 0.93;
    }
  }
  // Defensive grades: use MFF grade if available (Slice A surface).
  // _mffComputeLeagueGrades returns standardized 0-99 grades per player.
  if (typeof _mffComputeLeagueGrades === "function") {
    try {
      const grades = _mffComputeLeagueGrades();
      const g = grades?.[p.name];
      if (g) {
        // Combined grade for OL/DL (pass + run); single grade for CB/LB.
        const v = g.combinedGrade ?? g.coverGrade ?? g.passRushGrade ?? g.runStuffGrade ?? g.passProGrade ?? g.runBlockGrade;
        if (typeof v === "number" && v > 0) {
          if (v >= 85) return 1.15;
          if (v >= 72) return 1.06;
          if (v >= 50) return 1.00;
          if (v >= 35) return 0.92;
          return 0.85;
        }
      }
    } catch (e) { /* defensive — never block dev */ }
  }
  return 1.0;
}

// ─── Slice F: live WP curve + Player-of-the-Game + signature plays ──
// All read-only — consume the per-play log + the WPA buffers Slice C
// already populates. UI helpers return ready-to-insert HTML (or null if
// no data); composition into the post-game / season-stats blocks happens
// in the existing render functions.

// Find a game's playLog slice + per-snap WP from the user's perspective.
// Returns null if the game isn't in the log (legacy game pre-Slice-B,
// or playoff game which Slice B skips capturing).
//
// MEMOIZED: this gets called from mffPostGameWPBlock which runs on every
// dashboard render. A naive call walks the entire playLog (~33k entries
// mid-season) just to find the game's __g marker, costing 5-30ms per
// render. The cache is keyed on (gameKey, season, playLog length) — the
// only things that can change the curve. Single memo slot since the UI
// only ever queries the user's most-recent game.
const _MFF_WPCURVE_CACHE = { key: null, data: null };
function mffGameWPCurve(homeId, awayId, week, userTeamId) {
  if (!franchise) return null;
  const log = franchise.playLog?.[franchise.season ?? 1];
  if (!Array.isArray(log) || !log.length) return null;
  const k = (franchise.season ?? 1) + ":" + log.length + ":" + homeId + ":" + awayId + ":" + (week ?? "*") + ":" + userTeamId;
  if (_MFF_WPCURVE_CACHE.key === k) return _MFF_WPCURVE_CACHE.data;
  // Find the __g marker matching this game.
  let i = 0, found = null;
  while (i < log.length) {
    const m = log[i];
    if (m?.__g && m.homeId === homeId && m.awayId === awayId
        && (week == null || m.week === week)) {
      found = { meta: m, start: i + 1 };
      break;
    }
    i++;
  }
  if (!found) { _MFF_WPCURVE_CACHE.key = k; _MFF_WPCURVE_CACHE.data = null; return null; }
  // Slice until next __g or end of log.
  let end = found.start;
  while (end < log.length && !log[end].__g) end++;
  const game = log.slice(found.start, end);
  if (!game.length) { _MFF_WPCURVE_CACHE.key = k; _MFF_WPCURVE_CACHE.data = null; return null; }
  // Build the WP curve from the user's team's perspective. WP per snap is
  // computed from the offense's side; if user IS the offense, that's
  // user's WP; otherwise mirror via 1 - wp.
  const isUserHome = found.meta.homeId === userTeamId;
  const isUserAway = found.meta.awayId === userTeamId;
  if (!isUserHome && !isUserAway) { _MFF_WPCURVE_CACHE.key = k; _MFF_WPCURVE_CACHE.data = null; return null; }
  const userSide = isUserHome ? "home" : "away";
  const curve = [];
  // Kickoff baseline — start at 0.5.
  curve.push({ x: 0, wp: 0.5, label: "Kickoff" });
  for (let j = 0; j < game.length; j++) {
    const c = game[j];
    const sl = _mffSecondsLeft(c.q, c.t);
    const x = 3600 - sl;   // elapsed regulation seconds
    // sd from CURRENT offense's perspective.
    const offSd = c.p === "home" ? ((c.hs|0) - (c.as|0)) : ((c.as|0) - (c.hs|0));
    const offWp = _mffWP(offSd, sl, c.yl, c.d);
    const userWp = c.p === userSide ? offWp : (1 - offWp);
    curve.push({ x, wp: userWp });
  }
  // Endpoint — actual outcome.
  if (found.meta.hf != null && found.meta.af != null) {
    const userScore = isUserHome ? found.meta.hf : found.meta.af;
    const oppScore  = isUserHome ? found.meta.af : found.meta.hf;
    const endWp = userScore > oppScore ? 1 : userScore < oppScore ? 0 : 0.5;
    curve.push({ x: 3600, wp: endWp, label: "Final" });
  }
  _MFF_WPCURVE_CACHE.key = k;
  _MFF_WPCURVE_CACHE.data = curve;
  return curve;
}

// Render the WP curve as a compact SVG sparkline. ~320×60 by default.
// Userline drawn on top; quarter dividers + 50% baseline for reference.
function mffWPCurveSvg(curve, opts = {}) {
  if (!Array.isArray(curve) || curve.length < 2) return "";
  const w = opts.width || 320, h = opts.height || 60, pad = opts.pad || 4;
  const userColor = opts.color || "var(--green-lt)";
  const innerW = w - 2 * pad, innerH = h - 2 * pad;
  // Points
  const pts = curve.map(p => ({
    px: pad + (p.x / 3600) * innerW,
    py: pad + (1 - p.wp) * innerH,
  }));
  const path = pts.map((p, i) => (i === 0 ? `M${p.px.toFixed(1)} ${p.py.toFixed(1)}` : `L${p.px.toFixed(1)} ${p.py.toFixed(1)}`)).join(" ");
  // Fill below the curve, semi-transparent green where above 50%, red where below.
  // For simplicity render two overlaid filled regions clipped at midline.
  const mid = pad + 0.5 * innerH;
  // Quarter dividers
  const qx1 = pad + 0.25 * innerW;
  const qx2 = pad + 0.50 * innerW;
  const qx3 = pad + 0.75 * innerW;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block">
    <rect x="0" y="0" width="${w}" height="${h}" fill="rgba(0,0,0,0.10)" rx="3"/>
    <line x1="${pad}" y1="${mid}" x2="${w-pad}" y2="${mid}" stroke="rgba(255,255,255,0.15)" stroke-dasharray="2 3"/>
    <line x1="${qx1}" y1="${pad}" x2="${qx1}" y2="${h-pad}" stroke="rgba(255,255,255,0.08)"/>
    <line x1="${qx2}" y1="${pad}" x2="${qx2}" y2="${h-pad}" stroke="rgba(255,255,255,0.15)"/>
    <line x1="${qx3}" y1="${pad}" x2="${qx3}" y2="${h-pad}" stroke="rgba(255,255,255,0.08)"/>
    <path d="${path}" fill="none" stroke="${userColor}" stroke-width="1.8" stroke-linejoin="round"/>
    <text x="${qx1}" y="${h-1}" font-size="6" fill="rgba(255,255,255,0.35)" text-anchor="middle">Q2</text>
    <text x="${qx2}" y="${h-1}" font-size="6" fill="rgba(255,255,255,0.35)" text-anchor="middle">HALF</text>
    <text x="${qx3}" y="${h-1}" font-size="6" fill="rgba(255,255,255,0.35)" text-anchor="middle">Q4</text>
  </svg>`;
}

// Player-of-the-Game callout for a specific game. Pulls from the WPA
// walker's bestPerGame array. Returns "" if no data (e.g. playoff game).
function mffPlayerOfGameFor(homeId, awayId, week) {
  const all = mffAllPlayerOfGame();
  if (!all || !all.length) return "";
  // Match on homeId/awayId/week — gameIdx isn't stable across loads.
  const potg = all.find(g =>
    g.homeId === homeId && g.awayId === awayId &&
    (week == null || g.week === week));
  if (!potg) return "";
  const kindBlurb = potg.k === "complete" ? `${potg.yd}-yd reception`
                  : potg.k === "run"      ? `${potg.yd}-yd run`
                  : potg.k === "sack"     ? "sack"
                  : potg.k === "int"      ? "interception"
                  : potg.k;
  const sign = potg.wpa >= 0 ? "+" : "";
  const wpaPct = (potg.wpa * 100).toFixed(1);
  return `<div style="margin-top:.4rem;padding:.45rem .6rem;border:1px dashed var(--border);border-radius:6px;background:rgba(245,197,66,0.04)">
    <div style="font-size:.6rem;letter-spacing:.6px;color:var(--gold);font-weight:700">⭐ PLAYER OF THE GAME (BIGGEST WPA SWING)</div>
    <div style="margin-top:.15rem">
      <span style="font-weight:700">${potg.name}</span>
      <span style="opacity:.7"> · ${kindBlurb} · WPA ${sign}${wpaPct}%</span>
    </div>
  </div>`;
}

// Season "biggest swings" leaderboard. Default 10 entries.
function mffSeasonTopSwingsHtml(limit = 10) {
  const top = mffTopPlays(limit);
  if (!top || !top.length) return "";
  const rows = top.map((p, i) => {
    const name = (p.qb || p.rc || p.ru || "?");
    const clock = `Q${p.q} ${Math.floor(p.t/60)}:${String(p.t%60).padStart(2,"0")}`;
    const kindBlurb = p.k === "complete" ? "completion"
                    : p.k === "run"      ? "run"
                    : p.k === "sack"     ? "sack"
                    : p.k === "int"      ? "interception"
                    : p.k === "incomplete" ? "incomplete"
                    : p.k;
    const sign = p.wpa >= 0 ? "+" : "";
    const wpaPct = (p.wpa * 100).toFixed(1);
    const wpaColor = p.wpa >= 0 ? "var(--green-lt)" : "var(--red)";
    return `<div style="display:flex;align-items:center;gap:.5rem;padding:.25rem .35rem;border-bottom:1px solid rgba(255,255,255,0.04);font-size:.7rem">
      <span style="color:var(--gray);width:1.5rem;text-align:right">${i+1}.</span>
      <span style="color:var(--gray);width:3.5rem;font-variant-numeric:tabular-nums">${clock}</span>
      <span style="flex:1;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</span>
      <span style="opacity:.7;width:5rem">${kindBlurb} ${p.yd>=0?"+":""}${p.yd}yd</span>
      <span style="font-weight:700;color:${wpaColor};width:4rem;text-align:right;font-variant-numeric:tabular-nums">WPA ${sign}${wpaPct}%</span>
    </div>`;
  }).join("");
  return `<div style="margin-top:.5rem;padding:.4rem .5rem;border:1px solid var(--border);border-radius:6px">
    <div style="font-size:.62rem;letter-spacing:.6px;color:var(--gray);font-weight:700;margin-bottom:.25rem">
      ⚡ BIGGEST SWINGS · TOP ${top.length} PLAYS OF THE SEASON
    </div>
    ${rows}
  </div>`;
}

// Compact WP-chart block for the post-game recap. Builds the curve for
// the user's just-played game (most recent played game where chosenTeamId
// was on either side) and pairs it with the PotG callout. Returns "" if
// no playable data (legacy save, playoff game pre-rollover, etc.).
// MEMOIZED: runs on every dashboard render via _buildPostGameHeadline.
// Caching the full HTML string (SVG + PotG callout included) means a
// dashboard re-render between games costs ~0.1ms instead of 5-30ms.
// Cache key: (userTeamId, season, playLog length, recent-game-week).
// playLog length is the change-trigger (new game played → new entry → key
// changes → recompute). userTeamId guards against the rare load-into-
// different-team case.
const _MFF_POSTGAME_CACHE = { key: null, data: "" };
function mffPostGameWPBlock(userTeamId) {
  if (!franchise) return "";
  const season = franchise.season ?? 1;
  const logLen = (franchise.playLog?.[season] || []).length;
  // Find the most recent played game for this team (max week, played=true).
  const schedule = franchise.schedule || [];
  let g = null;
  for (const x of schedule) {
    if (!x.played) continue;
    if (x.homeId !== userTeamId && x.awayId !== userTeamId) continue;
    if (!g || x.week > g.week) g = x;
  }
  if (!g) return "";
  const k = userTeamId + ":" + season + ":" + logLen + ":" + g.week;
  if (_MFF_POSTGAME_CACHE.key === k) return _MFF_POSTGAME_CACHE.data;
  const curve = mffGameWPCurve(g.homeId, g.awayId, g.week, userTeamId);
  if (!curve) { _MFF_POSTGAME_CACHE.key = k; _MFF_POSTGAME_CACHE.data = ""; return ""; }
  const teamColor = (typeof getTeam === "function") ? (getTeam(userTeamId)?.primary || "var(--green-lt)") : "var(--green-lt)";
  const potg = mffPlayerOfGameFor(g.homeId, g.awayId, g.week);
  const html = `<div style="margin-top:.5rem;padding:.5rem .6rem;border:1px solid var(--border);border-radius:6px;background:rgba(0,0,0,0.06)">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.25rem">
      <span style="font-size:.62rem;letter-spacing:.6px;color:var(--gray);font-weight:700">WIN PROBABILITY · YOUR PERSPECTIVE</span>
      <span style="font-size:.55rem;opacity:.6">Q1 · Q2 · HALF · Q3 · Q4</span>
    </div>
    ${mffWPCurveSvg(curve, { color: teamColor, width: 320, height: 60 })}
    ${potg}
  </div>`;
  _MFF_POSTGAME_CACHE.key = k;
  _MFF_POSTGAME_CACHE.data = html;
  return html;
}

// Rebuild franchise.seasonStats from the per-game stat blobs stored on the
// schedule (and playoff bracket). Used as a one-time repair for saves
// created before mergeSeasonStats became idempotent — older saves could
// double-count if any path called the merge twice for the same game.
function _repairSeasonStatsFromSchedule() {
  if (!franchise) return;
  franchise.seasonStats = {};
  franchise.seasonPlayoffStats = {};
  franchise.seasonAllStats = {};
  franchise._mergedGameKeys = {};
  for (const g of franchise.schedule || []) {
    if (!g.played || !g.stats) continue;
    const key = `S${franchise.season}-W${g.week}-${g.homeId}-${g.awayId}`;
    mergeSeasonStats(g.homeId, g.awayId, g.stats, key);
  }
  const rounds = franchise.playoffBracket?.rounds || [];
  rounds.forEach((round, rIdx) => {
    for (const m of round || []) {
      if (!m?.played || !m.stats) continue;
      const key = `S${franchise.season}-PR${rIdx}-${m.homeId}-${m.awayId}`;
      mergeSeasonStats(m.homeId, m.awayId, m.stats, key);
    }
  });
}

// Pull the top 4-5 highlight-worthy plays from a game; weight by clutch
// context (Q4 + close, OT, playoff) so big moments rise to the top.
// Also appends one game-level capsule (OT, shutout, blowout, walk-off).
function captureGameHighlights(homeId, awayId, plays, isPlayoff, weekLabel) {
  if (!plays || !plays.length) return;
  if (!franchise.seasonHighlights) franchise.seasonHighlights = [];
  const homeTeam = getTeam(homeId), awayTeam = getTeam(awayId);
  const homeName = homeTeam?.name || "HOME", awayName = awayTeam?.name || "AWAY";
  const hl = [];

  const scoreCtx = (p) => {
    if (p.homeScore == null || p.awayScore == null) return "";
    const diff = p.homeScore - p.awayScore;
    if (diff === 0) return " (tied)";
    const leader = diff > 0 ? homeName : awayName;
    return ` (${leader} +${Math.abs(diff)})`;
  };

  // ── Clip helpers ──────────────────────────────────────────────────────────
  const ordSfx = n => (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");
  const playDesc = (p) => {
    if (p.desc) return p.desc;
    if (p.kind === "complete")   return `${p.passer||"QB"} → ${p.receiver||"WR"} for ${p.yards||0} yds`;
    if (p.kind === "incomplete") return `Incomplete — ${p.passer||"QB"} to ${p.receiver||"WR"}`;
    if (p.kind === "run")        return `${p.rusher||"RB"} carries for ${p.yards||0} yds`;
    if (p.kind === "sack")       return `Sack — ${p.dlName||"DEF"} (-${p.sackLoss||0})`;
    if (p.kind === "int")        return `INT — ${p.defender||"DEF"}`;
    if (p.kind === "fumble")     return `Fumble — ${p.forcedBy||p.defender||"DEF"}`;
    if (p.kind === "score")      return p.rusher ? `TD — ${p.rusher}` : p.passer ? `TD — ${p.passer}→${p.receiver}` : "Scoring play";
    if (p.kind === "fg_good")    return `FG ${p.distance||"?"}yds GOOD`;
    if (p.kind === "fg_miss")    return `FG ${p.distance||"?"}yds NO GOOD`;
    if (p.kind === "punt")       return "Punt";
    return p.kind || "Play";
  };
  const fieldPosLabel = (yl) => {
    if (yl == null) return "?";
    if (yl < 50) return `OWN ${yl}`;
    if (yl > 50) return `OPP ${100 - yl}`;
    return "50";
  };
  const sitLabel = (p) => {
    if (!p.down) return "";
    const goalToGo = p.yardLine != null && p.ytg != null && (100 - p.yardLine) <= p.ytg;
    const ytgPart = goalToGo ? "G" : (p.ytg ?? "?");
    return `${p.down}${ordSfx(p.down)} & ${ytgPart} · ${fieldPosLabel(p.yardLine)}`;
  };
  const trimPlay = (p, isHl) => ({
    sit: sitLabel(p),
    desc: playDesc(p),
    hs: p.homeScore ?? 0, as: p.awayScore ?? 0,
    q: p.quarter, t: p.time, hi: !!isHl,
  });
  const recentBuf = []; // sliding window of last 3 plays for clip context

  for (const p of plays) {
    let w = 0, label = "", hlType = "off";
    if (p.kind === "score") {
      const scorer = p.poss === "home" ? homeName : awayName;
      const is_td = !!(p.passer || p.rusher || p.receiver) ||
                    (p.desc && /touchdown/i.test(p.desc));
      w = is_td ? 6 : 2.5;
      // Enrich label with scorer details from the last play before the score event
      if (is_td) {
        if (p.rusher)   label = `${p.rusher} rush TD${scoreCtx(p)}`;
        else if (p.passer && p.receiver) label = `${p.passer}→${p.receiver} TD${scoreCtx(p)}`;
        else label = `${scorer} TD${scoreCtx(p)}`;
      } else {
        label = `${scorer} FG${scoreCtx(p)}`;
      }
    } else if (p.kind === "int" && p.isPickSix) {
      w = 14; hlType = "def";
      label = `PICK-SIX! ${p.defender || "DEF"} ${p.intReturnYds || 0} yds`;
    } else if (p.kind === "int") {
      w = 7; hlType = "def";
      label = `INT — ${p.defender || "DEF"}${p.intReturnYds > 10 ? ` ret ${p.intReturnYds} yds` : ""}`;
    } else if (p.kind === "run" && (p.yards || 0) >= 20) {
      w = 4 + Math.min(4, ((p.yards || 0) - 20) / 10);
      label = `${p.rusher || "RB"} ${p.yards}-yd run${p.brokenTackles ? ` (${p.brokenTackles} broken)` : ""}`;
    } else if (p.kind === "complete" && (p.yards || 0) >= 25) {
      w = 4 + Math.min(4, ((p.yards || 0) - 25) / 10);
      label = `${p.passer || "QB"}→${p.receiver || "WR"} ${p.yards} yds`;
    } else if (p.kind === "sack" && (p.sackLoss || 0) >= 8) {
      w = 3.5; hlType = "def";
      label = `${p.dlName || "DEF"} sacks ${p.passer || "QB"} (-${p.sackLoss} yds)`;
    } else if (p.kind === "fumble") {
      w = 5; hlType = "def";
      label = `FUM — ${p.forcedBy || p.defender || "DEF"} forces it`;
    } else if (p.kind === "fg_good" && (p.distance || 0) >= 45) {
      w = 3 + ((p.distance || 0) - 45) / 5;
      label = `${p.kicker || "K"} ${p.distance}-yd FG`;
    }

    if (w > 0) {
      // Clutch multipliers
      const margin = (p.homeScore != null && p.awayScore != null)
        ? Math.abs(p.homeScore - p.awayScore) : 99;
      const isClutch = (p.quarter === 4 && margin <= 8);
      if (isClutch)              w *= 2.0;
      if ((p.quarter || 0) >= 5) w *= 3.0;
      if (isPlayoff)             w *= 1.5;

      const clip = [...recentBuf.slice(-2).map(cp => trimPlay(cp, false)), trimPlay(p, true)];
      hl.push({
        weight: w, label, desc: p.desc || "", type: hlType, clip,
        quarter: p.quarter, time: p.time,
        homeScore: p.homeScore, awayScore: p.awayScore,
        homeId, awayId, isPlayoff: !!isPlayoff, week: weekLabel, isClutch,
      });
    }

    recentBuf.push(p);
    if (recentBuf.length > 4) recentBuf.shift();
  }

  // ── Game-level capsule ──────────────────────────────────────────────────────
  // Derive final score from the last play that carries score fields
  const lastWithScore = [...plays].reverse().find(p => p.homeScore != null);
  if (lastWithScore) {
    const fh = lastWithScore.homeScore, fa = lastWithScore.awayScore;
    const isOT = plays.some(p => (p.quarter || 0) >= 5);
    const winId = fh > fa ? homeId : awayId;
    const winName = fh > fa ? homeName : awayName;
    const margin2 = Math.abs(fh - fa);
    const loserPts = Math.min(fh, fa);
    const combined = fh + fa;
    // Comeback detection — scan every play with a score for the max
    // deficit the eventual winner faced. 14+ down → comeback.
    let maxDeficit = 0;
    for (const p of plays) {
      if (p.homeScore == null || p.awayScore == null) continue;
      const winnerSide = winId === homeId ? "home" : "away";
      const winnerScore = winnerSide === "home" ? p.homeScore : p.awayScore;
      const loserScore  = winnerSide === "home" ? p.awayScore : p.homeScore;
      const def = loserScore - winnerScore;
      if (def > maxDeficit) maxDeficit = def;
    }
    // Upset detection (playoffs) — lower seed beats higher seed.
    let upsetGap = 0;
    if (isPlayoff && franchise.playoffBracket?.seeds) {
      const seeds = franchise.playoffBracket.seeds;
      const winSeed = seeds.find(s => s.teamId === winId)?.seed;
      const losId = winId === homeId ? awayId : homeId;
      const losSeed = seeds.find(s => s.teamId === losId)?.seed;
      if (winSeed && losSeed && winSeed > losSeed) upsetGap = winSeed - losSeed;
    }
    // Revenge detection (playoffs) — same matchup played in reg season,
    // winner lost that meeting. Only count one rematch flip per game.
    let revengeMeeting = null;
    if (isPlayoff && franchise.schedule) {
      const regMeetings = franchise.schedule.filter(g =>
        g.played && !g.isPlayoff && (
          (g.homeId === homeId && g.awayId === awayId) ||
          (g.homeId === awayId && g.awayId === homeId)
        ));
      const flippedLoss = regMeetings.find(g => {
        const winThenId = g.homeScore > g.awayScore ? g.homeId : g.awayId;
        return winThenId !== winId;
      });
      if (flippedLoss) revengeMeeting = flippedLoss;
    }
    const capsule = { homeId, awayId, isPlayoff: !!isPlayoff, week: weekLabel, finalHome: fh, finalAway: fa, winId };
    // Clip for capsules: last 2 plays of the game → synthetic final card
    const capCtx = recentBuf.slice(-2).map(cp => trimPlay(cp, false));
    const mkCap = (lbl) => [...capCtx, { sit: "FINAL", desc: lbl, hs: fh, as: fa, q: "FIN", t: "", hi: true }];

    if (isOT) {
      const lbl = `OT THRILLER — ${winName} wins ${Math.max(fh,fa)}-${loserPts}`;
      hl.push({ weight: 18, label: lbl, desc: `Overtime game`, ...capsule, type: "game", isClutch: true, clip: mkCap(lbl) });
    } else if (maxDeficit >= 17) {
      const lbl = `COMEBACK — ${winName} overcomes ${maxDeficit}-point deficit`;
      hl.push({ weight: 17, label: lbl, desc: `Comeback win`, ...capsule, type: "game", isClutch: true, clip: mkCap(lbl) });
    } else if (maxDeficit >= 14) {
      const lbl = `Comeback W — ${winName} rallies from ${maxDeficit} down`;
      hl.push({ weight: 13, label: lbl, desc: `Comeback win`, ...capsule, type: "game", isClutch: true, clip: mkCap(lbl) });
    } else if (loserPts === 0) {
      const lbl = `SHUTOUT — ${winName} blanks opponent`;
      hl.push({ weight: 16, label: lbl, desc: `${winName} shutout`, ...capsule, type: "def", isClutch: false, clip: mkCap(lbl) });
    } else if (combined >= 75) {
      const lbl = `SHOOTOUT — ${fh}-${fa}, ${combined} combined points`;
      hl.push({ weight: 12, label: lbl, desc: `Shootout`, ...capsule, type: "game", isClutch: false, clip: mkCap(lbl) });
    } else if (combined <= 24 && Math.max(fh, fa) >= 6) {
      const lbl = `Defensive battle — ${fh}-${fa}, ${combined} combined`;
      hl.push({ weight: 10, label: lbl, desc: `Defensive battle`, ...capsule, type: "def", isClutch: false, clip: mkCap(lbl) });
    } else if (loserPts <= 7 && margin2 >= 14) {
      const lbl = `Dominant W — ${winName} ${Math.max(fh,fa)}-${loserPts}`;
      hl.push({ weight: 9, label: lbl, desc: `Dominant victory`, ...capsule, type: "game", isClutch: false, clip: mkCap(lbl) });
    } else if (margin2 <= 3 && !isOT) {
      const lbl = `One-score game — ${winName} wins by ${margin2}`;
      hl.push({ weight: 11, label: lbl, desc: `Nail-biter`, ...capsule, type: "game", isClutch: true, clip: mkCap(lbl) });
    }
    // Playoffs-only extras — additive to the result capsule above.
    if (upsetGap >= 2) {
      const lbl = `UPSET — ${winName} (lower seed) stuns the field by ${upsetGap} seed${upsetGap===1?"":"s"}`;
      hl.push({ weight: 14, label: lbl, desc: `Playoff upset`, ...capsule, type: "game", isClutch: false, clip: mkCap(lbl) });
    }
    if (revengeMeeting) {
      const lbl = `REVENGE — ${winName} flips the reg-season loss in the playoffs`;
      hl.push({ weight: 12, label: lbl, desc: `Rematch win`, ...capsule, type: "game", isClutch: false, clip: mkCap(lbl) });
    }
    // Back-fill final score onto play-level highlights from this game
    for (const h of hl) {
      if (h.finalHome == null) { h.finalHome = fh; h.finalAway = fa; h.winId = winId; }
    }
  }

  // Top 6 per game so capsule + plays both fit; keeps the season tape
  // dense without burying any single matchup.
  const top = hl.sort((a, b) => b.weight - a.weight).slice(0, 6);
  franchise.seasonHighlights.push(...top);
}

// Compute single team's MVP from accumulated stats. Returns null if no
// meaningful production.
function computeTeamMVP(teamId) {
  const players = franchise.seasonStats?.[teamId];
  if (!players) return null;
  const best = Object.values(players)
    .map(p => ({ ...p, score: mvpScore(p) }))
    .sort((a, b) => b.score - a.score)[0];
  return (best && best.score > 8) ? best : null;
}

// League MVP — best score across all teams, weighted by team success so
// production on winning teams matters more.
// Voter fatigue — recent MVP winners get a vote-weight haircut so the
// award rotates the way real-NFL voting does (back-to-back MVPs are
// historically rare; never-three-peats since the modern era).
function _mvpFatigueMul(livePlayer) {
  if (!livePlayer?.careerHistory?.length) return 1.0;
  const hist = livePlayer.careerHistory;
  const last = hist[hist.length - 1];
  if (last?.accolades?.includes("MVP")) return 0.82;
  const prev = hist[hist.length - 2];
  if (prev?.accolades?.includes("MVP")) return 0.93;
  return 1.0;
}

function computeLeagueMVP() {
  _reconcileOrphanSeasonStats();
  let best = null;
  for (const [teamId, players] of Object.entries(franchise.seasonStats || {})) {
    const stand = franchise.standings[+teamId];
    const gp    = stand ? stand.w + stand.l + stand.t : 1;
    const winPct = gp > 0 ? stand.w / gp : 0.5;
    const teamMul = 0.55 + winPct * 0.85; // 0.55x → 1.40x
    const roster = franchise.rosters?.[+teamId] || [];
    for (const p of Object.values(players)) {
      // Match by name, fall back to nickname so fatigue mul stays correct
      // for players whose stats were keyed under their old legal name.
      const livePlayer = roster.find(rp => rp.name === p.name)
        || roster.find(rp => rp.nickname && rp.nickname === p.name);
      const s = mvpScore(p) * teamMul * _mvpFatigueMul(livePlayer);
      if (!best || s > best.score) best = { ...p, teamId: +teamId, score: s };
    }
  }
  return best;
}

// Super Bowl MVP — top scorer from the winning side of the championship game.
function computeSuperBowlMVP() {
  const g = franchise.superBowlGame;
  if (!g || !g.stats) return null;
  const winSide = g.winnerId === g.homeId ? "home" : "away";
  const players = Object.values(g.stats[winSide]?.players || {});
  if (!players.length) return null;
  const ranked = players.map(p => ({ ...p, score: mvpScore(p) }))
                        .sort((a, b) => b.score - a.score);
  return { ...ranked[0], teamId: g.winnerId };
}

// Merge orphan seasonStats entries — left over from the pre-fix
// nickname-rename bug that split a single player's stats across two
// name keys mid-season (real-name half + nickname half on the same
// roster). The match is ONLY by nickname → real-name: the orphan's
// key must equal a current roster player's nickname. Looser fallbacks
// (same-pos single-candidate, or same-pos with existing stats) were
// stripped because they re-attributed stats from cycled-out players
// (cut/traded/retired QBs, etc.) onto the team's current starter,
// producing 9000-yard ghost seasons at sub-80 OVR. Cycled-player
// orphans now stay orphan — those stats belong to a player who's no
// longer on the roster and shouldn't be merged into anyone else.
function _reconcileOrphanSeasonStats() {
  if (!franchise?.seasonStats || !franchise?.rosters) return;
  const MAX_STATS = new Set(["pass_long","rush_long","rec_long","fg_long","int_long","punt_long","kr_long","pr_long"]);
  let merged = 0;
  for (const [tidStr, players] of Object.entries(franchise.seasonStats)) {
    const tid = Number(tidStr);
    const roster = franchise.rosters[tid] || [];
    const rosterByName = new Map(roster.map(p => [p.name, p]));
    const rosterByNick = new Map(roster.filter(p => p.nickname).map(p => [p.nickname, p]));
    for (const orphanName of Object.keys(players)) {
      if (rosterByName.has(orphanName)) continue; // matches a live player
      const target = rosterByNick.get(orphanName); // ONLY the nickname-rename case
      if (!target) continue;
      const orphan = players[orphanName];
      if (!orphan) continue;
      const dest = players[target.name] || (players[target.name] = { name: target.name, pos: target.position, gp: 0 });
      for (const [k, v] of Object.entries(orphan)) {
        if (k === "name" || k === "pos") continue;
        if (typeof v !== "number") continue;
        if (MAX_STATS.has(k)) dest[k] = Math.max(dest[k] || 0, v);
        else                  dest[k] = (dest[k] || 0) + v;
      }
      delete players[orphanName];
      merged++;
    }
  }
  if (merged > 0) console.log(`[orphan reconcile] merged ${merged} split-name stat entries`);
}

// ── Comprehensive Awards Engine ──────────────────────────────────────────────
// All-Pro formation per conference: 1 QB, 2 RB, 3 WR, 1 TE, 5 OL, 4 DL,
// 3 LB, 2 CB, 2 S, 1 K, 1 P. 1st team + 2nd team selected per conference.
const _ALLPRO_FORMATION = [
  ["QB",1],["RB",2],["WR",3],["TE",1],["OL",5],
  ["DL",4],["LB",3],["CB",2],["S",2],["K",1],["P",1],
];

// Per-position IDP scoring — secondary earns more per INT/PD to offset
// fewer tackle opportunities vs. LBs/DLs. Shared by _allProPlayerScore
// and _computeDPOY so both awards always agree on who's best.
function _idpScore(pos, s) {
  if (pos === "DL") {
    // Pass-rush specialists: sacks are premium
    return (s.tkl      || 0) * 1.0
         + (s.sk       || 0) * 4
         + (s.ff       || 0) * 3
         + (s.fr       || 0) * 2
         + (s.int_made || 0) * 3
         + (s.pd       || 0) * 1
         + (s.def_td   || 0) * 6;
  }
  if (pos === "LB") {
    // Coverage + run stop: tackles and sacks both valued, INT rewarded
    return (s.tkl      || 0) * 1.5
         + (s.sk       || 0) * 3
         + (s.int_made || 0) * 4
         + (s.pd       || 0) * 1.5
         + (s.ff       || 0) * 3
         + (s.fr       || 0) * 2
         + (s.def_td   || 0) * 6;
  }
  if (pos === "CB") {
    // Coverage specialists: INT and PD boosted, fewer raw tackles expected
    return (s.tkl      || 0) * 0.75
         + (s.sk       || 0) * 2
         + (s.int_made || 0) * 6
         + (s.pd       || 0) * 2.5
         + (s.ff       || 0) * 3
         + (s.fr       || 0) * 2
         + (s.def_td   || 0) * 6;
  }
  if (pos === "S") {
    // Hybrid: strong tackle scorer + good INT value
    return (s.tkl      || 0) * 1.0
         + (s.sk       || 0) * 2
         + (s.int_made || 0) * 5
         + (s.pd       || 0) * 2
         + (s.ff       || 0) * 3
         + (s.fr       || 0) * 2
         + (s.def_td   || 0) * 6;
  }
  return 0;
}

// Score a player for All-Pro consideration using fantasy football point
// equivalents so the formula is intuitive and OVR-free.
// Offense = standard PPR. Defense = per-position IDP. OL = pancakes/SA.
// K = tiered FG value (3/4/5 pts by distance).
// Pro Bowl / All-Pro streak fatigue — softens consecutive selections so
// the spread feels closer to real-NFL voting. 4% haircut per recent
// honor in the last 3 seasons, floored at 88% so a true elite can still
// repeat.
function _proBowlFatigueMul(livePlayer) {
  if (!livePlayer?.careerHistory?.length) return 1.0;
  const recent = livePlayer.careerHistory.slice(-3);
  let streak = 0;
  for (const h of recent) {
    if (h.accolades?.some(a => a === "Pro Bowl" || a === "All-Pro" || a === "All-Pro (2nd)")) streak++;
  }
  return Math.max(0.88, 1.0 - streak * 0.04);
}

function _allProPlayerScore(p, pos, statRow) {
  if (!statRow) return 0;
  const fatigue = _proBowlFatigueMul(p);
  const s = statRow;
  const OL_POS = new Set(["OL","LT","LG","C","RG","RT"]);

  if (OL_POS.has(pos)) {
    const pk = s.pancakes || 0, sa = s.sacks_allowed || 0;
    const base = (pk === 0 && sa === 0) ? 0 : pk * 3 - sa * 10;
    return base * fatigue;
  }

  if (pos === "K") {
    const distBonus = (s.fg_long || 0) >= 50 ? 2 : (s.fg_long || 0) >= 40 ? 1 : 0;
    const missPenalty = Math.max(0, (s.fg_att || 0) - (s.fg_made || 0));
    return ((s.fg_made || 0) * 3
         + distBonus
         + (s.xp_made || 0) * 1
         - missPenalty * 1) * fatigue;
  }

  if (pos === "P") return (s.punts || 0) * 1.5 * fatigue;

  const DEF_POS = new Set(["DL","LB","CB","S"]);
  if (DEF_POS.has(pos)) return _idpScore(pos, s) * fatigue;

  // PPR offense
  const offBase = (s.pass_yds     || 0) * 0.04
       + (s.pass_td      || 0) * 4
       - (s.pass_int     || 0) * 2
       + (s.rush_yds     || 0) * 0.10
       + (s.rush_td      || 0) * 6
       + (s.rec          || 0) * 1.0
       + (s.rec_yds      || 0) * 0.10
       + (s.rec_td       || 0) * 6
       - (s.fumbles_lost || 0) * 2;
  return offBase * fatigue;
}

function _allProRowSnapshot(r) {
  const t = r.team;
  return {
    name: r.name, pos: r.pos, teamId: r.teamId,
    teamName: t ? `${t.city} ${t.name}` : "",
    teamAbbr: t ? _bspnLiveAbbr(t) : "—",
    teamPrimary: t?.primary || "#888",
    line: r.stats ? mvpStatLine(r.stats) : "",
  };
}

function _selectAllPros() {
  // Defensive: merge orphan seasonStats entries (from old nickname-
  // rename bug — same player, two keys) into the live player's current
  // entry before awards run. Without this, a player whose stats were
  // split across "Legal Name" + "Nickname" keys mid-season fails the
  // ts[p.name] lookup below and drops to zero on the All-Pro board.
  _reconcileOrphanSeasonStats();
  const result = {};
  for (const conf of ["AFC", "NFC"]) {
    const teamIds = new Set(TEAMS.filter(t => t.conference === conf).map(t => t.id));
    const all = [];
    for (const [tidStr, roster] of Object.entries(franchise.rosters || {})) {
      const tid = Number(tidStr);
      if (!teamIds.has(tid)) continue;
      const team = getTeam(tid);
      const ts = franchise.seasonStats?.[tid] || {};
      for (const p of roster) {
        // Try current name, then nickname (covers renamed-player saves
        // even before reconciliation has merged them).
        const s = ts[p.name] || (p.nickname ? ts[p.nickname] : null);
        all.push({ live: p, name: p.name, pos: p.position, teamId: tid, team, stats: s || null });
      }
    }
    const byPos = {};
    for (const r of all) (byPos[r.pos] = byPos[r.pos] || []).push(r);
    for (const pos of Object.keys(byPos)) {
      byPos[pos].sort((a, b) =>
        _allProPlayerScore(b.live, pos, b.stats) - _allProPlayerScore(a.live, pos, a.stats));
    }
    const firstTeam = {}, secondTeam = {}, alternates = {};
    for (const [pos, n] of _ALLPRO_FORMATION) {
      const list = byPos[pos] || [];
      firstTeam[pos]  = list.slice(0, n).map(_allProRowSnapshot);
      secondTeam[pos] = list.slice(n, n * 2).map(_allProRowSnapshot);
      alternates[pos] = list.slice(n * 2, n * 3).map(_allProRowSnapshot);
    }
    result[conf] = { firstTeam, secondTeam, alternates };
  }
  return result;
}

// Offensive Lineman of the Year — best OL by pancake-vs-sacks-allowed.
// Team success matters but less than for skill positions.
function _computeOLOY() {
  let best = null;
  for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
    const tid = Number(tidStr);
    const stand = franchise.standings[tid] || { w:0, l:0, t:0 };
    const gp = (stand.w || 0) + (stand.l || 0) + (stand.t || 0);
    const winPct = gp > 0 ? stand.w / gp : 0.5;
    const teamMul = 0.7 + winPct * 0.6;
    for (const p of Object.values(players)) {
      if (p.pos !== "OL" && !["LT","LG","C","RG","RT"].includes(p.pos)) continue;
      const score = ((p.pancakes || 0) * 3 - (p.sacks_allowed || 0) * 10) * teamMul;
      if (!best || score > best.score) best = { ...p, teamId: tid, score };
    }
  }
  return best && best.score > 15 ? best : null;
}

// Special Teams Player of the Year — best K + best P composite.
function _computeSTPOTY() {
  let bestK = null, bestP = null;
  for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
    const tid = Number(tidStr);
    for (const p of Object.values(players)) {
      if (p.pos === "K") {
        const fgPct = (p.fg_att || 0) > 0 ? (p.fg_made || 0) / p.fg_att : 0;
        const distBonus = (p.fg_long || 0) >= 55 ? 5 : (p.fg_long || 0) >= 50 ? 3 : 0;
        const score = fgPct * 100 + distBonus + (p.xp_made || 0) * 0.5 - ((p.fg_att || 0) - (p.fg_made || 0)) * 5;
        if (!bestK || score > bestK.score) bestK = { ...p, teamId: tid, score };
      } else if (p.pos === "P") {
        const yds = p.punts || 0;
        const score = yds * 1.5;
        if (!bestP || score > bestP.score) bestP = { ...p, teamId: tid, score };
      }
    }
  }
  return (bestK && (!bestP || bestK.score >= bestP.score)) ? bestK : bestP;
}

// Assistant Coach of the Year — top OC by points scored OR top DC by
// points allowed, whichever performance was more extreme vs league avg.
function _computeAssistantCOY() {
  const scored = {}, allowed = {};
  for (const g of (franchise.schedule || [])) {
    if (!g.played || g.homeScore == null) continue;
    scored[g.homeId]  = (scored[g.homeId]  || 0) + g.homeScore;
    scored[g.awayId]  = (scored[g.awayId]  || 0) + g.awayScore;
    allowed[g.homeId] = (allowed[g.homeId] || 0) + g.awayScore;
    allowed[g.awayId] = (allowed[g.awayId] || 0) + g.homeScore;
  }
  const sortedOff = Object.entries(scored).sort((a,b) => b[1] - a[1]);
  const sortedDef = Object.entries(allowed).sort((a,b) => a[1] - b[1]);
  const topOffTid = Number(sortedOff[0]?.[0]);
  const topDefTid = Number(sortedDef[0]?.[0]);
  const oc = franchise.coaches?.[topOffTid]?.oc;
  const dc = franchise.coaches?.[topDefTid]?.dc;
  // Pick whichever extreme is bigger relative to league avg.
  const ocResult = oc ? { type: "OC", name: oc.name, teamId: topOffTid, points: sortedOff[0][1] } : null;
  const dcResult = dc ? { type: "DC", name: dc.name, teamId: topDefTid, pointsAllowed: sortedDef[0][1] } : null;
  // Default to OC if both exist (offense more rewarded historically)
  return ocResult || dcResult;
}

// Game of the Year — most exciting game by composite of margin
// (closeness) + comeback (largest deficit overcome). Sourced from
// franchise.schedule.
function _computeGameOfYear() {
  let best = null;
  for (const g of (franchise.schedule || [])) {
    if (!g.played || g.homeScore == null) continue;
    const margin = Math.abs((g.homeScore || 0) - (g.awayScore || 0));
    const total  = (g.homeScore || 0) + (g.awayScore || 0);
    // Score: total points (excitement) + 0 if margin > 14, +20 if margin ≤ 3
    let score = total * 0.5;
    if (margin <= 3)  score += 30;
    else if (margin <= 7) score += 15;
    if (total >= 70)  score += 10;
    if (!best || score > best.score) {
      const home = getTeam(g.homeId);
      const away = getTeam(g.awayId);
      best = {
        score, week: g.week,
        label: `${away?.name || "?"} ${g.awayScore} @ ${home?.name || "?"} ${g.homeScore}`,
        margin, total,
      };
    }
  }
  return best;
}

// MFF Slice I helper: analytics bonus for a player (EPA + WPA, scaled to
// be comparable to the box-score baseline). Shared by OPOY/DPOY (MVP has
// its own inline copy with CPOE).
function _mffAwardsAnalyticsBonus(p) {
  if (!p || !p.name || typeof mffEPAFor !== "function") return 0;
  try {
    const r = mffEPAFor(p.name);
    if (!r) return 0;
    return (r.epa || 0) * 2.0 + (r.wpa || 0) * 8.0;
  } catch (e) { return 0; }
}

// Offensive Player of the Year — best offensive production × team success.
function _computeOPOY() {
  let best = null;
  for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
    const tid = Number(tidStr);
    const stand = franchise.standings[tid] || { w:0, l:0, t:0 };
    const gp = (stand.w || 0) + (stand.l || 0) + (stand.t || 0);
    const winPct = gp > 0 ? stand.w / gp : 0.5;
    const teamMul = 0.6 + winPct * 0.8;
    for (const p of Object.values(players)) {
      if (!["QB","RB","WR","TE"].includes(p.pos)) continue;
      const offScore = (p.pass_td||0)*6 + (p.pass_yds||0)*0.05 + (p.pass_comp||0)*0.30
                     - (p.pass_int||0)*4 + (p.rush_td||0)*6 + (p.rush_yds||0)*0.08
                     + (p.rec_td||0)*6 + (p.rec_yds||0)*0.10 + (p.rec||0)*0.5;
      // MFF Slice I: analytics bonus (EPA + WPA). Sized so elite analytic
      // outperformers compete with traditional box-stat leaders.
      const s = (offScore + _mffAwardsAnalyticsBonus(p)) * teamMul;
      if (!best || s > best.score) best = { ...p, teamId: tid, score: s };
    }
  }
  return best && best.score > 30 ? best : null;
}

// Defensive Player of the Year — best defensive production × team success.
function _computeDPOY() {
  let best = null;
  for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
    const tid = Number(tidStr);
    const stand = franchise.standings[tid] || { w:0, l:0, t:0 };
    const gp = (stand.w || 0) + (stand.l || 0) + (stand.t || 0);
    const winPct = gp > 0 ? stand.w / gp : 0.5;
    const teamMul = 0.6 + winPct * 0.8;
    for (const p of Object.values(players)) {
      if (!["DL","LB","CB","S"].includes(p.pos)) continue;
      // MFF Slice I: defensive analytics bonus — flip sign since the EPA
      // a defender "produces" comes from the offense FACING them. Negative
      // EPA-allowed on plays where this defender was the tackler / target
      // / coverage = good defense. We use the player's grade as a proxy
      // for now since per-play defensive EPA attribution is sparse.
      let analytics = 0;
      if (typeof _mffComputeLeagueGrades === "function") {
        try {
          const grades = _mffComputeLeagueGrades();
          const g = grades?.[p.name];
          if (g) {
            const v = g.combinedGrade ?? g.coverGrade ?? g.passRushGrade ?? g.runStuffGrade;
            if (typeof v === "number") analytics = Math.max(0, v - 50) * 0.5;
          }
        } catch (e) { /* defensive */ }
      }
      const s = (_idpScore(p.pos, p) + analytics) * teamMul;
      if (!best || s > best.score) best = { ...p, teamId: tid, score: s };
    }
  }
  return best && best.score > 20 ? best : null;
}

// Rookie of the Year — best stat score among first-year players.
function _computeROY() {
  _reconcileOrphanSeasonStats();
  const baseYear = new Date().getFullYear() + (franchise.season || 1) - 1;
  let best = null;
  for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
    const tid = Number(tidStr);
    const roster = franchise.rosters[tid] || [];
    for (const p of Object.values(players)) {
      // Match by name first, fall back to nickname for old saves where
      // the player was renamed mid-season.
      const live = roster.find(r => r.name === p.name)
        || roster.find(r => r.nickname && r.nickname === p.name);
      if (!live) continue;
      // Treat anyone with a draftYear in the current league-year (or no
      // career history) as a rookie. The age check filters edge cases.
      const isRookie = live.draftYear === baseYear ||
        (live.careerHistory && live.careerHistory.length === 0 && (live.age || 30) <= 23);
      if (!isRookie) continue;
      const s = mvpScore(p);
      if (!best || s > best.score) best = { ...p, teamId: tid, score: s };
    }
  }
  return best && best.score > 8 ? best : null;
}

// Coach of the Year — wins + improvement vs prior season + champ bonus.
function _computeCOY() {
  const champId = franchise.playoffBracket?.champion;
  const prev = (franchise.history || []).find(h => h.season === franchise.season - 1);
  const prevRecs = {};
  if (prev?.standingsSnapshot) {
    for (const [tid, s] of Object.entries(prev.standingsSnapshot)) prevRecs[+tid] = s.w || 0;
  }
  let best = null;
  for (const t of TEAMS) {
    const hc = franchise.coaches?.[t.id]?.hc;
    if (!hc) continue;
    const s = franchise.standings[t.id] || { w:0, l:0 };
    const wins = s.w || 0;
    const prevW = prevRecs[t.id];
    const improvement = prevW != null ? Math.max(0, wins - prevW) : 0;
    const isChamp = t.id === champId;
    const score = wins * 1.0 + improvement * 1.5 + (isChamp ? 4 : 0);
    if (!best || score > best.score) {
      best = {
        name: hc.name, trait: hc.trait, teamId: t.id,
        teamName: `${t.city} ${t.name}`,
        teamAbbr: _bspnLiveAbbr(t), teamPrimary: t.primary,
        wins, prevWins: prevW, improvement, isChamp, score,
      };
    }
  }
  return best;
}

// Comeback Player of the Year — biggest mvpScore jump vs his last career row.
function _computeComebackPOY() {
  let best = null;
  for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
    const tid = Number(tidStr);
    const roster = franchise.rosters[tid] || [];
    for (const p of Object.values(players)) {
      const live = roster.find(r => r.name === p.name);
      if (!live) continue;
      const hist = live.careerHistory || [];
      if (hist.length < 2) continue;
      const lastRow = hist[hist.length - 1] || {};
      const thisScore = mvpScore(p);
      const lastScore = mvpScore(lastRow);
      if (lastScore >= 35 || thisScore < 55) continue;
      const jump = thisScore - lastScore;
      if (jump < 25) continue;
      if (!best || jump > best.jump) best = {
        ...p, teamId: tid, jump, lastScore: Math.round(lastScore), thisScore: Math.round(thisScore),
      };
    }
  }
  return best;
}

// Breakout Player of the Year — young non-rookie blowing past his career peak.
function _computeBreakoutPOY() {
  const baseYear = new Date().getFullYear() + (franchise.season || 1) - 1;
  let best = null;
  for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
    const tid = Number(tidStr);
    const roster = franchise.rosters[tid] || [];
    for (const p of Object.values(players)) {
      const live = roster.find(r => r.name === p.name);
      if (!live) continue;
      if ((live.age || 30) > 25) continue;
      if (live.draftYear === baseYear) continue;
      const hist = live.careerHistory || [];
      const peak = hist.length ? Math.max(...hist.map(h => mvpScore(h))) : 0;
      const thisScore = mvpScore(p);
      if (thisScore < 60) continue;
      const lift = thisScore - peak;
      if (lift < 20) continue;
      if (!best || lift > best.lift) best = {
        ...p, teamId: tid, lift, prevPeak: Math.round(peak), thisScore: Math.round(thisScore),
      };
    }
  }
  return best;
}

// Top-3 league leaders in each major stat category (snapshot for history).
function _seasonStatLeaders() {
  const cats = [
    { key:"pass_yds",  label:"Passing Yards",    pos:["QB"] },
    { key:"pass_td",   label:"Passing TDs",      pos:["QB"] },
    { key:"rush_yds",  label:"Rushing Yards",    pos:["RB"] },
    { key:"rush_td",   label:"Rushing TDs",      pos:["RB"] },
    { key:"rec_yds",   label:"Receiving Yards",  pos:["WR","TE"] },
    { key:"rec_td",    label:"Receiving TDs",    pos:["WR","TE"] },
    { key:"sk",        label:"Sacks",            pos:["DL","LB"] },
    { key:"tkl",       label:"Tackles",          pos:["LB","S","CB","DL"] },
    { key:"int_made",  label:"Interceptions",    pos:["CB","S","LB"] },
    { key:"fg_made",   label:"Field Goals",      pos:["K"] },
  ];
  const all = [];
  for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
    const tid = Number(tidStr);
    const team = getTeam(tid);
    if (!team) continue;
    for (const p of Object.values(players)) all.push({ ...p, teamId: tid, team });
  }
  const out = {};
  for (const c of cats) {
    out[c.key] = {
      label: c.label,
      leaders: all
        .filter(r => c.pos.includes(r.pos) && (r[c.key] || 0) > 0)
        .sort((a, b) => (b[c.key] || 0) - (a[c.key] || 0))
        .slice(0, 3)
        .map(r => ({
          name: r.name, pos: r.pos, teamId: r.teamId,
          teamAbbr: _bspnLiveAbbr(r.team),
          teamPrimary: r.team.primary,
          value: r[c.key] || 0,
        })),
    };
  }
  return out;
}

// "By the numbers" — extreme regular-season facts.
function _seasonByTheNumbers() {
  const games = (franchise.schedule || []).filter(g => g.played);
  if (!games.length) return null;
  let biggestBlowout = null, closestGame = null, highestScoring = null;
  const teamPoints = {};
  for (const g of games) {
    const margin = Math.abs(g.homeScore - g.awayScore);
    const total = (g.homeScore || 0) + (g.awayScore || 0);
    const meta = {
      homeId: g.homeId, awayId: g.awayId,
      homeScore: g.homeScore, awayScore: g.awayScore,
      week: g.week, margin, total,
    };
    if (!biggestBlowout || margin > biggestBlowout.margin) biggestBlowout = meta;
    if (!closestGame   || margin < closestGame.margin)     closestGame   = meta;
    if (!highestScoring|| total  > highestScoring.total)   highestScoring = meta;
    teamPoints[g.homeId] = (teamPoints[g.homeId] || 0) + (g.homeScore || 0);
    teamPoints[g.awayId] = (teamPoints[g.awayId] || 0) + (g.awayScore || 0);
  }
  const ranked = Object.entries(teamPoints)
    .map(([tid, pts]) => ({ tid: Number(tid), pts }))
    .sort((a, b) => b.pts - a.pts);
  const sorted = TEAMS
    .map(t => ({ t, s: franchise.standings[t.id] || { w:0, l:0 } }))
    .sort((a, b) => (b.s.w || 0) - (a.s.w || 0) || (a.s.l || 0) - (b.s.l || 0));
  return {
    biggestBlowout, closestGame, highestScoring,
    mostPointsTeam: ranked[0] ? { teamId: ranked[0].tid, pts: ranked[0].pts } : null,
    bestRecord:  sorted[0]                    ? { teamId: sorted[0].t.id, w: sorted[0].s.w, l: sorted[0].s.l } : null,
    worstRecord: sorted[sorted.length - 1]    ? { teamId: sorted[sorted.length-1].t.id, w: sorted[sorted.length-1].s.w, l: sorted[sorted.length-1].s.l } : null,
  };
}

// Process retirements at season's end. Bumps age, rolls retirement,
// auto-enshrines qualifying HoFers. Returns the list for the awards
// screen. Pulled forward from `runFrnOffseason` so retirees + HoF
// inductees can be honored on the awards ceremony page.
// Standout rookies / second-year players whose stats land in the top 5%
// at their position get a "stock rises" potential bump. Models real-NFL
// dynamic where a late-round flash forces the league to re-evaluate
// upward (Brady year 2, Antonio Brown year 2-3, Tannehill in Tennessee).
// Run idempotently before season-end retirement so the new ceiling is
// already in effect for the upcoming offseason's development pass.
function _rerollPotentialForBreakouts() {
  if (franchise._potentialRerolledForSeason === franchise.season) return;
  franchise._potentialRerolledForSeason = franchise.season;
  // Group all players' mvpScore by position from this season's stats
  const byPos = {};
  for (const teamPlayers of Object.values(franchise.seasonStats || {})) {
    for (const p of Object.values(teamPlayers)) {
      (byPos[p.pos] = byPos[p.pos] || []).push({ name: p.name, score: mvpScore(p) });
    }
  }
  for (const list of Object.values(byPos)) list.sort((a, b) => b.score - a.score);
  // Bump rookies / year-2 players who placed top-5% at their position
  const seasonNum = franchise.season;
  for (const roster of Object.values(franchise.rosters || {})) {
    for (const player of roster) {
      if (player._potentialRerolled) continue;
      const draftSeason = player.draftSeason ?? null;
      if (draftSeason == null) continue;
      const yearsInLeague = seasonNum - draftSeason;
      if (yearsInLeague < 0) continue;
      // Window tiered by experience:
      //   Y0-1: top 5%, full jump (Brady year-2 SBMVP arc)
      //   Y2-3: top 5%, HALF jump (Antonio Brown year-3 breakout)
      //   Y4+:  top 3% AND sustained — needs back-to-back top-10% to
      //         qualify (Drew Brees in San Diego, Cooper Kupp arc)
      const list = byPos[player.position] || [];
      if (!list.length) continue;
      const idx = list.findIndex(r => r.name === player.name);
      const hasSnaps = idx !== -1;
      // Non-gems MUST have recorded stats to break out (production-gated).
      // Hidden gems do NOT — see the FLASH path below. (idx === -1 must never
      // reach the idx<top3 gates: -1 < anything is true, a false pass.)
      if (!hasSnaps && !player.hiddenGem) continue;
      let phase, gateOk = false;
      // Production gate (top-3%) — only for players who actually played.
      if (hasSnaps) {
        const top3 = Math.max(1, Math.floor(list.length * 0.03));
        if (yearsInLeague <= 1)      { phase = "full"; gateOk = idx < top3; }
        else if (yearsInLeague <= 3) { phase = "half"; gateOk = idx < top3; }
        else {
          // Sustained: proxy via last season carrying any accolade.
          const last = (player.careerHistory || []).slice(-1)[0];
          const sustained = !!(last?.accolades?.length);
          phase = "tiny"; gateOk = idx < top3 && sustained;
        }
      }
      // ── HIDDEN-GEM YEAR-1/2 FLASH (the Brady arc) ─────────────────────
      // THE key fix: a buried developmental gem (the literal Brady case) gets
      // ZERO snaps as a rookie, so the production gate above can never fire for
      // it — and the old `if (idx===-1) continue` skipped it entirely. So the
      // "Brady year-2 jump" the design intends (full jump to 82-87% of ceiling)
      // never reached the players it exists for. Now a YOUNG gem below its
      // launchpad can flash WITHOUT needing snaps (a raw kid whose tools the
      // staff unlock), with a merit boost if it DID produce when given a look.
      // The early flash is what lets a late-round gem leap before it'd be cut as
      // a low-OVR scrub — exactly Brady going from 6th-rounder to franchise QB.
      if (!gateOk && player.hiddenGem) {
        const FLASH_P = 0.10;   // per eligible season; calibrate via _brady_audit.js
        const ceil = player.hiddenGem.ceiling || 0;
        const belowLaunchpad = (player.overall || 0) < 0.82 * ceil;
        const earlyCareer = yearsInLeague <= 3 && (player.age || 99) <= 25;
        const merit = hasSnaps && idx < Math.max(1, Math.floor(list.length * 0.10));
        if (belowLaunchpad && earlyCareer && (merit || Math.random() < FLASH_P)) {
          phase = "full"; gateOk = true;
        }
      }
      if (!gateOk) continue;
      // Magnitude scales by phase — full jump for Y0-1 prodigies, half
      // for Y2-3 late-rises, tiny for Y4+ sustained breakouts.
      const phaseScale = phase === "full" ? 1.0 : phase === "half" ? 0.55 : 0.30;
      const bump = Math.max(1, Math.round((5 + Math.floor(Math.random() * 6)) * phaseScale));
      const newPot = Math.min(99, (player.potential || 65) + bump);
      if (newPot > (player.potential || 65)) {
        player.potential = newPot;
      }
      player._potentialRerolled = true;
      if (player.hiddenGem && player.hiddenGem.ceiling < newPot) {
        player.hiddenGem.ceiling = newPot;
      }
      // ── BREAKOUT JUMP ────────────────────────────────────────────────
      const curOvr = player.overall || 60;
      let jumpedTo = curOvr;
      if (player.hiddenGem) {
        const ceiling = player.hiddenGem.ceiling;
        // Full jump → 82-87% of ceiling, half → 70-78%, tiny → 60-68%
        const lo = phase === "full" ? 0.82 : phase === "half" ? 0.70 : 0.60;
        const hi = phase === "full" ? 0.87 : phase === "half" ? 0.78 : 0.68;
        const target = Math.round(ceiling * (lo + Math.random() * (hi - lo)));
        if (target > curOvr) jumpedTo = Math.min(99, target);
      } else {
        // Non-gem breakout bump cut 5-10 → 1-4. With the clawback fix the jump
        // now sticks fully (was ~28%), so the old 5-10 was ~3× too strong and
        // inflated the league's 90+ tail. 1-4 keeps a meaningful "breakout
        // season" bump without over-promoting every top performer to elite.
        const bonus = Math.max(1, Math.round((1 + Math.floor(Math.random() * 4)) * phaseScale));
        // Cap the non-gem breakout at the player's REALIZED ceiling (potential ×
        // _peakMult), not raw potential. Without this the breakout bypassed the
        // bust mechanism entirely: a high-potential R1 cracks top-3% production,
        // breaks out, and sails past its peakMult cap — so R1 bust% stayed 0 and
        // PB% stuck at 94% (NFL R1 bust ~30%). Now a low-peakMult bust can't
        // break out into stardom. Gems are exempt (their branch uses the gem
        // ceiling). Roll peakMult lazily — the offseason dev pass may not have
        // set it yet for a rookie when this season-end breakout runs.
        if (player._peakMult == null) player._peakMult = 0.75 + Math.random() * 0.30;
        const realizedCap = Math.round((player.potential || 99) * player._peakMult);
        jumpedTo = Math.min(99, Math.min(realizedCap, curOvr + bonus));
      }
      if (jumpedTo > curOvr) {
        // Grow developable stats so the breakout STICKS. p.overall is recomputed
        // from stats elsewhere; the old 2-stat 60/40 split restored only ~28% of
        // the jump (the rest was clawed back), which is why breakouts never
        // translated into emergences. _applyGemDevelopment raises the stats so
        // calcOverall genuinely reaches the jump target.
        if (typeof _applyGemDevelopment === "function" && player.stats) {
          _applyGemDevelopment(player, jumpedTo);
          player.overall = calcOverall(player.position, player.stats);
        } else {
          player.overall = jumpedTo;
        }
        if (typeof _pushNews === "function") {
          // Privacy: don't leak the new OVR (since users can compare
          // pre/post to compute the ceiling). The breakout itself is
          // the news; the actual number is internal.
          _pushNews({ type: "dev_surge",
            label: `🚀 ${player.position} ${player.name} — breakout year, ceiling unlocked` });
        }
      } else if (typeof _pushNews === "function") {
        // Privacy: bump magnitude (↑N) trivially reveals how much the
        // ceiling moved; replaced with a qualitative phrase.
        const magnitude = bump >= 8 ? "dramatically"
                        : bump >= 4 ? "significantly"
                        : "modestly";
        _pushNews({ type: "dev_surge",
          label: `📈 ${player.position} ${player.name} — stock rises ${magnitude} after breakout` });
      }
    }
  }
}

// Elite-plateau bump — preserve elite veterans by pushing their decline
// age back. Position-specific magnitudes mirror real-NFL longevity for
// each position's outlier careers (QB/K/P → biggest extension; RB →
// barely any, since physical attrition is brutal at the position).
const _ELITE_PLATEAU_BUMP = {
  QB: 5, K: 3, P: 3, OL: 3,
  WR: 1, TE: 3, DL: 2, LB: 2, CB: 2, S: 2,
  RB: 2,
};
function _maybeApplyElitePlateauBump(p) {
  if (!p || p._elitePlateauBumped) return;
  if ((p.overall || 0) < 90) return;
  if ((p.age || 0) < 28) return;
  if (p.age >= (p.declineAge ?? Infinity)) return;
  let bump = _ELITE_PLATEAU_BUMP[p.position] ?? 2;
  // Archetype-aware: pass-catching TEs / possession WRs / signal-callers
  // sustain technique-driven longevity beyond their position baseline.
  if (p.position === "TE" && p.archetype === "RECEIVING")   bump += 1;
  if (p.position === "WR" && p.archetype === "POSSESSION")  bump += 1;
  if (p.position === "WR" && p.archetype === "ROUTE_RUNNER")bump += 1;
  if (p.position === "LB" && p.archetype === "SIGNAL")      bump += 1;
  if (p.position === "DL" && p.archetype === "TECHNICIAN")  bump += 1;
  if (p.position === "OL" && p.archetype === "TECHNICIAN")  bump += 1;
  p.declineAge = (p.declineAge || 30) + bump;
  p._elitePlateauBumped = true;
  if (p === (franchise.rosters?.[franchise.chosenTeamId] || []).find(rp => rp === p)) {
    if (typeof _pushNews === "function") {
      _pushNews({ type: "dev_surge",
        label: `⚓ ${p.position} ${p.name} — elite form locks in (extended prime through age ${p.declineAge})` });
    }
  }
}

function _processSeasonEndRetirements() {
  _rerollPotentialForBreakouts();
  const retirees = [];
  const hofClass = [];
  for (const t of TEAMS) {
    const tId = t.id;
    const roster = franchise.rosters[tId] || [];
    const keep = [];
    for (const p of roster) {
      if (p.age == null) {
        p.age = (p.overall >= 85 ? 27 : p.overall >= 75 ? 24 : 22) + Math.floor(Math.random() * 6);
      }
      p.age += 1;
      // Career-ending injury → force retirement this offseason.
      if (p._retiringFromInjury) {
        // Set retProb=1 below by jumping adjAge sky-high
        p._forceRetire = true;
      }
      // Medical retirement — rare: a severely-damaged college faller whose body
      // gives out in his first couple NFL seasons (the Lattimore/Jaylon Smith
      // downside of the medical-faller gamble).
      if (typeof _rollMedicalRetirement === "function" && _rollMedicalRetirement(p)) {
        p._forceRetire = true;
        if (typeof _pushNews === "function") _pushNews({ type: "retirement", label: "🏥 " + (p.position || "") + " " + p.name + " medically retires — the body never recovered from his college injury" });
      }
      // Position-aware retirement curve. QB / K / P play later than
      // contact positions; RBs retire earliest. Offset shifts the
      // effective age in the curve below.
      const _retOffset = { RB:-3, WR:-1, TE:0, OL:0, DL:-1, LB:-1, CB:-1, S:-1, QB:3, K:5, P:5 };
      let adjAge = p.age - (_retOffset[p.position] || 0);
      // Injury-prone players retire earlier — Andrew Luck arc. Adds
      // 2-3 years to adjAge so the curve fires sooner.
      if (typeof _isInjuryProne === "function" && _isInjuryProne(p)) {
        adjAge += 2 + (((p.injuryHistory || []).length >= 5) ? 1 : 0);
      }
      // RB cumulative wear — high-mileage RBs decline faster (Eddie George,
      // Earl Campbell, Le'Veon Bell burnout arcs). 2000+ touches = +1
      // adjAge, 2500+ = +2, 3000+ = +3.
      if (p.position === "RB") {
        const t = p._careerTouches || 0;
        if (t >= 3000) adjAge += 3;
        else if (t >= 2500) adjAge += 2;
        else if (t >= 2000) adjAge += 1;
      }
      // NFL retirement curve is shark-fin shaped — not a normal distribution.
      // Steady ramp from 26-30 (washouts who don't earn a 2nd contract),
      // PLATEAU around 30-34 (vets who made it stick around at similar
      // attrition), then sharp climb at 35+ (physical wall). Bucket
      // distribution this targets:
      //   <28: ~6%   28-30: ~35%   31-33: ~33%   34-36: ~20%   37+: ~6%
      // — matches NFL distribution from PFR retirement-age analysis.
      let retProb = p._forceRetire ? 1 :
                  adjAge >= 39 ? 0.92
                  : adjAge === 38 ? 0.85
                  : adjAge === 37 ? 0.72
                  : adjAge === 36 ? 0.55
                  : adjAge === 35 ? 0.42
                  : adjAge === 34 ? 0.34
                  : adjAge === 33 ? 0.28
                  : adjAge === 32 ? 0.25
                  : adjAge === 31 ? 0.22
                  : adjAge === 30 ? 0.20
                  : adjAge === 29 ? 0.14
                  : adjAge === 28 ? 0.08
                  : adjAge === 27 ? 0.04
                  : adjAge === 26 ? 0.02
                  : 0;
      // Accolade-based longevity — multi-time All-Pros / Pro Bowlers hang
      // on. Each career All-Pro shaves 3% off retirement (max -20%).
      // Models real "veteran with a HoF resume keeps playing" — Brady at
      // 43, Brees at 41, Manning at 39, Marino at 38. Tightened from 5%
      // because elite players were sticking past age 45.
      const allProCount = (p.allPros || 0) + Math.floor((p.proBowls || 0) / 3);
      if (allProCount > 0 && retProb > 0) {
        const shave = Math.min(0.20, allProCount * 0.03);
        retProb = Math.max(0, retProb - shave);
      }
      if (retProb > 0 && Math.random() < retProb) {
        // HOF is now a ballot-based class (see _runHOFVoting). Retirees
        // who clear the candidate floor enter the eligible pool; the
        // actual induction happens 1+ seasons later on the awards page.
        _addHOFCandidate(p, t);
        const hofScore = typeof _computeHOFScore === "function" ? _computeHOFScore(p) : 0;
        const entry = {
          name: p.name, pos: p.position, age: p.age,
          teamId: tId, teamName: `${t.city} ${t.name}`,
          teamAbbr: _bspnLiveAbbr(t), teamPrimary: t.primary,
          careerYears: p.seasonsPlayed || (p.careerHistory?.length || 0),
          careerEarnings: Math.round((p.careerEarnings || 0) * 10) / 10,
          isHof: false, // class is announced separately via voting
          hofCandidate: hofScore >= 25,
          hofScore,
          line: mvpStatLine(p.careerStats || {}),
        };
        retirees.push(entry);
        // Add to retired player pool so they can surface as HC/OC/DC candidates 2-10 seasons later
        if (!["K","P"].includes(p.position)) {
          const peakOvr = Math.max(
            ...(p.careerHistory || []).map(h => h.ovr ?? h.overall ?? 0),
            p.overall || 0
          );
          if (peakOvr >= 72) {
            if (!franchise._retiredPlayerPool) franchise._retiredPlayerPool = [];
            franchise._retiredPlayerPool.push({
              name: p.name, pid: p.pid, pos: p.position,
              retiredSeason: franchise.season, retiredAge: p.age,
              peakOvr, retirementOvr: p.overall || 65,
              awr: p.stats?.[3] ?? 70, archetype: p.archetype,
              proBowls: p.proBowls || 0, allPros: p.allPros || 0, sbRings: p.sbRings || 0,
              formerTeamId: tId, formerTeamName: `${t.city} ${t.name}`,
              careerStatLine: mvpStatLine(p.careerStats || {}),
              careerYears: p.seasonsPlayed || (p.careerHistory?.length || 0),
            });
            franchise._retiredPlayerPool = franchise._retiredPlayerPool
              .filter(rp => franchise.season - rp.retiredSeason <= 10);
          }
        }
        // Immediately eligible as position coach — any retired player except K/P
        if (!["K","P"].includes(p.position)) {
          const _pcGrpMap = { QB:"QB", OL:"OL", WR:"Skill", RB:"Skill", TE:"Skill", DL:"DL", LB:"LB/DB", CB:"LB/DB", S:"LB/DB" };
          const _pcGrp = _pcGrpMap[p.position];
          if (_pcGrp) {
            const _pcPeak  = Math.max(...(p.careerHistory||[]).map(h=>h.ovr??h.overall??0), p.overall||0);
            const _awr     = p.stats?.[3] ?? 70;
            const _pcRating = Math.max(40, Math.min(90,
              Math.round(_pcPeak * 0.60 + _awr * 0.40 + (Math.random() * 10 - 5))));
            const _pcTier  = typeof _posCoachTierFromRating === "function"
              ? _posCoachTierFromRating(_pcRating)
              : (_pcPeak>=85||(p.proBowls||0)>=3||(p.allPros||0)>=1) ? "Elite"
              : (_pcPeak>=75||(p.proBowls||0)>=1) ? "Good" : "Journeyman";
            if (!franchise._posCoachPool) franchise._posCoachPool = [];
            franchise._posCoachPool.push({
              name: p.name, pid: p.pid,
              formerPos: p.position, group: _pcGrp,
              rating: _pcRating, tier: _pcTier,
              salary: POSITION_COACH_TIERS[_pcTier].salary,
              peakOvr: _pcPeak, proBowls: p.proBowls||0, allPros: p.allPros||0, sbRings: p.sbRings||0,
              isFormerPlayer: true, retiredSeason: franchise.season||1, retiredAge: p.age||30,
              careerStatLine: mvpStatLine(p.careerStats || {}),
              careerYears: p.seasonsPlayed || (p.careerHistory?.length || 0),
            });
          }
        }
        continue;
      }
      keep.push(p);
    }
    franchise.rosters[tId] = keep;
  }
  // hofClass populated by _runHOFVoting after this returns (1-yr ballot wait)
  return { retirees, hofClass };
}

// Snapshot an award-winner record for permanent storage on history[].
function _snapshotAwardWinner(p) {
  if (!p) return null;
  const team = p.teamId ? getTeam(p.teamId) : null;
  return {
    name: p.name, pos: p.pos, teamId: p.teamId,
    teamName: team ? `${team.city} ${team.name}` : "",
    teamAbbr: team ? _bspnLiveAbbr(team) : "",
    teamPrimary: team?.primary || "#888",
    line: mvpStatLine(p),
    // Optional extra context the renderer can use (comeback jump etc.)
    jump: p.jump, lastScore: p.lastScore, thisScore: p.thisScore,
    lift: p.lift, prevPeak: p.prevPeak,
  };
}

// Stamp accolades onto live players' careerHistory rows so trophy
// counters + career profiles reflect what happened this season.
function _stampSeasonAccolades(awards) {
  const seasonNum = franchise.season;
  const yearStamp = new Date().getFullYear() + seasonNum - 1;
  const stamp = (rec, label) => {
    if (!rec) return;
    const player = _findPlayer(rec.name);
    if (!player) return;
    const hist = player.careerHistory || (player.careerHistory = []);
    let row = hist.find(h => h.season === seasonNum || h.year === yearStamp);
    if (!row) {
      row = {
        season: seasonNum, year: yearStamp,
        age: player.age, ovr: player.overall, pos: player.position,
        teamId: null, teamName: "—", accolades: [],
      };
      hist.push(row);
    }
    if (!row.accolades) row.accolades = [];
    if (!row.accolades.includes(label)) row.accolades.push(label);
  };
  stamp(awards.leagueMVP,   "MVP");
  stamp(awards.superBowlMVP,"Super Bowl MVP");
  stamp(awards.opoy,        "OPOY");
  stamp(awards.dpoy,        "DPOY");
  stamp(awards.roy,         "ROY");
  stamp(awards.comeback,    "Comeback POY");
  stamp(awards.breakout,    "Breakout POY");
  stamp(awards.oloy,        "OL of the Year");
  stamp(awards.stpoty,      "ST PoY");
  // Champion gets ring
  const champId = franchise.playoffBracket?.champion;
  if (champId) {
    for (const p of (franchise.rosters[champId] || [])) stamp({ name: p.name }, "Super Bowl");
  }
  // All-Pro / Pro Bowl
  for (const conf of ["AFC","NFC"]) {
    const ap = awards.allPros?.[conf];
    if (!ap) continue;
    for (const list of Object.values(ap.firstTeam  || {})) for (const r of list) stamp(r, "All-Pro");
    for (const list of Object.values(ap.secondTeam || {})) for (const r of list) stamp(r, "All-Pro (2nd)");
    for (const list of Object.values(ap.alternates || {})) for (const r of list) stamp(r, "Pro Bowl");
  }
  // Refresh aggregate counters off careerHistory accolades.
  for (const roster of Object.values(franchise.rosters || {})) {
    for (const p of roster) {
      const all = (p.careerHistory || []).flatMap(h => h.accolades || []);
      p.proBowls = all.filter(a => a === "Pro Bowl" || a === "All-Pro" || a === "All-Pro (2nd)").length;
      p.allPros  = all.filter(a => a === "All-Pro" || a === "All-Pro (2nd)").length;
      p.mvps     = all.filter(a => a === "MVP").length;
      p.opoys    = all.filter(a => a === "OPOY").length;
      p.dpoys    = all.filter(a => a === "DPOY").length;
      p.roys     = all.filter(a => a === "ROY").length;
      p.sbRings  = all.filter(a => a === "Super Bowl").length;
    }
  }
}

// ── Scheme Matchup Analysis ───────────────────────────────────────────────────
// Builds the scheme-preview HTML used in both the staff panel and market cards.
// role: "off" | "def"
// scheme: the scheme string (e.g. "AIR RAID")
// myId: your team ID (used to get division peers)
function _schemePreviewHtml(role, scheme, myId) {
  if (!scheme || !TEAMS) return "";

  const myTeam = getTeam(myId);
  const myDiv  = myTeam?.division || null;
  const myConf = myTeam?.conference || null;

  // Division = same conference + same division name
  const inMyDiv = t => t.id !== myId && t.conference === myConf && t.division === myDiv;
  const divTeams = TEAMS.filter(inMyDiv);
  const lgTeams  = TEAMS.filter(t => t.id !== myId && !inMyDiv(t));

  // For an offensive scheme we look at opponents' defensive schemes; vice versa.
  const opponentScheme = (tId) => role === "off" ? _getTeamDefScheme(tId) : _getTeamOffScheme(tId);
  const modifier       = (tId) => {
    const opp = opponentScheme(tId);
    return role === "off" ? _schemeMatchup(scheme, opp) : -_schemeMatchup(opp, scheme);
  };

  const summarize = (teams) => {
    if (!teams.length) return null;
    const mods = teams.map(t => modifier(t.id));
    const avg  = mods.reduce((a, b) => a + b, 0) / mods.length;
    const favorable   = mods.filter(m => m >= 3).length;
    const unfavorable = mods.filter(m => m <= -3).length;
    const neutral     = mods.length - favorable - unfavorable;
    return { avg, favorable, unfavorable, neutral, count: mods.length };
  };

  const divSummary = summarize(divTeams);
  const lgSummary  = summarize(lgTeams);

  const pct = (n, t) => t ? Math.round(n / t * 100) : 0;
  const avgColor = (avg) => avg >= 4 ? "#00e676" : avg >= 1 ? "#69f0ae" : avg >= -2 ? "rgba(255,255,255,.45)" : avg >= -4 ? "#ffb74d" : "#ef5350";

  const sectionHtml = (title, s) => {
    if (!s) return "";
    const { avg, favorable, unfavorable, neutral, count } = s;
    const c = avgColor(avg);
    const bar = (n, color, tt) => n === 0 ? "" :
      `<div title="${n} ${tt}" style="flex:${n};height:6px;background:${color};border-radius:2px"></div>`;
    return `
      <div style="margin-bottom:.55rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.2rem">
          <span style="font-size:.63rem;color:var(--gray);text-transform:uppercase;letter-spacing:.5px">${title}</span>
          <span style="font-size:.68rem;font-weight:700;color:${c}">${avg >= 0 ? "+" : ""}${avg.toFixed(1)} avg</span>
        </div>
        <div style="display:flex;gap:2px;height:6px;border-radius:3px;overflow:hidden;background:rgba(255,255,255,.08)">
          ${bar(favorable, "#00e676", "favorable")}
          ${bar(neutral, "rgba(255,255,255,.25)", "neutral")}
          ${bar(unfavorable, "#ef5350", "unfavorable")}
        </div>
        <div style="display:flex;gap:.5rem;font-size:.6rem;margin-top:.2rem">
          ${favorable   ? `<span style="color:#00e676">${favorable} favorable</span>` : ""}
          ${neutral     ? `<span style="color:rgba(255,255,255,.35)">${neutral} neutral</span>` : ""}
          ${unfavorable ? `<span style="color:#ef5350">${unfavorable} tough</span>` : ""}
        </div>
      </div>`;
  };

  return `<div style="margin-top:.4rem">
    ${sectionHtml("Division matchups", divSummary)}
    ${sectionHtml("Rest of league", lgSummary)}
  </div>`;
}

// Inline chip for a scheme name
function _schemeBadge(scheme, small) {
  if (!scheme) return "";
  const colors = {
    "AIR RAID":      "#64b5f6",
    "SMASHMOUTH":    "#ef5350",
    "SPREAD OPTION": "#ba68c8",
    "WEST COAST":    "#4db6ac",
    "BLITZ PACKAGE": "#ff8a65",
    "COVER 2 ZONE":  "#4fc3f7",
    "MAN PRESS":     "#aed581",
    "STACK 46":      "#ffb74d",
    "HYBRID ZONE":   "rgba(255,255,255,.35)",
  };
  const c = colors[scheme] || "rgba(255,255,255,.4)";
  const sz = small ? ".57rem" : ".62rem";
  return `<span style="font-size:${sz};font-weight:700;padding:.1rem .4rem;border-radius:3px;background:${c}22;color:${c};border:1px solid ${c}55;white-space:nowrap">${scheme}</span>`;
}

// ── Coaching Staff Panel ─────────────────────────────────────────────────────
// Shows the user team's full coaching staff and allows hires/fires from the
// coach market. Market is populated by _generateCoachMarket() each offseason.
let _coachHireResult    = null; // set by frnHireCoachFromMarket; cleared after one render
let _posCoachBrowseGroup = null; // set when user opens position coach candidate browser

// ── Coaches page ──────────────────────────────────────────────────────────────
// Three sub-tabs: My Staff (current coaches + chemistry + scheme +
// player development), Market (HC/OC/DC/Position-Coach hire pool),
// League (other teams' HCs + COTY race + recent moves).
let _frnCoachesSubTab = "staff";
// Market controls + compare state — persisted across re-renders.
let _frnCoachesMarketRole = "all";
let _frnCoachesMarketSort = "rating";  // "rating" | "salary" | "fit"
let _frnCoachesMarketTraitFilter = "";
let _frnCoachesMarketFormerOnly = false;
let _frnCoachesCompare = [];  // array of {role,idx,name}

function frnSetCoachesSubTab(id) {
  if (!["staff","market","league"].includes(id)) return;
  _frnCoachesSubTab = id;
  renderFrnCoachingStaff();
}
function _frnCoachesToggleCompare(role, idx, name) {
  const i = _frnCoachesCompare.findIndex(x => x.role === role && x.idx === idx);
  if (i >= 0) _frnCoachesCompare.splice(i, 1);
  else {
    if (_frnCoachesCompare.length >= 2) _frnCoachesCompare.shift();
    _frnCoachesCompare.push({ role, idx, name });
  }
  renderFrnCoachingStaff();
}
function _frnCoachesClearCompare() { _frnCoachesCompare = []; renderFrnCoachingStaff(); }

// ── Coordinator poaching ────────────────────────────────────────────
// New gameplay axis: pursue another team's OC/DC directly. Each
// attempt costs a $2M interview-rights fee whether or not the coach
// agrees. The target team can match (keep the coach with a raise),
// the coach can accept (and move to your staff immediately), or
// decline outright. Position-coach poaching is out of scope for now
// — focus is on the named coordinators that actually shape schemes.
let _frnPoachTarget = null; // { teamId, role: "oc"|"dc" }
let _frnPoachDraft  = { aav: 4.0, years: 3, signingBonus: 2 };
const COACH_INTERVIEW_FEE = 2; // $M, paid regardless of outcome

function frnOpenPoach(teamId, role) {
  const tId = Number(teamId);
  const staff = franchise.coaches?.[tId];
  const coord = role === "oc" ? staff?.oc : staff?.dc;
  if (!coord) return;
  _frnPoachTarget = { teamId: tId, role };
  // Seed the offer at +15% on current salary, matching contract length,
  // small signing bonus — gives the user a starting point in the form.
  _frnPoachDraft = {
    aav: Math.round((coord.salary || 3) * 1.15 * 10) / 10,
    years: Math.max(2, coord.contractYears || 2),
    signingBonus: 2,
  };
  renderFrnCoachingStaff();
}
function frnCancelPoach() { _frnPoachTarget = null; renderFrnCoachingStaff(); }
function _frnPoachSetField(field, value) {
  const n = Math.max(0, Number(value) || 0);
  _frnPoachDraft[field] = field === "years" ? Math.max(1, Math.min(5, Math.round(n))) : n;
}

// AI decision: weighs offer-vs-current contract delta against coach
// loyalty, ambition (age), and the target owner's situation.
// Returns { result: "accepted" | "matched" | "declined", reason? }.
function _aiPoachDecision(targetTeamId, role, coordIn, offerIn) {
  const currentAav = coordIn.salary || 3;
  const currentYrs = coordIn.contractYears || 1;
  // Composite scores
  const offerScore = offerIn.aav * 1.0 + offerIn.years * 0.5 + (offerIn.signingBonus || 0) * 0.6;
  const currScore  = currentAav   * 1.0 + currentYrs    * 0.5;
  const delta = offerScore - currScore;
  // Loyalty — coordinators developed by this team are harder to flip
  const loyal = coordIn.developedByTeamId === targetTeamId;
  // Hot seat — owner less invested in retention
  const hotSeat = _isCoachHotSeat(targetTeamId);
  // Ambition — younger coaches more mobile; older coaches set in their ways
  const age = coordIn.age || 50;
  const ambitionMul = age >= 60 ? 0.55 : age <= 45 ? 1.25 : 1.0;
  // Expiring contract — much easier to pry loose
  const expiringMul = currentYrs <= 1 ? 1.5 : 1.0;
  let acceptProb = Math.max(0, Math.min(0.85, delta * 0.045)) * ambitionMul * expiringMul;
  if (loyal && !hotSeat) acceptProb *= 0.45;
  if (hotSeat) acceptProb = Math.max(acceptProb, 0.35);
  // Match logic: only if delta is small AND not hot-seat (otherwise let go)
  const canMatch = !hotSeat && delta < 8 && delta > 0;
  const roll = Math.random();
  if (roll < acceptProb) {
    return { result: "accepted",
      reason: hotSeat   ? "Owner mid-meltdown — let him walk"
            : currentYrs <= 1 ? "Final contract year — coach took the better deal"
            : loyal     ? "Loyalty cracked under a stronger offer"
            : "Better deal accepted" };
  }
  if (canMatch) return { result: "matched" };
  return { result: "declined",
    reason: loyal ? "Loyal to the staff that developed him"
          : age >= 60 ? "Too late in career to relocate"
          : "Not interested at these terms" };
}

function frnSubmitPoachOffer() {
  if (!_frnPoachTarget) return;
  const { teamId, role } = _frnPoachTarget;
  const targetStaff = franchise.coaches?.[teamId];
  const coord = role === "oc" ? targetStaff?.oc : targetStaff?.dc;
  if (!coord) { _frnPoachTarget = null; return; }
  const offer = { ..._frnPoachDraft };
  if (offer.aav <= 0 || offer.years <= 0) {
    alert("Set a salary and contract length before submitting.");
    return;
  }
  const myId = franchise.chosenTeamId;
  const myStaff = franchise.coaches?.[myId];
  if (!myStaff) return;
  const targetTeam = getTeam(teamId);
  // Pay interview fee regardless of outcome
  if (!franchise.refunds) franchise.refunds = [];
  franchise.refunds.push({
    kind: "coach_interview_fee", label: `Interview rights — ${coord.name}`,
    fromTeamId: myId, toTeamId: null,
    amount: COACH_INTERVIEW_FEE, yearsRemaining: 1,
  });
  const decision = _aiPoachDecision(teamId, role, coord, offer);
  if (decision.result === "accepted") {
    // User's old coordinator: book dead cap + send to FA pool.
    const oldMine = role === "oc" ? myStaff.oc : myStaff.dc;
    if (oldMine) {
      _bookCoachDeadCap(myId, oldMine, role);
      if (typeof _coachFAAdd === "function") _coachFAAdd(oldMine, role);
    }
    // Poached coach moves to user's staff and gets a freshly-built contract
    // with the negotiated AAV / years / signing bonus.
    const moved = { ...coord, yearsWithTeam: 0 };
    _coachApplyContract(moved, offer.aav, offer.years, offer.signingBonus || 0, role);
    if (role === "oc") {
      myStaff.oc = moved;
      targetStaff.oc = (typeof _rollOC === "function") ? _rollOC() : null;
      myStaff._chemistry = null; // alignment resets
    } else {
      myStaff.dc = moved;
      targetStaff.dc = (typeof _rollDC === "function") ? _rollDC() : null;
    }
    _pushNews({ type:"coach_hire",
      label: `🎩 You poached ${role.toUpperCase()} ${coord.name} from ${targetTeam?.name} — $${offer.aav.toFixed(1)}M × ${offer.years}yr (${decision.reason})` });
    if (targetStaff[role]) _pushNews({ type:"coach_hire",
      label: `🎩 ${targetTeam?.name} hired ${role.toUpperCase()} ${targetStaff[role].name} to replace ${coord.name}` });
    _coachHireResult = `Poached ${coord.name} from ${targetTeam?.name}.`;
  } else if (decision.result === "matched") {
    // Source team bumps coord to match the offer — rebuild contract too.
    const matchAav = Math.max(coord.aav || coord.salary || 0, offer.aav);
    const matchYrs = Math.max(coord.contractYears || 1, offer.years);
    const matchSb  = Math.max(coord.signingBonus || 0, +(offer.signingBonus || 0));
    _coachApplyContract(coord, matchAav, matchYrs, matchSb, role);
    _pushNews({ type:"coach_hire",
      label: `🎩 ${targetTeam?.name} matched your offer — ${coord.name} stays at $${matchAav.toFixed(1)}M × ${matchYrs}yr` });
    _coachHireResult = `${targetTeam?.name} matched. ${coord.name} stays put. Fee burned: $${COACH_INTERVIEW_FEE}M.`;
  } else {
    _pushNews({ type:"coach_depart",
      label: `🎩 ${coord.name} declined your poach offer — ${decision.reason}` });
    _coachHireResult = `${coord.name} declined: ${decision.reason}. Fee burned: $${COACH_INTERVIEW_FEE}M.`;
  }
  _frnPoachTarget = null;
  saveFranchise();
  renderFrnCoachingStaff();
}

// True if this team's HC has been flagged as on the hot seat this season.
function _isCoachHotSeat(teamId) {
  return franchise.hotSeats?.[teamId] === franchise.season;
}

// Team's league rank in PPG. defensive=true → lowest PPG-allowed is #1.
function _unitRankPPG(teamId, defensive = false) {
  const rows = TEAMS.map(t => {
    const s = franchise.standings?.[t.id] || { w:0, l:0, t:0, pf:0, pa:0 };
    const gp = (s.w || 0) + (s.l || 0) + (s.t || 0);
    const ppg = gp ? (defensive ? s.pa : s.pf) / gp : 0;
    return { id: t.id, ppg, gp };
  });
  // Only rank teams with at least one game played
  const ranked = rows.filter(r => r.gp > 0).sort((a, b) => defensive ? a.ppg - b.ppg : b.ppg - a.ppg);
  const idx = ranked.findIndex(r => r.id === teamId);
  if (idx < 0) return null;
  return { rank: idx + 1, total: ranked.length, ppg: ranked[idx].ppg };
}

// Last N played-game results for the user's team — used in the HC card.
function _hcRecentResults(myId, n = 3) {
  return (franchise.schedule || [])
    .filter(g => g.played && (g.homeId === myId || g.awayId === myId))
    .sort((a, b) => a.week - b.week)
    .slice(-n)
    .map(g => {
      const isHome = g.homeId === myId;
      const my   = isHome ? g.homeScore : g.awayScore;
      const them = isHome ? g.awayScore : g.homeScore;
      return { result: my > them ? "W" : my < them ? "L" : "T", my, them, week: g.week, oppId: isHome ? g.awayId : g.homeId };
    });
}

// Compare W% rank to talent (OFF+DEF) rank — large positive delta = HC
// is squeezing more out of the roster than expected. Negative = the
// talent's outrunning the staff.
function _hcDelivering(myId) {
  const s = franchise.standings?.[myId] || { w:0, l:0, t:0 };
  const gp = (s.w || 0) + (s.l || 0) + (s.t || 0);
  if (gp < 3) return null;
  const ratingRanked = TEAMS.map(t => {
    const r = frnTeamRating(t.id);
    return { id: t.id, total: (r.off || 0) + (r.def || 0) };
  }).sort((a, b) => b.total - a.total);
  const ratingRank = ratingRanked.findIndex(x => x.id === myId) + 1;
  const wpctRanked = TEAMS.map(t => {
    const st = franchise.standings?.[t.id] || { w:0, l:0, t:0 };
    const gp2 = (st.w || 0) + (st.l || 0) + (st.t || 0);
    return { id: t.id, pct: gp2 ? (st.w + (st.t || 0) * 0.5) / gp2 : 0 };
  }).sort((a, b) => b.pct - a.pct);
  const wpctRank = wpctRanked.findIndex(x => x.id === myId) + 1;
  const delta = ratingRank - wpctRank;  // positive = winning above your talent
  if (delta >= 6) return { state: "delivering",   label: "✓ OUTPERFORMING", desc: `Winning ${delta} spots better than talent rank #${ratingRank}` };
  if (delta <= -6) return { state: "underwater",  label: "✗ UNDERPERFORMING", desc: `Talent ranked #${ratingRank} but only #${wpctRank} in W%` };
  return { state: "on_pace", label: "ON PACE", desc: `W% rank #${wpctRank} · talent rank #${ratingRank}` };
}

function renderFrnCoachingStaff() {
  const myId   = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const staff  = franchise.coaches?.[myId] || {};
  const hc     = staff.hc;
  const oc     = staff.oc;
  const dc     = staff.dc;
  const stc    = staff.stc;
  const posStaff = staff.positionStaff || [];
  const market = franchise._coachMarket || [];
  const BUDGET_CAP = 15; // $15M coaching budget cap (display only)

  const ratingColor = r => r >= 80 ? "var(--green-lt)" : r >= 65 ? "var(--gold)" : "var(--red)";
  const ratingBadge = (r) => r != null
    ? `<span style="font-size:.7rem;font-weight:700;padding:.1rem .4rem;border-radius:3px;background:${ratingColor(r)};color:#000">${r}</span>`
    : "";

  // ── HC Card ──
  // Hot-seat chip, last-3-results strip, delivering pill — surfaced
  // alongside the existing identity / traits / contract block so the
  // user can read "how is the coach actually doing" without leaving
  // the page.
  const recent = hc ? _hcRecentResults(myId, 3) : [];
  const recentStrip = recent.length
    ? `<div class="frn-hc-recent-strip">
        <span class="frn-hc-recent-label">L${recent.length}</span>
        ${recent.map(r => {
          const col = r.result === "W" ? "var(--green-lt)" : r.result === "L" ? "#ff8a8a" : "var(--gray)";
          const opp = getTeam(r.oppId);
          return `<span class="frn-hc-recent-game" style="border-color:${col}66;color:${col}" title="W${r.week} vs ${opp?.name||"?"} ${r.my}-${r.them}">
            <b>${r.result}</b> ${r.my}–${r.them}
          </span>`;
        }).join("")}
      </div>` : "";
  const delivering = hc ? _hcDelivering(myId) : null;
  const deliveringPill = delivering ? `<span class="frn-hc-delivering-pill ${delivering.state}" title="${delivering.desc}">${delivering.label}</span>` : "";
  const hotSeat = hc && _isCoachHotSeat(myId);
  const hotSeatChip = hotSeat ? `<span class="frn-hc-hotseat-chip" title="W% under .350 with 6+ games played — owner watching closely. Locker room is dampened: under-25 AWR growth runs at half-rate until resolved.">🔥 HOT SEAT · 0.5× player development</span>` : "";
  const hcHtml = hc ? `
    <div class="frn-coach-card frn-coach-hc${hotSeat?" hot":""}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem">
        <div>
          <div style="font-size:.95rem;font-weight:700;color:var(--white)">${hc.name}</div>
          <div style="font-size:.65rem;color:var(--gray);margin-top:.1rem">HEAD COACH · Age ${hc.age||"?"} · ${hc.yearsWithTeam||0} yr${(hc.yearsWithTeam||0)===1?"":"s"} w/team</div>
        </div>
        <div style="display:flex;align-items:center;gap:.4rem;flex-shrink:0">
          ${deliveringPill}
          ${ratingBadge(hc.rating)}
        </div>
      </div>
      ${hotSeatChip ? `<div style="margin-top:.3rem">${hotSeatChip}</div>` : ""}
      ${recentStrip}
      <div style="margin-top:.5rem;font-size:.7rem;display:flex;flex-wrap:wrap;gap:.3rem">
        <span style="background:rgba(255,255,255,.08);padding:.15rem .5rem;border-radius:3px">Culture: <b>${hc.cultureTrait||"—"}</b></span>
        <span style="background:rgba(255,255,255,.08);padding:.15rem .5rem;border-radius:3px">Specialty: <b>${hc.specialtyTrait||"—"}</b></span>
      </div>
      ${hc.isFormerPlayer ? `<div style="margin-top:.3rem"><span style="font-size:.6rem;padding:.1rem .4rem;border-radius:3px;background:rgba(255,200,0,.18);color:var(--gold);border:1px solid rgba(255,200,0,.4)">🏈 Ex-${hc.formerPos||"?"}${hc.peakOvr?" · OVR "+hc.peakOvr:""}${hc.proBowls>0?" · "+hc.proBowls+"x PB":""}${hc.allPros>0?" · "+hc.allPros+"x AP":""}${hc.sbRings>0?" · "+hc.sbRings+"x SB":""}</span>${hc.careerStatLine ? `<div style="font-size:.58rem;color:var(--gray);margin-top:.2rem">${hc.careerStatLine}</div>` : ""}</div>` : ""}
      <div style="margin-top:.4rem;font-size:.68rem;color:var(--gray)">
        Record: ${hc.record?.w||0}–${hc.record?.l||0}${(hc.record?.championships||0)>0?" · "+hc.record.championships+" ring"+(hc.record.championships>1?"s":""):""}
      </div>
      ${_renderCoachContractBlock(hc, "hc")}
      ${ (hc.contractYears??2) === 0 ? `<div style="font-size:.63rem;color:var(--red);margin:.25rem 0">⚠ Contract expired — may seek new opportunity</div>` : (hc.contractYears??2) === 1 ? `<div style="font-size:.63rem;color:var(--gold);margin:.25rem 0">Final contract year — extension recommended</div>` : "" }
      <div style="margin-top:.5rem;display:flex;justify-content:flex-end;gap:.4rem">
        ${(hc.contractYears??2) <= 1 ? `<button class="btn btn-outline" style="font-size:.65rem;color:var(--gold);border-color:var(--gold)"
          onclick="frnExtendHC()">Extend HC</button>` : ""}
        <button class="btn btn-outline" style="font-size:.65rem;color:var(--red);border-color:var(--red)"
          onclick="frnFireStaffSlot('hc')">Fire HC</button>
      </div>
    </div>` : `<div class="frn-coach-card" style="color:var(--gray);font-style:italic">No head coach — hire from market</div>`;

  // ── Coordinator Cards ──
  const coordCard = (label, coord, slot) => {
    if (!coord) return `<div class="frn-coach-card" style="color:var(--gray);font-style:italic">No ${label} — hire from market</div>`;
    const cYrs   = coord.contractYears ?? 2;
    const isLoyal = coord.developedByTeamId === myId;
    const expiryWarn = cYrs === 0
      ? `<div style="font-size:.63rem;color:var(--red);margin:.25rem 0">⚠ Contract expired — may depart this offseason${isLoyal?" · Hometown loyalty reduces departure risk":""}</div>`
      : cYrs === 1
      ? `<div style="font-size:.63rem;color:var(--gold);margin:.25rem 0">Final contract year — extension needed${isLoyal?" · 🏠 Hometown discount applies":""}</div>`
      : "";
    const schemeKey = slot === "oc" ? OFF_SCHEME_MAP[coord.trait] : DEF_SCHEME_MAP[coord.trait];
    // Unit-rank pill — concrete "how the unit is doing" context the
    // user otherwise has to dig for. OC reads PPG scored, DC reads
    // PPG allowed; tier breakpoints map to league quartiles.
    const unitRank = _unitRankPPG(myId, slot === "dc");
    const unitPill = unitRank ? (() => {
      const { rank, total, ppg } = unitRank;
      const tier = rank <= Math.ceil(total * 0.25) ? { col: "var(--green-lt)", label: rank <= 3 ? "ELITE" : "TOP-10" }
                  : rank <= Math.ceil(total * 0.5)  ? { col: "var(--gold-lt)",  label: "ABOVE AVG" }
                  : rank <= Math.ceil(total * 0.75) ? { col: "#e8a000",         label: "BELOW AVG" }
                  :                                    { col: "#ff8a8a",        label: "BOTTOM-10" };
      const metric = slot === "dc" ? "PPG allowed" : "PPG scored";
      return `<span class="frn-coord-unit-pill" style="color:${tier.col};border-color:${tier.col}66" title="${metric} · ${ppg.toFixed(1)}">
        #${rank} ${slot.toUpperCase()} · ${tier.label}
      </span>`;
    })() : "";
    return `
    <div class="frn-coach-card" style="${cYrs === 0 ? "border-color:var(--red);" : cYrs === 1 ? "border-color:var(--gold);" : ""}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.4rem">
        <div>
          <div style="font-size:.8rem;font-weight:700;color:var(--white)">${coord.name}${isLoyal ? ` <span style="font-size:.6rem;color:var(--gold)">🏠</span>` : ""}</div>
          <div style="font-size:.62rem;color:var(--gray)">${label} · Age ${coord.age||"?"} · ${coord.yearsWithTeam||0} yr${(coord.yearsWithTeam||0)===1?"":"s"}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.35rem;flex-shrink:0">
          ${unitPill}
          ${ratingBadge(coord.rating)}
        </div>
      </div>
      ${expiryWarn}
      <div style="margin-top:.35rem;font-size:.68rem;display:flex;flex-wrap:wrap;gap:.35rem;align-items:center">
        <span style="background:rgba(255,255,255,.07);padding:.12rem .45rem;border-radius:3px">Trait: <b>${coord.trait||"—"}</b></span>
        ${schemeKey ? _schemeBadge(schemeKey, true) : ""}
      </div>
      ${coord.isFormerPlayer ? `<div style="margin-top:.25rem"><span style="font-size:.57rem;padding:.08rem .35rem;border-radius:3px;background:rgba(255,200,0,.15);color:var(--gold)">🏈 Ex-${coord.formerPos||"?"}${coord.peakOvr?" · OVR "+coord.peakOvr:""}${coord.proBowls>0?" · "+coord.proBowls+"xPB":""}${coord.allPros>0?" · "+coord.allPros+"xAP":""}${coord.sbRings>0?" · "+coord.sbRings+"xSB":""}</span>${coord.careerStatLine ? `<div style="font-size:.57rem;color:var(--gray);margin-top:.15rem">${coord.careerStatLine}</div>` : ""}</div>` : ""}
      ${_renderCoachContractBlock(coord, slot)}
      <div style="margin-top:.4rem;display:flex;justify-content:flex-end;gap:.4rem">
        ${cYrs <= 1 ? `<button class="btn btn-outline" style="font-size:.62rem;padding:.15rem .5rem;color:var(--gold);border-color:var(--gold)"
          onclick="frnExtendCoordinator('${slot}')">Extend</button>` : ""}
        <button class="btn btn-outline" style="font-size:.62rem;padding:.15rem .5rem"
          onclick="frnFireStaffSlot('${slot}')">Replace ${label}</button>
      </div>
    </div>`;
  };

  // ── Position Staff ──
  const tierColor = t => t === "Elite" ? "var(--gold)" : t === "Good" ? "var(--green-lt)" : "var(--gray)";
  const posSlots = POSITION_COACH_GROUPS.map((g) => {
    const coach = posStaff.find(s => s.group === g);
    const isBrowsing = _posCoachBrowseGroup === g;
    if (coach) {
      const pcRating = coach.rating || (coach.tier === "Elite" ? 82 : coach.tier === "Good" ? 68 : 52);
      const isLoyal = coach.developedByTeamId === myId;
      const offGroups = ["QB","OL","Skill"], defGroups = ["DL","LB/DB"];
      const promoteSlot = offGroups.includes(g) ? "OC" : defGroups.includes(g) ? "DC" : null;
      return `
      <div class="frn-coach-pos-slot${isBrowsing ? '" style="border-color:var(--gold)' : ''}">
        <div style="font-size:.65rem;color:var(--gray);text-transform:uppercase;letter-spacing:.5px">${g}</div>
        <div style="display:flex;align-items:center;gap:.3rem;margin:.1rem 0">
          <span style="font-size:.75rem;font-weight:700;color:var(--white)">${coach.name}</span>
          <span style="font-size:.62rem;font-weight:700;padding:.05rem .3rem;border-radius:3px;background:${tierColor(coach.tier)};color:#000">${pcRating}</span>
        </div>
        ${isLoyal ? `<div style="font-size:.57rem;color:var(--gold)">🏠 Team loyalist</div>` : ""}
        ${coach.isFormerPlayer ? `<div style="font-size:.57rem;color:var(--gold)">🏈 Ex-${coach.formerPos||"?"} · Pk ${coach.peakOvr||"?"}${coach.proBowls>0?" · "+coach.proBowls+"xPB":""}${coach.allPros>0?" · "+coach.allPros+"xAP":""}${coach.sbRings>0?" · "+coach.sbRings+"xSB":""}</div>${coach.careerStatLine ? `<div style="font-size:.55rem;color:var(--gray)">${coach.careerStatLine}</div>` : ""}` : ""}
        <div style="font-size:.6rem;color:${tierColor(coach.tier)}">${coach.tier} · $${(coach.salary||0).toFixed(1)}M${coach.age ? " · Age "+coach.age : ""}</div>
        <div style="display:flex;gap:.25rem;margin-top:.3rem;flex-wrap:wrap">
          ${promoteSlot ? `<button class="btn btn-outline" style="font-size:.53rem;padding:.08rem .3rem;color:var(--green-lt);border-color:var(--green-lt)"
            onclick="frnPromotePositionCoach('${g}')">→ ${promoteSlot}</button>` : ""}
          ${coach.tier !== "Elite" ? `<button class="btn btn-outline" style="font-size:.53rem;padding:.08rem .3rem"
            onclick="frnUpgradePositionCoach('${g}')">↑ Tier</button>` : ""}
          <button class="btn btn-outline" style="font-size:.53rem;padding:.08rem .3rem;color:var(--red);border-color:var(--red)"
            onclick="frnReleasePositionCoach('${g}')">✕</button>
        </div>
      </div>`;
    }
    return `
      <div class="frn-coach-pos-slot" style="border-style:dashed;${isBrowsing ? "border-color:var(--gold);opacity:1" : "opacity:.6"}">
        <div style="font-size:.65rem;color:var(--gray);text-transform:uppercase;letter-spacing:.5px">${g}</div>
        <div style="font-size:.75rem;color:var(--gray);margin:.2rem 0">—</div>
        <button class="btn btn-outline" style="font-size:.58rem;padding:.1rem .4rem;margin-top:.3rem"
          onclick="frnHirePositionCoach('${g}')">Hire</button>
      </div>`;
  }).join("");

  // Position coach candidate browser
  const pcPool = (franchise._posCoachPool || []).filter(c => c.group === _posCoachBrowseGroup);
  const posBrowseHtml = _posCoachBrowseGroup ? `
    <div style="margin-top:.6rem;background:rgba(255,200,0,.05);border:1px solid rgba(255,200,0,.25);border-radius:6px;padding:.65rem .9rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
        <div style="font-size:.75rem;font-weight:700;color:var(--gold)">${_posCoachBrowseGroup} Coach Candidates</div>
        <button class="btn btn-outline" style="font-size:.6rem;padding:.1rem .45rem"
          onclick="_posCoachBrowseGroup=null;renderFrnCoachingStaff()">✕ Cancel</button>
      </div>
      ${pcPool.length === 0
        ? `<div style="font-size:.7rem;color:var(--gray);font-style:italic;margin-bottom:.4rem">No known candidates available right now.</div>`
        : pcPool.map((c, i) => `
          <div style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid rgba(255,255,255,.07)">
            <div style="flex:1;min-width:0">
              <span style="font-size:.75rem;font-weight:700;color:var(--white)">${c.name}</span>
              ${c.isFormerPlayer ? `<span style="font-size:.58rem;padding:.05rem .35rem;border-radius:3px;background:rgba(255,200,0,.15);color:var(--gold);margin-left:.3rem">🏈 Ex-${c.formerPos} · Pk ${c.peakOvr}${c.proBowls>0?" · "+c.proBowls+"xPB":""}${c.allPros>0?" · "+c.allPros+"xAP":""}${c.sbRings>0?" · "+c.sbRings+"xSB":""}</span>` : ""}
              ${c.isFormerPlayer && c.careerStatLine ? `<div style="font-size:.57rem;color:var(--gray);margin-top:.1rem">${c.careerStatLine}</div>` : ""}
              <div style="font-size:.62rem;color:${tierColor(c.tier)};margin-top:.1rem">${c.tier} · $${(c.salary||0).toFixed(1)}M/yr</div>
            </div>
            <button class="btn btn-outline" style="font-size:.62rem;padding:.15rem .5rem;color:var(--green-lt);border-color:var(--green-lt);white-space:nowrap"
              onclick="frnHirePositionCoachFromPool('${_posCoachBrowseGroup}',${i})">Hire</button>
          </div>`).join("")}
      <button class="btn btn-outline" style="font-size:.65rem;margin-top:.5rem;width:100%"
        onclick="frnScoutRandomPositionCoach('${_posCoachBrowseGroup}')">🎲 Scout Unknown (Random Tier)</button>
    </div>` : "";

  // ── Budget Bar ──
  const budgetUsed  = typeof coachingBudgetUsed === "function" ? coachingBudgetUsed(myId) : 0;
  const capPenalty  = typeof coachingCapPenalty  === "function" ? coachingCapPenalty(myId)  : 0;
  const effCap      = typeof effectiveSalaryCap  === "function" ? effectiveSalaryCap(myId)  : (franchise.salaryCap || 220);
  const budgetPct   = Math.min(100, (budgetUsed / BUDGET_CAP) * 100);
  const budgetColor = budgetUsed > BUDGET_CAP ? "var(--red)" : budgetUsed > BUDGET_CAP * 0.85 ? "var(--gold)" : "var(--green-lt)";
  // Surface dead-cap-from-firings and one-shot escalator bonuses so the user
  // sees why their budget jumped beyond just AAVs.
  const coachRefunds = (franchise.refunds || []).filter(r =>
    r.yearsRemaining > 0 && r.fromTeamId === myId &&
    (r.kind === "coach_dead_cap" || r.kind === "coach_escalator"));
  const deadCapTotal = coachRefunds.filter(r => r.kind === "coach_dead_cap").reduce((s,r) => s + (r.amount||0), 0);
  const escTotal     = coachRefunds.filter(r => r.kind === "coach_escalator").reduce((s,r) => s + (r.amount||0), 0);
  const extraLine = (deadCapTotal > 0 || escTotal > 0)
    ? `<div style="font-size:.6rem;color:var(--gray);margin-top:.18rem">
        ${deadCapTotal > 0 ? `<span style="color:#ff8a8a">Dead cap: $${deadCapTotal.toFixed(2)}M</span>` : ""}
        ${deadCapTotal > 0 && escTotal > 0 ? " · " : ""}
        ${escTotal > 0 ? `<span style="color:var(--gold)">Escalators paid: $${escTotal.toFixed(2)}M</span>` : ""}
      </div>` : "";
  const penaltyLine = capPenalty > 0
    ? `<div style="font-size:.64rem;color:var(--red);margin-top:.2rem">⚠ $${capPenalty.toFixed(1)}M coaching overspend → −$${capPenalty.toFixed(1)}M player cap · Effective cap: $${effCap.toFixed(0)}M</div>`
    : "";
  const budgetHtml = `
    <div style="margin:1rem 0 .5rem">
      <div style="font-size:.68rem;color:var(--gray);margin-bottom:.25rem;letter-spacing:.5px;text-transform:uppercase">
        Coaching Budget: <span style="color:${budgetColor}">$${budgetUsed.toFixed(1)}M</span> / $${BUDGET_CAP}M
      </div>
      <div style="height:5px;background:rgba(255,255,255,.12);border-radius:3px">
        <div style="height:100%;width:${budgetPct.toFixed(0)}%;background:${budgetColor};border-radius:3px;transition:width .3s"></div>
      </div>
      ${extraLine}
      ${penaltyLine}
    </div>`;

  // ── Scheme variables — hoisted so hcMarketSchemeNote can use them ──
  const myOffScheme = _getTeamOffScheme(myId);
  const myDefScheme = _getTeamDefScheme(myId);
  const schemeOverviewHtml = `
    <div class="frn-coach-card" style="background:rgba(255,255,255,.03)">
      <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:center;margin-bottom:.6rem">
        <div>
          <div style="font-size:.6rem;color:var(--gray);letter-spacing:.5px;text-transform:uppercase;margin-bottom:.2rem">Offense</div>
          ${_schemeBadge(myOffScheme)}
        </div>
        <div>
          <div style="font-size:.6rem;color:var(--gray);letter-spacing:.5px;text-transform:uppercase;margin-bottom:.2rem">Defense</div>
          ${_schemeBadge(myDefScheme)}
        </div>
      </div>
      <div style="font-size:.63rem;color:var(--gray);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:.3rem">Offensive matchup outlook</div>
      ${_schemePreviewHtml("off", myOffScheme, myId)}
      <div style="font-size:.63rem;color:var(--gray);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin:.55rem 0 .3rem">Defensive matchup outlook</div>
      ${_schemePreviewHtml("def", myDefScheme, myId)}
    </div>`;

  // ── Coach Market ──
  const hcMarketSchemeNote = `
    <div style="font-size:.64rem;color:var(--gray);background:rgba(255,255,255,.04);border-radius:4px;padding:.4rem .6rem;margin-bottom:.4rem">
      Your current scheme: ${_schemeBadge(myOffScheme, true)} offense · ${_schemeBadge(myDefScheme, true)} defense
      <span style="opacity:.6;margin-left:.4rem">— a new HC has a 75% chance to change your OC (and thus your offense), 40% chance to change your DC</span>
    </div>`;

  // Sort + filter helper for the market lists — preserves original
  // type-pool index so frnHireCoachFromMarket(role, idx) keeps working.
  const _filterSortMarket = (pool) => {
    let list = pool.map((c, idx) => ({ c, idx }));
    if (_frnCoachesMarketTraitFilter) {
      list = list.filter(({ c }) => c.cultureTrait === _frnCoachesMarketTraitFilter
        || c.specialtyTrait === _frnCoachesMarketTraitFilter
        || c.trait === _frnCoachesMarketTraitFilter);
    }
    if (_frnCoachesMarketFormerOnly) {
      list = list.filter(({ c }) => c.isFormerPlayer);
    }
    list.sort((a, b) => {
      if (_frnCoachesMarketSort === "rating") return (b.c.rating || 0) - (a.c.rating || 0);
      if (_frnCoachesMarketSort === "salary") return (a.c.salary || 0) - (b.c.salary || 0);
      if (_frnCoachesMarketSort === "age")    return (a.c.age || 99) - (b.c.age || 99);
      return 0;
    });
    return list;
  };
  // Compare toggle button — appears on every market card.
  const _compareBtn = (role, idx, name) => {
    const isOn = _frnCoachesCompare.some(x => x.role === role && x.idx === idx);
    const escName = String(name || "").replace(/'/g,"\\'");
    return `<button class="frn-coach-compare-btn${isOn?" on":""}" onclick="event.stopPropagation();_frnCoachesToggleCompare('${role}',${idx},'${escName}')" title="Add to compare (max 2)">${isOn?"✓ Comparing":"⇆ Compare"}</button>`;
  };
  const marketHcHtml  = _filterSortMarket(market.filter(c => c.type === "hc")).map(({ c, idx: i }) => {
    const fmrBadge = c.isFormerPlayer
      ? `<span style="font-size:.58rem;padding:.1rem .35rem;border-radius:3px;background:rgba(255,200,0,.18);color:var(--gold);border:1px solid rgba(255,200,0,.4);white-space:nowrap;margin-left:.3rem">🏈 Ex-${c.formerPos||"?"}${c.peakOvr?" OVR "+c.peakOvr:""}${c.proBowls>0?" "+c.proBowls+"xPB":""}${c.sbRings>0?" "+c.sbRings+"xSB":""}</span>`
      : "";
    const loyalBadge = c.developedByTeamId === myId
      ? `<span style="font-size:.58rem;padding:.1rem .35rem;border-radius:3px;background:rgba(255,200,0,.12);color:var(--gold);border:1px solid rgba(255,200,0,.35);white-space:nowrap;margin-left:.3rem">🏠 Former ${myTeam?.name||""} coach</span>`
      : "";

    // Proposed staff — show the actual named coordinators he'd bring
    let proposedHtml = "";
    if (c.proposedOC || c.proposedDC) {
      const ocScheme  = c.proposedOC ? (OFF_SCHEME_MAP[c.proposedOC.trait] || "") : "";
      const dcScheme  = c.proposedDC ? (DEF_SCHEME_MAP[c.proposedDC.trait] || "") : "";
      const ocPreview = ocScheme ? _schemePreviewHtml("off", ocScheme, myId) : "";
      const dcPreview = dcScheme ? _schemePreviewHtml("def", dcScheme, myId) : "";
      proposedHtml = `
        <div style="margin-top:.45rem;border-top:1px solid rgba(255,255,255,.08);padding-top:.4rem">
          <div style="font-size:.6rem;color:var(--gray);letter-spacing:.4px;text-transform:uppercase;margin-bottom:.25rem">Proposed staff (75% OC swap · 40% DC swap)</div>
          ${c.proposedOC ? `<div style="margin-bottom:.2rem;display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;font-size:.68rem">
            <span style="color:var(--gray)">OC</span>
            <b style="color:var(--white)">${c.proposedOC.name}</b>
            ${ratingBadge(c.proposedOC.rating)}
            ${ocScheme ? _schemeBadge(ocScheme, true) : ""}
            <span style="color:var(--gray);font-size:.6rem">$${(c.proposedOC.salary||0).toFixed(1)}M · Age ${c.proposedOC.age||"?"}</span>
          </div>${ocPreview}` : ""}
          ${c.proposedDC ? `<div style="margin-top:.2rem;display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;font-size:.68rem">
            <span style="color:var(--gray)">DC</span>
            <b style="color:var(--white)">${c.proposedDC.name}</b>
            ${ratingBadge(c.proposedDC.rating)}
            ${dcScheme ? _schemeBadge(dcScheme, true) : ""}
            <span style="color:var(--gray);font-size:.6rem">$${(c.proposedDC.salary||0).toFixed(1)}M · Age ${c.proposedDC.age||"?"}</span>
          </div>${dcPreview}` : ""}
          ${c.broughtPosCoach ? `<div style="margin-top:.2rem;display:flex;align-items:center;gap:.35rem;font-size:.65rem">
            <span style="color:var(--gray)">+ brings</span>
            <b style="color:var(--white)">${c.broughtPosCoach.name}</b>
            <span style="color:${tierColor(c.broughtPosCoach.tier)}">${c.broughtPosCoach.group} coach · ${c.broughtPosCoach.tier} · $${(c.broughtPosCoach.salary||0).toFixed(1)}M</span>
          </div>` : ""}
        </div>`;
    }

    return `
    <div class="frn-coach-market-row" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;align-items:flex-start;gap:.75rem">
        <div style="flex:1;min-width:0">
          <div style="font-size:.78rem;font-weight:700;display:flex;align-items:center;flex-wrap:wrap;gap:.3rem">${c.name} ${ratingBadge(c.rating)}${fmrBadge}${loyalBadge}</div>
          <div style="font-size:.62rem;color:var(--gray)">Culture: ${c.cultureTrait||"—"} · Spec: ${c.specialtyTrait||"—"} · $${(c.salary||0).toFixed(1)}M/yr · Age ${c.age||"?"}</div>
          ${c.isFormerPlayer && c.careerStatLine ? `<div style="font-size:.58rem;color:var(--gray);margin-top:.1rem">${c.careerStatLine}</div>` : ""}
          ${proposedHtml}
        </div>
        <div style="display:flex;flex-direction:column;gap:.3rem;align-self:flex-start;flex-shrink:0">
          <button class="btn btn-outline" style="font-size:.65rem;white-space:nowrap"
            onclick="frnHireCoachFromMarket('hc',${i})">Hire as HC</button>
          ${_compareBtn("hc", i, c.name)}
        </div>
      </div>
    </div>`;
  }).join("") || `<div style="color:var(--gray);font-size:.72rem;font-style:italic">No HC candidates match the current filters.</div>`;

  const marketOCHtml  = _filterSortMarket(market.filter(c => c.type === "oc")).map(({ c, idx: i }) => {
    const scheme = OFF_SCHEME_MAP[c.trait];
    const preview = scheme ? _schemePreviewHtml("off", scheme, myId) : "";
    const fmrBadge = c.isFormerPlayer
      ? `<span style="font-size:.58rem;padding:.1rem .35rem;border-radius:3px;background:rgba(255,200,0,.18);color:var(--gold);border:1px solid rgba(255,200,0,.4);white-space:nowrap">🏈 Ex-${c.formerPos||"?"}${c.peakOvr?" OVR "+c.peakOvr:""}${c.proBowls>0?" "+c.proBowls+"xPB":""}${c.sbRings>0?" "+c.sbRings+"xSB":""}</span>`
      : "";
    return `
    <div class="frn-coach-market-row" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;align-items:flex-start;gap:.75rem">
        <div style="flex:1;min-width:0">
          <div style="font-size:.78rem;font-weight:700;display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
            ${c.name} ${ratingBadge(c.rating)}
            ${scheme ? _schemeBadge(scheme, true) : ""}
            ${fmrBadge}
          </div>
          <div style="font-size:.62rem;color:var(--gray);margin-top:.1rem">Trait: ${c.trait||"—"} · $${(c.salary||0).toFixed(1)}M/yr · Age ${c.age||"?"}</div>
          ${c.isFormerPlayer && c.careerStatLine ? `<div style="font-size:.58rem;color:var(--gray);margin-top:.1rem">${c.careerStatLine}</div>` : ""}
          ${preview}
        </div>
        <div style="display:flex;flex-direction:column;gap:.3rem;align-self:flex-start;flex-shrink:0">
          <button class="btn btn-outline" style="font-size:.65rem;white-space:nowrap"
            onclick="frnHireCoachFromMarket('oc',${i})">Hire as OC</button>
          ${_compareBtn("oc", i, c.name)}
        </div>
      </div>
    </div>`;
  }).join("") || `<div style="color:var(--gray);font-size:.72rem;font-style:italic">No OC candidates match the current filters.</div>`;

  const marketDCHtml  = _filterSortMarket(market.filter(c => c.type === "dc")).map(({ c, idx: i }) => {
    const scheme = DEF_SCHEME_MAP[c.trait];
    const preview = scheme ? _schemePreviewHtml("def", scheme, myId) : "";
    const fmrBadge = c.isFormerPlayer
      ? `<span style="font-size:.58rem;padding:.1rem .35rem;border-radius:3px;background:rgba(255,200,0,.18);color:var(--gold);border:1px solid rgba(255,200,0,.4);white-space:nowrap">🏈 Ex-${c.formerPos||"?"}${c.peakOvr?" OVR "+c.peakOvr:""}${c.proBowls>0?" "+c.proBowls+"xPB":""}${c.sbRings>0?" "+c.sbRings+"xSB":""}</span>`
      : "";
    return `
    <div class="frn-coach-market-row" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;align-items:flex-start;gap:.75rem">
        <div style="flex:1;min-width:0">
          <div style="font-size:.78rem;font-weight:700;display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
            ${c.name} ${ratingBadge(c.rating)}
            ${scheme ? _schemeBadge(scheme, true) : ""}
            ${fmrBadge}
          </div>
          <div style="font-size:.62rem;color:var(--gray);margin-top:.1rem">Trait: ${c.trait||"—"} · $${(c.salary||0).toFixed(1)}M/yr · Age ${c.age||"?"}</div>
          ${c.isFormerPlayer && c.careerStatLine ? `<div style="font-size:.58rem;color:var(--gray);margin-top:.1rem">${c.careerStatLine}</div>` : ""}
          ${preview}
        </div>
        <div style="display:flex;flex-direction:column;gap:.3rem;align-self:flex-start;flex-shrink:0">
          <button class="btn btn-outline" style="font-size:.65rem;white-space:nowrap"
            onclick="frnHireCoachFromMarket('dc',${i})">Hire as DC</button>
          ${_compareBtn("dc", i, c.name)}
        </div>
      </div>
    </div>`;
  }).join("") || `<div style="color:var(--gray);font-size:.72rem;font-style:italic">No DC candidates match the current filters.</div>`;

  // ── Chemistry Panel ──
  const chem      = staff._chemistry || {};
  const hcGrp     = typeof _chemGroup === "function" ? _chemGroup("hc", hc?.specialtyTrait) : null;
  const ocGrp     = typeof _chemGroup === "function" ? _chemGroup("oc", oc?.trait) : null;
  const dcGrp     = typeof _chemGroup === "function" ? _chemGroup("dc", dc?.trait) : null;
  const chemBonus = typeof _computeChemistryBonus === "function" ? _computeChemistryBonus(myId) : { offBonus:0, defBonus:0, devMul:1.0, chaotic:false };
  const alYrs     = chem.alignmentYears || 0;
  const frYrs     = chem.frictionYears  || 0;
  const grpTag    = g => g
    ? `<span style="font-size:.62rem;font-weight:700;padding:.1rem .4rem;border-radius:3px;background:${g==="OFFENSE"?"rgba(0,180,120,.25)":g==="DEFENSE"?"rgba(60,120,255,.25)":g==="DEVELOP"?"rgba(200,160,0,.25)":"rgba(255,255,255,.1)"}">${g}</span>`
    : `<span style="font-size:.62rem;color:var(--gray);opacity:.6">NEUTRAL</span>`;
  const chemStatusColor = frYrs >= 2 ? "var(--red)" : alYrs >= 2 ? "var(--green-lt)" : alYrs >= 1 ? "var(--gold)" : "rgba(255,255,255,.35)";
  const chemStatusLabel = frYrs >= 2 ? `Friction (${frYrs} yr${frYrs===1?"":"s"})` : alYrs >= 1 ? `Alignment (${alYrs} yr${alYrs===1?"":"s"})` : "Neutral — building";
  const bondHtml = chem.qbOcBond
    ? `<div style="margin-top:.4rem;font-size:.67rem;color:var(--gold)">🔗 QB-OC Bond active — ${chem.qbOcBond}</div>` : "";
  const chemHtml = `
    <div class="frn-coach-card" style="border-color:${chemStatusColor};background:rgba(255,255,255,.03)">
      <div style="font-size:.72rem;font-weight:700;color:${chemStatusColor};letter-spacing:.5px;text-transform:uppercase;margin-bottom:.4rem">
        ${chemStatusLabel}${chemBonus.chaotic ? " · CHAOTIC" : ""}
      </div>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;font-size:.68rem;align-items:center">
        <div>HC ${grpTag(hcGrp)}</div>
        <div>OC ${grpTag(ocGrp)}</div>
        <div>DC ${grpTag(dcGrp)}</div>
      </div>
      <div style="margin-top:.45rem;font-size:.67rem;color:var(--gray);display:flex;flex-wrap:wrap;gap:.6rem">
        ${chemBonus.offBonus !== 0 ? `<span style="color:${chemBonus.offBonus>0?"var(--green-lt)":"var(--red)"}">OFF ${chemBonus.offBonus>0?"+":""}${chemBonus.offBonus}</span>` : ""}
        ${chemBonus.defBonus !== 0 ? `<span style="color:${chemBonus.defBonus>0?"var(--green-lt)":"var(--red)"}">DEF ${chemBonus.defBonus>0?"+":""}${chemBonus.defBonus}</span>` : ""}
        ${chemBonus.devMul > 1.0 ? `<span style="color:var(--green-lt)">DEV x${chemBonus.devMul.toFixed(2)}</span>` : ""}
        ${chemBonus.chaotic ? `<span style="color:var(--red)">+/-2 swing per game</span>` : ""}
        ${chemBonus.offBonus===0 && chemBonus.defBonus===0 && chemBonus.devMul<=1.0 && !chemBonus.chaotic ? `<span style="opacity:.5">Bonuses unlock as alignment builds across seasons</span>` : ""}
      </div>
      ${bondHtml}
    </div>`;

  const hireBanner = _coachHireResult
    ? `<div style="background:rgba(0,200,100,.12);border:1px solid rgba(0,200,100,.4);border-radius:5px;padding:.5rem .75rem;margin-bottom:.6rem;font-size:.7rem;color:var(--green-lt)">✅ ${_coachHireResult}</div>`
    : "";
  _coachHireResult = null;

  // ── Staff tab body (current coaches + scheme + chemistry + dev) ──
  const contractEditorHtml = _renderContractEditor();
  const staffTabHtml = `
    ${budgetHtml}
    <div class="frn-sec-title" style="margin-top:.8rem">Head Coach</div>
    ${hcHtml}
    <div class="frn-sec-title" style="margin-top:.8rem">Coordinators</div>
    ${coordCard("OC", oc, "oc")}
    ${coordCard("DC", dc, "dc")}
    ${stc ? coordCard("STC", stc, "stc") : ""}
    <div class="frn-sec-title" style="margin-top:.8rem">Staff Chemistry</div>
    ${chemHtml}
    <div class="frn-sec-title" style="margin-top:.8rem">Scheme Outlook</div>
    ${schemeOverviewHtml}
    <div class="frn-sec-title" style="margin-top:.8rem">Position Staff <span style="font-size:.65rem;font-weight:400;color:var(--gray)">(up to 3 of ${POSITION_COACH_GROUPS.length} groups)</span></div>
    <div class="frn-coach-pos-grid">${posSlots}</div>
    ${posBrowseHtml}
    ${_renderPlayerDevelopmentPanel(myId, staff)}`;

  // ── Market tab body — role sub-filter then candidate lists ──
  const _activeRoleFilter = _frnCoachesMarketRole || "all";
  const showHC = _activeRoleFilter === "all" || _activeRoleFilter === "hc";
  const showOC = _activeRoleFilter === "all" || _activeRoleFilter === "oc";
  const showDC = _activeRoleFilter === "all" || _activeRoleFilter === "dc";
  const showPos = _activeRoleFilter === "all" || _activeRoleFilter === "pos";
  const marketRoleNav = ["all","hc","oc","dc","pos"].map(r => {
    const labels = { all:"ALL", hc:"HC", oc:"OC", dc:"DC", pos:"POSITION" };
    return `<button class="frn-subnav-btn${_activeRoleFilter===r?" active":""}" onclick="_frnCoachesMarketRole='${r}';renderFrnCoachingStaff()">${labels[r]}</button>`;
  }).join("");

  // Collect all unique traits across the market for the filter dropdown.
  const allTraits = new Set();
  for (const c of market) {
    if (c.cultureTrait) allTraits.add(c.cultureTrait);
    if (c.specialtyTrait) allTraits.add(c.specialtyTrait);
    if (c.trait) allTraits.add(c.trait);
  }
  const traitOpts = [...allTraits].sort().map(t =>
    `<option value="${t}" ${t===_frnCoachesMarketTraitFilter?"selected":""}>${t}</option>`).join("");

  // Sort + filter controls bar
  const marketControlsHtml = `
    <div class="frn-coach-market-controls">
      <label class="frn-cm-ctrl">
        <span class="frn-cm-ctrl-lbl">SORT</span>
        <select onchange="_frnCoachesMarketSort=this.value;renderFrnCoachingStaff()">
          <option value="rating" ${_frnCoachesMarketSort==="rating"?"selected":""}>Rating ↓</option>
          <option value="salary" ${_frnCoachesMarketSort==="salary"?"selected":""}>Salary ↑</option>
          <option value="age"    ${_frnCoachesMarketSort==="age"?"selected":""}>Age ↑</option>
        </select>
      </label>
      <label class="frn-cm-ctrl">
        <span class="frn-cm-ctrl-lbl">TRAIT</span>
        <select onchange="_frnCoachesMarketTraitFilter=this.value;renderFrnCoachingStaff()">
          <option value="">— any —</option>
          ${traitOpts}
        </select>
      </label>
      <label class="frn-cm-ctrl frn-cm-toggle">
        <input type="checkbox" ${_frnCoachesMarketFormerOnly?"checked":""}
          onchange="_frnCoachesMarketFormerOnly=this.checked;renderFrnCoachingStaff()">
        Former player only
      </label>
      ${(_frnCoachesMarketTraitFilter || _frnCoachesMarketFormerOnly || _frnCoachesMarketSort !== "rating") ? `<button class="frn-cm-clear" onclick="_frnCoachesMarketSort='rating';_frnCoachesMarketTraitFilter='';_frnCoachesMarketFormerOnly=false;renderFrnCoachingStaff()">× Reset</button>` : ""}
    </div>`;

  // Compare panel — renders only when 2 candidates picked. Resolves
  // each pick back to the original market pool by role + idx.
  let compareHtml = "";
  if (_frnCoachesCompare.length >= 1) {
    const resolved = _frnCoachesCompare.map(({ role, idx, name }) => {
      const pool = market.filter(c => c.type === role);
      const c = pool[idx];
      return { role, idx, name: c?.name || name, c };
    });
    const cards = resolved.map(({ role, c, name }) => {
      if (!c) return `<div class="frn-cm-compare-card empty"><b>${name}</b><div style="color:var(--gray);font-size:.6rem">no longer in market</div></div>`;
      const scheme = role === "oc" ? OFF_SCHEME_MAP[c.trait] : role === "dc" ? DEF_SCHEME_MAP[c.trait] : null;
      return `<div class="frn-cm-compare-card">
        <div class="frn-cm-compare-head">
          <span class="frn-cm-compare-role">${role.toUpperCase()}</span>
          ${ratingBadge(c.rating)}
        </div>
        <div class="frn-cm-compare-name">${c.name}</div>
        <div class="frn-cm-compare-row"><span>Age</span><b>${c.age||"?"}</b></div>
        <div class="frn-cm-compare-row"><span>Salary</span><b>$${(c.salary||0).toFixed(1)}M/yr</b></div>
        ${role === "hc"
          ? `<div class="frn-cm-compare-row"><span>Culture</span><b>${c.cultureTrait||"—"}</b></div>
             <div class="frn-cm-compare-row"><span>Specialty</span><b>${c.specialtyTrait||"—"}</b></div>`
          : `<div class="frn-cm-compare-row"><span>Trait</span><b>${c.trait||"—"}</b></div>
             ${scheme?`<div class="frn-cm-compare-row"><span>Scheme</span><b>${scheme}</b></div>`:""}`
        }
        ${c.isFormerPlayer ? `<div class="frn-cm-compare-row"><span>Ex-player</span><b style="color:var(--gold)">${c.formerPos||"?"} · OVR ${c.peakOvr||"?"}</b></div>` : ""}
        <button class="btn btn-outline" style="font-size:.62rem;margin-top:.35rem;width:100%"
          onclick="frnHireCoachFromMarket('${role}',${resolved.find(r => r.role===role && r.name===name).idx})">Hire</button>
      </div>`;
    }).join("");
    compareHtml = `
      <div class="frn-cm-compare-strip">
        <div class="frn-cm-compare-head-row">
          <span class="frn-cm-compare-title">⇆ COMPARING ${_frnCoachesCompare.length}/2</span>
          <button class="frn-cm-clear" onclick="_frnCoachesClearCompare()">× Clear</button>
        </div>
        <div class="frn-cm-compare-grid">${cards}</div>
        ${_frnCoachesCompare.length === 1 ? `<div style="font-size:.58rem;color:var(--gray);margin-top:.3rem;text-align:center">Pick a second candidate to compare side-by-side.</div>` : ""}
      </div>`;
  }
  const positionMarketHtml = `<div style="color:var(--gray);font-size:.7rem;margin:.3rem 0 .5rem">Browse position-coach candidates from the My Staff → Position Staff section. Each empty slot has its own ${`<b>Hire</b>`} button that opens a focused candidate pool.</div>`;
  const marketTabHtml = market.length === 0 && !showPos
    ? `${budgetHtml}<div style="color:var(--gray);font-size:.78rem;font-style:italic;margin:.6rem 0;padding:.7rem .9rem;background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.2);border-radius:6px">No HC/OC/DC market right now — those candidates open up after the season ends. Position coaches are always available from the My Staff tab.</div>`
    : `${budgetHtml}
       ${compareHtml}
       <div class="frn-subnav" style="margin:.5rem 0">${marketRoleNav}</div>
       ${marketControlsHtml}
       ${showHC ? `<div class="frn-sec-title" style="margin-top:.8rem">Head Coach Candidates</div>${hcMarketSchemeNote}${marketHcHtml}` : ""}
       ${showOC ? `<div class="frn-sec-title" style="margin-top:.8rem">Offensive Coordinators</div>${marketOCHtml}` : ""}
       ${showDC ? `<div class="frn-sec-title" style="margin-top:.8rem">Defensive Coordinators</div>${marketDCHtml}` : ""}
       ${showPos ? `<div class="frn-sec-title" style="margin-top:.8rem">Position Coaches</div>${positionMarketHtml}` : ""}`;

  // ── League tab body — all-team HC table + COTY race + recent moves ──
  const leagueTabHtml = _renderLeagueCoachesTab(myId);

  const subTabs = [
    { id: "staff",  label: "My Staff" },
    { id: "market", label: "Market" },
    { id: "league", label: "League" },
  ];
  const subNavHtml = `<div class="frn-subnav" style="margin:.4rem 0 .8rem">
    ${subTabs.map(t => `<button class="frn-subnav-btn${t.id===_frnCoachesSubTab?" active":""}" onclick="frnSetCoachesSubTab('${t.id}')">${t.label}</button>`).join("")}
  </div>`;
  const activeBody = _frnCoachesSubTab === "market" ? marketTabHtml
                   : _frnCoachesSubTab === "league" ? leagueTabHtml
                   : staffTabHtml;

  $("frnHomeContent").innerHTML = `
    <style>
      .frn-coach-card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:.75rem 1rem;margin-bottom:.6rem}
      .frn-coach-hc{border-color:var(--gold);background:rgba(255,200,0,.06)}
      .frn-coach-pos-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.5rem;margin:.5rem 0}
      .frn-coach-pos-slot{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:5px;padding:.5rem .75rem}
      .frn-coach-market-row{display:flex;align-items:stretch;gap:.75rem;padding:.55rem 0;border-bottom:1px solid rgba(255,255,255,.07)}
      .frn-coach-market-row:last-child{border-bottom:0}
    </style>
    <div style="max-width:780px;margin:0 auto;padding:.5rem 0">
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.5rem">
        <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="font-size:.7rem;padding:.2rem .6rem">← Back</button>
        <div style="font-size:1rem;font-weight:700;color:var(--gold)">${myTeam?.city} ${myTeam?.name} — Coaching</div>
        <button class="btn btn-outline" onclick="renderFrnFrontOffice()" style="font-size:.7rem;padding:.2rem .6rem;margin-left:auto" title="GM / Scout / Trainer / Strength Coach">🏢 Front Office →</button>
      </div>
      ${hireBanner}
      ${subNavHtml}
      ${contractEditorHtml}
      ${activeBody}
    </div>`;
}

// ── FRONT OFFICE STAFF PAGE ──────────────────────────────────────────
// GM / scout / trainer / strength coach for the user's team. Each role
// has rating + trait + tenure + applied effect summary. Page is
// reachable from the coaching staff page header.
// ── FRONT OFFICE CANDIDATE MARKET ─────────────────────────────────────
// User can browse + hire alternative staff. Refreshed once per offseason
// (or once per session if missing). Candidates persist on franchise so
// they survive navigation; one "hired" event consumes the pool for that
// role until the next refresh.
function _refreshFrontOfficeMarket() {
  if (typeof _rollFrontOfficer !== "function") return;
  if (!franchise._foMarket) franchise._foMarket = { season: 0, candidates: {} };
  if (franchise._foMarket.season === franchise.season && franchise._foMarket.candidates) return;
  franchise._foMarket = {
    season: franchise.season,
    candidates: {
      gm:       Array.from({ length: 4 }, () => _rollFrontOfficer("gm")),
      scout:    Array.from({ length: 4 }, () => _rollFrontOfficer("scout")),
      trainer:  Array.from({ length: 4 }, () => _rollFrontOfficer("trainer")),
      strength: Array.from({ length: 4 }, () => _rollFrontOfficer("strength")),
    },
  };
}
async function frnFOFire(role) {
  const myId = franchise.chosenTeamId;
  const fo = franchise.frontOffice?.[myId];
  if (!fo?.[role]) return;
  const p = fo[role];
  // Buyout: remaining contract years × salary (narrative cost, no cap hit).
  const buyout = (p.salary || 0) * Math.max(1, p.contractYears || 1);
  if (!await _frnConfirm(`Fire ${p.name} (${role.toUpperCase()})? Buyout ≈ $${buyout.toFixed(1)}M. You can hire a replacement from the candidate market.`)) return;
  fo[role] = null;
  if (typeof _pushNews === "function") {
    _pushNews({ type: "coach_depart", label: `🗞 ${p.name} (${role.toUpperCase()}) released by ${getTeam(myId)?.name} — $${buyout.toFixed(1)}M buyout` });
  }
  saveFranchise();
  renderFrnFrontOffice();
}
async function frnFOHire(role, candidateIdx) {
  const myId = franchise.chosenTeamId;
  const market = franchise._foMarket?.candidates?.[role];
  if (!market || !market[candidateIdx]) return;
  const cand = market[candidateIdx];
  if (!franchise.frontOffice) franchise.frontOffice = {};
  if (!franchise.frontOffice[myId]) franchise.frontOffice[myId] = {};
  // Confirm the hire so a misclick can't burn the pick.
  if (!await _frnConfirm(`Sign ${cand.name} as your ${role.toUpperCase()}? ${cand.contractYears}yr · $${(cand.salary||0).toFixed(1)}M`)) return;
  franchise.frontOffice[myId][role] = cand;
  // Remove from market so user can't double-pick.
  market.splice(candidateIdx, 1);
  if (typeof _pushNews === "function") {
    _pushNews({ type: "coach_hire", label: `🗞 ${getTeam(myId)?.name} hire ${cand.name} as ${role.toUpperCase()} (${cand.rating} OVR · ${cand.trait})` });
  }
  saveFranchise();
  renderFrnFrontOffice();
}
function renderFrnFrontOffice() {
  const myId   = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const fo = franchise.frontOffice?.[myId] || {};
  _refreshFrontOfficeMarket();
  const market = franchise._foMarket?.candidates || {};
  const ratingColor = r => r >= 80 ? "var(--green-lt)" : r >= 65 ? "var(--gold)" : "var(--red)";
  const ratingBadge = (r) => r != null
    ? `<span style="font-size:.7rem;font-weight:700;padding:.1rem .4rem;border-radius:3px;background:${ratingColor(r)};color:#000">${r}</span>`
    : "";
  const effectFor = (role, p) => {
    if (!p) return "—";
    if (role === "trainer") {
      const cut = Math.round((1 - (typeof _foInjuryMul === "function" ? _foInjuryMul(myId) : 1)) * 100);
      const extras = [];
      if (p.trait === "Veteran Carer") extras.push("vets 31+ get extra -15%");
      if (p.trait === "Sports Sci") extras.push("-35% catastrophic upgrade");
      if (p.trait === "Recovery Spec") extras.push("faster return from soft-tissue (cosmetic for now)");
      return `Injury rate ${cut > 0 ? `−${cut}%` : "unchanged"}${extras.length ? " · " + extras.join(" · ") : ""}`;
    }
    if (role === "strength") {
      const mul = (Math.max(50, p.rating || 50) - 50) / 100;
      return `Dev rate +${(mul * 100).toFixed(0)}%${p.trait ? " (biased: " + p.trait + ")" : ""}`;
    }
    if (role === "scout") {
      const reduce = Math.round((1 - (typeof _foScoutBiasMul === "function" ? _foScoutBiasMul(myId) : 1)) * 100);
      return `Draft-board bias ${reduce > 0 ? `−${reduce}%` : "unchanged"}${p.trait ? " · " + p.trait : ""}`;
    }
    if (role === "gm") {
      return `Trade evaluation tilt${p.trait ? " — " + p.trait : ""}`;
    }
    return "";
  };
  const ROLE_LABELS = { gm: "GENERAL MANAGER", scout: "HEAD SCOUT", trainer: "HEAD TRAINER", strength: "STRENGTH COACH" };
  const ROLE_ICONS  = { gm: "📋", scout: "🔍", trainer: "🏥", strength: "💪" };
  const roleCard = (role) => {
    const p = fo[role];
    if (!p) return `<div class="frn-pg-card" style="flex:1"><div class="frn-pg-card-title">${ROLE_ICONS[role]} ${ROLE_LABELS[role]}</div><div style="color:var(--gray);font-style:italic;padding:.5rem">Position vacant — hire from market below</div></div>`;
    const buyout = (p.salary || 0) * Math.max(1, p.contractYears || 1);
    return `<div class="frn-pg-card" style="flex:1">
      <div class="frn-pg-card-title">${ROLE_ICONS[role]} ${ROLE_LABELS[role]}</div>
      <div style="padding:.45rem 0">
        <div style="font-size:.95rem;font-weight:900">${p.name} ${ratingBadge(p.rating)}</div>
        <div style="color:var(--gold);font-size:.75rem;margin-top:.15rem">${p.trait || "—"}</div>
        <div style="color:var(--gray);font-size:.62rem;margin-top:.4rem">
          Age ${p.age} · ${p.yearsWithTeam}yr with team · ${p.contractYears}yr left · $${(p.salary||0).toFixed(1)}M
        </div>
        <div style="margin-top:.55rem;padding:.3rem .45rem;background:rgba(0,0,0,.25);border-left:2px solid var(--gold);border-radius:2px;font-size:.62rem;color:var(--blwhite)">
          <b style="color:var(--gold);letter-spacing:.5px;font-size:.55rem">EFFECT</b><br/>${effectFor(role, p)}
        </div>
        <button class="btn btn-outline" onclick="frnFOFire('${role}')" style="margin-top:.55rem;color:#c08080;border-color:#c08080;font-size:.6rem;padding:.18rem .5rem" title="Buyout: $${buyout.toFixed(1)}M">✗ Fire ($${buyout.toFixed(1)}M buyout)</button>
      </div>
    </div>`;
  };
  // Market section — 4 candidates per role with hire buttons. Persisted
  // per season; refreshed automatically when the season advances.
  const marketRow = (role) => {
    const cands = market[role] || [];
    if (!cands.length) return "";
    return `<div style="margin-top:.85rem">
      <div style="font-size:.7rem;color:var(--gold);letter-spacing:.8px;font-weight:700;margin-bottom:.35rem">${ROLE_ICONS[role]} ${ROLE_LABELS[role]} — CANDIDATE MARKET</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:.4rem">
        ${cands.map((c, i) => `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:3px;padding:.4rem .55rem">
          <div style="display:flex;align-items:baseline;gap:.4rem">
            <span style="font-weight:800;font-size:.78rem">${c.name}</span>
            ${ratingBadge(c.rating)}
          </div>
          <div style="color:var(--gold);font-size:.62rem;margin-top:.15rem">${c.trait}</div>
          <div style="color:var(--gray);font-size:.55rem;margin-top:.3rem">Age ${c.age} · ${c.contractYears}yr · $${(c.salary||0).toFixed(1)}M/yr</div>
          <button class="btn btn-outline accept-btn" onclick="frnFOHire('${role}', ${i})" style="margin-top:.4rem;font-size:.58rem;padding:.16rem .5rem;border-color:var(--gold);color:var(--gold);width:100%">${fo[role] ? "↺ Sign (replaces current)" : "✓ Hire"}</button>
        </div>`).join("")}
      </div>
    </div>`;
  };
  $("frnHomeContent").innerHTML = `
    <div style="max-width:840px;margin:0 auto;padding:.5rem 0">
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.5rem">
        <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="font-size:.7rem;padding:.2rem .6rem">← Back</button>
        <div style="font-size:1rem;font-weight:700;color:var(--gold)">${myTeam?.city} ${myTeam?.name} — Front Office</div>
      </div>
      <div style="color:var(--gray);font-size:.7rem;margin-bottom:.7rem;line-height:1.4">
        The building behind the team. Each role applies a roster-wide effect: <b style="color:var(--gold)">trainer</b> cuts injury rate, <b style="color:var(--gold)">strength coach</b> boosts development, <b style="color:var(--gold)">scout</b> tightens draft reads, <b style="color:var(--gold)">GM</b> drives trade evaluation.
      </div>
      <div class="frn-pg-row" style="flex-wrap:wrap;gap:.6rem">
        ${roleCard("gm")}
        ${roleCard("scout")}
      </div>
      <div class="frn-pg-row" style="flex-wrap:wrap;gap:.6rem;margin-top:.6rem">
        ${roleCard("trainer")}
        ${roleCard("strength")}
      </div>
      <div style="margin-top:1.2rem;padding-top:.7rem;border-top:1px dashed var(--border)">
        <div style="font-size:.78rem;color:var(--gold);letter-spacing:.5px;font-weight:800;margin-bottom:.3rem">🗂 CANDIDATE MARKET</div>
        <div style="color:var(--gray);font-size:.62rem;margin-bottom:.5rem;line-height:1.35">
          Available hires this offseason. Sign a candidate to replace your current staff at that role.
          Market refreshes once per season — agents come and go.
        </div>
        ${marketRow("gm")}
        ${marketRow("scout")}
        ${marketRow("trainer")}
        ${marketRow("strength")}
      </div>
    </div>`;
}

// ── League coaches sub-tab ───────────────────────────────────────────
// Aggregates every team's HC, the COTY race, recent coach-related news,
// and any free-agent coaches (recently fired) you could potentially
// pursue next offseason.
function _renderLeagueCoachesTab(myId) {
  const rows = TEAMS.map(t => {
    const staff = franchise.coaches?.[t.id] || {};
    const hc = staff.hc;
    const stand = franchise.standings?.[t.id] || { w: 0, l: 0, t: 0 };
    const games = stand.w + stand.l + (stand.t || 0);
    const pct = games ? (stand.w / games) : 0;
    const isMine = t.id === myId;
    const hotSeat = _isCoachHotSeat(t.id);
    return { t, hc, stand, games, pct, isMine, hotSeat };
  }).sort((a, b) => b.pct - a.pct || b.stand.w - a.stand.w);

  const ratingChip = (r) => r == null ? `<span style="color:var(--gray)">—</span>`
    : `<span style="font-weight:700;color:${r>=80?"var(--green-lt)":r>=65?"var(--gold)":"var(--red)"}">${r}</span>`;
  const hotChip = (h) => h
    ? `<span style="font-size:.55rem;padding:.04rem .3rem;border:1px solid var(--red);color:var(--red);border-radius:2px;background:rgba(255,80,80,.08)">🔥 HOT SEAT</span>`
    : "";

  const tableRows = rows.map(({ t, hc, stand, games, pct, isMine, hotSeat }) => {
    const rec = games ? `${stand.w}-${stand.l}${stand.t?`-${stand.t}`:""}` : "—";
    const pctStr = games ? pct.toFixed(3).replace(/^0/, "") : ".—";
    return `<tr class="${isMine?"frn-me":""}" style="${isMine?"background:rgba(212,175,55,.08)":""}">
      <td style="padding:.25rem .45rem;color:${t.primary||"var(--gold)"};font-weight:${isMine?900:700};font-size:.7rem">${isMine?"» ":""}${t.city} ${t.name}</td>
      <td style="padding:.25rem .45rem;font-size:.7rem;color:var(--blwhite)">${hc?.name || "<i style='color:var(--gray)'>vacant</i>"}</td>
      <td style="padding:.25rem .45rem;text-align:center">${ratingChip(hc?.rating)}</td>
      <td style="padding:.25rem .45rem;text-align:center;font-size:.62rem;color:var(--gray)">${hc?.yearsWithTeam||0}yr</td>
      <td style="padding:.25rem .45rem;text-align:right;font-family:'IBM Plex Mono','JetBrains Mono',monospace;font-size:.66rem">${rec}</td>
      <td style="padding:.25rem .45rem;text-align:right;font-size:.6rem;color:var(--gray)">${pctStr}</td>
      <td style="padding:.25rem .45rem">${hc ? `<span style="font-size:.58rem;color:var(--gray)">${hc.cultureTrait||"—"} / ${hc.specialtyTrait||"—"}</span>` : ""}</td>
      <td style="padding:.25rem .45rem;text-align:right">${hotChip(hotSeat)}</td>
    </tr>`;
  }).join("");

  // Coach of the Year race — top 5 by W% (a proxy for over-performance
  // until we track preseason expectations explicitly).
  const cotyTop = rows.filter(r => r.hc && r.games > 0).slice(0, 5);
  const cotyHtml = cotyTop.length ? `
    <div style="display:flex;flex-direction:column;gap:.25rem">
      ${cotyTop.map((r, i) => `<div style="display:flex;align-items:center;gap:.55rem;padding:.3rem .5rem;background:${r.isMine?"rgba(212,175,55,.08)":"var(--bg2)"};border-left:3px solid ${i===0?"var(--gold)":i<3?"var(--gold-lt)":"var(--border)"}">
        <span style="font-family:'Bebas Neue','Anton',sans-serif;font-size:1rem;color:${i===0?"var(--gold)":"var(--blgray)"};min-width:1.5rem">#${i+1}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:.72rem;font-weight:700;color:var(--blwhite)">${r.hc.name}</div>
          <div style="font-size:.58rem;color:var(--gray)">${r.t.city} ${r.t.name} · ${r.stand.w}-${r.stand.l} · ${r.pct.toFixed(3).replace(/^0/,"")}</div>
        </div>
        ${ratingChip(r.hc.rating)}
      </div>`).join("")}
    </div>` : `<div style="color:var(--gray);font-style:italic;font-size:.7rem">Race opens once games are played.</div>`;

  // Recent coach moves — scrape news feed for coach-related items
  const coachNewsTypes = new Set(["coach_hire","coach_depart","coach_bond","extension"]);
  const recentMoves = (franchise.news || [])
    .filter(n => coachNewsTypes.has(n.type) || (n.label && /coach|🎩|🚪/i.test(n.label)))
    .slice(-8).reverse();
  const movesHtml = recentMoves.length ? `
    <div style="display:flex;flex-direction:column;gap:.18rem">
      ${recentMoves.map(n => `<div style="padding:.22rem .5rem;background:var(--bg2);border:1px solid var(--border);font-size:.66rem">
        <span style="color:var(--blgray);font-size:.55rem;margin-right:.4rem">S${n.season||franchise.season} · W${n.week||"?"}</span>
        ${n.label}
      </div>`).join("")}
    </div>` : `<div style="color:var(--gray);font-style:italic;font-size:.7rem">No recent coaching news.</div>`;

  return `
    <div class="frn-sec-title" style="margin-top:.2rem">🏆 Coach of the Year Race</div>
    ${cotyHtml}
    <div class="frn-sec-title" style="margin-top:1rem">League Head Coaches</div>
    <div style="overflow-x:auto;background:var(--bg2);border:1px solid var(--border)">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:var(--bg3);border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:.25rem .45rem;font-size:.55rem;color:var(--blgray);letter-spacing:.5px">TEAM</th>
            <th style="text-align:left;padding:.25rem .45rem;font-size:.55rem;color:var(--blgray);letter-spacing:.5px">HEAD COACH</th>
            <th style="text-align:center;padding:.25rem .45rem;font-size:.55rem;color:var(--blgray);letter-spacing:.5px">RTG</th>
            <th style="text-align:center;padding:.25rem .45rem;font-size:.55rem;color:var(--blgray);letter-spacing:.5px">TEN</th>
            <th style="text-align:right;padding:.25rem .45rem;font-size:.55rem;color:var(--blgray);letter-spacing:.5px">REC</th>
            <th style="text-align:right;padding:.25rem .45rem;font-size:.55rem;color:var(--blgray);letter-spacing:.5px">PCT</th>
            <th style="text-align:left;padding:.25rem .45rem;font-size:.55rem;color:var(--blgray);letter-spacing:.5px">TRAITS</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    ${_renderCoordinatorMarket(myId)}
    <div class="frn-sec-title" style="margin-top:1rem">Recent Coach Moves</div>
    ${movesHtml}`;
}

// Coordinator Market — every team's OC/DC laid out in one place so the
// user can pursue (poach) someone they want. Each row has a Poach
// button that opens an inline offer form. Submit → AI decides.
function _renderCoordinatorMarket(myId) {
  const coords = [];
  for (const t of TEAMS) {
    if (t.id === myId) continue; // can't poach your own
    const staff = franchise.coaches?.[t.id] || {};
    if (staff.oc) coords.push({ t, role: "oc", c: staff.oc });
    if (staff.dc) coords.push({ t, role: "dc", c: staff.dc });
  }
  // Sort by rating desc — biggest fish first
  coords.sort((a, b) => (b.c.rating || 0) - (a.c.rating || 0));
  const isActiveTarget = (teamId, role) => _frnPoachTarget && _frnPoachTarget.teamId === teamId && _frnPoachTarget.role === role;
  const rows = coords.slice(0, 24).map(({ t, role, c }) => {
    const schemeKey = role === "oc" ? OFF_SCHEME_MAP?.[c.trait] : DEF_SCHEME_MAP?.[c.trait];
    const schemeChip = schemeKey ? (typeof _schemeBadge === "function" ? _schemeBadge(schemeKey, true) : `<span style="font-size:.55rem;color:var(--gold)">${schemeKey}</span>`) : "";
    const ratingChip = (c.rating || 0) >= 80 ? `<span style="font-weight:700;color:var(--green-lt)">${c.rating}</span>`
      : (c.rating || 0) >= 65 ? `<span style="font-weight:700;color:var(--gold)">${c.rating}</span>`
      : `<span style="font-weight:700;color:var(--red)">${c.rating || "?"}</span>`;
    const expiringFlag = (c.contractYears || 99) <= 1 ? `<span style="font-size:.52rem;color:var(--gold);background:rgba(212,175,55,.1);padding:.04rem .3rem;border:1px solid var(--gold-lt);border-radius:2px;margin-left:.3rem" title="Final contract year — easier to poach">⏳ EXPIRING</span>` : "";
    const hotChip = _isCoachHotSeat(t.id) ? `<span style="font-size:.52rem;color:#ff8a8a;margin-left:.3rem" title="Their owner is mid-meltdown — coordinator more likely to leave">🔥 HOT-SEAT TEAM</span>` : "";
    const isActive = isActiveTarget(t.id, role);
    return `<div class="frn-poach-row${isActive?" active":""}">
      <div class="frn-poach-meta">
        <span style="color:${t.primary||"var(--gold)"};font-weight:700;font-size:.66rem">${t.name}</span>
        <span style="color:var(--blgray);font-size:.55rem;letter-spacing:.4px">${role.toUpperCase()}</span>
        ${schemeChip}
        ${expiringFlag}${hotChip}
      </div>
      <div class="frn-poach-name">${c.name}</div>
      <div class="frn-poach-stats">
        <span>Age <b>${c.age||"?"}</b></span>
        <span>$<b>${(c.salary||0).toFixed(1)}M</b>/yr</span>
        <span><b>${c.contractYears||"?"}</b>yr left</span>
        <span>${ratingChip} rtg</span>
      </div>
      <div class="frn-poach-action">
        ${isActive
          ? `<button class="btn btn-outline" style="font-size:.62rem;padding:.15rem .45rem;color:var(--gray)" onclick="frnCancelPoach()">× Close</button>`
          : `<button class="btn btn-outline" style="font-size:.62rem;padding:.15rem .55rem;color:var(--gold);border-color:var(--gold-lt)" onclick="frnOpenPoach(${t.id},'${role}')">💼 Poach</button>`}
      </div>
      ${isActive ? _renderPoachForm(t, role, c) : ""}
    </div>`;
  }).join("");
  return `
    <div class="frn-sec-title" style="margin-top:1rem">Coordinator Market <span style="font-size:.6rem;font-weight:400;color:var(--gray);margin-left:.4rem">target another team's OC or DC · $${COACH_INTERVIEW_FEE}M fee per attempt</span></div>
    <div class="frn-poach-list">${rows}</div>`;
}

function _renderPoachForm(targetTeam, role, coord) {
  const d = _frnPoachDraft;
  const totalNew  = d.aav * d.years + (d.signingBonus || 0);
  const totalCurr = (coord.salary || 0) * (coord.contractYears || 1);
  const deltaCol  = totalNew > totalCurr ? "var(--green-lt)" : "#ff8a8a";
  return `
    <div class="frn-poach-form">
      <div class="frn-poach-form-head">
        ⇆ POACH OFFER FOR <b>${coord.name}</b> · currently $${(coord.salary||0).toFixed(1)}M × ${coord.contractYears||"?"}yr at ${targetTeam.name}
      </div>
      <div class="frn-poach-inputs">
        <label class="frn-poach-input">
          <span>AAV ($M/yr)</span>
          <input type="number" min="0.5" max="20" step="0.1" value="${d.aav.toFixed(1)}"
            oninput="_frnPoachSetField('aav',this.value)">
        </label>
        <label class="frn-poach-input">
          <span>Years</span>
          <input type="number" min="1" max="5" step="1" value="${d.years}"
            oninput="_frnPoachSetField('years',this.value)">
        </label>
        <label class="frn-poach-input">
          <span>Signing Bonus ($M)</span>
          <input type="number" min="0" max="10" step="0.5" value="${d.signingBonus}"
            oninput="_frnPoachSetField('signingBonus',this.value)">
        </label>
        <div class="frn-poach-summary">
          <div>Total: <b style="color:${deltaCol}">$${totalNew.toFixed(1)}M</b></div>
          <div style="font-size:.55rem;color:var(--gray)">vs current $${totalCurr.toFixed(1)}M</div>
          <div style="font-size:.55rem;color:#ff8a8a;margin-top:.1rem">+ $${COACH_INTERVIEW_FEE}M interview fee (paid regardless)</div>
        </div>
      </div>
      <div class="frn-poach-form-actions">
        <button class="btn btn-outline" onclick="frnCancelPoach()" style="font-size:.62rem;color:var(--gray)">Cancel</button>
        <button class="btn btn-gold" onclick="frnSubmitPoachOffer()" style="font-size:.65rem">📨 SUBMIT POACH OFFER</button>
      </div>
    </div>`;
}

// Player Development panel — surfaces the under-25 players whose AWR
// is climbing under the current staff. Today _inSeasonAwrGrowth runs
// silently; this exposes who's benefiting so the user has a tangible
// reason to invest in position coaches and HC development traits.
function _renderPlayerDevelopmentPanel(myId, staff) {
  const roster = (franchise.rosters?.[myId] || []);
  const youngsters = roster
    .filter(p => (p.age || 30) <= 25 && Array.isArray(p.stats))
    .map(p => {
      const awr = p.stats[3] ?? 70;
      const ceil = p._awrCeiling ?? 85;
      const room = Math.max(0, ceil - awr);
      return { p, awr, ceil, room };
    })
    .filter(x => x.room > 0)
    .sort((a, b) => b.room - a.room)
    .slice(0, 8);
  if (!youngsters.length) {
    return `<div class="frn-sec-title" style="margin-top:.8rem">Player Development</div>
      <div style="color:var(--gray);font-style:italic;font-size:.7rem;padding:.6rem .85rem;background:var(--bg2);border:1px solid var(--border)">No under-25 players with AWR growth room — your young core is already peaking or you don't have one.</div>`;
  }
  // Coach hint — who's driving development at each position
  const posToCoach = {};
  for (const sc of (staff.positionStaff || [])) {
    if (sc.group === "QB")     posToCoach.QB = sc;
    else if (sc.group === "OL") posToCoach.OL = sc;
    else if (sc.group === "Skill") { posToCoach.RB = sc; posToCoach.WR = sc; posToCoach.TE = sc; }
    else if (sc.group === "DL") posToCoach.DL = sc;
    else if (sc.group === "LB/DB") { posToCoach.LB = sc; posToCoach.CB = sc; posToCoach.S = sc; }
  }
  const oc = staff.oc, dc = staff.dc;
  const devMul = typeof _computeChemistryBonus === "function" ? (_computeChemistryBonus(myId).devMul || 1) : 1;
  const rows = youngsters.map(({ p, awr, ceil, room }) => {
    const coach = posToCoach[p.position];
    const coachNote = coach ? `${coach.name} (${coach.tier||"?"})` : `<i style='color:var(--gray)'>no position coach</i>`;
    const pct = ceil > 0 ? Math.min(100, Math.max(0, (awr / ceil) * 100)) : 100;
    return `<div style="display:flex;align-items:center;gap:.5rem;padding:.32rem .55rem;background:var(--bg2);border:1px solid var(--border);font-size:.66rem">
      <span style="color:var(--gold);font-weight:700;width:1.8rem">${p.position}</span>
      <span style="flex:1;min-width:0;font-weight:700;color:var(--blwhite);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</span>
      <span style="color:var(--gray);font-size:.58rem;width:5rem;text-align:right">age ${p.age||"?"} · OVR ${p.overall||"?"}</span>
      <div style="width:120px;display:flex;align-items:center;gap:.35rem">
        <span style="font-family:'IBM Plex Mono','JetBrains Mono',monospace;font-size:.62rem;color:var(--blgray)">${awr}</span>
        <div style="flex:1;height:5px;background:rgba(255,255,255,.08);border:1px solid var(--border)">
          <div style="height:100%;width:${pct}%;background:var(--gold-lt)"></div>
        </div>
        <span style="font-family:'IBM Plex Mono','JetBrains Mono',monospace;font-size:.62rem;color:var(--gold)">${ceil}</span>
      </div>
      <span style="color:var(--blgray);font-size:.56rem;width:10rem;text-align:right">${coachNote}</span>
    </div>`;
  }).join("");
  const devBonus = devMul > 1.0 ? `<span style="color:var(--green-lt);font-weight:700">+${Math.round((devMul-1)*100)}% staff dev bonus active</span>` : `<span style="color:var(--gray);font-style:italic">Build alignment for a dev multiplier (HC=Player Developer pairings)</span>`;
  return `
    <div class="frn-sec-title" style="margin-top:.8rem">Player Development <span style="font-size:.6rem;font-weight:400;margin-left:.5rem">${devBonus}</span></div>
    <div style="font-size:.58rem;color:var(--gray);margin-bottom:.3rem">Under-25 players with AWR room — their position coach drives growth (Elite tier ~3× the bumps of a Mediocre).</div>
    <div style="display:flex;flex-direction:column;gap:.18rem">${rows}</div>`;
}

// ── Coaching staff action handlers ───────────────────────────────────────────
async function frnFireStaffSlot(slot) {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff) return;
  const coach = staff[slot];
  const name  = coach?.name || "coach";
  const dead  = _coachDeadCapOnFire(coach);
  const yrsLeft = coach?.contractYears || 0;
  const deadMsg = dead > 0
    ? `\n\n⚠ Dead cap: $${dead.toFixed(1)}M over ${yrsLeft} yr${yrsLeft===1?"":"s"} ($${(dead/Math.max(1,yrsLeft)).toFixed(1)}M/yr against coaching budget)`
    : "";
  if (slot === "hc") {
    if (!await _frnConfirm(`Release ${name}?${deadMsg}\n\nYou will choose a replacement on the next screen.`)) return;
    _renderHcVacancyPanel();
    return;
  }
  if (!await _frnConfirm(`Release ${name}?${deadMsg}\n\nA replacement will be hired immediately.`)) return;
  if (slot === "oc") {
    const taken = typeof _coordMayTakePosCoach === "function" ? _coordMayTakePosCoach(staff, "oc") : null;
    if (taken) _pushNews({ type:"coach_depart",
      label: `🚪 Outgoing OC ${name} took ${taken.group} coach ${taken.name} with them` });
    _bookCoachDeadCap(myId, staff.oc, "oc");
    _coachFAAdd(staff.oc, "oc");
    if (staff._chemistry) staff._chemistry.qbOcBond = false;
    staff.oc = _rollOC();
    _pushNews({ type:"coach_hire", label: `Your team hired new OC ${staff.oc.name}` });
  } else if (slot === "dc") {
    const taken = typeof _coordMayTakePosCoach === "function" ? _coordMayTakePosCoach(staff, "dc") : null;
    if (taken) _pushNews({ type:"coach_depart",
      label: `🚪 Outgoing DC ${name} took ${taken.group} coach ${taken.name} with them` });
    _bookCoachDeadCap(myId, staff.dc, "dc");
    _coachFAAdd(staff.dc, "dc");
    staff.dc = _rollDC();
    _pushNews({ type:"coach_hire", label: `Your team hired new DC ${staff.dc.name}` });
  }
  saveFranchise();
  renderFrnCoachingStaff();
}

function frnExtendHC() {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff?.hc) return;
  _frnOpenContractEditor("hc", "extend");
}

function frnExtendCoordinator(slot) {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff?.[slot]) return;
  _frnOpenContractEditor(slot, "extend");
}

// ── Coach contract editor ────────────────────────────────────────────────────
// Inline panel for negotiating extensions and outside hires. The same form
// drives Extend HC, Extend OC/DC, and Hire-from-market — kind + slot decide
// the submit path. Draft lives on a module-level holder so re-renders keep
// the user's last-typed AAV/Years/SB without resetting.
let _frnCoachContractDraft = null;

function _suggestCoachTerms(coach, slot, kind) {
  const role = slot === "hc" ? "hc" : slot;
  const isLoyal = coach && coach.developedByTeamId === franchise.chosenTeamId;
  const loyalMul = (kind === "extend" && isLoyal) ? 0.87 : 1.0;
  const markup   = kind === "extend" ? 1.12 : 1.0;
  const aav = +(_marketSalaryForCoach(coach || { rating: 70 }, role) * markup * loyalMul).toFixed(1);
  const years = role === "hc" ? (4 + Math.floor(Math.random() * 2))
                              : (2 + Math.floor(Math.random() * 2));
  const sb = +(aav * years * (COACH_SB_PCT[role] || 0.18) * 0.8).toFixed(1);
  return { aav, years, sb, isLoyal };
}

function _frnOpenContractEditor(slot, kind, marketIdx) {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  let coach = null;
  if (kind === "extend") coach = staff?.[slot];
  else if (kind === "hire") {
    const market = franchise._coachMarket || [];
    const pool = market.filter(c => c.type === slot);
    coach = pool[marketIdx];
  }
  if (!coach) return;
  const sugg = _suggestCoachTerms(coach, slot, kind);
  _frnCoachContractDraft = {
    slot, kind, marketIdx,
    aav: sugg.aav, years: sugg.years, sb: sugg.sb,
    coachName: coach.name, coachRating: coach.rating || 60,
    isLoyal: sugg.isLoyal,
  };
  // Always re-render the coaches page so the editor panel is visible.
  // (Market sub-tab still shows the candidate list underneath.)
  if (kind === "hire") _frnCoachesSubTab = "market";
  renderFrnCoachingStaff();
}

function frnCloseContractEditor() {
  _frnCoachContractDraft = null;
  renderFrnCoachingStaff();
}

function frnContractDraftSet(field, value) {
  if (!_frnCoachContractDraft) return;
  const v = Math.max(0, +value || 0);
  if (field === "aav")   _frnCoachContractDraft.aav   = +v.toFixed(1);
  if (field === "years") _frnCoachContractDraft.years = Math.max(1, Math.round(v));
  if (field === "sb")    _frnCoachContractDraft.sb    = +v.toFixed(1);
  renderFrnCoachingStaff();
}

function frnSubmitContract() {
  const d = _frnCoachContractDraft;
  if (!d) return;
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff) return;
  const role = d.slot;
  if (d.kind === "extend") {
    const coach = staff[role];
    if (!coach) { _frnCoachContractDraft = null; return; }
    _coachApplyContract(coach, d.aav, d.years, d.sb, role);
    _pushNews({ type:"coach_hire",
      label: `📝 Extended ${role.toUpperCase()} ${coach.name} — $${d.aav}M/yr · ${d.years} yrs · $${d.sb}M SB${d.isLoyal?" (hometown)":""}` });
  } else if (d.kind === "hire") {
    const market = franchise._coachMarket || [];
    const pool = market.filter(c => c.type === role);
    const pick = pool[d.marketIdx];
    if (!pick) { _frnCoachContractDraft = null; return; }
    // For HC slot: the old HC was already fired (dead cap booked) when the
    // user clicked "Browse Market" — staff.hc is null here. For OC/DC slot,
    // the user is hot-swapping a sitting coordinator with someone from the
    // market, so book dead cap + push to FA on the existing coord first.
    if (role === "hc") {
      staff.hc = { ...pick, yearsWithTeam: 0, record: { w:0, l:0, championships:0 } };
      delete staff.hc.type;
      _coachApplyContract(staff.hc, d.aav, d.years, d.sb, "hc");
      staff._chemistry = null;
      _pushNews({ type:"coach_hire", label: `You hired HC ${staff.hc.name} — $${d.aav}M/yr · ${d.years} yrs · $${d.sb}M SB` });
      const _sweepMsgs = _applyHcStaffSweep(staff, "Your team");
      _sweepMsgs.forEach(m => _pushNews(m));
      _coachHireResult = _sweepMsgs.length
        ? _sweepMsgs.map(m => m.label).join(" · ")
        : `No coordinator changes — ${staff.oc?.name || "OC"} and ${staff.dc?.name || "DC"} retained`;
    } else if (role === "oc") {
      if (staff.oc) { _bookCoachDeadCap(myId, staff.oc, "oc"); _coachFAAdd(staff.oc, "oc"); }
      if (staff._chemistry) staff._chemistry.qbOcBond = false;
      staff.oc = { ...pick, yearsWithTeam: 0 };
      delete staff.oc.type;
      _coachApplyContract(staff.oc, d.aav, d.years, d.sb, "oc");
      _pushNews({ type:"coach_hire", label: `You hired OC ${staff.oc.name} — $${d.aav}M/yr · ${d.years} yrs · $${d.sb}M SB` });
    } else if (role === "dc") {
      if (staff.dc) { _bookCoachDeadCap(myId, staff.dc, "dc"); _coachFAAdd(staff.dc, "dc"); }
      staff.dc = { ...pick, yearsWithTeam: 0 };
      delete staff.dc.type;
      _coachApplyContract(staff.dc, d.aav, d.years, d.sb, "dc");
      _pushNews({ type:"coach_hire", label: `You hired DC ${staff.dc.name} — $${d.aav}M/yr · ${d.years} yrs · $${d.sb}M SB` });
    }
    const globalIdx = market.indexOf(pick);
    if (globalIdx !== -1) market.splice(globalIdx, 1);
  }
  _frnCoachContractDraft = null;
  saveFranchise();
  renderFrnCoachingStaff();
}

// Compact contract breakdown — AAV / signing bonus / cap hit / dead cap if fired.
// Adds a tooltip with the per-year base schedule and escalator package.
function _renderCoachContractBlock(coach, role) {
  if (!coach) return "";
  const aav = coach.aav ?? coach.salary ?? 0;
  const yrsLeft = coach.contractYears || 0;
  const sb = coach.signingBonus || 0;
  const proration = coach.bonusProration || 0;
  const capHit = _coachCapHit(coach);
  const dead = _coachDeadCapOnFire(coach);
  const baseSched = (coach.baseSalaries || []).map((b,i) => `Yr${i+1}: $${(+b).toFixed(1)}M base + $${proration.toFixed(2)}M prorate = $${(b+proration).toFixed(2)}M`).join("\n");
  const escList = (coach.escalators || []).map(e => `• ${e.label || e.kind}`).join("\n");
  const tooltip = `Per-year cap:\n${baseSched}\n\nEscalators:\n${escList || "(none)"}`;
  return `
    <div class="frn-coach-contract-block" title="${tooltip.replace(/"/g, '&quot;')}">
      <span><b>$${aav.toFixed(1)}M</b>/yr · ${yrsLeft}yr left</span>
      <span class="sep">·</span>
      <span>SB <b>$${sb.toFixed(1)}M</b></span>
      <span class="sep">·</span>
      <span>Cap hit <b>$${capHit.toFixed(2)}M</b></span>
      ${dead > 0 ? `<span class="sep">·</span><span class="dead">Dead cap if fired: $${dead.toFixed(1)}M</span>` : ""}
    </div>`;
}

// Renders the inline contract editor panel. Returns "" when no draft active.
function _renderContractEditor() {
  const d = _frnCoachContractDraft;
  if (!d) return "";
  const proration = d.sb > 0 ? +(d.sb / d.years).toFixed(2) : 0;
  const basePerYr = +Math.max(0.5, d.aav - proration).toFixed(2);
  const capHit    = +(basePerYr + proration).toFixed(2);
  const total     = +(d.aav * d.years).toFixed(1);
  const deadCap   = +(proration * d.years).toFixed(2);
  const kindLabel = d.kind === "extend" ? "Extend" : "Hire";
  const roleLabel = d.slot.toUpperCase();
  return `
    <div class="frn-coach-contract-editor">
      <div class="frn-coach-contract-editor-head">
        <span class="frn-coach-contract-editor-title">${kindLabel} ${roleLabel}: ${d.coachName}${d.isLoyal?` <span style="font-size:.6rem;color:var(--gold)">🏠 Loyal</span>`:""}</span>
        <button class="frn-coach-contract-editor-close" onclick="frnCloseContractEditor()">×</button>
      </div>
      <div class="frn-coach-contract-editor-grid">
        <label>AAV ($M)<input type="number" min="0.5" step="0.1" value="${d.aav}" onchange="frnContractDraftSet('aav', this.value)"></label>
        <label>Years<input type="number" min="1" max="7" step="1" value="${d.years}" onchange="frnContractDraftSet('years', this.value)"></label>
        <label>Signing Bonus ($M)<input type="number" min="0" step="0.1" value="${d.sb}" onchange="frnContractDraftSet('sb', this.value)"></label>
      </div>
      <div class="frn-coach-contract-editor-summary">
        <span><b>Total $${total}M</b> over ${d.years} yr${d.years===1?"":"s"}</span>
        <span>Base $${basePerYr}M/yr + proration $${proration.toFixed(2)}M/yr</span>
        <span><b>Cap hit $${capHit}M/yr</b></span>
        <span class="dead">Dead cap if fired today: $${deadCap.toFixed(2)}M</span>
      </div>
      <div class="frn-coach-contract-editor-escalators">
        <div class="esc-head">Escalator package</div>
        ${_coachDefaultEscalators(d.slot).map(esc => `
          <div class="esc-row"><span class="esc-dot"></span>${esc.label}</div>
        `).join("")}
      </div>
      <div class="frn-coach-contract-editor-actions">
        <button class="btn btn-outline" onclick="frnCloseContractEditor()">Cancel</button>
        <button class="btn btn-gold" onclick="frnSubmitContract()">${d.kind === "extend" ? "Submit Extension" : "Submit Offer"}</button>
      </div>
    </div>`;
}

// Vacancy decision panel — shown after user confirms releasing the HC.
// The old HC is still in staff.hc here; each path fires them as part of its action.
function _renderHcVacancyPanel() {
  const myId   = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const staff  = franchise.coaches?.[myId] || {};
  const oldHc  = staff.hc;
  const oc     = staff.oc;
  const dc     = staff.dc;
  // Generate emergency market if the offseason carousel hasn't run yet
  if (typeof _ensureCoachMarket === "function") _ensureCoachMarket();
  const mktHcs = (franchise._coachMarket || []).filter(c => c.type === "hc");

  const ratingColor = r => r >= 80 ? "var(--green-lt)" : r >= 65 ? "var(--gold)" : "var(--red)";
  const ratingBadge = r => r != null
    ? `<span style="font-size:.7rem;font-weight:700;padding:.15rem .45rem;border-radius:3px;background:${ratingColor(r)};color:#000">${r}</span>`
    : "";
  const riskNote = r =>
    r < 50 ? `<div style="font-size:.64rem;color:var(--red);margin:.25rem 0">High-risk promotion — rating only ${r}</div>`
    : r < 65 ? `<div style="font-size:.64rem;color:var(--gold);margin:.25rem 0">Risky promotion — rating only ${r}</div>`
    : "";

  const coordCard = (coord, fromSlot, specialty, otherSlot) => {
    if (!coord) return `<div class="frn-coach-card" style="opacity:.35;font-size:.7rem;font-style:italic;padding:.6rem 1rem">No ${fromSlot.toUpperCase()} on staff to promote</div>`;
    const schemeKey = fromSlot === "oc" ? OFF_SCHEME_MAP[coord.trait] : DEF_SCHEME_MAP[coord.trait];
    const schemeRole = fromSlot === "oc" ? "off" : "def";
    const schemeHtml = schemeKey
      ? `<div style="margin:.3rem 0">${_schemeBadge(schemeKey, true)}</div>
         ${_schemePreviewHtml(schemeRole, schemeKey, myId)}`
      : "";
    return `
    <div class="frn-coach-card" style="border-color:rgba(255,255,255,.22)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:.85rem;font-weight:700;color:var(--white)">${coord.name} ${ratingBadge(coord.rating)}</div>
          <div style="font-size:.63rem;color:var(--gray);margin:.1rem 0">${fromSlot.toUpperCase()} · ${coord.trait||"—"} · ${coord.yearsWithTeam||0} yr${(coord.yearsWithTeam||0)===1?"":"s"} w/team</div>
        </div>
      </div>
      ${riskNote(coord.rating || 60)}
      ${schemeHtml}
      <div style="font-size:.67rem;color:var(--gray);line-height:1.7;margin:.4rem 0">
        Becomes HC · <b style="color:var(--white)">${specialty}</b> specialty<br>
        Always hires new ${fromSlot.toUpperCase()} from their network<br>
        40% chance also replaces ${otherSlot.toUpperCase()}<br>
        Chemistry <b style="color:var(--green-lt)">preserved</b> — knows the staff
      </div>
      <button class="btn btn-outline" style="font-size:.7rem"
        onclick="frnPromoteCoordinator('${fromSlot}')">Promote to Head Coach</button>
    </div>`;
  };

  $("frnHomeContent").innerHTML = `
    <div style="max-width:500px;margin:0 auto;padding:.5rem 0">
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.6rem">
        <button class="btn btn-outline" onclick="renderFrnCoachingStaff()" style="font-size:.7rem;padding:.2rem .6rem">← Cancel</button>
        <div style="font-size:1rem;font-weight:700;color:var(--gold)">${myTeam?.city} ${myTeam?.name} — HC Vacancy</div>
      </div>
      <div style="font-size:.7rem;color:var(--gray);margin-bottom:.8rem">
        Releasing <b style="color:var(--white)">${oldHc?.name || "head coach"}</b>.
        How do you want to fill the position?
      </div>
      <div class="frn-sec-title">Promote from Within</div>
      ${coordCard(oc, "oc", "Offensive Minded", "dc")}
      ${coordCard(dc, "dc", "Defensive Minded", "oc")}
      <div class="frn-sec-title" style="margin-top:.9rem">Outside Hire</div>
      <div class="frn-coach-card" style="border-color:rgba(255,255,255,.22)">
        <div style="font-size:.85rem;font-weight:700;color:var(--white)">
          Hire from Market
          <span style="font-size:.65rem;font-weight:400;color:var(--gray);margin-left:.5rem">${mktHcs.length} candidate${mktHcs.length===1?"":"s"} available</span>
        </div>
        <div style="font-size:.67rem;color:var(--gray);line-height:1.7;margin:.4rem 0">
          You pick the HC from available candidates<br>
          <b>75%</b> chance new HC replaces OC with their guy<br>
          <b>40%</b> chance new HC replaces DC with their guy<br>
          Chemistry <b style="color:var(--red)">resets</b> — outside hire, no prior relationships
        </div>
        <button class="btn btn-outline" style="font-size:.7rem" onclick="frnBrowseHcMarket()">
          Browse Head Coach Market
        </button>
      </div>
    </div>`;
}

// Promotes OC or DC to HC. Fires old HC, builds new HC from the coordinator,
// fills the vacated slot from new HC's network, and 40% chance replaces the other
// coordinator. Chemistry is preserved — internal promotion keeps staff relationships.
function frnPromoteCoordinator(fromSlot) {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff) return;
  const coord = staff[fromSlot];
  if (!coord) return;

  const oldHcName = staff.hc?.name;
  if (oldHcName) _pushNews({ type:"coach_depart", label: `🚪 HC ${oldHcName} released` });
  _bookCoachDeadCap(myId, staff.hc, "hc");
  _coachFAAdd(staff.hc, "hc");

  const promotedAav   = +((coord.salary || 1.5) * 1.5).toFixed(1);
  const promotedYears = 3 + Math.floor(Math.random() * 2);
  const promotedSb    = +(promotedAav * promotedYears * COACH_SB_PCT.hc * 0.85).toFixed(1);
  staff.hc = {
    name:          coord.name,
    rating:        Math.min(89, (coord.rating || 60) + Math.floor(Math.random() * 5)),
    cultureTrait:  HC_CULTURE_TRAITS[Math.floor(Math.random() * HC_CULTURE_TRAITS.length)].key,
    specialtyTrait: fromSlot === "oc" ? "Offensive Minded" : "Defensive Minded",
    age:           coord.age || 45,
    yearsWithTeam: 0,
    record:        { w:0, l:0, championships:0 },
  };
  _coachApplyContract(staff.hc, promotedAav, promotedYears, promotedSb, "hc");
  _pushNews({ type:"coach_hire",
    label: `🏟 Your team promoted ${fromSlot.toUpperCase()} ${coord.name} to head coach` });

  // Vacated slot always filled from new HC's network
  const isOC = fromSlot === "oc";
  if (isOC) {
    if (staff._chemistry) staff._chemistry.qbOcBond = false;
    staff.oc = _rollOC();
  } else {
    staff.dc = _rollDC();
  }
  _pushNews({ type:"coach_hire",
    label: `🏟 New HC ${staff.hc.name} hires ${fromSlot.toUpperCase()} ${staff[fromSlot].name} from their network` });

  // 40% chance: also replaces the other coordinator
  const otherSlot = isOC ? "dc" : "oc";
  if (Math.random() < 0.40) {
    const oldOtherName = staff[otherSlot]?.name;
    if (isOC) {
      staff.dc = _rollDC();
    } else {
      if (staff._chemistry) staff._chemistry.qbOcBond = false;
      staff.oc = _rollOC();
    }
    _pushNews({ type:"coach_hire",
      label: `🏟 New HC also installs ${otherSlot.toUpperCase()} ${staff[otherSlot].name}${oldOtherName ? ` (replaces ${oldOtherName})` : ""}` });
  }
  // _chemistry NOT nulled — internal promotions preserve existing staff relationships

  saveFranchise();
  renderFrnCoachingStaff();
}

// Fires the current HC and re-renders the staff page in vacancy state.
// The HC market candidates at the bottom let the user pick their replacement.
function frnBrowseHcMarket() {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff) return;
  const oldName = staff.hc?.name;
  _bookCoachDeadCap(myId, staff.hc, "hc");
  _coachFAAdd(staff.hc, "hc");
  staff.hc         = null;
  staff._chemistry = null;
  if (oldName) _pushNews({ type:"coach_depart", label: `🚪 HC ${oldName} released` });
  // Switch to the market sub-tab so candidates are visible.
  _frnCoachesSubTab = "market";
  saveFranchise();
  renderFrnCoachingStaff();
}

// Opens the contract editor so the user can set AAV / Years / Signing Bonus
// before the hire fires. Submit path is frnSubmitContract().
function frnHireCoachFromMarket(slot, marketIdx) {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff) return;
  const market = franchise._coachMarket || [];
  const pool = market.filter(c => c.type === slot);
  if (!pool[marketIdx]) return;
  _frnOpenContractEditor(slot, "hire", marketIdx);
}

function frnHirePositionCoach(group) {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff) return;
  if ((staff.positionStaff||[]).length >= 3) {
    alert("You already have 3 position coaches. Upgrade one instead.");
    return;
  }
  _posCoachBrowseGroup = group;
  renderFrnCoachingStaff();
}

function frnHirePositionCoachFromPool(group, filteredIdx) {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff) return;
  if (!staff.positionStaff) staff.positionStaff = [];
  if (staff.positionStaff.length >= 3) { alert("Already have 3 position coaches."); return; }
  const pool     = franchise._posCoachPool || [];
  const filtered = pool.filter(c => c.group === group);
  const candidate = filtered[filteredIdx];
  if (!candidate) return;
  const poolIdx = pool.findIndex(c =>
    c.group === candidate.group && c.name === candidate.name && c.retiredSeason === candidate.retiredSeason
  );
  if (poolIdx !== -1) pool.splice(poolIdx, 1);
  franchise._posCoachPool = pool;
  const yearsOut = Math.max(0, (franchise.season || 1) - (candidate.retiredSeason || franchise.season || 1));
  staff.positionStaff.push({
    name: candidate.name, group: candidate.group,
    rating: candidate.rating || 60,
    tier: candidate.tier, salary: candidate.salary,
    isFormerPlayer: candidate.isFormerPlayer,
    formerPos: candidate.formerPos, peakOvr: candidate.peakOvr,
    proBowls: candidate.proBowls || 0, allPros: candidate.allPros || 0, sbRings: candidate.sbRings || 0,
    careerStatLine: candidate.careerStatLine || "", careerYears: candidate.careerYears || 0,
    age: (candidate.retiredAge || 32) + yearsOut,
    yearsWithTeam: 0,
  });
  _pushNews({ type:"coach_hire",
    label: `Hired ${group} coach ${candidate.name}${candidate.isFormerPlayer ? ` (former ${candidate.formerPos} · Pk ${candidate.peakOvr})` : ""} · ${candidate.tier}` });
  _posCoachBrowseGroup = null;
  saveFranchise();
  renderFrnCoachingStaff();
}

function frnScoutRandomPositionCoach(group) {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff) return;
  if (!staff.positionStaff) staff.positionStaff = [];
  if (staff.positionStaff.length >= 3) { alert("Already have 3 position coaches."); return; }
  const newCoach = _rollPositionCoach(group);
  staff.positionStaff.push(newCoach);
  _pushNews({ type:"coach_hire", label: `Scouted ${group} coach ${newCoach.name} (${newCoach.tier})` });
  _posCoachBrowseGroup = null;
  saveFranchise();
  renderFrnCoachingStaff();
}

async function frnUpgradePositionCoach(group) {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff) return;
  const tiers = Object.keys(POSITION_COACH_TIERS);
  const idx = (staff.positionStaff || []).findIndex(s => s.group === group);
  if (idx === -1) { frnHirePositionCoach(group); return; }
  const cur = staff.positionStaff[idx];
  const curTierIdx = tiers.indexOf(cur.tier);
  if (curTierIdx >= tiers.length - 1) {
    alert(`${group} coach is already at Elite tier.`);
    return;
  }
  const nextTier = tiers[curTierIdx + 1];
  const cost = POSITION_COACH_TIERS[nextTier].salary;
  const budgetAfter = (typeof coachingBudgetUsed === "function" ? coachingBudgetUsed(myId) : 0)
                    - (cur.salary || 0) + cost;
  const capWarn = budgetAfter > 15
    ? `\n⚠ Coaching budget will be $${budgetAfter.toFixed(1)}M — overage penalizes player cap.` : "";
  if (!await _frnConfirm(`Promote ${group} coach ${cur.name} to ${nextTier} tier?\n$${cost}M/yr${capWarn}`)) return;
  cur.tier   = nextTier;
  cur.salary = cost;
  _pushNews({ type:"coach_hire", label: `Promoted ${group} coach ${cur.name} to ${nextTier} tier` });
  saveFranchise();
  renderFrnCoachingStaff();
}

async function frnReleasePositionCoach(group) {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff?.positionStaff) return;
  const idx = staff.positionStaff.findIndex(s => s.group === group);
  if (idx === -1) return;
  const coach = staff.positionStaff[idx];
  if (!await _frnConfirm(`Release ${group} coach ${coach.name}? They will enter the coaching pool.`)) return;
  staff.positionStaff.splice(idx, 1);
  if (!franchise._posCoachPool) franchise._posCoachPool = [];
  franchise._posCoachPool.push({ ...coach, retiredSeason: franchise.season || 1 });
  _pushNews({ type:"coach_depart", label: `Released ${group} coach ${coach.name} — now available to hire` });
  saveFranchise();
  renderFrnCoachingStaff();
}

async function frnPromotePositionCoach(group) {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff?.positionStaff) return;
  const idx = staff.positionStaff.findIndex(s => s.group === group);
  if (idx === -1) return;
  const pc = staff.positionStaff[idx];
  const { type, coord } = _posCoachToCoord(pc, myId);
  const label = type === "oc" ? "OC" : "DC";
  const existingName = staff[type]?.name || "current coordinator";
  const loyalNote = coord.developedByTeamId === myId ? "\n🏠 Developing them here gives a hometown discount on future extensions." : "";
  if (!await _frnConfirm(
    `Promote ${pc.group} coach ${pc.name} to ${label}?\n` +
    `PC rating ${pc.rating || "?"} → ${label} rating ${coord.rating} · $${coord.salary}M/yr\n` +
    `Trait: ${coord.trait}\n` +
    `This replaces ${existingName} and opens your ${group} slot.${loyalNote}`
  )) return;
  _coachFAAdd(staff[type], type);
  if (type === "oc" && staff._chemistry) staff._chemistry.qbOcBond = false;
  staff[type] = { ...coord };
  staff._chemistry = null;
  staff.positionStaff.splice(idx, 1);
  _pushNews({ type:"coach_hire",
    label: `🏟 Promoted ${group} coach ${pc.name} to ${label} (rating ${coord.rating} · ${coord.trait})` });
  saveFranchise();
  renderFrnCoachingStaff();
}

