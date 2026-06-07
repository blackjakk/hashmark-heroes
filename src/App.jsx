import React, { useMemo, useState } from "react";
import { useWallet } from "./hooks/useWallet.js";
import { useContracts } from "./hooks/useContracts.js";
import WalletConnect from "./components/WalletConnect.jsx";
import Dashboard     from "./components/Dashboard.jsx";
import TeamManager   from "./components/TeamManager.jsx";
import DraftRoom     from "./components/DraftRoom.jsx";
import FreeAgencyMarket from "./components/FreeAgencyMarket.jsx";
import GameViewer    from "./components/GameViewer.jsx";
import Standings     from "./components/Standings.jsx";
import BSPNBoxScorePage from "./components/bspn/BSPNBoxScorePage.jsx";
import { buildMockBoxScore } from "./mock/bspnBoxScoreMock.js";

const TABS = [
  { id: "dashboard", label: "🏠 Dashboard" },
  { id: "teams",     label: "🏟️ Teams" },
  { id: "draft",     label: "📋 Draft" },
  { id: "fa",        label: "💰 Free Agency" },
  { id: "game",      label: "🏈 Simulate" },
  { id: "standings", label: "📊 Standings" },
  { id: "bspn",      label: "📺 BSPN" },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [bspnSeed, setBspnSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const bspnData = useMemo(() => buildMockBoxScore(bspnSeed), [bspnSeed]);
  const wallet        = useWallet();
  const contracts     = useContracts(wallet.signer || wallet.provider);

  // The BSPN page is full-bleed (has its own header + scoped CSS). Render it
  // outside the app chrome so its broadcast aesthetic isn't fighting the
  // existing nav.
  if (tab === "bspn") {
    return (
      <BSPNBoxScorePage
        data={bspnData}
        onBack={() => setTab("dashboard")}
        onNavigate={(item) => {
          // Re-roll the mock when nav is clicked, so reviewers can quickly
          // see the layout against several teams + scores.
          if (item === "Scores" || item === "Box Score") {
            setBspnSeed(Math.floor(Math.random() * 1e9));
          }
        }}
      />
    );
  }

  return (
    <div className="app">
      <nav className="nav">
        <a className="nav-logo" href="#">Gridiron<span>Chain</span></a>
        <div className="nav-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`nav-tab${tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="nav-wallet">
          <WalletConnect wallet={wallet} contracts={contracts} />
        </div>
      </nav>

      <main className="main">
        {tab === "dashboard" && <Dashboard  wallet={wallet} contracts={contracts} />}
        {tab === "teams"     && <TeamManager wallet={wallet} contracts={contracts} />}
        {tab === "draft"     && <DraftRoom   wallet={wallet} contracts={contracts} />}
        {tab === "fa"        && <FreeAgencyMarket wallet={wallet} contracts={contracts} />}
        {tab === "game"      && <GameViewer  wallet={wallet} contracts={contracts} />}
        {tab === "standings" && <Standings   wallet={wallet} contracts={contracts} />}
      </main>
    </div>
  );
}
