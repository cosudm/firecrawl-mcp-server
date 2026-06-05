-- SMEPro DOI Builder — Postgres schema for Reporter IOS+ integration.
-- Every table is operator-scoped to preserve the existing multi-tenant isolation.
-- The engine output (deck rows, curative) is stored as computed; the TitleProject
-- JSON is the source of truth and can be re-analyzed deterministically at any time.

CREATE TABLE IF NOT EXISTS title_projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   text NOT NULL,                      -- tenant key (matches your auth context)
  name          text NOT NULL,
  tract         jsonb NOT NULL,                      -- { name, grossAcres, legal, county, state }
  unit_id       text,                                -- optional link to a Reporter unit/well
  project       jsonb NOT NULL,                      -- the full TitleProject (engine input)
  balances      boolean,                             -- last computed deck == 1.00000000
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_title_projects_operator ON title_projects(operator_id);
CREATE INDEX IF NOT EXISTS idx_title_projects_unit     ON title_projects(operator_id, unit_id);

-- Uploaded source documents (PDF/text). Bytes live in your private GCS bucket;
-- we keep only the object path + extraction provenance here.
CREATE TABLE IF NOT EXISTS title_source_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   text NOT NULL,
  project_id    uuid REFERENCES title_projects(id) ON DELETE CASCADE,
  filename      text NOT NULL,
  gcs_object    text NOT NULL,                       -- private object path; serve via 15-min signed URL
  media_type    text,
  extraction    jsonb,                               -- ExtractionResult (fields + snippets + confidence)
  engine        text,                                -- 'claude' | 'heuristic'
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_title_files_project ON title_source_files(project_id);

-- A computed Division of Interest deck (a snapshot). Re-derivable from project.
CREATE TABLE IF NOT EXISTS doi_decks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   text NOT NULL,
  project_id    uuid NOT NULL REFERENCES title_projects(id) ON DELETE CASCADE,
  basis         text NOT NULL DEFAULT 'tract',       -- 'tract' | 'unit'
  unit_factor   numeric(18,12),                      -- e.g. 0.125000000000 for 40/320
  rows          jsonb NOT NULL,                      -- [{ owner, type, fractionLabel, nri, unitNri, source }]
  total_nri     numeric(18,12) NOT NULL,             -- must equal 1.000000000000 (tract basis)
  balances      boolean NOT NULL,
  approved_by   text,                                -- set on landman sign-off
  approved_at   timestamptz,
  ledger_hash   text,                                -- SHA-256 committed to your append-only audit ledger
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doi_decks_project ON doi_decks(project_id);

-- Curative items / title defects flagged by the engine for human resolution.
CREATE TABLE IF NOT EXISTS doi_curative (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   text NOT NULL,
  project_id    uuid NOT NULL REFERENCES title_projects(id) ON DELETE CASCADE,
  code          text NOT NULL,                       -- e.g. NPRI_INTERPRETATION, WI_NRI_MISMATCH
  severity      text NOT NULL,                       -- critical | high | medium | info
  title         text NOT NULL,
  detail        text NOT NULL,
  status        text NOT NULL DEFAULT 'open',        -- open | resolved | waived
  resolved_by   text,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doi_curative_project ON doi_curative(project_id, status);

-- If you use Postgres Row-Level Security, enable per-tenant policies, e.g.:
--   ALTER TABLE title_projects ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON title_projects
--     USING (operator_id = current_setting('app.operator_id', true));
-- (repeat for each table; set app.operator_id from the authenticated context per request.)
