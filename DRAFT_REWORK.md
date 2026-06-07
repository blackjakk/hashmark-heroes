# Draft Rework — "the crown jewel"

*Goal: turn the draft from a click-to-pick board into a live, on-the-clock event
with real trade-down, designed so multiplayer is an extension — not a rewrite.*

Status: **DESIGN.** No production code changed by this doc.

---

## 1. What already exists (we build ON this, not from scratch)

The foundation is surprisingly complete — the rework is mostly *integrate + add a
clock + abstract the controller*, not a ground-up build.

| Piece | Where | Reuse for |
|---|---|---|
| Sequential draft state machine | `franchise.draft = { class, pickOrder, picks, currentIdx, … }` (`offseason.js:18297`) | The turn loop — `pickOrder[currentIdx]` IS "on the clock" |
| Draft board + pick flow | `renderFrnDraft` (21429), `frnDraftPick(name)` (22579), `frnAutoPickThisSlot` (22260), `_draftFinalize` (22716) | The pick action + AI pick |
| **Tradeable pick assets** | `franchise.picks` = `[{ year, round, …, currentOwnerId }]` (`_initFranchisePicks` 14591) | Trade-down: picks change `currentOwnerId` |
| **Pick value chart** | `_pickValue(pick)` (14625) | Trade-down valuation (already analytics-tuned) |
| **Full trade engine** | offseason: `_tradePickKey`/`_tradePickFromKey`, `_playerTradeValue`, suggested-target value (~16469), AI willingness | Trade-down: reuse the SAME valuation + AI accept logic, in-draft |
| "Until you're on the clock" | 18654 / 18748 | Already counts picks to the user's slot — just not a live clock |

**The gap** between this and the user's vision is exactly three things:
1. **On the clock** — there's no live timer; you pick whenever, AI picks resolve
   instantly. Needs a countdown + paced AI + auto-pick on expiry.
2. **Trade DOWN** — the trade engine is offseason-only; it isn't wired into the
   live board. Needs AI teams below offering to move up, and the user able to
   shop/accept while on the clock.
3. **Multiplayer** — doesn't exist. Needs an architecture (below) so it's an
   addition.

---

## 2. The core model — an action-sourced turn state machine

Refactor the draft loop (even for single-player) into a tiny, deterministic state
machine. This is the single most important decision: it's what makes trade-down
clean AND makes multiplayer a controller/transport addition instead of a rewrite.

**State** (mostly already in `franchise.draft`):
```
draft = {
  class,                 // prospects
  pickOrder: [teamId…],  // resolves live from franchise.picks ownership (so trades reorder it)
  currentIdx,            // whose turn
  picks: [{ pick, teamId, prospectId }],
  clock: { endsAt, paused, bankMs },   // NEW — live timer
  pendingTrades: [],     // NEW — open trade-down offers for the on-clock team
}
```

**Actions** (serializable — this is the MP-enabling part):
- `MAKE_PICK(teamId, prospectId)`
- `PROPOSE_TRADE(fromTeam, toTeam, picksOut, picksIn)`
- `ACCEPT_TRADE(tradeId)` / `DECLINE_TRADE(tradeId)`
- `CLOCK_EXPIRE(teamId)` → auto-pick best-available-by-need

**Reducer**: `applyDraftAction(state, action) → state` — pure, deterministic.
`MAKE_PICK` pushes the pick + advances `currentIdx`; `ACCEPT_TRADE` swaps pick
ownership in `franchise.picks` and **recomputes `pickOrder`** so the board reorders.

**Controller** — *who produces the next action for the on-clock team*:
```
controllerFor(teamId) → "user" | "ai" | "human:<seat>" | "remote:<peer>"
```
- SP: user's team → `"user"`, all others → `"ai"`.
- The loop: resolve on-clock team → its controller → `"user"`/`"human"` shows the
  on-the-clock UI + clock; `"ai"` schedules an auto-pick after a pace delay;
  `"remote"` awaits a transport message.

Build SP with this shape. MP then = *more controllers + (for networked) a
transport that relays actions and syncs `currentIdx`.* No rewrite.

---

## 3. On the clock (Stage 1 — single-player)

- **Clock**: per-pick countdown (default ~45s user / faster AI), shown as a bar +
  mm:ss. A **time bank** option (NFL-style) is a nice-to-have. On expiry →
  `CLOCK_EXPIRE` → auto-pick (the user's pinned target if still available, else
  best-by-need via existing `frnAutoPickThisSlot` logic).
- **Paced AI**: AI picks resolve on a short staggered delay (e.g. 600–1500ms,
  faster late) via the existing render loop + `setTimeout`, so the board *ticks*
  pick-by-pick instead of jumping. A "▶▶ sim to my pick" control skips the wait.
- **Live board chrome**: who's on the clock (highlighted), countdown, a recent-
  picks ticker, the user's big board / pinned targets, "N picks away."
- Pure timing/UI — no engine, no realism metrics. The teleport/audit gates don't
  apply; verify with `_ux_snapshot.js`.

## 4. Trade down (Stage 2)

Wire the existing trade engine into the live board:
- When the user is **on the clock**, AI teams below generate **move-up offers**
  for a specific prospect (their need × prospect value), valued with `_pickValue`
  — the user gets a small list: *"PHI offers picks 12 + 78 to move up to your #6."*
- The user can also **shop the pick** (solicit) or **decline and pick**.
- `ACCEPT_TRADE` → reuse the offseason swap logic on `franchise.picks` (change
  `currentOwnerId`), recompute `pickOrder`, advance — the user slides down to
  their new pick and is back on the clock later with extra capital.
- AI willingness reuses the offseason `_playerTradeValue`/target logic, so values
  stay consistent league-wide. **Trade up** (user moves up) is the mirror: same
  engine, user is the one sending capital.

## 5. Multiplayer (Stages 3–4)

Designed-for, built incrementally. The game has **no backend** (localStorage/IDB),
so the realistic ladder:

- **Stage 3 — hot-seat (pure client-side, achievable now).** At draft start the
  user picks which teams are **human-controlled** (`"human:<seat>"`). When a human
  team is on the clock, show *"Team X — you're on the clock"* + the clock + that
  team's board; the device passes between humans. The clock, trade-down, and
  reducer are identical to SP — only `controllerFor` changes. This delivers real
  multiplayer drafting with zero infrastructure.
- **Stage 4 — networked (needs infra; future).** `"remote:<peer>"` controllers +
  a transport that broadcasts each **action** and syncs `currentIdx`. Because the
  state machine is deterministic and action-sourced, the transport only relays
  actions (+ a periodic state-hash check) — it doesn't re-implement draft logic.
  Options when infra is on the table: a thin WebSocket relay, or peer-to-peer
  (WebRTC) with one host authoritative on `currentIdx`. **Out of scope until a
  backend exists — but the SP build above does not preclude it.**

**Why this ordering:** every stage ships standalone value, and stages 1–3 need
*no server*. The action-sourced reducer (Stage 1) is the one upfront investment
that pays off at every later stage.

---

## 6. Staged plan (each independently shippable)

| Stage | What | Server? | Gate |
|---|---|---|---|
| 1 | Action-sourced reducer + on-the-clock timer + paced AI + sim-to-my-pick | no | `_ux_snapshot` |
| 2 | Trade-down/up on the clock (reuse `_pickValue` + offseason trade engine) | no | `_ux_snapshot`; spot-check pick-value balance |
| 3 | Hot-seat MP — human-controlled teams via `controllerFor`, seat-pass UI | no | `_ux_snapshot` |
| 4 | Networked MP — `"remote"` controller + transport (**MegaETH backend, §7**) | **yes** | `hardhat compile` |

**Risks / guards:**
- The on-the-clock refactor touches `renderFrnDraft` + the pick flow — keep it
  behind the existing draft-render guard (already wrapped by `_frnInstallRenderGuards`).
- The draft is in the fragile `play-franchise-offseason.js` (1.2MB). Stage per
  commit, screenshot-verify each.
- Trade-down values must reconcile with offseason values (same `_pickValue`) so a
  pick isn't worth 100 in the draft and 60 in October.
- Don't break the existing UDFA/grade flow downstream of the board.

**First concrete step:** extract `applyDraftAction` + `controllerFor` and route the
*existing* pick/auto-pick through them (behavior-neutral), so Stage 1's clock has a
clean seam to hang on. Verify the draft still plays identically, then add the clock.

---

## 7. On-chain / MegaETH backend (Stage 4, concretely)

The networked-MP transport (Stage 4) does not have to be a relay we build and
host. **MegaETH is the transport** — and, better, the *authoritative reducer*.
This is the version where the draft is genuinely the crown jewel: a public,
trustless, real-time draft where every pick and trade is on-chain.

### 7.1 Why this maps so cleanly

The Section 2 architecture was chosen for exactly this. An action-sourced,
deterministic reducer with per-team controllers is **the same shape as a smart
contract**: actions → transactions, reducer → contract state transitions,
controller (`teamNFT.ownerOf`) → `msg.sender` auth, transport → event log.
Nothing about Stages 1–3 has to be thrown away; the on-chain backend is a second
implementation of the *same* `applyDraftAction`.

| Off-chain model (§2) | On-chain (`contracts/DraftSystem.sol`) |
|---|---|
| `draft.pickOrder[currentIdx]` "on the clock" | `picks[season][currentPickIdx]` + `onTheClock()` view |
| `controllerFor(teamId)` | `teamNFT.ownerOf(p.teamId) == msg.sender` (the NFT owner *is* the GM) |
| `MAKE_PICK(teamId, prospectId)` | `selectPlayer(prospectIdx)` (auth'd, charges `PICK_FEE` GRID) |
| `CLOCK_EXPIRE` → auto-pick best-by-need | `forcePick()` — **permissionless**, picks from on-chain `queues[teamId]` |
| Pinned target / big board | `setQueue(teamId, prospectIdxs)` (pre-committed, used by `forcePick`) |
| `PROPOSE_TRADE` / `ACCEPT_TRADE` | `proposeTrade(...)` / `acceptTrade(offerId)` — atomic pick-ownership swap |
| Reducer recomputes `pickOrder` after a trade | `acceptTrade` mutates `Pick.teamId` (source of truth); order is derived |
| Front-end re-render | subscribe to events (`OnTheClock`, `PickMade`, `TradeAccepted`, …) |

### 7.2 Why MegaETH specifically

A live, on-the-clock draft needs the chain to feel like a game loop, not a
settlement layer. MegaETH (real-time EVM L2, chainId **6342**) gives
~milliseconds-to-confirm and cheap gas, so a pick or a trade-accept lands inside
the visible clock window — the board *ticks* in near-real-time off the event
stream. On a slow/expensive L1 the "on the clock" fiction breaks (you'd be
waiting 12s + paying real money per pick); on MegaETH it's playable.

### 7.3 The on-chain clock (the hard part, solved trustlessly)

Contracts can't run timers. The pattern in `DraftSystem.sol`:
- Each pick has an on-chain **`pickDeadline = block.timestamp + pickClock`**
  (default 90s, commissioner-tunable via `setPickClock`).
- The on-clock GM calls `selectPlayer` before the deadline.
- If they stall, **anyone** (a keeper bot, an opponent, the commissioner —
  permissionless) can call **`forcePick()`** once `block.timestamp > pickDeadline`.
  It auto-picks the best un-taken prospect from that team's pre-committed
  `queues[teamId]` (falling back to first-available), then advances. No fee is
  charged on an auto-pick (the GM forfeited their action), and the draft can
  never deadlock on an absent owner.
- `forcePick` being permissionless is the whole trick: liveness doesn't depend on
  any single party staying online, so the draft self-heals.

### 7.4 Trade up / down on-chain

`proposeTrade(fromTeam, toTeam, picksOut[], picksIn[], gridOut)` opens an offer
(pick indices + an optional GRID sweetener); the counterparty's NFT owner calls
`acceptTrade(offerId)` for an **atomic** swap of `Pick.teamId` ownership (+ GRID
transfer). Both sides are re-validated at accept-time (`_requireOwnedUnused`), and
if the swap touches the pick currently on the clock, the deadline resets for the
new owner. Because the pick board's owner field *is* the source of truth, the
order reorders for free — same invariant as the off-chain reducer. This is the
exact "trade down while on the clock" the user asked for, made trustless.

### 7.5 Signing & roster, atomically with the pick

`_commitPick` does the football bookkeeping in the same transaction as the pick:
`playerNFT.sign(pid, teamId, 4, salary)` (4-yr rookie deal) + `teamNFT.addToRoster`.
So "make pick" and "player is now signed to your team" are one atomic on-chain
fact — no drift between the draft and the roster.

### 7.6 Friction to design around (honest list)

- **Approvals / gas.** `selectPlayer` needs a prior `GRID.approve` for `PICK_FEE`,
  and every action is a tx (wallet pop / gas). For a snappy feel, use a session
  key or a relayer so the GM isn't signing every pick — or make manual picks
  free and only charge elsewhere. MegaETH's low fees make this tolerable; the UX
  still has to hide it.
- **Prospect identity.** Prospects are `playerNFT` ids minted before `openDraft`;
  the off-chain prospect class must be reconciled to on-chain ids (a pre-draft
  mint/seed step, `scripts/seed.js`).
- **Privacy.** On-chain `queues` (big boards) are public — opponents can read your
  board. A commit–reveal queue is the fix if that matters; for v1, public boards
  are an acceptable (even fun) tradeoff.
- **Front-end is a pure view.** The client never owns draft logic on this path; it
  renders from events and `onTheClock()` and submits txs. The off-chain reducer
  (§2) remains the single-player / hot-seat backend — **same actions, two
  backends**, selected by `controllerFor` returning `"remote:chain"`.

### 7.7 Status of the on-chain piece

`contracts/DraftSystem.sol` is written and **compiles** (`npx hardhat compile`,
solc 0.8.20, OZ 5.0.2 pinned). It is the concrete Stage-4 sketch — deadline +
permissionless queue auto-pick + propose/accept trades — not yet deployed or
wired to the front-end. Next steps when Stage 4 is picked up: deploy script +
ABI into `src/contracts`, an events→reducer adapter on the client, and a
keeper/`forcePick` bot. (The contract is **not** covered by the teleport/audit
gates — those guard the JS sim engine; contracts are gated by `hardhat compile`.)
