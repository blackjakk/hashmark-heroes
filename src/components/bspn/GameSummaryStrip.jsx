import React from "react";
import ScoreNumeral from "./ScoreNumeral.jsx";
import TeamAsciiMark from "./TeamAsciiMark.jsx";

/**
 * Top game-summary banner: away block on left, big quarter table + status
 * in the middle, home block on right. Pure presentation — derives nothing
 * from the source data.
 *
 * Props:
 *   - summary: BSPNGameSummary
 */
export default function GameSummaryStrip({ summary }) {
  if (!summary) return null;
  const { awayTeam, homeTeam, awayScore, homeScore, status, quarterScores, winner } = summary;

  const awayWon = winner === "away";
  const homeWon = winner === "home";

  return (
    <section className="bspn-summary">
      {/* Away */}
      <div className="bspn-summary-team" style={{ "--team-color": awayTeam.primaryColor }}>
        <TeamAsciiMark team={awayTeam} />
        <div className="bspn-summary-team-block">
          {awayTeam.city ? <span className="bspn-summary-team-city">{awayTeam.city.toUpperCase()}</span> : null}
          <span className="bspn-summary-team-name">{awayTeam.name.toUpperCase()}</span>
          {awayTeam.record ? (
            <span className="bspn-summary-team-record">{awayTeam.record}</span>
          ) : null}
        </div>
        <div className="bspn-summary-score-wrap">
          <ScoreNumeral
            value={awayScore}
            color={awayWon ? awayTeam.primaryColor : undefined}
            muted={!awayWon && (homeWon || false)}
          />
          {awayWon ? <span className="bspn-summary-arrow" style={{ color: awayTeam.primaryColor }}>◄</span> : null}
        </div>
      </div>

      {/* Center: status + quarter table */}
      <div className="bspn-summary-center">
        <div className="bspn-summary-status">{status}</div>
        <table className="bspn-summary-quarters">
          <thead>
            <tr>
              <th></th>
              {quarterScores.map(q => (
                <th key={q.periodLabel}>{q.periodLabel}</th>
              ))}
              <th>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ color: awayTeam.primaryColor, fontWeight: 700 }}>
                {awayTeam.abbreviation}
              </td>
              {quarterScores.map(q => (
                <td key={q.periodLabel}>{q.away ?? 0}</td>
              ))}
              <td className="total">{awayScore}</td>
            </tr>
            <tr>
              <td style={{ color: homeTeam.primaryColor, fontWeight: 700 }}>
                {homeTeam.abbreviation}
              </td>
              {quarterScores.map(q => (
                <td key={q.periodLabel}>{q.home ?? 0}</td>
              ))}
              <td className="total">{homeScore}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Home */}
      <div className="bspn-summary-team right" style={{ "--team-color": homeTeam.primaryColor }}>
        <TeamAsciiMark team={homeTeam} />
        <div className="bspn-summary-team-block">
          {homeTeam.city ? <span className="bspn-summary-team-city">{homeTeam.city.toUpperCase()}</span> : null}
          <span className="bspn-summary-team-name">{homeTeam.name.toUpperCase()}</span>
          {homeTeam.record ? (
            <span className="bspn-summary-team-record">{homeTeam.record}</span>
          ) : null}
        </div>
        <div className="bspn-summary-score-wrap">
          {homeWon ? <span className="bspn-summary-arrow" style={{ color: homeTeam.primaryColor }}>►</span> : null}
          <ScoreNumeral
            value={homeScore}
            color={homeWon ? homeTeam.primaryColor : undefined}
            muted={!homeWon && (awayWon || false)}
          />
        </div>
      </div>
    </section>
  );
}
