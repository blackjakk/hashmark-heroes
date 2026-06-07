import React from "react";

/**
 * Center-out comparison bar. Left half grows away-color, right half grows
 * home-color, sized relative to the larger of the two values.
 *
 * Props:
 *   - awayValue: number
 *   - homeValue: number
 *   - awayColor: string
 *   - homeColor: string
 */
export default function StatComparisonBar({ awayValue, homeValue, awayColor, homeColor }) {
  const a = Math.max(0, Number(awayValue) || 0);
  const h = Math.max(0, Number(homeValue) || 0);
  const max = Math.max(a, h, 1);
  const aPct = Math.round((a / max) * 100);
  const hPct = Math.round((h / max) * 100);
  return (
    <div className="bspn-comp-bars" aria-hidden="true">
      <div className="bspn-comp-bar-l">
        <span style={{ width: `${aPct}%`, background: awayColor, color: awayColor }} />
      </div>
      <div className="bspn-comp-bar-divider" />
      <div className="bspn-comp-bar-r">
        <span style={{ width: `${hPct}%`, background: homeColor, color: homeColor }} />
      </div>
    </div>
  );
}
