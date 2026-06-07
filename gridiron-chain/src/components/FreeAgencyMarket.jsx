import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { POSITION_LABEL } from "../contracts/abis.js";
import { getTeam } from "../data/teams.js";
import PlayerCard, { OvrCircle } from "./PlayerCard.jsx";

function timeLeft(deadline) {
  const secs = Number(deadline) - Math.floor(Date.now() / 1000);
  if (secs <= 0) return "Ended";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function FreeAgencyMarket({ wallet, contracts }) {
  const { address } = wallet;
  const [listings, setListings]     = useState([]);
  const [myTeams, setMyTeams]       = useState([]);
  const [myRosters, setMyRosters]   = useState({});
  const [loading, setLoading]       = useState(false);
  const [msg, setMsg]               = useState("");

  // Listing form
  const [listTeam, setListTeam]     = useState("");
  const [listPlayer, setListPlayer] = useState("");
  const [listPrice, setListPrice]   = useState("1000");
  const [listKind, setListKind]     = useState("0"); // 0=FixedPrice, 1=Auction
  const [listing, setListing]       = useState(false);

  // Buy / bid form
  const [bidAmounts, setBidAmounts] = useState({});
  const [buyTeam, setBuyTeam]       = useState("");
  const [acting, setActing]         = useState(null);

  const load = useCallback(async () => {
    if (!contracts || !address) return;
    setLoading(true);
    try {
      const total = Number(await contracts.fa.totalListings());
      const rawListings = total > 0
        ? await contracts.fa.getListings(0, Math.min(total, 50))
        : [];

      // Enrich with player data
      const enriched = await Promise.all(
        rawListings.map(async (L, i) => {
          try {
            const p = await contracts.player.getPlayer(L.playerId);
            return { idx: i, ...L, player: { id: Number(L.playerId), ...p } };
          } catch { return { idx: i, ...L, player: null }; }
        })
      );
      setListings(enriched.filter(L => L.active));

      // My teams + rosters
      const owned = [];
      for (let i = 1; i <= 32; i++) {
        try {
          const owner = await contracts.team.ownerOf(i);
          if (owner.toLowerCase() === address.toLowerCase()) owned.push(i);
        } catch {}
      }
      setMyTeams(owned);
      if (owned.length) setBuyTeam(String(owned[0]));

      // Load rosters for listing form
      const rosters = {};
      for (const tid of owned) {
        const pids = await contracts.team.getRoster(tid);
        const players = await Promise.all(pids.map(async pid => {
          try {
            const p = await contracts.player.getPlayer(pid);
            return { id: Number(pid), ...p };
          } catch { return null; }
        }));
        rosters[tid] = players.filter(Boolean);
      }
      setMyRosters(rosters);
      if (owned.length) setListTeam(String(owned[0]));
    } finally { setLoading(false); }
  }, [contracts, address]);

  useEffect(() => { load(); }, [load]);

  const listForSale = async () => {
    if (!contracts || !listPlayer || !listTeam) return;
    setListing(true); setMsg("");
    try {
      const faAddr = await contracts.fa.getAddress();
      // Approve player transfer
      const isApproved = await contracts.player.isApprovedForAll(address, faAddr);
      if (!isApproved) {
        setMsg("Approving player transfer…");
        await (await contracts.player.setApprovalForAll(faAddr, true)).wait();
      }
      setMsg("Creating listing…");
      const tx = await contracts.fa.list(
        listPlayer, listTeam,
        ethers.parseEther(listPrice),
        Number(listKind)
      );
      await tx.wait();
      setMsg("✅ Player listed!");
      await load();
    } catch (e) {
      setMsg(e.reason || e.message || "Listing failed");
    } finally { setListing(false); }
  };

  const buyNow = async (listingIdx) => {
    if (!contracts || !buyTeam) return;
    setActing(listingIdx); setMsg("");
    try {
      const L = listings.find(l => l.idx === listingIdx);
      if (!L) return;
      const faAddr = await contracts.fa.getAddress();
      const allowance = await contracts.token.allowance(address, faAddr);
      if (allowance < L.price) {
        setMsg("Approving GRID…");
        await (await contracts.token.approve(faAddr, L.price)).wait();
      }
      setMsg("Buying player…");
      const tx = await contracts.fa.buyNow(listingIdx, buyTeam);
      await tx.wait();
      setMsg("✅ Player signed!");
      await load();
    } catch (e) {
      setMsg(e.reason || e.message || "Purchase failed");
    } finally { setActing(null); }
  };

  const placeBid = async (listingIdx) => {
    if (!contracts || !buyTeam) return;
    const amtStr = bidAmounts[listingIdx];
    if (!amtStr) return;
    setActing(listingIdx); setMsg("");
    try {
      const faAddr = await contracts.fa.getAddress();
      const amt    = ethers.parseEther(amtStr);
      const allowance = await contracts.token.allowance(address, faAddr);
      if (allowance < amt) {
        setMsg("Approving GRID…");
        await (await contracts.token.approve(faAddr, amt)).wait();
      }
      setMsg("Placing bid…");
      const tx = await contracts.fa.placeBid(listingIdx, amt, buyTeam);
      await tx.wait();
      setMsg("✅ Bid placed!");
      await load();
    } catch (e) {
      setMsg(e.reason || e.message || "Bid failed");
    } finally { setActing(null); }
  };

  if (!address) return <div className="empty"><div className="empty-icon">💰</div>Connect wallet to access Free Agency</div>;

  const rosterOptions = myRosters[listTeam] || [];

  return (
    <div>
      <div className="page-title">💰 Free Agency Market</div>
      <div className="page-sub">Sign star players or put your excess talent up for auction</div>

      {msg && (
        <div className="card mb-2" style={{ background: msg.includes("✅") ? "#0d2a0d" : "var(--card)", fontSize: ".875rem" }}>
          {msg}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1.5rem" }}>
        {/* LEFT: List a player */}
        <div>
          <div className="card" style={{ marginBottom: "1rem" }}>
            <div className="card-header">List a Player</div>
            {myTeams.length === 0 ? (
              <div className="text-gray text-sm">Buy a team first to list players.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
                <div>
                  <label>Your Team</label>
                  <select value={listTeam} onChange={e => { setListTeam(e.target.value); setListPlayer(""); }}>
                    {myTeams.map(tid => {
                      const t = getTeam(tid);
                      return <option key={tid} value={tid}>{t?.city} {t?.name}</option>;
                    })}
                  </select>
                </div>
                <div>
                  <label>Player</label>
                  <select value={listPlayer} onChange={e => setListPlayer(e.target.value)}>
                    <option value="">Select player…</option>
                    {rosterOptions.map(p => (
                      <option key={p.id} value={p.id}>
                        {POSITION_LABEL[Number(p.position)]} · OVR {Number(p.overall)} · {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Price (GRID)</label>
                  <input type="number" value={listPrice} onChange={e => setListPrice(e.target.value)} min="1" />
                </div>
                <div>
                  <label>Sale Type</label>
                  <div style={{ display: "flex", gap: ".5rem" }}>
                    <button
                      className={`btn btn-sm ${listKind === "0" ? "btn-primary" : "btn-outline"}`}
                      onClick={() => setListKind("0")}
                    >Fixed Price</button>
                    <button
                      className={`btn btn-sm ${listKind === "1" ? "btn-primary" : "btn-outline"}`}
                      onClick={() => setListKind("1")}
                    >Auction (48h)</button>
                  </div>
                </div>
                <button
                  className="btn btn-gold"
                  onClick={listForSale}
                  disabled={listing || !listPlayer}
                >
                  {listing ? "Listing…" : "List Player"}
                </button>
              </div>
            )}
          </div>

          {/* Buy team selector */}
          {myTeams.length > 0 && (
            <div className="card">
              <div className="card-header">Sign To Team</div>
              <select value={buyTeam} onChange={e => setBuyTeam(e.target.value)}>
                {myTeams.map(tid => {
                  const t = getTeam(tid);
                  return <option key={tid} value={tid}>{t?.city} {t?.name}</option>;
                })}
              </select>
            </div>
          )}
        </div>

        {/* RIGHT: Active listings */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".75rem" }}>
            <div className="card-header" style={{ margin: 0 }}>
              Active Listings ({listings.length})
            </div>
            <button className="btn btn-outline btn-sm" onClick={load}>Refresh</button>
          </div>

          {loading && <div className="spinner" />}

          {!loading && listings.length === 0 && (
            <div className="empty">
              <div className="empty-icon">💰</div>
              No active listings — be the first to list a player!
            </div>
          )}

          {!loading && listings.map(L => {
            const isAuction = Number(L.kind) === 1;
            const price = ethers.formatEther(L.price);
            const highBid = L.highBid > 0n ? ethers.formatEther(L.highBid) : null;
            const isOwn = L.seller?.toLowerCase() === address?.toLowerCase();

            return (
              <div key={L.idx} className="card" style={{ marginBottom: ".75rem" }}>
                <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
                  {L.player && <OvrCircle overall={Number(L.player.overall)} />}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontWeight: 800 }}>
                        {L.player?.name || `Player #${L.playerId}`}
                      </div>
                      {isAuction
                        ? <span className="badge badge-gold">AUCTION · {timeLeft(L.deadline)}</span>
                        : <span className="badge badge-green">BUY NOW</span>}
                    </div>
                    {L.player && (
                      <div style={{ fontSize: ".78rem", color: "var(--gray)", marginTop: ".15rem" }}>
                        {POSITION_LABEL[Number(L.player.position)]} · OVR {Number(L.player.overall)} · Age {L.player.age}
                      </div>
                    )}
                    <div style={{ marginTop: ".5rem" }}>
                      {isAuction ? (
                        <div>
                          <div style={{ fontSize: ".85rem" }}>
                            Reserve: <strong>{parseFloat(price).toLocaleString()} GRID</strong>
                            {highBid && <> · High bid: <strong className="text-gold">{parseFloat(highBid).toLocaleString()} GRID</strong></>}
                          </div>
                          {!isOwn && (
                            <div style={{ display: "flex", gap: ".5rem", marginTop: ".5rem", alignItems: "center" }}>
                              <input
                                type="number"
                                placeholder="Bid (GRID)"
                                style={{ width: "130px" }}
                                value={bidAmounts[L.idx] || ""}
                                onChange={e => setBidAmounts(prev => ({ ...prev, [L.idx]: e.target.value }))}
                              />
                              <button
                                className="btn btn-primary btn-sm"
                                disabled={acting === L.idx || !buyTeam}
                                onClick={() => placeBid(L.idx)}
                              >
                                {acting === L.idx ? "…" : "Place Bid"}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: ".75rem", marginTop: ".5rem" }}>
                          <span style={{ fontWeight: 700, color: "var(--gold)" }}>
                            {parseFloat(price).toLocaleString()} GRID
                          </span>
                          {!isOwn && (
                            <button
                              className="btn btn-gold btn-sm"
                              disabled={acting === L.idx || !buyTeam}
                              onClick={() => buyNow(L.idx)}
                            >
                              {acting === L.idx ? "Buying…" : "Buy Now"}
                            </button>
                          )}
                          {isOwn && <span className="badge badge-gray">YOUR LISTING</span>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
