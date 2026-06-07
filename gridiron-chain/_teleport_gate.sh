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

BASE="$(node -e "process.stdout.write(String(require('./_teleport_baseline.json').egregious))")"

echo ""
echo "  egregious this run : $EGREGIOUS"
echo "  baseline           : $BASE   (seed=$SEED, $GAMES games, cam=$CAM)"
if [ "$EGREGIOUS" -gt "$BASE" ]; then
  echo "✗ TELEPORT REGRESSION — $EGREGIOUS > $BASE. Detail → /tmp/teleport_report.json"
  exit 1
fi
echo "✓ teleport gate PASS — $EGREGIOUS ≤ $BASE"
exit 0
