# Hashmark Heroes — American Football Manager

A from-scratch American-football franchise simulation: a real play-by-play game
engine wrapped in a deep, deadline-driven front-office sim — with an optional
on-chain (MegaETH) layer for the draft and league assets.

No game engine, no framework — the simulation, the franchise systems, and the
broadcast presentation are all hand-built in vanilla JavaScript. The Solidity
contracts are a separate, optional on-chain backend.

---

## What's in here

**A simulation engine, not a spreadsheet.** Plays resolve through a real engine
(formations, personnel packages, route concepts, pass rush / coverage, fatigue),
and its realism is held to **seeded regression gates** — the league-wide
pressure rate, completion %, yards/carry, sacks/game, points/game, etc. are
pinned to baselines and checked in CI, so a change that quietly breaks football
fails the build. (See `_audit_gate.js`, `_teleport_gate.sh`.)

**A franchise mode with a human layer.** The front office is the heart of it:

- **Draft** — a live, on-the-clock event: War Room recommendations grounded in
  *your* scouting, a pre-draft scouting phase with confidence bands, trade-down
  (AI offers + shop-your-pick) and trade-up from the floor, current- and
  future-pick assets, and a draft report card that **ages** past classes into
  steal / hit / bust so your scouting actually pays off (or doesn't).
- **Free agency** — a weekly bidding market where players have **motivations**
  (contender / money / role / scheme) that bend what they'll accept, and AI
  general managers have **archetypes** (Win-Now, Hoarder, Value Hawk, Star
  Hunter, Stand Pat) you can read and exploit.
- **Locker room & morale** — a live, weekly morale state driven by results,
  role, and contracts, with mentors, cancers, and disgruntled stars who can
  demand a trade. You can respond — a captains' meeting, a one-on-one, or a
  *role promise* that backfires if you don't keep it.
- Plus cap & contracts (proration, dead money, structures, comp picks), coaching
  staff, the college pipeline / combine, injuries & IR, and a broadcast HUD.

**An optional on-chain backend.** Solidity contracts (`contracts/`) model the
league on MegaETH — player/team NFTs, a GRID token, free agency, and an
on-the-clock `DraftSystem` (per-pick deadline, permissionless auto-pick from a
pre-committed queue, propose/accept trades). The JS game runs fully off-chain;
the chain layer is opt-in.

---

## Running it

**The game** (static, no build step):

```bash
# from this directory
npx http-server -p 5173 -c-1 -s .
# then open http://localhost:5173/play.html
```

**The contracts** (Hardhat):

```bash
npm install
npx hardhat compile
# configure .env from .env.example before deploying
npx hardhat run scripts/deploy.js --network megaeth
```

Copy `.env.example` → `.env` and fill in your RPC URL / deployer key for any
on-chain work. **Never commit `.env`** (it's git-ignored).

---

## Quality gates

The realism of the sim is treated as a testable contract:

- **Realism audit gate** (`node _audit_gate.js`) — seeded sims compared to
  baselines for pressure rate, completion %, yards/carry, sacks, points, etc.,
  with tolerance bands. Fast / full / slow tiers.
- **Teleport gate** (`./_teleport_gate.sh`) — replays seeded plays through the
  real renderer and flags egregious per-frame position jumps.
- Both are wired into a pre-commit hook + GitHub Actions, and run on a fixed
  seed so a failure is a real regression, not sampling noise.

---

## Layout

```
play*.js            the game: engine, franchise systems, broadcast, UI
play.html           entry point
contracts/          Solidity (MegaETH) — NFTs, GRID token, DraftSystem, FA
scripts/            deploy / seed
_*_audit.js, _*_gate.*  seeded realism & animation regression harness
hardhat.config.js   solc 0.8.20, OpenZeppelin 5.0.2
```

---

## License

© the author. **All rights reserved.** This source is provided for viewing
only; it is not licensed for reuse, redistribution, or deployment. The contract
SPDX headers are marked `UNLICENSED` accordingly. (Third-party dependencies —
e.g. OpenZeppelin — retain their own licenses.)
