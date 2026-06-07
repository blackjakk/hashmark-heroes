import React from "react";
import BSPNPanel from "./BSPNPanel.jsx";

/**
 * Right-rail game notes bullet list.
 *
 * Props:
 *   - notes: BSPNGameNote[]
 */
export default function GameNotesPanel({ notes }) {
  return (
    <BSPNPanel title="GAME NOTES">
      {notes && notes.length ? (
        <ul className="bspn-notes">
          {notes.map(n => <li key={n.id}>{n.text}</li>)}
        </ul>
      ) : (
        <div style={{ color: "var(--gray)", fontSize: ".7rem", fontStyle: "italic" }}>
          No notes available.
        </div>
      )}
    </BSPNPanel>
  );
}
