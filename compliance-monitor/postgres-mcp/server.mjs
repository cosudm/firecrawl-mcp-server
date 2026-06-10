#!/usr/bin/env node
// @ts-check
/**
 * compliance-postgres-mcp — a thin, WRITE-SCOPED MCP server over the compliance_*
 * tables created by ../schema.sql.
 *
 * Why this exists: the reference `@modelcontextprotocol/server-postgres` is
 * read-only (so the run-check write-back can't run) and, more importantly, giving
 * an LLM free-form SQL write access is a footgun. This server exposes only a
 * handful of PARAMETERIZED tools — every write is a fixed statement with bound
 * values, scoped to an operator_id, touching only the compliance_* tables.
 *
 * Config (env):
 *   DATABASE_URL   postgres connection string (required)
 *   OPERATOR_ID    default tenant id used when a tool call omits operator_id
 *
 * Run:  DATABASE_URL=postgres://... OPERATOR_ID=op1 node server.mjs
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('compliance-postgres-mcp: DATABASE_URL is required');
  process.exit(1);
}
const DEFAULT_OPERATOR = process.env.OPERATOR_ID;

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

/** Resolve operator: explicit arg wins, else env default, else error. */
function operator(arg) {
  const op = arg ?? DEFAULT_OPERATOR;
  if (!op) throw new Error('operator_id is required (pass it, or set OPERATOR_ID)');
  return op;
}
/** Wrap a row/array result as MCP text content. */
function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data ?? null, null, 2) }] };
}

// Shared enum vocab — mirrors the CHECK constraints in schema.sql.
const RISK_TIER = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
const FIRECRAWL_TOOL = z.enum(['firecrawl_scrape', 'firecrawl_map', 'firecrawl_crawl', 'firecrawl_monitor_check']);
const SCAN_KIND = z.enum(['run_check', 'discovery']);

const server = new McpServer({ name: 'compliance-postgres-mcp', version: '0.1.0' });

// ---------------------------------------------------------------- reads -----
server.tool(
  'get_obligation',
  'Fetch one compliance obligation by id, or by (governing_agency + cfr_citation). Returns its URL, firecrawl_monitor_id, snapshot/hash, and status.',
  {
    operator_id: z.string().optional(),
    id: z.string().uuid().optional(),
    governing_agency: z.string().optional(),
    cfr_citation: z.string().optional(),
  },
  async (a) => {
    const op = operator(a.operator_id);
    let q, params;
    if (a.id) {
      q = `SELECT * FROM compliance_obligations WHERE operator_id = $1 AND id = $2`;
      params = [op, a.id];
    } else if (a.governing_agency && a.cfr_citation) {
      q = `SELECT * FROM compliance_obligations
           WHERE operator_id = $1 AND governing_agency = $2 AND cfr_citation = $3`;
      params = [op, a.governing_agency, a.cfr_citation];
    } else {
      throw new Error('provide id, or both governing_agency and cfr_citation');
    }
    const { rows } = await pool.query(q, params);
    return ok(rows[0] ?? null);
  }
);

server.tool(
  'list_monitored_obligations',
  'List obligations that have a regulatory_url. Optionally only those with (or without) a firecrawl_monitor_id, for provisioning monitors or reconciling checks.',
  {
    operator_id: z.string().optional(),
    has_monitor: z.boolean().optional(),
    limit: z.number().int().positive().max(500).optional(),
  },
  async (a) => {
    const op = operator(a.operator_id);
    const clauses = ['operator_id = $1', 'regulatory_url IS NOT NULL'];
    if (a.has_monitor === true) clauses.push('firecrawl_monitor_id IS NOT NULL');
    if (a.has_monitor === false) clauses.push('firecrawl_monitor_id IS NULL');
    const q = `SELECT id, governing_agency, cfr_citation, regulatory_url, css_selector,
                      firecrawl_monitor_id, compliance_status, last_verified_at
               FROM compliance_obligations
               WHERE ${clauses.join(' AND ')}
               ORDER BY last_verified_at NULLS FIRST
               LIMIT $2`;
    const { rows } = await pool.query(q, [op, a.limit ?? 200]);
    return ok(rows);
  }
);

server.tool(
  'list_source_urls',
  'Return the distinct regulatory_url values for the operator (seed domains for Loop 2 discovery).',
  { operator_id: z.string().optional() },
  async (a) => {
    const op = operator(a.operator_id);
    const { rows } = await pool.query(
      `SELECT DISTINCT regulatory_url FROM compliance_obligations
       WHERE operator_id = $1 AND regulatory_url IS NOT NULL`,
      [op]
    );
    return ok(rows.map((r) => r.regulatory_url));
  }
);

server.tool(
  'url_exists',
  'True if a URL is already tracked (in compliance_obligations.regulatory_url or compliance_discovered_reports.discovered_url). Use to dedupe Loop 2 discoveries.',
  { operator_id: z.string().optional(), url: z.string() },
  async (a) => {
    const op = operator(a.operator_id);
    const { rows } = await pool.query(
      `SELECT
         EXISTS(SELECT 1 FROM compliance_obligations
                WHERE operator_id = $1 AND regulatory_url = $2)
         OR EXISTS(SELECT 1 FROM compliance_discovered_reports
                   WHERE operator_id = $1 AND discovered_url = $2) AS exists`,
      [op, a.url]
    );
    return ok({ url: a.url, exists: rows[0].exists });
  }
);

// --------------------------------------------------------------- writes -----
server.tool(
  'set_monitor_id',
  'Attach a Firecrawl monitor id to an obligation (after firecrawl_monitor_create).',
  { operator_id: z.string().optional(), obligation_id: z.string().uuid(), firecrawl_monitor_id: z.string() },
  async (a) => {
    const op = operator(a.operator_id);
    const { rowCount } = await pool.query(
      `UPDATE compliance_obligations
       SET firecrawl_monitor_id = $3
       WHERE operator_id = $1 AND id = $2`,
      [op, a.obligation_id, a.firecrawl_monitor_id]
    );
    return ok({ updated: rowCount });
  }
);

server.tool(
  'record_scan',
  'Append a row to compliance_scan_history (the audit trail for a run-check or discovery pass).',
  {
    operator_id: z.string().optional(),
    obligation_id: z.string().uuid().optional(),
    scan_kind: SCAN_KIND.default('run_check'),
    source_url: z.string(),
    previous_hash: z.string().optional(),
    new_hash: z.string().optional(),
    changed: z.boolean(),
    diff_summary: z.string().optional(),
    markdown_snapshot: z.string().optional(),
    firecrawl_tool: FIRECRAWL_TOOL.optional(),
  },
  async (a) => {
    const op = operator(a.operator_id);
    const { rows } = await pool.query(
      `INSERT INTO compliance_scan_history
         (operator_id, obligation_id, scan_kind, source_url, previous_hash,
          new_hash, changed, diff_summary, markdown_snapshot, firecrawl_tool)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, scraped_at`,
      [op, a.obligation_id ?? null, a.scan_kind, a.source_url, a.previous_hash ?? null,
       a.new_hash ?? null, a.changed, a.diff_summary ?? null, a.markdown_snapshot ?? null,
       a.firecrawl_tool ?? null]
    );
    return ok(rows[0]);
  }
);

server.tool(
  'mark_changed',
  "A change was detected: set compliance_status='Pending Review', refresh the snapshot/hash, and bump last_scraped_at.",
  {
    operator_id: z.string().optional(),
    obligation_id: z.string().uuid(),
    new_hash: z.string().optional(),
    new_snapshot: z.string().optional(),
  },
  async (a) => {
    const op = operator(a.operator_id);
    const { rowCount } = await pool.query(
      `UPDATE compliance_obligations
       SET compliance_status = 'Pending Review',
           current_version_hash = COALESCE($3, current_version_hash),
           raw_markdown_snapshot = COALESCE($4, raw_markdown_snapshot),
           last_scraped_at = now()
       WHERE operator_id = $1 AND id = $2`,
      [op, a.obligation_id, a.new_hash ?? null, a.new_snapshot ?? null]
    );
    return ok({ updated: rowCount });
  }
);

server.tool(
  'mark_verified',
  "No change this run: set compliance_status='Current' and stamp last_verified_at / last_scraped_at = now().",
  { operator_id: z.string().optional(), obligation_id: z.string().uuid() },
  async (a) => {
    const op = operator(a.operator_id);
    const { rowCount } = await pool.query(
      `UPDATE compliance_obligations
       SET compliance_status = 'Current', last_verified_at = now(), last_scraped_at = now()
       WHERE operator_id = $1 AND id = $2`,
      [op, a.obligation_id]
    );
    return ok({ updated: rowCount });
  }
);

server.tool(
  'insert_discovery',
  'Add a newly discovered report URL to the discovery inbox (Loop 2). Idempotent on (operator_id, discovered_url).',
  {
    operator_id: z.string().optional(),
    root_domain: z.string(),
    discovered_url: z.string(),
    matched_terms: z.array(z.string()).optional(),
    risk_tier: RISK_TIER.optional(),
    jurisdiction_level: z.string().optional(),
    suggested_sheet: z.string().optional(),
    summary: z.string().optional(),
  },
  async (a) => {
    const op = operator(a.operator_id);
    const { rows } = await pool.query(
      `INSERT INTO compliance_discovered_reports
         (operator_id, root_domain, discovered_url, matched_terms, risk_tier,
          jurisdiction_level, suggested_sheet, summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (operator_id, discovered_url) DO NOTHING
       RETURNING id, status, discovered_at`,
      [op, a.root_domain, a.discovered_url, a.matched_terms ?? null, a.risk_tier ?? null,
       a.jurisdiction_level ?? null, a.suggested_sheet ?? null, a.summary ?? null]
    );
    return ok(rows[0] ?? { inserted: false, reason: 'already tracked' });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('compliance-postgres-mcp ready (stdio)');
