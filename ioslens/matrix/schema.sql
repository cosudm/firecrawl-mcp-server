-- =============================================================================
-- iOSLENS — Compliance Decoding Matrix + Audit store
-- PostgreSQL 15+ with the pgvector extension.
--
-- §04 of the architecture package: the Matrix is the deterministic rule
-- substrate. It holds regimes, obligations, classification codes, the
-- CIP<->SOC<->NAICS<->SIC crosswalks, the code_obligations join, per-obligation
-- embeddings for semantic fallback, plus version history and the change queue.
--
-- §03: the audit store persists ONLY decisions, rationale, trace IDs and
-- evidence pointers — never source records. It is append-only and immutable.
--
-- Idempotent: safe to run repeatedly. Apply with `node bin/migrate.mjs`.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- 1. regimes — regulatory regimes, the top-level authority
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regimes (
  id            TEXT PRIMARY KEY,            -- e.g. reg_ferpa
  code          TEXT NOT NULL UNIQUE,        -- FERPA, HIPAA, THECB, SACSCOC ...
  name          TEXT NOT NULL,
  citation_root TEXT,                        -- 20 U.S.C. 1232g
  active        BOOLEAN NOT NULL DEFAULT FALSE
);

-- -----------------------------------------------------------------------------
-- 2. obligations — specific requirements within a regime (rule text + citation)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS obligations (
  id        TEXT PRIMARY KEY,                -- ob_hipaa_privacy
  regime_id TEXT NOT NULL REFERENCES regimes(id),
  name      TEXT NOT NULL,                   -- "Privacy Rule"
  citation  TEXT NOT NULL,                   -- 45 CFR 164
  rule_text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obligations_regime ON obligations(regime_id);

-- -----------------------------------------------------------------------------
-- 3. codes — government classification codes, the identity spine
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS codes (
  id     TEXT PRIMARY KEY,                   -- code_soc_291141
  system TEXT NOT NULL,                      -- CIP | SOC | NAICS | SIC
  value  TEXT NOT NULL,                      -- 29-1141
  title  TEXT NOT NULL,                      -- Registered Nurses
  UNIQUE (system, value)
);

-- -----------------------------------------------------------------------------
-- 4. crosswalks — deterministic code-to-code mappings + relation
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crosswalks (
  id           TEXT PRIMARY KEY,
  from_code_id TEXT NOT NULL REFERENCES codes(id),
  to_code_id   TEXT NOT NULL REFERENCES codes(id),
  relation     TEXT NOT NULL DEFAULT 'maps_to',
  UNIQUE (from_code_id, to_code_id, relation)
);
CREATE INDEX IF NOT EXISTS idx_crosswalks_from ON crosswalks(from_code_id);
CREATE INDEX IF NOT EXISTS idx_crosswalks_to   ON crosswalks(to_code_id);

-- -----------------------------------------------------------------------------
-- 5. code_obligations — THE core join: which code, under which regime,
--    triggers which obligation. Carries the derived governance scope.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS code_obligations (
  id            TEXT PRIMARY KEY,
  code_id       TEXT NOT NULL REFERENCES codes(id),
  regime_id     TEXT NOT NULL REFERENCES regimes(id),
  obligation_id TEXT NOT NULL REFERENCES obligations(id),
  scope         TEXT NOT NULL,               -- nursing.clinical
  UNIQUE (code_id, regime_id, obligation_id)
);
CREATE INDEX IF NOT EXISTS idx_code_obl_code ON code_obligations(code_id);

-- -----------------------------------------------------------------------------
-- 6. embeddings — pgvector index for semantic lookup when no exact match exists
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS embeddings (
  obligation_id TEXT PRIMARY KEY REFERENCES obligations(id),
  model         TEXT NOT NULL,               -- embedding model id (reproducibility, §06.6)
  dim           INTEGER NOT NULL,            -- 1536
  vector        vector(1536) NOT NULL
);

-- -----------------------------------------------------------------------------
-- 7. matrix_versions — version history per regime (published timestamp + approver)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matrix_versions (
  id           TEXT PRIMARY KEY,
  regime_code  TEXT NOT NULL,
  version      INTEGER NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approver     TEXT NOT NULL,                -- the Matrix.Admin holder (§05 / §06.1)
  status       TEXT NOT NULL DEFAULT 'published',
  UNIQUE (regime_code, version)
);

-- -----------------------------------------------------------------------------
-- 8. change_queue — proposed changes awaiting review. Foundry writes here;
--    nothing auto-applies (§04 population & currency model).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS change_queue (
  id          TEXT PRIMARY KEY,
  regime_code TEXT NOT NULL,
  summary     TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  proposed_by TEXT NOT NULL,                   -- Foundry | a Matrix.Propose steward
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by TEXT,                            -- the Matrix.Admin approver
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_change_queue_status ON change_queue(status);

-- =============================================================================
-- Audit / evidence store (§03) — separate schema, append-only, immutable.
-- Persists pointers, never copies. One immutable row per governance decision.
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.decisions (
  decision_id      TEXT PRIMARY KEY,         -- dec_8f3a21c9
  trace_id         TEXT NOT NULL,            -- trc_44b1e0a7 (end-to-end correlation)
  subject_ref      TEXT NOT NULL,            -- entra:obj:... pointer, NOT attributes
  decision         JSONB NOT NULL,           -- { result, scope }
  rationale        TEXT NOT NULL,
  matrix_refs      JSONB NOT NULL DEFAULT '[]',  -- regime / obligation IDs applied
  evidence_pointers JSONB NOT NULL DEFAULT '[]', -- Ethos URIs + timestamps, refs not copies
  decided_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_trace   ON audit.decisions(trace_id);
CREATE INDEX IF NOT EXISTS idx_audit_subject ON audit.decisions(subject_ref);

-- Append-only enforcement: block UPDATE and DELETE at the database boundary so
-- the immutability guarantee in §03 cannot be violated by application bugs.
CREATE OR REPLACE FUNCTION audit.block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit.decisions is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit.decisions;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit.decisions
  FOR EACH ROW EXECUTE FUNCTION audit.block_mutation();
