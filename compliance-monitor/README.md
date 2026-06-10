# Compliance Monitor — Firecrawl + PostgreSQL + Claude

Automate run-checks against live regulatory portals. Claude acts as the
**orchestration layer** between two MCP servers:

- **[Firecrawl MCP](../README.md)** — runs **monitors** (recurring scrapes that diff
  each result server-side) and maps/scrapes agency portals into clean markdown.
- **Compliance Postgres MCP** ([`postgres-mcp/`](./postgres-mcp)) — a write-scoped
  server exposing parameterized tools over your
  [Universal Compliance Decoding Matrix](./schema.sql).

You don't write integration code. You connect both servers once and provision a
Firecrawl monitor per source URL; then a macro-instruction prompt has Claude drain
monitor results into Postgres and classify newly discovered reports.

```
┌─────────────────┐    1. List obligations & monitor ids   ┌──────────────────────┐
│                 │ ─────────────────────────────────────> │                      │
│                 │ <───────────────────────────────────── │  Compliance Postgres │
│                 │       4. Write back (parameterized)     │  MCP  →  Matrix DB    │
│   Claude Agent  │ ─────────────────────────────────────> │                      │
│ (Orchestration  │ <───────────────────────────────────── │                      │
│     Layer)      │          Confirm success               └──────────────────────┘
└─────────────────┘
        │  ▲
        │  │ 2. Read monitor checks (page status + diff)
        ▼  │ 3. Server-side diff already computed
┌──────────────────────────────────────────────────┐
│               Firecrawl MCP Server                │
│   (Monitors / maps regulatory agency portals)     │
└──────────────────────────────────────────────────┘
```

---

## Step 1 — Connect Claude to both servers

Register **both** Firecrawl and a PostgreSQL MCP server inside your Claude
environment so they can pass data to each other.

The Postgres side uses [`postgres-mcp/`](./postgres-mcp) — a **thin, write-scoped
MCP server** shipped in this folder. The reference `@modelcontextprotocol/server-postgres`
is **read-only** (the write-back loops below can't run on it) and handing an LLM
free-form SQL write access is a footgun. `postgres-mcp` instead exposes a fixed set
of parameterized tools (`get_obligation`, `record_scan`, `mark_changed`,
`mark_verified`, `insert_discovery`, …) that touch only the `compliance_*` tables.

```bash
cd postgres-mcp && npm install     # one-time
```

### Claude Code (CLI)

```bash
# Firecrawl — grab a key at https://www.firecrawl.dev/app/api-keys
claude mcp add firecrawl -e FIRECRAWL_API_KEY=your_key -- npx -y firecrawl-mcp

# Compliance Postgres (write-scoped) — point DATABASE_URL at your DB
claude mcp add compliance-db \
  -e DATABASE_URL="postgresql://user:pass@localhost:5432/your_compliance_db" \
  -e OPERATOR_ID=op1 \
  -- node "$(pwd)/postgres-mcp/server.mjs"
```

Verify both are connected with `claude mcp list`.

### Claude Desktop App

Configure both endpoints in `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`),
then restart Claude (use an absolute path to `server.mjs`):

```json
{
  "mcpServers": {
    "firecrawl": {
      "command": "npx",
      "args": ["-y", "firecrawl-mcp"],
      "env": { "FIRECRAWL_API_KEY": "your_api_key_here" }
    },
    "compliance-db": {
      "command": "node",
      "args": ["/abs/path/to/compliance-monitor/postgres-mcp/server.mjs"],
      "env": {
        "DATABASE_URL": "postgresql://username:password@localhost:5432/your_compliance_db",
        "OPERATOR_ID": "op1"
      }
    }
  }
}
```

> **Defense in depth.** Still point `DATABASE_URL` at a database role granted only
> `SELECT/INSERT/UPDATE` on the `compliance_*` tables, and keep a human review step
> before promoting discovered reports. The server narrows *what* SQL can run; the DB
> grant narrows *what it can run against*.

### Step 1a — Create the schema

Apply [`schema.sql`](./schema.sql) once to your database. It creates the matrix
(`compliance_obligations`), an append-only scan log (`compliance_scan_history`),
a discovery inbox (`compliance_discovered_reports`), and an agency registry:

```bash
psql "postgresql://user:pass@localhost:5432/your_compliance_db" -f schema.sql
```

The columns that make the loops run seamlessly are already in place:

| Column | Type | Role in automation |
| --- | --- | --- |
| `regulatory_url` | `text` | Target page Firecrawl watches for this rule. |
| `css_selector` | `text` | Optional container to parse, to strip sidebar/nav noise. |
| `firecrawl_monitor_id` | `text` | The Firecrawl monitor watching this URL (set once, in provisioning). |
| `current_version_hash` | `text` | SHA-256 of the last accepted markdown (audit; Firecrawl also retains snapshots). |
| `raw_markdown_snapshot` | `text` | Last accepted markdown body (audit baseline). |
| `last_verified_at` | `timestamptz` | Set whenever a check comes back unchanged. |
| `compliance_status` | `text` | State machine: `Current → Pending Review → …`. |

---

## Step 2 — Provision monitors (once per source)

Detection runs on **Firecrawl's native monitors** — a monitor recurringly scrapes a
URL and diffs each result against the last retained snapshot *server-side*, so you
don't pay to re-scrape on every poll and you don't need a client-side hash/diff.
Provision one monitor per obligation URL, then store its id back on the row:

> Use the `compliance-db` tool `list_monitored_obligations` with `has_monitor: false`
> to get obligations that have a `regulatory_url` but no monitor yet. For each one,
> call `firecrawl_monitor_create` with `page` = its `regulatory_url` and a `goal`
> derived from `regulation_name` + `report_form_name` (e.g. *"Alert when the rule
> text, filing form, deadlines, or penalty amounts change; ignore unrelated page
> chrome."*), and a `scheduleText` matching the rule's cadence (e.g. `weekly`). Take
> the monitor `id` from the response and call `set_monitor_id` with the
> `obligation_id` and that `firecrawl_monitor_id`.

## Step 3 — The orchestration loops

The Firecrawl tool names below (`firecrawl_monitor_*`, `firecrawl_map`) are real
tools from this server; `compliance-db` is the write-scoped Postgres MCP.

### Loop 1 — Run-checks (reconcile monitor results → Postgres)

> 1. With `compliance-db` `list_monitored_obligations` (`has_monitor: true`), get the
>    obligations and their `firecrawl_monitor_id`s.
> 2. For each, call `firecrawl_monitor_checks` (then `firecrawl_monitor_check` for
>    the latest completed check) to read the page result. *(To force a check outside
>    schedule, use `firecrawl_monitor_run` first.)*
> 3. If the check's page `status` is `changed`: summarize the `diff`, then call
>    `mark_changed` (obligation_id, the new snapshot) and `record_scan`
>    (`changed: true`, `firecrawl_tool: 'firecrawl_monitor_check'`, the diff summary).
>    This flips `compliance_status` to `Pending Review`.
> 4. If the page `status` is `same`: call `mark_verified` (obligation_id) — stamps
>    `last_verified_at` and sets status back to `Current` — and `record_scan`
>    (`changed: false`).

No scheduling logic lives in the prompt: the monitor decides cadence; Loop 1 just
drains results into Postgres. (Even better: point each monitor's `webhookUrl` at an
endpoint that calls these same `compliance-db` tools, and the reconcile becomes
event-driven.)

### Loop 2 — Discovery (find new report versions)

> 1. Use `compliance-db` `list_source_urls` to get the tracked URLs; derive their
>    root domains.
> 2. For each domain, use `firecrawl_map` with a `search` term to find newly
>    generated paths containing '2026', 'draft', or 'final-rule'.
> 3. For each candidate URL, call `compliance-db` `url_exists`; skip the ones already
>    tracked. For the rest, read the contents with `firecrawl_scrape`.
> 4. Classify the report's `risk_tier` and `jurisdiction_level` against the matrix
>    taxonomy, then call `insert_discovery` (root_domain, discovered_url, matched
>    terms, classification, a short summary). It's idempotent on the URL.

Discovered rows stay in the inbox until a human reviews them; promoting one copies
it into `compliance_obligations` (and you provision a monitor for it via Step 2).

---

## Taxonomy reference

The matrix uses a fixed vocabulary the prompts and schema `CHECK` constraints rely
on. Keep classifications inside these sets:

- **`risk_tier`** — `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`
- **`jurisdiction_level`** — `Federal`, `State`, `State – TX`/`State – CA`/…, `Intl`
- **`compliance_status`** — `Current`, `Pending Review`, `Changed`, `Error`, `Unmonitored`
- **`policy_action`** (YBR gate outcome) — `BLOCK`, `REVIEW`, `WARN`, `ALLOW`
- **classification crosswalk** (`crosswalk` jsonb) — `cip`, `sic`, `naics`, `soc`, `isic`, `hs_hts`

See [`schema.sql`](./schema.sql) for the full column list and how it maps to the
30-column source spreadsheet.

---

## Why monitors instead of asking Claude "did it change?"

Detection is **deterministic and server-side**: a Firecrawl monitor computes the
diff and stamps each page `same` / `changed` / `new` itself, so the change signal
isn't the model's judgment and you don't re-scrape (or re-tokenize) an unchanged
200-page rule on every poll. Claude is reserved for what it's good at —
*summarizing* a confirmed diff and *classifying* newly discovered reports — and the
write path is constrained to the `compliance-db` tools, so every change is recorded,
parameterized, and auditable via `compliance_scan_history`. The
`raw_markdown_snapshot` / `current_version_hash` columns are kept as a local audit
baseline alongside the monitor's own retained snapshots.
