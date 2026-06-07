# Audit Results — full output snapshots

Durable snapshots of the headless audit runs. The `/tmp/*.log` originals are
**ephemeral** (the remote container recycles them), so the canonical full
outputs are committed here. Regenerate any of these with the harnesses in the
parent dir — see `../AUDIT.md` (and the "Harness invariant" section: rosters
must stay ~full or the numbers are invalid).

All captured on branch `claude/charming-brown-b18u2`, **after** the draft-class
cycling fix (commit `0c3955d`) — i.e. on a healthy full-roster league
(~1,696 players), not the collapsed ~190-player league older runs used.

| file | command | contents |
|---|---|---|
| `talent_100season.txt` | `node _brady_audit.js 100` | **Canonical validation.** Talent distribution, drift by decade (10 decades), OVR + bust by draft round, roster construction, cap utilization, career length, Hall of Fame, awards, injuries, and the legend / True-Brady tail (169,597 player-seasons). |
| `production_40season.txt` | `node _brady_audit.js 40` | Same franchise tables + the production-by-position views: **TOP 10 BY POSITION (final season)** and **TYPICAL CAREER BY POSITION** (median/P90, ≥4-yr careers). |
| `game_per_position.txt` | `node _sim_audit.js 4` | Per-**game** production by position (median / P10 / P90 / max + NFL reference values + milestone-game frequencies) and the game-realism tables (rates, distributions, drives, kicking). |

Headline reads (see the files for the full gamut):
- Talent equilibrium stable over a full century; elite 90+ ≈ 5.7%.
- R1 picks = ~29% of starters (healthy); draft class cycles correctly.
- Open gap: **True Brady = 0 / 100 yrs** (late-round QB → 96+ never fires).
