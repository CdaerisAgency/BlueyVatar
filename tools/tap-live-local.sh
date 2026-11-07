#!/usr/bin/env bash
# Runs the live Tap test (apps/indexer/src/tap-live.test.ts) against a throwaway local stack: a local
# PLC directory and PDS plus the Tap image pinned in fly/tap.toml, in Docker. Nothing leaves the machine.
# See docs/testing-live-tap-v1.md.
#
# Needs: Docker (or TAP_LIVE_TAP_BIN, a Tap binary built from the same indigo tag) and TEST_DATABASE_URL,
# a Postgres the test may create and drop a schema in.
set -euo pipefail

if [ -z "${TEST_DATABASE_URL:-}" ]; then
  echo "tap-live-local: set TEST_DATABASE_URL (a Postgres where the test can create and drop a schema)." >&2
  exit 2
fi
if [ -z "${TAP_LIVE_TAP_BIN:-}" ] && ! docker info >/dev/null 2>&1; then
  echo "tap-live-local: Docker is not available. Start Docker, or set TAP_LIVE_TAP_BIN to a Tap binary built from the pinned tag." >&2
  exit 2
fi

cd "$(dirname "$0")/.."
npm ci --prefix apps/indexer/live-stack
pnpm --filter @blueyvatar/core build
export LIVE_TAP_TEST=1
exec pnpm --filter @blueyvatar/indexer test:tap-live
