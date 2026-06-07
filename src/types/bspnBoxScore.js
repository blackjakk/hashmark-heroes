// BSPN box-score data model — JSDoc typedefs.
//
// The BSPN UI consumes BSPNBoxScoreData only. Adapters are responsible
// for shaping any source (sim result, blockchain event log, mock fixture)
// into this shape. The components never reach into simulator internals.

/**
 * @typedef {Object} BSPNTeam
 * @property {string|number} id
 * @property {string} name             - e.g. "Kraken"
 * @property {string} abbreviation     - e.g. "ALB" (3-letter scoreboard mark)
 * @property {string} [city]
 * @property {string} [record]         - e.g. "8-3 (5-1)" — opaque string
 * @property {string} primaryColor     - team accent (CSS color)
 * @property {string} [secondaryColor]
 * @property {string} [asciiMark]      - optional multi-line ASCII art
 */

/**
 * @typedef {Object} BSPNQuarterScore
 * @property {string} periodLabel      - "Q1", "Q2", "OT", etc.
 * @property {number|null} away
 * @property {number|null} home
 */

/**
 * @typedef {Object} BSPNGameSummary
 * @property {string|number} gameId
 * @property {string} status           - "FINAL", "Q3 4:21", etc.
 * @property {BSPNTeam} awayTeam
 * @property {BSPNTeam} homeTeam
 * @property {number} awayScore
 * @property {number} homeScore
 * @property {BSPNQuarterScore[]} quarterScores
 * @property {"away"|"home"|"tie"|null} [winner]
 */

/**
 * @typedef {Object} BSPNComparisonStat
 * @property {string} key              - stable id
 * @property {string} label            - "FIRST DOWNS"
 * @property {number|string} awayValue
 * @property {number|string} homeValue
 * @property {number} [awayBarValue]   - if omitted, falls back to awayValue
 * @property {number} [homeBarValue]
 * @property {"number"|"percent"|"time"|"raw"} [format]
 */

/**
 * @typedef {Object} BSPNStatColumn
 * @property {string} key
 * @property {string} label
 * @property {"left"|"right"|"center"} [align]
 */

/**
 * @typedef {Object} BSPNStatRow
 * @property {string} id
 * @property {Object.<string, string|number>} cells
 */

/**
 * @typedef {Object} BSPNStatGroup
 * @property {string} title            - "PASSING", "RUSHING", etc.
 * @property {BSPNStatColumn[]} columns
 * @property {BSPNStatRow[]} rows
 */

/**
 * @typedef {Object} BSPNScoringPlay
 * @property {string} period           - "Q1", "OT", etc.
 * @property {string} time             - "08:14" — opaque string
 * @property {string|number} teamId
 * @property {string} description
 * @property {string} scoreText        - e.g. "7-0"
 */

/**
 * @typedef {Object} BSPNLeaderRow
 * @property {string} playerName
 * @property {string|number} teamId
 * @property {string} label            - subhead like "PASSING"
 * @property {string} statLine         - opaque, pre-formatted
 * @property {number} [value]          - optional sort key
 * @property {string} [jersey]
 */

/**
 * @typedef {Object} BSPNLeaderGroup
 * @property {string} title
 * @property {BSPNLeaderRow[]} rows
 */

/**
 * @typedef {Object} BSPNGameNote
 * @property {string} id
 * @property {string} text
 */

/**
 * @typedef {Object} BSPNBoxScoreData
 * @property {BSPNGameSummary} summary
 * @property {BSPNComparisonStat[]} comparisonStats
 * @property {BSPNStatGroup[]} awayBoxScoreGroups
 * @property {BSPNStatGroup[]} homeBoxScoreGroups
 * @property {BSPNScoringPlay[]} scoringSummary
 * @property {BSPNLeaderGroup[]} leaderGroups
 * @property {BSPNLeaderGroup} [topPerformers]
 * @property {BSPNGameNote[]} gameNotes
 */

// Module is documentation-only; no runtime exports needed, but keep a
// named export so JSDoc-aware tools can pick this file up.
export const __BSPN_TYPES__ = true;
