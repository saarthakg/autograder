#!/usr/bin/env bash
# Deploys the single Cloud Run service (D-28): build -> push -> migrate -> deploy.
# Secrets come from .env and reach Cloud Run through a temp env-vars file,
# never through command-line arguments or logs.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION=us-east4
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
  # Opt-in, from the deploying shell only: ENABLE_CHAOS=1 for the chaos run, JOB_LEASE to compare leases.
  if [ "${ENABLE_CHAOS:-}" = "1" ]; then echo "ENABLE_CHAOS: '1'"; fi
  if [ -n "${JOB_LEASE:-}" ]; then echo "JOB_LEASE: $(yaml_quote "$JOB_LEASE")"; fi
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
