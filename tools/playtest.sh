#!/usr/bin/env bash
# Gods as theorems — deterministic god-bot matches + mechanism proofs:
#   solution: the authored 'player' strategy (plateau engineering + early aggression + the
#             volcano-then-armageddon finisher) vs the stock AI must WIN
#   null: a god who never acts must LOSE
#   ablate-flatten: powers without terraforming must LOSE (flattening is load-bearing)
#   ablate-powers: terraforming without attack powers WINS — declared finding: against the
#             stock AI the economy is the whole theorem; attack powers are convenience
#   mech-*: canon mechanisms proven in isolation (flat->level, deform->collapse, magnet/leader,
#             swamp persistence, quake shatter, flood drown, walker merge)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-chromium}"
run() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --virtual-time-budget=120000 --dump-dom \
    "file://$DIR/index.html?verify=$1" 2>/dev/null | grep -o 'VERIFY:{[^<]*' | head -1
}
for m in solution null ablate-flatten ablate-powers mech-flat mech-collapse mech-magnet mech-swamp mech-quake mech-flood mech-merge mech-leader; do
  run "$m"
done
