import React from "react";
import BSPNPanel from "./BSPNPanel.jsx";

/**
 * Right-rail leader card. Renders one BSPNLeaderGroup with rows of
 * (helmet placeholder / category / name / team / stat line).
 *
 * Props:
 *   - group: BSPNLeaderGroup
 *   - teamsById: { [id]: BSPNTeam }
 */
export default function LeadersPanel({ group, teamsById }) {
  if (!group) return null;
  const { title, rows } = group;
  return (
    <BSPNPanel title={title} accentColor="gold">
      {rows && rows.length ? rows.map((r, i) => {
        const team = teamsById?.[r.teamId];
        return (
          <div
            className="bspn-leader-row"
            key={`${r.label || ""}-${r.playerName}-${i}`}
            style={team ? { "--team-color": team.primaryColor } : undefined}
          >
            <div className="bspn-leader-helm">
              {team?.abbreviation || "—"}
            </div>
            <div className="bspn-leader-meta">
              {r.label ? <div className="bspn-leader-cat">{r.label}</div> : null}
              <div>
                <span className="bspn-leader-name">
                  {r.jersey ? `#${r.jersey} ` : ""}
                  {r.playerName}
                </span>
                {team ? (
                  <span className="bspn-leader-team">{team.abbreviation}</span>
                ) : null}
              </div>
              <div className="bspn-leader-stat">{r.statLine}</div>
            </div>
          </div>
        );
      }) : (
        <div style={{ color: "var(--gray)", fontSize: ".7rem", fontStyle: "italic" }}>
          No leaders available.
        </div>
      )}
    </BSPNPanel>
  );
}
