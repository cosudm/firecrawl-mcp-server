# compliance-postgres-mcp

A thin, **write-scoped** MCP server over the `compliance_*` tables from
[`../schema.sql`](../schema.sql). It replaces the read-only reference
`@modelcontextprotocol/server-postgres` so the run-check / discovery loops can
persist results — without giving the model free-form SQL. Every tool is a fixed,
parameterized statement scoped to an `operator_id`.

## Run

```bash
npm install
DATABASE_URL="postgresql://user:pass@host:5432/db" OPERATOR_ID=op1 node server.mjs
```

| Env | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string. Use a role granted only `SELECT/INSERT/UPDATE` on `compliance_*`. |
| `OPERATOR_ID` | no | Default tenant id when a tool call omits `operator_id`. |

## Tools

**Reads**
- `get_obligation` — one obligation by `id`, or by `governing_agency` + `cfr_citation`.
- `list_monitored_obligations` — obligations with a `regulatory_url`; filter `has_monitor` to provision (false) or reconcile (true).
- `list_source_urls` — distinct tracked URLs (Loop 2 seeds).
- `url_exists` — is a URL already tracked? (Loop 2 dedupe.)

**Writes** (parameterized, `compliance_*` only)
- `set_monitor_id` — attach a `firecrawl_monitor_id` to an obligation.
- `record_scan` — append a `compliance_scan_history` audit row.
- `mark_changed` — status → `Pending Review`, refresh snapshot/hash, bump `last_scraped_at`.
- `mark_verified` — status → `Current`, stamp `last_verified_at`.
- `insert_discovery` — add to the discovery inbox; idempotent on `(operator_id, discovered_url)`.

See [`../README.md`](../README.md) for how the orchestration loops call these.
