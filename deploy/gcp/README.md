# Deploy Firecrawl MCP to Google Cloud (GCP-native)

Runs the Firecrawl MCP server as a managed **Cloud Run** service. The Firecrawl
API key lives in **Secret Manager** and is injected at runtime — it is never baked
into the image, this repo, or a command line.

## Architecture

```
  Claude (Code / Desktop)
        │  HTTPS  /mcp   (via `gcloud run services proxy`, or an authed client)
        ▼
  ┌─────────────────────────────┐        reads at runtime        ┌────────────────┐
  │  Cloud Run: firecrawl-mcp   │ ─────────────────────────────> │ Secret Manager │
  │  node dist/index.js on $PORT│   FIRECRAWL_API_KEY=secret      │ firecrawl-api- │
  │  HTTP_STREAMABLE_SERVER=true │ <───────────────────────────── │ key:latest     │
  └─────────────────────────────┘                                 └────────────────┘
        │  image pulled from
        ▼
  Artifact Registry  ◀── built/pushed by Cloud Build (cloudbuild.yaml)
```

**Why this mode:** with `HTTP_STREAMABLE_SERVER=true` the server uses the env
`FIRECRAWL_API_KEY` as its default credential, so clients hit `/mcp` without
supplying a key. (`CLOUD_SERVICE=true` is the *multi-tenant* mode used by the
hosted `mcp.firecrawl.dev` — it ignores the env key and demands a per-request
credential; that is **not** what you want for a single-tenant managed server.)

The repo-root `Dockerfile` (plain node on `$PORT`) is the right image for Cloud
Run. The `Dockerfile.service` NGINX sidecar listens on 8080 and would collide
with the `PORT=8080` Cloud Run injects, and its only added value is legacy
`/{apiKey}/…` path rewriting we don't need here.

## One-command deploy

```bash
export PROJECT_ID=your-project
export REGION=us-central1                 # optional
export FIRECRAWL_API_KEY=fc-xxxxxxxx       # first deploy or rotation only; read via stdin into Secret Manager
./deploy.sh
```

`deploy.sh` is idempotent. It enables the APIs, ensures the Artifact Registry repo
and the Secret Manager secret, grants the runtime service account
`secretmanager.secretAccessor`, builds + pushes the image, and applies
[`service.yaml`](./service.yaml). The service is left **private** (IAM-invoker).

## Manual steps (what the script automates)

```bash
# 1) APIs
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com

# 2) Artifact Registry
gcloud artifacts repositories create firecrawl-mcp \
  --repository-format=docker --location="$REGION"

# 3) Secret — fed via STDIN so the key never lands in argv/history/files
printf '%s' "$FIRECRAWL_API_KEY" | \
  gcloud secrets create firecrawl-api-key --replication-policy=automatic --data-file=-

# 4) Build + push (repo root)
gcloud builds submit . \
  --tag "$REGION-docker.pkg.dev/$PROJECT_ID/firecrawl-mcp/firecrawl-mcp:latest"

# 5) Deploy with the key mounted from Secret Manager
gcloud run deploy firecrawl-mcp \
  --image "$REGION-docker.pkg.dev/$PROJECT_ID/firecrawl-mcp/firecrawl-mcp:latest" \
  --region "$REGION" --port 8080 \
  --set-env-vars HTTP_STREAMABLE_SERVER=true \
  --set-secrets FIRECRAWL_API_KEY=firecrawl-api-key:latest
```

## Connect Claude to the deployed server

The service is private (it holds your key — a public `/mcp` would let anyone spend
your Firecrawl credits). Reach it through an authenticated local proxy:

```bash
gcloud run services proxy firecrawl-mcp --region "$REGION"   # → http://127.0.0.1:8080
```

Then point Claude Code at the proxied URL:

```bash
claude mcp add firecrawl-gcp --transport http http://127.0.0.1:8080/mcp
```

> Only if you deliberately want a public endpoint, grant `allUsers` the
> `roles/run.invoker` role (see the commented command in `deploy.sh`). Not
> recommended while the server carries an embedded key.

## Rotate the key

The key was shared in plaintext at least once — rotate it. Mint a new key in the
[Firecrawl dashboard](https://www.firecrawl.dev/app/api-keys), then:

```bash
printf '%s' "$NEW_KEY" | gcloud secrets versions add firecrawl-api-key --data-file=-
gcloud run services update firecrawl-mcp --region "$REGION"   # picks up :latest on next revision
```

## Continuous deployment

Wire [`cloudbuild.yaml`](./cloudbuild.yaml) to a Cloud Build trigger on your
default branch to build, push, and deploy on every merge.

## Verify

```bash
URL=$(gcloud run services describe firecrawl-mcp --region "$REGION" --format='value(status.url)')
curl -s "$URL/health"            # 200 OK (unauthenticated health probe)
# MCP initialize handshake over the authenticated proxy:
curl -s http://127.0.0.1:8080/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'
```
