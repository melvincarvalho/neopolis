#!/usr/bin/env bash
# Gods as theorems — deterministic god-bot matches + mechanism proofs:
#   solution: full god-bot (with declared faster-clock edge) vs full AI must WIN or finish AHEAD
#   null: a god who never acts must LOSE
#   ablate-flatten: powers without terraforming must LOSE/BEHIND (flattening is load-bearing)
#   ablate-powers: terraforming without attack powers — outcome reported honestly
#   mech-*: canon mechanisms proven in isolation (flat->level, deform->collapse, magnet command)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-chromium}"
run() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --virtual-time-budget=120000 --dump-dom \
    "file://$DIR/index.html?verify=$1" 2>/dev/null | grep -o 'VERIFY:{[^<]*' | head -1
}
for m in solution null ablate-flatten ablate-powers mech-flat mech-collapse mech-magnet; do
  run "$m"
done
