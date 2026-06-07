import React, { useMemo } from "react";

import "./bspn.css";

import BSPNHeader from "./BSPNHeader.jsx";
import GameSummaryStrip from "./GameSummaryStrip.jsx";
import TeamComparisonPanel from "./TeamComparisonPanel.jsx";
import TeamBoxScorePanel from "./TeamBoxScorePanel.jsx";
import ScoringSummaryPanel from "./ScoringSummaryPanel.jsx";
import LeadersPanel from "./LeadersPanel.jsx";
import GameNotesPanel from "./GameNotesPanel.jsx";
import BSPNFooter from "./BSPNFooter.jsx";

/**
 * BSPN box-score page. Pure presentation — consumes only BSPNBoxScoreData.
 * The adapter (or mock) decides what data to pass; this component renders
 * it in the broadcast layout.
 *
 * Props:
 *   - data: BSPNBoxScoreData
 *   - onBack?: () => void
 *   - onNavigate?: (navItem: string) => void
 */
export default function BSPNBoxScorePage({ data, onBack, onNavigate }) {
  if (!data) return null;

  const {
    summary, comparisonStats,
    awayBoxScoreGroups, homeBoxScoreGroups,
    scoringSummary, leaderGroups, topPerformers, gameNotes,
  } = data;

  // Lookup map for rendering team color/abbr in scoring summary + leaders.
  const teamsById = useMemo(() => {
    if (!summary) return {};
    return {
      [summary.awayTeam.id]: summary.awayTeam,
      [summary.homeTeam.id]: summary.homeTeam,
    };
  }, [summary]);

  // Page-level CSS vars for team accent colors. Children can opt in via
  // `var(--away-color)` / `var(--home-color)` without prop drilling.
  const rootStyle = summary
    ? { "--away-color": summary.awayTeam.primaryColor,
        "--home-color": summary.homeTeam.primaryColor }
    : undefined;

  return (
    <div className="bspn-root" style={rootStyle}>
      <BSPNHeader activeItem="Box Score" onNavigate={onNavigate} />
      <div className="bspn-subbar">
        <button type="button" className="bspn-back" onClick={onBack}>
          ‹ ALL SCORES
        </button>
      </div>

      <div className="bspn-container">
        <GameSummaryStrip summary={summary} />

        <div className="bspn-grid">
          {/* Left column */}
          <div>
            <TeamComparisonPanel
              comparisonStats={comparisonStats}
              awayTeam={summary.awayTeam}
              homeTeam={summary.homeTeam}
            />

            <div className="bspn-teams-row">
              <TeamBoxScorePanel
                team={summary.awayTeam}
                groups={awayBoxScoreGroups}
              />
              <TeamBoxScorePanel
                team={summary.homeTeam}
                groups={homeBoxScoreGroups}
              />
            </div>
          </div>

          {/* Right rail */}
          <aside>
            {(leaderGroups || []).map((g, i) => (
              <LeadersPanel
                key={`${g.title}-${i}`}
                group={g}
                teamsById={teamsById}
              />
            ))}
            {topPerformers ? (
              <LeadersPanel group={topPerformers} teamsById={teamsById} />
            ) : null}
            <ScoringSummaryPanel plays={scoringSummary} teamsById={teamsById} />
            <GameNotesPanel notes={gameNotes} />
          </aside>
        </div>
      </div>

      <BSPNFooter />
    </div>
  );
}
