import React from "react";

const NAV_ITEMS = ["Scores", "News", "Box Score", "Stats", "Teams", "Standings"];

/**
 * BSPN broadcast-website top bar. Logo on the left, nav across, simple
 * icons on the right.
 *
 * Props:
 *   - activeItem?: string  — defaults to "Box Score"
 *   - onNavigate?: (item) => void
 */
export default function BSPNHeader({ activeItem, onNavigate }) {
  const active = activeItem || "Box Score";
  return (
    <header className="bspn-header" role="banner">
      <div className="bspn-logo" aria-label="BSPN">BSPN</div>
      <nav className="bspn-nav" aria-label="primary">
        {NAV_ITEMS.map(it => (
          <button
            key={it}
            type="button"
            className={`bspn-nav-item${it === active ? " active" : ""}`}
            onClick={() => onNavigate?.(it)}
          >
            {it}
          </button>
        ))}
      </nav>
      <div className="bspn-header-right" aria-hidden="true">
        <span>⌕</span>
        <span>▶ WATCH</span>
        <span>◯</span>
        <span>≡</span>
      </div>
    </header>
  );
}
