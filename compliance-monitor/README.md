# Compliance Monitor — Firecrawl + PostgreSQL + Claude

Automate run-checks against live regulatory portals. Claude acts as the
**orchestration layer** between two MCP servers:

- **[Firecrawl MCP](../README.md)** — crawls, maps, and scrapes agency / compliance
  portals into clean, LLM-ready markdown.
- **PostgreSQL MCP** — reads and writes the rows of your
  [Universal Compliance Decoding Matrix](./schema.sql).

You don't write integration code. You connect both servers once, then feed Claude
a macro-instruction prompt; Claude pulls a rule's source URL from Postgres, scrapes
it with Firecrawl, diffs it against the stored baseline, and writes any changes back.

```
┌─────────────────┐      1. Fetch rule metadata       ┌──────────────────────┐
│                 │ ────────────────────────────────> │                      │
│                 │ <──────────────────────────────── │                      │
│                 │       Returns URL & baseline      │                      │
│   Claude Agent  │                                   │  PostgreSQL Database │
│ (Orchestration  │       4. Write back changes       │  (Compliance Matrix) │
│     Layer)      │ ────────────────────────────────> │                      │
│                 │ <──────────────────────────────── │                      │
│                 │          Confirm success          └──────────────────────┘
└─────────────────┘
        │  ▲
        │  │ 2. Trigger targeted scrape / map
        ▼  │ 3. Return clean LLM-ready markdown
┌──────────────────────────────────────────────────┐
│               Firecrawl MCP Server                │
│     (Scrapes / maps regulatory agency portals)    │
└──────────────────────────────────────────────────┘
```

---

## Step 1 — Connect Claude to both servers

Register **both** Firecrawl and a PostgreSQL MCP server inside your Claude
environment so they can pass data to each other.

### Claude Code (CLI)

```bash
# Firecrawl — grab a key at https://www.firecrawl.dev/app/api-keys
claude mcp add firecrawl -e FIRECRAWL_API_KEY=your_key -- npx -y firecrawl-mcp

# PostgreSQL — replace with your actual connection URI
claude mcp add postgres -- \
  npx -y @modelcontextprotocol/server-postgres \
  "postgresql://user:pass@localhost:5432/your_compliance_db"
```

Verify both are connected with `claude mcp list`.

### Claude Desktop App

Configure both endpoints in `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`),
then restart Claude:

```json
{
  "mcpServers": {
    "firecrawl": {
      "command": "npx",
      "args": ["-y", "firecrawl-mcp"],
      "env": { "FIRECRAWL_API_KEY": "your_api_key_here" }
    },
    "postgres": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "postgresql://username:password@localhost:5432/your_compliance_db"
      ]
    }
  }
}
```

> **Security note.** The reference `@modelcontextprotocol/server-postgres` connects
> read-only by default. For the write-back loops below, point it at a database role
> scoped to **only** the `compliance_*` tables (or a dedicated schema), and prefer a
> non-production replica plus a review step before applying `UPDATE`/`INSERT`.

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
| `regulatory_url` | `text` | Target page Firecrawl scrapes for this rule. |
| `css_selector` | `text` | Optional container to parse, to strip sidebar/nav noise. |
| `current_version_hash` | `text` | SHA-256 of the last accepted markdown — the diff anchor. |
| `raw_markdown_snapshot` | `text` | Stored clean markdown baseline to diff against. |
| `last_verified_at` | `timestamptz` | Set whenever a run-check passes with no change. |
| `compliance_status` | `text` | State machine: `Current → Pending Review → …`. |

---

## Step 2 — The orchestration loops

Once both servers are connected, drive Claude with a macro-instruction prompt.
The tool names below (`firecrawl_scrape`, `firecrawl_map`) are the real Firecrawl
MCP tools; the `postgres` tool is whatever you named the PostgreSQL server.

### Loop 1 — Run-checks (detect modified reports)

> 1. Query the `postgres` database to pull the row from `compliance_obligations`
>    where `governing_agency` = 'EPA' and `cfr_citation` = '40 CFR Part 112'.
> 2. Read its `regulatory_url`, `css_selector`, `current_version_hash`, and
>    `raw_markdown_snapshot`.
> 3. Use `firecrawl_scrape` on `regulatory_url` (passing the `css_selector` as the
>    scrape's include selector if present) to grab fresh markdown.
> 4. Compare the fresh markdown against `raw_markdown_snapshot`. If they differ,
>    summarize what changed, then via the `postgres` tool run an `UPDATE` that sets
>    `raw_markdown_snapshot` and `current_version_hash` to the new values,
>    `compliance_status = 'Pending Review'`, and `last_scraped_at = now()`; and
>    insert a `compliance_scan_history` row with `changed = true` and the diff
>    summary. If they match, set `last_verified_at = now()` and
>    `compliance_status = 'Current'`, and log a `changed = false` scan row.

Batch it by dropping the `WHERE` filter — e.g. *"do this for every row where
`regulatory_url IS NOT NULL` and `last_verified_at` is older than 7 days"* (the
`idx_oblig_monitorable` index makes that sweep cheap).

### Loop 2 — Discovery (find new report versions)

> 1. Use the `postgres` tool to read all unique root domains from
>    `compliance_obligations.regulatory_url` (or `compliance_agencies.homepage_url`).
> 2. For each domain, use `firecrawl_map` with a `search` term to find newly
>    generated paths containing '2026', 'draft', or 'final-rule'.
> 3. For any URL not already present in `compliance_obligations.regulatory_url`
>    **or** `compliance_discovered_reports.discovered_url`, read its contents with
>    `firecrawl_scrape`.
> 4. Classify the report's `risk_tier` and `jurisdiction_level` against the matrix
>    taxonomy, then `INSERT` a `compliance_discovered_reports` row (status `'new'`)
>    with the URL, matched terms, classification, and a short summary.

Discovered rows stay in the inbox until a human reviews them; promoting one copies
it into `compliance_obligations` and back-links via `promoted_obligation_id`.

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

## Why hash + snapshot instead of asking Claude "did it change?"

Storing `current_version_hash` (and the `raw_markdown_snapshot` it's derived from)
makes a run-check **deterministic**: the change signal is a byte-for-byte hash
mismatch, not the model's judgment. Claude is then used for the part it's good at —
*summarizing* what changed and *classifying* new reports — while the
detect/skip decision stays cheap, repeatable, and auditable via
`compliance_scan_history`.
