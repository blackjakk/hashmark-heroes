import React from "react";
import { POSITION_LABEL } from "../contracts/abis.js";

const TIER_CLASS = (ovr) =>
  ovr >= 85 ? "elite" : ovr >= 72 ? "good" : ovr >= 58 ? "average" : "poor";

export function OvrCircle({ overall }) {
  const cls = TIER_CLASS(Number(overall));
  return (
    <div className={`ovr ovr-${cls}`}>{overall}</div>
  );
}

export function StatBar({ value, max = 99 }) {
  const pct   = Math.round((Number(value) / max) * 100);
  const cls   = pct >= 85 ? "elite" : pct >= 72 ? "good" : pct >= 58 ? "average" : "poor";
  return (
    <div className="rating-bar">
      <div className={`rating-fill ${cls}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function statRows(position, stats) {
  const pos = typeof position === "number" ? POSITION_LABEL[position] : position;
  const base = [
    ["SPD", stats.speed], ["STR", stats.strength],
    ["AGI", stats.agility], ["AWR", stats.awareness],
  ];
  const extra = {
    QB:  [["THP", stats.throwing]],
    RB:  [["CAT", stats.catching]],
    WR:  [["CAT", stats.catching]],
    TE:  [["CAT", stats.catching], ["BLK", stats.blocking]],
    OL:  [["BLK", stats.blocking]],
    DL:  [["PRS", stats.passRush], ["TCK", stats.tackle]],
    LB:  [["PRS", stats.passRush], ["COV", stats.coverage], ["TCK", stats.tackle]],
    CB:  [["COV", stats.coverage], ["TCK", stats.tackle]],
    S:   [["COV", stats.coverage], ["TCK", stats.tackle]],
    K:   [["KPW", stats.kickPower]],
    P:   [["KPW", stats.kickPower]],
  }[pos] || [];
  return [...base, ...extra];
}

export default function PlayerCard({ player, actions, compact = false }) {
  if (!player) return null;

  const posLabel = typeof player.position === "number"
    ? POSITION_LABEL[player.position]
    : player.position;

  const ovr = Number(player.overall);
  const tierCls = TIER_CLASS(ovr);

  if (compact) {
    return (
      <div className="card card-sm" style={{ display: "flex", gap: ".75rem", alignItems: "center" }}>
        <OvrCircle overall={ovr} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: ".9rem" }}>{player.name}</div>
          <div style={{ fontSize: ".75rem", color: "var(--gray)" }}>
            {posLabel} · Age {player.age} · {player.salary?.toString() ? `${(Number(player.salary) / 1e18).toLocaleString()} GRID/season` : ""}
          </div>
        </div>
        {actions}
      </div>
    );
  }

  const rows = statRows(posLabel, player.stats || {});

  return (
    <div className="card" style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", marginBottom: ".75rem" }}>
        <OvrCircle overall={ovr} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: "1rem" }}>{player.name}</div>
          <div style={{ display: "flex", gap: ".5rem", marginTop: ".25rem", flexWrap: "wrap" }}>
            <span className={`badge badge-${posLabel === "QB" ? "gold" : "green"}`}>{posLabel}</span>
            <span className="badge badge-gray">Age {player.age}</span>
            {player.contractYears > 0 && <span className="badge badge-green">{player.contractYears}yr</span>}
            <span className={`badge badge-${tierCls === "elite" ? "gold" : tierCls === "good" ? "green" : "gray"}`}>
              {tierCls.toUpperCase()}
            </span>
          </div>
          {player.salary > 0 && (
            <div style={{ fontSize: ".78rem", color: "var(--gray)", marginTop: ".25rem" }}>
              {(Number(player.salary) / 1e18).toLocaleString()} GRID / season
            </div>
          )}
        </div>
      </div>

      <div className="stat-grid">
        {rows.map(([label, val]) => (
          <div key={label}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".75rem", marginBottom: ".1rem" }}>
              <span style={{ color: "var(--gray)" }}>{label}</span>
              <span style={{ fontWeight: 700 }}>{val}</span>
            </div>
            <StatBar value={val} />
          </div>
        ))}
      </div>

      {actions && <div style={{ marginTop: ".75rem" }}>{actions}</div>}
    </div>
  );
}
