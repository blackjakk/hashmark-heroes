import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { POSITION_LABEL } from "../contracts/abis.js";
import { getTeam } from "../data/teams.js";
import PlayerCard from "./PlayerCard.jsx";

const PRICE = ethers.parseEther("5000");

export default function TeamManager({ wallet, contracts }) {
  const { address, isCorrectChain } = wallet;
  const [available, setAvailable]   = useState([]);
  const [myTeams, setMyTeams]       = useState([]);
  const [selected, setSelected]     = useState(null);
  const [roster, setRoster]         = useState([]);
  const [buying, setBuying]         = useState(false);
  const [gridBal, setGridBal]       = useState(null);
  const [msg, setMsg]               = useState("");
  const [loading, setLoading]       = useState(false);

  const load = useCallback(async () => {
    if (!contracts || !address) return;
    setLoading(true);
    try {
      const [avail, bal] = await Promise.all([
        contracts.team.availableTeams(),
        contracts.token.balanceOf(address),
      ]);
      setAvailable(avail.map(Number));
      setGridBal(parseFloat(ethers.formatEther(bal)));

      const owned = [];
      for (let i = 1; i <= 32; i++) {
        try {
          const owner = await contracts.team.ownerOf(i);
          if (owner.toLowerCase() === address.toLowerCase()) {
            owned.push(i);
          }
        } catch {}
      }
      setMyTeams(owned);
    } finally { setLoading(false); }
  }, [contracts, address]);

  useEffect(() => { load(); }, [load]);

  const loadRoster = useCallback(async (teamId) => {
    if (!contracts) return;
    setSelected(teamId);
    setRoster([]);
    try {
      const pids = await contracts.team.getRoster(teamId);
      const players = await Promise.all(
        pids.map(async pid => {
          try {
            const p = await contracts.player.getPlayer(pid);
            return { id: Number(pid), ...p };
          } catch { return null; }
        })
      );
      setRoster(players.filter(Boolean));
    } catch {}
  }, [contracts]);

  const buyTeam = async (teamId) => {
    if (!contracts || !address) return;
    setBuying(teamId); setMsg("");
    try {
      const allowance = await contracts.token.allowance(address, await contracts.team.getAddress());
      if (allowance < PRICE) {
        setMsg("Approving GRID spend…");
        const atx = await contracts.token.approve(await contracts.team.getAddress(), PRICE);
        await atx.wait();
      }
      setMsg("Purchasing franchise…");
      const tx = await contracts.team.purchaseTeam(teamId);
      await tx.wait();
      setMsg(`🎉 You own the ${getTeam(teamId)?.city} ${getTeam(teamId)?.name}!`);
      await load();
    } catch (e) {
      setMsg(e.reason || e.message || "Transaction failed");
    } finally { setBuying(false); }
  };

  if (!address) return <div className="empty"><div className="empty-icon">🏟️</div>Connect wallet to manage teams</div>;

  const grouped = { AFC: { East:[], North:[], South:[], West:[] }, NFC: { East:[], North:[], South:[], West:[] } };
  for (let i = 1; i <= 32; i++) {
    const t = getTeam(i);
    if (t) grouped[t.conference][t.division].push({ ...t, owned: myTeams.includes(i), available: available.includes(i) });
  }

  return (
    <div>
      <div className="page-title">🏟️ Franchise Market</div>
      <div className="page-sub">Purchase a franchise for 5 000 GRID · You own {myTeams.length} team{myTeams.length !== 1 ? "s" : ""}</div>

      {gridBal !== null && gridBal < 5000 && (
        <div className="card mb-2" style={{ background: "#2a1000", border: "1px solid #c83803" }}>
          <span style={{ color: "#e57373" }}>⚠ </span>
          You have {gridBal.toLocaleString()} GRID — you need 5 000 GRID to buy a team. Use the faucet button to claim free GRID.
        </div>
      )}

      {msg && (
        <div className="card mb-2" style={{ background: msg.includes("🎉") ? "#0d2a0d" : "var(--card)" }}>
          {msg}
        </div>
      )}

      {loading && <div className="spinner" />}

      {/* Conference / Division layout */}
      {!loading && ["AFC","NFC"].map(conf => (
        <div key={conf} style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: ".75rem" }}>
            <span className={`badge badge-${conf === "AFC" ? "afc" : "nfc"}`} style={{ fontSize: ".85rem" }}>{conf}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
            {["East","North","South","West"].map(div => (
              <div key={div}>
                <div style={{ fontSize: ".75rem", color: "var(--gray)", fontWeight: 600, marginBottom: ".5rem", textTransform: "uppercase", letterSpacing: ".5px" }}>
                  {div}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
                  {grouped[conf][div].map(t => (
                    <div
                      key={t.id}
                      className="card card-sm"
                      style={{
                        borderLeft: `4px solid ${t.primary}`,
                        cursor: "pointer",
                        outline: selected === t.id ? `2px solid ${t.primary}` : "none",
                        opacity: !t.available && !t.owned ? 0.5 : 1,
                      }}
                      onClick={() => t.owned ? loadRoster(t.id) : undefined}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                        <span style={{ fontSize: "1.3rem" }}>{t.emoji}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: ".85rem" }}>{t.city}</div>
                          <div style={{ fontWeight: 700, fontSize: ".9rem" }}>{t.name}</div>
                        </div>
                        {t.owned && <span className="badge badge-green">OWNED</span>}
                        {!t.owned && t.available && <span className="badge badge-gold">FOR SALE</span>}
                        {!t.owned && !t.available && <span className="badge badge-gray">TAKEN</span>}
                      </div>
                      {!t.owned && t.available && (
                        <button
                          className="btn btn-gold btn-sm"
                          style={{ marginTop: ".5rem", width: "100%" }}
                          disabled={buying === t.id || (gridBal !== null && gridBal < 5000)}
                          onClick={(e) => { e.stopPropagation(); buyTeam(t.id); }}
                        >
                          {buying === t.id ? "Buying…" : "Buy · 5 000 GRID"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Roster panel */}
      {selected !== null && (
        <div style={{ marginTop: "1.5rem" }}>
          <div className="page-title" style={{ fontSize: "1.1rem" }}>
            {getTeam(selected)?.emoji} {getTeam(selected)?.city} {getTeam(selected)?.name} — Roster
          </div>
          {roster.length === 0 ? (
            <div className="empty" style={{ padding: "2rem" }}>
              <div className="empty-icon">📋</div>
              No players on roster yet. Draft or sign players from Free Agency.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
              {roster.map(p => (
                <PlayerCard key={p.id} player={p} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
