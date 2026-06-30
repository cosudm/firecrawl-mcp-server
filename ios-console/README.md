# Reporter IOS+ — Management Console (MVP)

The operator surface for the SMEPro / Reporter IOS+ stack. One console to run the
whole compliance-and-title operation:

- **Dashboard** — live counts and recent activity across every subsystem.
- **Compliance Matrix** — the Universal Compliance Decoding Matrix as a filterable
  table; drill into an obligation, run a check, accept a flagged change.
- **Discovery Inbox** — new report URLs surfaced by Firecrawl `map`; promote into the
  matrix or reject.
- **DOI Decks** — Division-of-Interest decks **computed by the real title engine**
  (`smepro-doi`), with the hard balance gate and curative resolution before approval.
- **Monitors** — Firecrawl monitor status; pause/resume.

The UI is a faithful **Xcode-style three-pane console** — navigator (left) · editor
with segmented tabs (center) · inspector (right) — driven by the live data.

## View it — two ways

### A. Zero install (just open a file) ✅

```bash
cd ios-console
npm run build        # writes dist/ios-console.html
```

Double-click **`dist/ios-console.html`** (or drag it into a browser tab). It is a
single self-contained file — no server, no Node, no network. It runs the *same*
store + REST logic in the browser against a seed snapshot baked in at build time
(including the real engine-computed DOI deck). This is the easiest way to see it.

### B. Dev server (live API)

No database, no build step, no dependencies — just Node ≥ 22:

```bash
npm start            # → http://localhost:8090   (PORT=9000 to change)
```

It boots seeded with realistic data (energy-sector obligations from the matrix, two
discovered reports, five monitors, and the Benton/Morales DOI deck). Mutations are
snapshotted to `./.data/state.json` so they survive restarts; the **Reset** button
(or `POST /api/admin/reset`) restores the seed. Set `IOS_NO_PERSIST=1` to run fully
in-memory.

## Test

```bash
npm test             # node --test — 10 API + engine tests
```

The DOI test asserts the deck the console serves closes to exactly
`1.000000000000` — proof the numbers are engine-computed, not mocked.

## Architecture

```
public/            SPA (vanilla JS, no framework/build)
  index.html · styles.css · app.js
server.mjs         node:http — static + JSON API, no deps
lib/
  api.mjs          pure (Store) → (method,path,query,body) handler — unit-testable
  store.mjs        in-memory store + JSON-file snapshot; swappable for Postgres
  seed.mjs         seed data; DOI deck via ../smepro-doi engine + serializeDeck
test/api.test.mjs  node:test suite
```

**Why these choices**

- **Reuses the engine, doesn't reimplement it.** Decks come from
  `analyzeTitleProject()` and `serializeDeck()` in `smepro-doi/` — the same
  deterministic, audited math, so the console can never show a decimal the engine
  wouldn't. Approval is blocked unless `balances === true` and no `critical` curative
  item is open.
- **Maps onto the real schema.** The store's entities mirror the
  `compliance-monitor/schema.sql` tables (`compliance_obligations`,
  `compliance_scan_history`, `compliance_discovered_reports`) and the
  `smepro-doi/integration/schema.sql` deck tables — so the in-memory store can be
  replaced with the write-scoped Postgres MCP / Postgres directly behind the same
  `lib/store.mjs` method surface, with no UI changes.
- **Run-checks and discovery mirror the orchestration loops.** "Run-check" performs
  the same write-back as compliance-monitor Loop 1 (changed → `Pending Review` + scan
  row; unchanged → `Current` + `last_verified_at`); "promote" is the Loop 2 hand-off.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | liveness |
| GET | `/api/dashboard` | aggregate stats + activity feed |
| GET | `/api/obligations?status=&sheet=&q=` | list / filter the matrix |
| GET | `/api/obligations/:id` | detail + scan history + monitor |
| POST | `/api/obligations/:id/run-check` | `{changed, diffSummary}` → write-back |
| POST | `/api/obligations/:id/accept` | Pending Review → Current |
| GET | `/api/discoveries?status=` | discovery inbox |
| POST | `/api/discoveries/:id/promote` | create an (unmonitored) obligation |
| POST | `/api/discoveries/:id/reject` | reject |
| GET | `/api/projects` · `/api/projects/:id` | DOI decks (list / detail) |
| POST | `/api/projects/:id/approve` | balance-gated approval (409 if unbalanced) |
| POST | `/api/projects/:id/curative/:cid` | `{status}` resolve a curative item |
| GET | `/api/monitors` · POST `/api/monitors/:id/toggle` | monitor status |
| POST | `/api/admin/reset` | restore seed data |

## Going to production

Swap `lib/store.mjs` for a Postgres-backed implementation (same methods): obligations,
scans, and discoveries read/write the `compliance_*` tables via the write-scoped
[`compliance-monitor/postgres-mcp`](../compliance-monitor/postgres-mcp) tools or
direct SQL; DOI decks persist to `title_projects` / `doi_decks` / `doi_curative`. Put
the console behind your existing IOS+ auth and scope every query by `operator_id`
(already threaded through the store).
