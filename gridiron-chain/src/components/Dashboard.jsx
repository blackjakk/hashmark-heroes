import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { PHASE_LABEL, POSITION_LABEL } from "../contracts/abis.js";
import TEAMS, { getTeam } from "../data/teams.js";

function StatBox({ label, value, sub }) {
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <div style={{ fontSize: "1.8rem", fontWeight: 900, color: "var(--gold)" }}>{value}</div>
      <div style={{ fontWeight: 700, marginTop: ".25rem" }}>{label}</div>
      {sub && <div style={{ fontSize: ".78rem", color: "var(--gray)", marginTop: ".15rem" }}>{sub}</div>}
    </div>
  );
}

export default function Dashboard({ wallet, contracts }) {
  const { address, isCorrectChain } = wallet;
  const [phase, setPhase]           = useState(null);
  const [season, setSeason]         = useState(null);
  const [gridBal, setGridBal]       = useState("—");
  const [myTeams, setMyTeams]       = useState([]);
  const [available, setAvailable]   = useState(0);
  const [champion, setChampion]     = useState(null);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    if (!contracts || !address) return;
    setLoading(true);
    Promise.all([
      contracts.league.season(),
      contracts.league.phase(),
      contracts.token.balanceOf(address),
      contracts.team.availableTeams(),
    ]).then(([s, p, bal, avail]) => {
      setSeason(Number(s));
      setPhase(Number(p));
      setGridBal(parseFloat(ethers.formatEther(bal)).toLocaleString("en-US", { maximumFractionDigits: 0 }));
      setAvailable(avail.length);

      if (Number(s) > 0) {
        contracts.league.champions(s).then(c => {
          if (Number(c) > 0) setChampion(getTeam(Number(c)));
        }).catch(() => {});
      }
    }).catch(() => {}).finally(() => setLoading(false));

    // My owned teams
    const scanTeams = async () => {
      const owned = [];
      for (let i = 1; i <= 32; i++) {
        try {
          const owner = await contracts.team.ownerOf(i);
          if (owner.toLowerCase() === address.toLowerCase()) {
            const t = await contracts.team.getTeam(i);
            owned.push({ id: i, ...t });
          }
        } catch {}
      }
      setMyTeams(owned);
    };
    scanTeams();
  }, [contracts, address]);

  if (!address) {
    return (
      <div>
        <div className="page-title">🏈 GridironChain</div>
        <div className="page-sub">American football franchise management on MegaETH blockchain</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
          {[
            { icon: "🏟️", title: "Own a Franchise", desc: "Buy one of 32 fictional teams as an NFT. Each team is unique with its own city, colors, and history." },
            { icon: "📋", title: "Annual Draft", desc: "Pick prospects in the draft, worst team picks first. 7 rounds of talent to rebuild your franchise." },
            { icon: "💰", title: "Free Agency", desc: "Sign marquee free agents at auction or buy outright. Build your dream roster." },
            { icon: "🎮", title: "Game Simulation", desc: "Full play-by-play American football simulation. Watch your team compete on-chain." },
          ].map(f => (
            <div key={f.title} className="card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: ".5rem" }}>{f.icon}</div>
              <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: ".5rem", color: "var(--gold)" }}>{f.title}</div>
              <div style={{ fontSize: ".85rem", color: "var(--gray)" }}>{f.desc}</div>
            </div>
          ))}
        </div>

        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🏈</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: ".5rem" }}>Connect your wallet to get started</div>
          <div style={{ color: "var(--gray)", marginBottom: "1.5rem" }}>
            Use the Connect Wallet button in the top right. MegaETH testnet — Chain ID 6342.
          </div>
          <div style={{ fontSize: ".85rem", color: "var(--gray)" }}>
            New to MegaETH? Add the network and claim test ETH from{" "}
            <span style={{ color: "var(--green-lt)" }}>the MegaETH faucet</span>, then claim GRID tokens from the in-app faucet.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "1.5rem", marginBottom: "1rem" }}>
        <div className="page-title" style={{ margin: 0 }}>Dashboard</div>
        {phase !== null && (
          <div className="phase-pill">
            🏈 Season {season} — {PHASE_LABEL[phase]}
          </div>
        )}
      </div>

      {loading && <div className="spinner" />}

      {!loading && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
            <StatBox label="GRID Balance"  value={gridBal}   sub="In-game currency" />
            <StatBox label="My Franchises" value={myTeams.length} sub="Teams owned" />
            <StatBox label="Season"        value={season || "—"} sub={PHASE_LABEL[phase] || "Not started"} />
            <StatBox label="Available Teams" value={available} sub="Franchises for sale" />
          </div>

          {champion && (
            <div className="card mb-2" style={{ background: "#1a2a00", border: "1px solid var(--gold)", display: "flex", alignItems: "center", gap: "1rem" }}>
              <div style={{ fontSize: "2rem" }}>🏆</div>
              <div>
                <div style={{ color: "var(--gold)", fontWeight: 800 }}>Season {season} Champions</div>
                <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>
                  {champion.city} {champion.name}
                </div>
              </div>
            </div>
          )}

          {myTeams.length > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <div className="card-header">My Franchises</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
                {myTeams.map(t => {
                  const data = getTeam(t.id) || {};
                  return (
                    <div key={t.id} className="card" style={{ borderLeft: `4px solid ${data.primary || "var(--green)"}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
                        <div style={{ fontSize: "2rem" }}>{data.emoji || "🏈"}</div>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>{t.city} {t.name}</div>
                          <div style={{ fontSize: ".8rem", marginTop: ".2rem" }}>
                            <span className={`badge badge-${t.conference === "AFC" ? "afc" : "nfc"}`}>{t.conference}</span>
                            {" "}<span className="badge badge-gray">{t.division}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {myTeams.length === 0 && (
            <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: ".5rem" }}>🏟️</div>
              <div style={{ fontWeight: 700, marginBottom: ".5rem" }}>No Franchises Yet</div>
              <div style={{ color: "var(--gray)", fontSize: ".875rem" }}>
                Head to the <strong>Teams</strong> tab to purchase a franchise for 5 000 GRID.
                Use the faucet button in the top bar to claim free GRID tokens.
              </div>
            </div>
          )}

          {/* 32-team grid */}
          <div style={{ marginTop: "1.5rem" }}>
            <div className="card-header">All 32 Franchises</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: ".5rem" }}>
              {TEAMS.map(t => (
                <div
                  key={t.id}
                  className="card card-sm"
                  style={{ display: "flex", alignItems: "center", gap: ".6rem",
                           borderLeft: `3px solid ${t.primary}` }}
                >
                  <span style={{ fontSize: "1.2rem" }}>{t.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: ".85rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.city} {t.name}
                    </div>
                    <div style={{ fontSize: ".7rem", color: "var(--gray)" }}>
                      {t.conference} {t.division}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
