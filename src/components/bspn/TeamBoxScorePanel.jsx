import React from "react";
import BSPNPanel from "./BSPNPanel.jsx";
import StatTable from "./StatTable.jsx";

/**
 * Team box-score panel: renders all stat groups (Passing / Rushing /
 * Receiving / Defense / Kicking — whatever data provides) for a single team.
 *
 * Props:
 *   - team: BSPNTeam
 *   - groups: BSPNStatGroup[]
 */
export default function TeamBoxScorePanel({ team, groups }) {
  if (!team) return null;
  return (
    <BSPNPanel
      style={{ "--team-color": team.primaryColor }}
    >
      <div className="bspn-team-box-head">
        <div className="bspn-team-box-name">{team.name?.toUpperCase()}</div>
        {team.record ? <div className="bspn-team-box-record">{team.record}</div> : null}
      </div>
      {(groups || []).map(g => (
        <StatTable key={g.title} group={g} titleAccent={team.primaryColor} />
      ))}
      {(!groups || !groups.length) ? (
        <div style={{ color: "var(--gray)", fontSize: ".7rem", fontStyle: "italic" }}>
          No per-player stats recorded for this game.
        </div>
      ) : null}
    </BSPNPanel>
  );
}
