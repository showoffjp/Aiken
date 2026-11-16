#!/usr/bin/env bash
# Build, capture concepts, and cut the captures into viewable strips.
# Usage: scripts/review.sh <slug> [<slug> ...]
set -euo pipefail
cd "$(dirname "$0")/.."
npx astro build >/dev/null 2>&1 || { npx astro build 2>&1 | tail -20; exit 1; }
node scripts/shots.mjs --review "$@"
for slug in "$@"; do node scripts/strips.mjs "$slug" 3; done
