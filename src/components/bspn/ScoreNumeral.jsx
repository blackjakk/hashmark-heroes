import React from "react";

/**
 * Giant broadcast scoreboard numeral. NOT monospace — uses condensed heavy
 * sans (Anton/Teko/Impact). Use only for headline scores; normal stats stay
 * in the monospace stack defined in bspn.css.
 *
 * Props:
 *   - value: number | string
 *   - color?: string  — optional team-tint (CSS color)
 *   - muted?: boolean — show as losing-team grey
 */
export default function ScoreNumeral({ value, color, muted }) {
  const cls = `bspn-score-numeral${muted ? " muted" : ""}`;
  const style = color && !muted ? { "--num-color": color } : undefined;
  return (
    <span className={cls} style={style}>
      {value}
    </span>
  );
}
