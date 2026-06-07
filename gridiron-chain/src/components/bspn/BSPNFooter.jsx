import React from "react";

/**
 * Bottom footer: ASCII football field strips flanking BSPN tagline.
 *
 * Props:
 *   - version?: string (default "v1.0")
 *   - tagline?: string (default "GRIDIRON. CODE. GLORY.")
 */
const LEFT_FIELD =
` x x x x x  ──────  ┊───┊
                 ┊   ┊
 x x x x x  ──────  ┊───┊`;

const RIGHT_FIELD =
` ┊───┊  ──────  x x x x x
 ┊   ┊
 ┊───┊  ──────  x x x x x`;

export default function BSPNFooter({ version, tagline }) {
  return (
    <footer className="bspn-footer" aria-label="footer">
      <pre className="bspn-footer-field">{LEFT_FIELD}</pre>
      <div className="bspn-footer-center">
        BSPN ASCII FOOTBALL {version || "v1.0"}
        <span className="sub">{tagline || "GRIDIRON. CODE. GLORY."}</span>
      </div>
      <pre className="bspn-footer-field right">{RIGHT_FIELD}</pre>
    </footer>
  );
}
