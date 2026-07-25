# Skin Market Lab — CS skin market analysis over time

A self-contained market-research tool for Counter-Strike skin investing:
a zero-dependency Node tracker that records prices **over time** and a
dashboard (`skins.html`) with charts, indicators, cross-market fee math, and
a portfolio P/L ledger. Lives beside the game but shares nothing with the
sim — it is completely determinism-neutral.

> **Not financial advice.** The signal is a transparent heuristic — every
> point of its score is itemized so you can judge the inputs yourself. Skin
> markets are volatile and thin; Steam proceeds are wallet-locked.

## Quick start

```
npm run skins            # tracker + dashboard on http://localhost:8790
```

Open the dashboard, search an item (cases, skins, knives — the search
universe is a curated seed list until the full ~20k-name Skinport dump is
cached on first refresh), click it to start tracking. Every snapshot appends
to `server/data-skins/history/*.jsonl` — **history accrues as long as the
tracker keeps running** (auto-snapshot every `SKIN_SNAP_HOURS`, default 6).

## Getting deep history immediately

Snapshots only build history going forward. Two ways to backfill years of
Steam price history per item:

1. **Paste-import (no setup):** item view → *📋 Import history* — the modal
   gives you a one-liner to run in the devtools console of any logged-in
   steamcommunity.com tab; paste the result. Steam only serves
   `pricehistory` to logged-in browsers.
2. **Cookie bootstrap:** start the server with
   `STEAM_COOKIE="steamLoginSecure=..."` (copy from your browser's cookies)
   and use *⚡ Bootstrap full history* per item. The cookie stays on your
   machine; treat it like a password.

## What the analytics mean

All computed in `server/skin-analytics.js` (shared verbatim by server and
browser; unit-pinned by the probe):

- **7D/30D/90D** — momentum vs the closest recorded day that far back.
- **SMA 7/30** — moving averages, also drawn on the chart.
- **RSI 14** — Wilder's; >75 flagged overbought, <30 oversold.
- **Volatility /yr** — annualized σ of daily log returns (last 30d).
- **Off peak** — current drawdown from the all-time recorded high.
- **Sold/day** — median daily units sold (Steam), the liquidity gate.
- **Signal** — additive score in [−100, +100] from the above, verdicts
  STRONG BUY … STRONG SELL, with every contribution listed. Illiquid items
  get dampened — a great chart you can't exit isn't a great investment.
- **Where to sell** — net proceeds after fees on both venues: Steam
  (÷1.15, wallet-locked funds) vs Skinport (−12%, real cash, using the
  median of *actual realized sales*, not asks).

## Data sources

| Source | What | Auth |
|---|---|---|
| Steam `priceoverview` | live median/lowest + 24h volume | none |
| Steam `pricehistory` | full multi-year daily history | login cookie (or paste) |
| Skinport `/v1/items` | full item dump → search + ask prices | none (brotli) |
| Skinport `/v1/sales/history` | realized-sale medians 24h/7d/30d/90d | none (brotli) |

Rate limits are respected (3.5s politeness gap to Steam; Skinport cached
30min–12h). Data lands in `server/data-skins/` (gitignored).

## Gates

- `node server/skin-probe.js` — 55 checks, hermetic (fixture transport):
  analytics math pinned to hand-computed values, full API flow, snapshot
  dedupe, import/bootstrap, portfolio P/L, restart persistence.
- `node tools/_skin_client_probe.js` — real Chromium drives the dashboard:
  chart pixels actually painted, crosshair tooltip, range switching,
  portfolio form, zero page errors. Screenshot → `/tmp/skin_lab.png`.

Both run in CI (`gates.yml`). Run them when touching `skin-*.js`,
`skins.html/css/js`, or `tools/_skin_client_probe.js`.
