# iOSLENS — Governed Intelligence Control Plane

**SMEPro Intelligence Orchestration System (IOS+) · Lamar University pilot.**

A turnkey, production-shaped implementation of the iOSLENS technical architecture
package: the **Compliance Decoding Matrix**, the **iOSLENS decision/persistence
engine**, the append-only **audit store**, and the **two-layer (Entra + Matrix)
MCP authorization server**.

> The enforcement chain: **Matrix defines → iOSLENS decides → MCP exposes → Entra
> enforces → apps consume.** Each layer has one job, and the separation is what
> makes the whole package auditable.

It runs **offline with zero dependencies** (in-memory Matrix + dev auth) for the
pilot, and upgrades in place to **PostgreSQL 15+/pgvector** with **real Entra JWT
validation** by setting two groups of environment variables.

---

## Quick start (offline, zero install)

```bash
cd ioslens

# 1. Health check — see the wired backends and tools
node bin/ioslens.mjs --health

# 2. Run the full test suite (36 tests, no network, no deps)
npm test

# 3. Drive the MCP server over stdio
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"compliance.decide","arguments":{"subjectRef":"entra:obj:7c2a-nursing-e91"}}}' \
  | MCP_AUTH=dev MCP_DEV_ROLES=Compliance.Decide node bin/ioslens.mjs
```

The decide call reproduces the architecture package's worked example exactly:

```
SOC 29-1141 + NAICS 622110 + HIPAA → clinical scope   ⇒   scope "nursing.clinical"
```

…and writes one immutable audit record containing **pointers only** — no student
record, no enrollment status, no PII.

---

## Architecture map

Every module implements a section of the package:

| Package section | Module | What it does |
|---|---|---|
| **§01** Deployment — two-flow model | `flows/entra.mjs`, `flows/ethos.mjs` | Flow A (identity, slow-changing) + Flow B (governance context, live at resolution time) |
| **§02** Resources & inventory | `deploy/` | Azure Container Apps, pgvector, Key Vault, two-flow ownership |
| **§03** Decision & persistence contract | `core/resolver.mjs`, `core/audit.mjs` | gather→evaluate→decide→expose→record→discard; append-only pointers, never copies |
| **§04** Compliance Decoding Matrix | `matrix/*` | 8 tables, crosswalk expansion, obligation resolution, semantic fallback |
| **§05** MCP authorization model | `authz/*`, `mcp/*` | Layer 1 Entra JWT + App Roles; Layer 2 Matrix boundary |
| **§06** Open items | this README (below) | the decisions Lamar IT confirms before build |

```
              Flow A (identity, Entra)         Flow B (context, Ethos — live)
                         \                              /
                          \                            /
   Matrix (rules) ───────►  iOSLENS resolver  ◄───────
   matrix/matrix.mjs              │
                                  ▼
                       decision + rationale + trace id
                                  │
                 ┌────────────────┼─────────────────┐
                 ▼                ▼                  ▼
          MCP server        audit store         (PII discarded)
          mcp/server.mjs    core/audit.mjs
                 │
        Layer 1: Entra JWT + App Role   ──►   Layer 2: Matrix boundary
        authz/jwt.mjs, approles.mjs            matrix/matrix.mjs
```

---

## The five governed tools (§05)

Each tool is gated by an Entra **App Role** (Layer 1) and answered against the
**Matrix boundary** (Layer 2). No role for a tool → rejected with 403 before any
code runs.

| Tool | Required App Role | Purpose |
|---|---|---|
| `compliance.read` | `Compliance.Read` | Deterministic Matrix lookup (codes → obligations, citations, versions). Read-only. |
| `compliance.decide` | `Compliance.Decide` | Full governed decision for a subject; writes an immutable audit record. |
| `matrix.propose` | `Matrix.Propose` | Queue a proposed Matrix change. Cannot publish. |
| `matrix.publish` | `Matrix.Admin` | Approve a queued change + publish a new Matrix version (approver recorded). |
| `audit.read` | `Audit.Read` | Read the append-only audit store. For accreditors / reviewers. |

Least privilege, separation of duties: no single role both proposes and publishes
a Matrix change.

---

## Production deployment

### Option A — Docker Compose (PostgreSQL/pgvector)

```bash
docker compose -f deploy/docker-compose.yml up --build
# applies schema, seeds the v1 Matrix release, serves MCP on http://localhost:8080/mcp
curl -s localhost:8080/healthz | jq
```

### Option B — Azure Container Apps (§02 inventory)

```bash
# Build + push the image to your registry, then:
az deployment group create -g rg-ioslens-pilot \
  -f deploy/azure-container-app.bicep \
  -p image=<acr>.azurecr.io/ioslens:1.0.0 \
     keyVaultName=kv-ioslens-pilot \
     entraTenantId=<tenant-guid> \
     entraAudience=api://ioslens-mcp
```

The container app uses **internal ingress** (stays within Lamar's tenant
boundary), a **system-assigned identity** for Key Vault secret references, and
liveness/readiness probes on `/healthz`.

### Migrating an existing Postgres

```bash
DATABASE_URL=postgres://… npm install pg
DATABASE_URL=postgres://… node bin/migrate.mjs --seed
```

`schema.sql` is idempotent and enforces audit immutability at the database
boundary (a trigger blocks `UPDATE`/`DELETE` on `audit.decisions`).

---

## Going production: the two switches

1. **Persistence** — set `DATABASE_URL` and `npm install pg`. The Matrix and audit
   store move from in-memory to PostgreSQL/pgvector; nothing upstream changes.

2. **Authorization** — set `MCP_AUTH=entra`, `ENTRA_TENANT_ID`, `ENTRA_AUDIENCE`.
   Layer 1 switches from the insecure dev verifier to **local RS256 JWKS
   validation**: the server fetches Entra's public keys over outbound 443
   (cached), verifies signature + issuer + audience + expiry, and never opens an
   inbound port to Entra. Same egress-only posture as Entra Connect.

Wire the real flow clients by passing `{ entra, ethos }` overrides to
`createApp()` — e.g. `createClaimsEntra(jwtClaims)` (identity straight from the
validated token) and an Ethos REST/OAuth2 client for live context.

See `.env.example` for every setting.

---

## Open items for Lamar IT (§06)

These are confirmed before build; the implementation is parameterized for each:

1. **Change-control owner / `Matrix.Admin` holder** — who approves a queued change
   into a published version. Set by who is granted the `Matrix.Admin` App Role
   (`authz/approles.mjs`); enforced by `matrix.publish`.
2. **AD provisioning tool** — what writes Banner data into AD extension attributes
   (Flow A). External to this service; identity is consumed, not authored.
3. **Azure ↔ on-prem connectivity** — how the control plane reaches on-prem
   Postgres. Set `DATABASE_URL` (VPN/private-endpoint) or host the Matrix in
   Azure to avoid a cross-zone link in the pilot.
4. **Inbound exposure for the MCP server** — internal ingress by default; front
   with Entra App Proxy / private endpoint if Copilot reaches it from the cloud.
5. **Ethos API scope & entitlements** — which Ethos resources are licensed/API
   enabled. Wire the Flow B client (`flows/ethos.mjs`) to the live APIs.
6. **Pilot regime scope & embedding model** — `ACTIVE_ONLY=true` restricts to
   FERPA/THECB/SACSCOC; `EMBEDDING_MODEL`/`EMBEDDING_DIM` make the semantic
   fallback reproducible.

---

## What persists, what never does (§03)

| ✓ Persisted (pointers) | ✗ Never persisted |
|---|---|
| `decision_id`, `trace_id` | student records (names, IDs, demographics) |
| `subject_ref` (Entra object-id pointer) | enrollment status (read live, discarded) |
| `decision`, `rationale` | program detail · PII |
| `matrix_refs` (regime/obligation IDs) | Ethos record bodies (only URI + timestamp kept) |
| `evidence_pointers` (Ethos URIs + timestamps) | |

No second data store of protected data; every decision is reconstructable via
trace id + pointers; decisions always reflect current state because context is
read live and discarded — no stale snapshot to invalidate.

---

## Module index

```
ioslens/
  bin/        ioslens.mjs (server)        migrate.mjs (schema + seed)
  core/       config · app · resolver · audit · ids
  matrix/     matrix · store · embeddings · schema.sql · seed/
  flows/      entra (Flow A) · ethos (Flow B)
  authz/      jwt (Layer 1) · approles (RBAC) · authenticate
  mcp/        server (JSON-RPC) · tools · transport-stdio · transport-http
  deploy/     Dockerfile · docker-compose.yml · azure-container-app.bicep
  test/       36 tests — matrix, resolver, authz, approles, audit, mcp, http
```

**Confidential — Lamar University pilot.** Architecture package v1.0.
