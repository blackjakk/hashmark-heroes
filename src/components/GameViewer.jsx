import React, { useState, useEffect, useRef, useCallback } from "react";
import { GameSimulator } from "../engine/GameSimulator.js";
import { generateRoster } from "../engine/PlayerGenerator.js";
import TEAMS, { getTeam } from "../data/teams.js";
import { POSITION_LABEL } from "../contracts/abis.js";

const PLAY_COLORS = {
  score:     "#1a3300",
  int:       "#2a0000",
  fumble:    "#2a0000",
  sack:      "#1a1a00",
  halftime:  "#111",
  ot:        "#111",
  quarter:   "#0a1a0a",
  kickoff:   "#0a0f0a",
};

function PlayEntry({ play }) {
  const bg = PLAY_COLORS[play.kind] || "transparent";
  const border = play.kind === "score" ? "1px solid #2e5c00"
               : play.kind === "int" || play.kind === "fumble" ? "1px solid #3d0000"
               : "none";
  return (
    <div
      className={`play-entry ${play.kind}`}
      style={{ background: bg, border, borderRadius: "4px", marginBottom: "2px" }}
    >
      {play.kind !== "halftime" && play.kind !== "ot" && play.kind !== "quarter" && play.kind !== "kickoff" && (
        <span style={{ color: "var(--gray)", fontSize: ".72rem", marginRight: ".5rem" }}>
          Q{play.quarter} {Math.floor(play.time / 60)}:{String(play.time % 60).padStart(2,"0")}
          {play.down > 0 && ` · ${play.down}${["st","nd","rd","th"][play.down-1]}&${play.ytg}`}
        </span>
      )}
      {play.kind === "score" && <span style={{ marginRight: ".4rem" }}>🏈</span>}
      {(play.kind === "int" || play.kind === "fumble") && <span style={{ marginRight: ".4rem" }}>⚠️</span>}
      <span style={{ fontSize: ".83rem" }}>{play.desc}</span>
      {play.homeScore !== undefined && (play.kind === "score") && (
        <span style={{ float: "right", fontWeight: 700, color: "var(--gold)" }}>
          {play.homeScore}–{play.awayScore}
        </span>
      )}
    </div>
  );
}

function RatingRow({ label, home, away }) {
  const max = Math.max(home, away, 50);
  return (
    <tr>
      <td style={{ textAlign: "right", paddingRight: "1rem", fontWeight: home > away ? 700 : 400, color: home > away ? "var(--green-lt)" : "var(--white)" }}>
        {Math.round(home)}
      </td>
      <td style={{ textAlign: "center", color: "var(--gray)", fontSize: ".78rem" }}>{label}</td>
      <td style={{ textAlign: "left", paddingLeft: "1rem", fontWeight: away > home ? 700 : 400, color: away > home ? "var(--green-lt)" : "var(--white)" }}>
        {Math.round(away)}
      </td>
    </tr>
  );
}

export default function GameViewer({ wallet, contracts }) {
  const { address } = wallet;
  const [homeId, setHomeId] = useState(1);
  const [awayId, setAwayId] = useState(2);
  const [result, setResult] = useState(null);
  const [simming, setSimming] = useState(false);
  const [playHead, setPlayHead] = useState(0);
  const [speed, setSpeed] = useState(80); // ms per play
  const [autoPlay, setAutoPlay] = useState(false);
  const logRef = useRef(null);
  const timerRef = useRef(null);

  const runSim = useCallback(() => {
    const home = getTeam(homeId);
    const away = getTeam(awayId);
    if (!home || !away) return;
    setSimming(true);
    setResult(null);
    setPlayHead(0);
    setAutoPlay(false);

    // Use blockchain roster if connected, otherwise generate fictional roster
    const homeRoster = generateRoster(homeId);
    const awayRoster = generateRoster(awayId);

    const sim = new GameSimulator(home, away, homeRoster, awayRoster);
    const res = sim.simulate();
    setResult(res);
    setSimming(false);
    setAutoPlay(true);
  }, [homeId, awayId]);

  // Auto-advance plays
  useEffect(() => {
    if (!autoPlay || !result) return;
    if (playHead >= result.plays.length) { setAutoPlay(false); return; }
    timerRef.current = setTimeout(() => {
      setPlayHead(ph => ph + 1);
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, speed);
    return () => clearTimeout(timerRef.current);
  }, [autoPlay, playHead, result, speed]);

  const visiblePlays = result ? result.plays.slice(0, playHead) : [];
  const lastScore = visiblePlays.reduceRight((acc, p) => acc || (p.homeScore !== undefined ? p : null), null);
  const curHome = lastScore?.homeScore ?? 0;
  const curAway = lastScore?.awayScore ?? 0;

  return (
    <div>
      <div className="page-title">🏈 Game Simulator</div>
      <div className="page-sub">Full play-by-play simulation — results stored on-chain by the commissioner</div>

      {/* Team selectors */}
      <div className="card" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "1rem", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <label>Home Team</label>
          <select value={homeId} onChange={e => setHomeId(Number(e.target.value))} disabled={simming}>
            {TEAMS.map(t => (
              <option key={t.id} value={t.id}>{t.emoji} {t.city} {t.name}</option>
            ))}
          </select>
        </div>
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: "1.2rem", color: "var(--gray)" }}>VS</div>
        <div>
          <label>Away Team</label>
          <select value={awayId} onChange={e => setAwayId(Number(e.target.value))} disabled={simming}>
            {TEAMS.filter(t => t.id !== homeId).map(t => (
              <option key={t.id} value={t.id}>{t.emoji} {t.city} {t.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: ".75rem", alignItems: "center", marginBottom: "1rem" }}>
        <button className="btn btn-gold" onClick={runSim} disabled={simming || homeId === awayId}>
          {simming ? "Simulating…" : "⚡ Simulate Game"}
        </button>
        {result && !autoPlay && playHead < result.plays.length && (
          <button className="btn btn-primary" onClick={() => setAutoPlay(true)}>▶ Play</button>
        )}
        {autoPlay && (
          <button className="btn btn-outline" onClick={() => setAutoPlay(false)}>⏸ Pause</button>
        )}
        {result && (
          <button className="btn btn-outline" onClick={() => setPlayHead(result.plays.length)}>⏭ End</button>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem", marginLeft: "auto" }}>
          <span style={{ fontSize: ".8rem", color: "var(--gray)" }}>Speed</span>
          <input
            type="range" min="20" max="400" step="20"
            value={speed} onChange={e => setSpeed(Number(e.target.value))}
            style={{ width: "80px" }}
          />
          <span style={{ fontSize: ".8rem", color: "var(--gray)" }}>{speed}ms</span>
        </div>
      </div>

      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          {/* Scoreboard + play log */}
          <div>
            <div className="scoreboard" style={{ marginBottom: "1rem" }}>
              <div className="score-team">
                <div style={{ fontSize: "1.5rem" }}>{getTeam(homeId)?.emoji}</div>
                <div className="score-team-name">{getTeam(homeId)?.city}</div>
                <div className="score-num" style={{ color: result.winner === "home" && playHead >= result.plays.length ? "var(--gold)" : "var(--white)" }}>
                  {curHome}
                </div>
                <div style={{ fontSize: ".75rem", color: "var(--gray)" }}>{getTeam(homeId)?.name}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div className="score-sep">—</div>
                {playHead >= result.plays.length && (
                  <div style={{ fontSize: ".75rem", fontWeight: 700, color: "var(--gold)", marginTop: ".25rem" }}>
                    {result.winner === "home" ? "🏆 HOME WIN" : result.winner === "away" ? "🏆 AWAY WIN" : "TIE"}
                  </div>
                )}
              </div>
              <div className="score-team">
                <div style={{ fontSize: "1.5rem" }}>{getTeam(awayId)?.emoji}</div>
                <div className="score-team-name">{getTeam(awayId)?.city}</div>
                <div className="score-num" style={{ color: result.winner === "away" && playHead >= result.plays.length ? "var(--gold)" : "var(--white)" }}>
                  {curAway}
                </div>
                <div style={{ fontSize: ".75rem", color: "var(--gray)" }}>{getTeam(awayId)?.name}</div>
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ marginBottom: ".5rem" }}>
              <div style={{ fontSize: ".75rem", color: "var(--gray)", marginBottom: ".2rem" }}>
                Play {playHead} / {result.plays.length}
              </div>
              <div className="rating-bar" style={{ height: "8px" }}>
                <div className="rating-fill" style={{ width: `${(playHead / result.plays.length) * 100}%`, background: "var(--green-lt)" }} />
              </div>
            </div>

            {/* Play log */}
            <div className="play-log" ref={logRef}>
              {visiblePlays.map((p, i) => <PlayEntry key={i} play={p} />)}
            </div>
          </div>

          {/* Team ratings comparison */}
          <div>
            <div className="card" style={{ marginBottom: "1rem" }}>
              <div className="card-header">Team Ratings Comparison</div>
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: "right" }}>{getTeam(homeId)?.name}</th>
                    <th style={{ textAlign: "center" }}>Category</th>
                    <th style={{ textAlign: "left" }}>{getTeam(awayId)?.name}</th>
                  </tr>
                </thead>
                <tbody>
                  <RatingRow label="OFFENSE" home={result.homeRatings.offense} away={result.awayRatings.offense} />
                  <RatingRow label="DEFENSE" home={result.homeRatings.defense} away={result.awayRatings.defense} />
                  <RatingRow label="QB"      home={result.homeRatings.qb}      away={result.awayRatings.qb} />
                  <RatingRow label="RB"      home={result.homeRatings.rb}      away={result.awayRatings.rb} />
                  <RatingRow label="WR"      home={result.homeRatings.wr}      away={result.awayRatings.wr} />
                  <RatingRow label="OL"      home={result.homeRatings.ol}      away={result.awayRatings.ol} />
                  <RatingRow label="DL"      home={result.homeRatings.dl}      away={result.awayRatings.dl} />
                  <RatingRow label="LB"      home={result.homeRatings.lb}      away={result.awayRatings.lb} />
                  <RatingRow label="CB"      home={result.homeRatings.cb}      away={result.awayRatings.cb} />
                  <RatingRow label="K"       home={result.homeRatings.k}       away={result.awayRatings.k} />
                </tbody>
              </table>
            </div>

            {/* Drive log */}
            {result.drives.length > 0 && (
              <div className="card">
                <div className="card-header">Drive Log</div>
                <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                  {result.drives.map((d, i) => (
                    <div key={i} style={{ padding: ".4rem .5rem", borderBottom: "1px solid var(--border)", fontSize: ".8rem" }}>
                      <span style={{ color: d.team === "home" ? "var(--green-lt)" : "var(--gold)" }}>
                        {d.team === "home" ? getTeam(homeId)?.name : getTeam(awayId)?.name}
                      </span>
                      {" — "}
                      <span style={{ color: d.result === "TD" ? "var(--gold)" : "var(--gray)" }}>{d.result}</span>
                      <span style={{ float: "right", color: "var(--gray)" }}>
                        {d.homeScore}–{d.awayScore}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
