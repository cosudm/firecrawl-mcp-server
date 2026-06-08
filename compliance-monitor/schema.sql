-- SMEPro COS+ — PostgreSQL schema for the Firecrawl + Claude compliance monitor.
--
-- Models the "Universal Compliance Decoding Matrix" (30-column structure across
-- 19 industry verticals + cross-cutting regs) as a queryable Postgres matrix,
-- augmented with the columns Claude needs to run automated run-checks against
-- live regulatory portals via the Firecrawl MCP server and write changes back.
--
-- Conventions match the existing smepro-doi integration schema:
--   * operator-scoped (multi-tenant) on every mutable table
--   * uuid PKs via gen_random_uuid()  (requires pgcrypto: CREATE EXTENSION IF NOT EXISTS pgcrypto;)
--   * jsonb for structured sub-records, timestamptz for time, RLS policy stubs at the bottom
--
-- The orchestration loops that read/write these tables are documented in README.md.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Reference: U.S. agency registry (matrix "AGENCY REGISTRY" sheet).
-- Not operator-scoped — shared lookup data keyed by short agency code.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compliance_agencies (
  code            text PRIMARY KEY,                    -- 'EPA', 'BSEE', 'FERC', ...
  full_name       text NOT NULL,
  parent          text,                                -- parent department code, if a sub-agency
  agency_type     text,                                -- 'Cabinet' | 'Independent' | 'Sub-Agency' | 'State'
  jurisdiction    text,                                -- 'Federal' | 'Fed/Intl' | 'State' | 'State – TX' ...
  cfr_titles      text,                                -- e.g. '40 CFR', '30 CFR'
  naics_sectors   text,                                -- affected NAICS sectors, as written
  cos_sheets      text,                                -- COS+ sheet(s) this agency feeds, e.g. '01, 05'
  homepage_url    text,                                -- root domain for Firecrawl map/discovery
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- The matrix itself: one row per compliance obligation (a report/filing rule).
-- Mirrors the 30-column sheet layout; monitoring fields are appended at the end
-- so Claude can run-check the live source and persist a baseline for diffing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compliance_obligations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         text NOT NULL,                   -- tenant key (matches your auth context)

  -- Classification (matrix cols 1-3, + crosswalk codes 14-19)
  sheet_code          text NOT NULL,                   -- '01 – ENERGY', 'CROSS-CUTTING REGS', ...
  broad_industry      text NOT NULL,                   -- 'ENERGY'
  industry_subtype    text,                            -- 'Oil & Gas – Drilling & Exploration'
  specific_activity   text,                            -- 'Offshore Drilling Plan Submission'
  crosswalk           jsonb NOT NULL DEFAULT '{}',     -- { cip, sic, naics, soc, isic, hs_hts }

  -- Regulatory authority (matrix cols 4-5)
  jurisdiction_level  text,                            -- 'Federal' | 'State' | 'State – TX' | 'Intl'
  governing_agency    text,                            -- 'BSEE / BOEM' (free text as written)
  agency_code         text REFERENCES compliance_agencies(code), -- optional normalized link

  -- Regulation & filing detail (matrix cols 6-11)
  regulation_name     text,                            -- 'Outer Continental Shelf Lands Act Regulations'
  cfr_citation        text,                            -- '40 CFR Part 112', '30 CFR 250'
  report_form_name    text,                            -- 'Application for Permit to Drill'
  form_code           text,                            -- 'APD (Form BSEE-0123)'
  filing_frequency    text,                            -- 'Per Well', 'Annual', 'Every 14–21 days'
  key_due_dates       text,                            -- 'March 31 (prior year data)'

  -- Obligations & consequences (matrix cols 12-13)
  business_segment    text,                            -- 'Operations / Production'
  penalties           text,                            -- 'Shut-in; civil penalty up to $40,000/day'

  -- COS+ engine fields (matrix cols 20-29)
  uco_node_id         text,                            -- 'UCO-ENR-1001'
  ontology_level      text,                            -- 'L2: Regulations & Rules'
  compliance_chain_ref text,                           -- 'CIP:15.0903 → NAICS:211130 → ...'
  operating_segment   text,                            -- 'Operations'
  responsible_role    text,                            -- 'Chief Operating Officer / VP Operations'
  enforcement_type    text,                            -- 'Civil Monetary Penalty'
  risk_weight         smallint CHECK (risk_weight BETWEEN 0 AND 10),
  risk_tier           text CHECK (risk_tier IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  ybr_gate            text,                            -- 'Gate 530: Compliance Check'
  policy_action       text CHECK (policy_action IN ('BLOCK','REVIEW','WARN','ALLOW')),
  notes               text,

  -- ----- Firecrawl monitoring fields (the run-check substrate) -----
  regulatory_url      text,                            -- target page Firecrawl scrapes for this rule
  css_selector        text,                            -- optional: container to parse (strips sidebar noise)
  current_version_hash text,                           -- SHA-256 of last accepted raw_markdown_snapshot
  raw_markdown_snapshot text,                          -- clean markdown baseline for text-diffing
  last_scraped_at     timestamptz,                     -- last time Firecrawl fetched the source
  last_verified_at    timestamptz,                     -- last run-check that passed with NO change
  compliance_status   text NOT NULL DEFAULT 'Current'  -- run-check state machine
                        CHECK (compliance_status IN ('Current','Pending Review','Changed','Error','Unmonitored')),
  source_last_updated date,                            -- matrix LAST_UPDATED (authoring date)

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oblig_operator      ON compliance_obligations(operator_id);
CREATE INDEX IF NOT EXISTS idx_oblig_sheet         ON compliance_obligations(operator_id, sheet_code);
CREATE INDEX IF NOT EXISTS idx_oblig_agency        ON compliance_obligations(operator_id, governing_agency);
CREATE INDEX IF NOT EXISTS idx_oblig_status        ON compliance_obligations(operator_id, compliance_status);
CREATE INDEX IF NOT EXISTS idx_oblig_cfr           ON compliance_obligations(cfr_citation);
-- Fast "what needs a run-check?" sweep: rows that have a URL and are stale/unverified.
CREATE INDEX IF NOT EXISTS idx_oblig_monitorable   ON compliance_obligations(operator_id, last_verified_at)
  WHERE regulatory_url IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Append-only scan log: one row per Firecrawl run-check (Loop 1) or discovery
-- pass (Loop 2). Gives Claude (and auditors) a historical diff trail.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compliance_scan_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         text NOT NULL,
  obligation_id       uuid REFERENCES compliance_obligations(id) ON DELETE CASCADE,
  scan_kind           text NOT NULL DEFAULT 'run_check'
                        CHECK (scan_kind IN ('run_check','discovery')),
  source_url          text NOT NULL,
  scraped_at          timestamptz NOT NULL DEFAULT now(),
  previous_hash       text,                            -- hash before this scan
  new_hash            text,                            -- hash of freshly scraped markdown
  changed             boolean NOT NULL DEFAULT false,  -- new_hash <> previous_hash
  diff_summary        text,                            -- Claude's summary of what changed / new rules
  markdown_snapshot   text,                            -- the fetched markdown body for this scan
  firecrawl_tool      text,                            -- 'firecrawl_scrape' | 'firecrawl_map' | 'firecrawl_crawl'
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_obligation ON compliance_scan_history(obligation_id, scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_changed    ON compliance_scan_history(operator_id, changed, scraped_at DESC);

-- ---------------------------------------------------------------------------
-- Discovery inbox: new report URLs Firecrawl map/crawl found that are NOT yet
-- in compliance_obligations (Loop 2). Claude classifies, a human reviews, then
-- a promoted row becomes a real obligation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compliance_discovered_reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         text NOT NULL,
  root_domain         text NOT NULL,                   -- the seed domain that was mapped
  discovered_url      text NOT NULL,                   -- the new path Firecrawl surfaced
  matched_terms       text[],                          -- e.g. {'2026','draft','final-rule'}
  -- Claude's first-pass classification against the matrix taxonomy:
  risk_tier           text CHECK (risk_tier IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  jurisdiction_level  text,
  suggested_sheet     text,                            -- which COS+ sheet it likely belongs to
  summary             text,                            -- short description from the scraped contents
  status              text NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new','reviewed','promoted','rejected')),
  promoted_obligation_id uuid REFERENCES compliance_obligations(id) ON DELETE SET NULL,
  discovered_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_by         text,
  reviewed_at         timestamptz,
  UNIQUE (operator_id, discovered_url)                 -- dedupe re-discoveries of the same path
);

CREATE INDEX IF NOT EXISTS idx_discovered_status ON compliance_discovered_reports(operator_id, status, discovered_at DESC);

-- ---------------------------------------------------------------------------
-- keep updated_at honest on the two mutable tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_oblig_updated ON compliance_obligations;
CREATE TRIGGER trg_oblig_updated BEFORE UPDATE ON compliance_obligations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_agency_updated ON compliance_agencies;
CREATE TRIGGER trg_agency_updated BEFORE UPDATE ON compliance_agencies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security (recommended for multi-tenant). Enable per-tenant policies,
-- and set app.operator_id from the authenticated context on every connection:
--   SET app.operator_id = '<tenant>';
-- ---------------------------------------------------------------------------
--   ALTER TABLE compliance_obligations         ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE compliance_scan_history        ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE compliance_discovered_reports  ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON compliance_obligations
--     USING (operator_id = current_setting('app.operator_id', true));
--   -- (repeat the policy for each operator-scoped table.)
