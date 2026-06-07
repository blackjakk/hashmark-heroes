import React from "react";

/**
 * Renders a team's optional ASCII mark, or falls back to its abbreviation
 * inside a styled placeholder. Color comes from team.primaryColor; consumers
 * can pass a `size` override.
 *
 * Props:
 *   - team: BSPNTeam
 *   - size?: number  — pixel size of the square (default 80)
 */
export default function TeamAsciiMark({ team, size }) {
  if (!team) return null;
  const sz = size || 80;
  const style = {
    width: sz, height: sz,
    "--team-color": team.primaryColor,
  };
  if (team.asciiMark) {
    return (
      <pre className="bspn-summary-team-mark" style={style}>
        {team.asciiMark}
      </pre>
    );
  }
  return (
    <div className="bspn-summary-team-mark" style={style}>
      <span style={{ fontFamily: '"Bebas Neue","Anton",sans-serif', fontSize: ".95rem", letterSpacing: "2px" }}>
        {team.abbreviation}
      </span>
    </div>
  );
}
