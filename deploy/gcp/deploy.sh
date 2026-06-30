#!/usr/bin/env bash
# Deploy the Firecrawl MCP server to Cloud Run, GCP-native.
#
# The Firecrawl API key is stored in Secret Manager and read into the secret via
# STDIN — it is never passed on the command line (argv leaks into shell history
# and process listings) and never written to a file in this repo.
#
# Usage:
#   export PROJECT_ID=your-project
#   export REGION=us-central1                 # optional, defaults below
#   export FIRECRAWL_API_KEY=fc-...           # only needed the first time (or to rotate)
#   ./deploy.sh
#
# Prereqs: gcloud CLI authenticated (`gcloud auth login`) with rights to enable
# services, push to Artifact Registry, manage secrets, and deploy Cloud Run.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-firecrawl-mcp}"
REPO="${REPO:-firecrawl-mcp}"
SECRET="${SECRET:-firecrawl-api-key}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:latest"
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo ">> Project=${PROJECT_ID} Region=${REGION} Service=${SERVICE}"
gcloud config set project "${PROJECT_ID}" >/dev/null

echo ">> Enabling required APIs"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com >/dev/null

echo ">> Ensuring Artifact Registry repo '${REPO}'"
gcloud artifacts repositories describe "${REPO}" --location "${REGION}" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "${REPO}" \
    --repository-format=docker --location "${REGION}" \
    --description="Firecrawl MCP server images"

echo ">> Ensuring Secret Manager secret '${SECRET}'"
if ! gcloud secrets describe "${SECRET}" >/dev/null 2>&1; then
  : "${FIRECRAWL_API_KEY:?Secret does not exist yet — export FIRECRAWL_API_KEY to seed it}"
  printf '%s' "${FIRECRAWL_API_KEY}" | \
    gcloud secrets create "${SECRET}" --replication-policy=automatic --data-file=-
  echo "   created secret ${SECRET} (v1)"
elif [[ -n "${FIRECRAWL_API_KEY:-}" ]]; then
  printf '%s' "${FIRECRAWL_API_KEY}" | gcloud secrets versions add "${SECRET}" --data-file=-
  echo "   added new secret version (key rotation)"
else
  echo "   secret exists; leaving current version in place"
fi

# Grant the Cloud Run runtime service account read access to the secret.
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
RUNTIME_SA="${RUNTIME_SA:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"
echo ">> Granting secretAccessor to ${RUNTIME_SA}"
gcloud secrets add-iam-policy-binding "${SECRET}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor" >/dev/null

echo ">> Building & pushing image with Cloud Build"
gcloud builds submit "${ROOT_DIR}" --tag "${IMAGE}"

echo ">> Rendering service.yaml and deploying"
RENDERED="$(mktemp)"
sed -e "s|REGION|${REGION}|g" -e "s|PROJECT_ID|${PROJECT_ID}|g" \
  "$(dirname "$0")/service.yaml" > "${RENDERED}"
# Pin the image we just built (in case of digest changes you can swap :latest for a digest).
gcloud run services replace "${RENDERED}" --region "${REGION}"
rm -f "${RENDERED}"

# Private by default: the server holds your key, so do NOT expose it publicly —
# anyone reaching /mcp would spend your Firecrawl credits. Access it locally via:
#   gcloud run services proxy ${SERVICE} --region ${REGION}   # -> http://127.0.0.1:8080/mcp
# To intentionally make it a public endpoint (not recommended), run:
#   gcloud run services add-iam-policy-binding ${SERVICE} --region ${REGION} \
#     --member=allUsers --role=roles/run.invoker
echo ">> Keeping service private (IAM-invoker). Use 'gcloud run services proxy ${SERVICE} --region ${REGION}' to connect."

URL="$(gcloud run services describe "${SERVICE}" --region "${REGION}" --format='value(status.url)')"
echo ">> Deployed: ${URL}  (MCP endpoint: ${URL}/mcp, health: ${URL}/health)"
