import React, { useState, useEffect, useCallback } from "react";
import { getTeam } from "../data/teams.js";
import { PHASE_LABEL } from "../contracts/abis.js";

function pct(r) {
  const played = r.wins + r.losses + r.ties;
  return played === 0 ? 0 : (r.wins + r.ties * 0.5) / played;
}

function Row({ rank, record, teamId, isChamp }) {
  const t = getTeam(teamId);
  const w = Number(record.wins);
  const l = Number(record.losses);
  const ti = Number(record.ties);
  const pf = Number(record.pointsFor);
  const pa = Number(record.pointsAgainst);
  const winPct = pct({ wins: w, losses: l, ties: ti });

  return (
    <tr style={{ background: isChamp ? "#1a2a00" : undefined }}>
      <td style={{ color: "var(--gray)", fontSize: ".8rem" }}>{rank}</td>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          <span>{t?.emoji}</span>
          <div>
            <span style={{ fontWeight: 700 }}>{t?.city} {t?.name}</span>
            {isChamp && <span className="badge badge-gold" style={{ marginLeft: ".5rem" }}>🏆 CHAMP</span>}
          </div>
        </div>
      </td>
      <td style={{ textAlign: "center", fontWeight: w > l ? 700 : 400, color: w > l ? "var(--green-lt)" : "var(--white)" }}>{w}</td>
      <td style={{ textAlign: "center", fontWeight: l > w ? 700 : 400, color: l > w ? "#e57373" : "var(--white)" }}>{l}</td>
      <td style={{ textAlign: "center", color: "var(--gray)" }}>{ti}</td>
      <td style={{ textAlign: "center", fontWeight: 700 }}>{winPct.toFixed(3)}</td>
      <td style={{ textAlign: "center", color: "var(--gray)", fontSize: ".85rem" }}>{pf}</td>
      <td style={{ textAlign: "center", color: "var(--gray)", fontSize: ".85rem" }}>{pa}</td>
      <td style={{ textAlign: "center", color: pf - pa > 0 ? "var(--green-lt)" : pf - pa < 0 ? "#e57373" : "var(--gray)", fontSize: ".85rem" }}>
        {pf - pa > 0 ? "+" : ""}{pf - pa}
      </td>
    </tr>
  );
}

function DivisionTable({ conf, div, records, champion }) {
  const teamIds = [];
  for (let i = 1; i <= 32; i++) {
    const t = getTeam(i);
    if (t && t.conference === conf && t.division === div) teamIds.push(i);
  }

  const sorted = [...teamIds].sort((a, b) => {
    const ra = records[a] || {};
    const rb = records[b] || {};
    return pct(rb) - pct(ra);
  });

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: ".75rem", color: "var(--gray)", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: ".5rem" }}>
        {conf} {div}
      </div>
      <table style={{ marginBottom: ".5rem" }}>
        <thead>
          <tr>
            <th>#</th><th>Team</th>
            <th style={{ textAlign: "center" }}>W</th>
            <th style={{ textAlign: "center" }}>L</th>
            <th style={{ textAlign: "center" }}>T</th>
            <th style={{ textAlign: "center" }}>PCT</th>
            <th style={{ textAlign: "center" }}>PF</th>
            <th style={{ textAlign: "center" }}>PA</th>
            <th style={{ textAlign: "center" }}>DIFF</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((tid, i) => (
            <Row
              key={tid}
              rank={i + 1}
              teamId={tid}
              record={records[tid] || { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }}
              isChamp={tid === champion}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Standings({ wallet, contracts }) {
  const { address } = wallet;
  const [season, setSeason]   = useState(null);
  const [phase, setPhase]     = useState(null);
  const [records, setRecords] = useState({});
  const [champion, setChampion] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [activeTab, setActiveTab] = useState("standings");

  const load = useCallback(async () => {
    if (!contracts) return;
    setLoading(true);
    try {
      const [s, p] = await Promise.all([
        contracts.league.season(),
        contracts.league.phase(),
      ]);
      setSeason(Number(s));
      setPhase(Number(p));

      if (Number(s) === 0) { setLoading(false); return; }

      const [allTeamIds, allRecs] = await contracts.league.getAllRecords(s);
      const rMap = {};
      allTeamIds.forEach((tid, i) => {
        rMap[Number(tid)] = {
          wins:         Number(allRecs[i].wins),
          losses:       Number(allRecs[i].losses),
          ties:         Number(allRecs[i].ties),
          pointsFor:    Number(allRecs[i].pointsFor),
          pointsAgainst:Number(allRecs[i].pointsAgainst),
        };
      });
      setRecords(rMap);

      const champ = await contracts.league.champions(s);
      if (Number(champ) > 0) setChampion(Number(champ));

      const sched = await contracts.league.getSchedule(s);
      setSchedule(sched.map(g => ({ ...g, homeTeamId: Number(g.homeTeamId), awayTeamId: Number(g.awayTeamId), week: Number(g.week) })));
    } catch (e) {
      console.error(e);
    } finally { setLoading(false); }
  }, [contracts]);

  useEffect(() => { load(); }, [load]);

  if (!address) return (
    <div className="empty">
      <div className="empty-icon">📊</div>
      Connect wallet to view standings
    </div>
  );

  const weeks = [...new Set(schedule.map(g => g.week))].sort((a, b) => a - b);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "1.5rem", marginBottom: "1rem" }}>
        <div className="page-title" style={{ margin: 0 }}>📊 League Standings</div>
        {phase !== null && (
          <div className="phase-pill">Season {season} — {PHASE_LABEL[phase]}</div>
        )}
      </div>

      <div style={{ display: "flex", gap: ".5rem", marginBottom: "1rem" }}>
        <button className={`btn btn-sm ${activeTab === "standings" ? "btn-primary" : "btn-outline"}`} onClick={() => setActiveTab("standings")}>Standings</button>
        <button className={`btn btn-sm ${activeTab === "schedule" ? "btn-primary" : "btn-outline"}`} onClick={() => setActiveTab("schedule")}>Schedule</button>
        <button className="btn btn-outline btn-sm" style={{ marginLeft: "auto" }} onClick={load}>Refresh</button>
      </div>

      {loading && <div className="spinner" />}

      {!loading && season === 0 && (
        <div className="empty">
          <div className="empty-icon">🏈</div>
          Season hasn't started yet. The commissioner starts the season via the contract.
        </div>
      )}

      {!loading && season > 0 && activeTab === "standings" && (
        <div>
          {champion && (
            <div className="card mb-2" style={{ background: "#1a2a00", border: "1px solid var(--gold)", display: "flex", gap: "1rem", alignItems: "center" }}>
              <span style={{ fontSize: "2rem" }}>🏆</span>
              <div>
                <div style={{ color: "var(--gold)", fontWeight: 800 }}>Season {season} Champions</div>
                <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>
                  {getTeam(champion)?.city} {getTeam(champion)?.name}
                </div>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
            {["AFC","NFC"].map(conf => (
              <div key={conf}>
                <div style={{ fontWeight: 800, marginBottom: ".75rem" }}>
                  <span className={`badge badge-${conf === "AFC" ? "afc" : "nfc"}`} style={{ fontSize: ".9rem" }}>{conf}</span>
                </div>
                {["East","North","South","West"].map(div => (
                  <div key={div} className="card" style={{ marginBottom: ".75rem" }}>
                    <DivisionTable conf={conf} div={div} records={records} champion={champion} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && season > 0 && activeTab === "schedule" && (
        <div>
          {weeks.length === 0 && (
            <div className="empty"><div className="empty-icon">📅</div>No games scheduled yet</div>
          )}
          {weeks.map(week => {
            const weekGames = schedule.filter(g => g.week === week);
            return (
              <div key={week} style={{ marginBottom: "1.5rem" }}>
                <div style={{ fontWeight: 700, fontSize: ".85rem", color: "var(--gray)", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: ".5rem" }}>
                  Week {week}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: ".5rem" }}>
                  {weekGames.map((g, i) => {
                    const ht = getTeam(g.homeTeamId);
                    const at = getTeam(g.awayTeamId);
                    return (
                      <div key={i} className="card card-sm" style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
                        <div style={{ flex: 1, textAlign: "right" }}>
                          <div style={{ fontWeight: 700 }}>{ht?.city} {ht?.name}</div>
                          {g.played && <div style={{ fontSize: "1.2rem", fontWeight: 900 }}>{Number(g.homeScore)}</div>}
                        </div>
                        <div style={{ textAlign: "center" }}>
                          {g.played
                            ? <span className="badge badge-green" style={{ fontSize: ".7rem" }}>FINAL</span>
                            : <span className="badge badge-gray" style={{ fontSize: ".7rem" }}>vs</span>}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700 }}>{at?.city} {at?.name}</div>
                          {g.played && <div style={{ fontSize: "1.2rem", fontWeight: 900 }}>{Number(g.awayScore)}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
