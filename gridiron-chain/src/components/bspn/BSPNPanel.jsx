import React from "react";

/**
 * Box-bordered panel with a colored title strip. Children render in the body.
 *
 * Props:
 *   - title: string
 *   - accentColor?: "gold" | "terminal" — color of the title text
 *   - style?: extra inline styles for the outer panel
 *   - children
 */
export default function BSPNPanel({ title, accentColor, style, children }) {
  const accentClass = accentColor === "gold" ? "accent-gold" : "";
  return (
    <section className="bspn-panel" style={style}>
      {title ? (
        <div className={`bspn-panel-title ${accentClass}`}>{title}</div>
      ) : null}
      {children}
    </section>
  );
}
