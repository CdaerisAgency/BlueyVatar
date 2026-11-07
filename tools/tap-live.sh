#!/usr/bin/env bash
# Runs the live Tap test (apps/indexer/src/tap-live.test.ts) against a real Tap instance.
# See docs/testing-live-tap-v1.md (external mode). Stop any other consumer of the same Tap first.
set -euo pipefail

need=(TAP_LIVE_URL TAP_LIVE_IDENTIFIER TAP_LIVE_APP_PASSWORD TEST_DATABASE_URL)
missing=()
for v in "${need[@]}"; do
  [ -n "${!v:-}" ] || missing+=("$v")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "tap-live: missing ${missing[*]}" >&2
  echo "Optional: TAP_LIVE_ADMIN_PASSWORD (or TAP_ADMIN_PASSWORD), TAP_LIVE_PDS_URL, TAP_LIVE_TIMEOUT_MS, TAP_LIVE_CHECK_STATUS=1" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
pnpm --filter @blueyvatar/core build
exec pnpm --filter @blueyvatar/indexer test:tap-live
