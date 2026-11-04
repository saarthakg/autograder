#!/usr/bin/env bash
# Deploys the single Cloud Run service (D-28): build -> push -> migrate -> deploy.
# Secrets come from .env and reach Cloud Run through a temp env-vars file,
# never through command-line arguments or logs.
#
# Usage: ops/deploy.sh [--project ID] [--region REGION] [--chaos]
#   --project  GCP project (default: $GCP_PROJECT, then the gcloud config's project)
#   --region   Cloud Run region (default: $GCP_REGION, then the gcloud config's run/region)
#   --chaos    enable the crash endpoint (ENABLE_CHAOS=1) for a chaos run; redeploy without it after.
# Optional tuning overrides, read from the deploying shell and validated before anything is built:
#   JOB_LEASE, JOB_HEARTBEAT            Effect durations, e.g. "30 seconds" (not "30s")
#   MODEL_CONCURRENCY, MODEL_MAX_IN_FLIGHT  positive integers
set -euo pipefail
cd "$(dirname "$0")/.."

usage="usage: ops/deploy.sh [--project ID] [--region REGION] [--chaos]"
chaos=0
PROJECT="${GCP_PROJECT:-}"
REGION="${GCP_REGION:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --chaos) chaos=1 ;;
    --project) [ $# -ge 2 ] || { echo "$usage" >&2; exit 2; }; PROJECT="$2"; shift ;;
    --region) [ $# -ge 2 ] || { echo "$usage" >&2; exit 2; }; REGION="$2"; shift ;;
    *) echo "unknown argument: $1 ($usage)" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$PROJECT" ] || PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
[ -n "$REGION" ] || REGION="$(gcloud config get-value run/region 2>/dev/null || true)"
[ -n "$PROJECT" ] || { echo "no GCP project: pass --project or set GCP_PROJECT" >&2; exit 2; }
[ -n "$REGION" ] || { echo "no region: pass --region or set GCP_REGION (production runs in us-east4)" >&2; exit 2; }
# Chaos only by explicit flag: a stray ENABLE_CHAOS=1 in the shell must not reach prod.
if [ -n "${ENABLE_CHAOS:-}" ] && [ "$chaos" != "1" ]; then
  echo "refusing: ENABLE_CHAOS is set in the shell; pass --chaos to deploy the crash endpoint on purpose" >&2
  exit 2
fi

# Validate overrides before building: a bad value would otherwise surface as a revision that never starts.
# Same grammar as Effect's Duration parser (Duration.ts DURATION_REGEXP).
duration_re='^[0-9]+(\.[0-9]+)? (nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$'
for key in JOB_LEASE JOB_HEARTBEAT; do
  val="${!key:-}"
  if [ -n "$val" ] && ! [[ "$val" =~ $duration_re ]]; then
    echo "invalid $key='$val': use an Effect duration such as '30 seconds'" >&2; exit 2
  fi
done
for key in MODEL_CONCURRENCY MODEL_MAX_IN_FLIGHT; do
  val="${!key:-}"
  if [ -n "$val" ] && ! [[ "$val" =~ ^[1-9][0-9]*$ ]]; then
    echo "invalid $key='$val': use a positive integer" >&2; exit 2
  fi
done

SERVICE=autograder
REPO=autograder
SHA="$(git rev-parse --short HEAD)"
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/app:$SHA"

# Read KEY from .env without `source`: Neon URLs contain '&', which a shell would run.
env_val() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -E "s/^['\"]//; s/['\"]$//"; }
for key in DATABASE_URL DATABASE_URL_DIRECT ADMIN_TOKEN; do
  [ -n "$(env_val "$key")" ] || { echo "missing $key in .env" >&2; exit 1; }
done
[ -z "$(git status --porcelain)" ] || echo "warning: uncommitted changes are not in image $SHA" >&2

echo "==> APIs (Cloud Run, Artifact Registry only)"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com --project "$PROJECT"

echo "==> Artifact Registry repo"
gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION" --project "$PROJECT"
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet >/dev/null 2>&1

echo "==> Build and push $IMAGE (linux/amd64)"
docker buildx build --platform linux/amd64 --build-arg APP_VERSION="$SHA" -t "$IMAGE" --push .

echo "==> Migrate (direct URL)"
(cd apps/server && bun --env-file=../../.env src/migrate.ts)

echo "==> Deploy $SERVICE"
envfile="$(mktemp)"
chmod 600 "$envfile"
trap 'rm -f "$envfile"' EXIT
yaml_quote() { printf "'%s'" "${1//\'/\'\'}"; }
{
  echo "DATABASE_URL: $(yaml_quote "$(env_val DATABASE_URL)")"
  echo "ADMIN_TOKEN: $(yaml_quote "$(env_val ADMIN_TOKEN)")"
  key="$(env_val OPENROUTER_API_KEY)"; [ -n "$key" ] && echo "OPENROUTER_API_KEY: $(yaml_quote "$key")"
  echo "APP_VERSION: '$SHA'"
  if [ "$chaos" = "1" ]; then echo "ENABLE_CHAOS: '1'"; fi
  for key in JOB_LEASE JOB_HEARTBEAT MODEL_CONCURRENCY MODEL_MAX_IN_FLIGHT; do
    if [ -n "${!key:-}" ]; then echo "$key: $(yaml_quote "${!key}")"; fi
  done
} > "$envfile"
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" --region "$REGION" --image "$IMAGE" \
  --allow-unauthenticated \
  --no-cpu-throttling \
  --min-instances 0 --max-instances 3 \
  --cpu 1 --memory 512Mi \
  --env-vars-file "$envfile"

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')"
echo "==> $URL"
curl -fsS "$URL/api/health" && echo
