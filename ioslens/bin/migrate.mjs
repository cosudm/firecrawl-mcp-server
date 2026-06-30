#!/usr/bin/env node
// @ts-check
/**
 * Apply the Matrix + audit schema to PostgreSQL, and optionally seed the v1
 * Matrix release (§04, "Population & currency").
 *
 *   DATABASE_URL=postgres://… node bin/migrate.mjs          # schema only
 *   DATABASE_URL=postgres://… node bin/migrate.mjs --seed   # schema + seed + v1 versions
 *
 * Requires the optional `pg` driver (`npm install pg`) and a pgvector-enabled
 * PostgreSQL 15+ (the docker-compose ships pgvector/pgvector:pg16).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedData } from '../matrix/seed/seed.mjs';
import { createHashEmbedder } from '../matrix/embeddings.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

try { process.loadEnvFile?.('.env'); } catch { /* no .env */ }

async function main() {
  const seed = process.argv.includes('--seed');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    process.stderr.write('DATABASE_URL is required.\n');
    process.exit(1);
  }
  const { default: pg } = await import('pg').catch(() => {
    throw new Error("migrate requires the 'pg' package: run `npm install pg`.");
  });
  const pool = new pg.Pool({ connectionString });

  try {
    const schema = await readFile(join(ROOT, 'matrix', 'schema.sql'), 'utf8');
    process.stdout.write('Applying schema…\n');
    await pool.query(schema);
    process.stdout.write('Schema applied.\n');

    if (seed) {
      await seedContent(pool);
    }
  } finally {
    await pool.end();
  }
}

/** @param {any} pool */
async function seedContent(pool) {
  const data = seedData();
  const embedder = createHashEmbedder({ dim: 1536 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const r of data.regimes) {
      await client.query(
        'INSERT INTO regimes (id, code, name, citation_root, active) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code, name=EXCLUDED.name, citation_root=EXCLUDED.citation_root, active=EXCLUDED.active',
        [r.id, r.code, r.name, r.citation_root, r.active]
      );
    }
    for (const o of data.obligations) {
      await client.query(
        'INSERT INTO obligations (id, regime_id, name, citation, rule_text) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, citation=EXCLUDED.citation, rule_text=EXCLUDED.rule_text',
        [o.id, o.regime_id, o.name, o.citation, o.rule_text]
      );
    }
    for (const c of data.codes) {
      await client.query(
        'INSERT INTO codes (id, system, value, title) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET system=EXCLUDED.system, value=EXCLUDED.value, title=EXCLUDED.title',
        [c.id, c.system, c.value, c.title]
      );
    }
    for (const x of data.crosswalks) {
      await client.query(
        'INSERT INTO crosswalks (id, from_code_id, to_code_id, relation) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING',
        [x.id, x.from_code_id, x.to_code_id, x.relation]
      );
    }
    for (const co of data.codeObligations) {
      await client.query(
        'INSERT INTO code_obligations (id, code_id, regime_id, obligation_id, scope) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET scope=EXCLUDED.scope',
        [co.id, co.code_id, co.regime_id, co.obligation_id, co.scope]
      );
    }

    // Embeddings (reproducible — §06.6).
    const regimeById = new Map(data.regimes.map((r) => [r.id, r]));
    for (const o of data.obligations) {
      const regime = regimeById.get(o.regime_id);
      const text = `${regime ? regime.code + ' ' : ''}${o.name}. ${o.rule_text} (${o.citation})`;
      const vec = `[${Array.from(embedder.embed(text)).join(',')}]`;
      await client.query(
        'INSERT INTO embeddings (obligation_id, model, dim, vector) VALUES ($1,$2,$3,$4) ON CONFLICT (obligation_id) DO UPDATE SET model=EXCLUDED.model, dim=EXCLUDED.dim, vector=EXCLUDED.vector',
        [o.id, embedder.model, embedder.dim, vec]
      );
    }

    // Publish v1 for each regime that has content, approver = the v1 release.
    const regimeCodes = [...new Set(data.regimes.map((r) => r.code))];
    for (const code of regimeCodes) {
      await client.query(
        `INSERT INTO matrix_versions (id, regime_code, version, approver, status)
         VALUES ($1,$2,1,$3,'published') ON CONFLICT (regime_code, version) DO NOTHING`,
        [`mv_${code.toLowerCase()}_1`, code, 'SMEPro:v1-release']
      );
    }

    await client.query('COMMIT');
    process.stdout.write(`Seeded ${data.regimes.length} regimes, ${data.obligations.length} obligations, ${data.codes.length} codes, ${data.codeObligations.length} code-obligations, embeddings, and v1 versions.\n`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  process.stderr.write(`migrate failed: ${err?.stack ?? err}\n`);
  process.exit(1);
});
