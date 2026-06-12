#!/usr/bin/env bash
# _stamp_build.sh — cache-bust the game's assets. Rewrites the ?v= query
# on every local script tag in play.html and refreshes window.GC_BUILD
# (which play-sprites.js appends to sprite/manifest URLs). Run before any
# push that changes JS or art:
#     ./tools/_stamp_build.sh && git add play.html
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD="$(date +%Y%m%d%H%M%S)"
# Stamp (or restamp) script src queries
sed -i -E "s|src=\"(play-[a-z0-9-]+\.js)(\?v=[0-9]*)?\"|src=\"\1?v=${BUILD}\"|g" play.html
# Stamp the GC_BUILD constant (insert if missing)
if grep -q 'window.GC_BUILD' play.html; then
  sed -i -E "s|window.GC_BUILD=\"[0-9]*\"|window.GC_BUILD=\"${BUILD}\"|" play.html
else
  sed -i "s|<script src=\"play-data.js|<script>window.GC_BUILD=\"${BUILD}\";</script>\n<script src=\"play-data.js|" play.html
fi
echo "stamped build ${BUILD}"
