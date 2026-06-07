import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { POSITION_LABEL } from "../contracts/abis.js";
import { getTeam } from "../data/teams.js";
import PlayerCard, { OvrCircle } from "./PlayerCard.jsx";

export default function DraftRoom({ wallet, contracts }) {
  const { address, isCorrectChain } = wallet;
  const [season, setSeason]         = useState(null);
  const [draftOpen, setDraftOpen]   = useState(false);
  const [prospects, setProspects]   = useState([]);
  const [myTeams, setMyTeams]       = useState([]);
  const [myPicks, setMyPicks]       = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [selectedPick, setSelectedPick] = useState(null);
  const [filterPos, setFilterPos]   = useState("ALL");
  const [playerDetails, setPlayerDetails] = useState({});
  const [picking, setPicking]       = useState(false);
  const [msg, setMsg]               = useState("");
  const [loading, setLoading]       = useState(false);

  const PICK_FEE = ethers.parseEther("50");

  const load = useCallback(async () => {
    if (!contracts || !address) return;
    setLoading(true);
    try {
      const [s, open] = await Promise.all([
        contracts.draft.currentSeason(),
        contracts.draft.draftOpen(),
      ]);
      setSeason(Number(s));
      setDraftOpen(open);

      // Find my teams
      const owned = [];
      for (let i = 1; i <= 32; i++) {
        try {
          const owner = await contracts.team.ownerOf(i);
          if (owner.toLowerCase() === address.toLowerCase()) owned.push(i);
        } catch {}
      }
      setMyTeams(owned);

      if (!open || Number(s) === 0) { setLoading(false); return; }

      // Prospects
      const prospectIds = await contracts.draft.getProspects();
      setProspects(prospectIds.map(Number));

      // Load player details for prospects
      const details = {};
      await Promise.all(
        prospectIds.slice(0, 60).map(async (pid, idx) => { // Load first 60 to avoid RPC flood
          try {
            const p = await contracts.player.getPlayer(pid);
            const taken = await contracts.draft.prospectTaken(s, idx);
            details[Number(pid)] = { id: Number(pid), ...p, prospectIdx: idx, taken };
          } catch {}
        })
      );
      setPlayerDetails(details);

      // My picks for first selected team
      if (owned.length > 0) {
        const teamId = owned[0];
        setSelectedTeam(teamId);
        const picks = await contracts.draft.getTeamPicks(s, teamId);
        setMyPicks(picks.map(p => ({ ...p, round: Number(p.round), slot: Number(p.slot), teamId: Number(p.teamId) })));
      }
    } catch (e) {
      console.error(e);
    } finally { setLoading(false); }
  }, [contracts, address]);

  useEffect(() => { load(); }, [load]);

  const loadPicksForTeam = async (teamId) => {
    setSelectedTeam(teamId);
    if (!contracts || !season) return;
    try {
      const picks = await contracts.draft.getTeamPicks(season, teamId);
      setMyPicks(picks.map(p => ({ ...p, round: Number(p.round), slot: Number(p.slot), teamId: Number(p.teamId) })));
    } catch {}
  };

  const makePick = async (pickIdx, prospectIdx, prospectId) => {
    if (!contracts || !address || !selectedPick) return;
    setPicking(true); setMsg("");
    try {
      const draftAddr = await contracts.draft.getAddress();
      const allowance = await contracts.token.allowance(address, draftAddr);
      if (allowance < PICK_FEE) {
        setMsg("Approving GRID for pick fee…");
        const atx = await contracts.token.approve(draftAddr, PICK_FEE);
        await atx.wait();
      }
      setMsg("Submitting pick…");
      const tx = await contracts.draft.selectPlayer(pickIdx, prospectIdx);
      await tx.wait();
      const p = playerDetails[prospectId];
      setMsg(`✅ Pick confirmed! ${p?.name || "Player"} joins your team.`);
      setSelectedPick(null);
      await load();
    } catch (e) {
      setMsg(e.reason || e.message || "Pick failed");
    } finally { setPicking(false); }
  };

  if (!address) return <div className="empty"><div className="empty-icon">📋</div>Connect wallet to access the draft</div>;

  const visibleProspects = Object.values(playerDetails).filter(p =>
    !p.taken &&
    (filterPos === "ALL" || POSITION_LABEL[Number(p.position)] === filterPos)
  ).sort((a, b) => Number(b.overall) - Number(a.overall));

  const unusedPicks = myPicks.filter(p => !p.used);

  return (
    <div>
      <div className="page-title">📋 Draft Room</div>
      <div className="page-sub">
        Season {season || "—"} Draft ·{" "}
        {draftOpen
          ? <span style={{ color: "#4caf7a" }}>● OPEN</span>
          : <span style={{ color: "var(--gray)" }}>● Closed</span>}
        {" "}· 50 GRID per pick activation
      </div>

      {!draftOpen && (
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <div className="empty-icon">📋</div>
          <div style={{ fontWeight: 700, marginBottom: ".5rem" }}>Draft Not Open</div>
          <div style={{ color: "var(--gray)", fontSize: ".875rem" }}>
            The draft opens during the Draft phase. Check the Dashboard for the current season phase.
          </div>
        </div>
      )}

      {draftOpen && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1.5rem" }}>
          {/* LEFT: My picks */}
          <div>
            <div className="card-header">My Draft Picks</div>
            {myTeams.length === 0 && <div className="text-gray text-sm">No teams owned — buy a franchise first.</div>}

            {myTeams.length > 1 && (
              <div style={{ display: "flex", gap: ".5rem", marginBottom: ".75rem", flexWrap: "wrap" }}>
                {myTeams.map(tid => {
                  const t = getTeam(tid);
                  return (
                    <button
                      key={tid}
                      className={`btn btn-sm ${selectedTeam === tid ? "btn-primary" : "btn-outline"}`}
                      onClick={() => loadPicksForTeam(tid)}
                    >
                      {t?.emoji} {t?.name}
                    </button>
                  );
                })}
              </div>
            )}

            {selectedTeam && (
              <div style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
                {[1,2,3,4,5,6,7].map(round => {
                  const roundPicks = myPicks.filter(p => p.round === round);
                  return (
                    <div key={round} className="card card-sm">
                      <div style={{ fontWeight: 700, fontSize: ".8rem", color: "var(--gold)", marginBottom: ".4rem" }}>
                        Round {round}
                      </div>
                      {roundPicks.map((pick, idx) => {
                        const globalIdx = myPicks.indexOf(pick);
                        return (
                          <div
                            key={idx}
                            style={{
                              padding: ".35rem .5rem",
                              borderRadius: "var(--radius)",
                              background: selectedPick?.idx === globalIdx ? "var(--green-dk)" : "transparent",
                              border: "1px solid " + (selectedPick?.idx === globalIdx ? "var(--green)" : "transparent"),
                              cursor: pick.used ? "default" : "pointer",
                              marginBottom: ".25rem",
                            }}
                            onClick={() => !pick.used && setSelectedPick({ pick, idx: globalIdx })}
                          >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              <span style={{ fontSize: ".8rem" }}>
                                Pick {pick.slot} — {getTeam(pick.teamId)?.name}
                              </span>
                              {pick.used
                                ? <span className="badge badge-green">USED</span>
                                : <span className="badge badge-gold">SELECT</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            {msg && (
              <div className="card mt-2" style={{ background: msg.includes("✅") ? "#0d2a0d" : "var(--card)", fontSize: ".85rem" }}>
                {msg}
              </div>
            )}
          </div>

          {/* RIGHT: Prospects board */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".75rem" }}>
              <div className="card-header" style={{ margin: 0 }}>
                Available Prospects ({visibleProspects.length})
              </div>
              <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
                {["ALL","QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"].map(pos => (
                  <button
                    key={pos}
                    className={`btn btn-sm ${filterPos === pos ? "btn-primary" : "btn-outline"}`}
                    onClick={() => setFilterPos(pos)}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            {selectedPick && (
              <div className="card mb-2" style={{ background: "var(--green-dk)", border: "1px solid var(--green)" }}>
                <span style={{ fontSize: ".85rem" }}>
                  ✅ Pick selected: Round {selectedPick.pick.round}, Slot {selectedPick.pick.slot}.
                  Click a prospect below to draft them.
                </span>
                <button className="btn btn-outline btn-sm" style={{ marginLeft: ".5rem" }} onClick={() => setSelectedPick(null)}>
                  Cancel
                </button>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: ".5rem", maxHeight: "70vh", overflowY: "auto" }}>
              {loading && <div className="spinner" />}
              {!loading && visibleProspects.map(p => (
                <div
                  key={p.id}
                  className="card card-sm"
                  style={{
                    display: "flex", alignItems: "center", gap: ".75rem",
                    cursor: selectedPick ? "pointer" : "default",
                    border: selectedPick ? "1px solid var(--green-dk)" : "1px solid var(--border)",
                  }}
                  onClick={() => {
                    if (selectedPick && !picking) {
                      makePick(selectedPick.idx, p.prospectIdx, p.id);
                    }
                  }}
                >
                  <OvrCircle overall={Number(p.overall)} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: ".9rem" }}>{p.name}</div>
                    <div style={{ fontSize: ".75rem", color: "var(--gray)" }}>
                      <span className="badge badge-gray">{POSITION_LABEL[Number(p.position)]}</span>
                      {" "}Age {p.age} · {(Number(p.salary) / 1e18).toLocaleString()} GRID/season
                    </div>
                  </div>
                  {selectedPick && (
                    <button className="btn btn-primary btn-sm" disabled={picking}>
                      {picking ? "…" : "DRAFT"}
                    </button>
                  )}
                </div>
              ))}
              {!loading && visibleProspects.length === 0 && (
                <div className="empty" style={{ padding: "2rem" }}>No prospects available</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
