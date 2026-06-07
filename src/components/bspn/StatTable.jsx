import React from "react";

/**
 * Generic stat table for box-score groups.
 *
 * Props:
 *   - group: BSPNStatGroup — { title, columns, rows }
 *   - titleAccent?: string — color applied to the group title
 *   - emptyText?: string — shown if no rows
 */
export default function StatTable({ group, titleAccent, emptyText }) {
  if (!group) return null;
  const { title, columns = [], rows = [] } = group;
  return (
    <div className="bspn-stat-group">
      {title ? (
        <div className="bspn-stat-group-title" style={titleAccent ? { color: titleAccent } : undefined}>
          <span>{title}</span>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <div style={{ color: "var(--gray)", fontSize: ".68rem", fontStyle: "italic" }}>
          {emptyText || "No stats recorded."}
        </div>
      ) : (
        <table className="bspn-stat-table">
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key} data-align={c.align || "left"}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                {columns.map(c => (
                  <td key={c.key} data-align={c.align || "left"}>{r.cells?.[c.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
