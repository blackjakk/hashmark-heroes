import React from "react";
import BSPNPanel from "./BSPNPanel.jsx";

/**
 * Scoring summary table: Quarter / Time / Team / Play / Score.
 *
 * Props:
 *   - plays: BSPNScoringPlay[]
 *   - teamsById: { [id]: BSPNTeam } — needed for team abbreviation + color
 */
export default function ScoringSummaryPanel({ plays, teamsById }) {
  const rows = plays || [];
  return (
    <BSPNPanel title="SCORING SUMMARY">
      <table className="bspn-scoring-table">
        <thead>
          <tr>
            <th>QTR</th>
            <th>TIME</th>
            <th>TEAM</th>
            <th>PLAY (SCORER)</th>
            <th style={{ textAlign: "right" }}>SCORE</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((p, i) => {
            const team = teamsById?.[p.teamId];
            return (
              <tr key={`${p.period}-${p.time}-${i}`}>
                <td className="qtr">{p.period}</td>
                <td className="time">{p.time}</td>
                <td className="team" style={{ color: team?.primaryColor }}>
                  {team?.abbreviation || ""}
                </td>
                <td>{p.description}</td>
                <td className="score">{p.scoreText}</td>
              </tr>
            );
          }) : (
            <tr><td colSpan={5} style={{ color: "var(--gray)", fontStyle: "italic", textAlign: "center" }}>
              No scoring events.
            </td></tr>
          )}
        </tbody>
      </table>
      <div className="bspn-scoring-legend">
        TD = TOUCHDOWN &nbsp;&nbsp; FG = FIELD GOAL &nbsp;&nbsp; XP = EXTRA POINT
      </div>
    </BSPNPanel>
  );
}
