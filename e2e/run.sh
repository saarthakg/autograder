#!/usr/bin/env bash
# Runs the browser regression tests against a running app.
#   ./e2e/run.sh                         # http://localhost:3000
#   ./e2e/run.sh https://<public-url>    # the deployed app
# Workspaces the run creates are recorded in e2e/.runs/<run_id>.jsonl for cleanup.
# Not part of CI: these hit a live server and the one flagged-item test grades for real.
set -euo pipefail
cd "$(dirname "$0")"
export E2E_BASE_URL="${1:-http://localhost:3000}"
export E2E_RUN_ID="${E2E_RUN_ID:-e2e-$(date -u +%Y%m%dT%H%M%SZ)}"
[ -d node_modules ] || bun install
bunx playwright install --no-shell chromium >/dev/null  # full Chromium, run headless (channel "chromium")
echo "e2e against $E2E_BASE_URL (run_id $E2E_RUN_ID)"
bunx playwright test "${@:2}"
