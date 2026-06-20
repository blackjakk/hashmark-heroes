#!/usr/bin/env bash
# _teleport_gate.sh — deterministic teleport regression gate.
#
# Captures the SEEDED battery, replays it through the REAL renderer, and fails
# if egregious (>=6yd/frame) player teleports exceed the committed baseline in
# _teleport_baseline.json. Because the capture is seeded the count is
# reproducible run-to-run (the old unseeded harness wobbled 4-13 on identical
# code, so its pass/fail line was meaningless). This is the gate that makes the
# 96%-reduction claim defensible against silent regression.
#
#   Usage:  ./_teleport_gate.sh [games] [seed]      (defaults match the baseline)
#   Exit :  0 = at/under baseline   1 = regression   2 = harness error
#
# Prereqs in this environment: node, npx http-server, Playwright at the path
# hardcoded in _teleport_detect.js. For CI, install Playwright + a static server
# and point the detector at them; the capture step is pure node.

cd "$(dirname "$0")" || exit 2

GAMES="${1:-4}"
SEED="${2:-1337}"
CAM="tactical"
PORT=5173

echo "▶ capture (seed=$SEED, games=$GAMES) — deterministic battery ..."
if ! node _teleport_capture.js "$GAMES" "$SEED" >/tmp/teleport_capture.log 2>&1; then
  echo "✗ capture failed:"; cat /tmp/teleport_capture.log; exit 2
fi

SERVER_PID=""
if ! curl -s -o /dev/null "http://localhost:$PORT/play.html"; then
  echo "▶ starting http-server on :$PORT ..."
  nohup npx --yes http-server -p "$PORT" -c-1 -s . >/tmp/dev-server.log 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 20); do
    curl -s -o /dev/null "http://localhost:$PORT/play.html" && break
    sleep 0.5
  done
fi

echo "▶ detect (cam=$CAM) — real render path ..."
OUT="$(node _teleport_detect.js "$CAM" 2>/dev/null)"
DETECT_RC=$?
[ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
if [ "$DETECT_RC" -ne 0 ]; then echo "✗ detect failed (rc=$DETECT_RC)"; exit 2; fi

# Parse the count AFTER the colon — NOT the "6" inside the "(>=6yd/frame)"
# threshold label. The "✓ No EGREGIOUS ..." branch (count 0) has no number.
if printf '%s\n' "$OUT" | grep -q 'No EGREGIOUS player teleports'; then
  EGREGIOUS=0
else
  EGREGIOUS="$(printf '%s\n' "$OUT" | awk -F': ' '/EGREGIOUS player teleports \(/{print $2}' | grep -oE '^[0-9]+' | head -1)"
fi
if [ -z "$EGREGIOUS" ]; then echo "✗ could not parse egregious count:"; printf '%s\n' "$OUT"; exit 2; fi

# RUNAWAY class (the post-sack sprint-into-the-wall family): late-play
# sustained sprint that ends far from the dead ball. Gated like egregious.
RUNAWAY="$(printf '%s\n' "$OUT" | awk -F': ' '/Runaway players/{print $2}' | grep -oE '^[0-9]+' | head -1)"
[ -z "$RUNAWAY" ] && RUNAWAY=0

# LOOP class (DEF-side big circular path — the "#27 ran a big loop" family that
# the magnitude/runaway classes miss). Only the DEFENDER count is gated;
# offensive YAC circles are legit and reported informationally.
LOOP="$(printf '%s\n' "$OUT" | awk -F': ' '/Loop DEF-side/{print $2}' | grep -oE '^[0-9]+' | head -1)"
[ -z "$LOOP" ] && LOOP=0

BASE="$(node -e "process.stdout.write(String(require('./_teleport_baseline.json').egregious))")"
RBASE="$(node -e "process.stdout.write(String(require('./_teleport_baseline.json').runaway ?? 9999))")"
LBASE="$(node -e "process.stdout.write(String(require('./_teleport_baseline.json').loop ?? 9999))")"

echo ""
echo "  egregious this run : $EGREGIOUS"
echo "  runaway this run   : $RUNAWAY"
echo "  loop (DEF) this run: $LOOP"
echo "  baselines          : egregious $BASE · runaway $RBASE · loop $LBASE   (seed=$SEED, $GAMES games, cam=$CAM)"
FAIL=0
if [ "$EGREGIOUS" -gt "$BASE" ]; then
  echo "✗ TELEPORT REGRESSION — $EGREGIOUS > $BASE. Detail → /tmp/teleport_report.json"
  FAIL=1
fi
if [ "$RUNAWAY" -gt "$RBASE" ]; then
  echo "✗ RUNAWAY REGRESSION — $RUNAWAY > $RBASE. Detail → /tmp/teleport_report.json"
  FAIL=1
fi
if [ "$LOOP" -gt "$LBASE" ]; then
  echo "✗ LOOP REGRESSION — $LOOP > $LBASE (DEF-side circular path). Detail → /tmp/teleport_report.json"
  FAIL=1
fi
[ "$FAIL" -ne 0 ] && exit 1
echo "✓ teleport gate PASS — egregious $EGREGIOUS ≤ $BASE · runaway $RUNAWAY ≤ $RBASE · loop $LOOP ≤ $LBASE"
exit 0
