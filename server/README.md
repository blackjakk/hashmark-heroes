# H2H match server — running & deploying

The authoritative server for live head-to-head matches. Plain Node, **zero
npm dependencies**, no build step. Design record:
`INGAME_CLOCK_AND_MULTIPLAYER.md` §C.3.

## Local

```bash
node server/h2h-server.js            # API on :8787
node server/h2h-server.js 9000       # custom port
```

The game client (served separately, e.g. `npx http-server -p 5173`) points
at the server via the "match server" field (dev panel or the 🌐 footer
modal). The share link carries the server address to the joiner.

## Single-process deployment (recommended)

```bash
H2H_STATIC=1 node server/h2h-server.js 8787
# or: node server/h2h-server.js 8787 --static
```

`H2H_STATIC` also serves the game files from the repo root on the same
origin — one process, one port. The client detects this via
`/api/health` and defaults its server field to `location.origin`, and the
share links just work.

## A real box (VPS + TLS)

The server itself stays plain HTTP; terminate TLS at a reverse proxy.
With [Caddy](https://caddyserver.com) (automatic certificates):

```
# /etc/caddy/Caddyfile
yourdomain.example {
    reverse_proxy 127.0.0.1:8787
}
```

systemd unit:

```ini
# /etc/systemd/system/h2h.service
[Unit]
Description=Hashmark Heroes H2H match server
After=network.target

[Service]
WorkingDirectory=/opt/hashmark-heroes
Environment=H2H_STATIC=1
Environment=H2H_DATA=/var/lib/h2h
ExecStart=/usr/bin/node server/h2h-server.js 8787
Restart=always

[Install]
WantedBy=multi-user.target
```

Restarts are free: matches persist as append-only JSONL under `H2H_DATA`
(default `server/data/`), and the server re-sims every unfinished match
back to its exact pending state on boot — determinism IS the recovery
mechanism. SSE reconnects natively (EventSource + Last-Event-ID replay).

Note: one SSE connection per player per match; the kernel's default file
descriptor limits are fine for hobby scale.

## Tests

```bash
node server/h2h-probe.js           # two scripted clients, full match over the wire,
                                   # timeout fallback, independent artifact re-sim,
                                   # canonical OUTCOME-hash match (full play-by-play)
node server/h2h-recovery-probe.js  # SIGKILL mid-match → respawn → exact state restore
node server/h2h-client-probe.js    # two REAL headless browsers through the actual UI
node server/determinism-probe.js   # result-hash.js is sound: stable re-sim, seed-
                                   # sensitive, tamper-evident vs a score-preserving edit
```

## API sketch

See the header comment in `h2h-server.js`. Decision windows for the same
snap run in **parallel under one shared play-clock** (defense + offense
prompt simultaneously; answers commit to the tape in seam order). The
match artifact is served at `/api/artifact/:id` and carries TWO hashes,
the settlement pair:

- **`hash`** — SHA-256 of the INPUTS `{seed, rosters, tape}`. Binds what the
  match was *given*.
- **`resultHash`** — SHA-256 of the canonical OUTCOME (`result-hash.js`): final
  score + box score + every play's outcome fields, with cosmetic/derived data
  (`motion`/`statsSnap`/`desc`) stripped and keys sorted so it depends only on
  the data. Binds what *happened*.

A challenger re-sims the inputs, recomputes `resultHash`, and disputes on a
mismatch — the optimistic-challenge settlement hook. (Comparing only the final
score + play count, as the first cut did, would wave through a play-by-play or
box-score tamper; `determinism-probe.js` demonstrates exactly that gap.)
