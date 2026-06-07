#!/usr/bin/env bash
# _audit_all.sh — run the FULL audit bundle ("all materials") in one shot.
# This is the STANDARD audit run: every time we change the sim/talent model and
# want to check realism, run THIS, not a single harness — it produces both the
# game-realism stats AND the franchise/career/record-book materials.
#
#   ./_audit_all.sh [seasons]      # default 40
#
# Both harnesses run in parallel (separate logs). See AUDIT.md for what each
# section means and the NFL bands.
set -u
S="${1:-40}"
cd "$(dirname "$0")"
SIM_LOG=/tmp/audit_sim_${S}.log
BRADY_LOG=/tmp/audit_brady_${S}.log

echo "════════════════════════════════════════════════════════════"
echo " FULL AUDIT BUNDLE — ${S} seasons"
echo "════════════════════════════════════════════════════════════"
echo " [game realism]  _sim_audit  → ${SIM_LOG}"
echo " [franchise]     _brady_audit → ${BRADY_LOG}"
echo " running both in parallel; this takes a while..."

node _sim_audit.js   "$S" > "$SIM_LOG"   2>&1 &
SIM=$!
node _brady_audit.js "$S" > "$BRADY_LOG" 2>&1 &
BRADY=$!
wait "$SIM"; SIM_RC=$?
wait "$BRADY"; BRADY_RC=$?

echo ""
echo " DONE — sim rc=${SIM_RC}, brady rc=${BRADY_RC}"
echo "   game realism : ${SIM_LOG}"
echo "   franchise    : ${BRADY_LOG}"
echo " (read both — that's the complete bundle)"
