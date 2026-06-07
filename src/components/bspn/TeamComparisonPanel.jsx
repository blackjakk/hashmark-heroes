import React from "react";
import BSPNPanel from "./BSPNPanel.jsx";
import StatComparisonBar from "./StatComparisonBar.jsx";

/**
 * Team stat comparison panel. Each row has label / away val / bars / home val.
 *
 * Props:
 *   - comparisonStats: BSPNComparisonStat[]
 *   - awayTeam: BSPNTeam
 *   - homeTeam: BSPNTeam
 */
export default function TeamComparisonPanel({ comparisonStats, awayTeam, homeTeam }) {
  if (!comparisonStats?.length) {
    return (
      <BSPNPanel title="TEAM STAT COMPARISON">
        <div style={{ color: "var(--gray)", fontSize: ".7rem", fontStyle: "italic" }}>
          No team totals available for this game.
        </div>
      </BSPNPanel>
    );
  }
  return (
    <BSPNPanel title="TEAM STAT COMPARISON">
      {/* Header row: team abbreviations bracketing the bar column */}
      <div className="bspn-comp-row" style={{ borderBottom: "1px solid var(--border-strong)" }}>
        <span className="bspn-comp-label" style={{ color: "var(--gray)" }}>STAT</span>
        <span className="bspn-comp-val left" style={{ color: awayTeam.primaryColor }}>
          {awayTeam.abbreviation}
        </span>
        <span />
        <span className="bspn-comp-val right" style={{ color: homeTeam.primaryColor }}>
          {homeTeam.abbreviation}
        </span>
      </div>
      {comparisonStats.map(s => (
        <div className="bspn-comp-row" key={s.key}>
          <span className="bspn-comp-label">{s.label}</span>
          <span className="bspn-comp-val left bspn-num">{s.awayValue}</span>
          <StatComparisonBar
            awayValue={s.awayBarValue ?? s.awayValue}
            homeValue={s.homeBarValue ?? s.homeValue}
            awayColor={awayTeam.primaryColor}
            homeColor={homeTeam.primaryColor}
          />
          <span className="bspn-comp-val right bspn-num">{s.homeValue}</span>
        </div>
      ))}
    </BSPNPanel>
  );
}
