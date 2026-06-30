// @ts-check
/**
 * Matrix + audit persistence, behind one async interface.
 *
 * Two interchangeable backends:
 *   - createMemoryStore() — zero-dependency, seeded in-process. The default; it
 *     makes the whole platform runnable and testable offline. Semantic fallback
 *     runs cosine similarity in JS.
 *   - createPgStore()     — PostgreSQL 15+ / pgvector (§02, §04). Lazily imports
 *     the optional `pg` driver. Production backend; semantic fallback uses the
 *     pgvector `<=>` operator. Selected automatically when DATABASE_URL is set.
 *
 * The iOSLENS engine and the MCP tools depend ONLY on this interface, so swapping
 * the backend changes nothing upstream.
 *
 * @typedef {import('./seed/seed.mjs').Regime} Regime
 * @typedef {import('./seed/seed.mjs').Obligation} Obligation
 * @typedef {import('./seed/seed.mjs').Code} Code
 * @typedef {import('./seed/seed.mjs').Crosswalk} Crosswalk
 * @typedef {import('./seed/seed.mjs').CodeObligation} CodeObligation
 * @typedef {import('./embeddings.mjs').EmbeddingProvider} EmbeddingProvider
 */
import { seedData } from './seed/seed.mjs';
import { createHashEmbedder, cosine } from './embeddings.mjs';

/**
 * @typedef {Object} MatrixStore
 * @property {string} kind
 * @property {EmbeddingProvider} embedder
 * @property {() => Promise<Regime[]>} getRegimes
 * @property {(refs: {system?: string, value: string}[]) => Promise<Code[]>} resolveCodes
 * @property {(id: string) => Promise<Code|undefined>} getCode
 * @property {(codeId: string) => Promise<string[]>} neighbors          // crosswalk-adjacent code ids (both directions)
 * @property {(codeIds: string[]) => Promise<CodeObligation[]>} codeObligationsFor
 * @property {(id: string) => Promise<Obligation|undefined>} getObligation
 * @property {(id: string) => Promise<Regime|undefined>} getRegime
 * @property {(queryVector: ArrayLike<number>, limit: number) => Promise<{obligation_id: string, score: number}[]>} semanticSearch
 * @property {(regimeCode: string) => Promise<number>} latestVersion
 * @property {(v: {regime_code: string, approver: string}) => Promise<any>} publishVersion
 * @property {() => Promise<any[]>} listVersions
 * @property {(c: {regime_code: string, summary: string, payload?: any, proposed_by: string}) => Promise<any>} enqueueChange
 * @property {(id: string) => Promise<any|undefined>} getChange
 * @property {(status?: string) => Promise<any[]>} listChanges
 * @property {(id: string, patch: {status: string, reviewed_by: string, reviewed_at: string}) => Promise<any|undefined>} reviewChange
 */

/** Build the embedding text for an obligation (regime code + name + rule + citation). */
function obligationText(/** @type {Obligation} */ ob, /** @type {Regime|undefined} */ regime) {
  return `${regime ? regime.code + ' ' : ''}${ob.name}. ${ob.rule_text} (${ob.citation})`;
}

/**
 * In-memory, seeded Matrix store.
 * @param {{ embedder?: EmbeddingProvider, seed?: ReturnType<typeof seedData>, clock?: () => string }} [opts]
 * @returns {MatrixStore}
 */
export function createMemoryStore(opts = {}) {
  const embedder = opts.embedder ?? createHashEmbedder();
  const data = opts.seed ?? seedData();
  const clock = opts.clock ?? (() => new Date().toISOString());

  const regimeById = new Map(data.regimes.map((r) => [r.id, r]));
  const obligationById = new Map(data.obligations.map((o) => [o.id, o]));
  const codeById = new Map(data.codes.map((c) => [c.id, c]));

  // Undirected adjacency for crosswalk expansion.
  /** @type {Map<string, Set<string>>} */
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  };
  for (const x of data.crosswalks) {
    link(x.from_code_id, x.to_code_id);
    link(x.to_code_id, x.from_code_id);
  }

  // Precompute obligation embeddings (reproducible — §06.6).
  /** @type {Map<string, Float64Array>} */
  const vectors = new Map();
  for (const ob of data.obligations) {
    vectors.set(ob.id, embedder.embed(obligationText(ob, regimeById.get(ob.regime_id))));
  }

  /** @type {any[]} */ const versions = [];
  /** @type {Map<string, any>} */ const changes = new Map();
  let changeSeq = 0;

  return {
    kind: 'memory',
    embedder,
    async getRegimes() {
      return [...regimeById.values()];
    },
    async resolveCodes(refs) {
      /** @type {Code[]} */ const out = [];
      for (const ref of refs) {
        const val = String(ref.value).trim();
        for (const c of codeById.values()) {
          if (c.value === val && (!ref.system || c.system === ref.system)) out.push(c);
        }
      }
      return out;
    },
    async getCode(id) {
      return codeById.get(id);
    },
    async neighbors(codeId) {
      return [...(adj.get(codeId) ?? [])];
    },
    async codeObligationsFor(codeIds) {
      const set = new Set(codeIds);
      return data.codeObligations.filter((co) => set.has(co.code_id));
    },
    async getObligation(id) {
      return obligationById.get(id);
    },
    async getRegime(id) {
      return regimeById.get(id);
    },
    async semanticSearch(queryVector, limit) {
      const scored = [];
      for (const [obligation_id, vec] of vectors) {
        scored.push({ obligation_id, score: cosine(queryVector, vec) });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit);
    },
    async latestVersion(regimeCode) {
      return versions
        .filter((v) => v.regime_code === regimeCode)
        .reduce((max, v) => Math.max(max, v.version), 0);
    },
    async publishVersion({ regime_code, approver }) {
      const version = (await this.latestVersion(regime_code)) + 1;
      const rec = { id: `mv_${regime_code.toLowerCase()}_${version}`, regime_code, version, approver, status: 'published', published_at: clock() };
      versions.push(rec);
      return rec;
    },
    async listVersions() {
      return [...versions];
    },
    async enqueueChange({ regime_code, summary, payload = {}, proposed_by }) {
      const id = `chg_${(++changeSeq).toString(36).padStart(4, '0')}`;
      const rec = { id, regime_code, summary, payload, status: 'pending', proposed_by, proposed_at: clock(), reviewed_by: null, reviewed_at: null };
      changes.set(id, rec);
      return rec;
    },
    async getChange(id) {
      return changes.get(id);
    },
    async listChanges(status) {
      const all = [...changes.values()];
      return status ? all.filter((c) => c.status === status) : all;
    },
    async reviewChange(id, patch) {
      const rec = changes.get(id);
      if (!rec) return undefined;
      Object.assign(rec, patch);
      return rec;
    },
  };
}

/**
 * PostgreSQL / pgvector Matrix store. Lazily imports `pg` so the package has no
 * hard dependency; install `pg` and set DATABASE_URL to enable it.
 * @param {{ connectionString?: string, embedder?: EmbeddingProvider, pool?: any }} [opts]
 * @returns {Promise<MatrixStore>}
 */
export async function createPgStore(opts = {}) {
  const embedder = opts.embedder ?? createHashEmbedder();
  let pool = opts.pool;
  if (!pool) {
    const { default: pg } = await import('pg').catch(() => {
      throw new Error("PostgreSQL backend requires the 'pg' package: run `npm install pg`.");
    });
    pool = new pg.Pool({ connectionString: opts.connectionString ?? process.env.DATABASE_URL });
  }
  const q = (text, params) => pool.query(text, params);
  const toLiteral = (/** @type {ArrayLike<number>} */ v) => `[${Array.from(v).join(',')}]`;

  return {
    kind: 'postgres',
    embedder,
    async getRegimes() {
      return (await q('SELECT * FROM regimes ORDER BY code')).rows;
    },
    async resolveCodes(refs) {
      if (!refs.length) return [];
      const out = [];
      for (const ref of refs) {
        const rows = ref.system
          ? (await q('SELECT * FROM codes WHERE value=$1 AND system=$2', [ref.value, ref.system])).rows
          : (await q('SELECT * FROM codes WHERE value=$1', [ref.value])).rows;
        out.push(...rows);
      }
      return out;
    },
    async getCode(id) {
      return (await q('SELECT * FROM codes WHERE id=$1', [id])).rows[0];
    },
    async neighbors(codeId) {
      const rows = (await q(
        'SELECT to_code_id AS id FROM crosswalks WHERE from_code_id=$1 UNION SELECT from_code_id AS id FROM crosswalks WHERE to_code_id=$1',
        [codeId]
      )).rows;
      return rows.map((r) => r.id);
    },
    async codeObligationsFor(codeIds) {
      if (!codeIds.length) return [];
      return (await q('SELECT * FROM code_obligations WHERE code_id = ANY($1)', [codeIds])).rows;
    },
    async getObligation(id) {
      return (await q('SELECT * FROM obligations WHERE id=$1', [id])).rows[0];
    },
    async getRegime(id) {
      return (await q('SELECT * FROM regimes WHERE id=$1', [id])).rows[0];
    },
    async semanticSearch(queryVector, limit) {
      const rows = (await q(
        'SELECT obligation_id, 1 - (vector <=> $1) AS score FROM embeddings ORDER BY vector <=> $1 LIMIT $2',
        [toLiteral(queryVector), limit]
      )).rows;
      return rows.map((r) => ({ obligation_id: r.obligation_id, score: Number(r.score) }));
    },
    async latestVersion(regimeCode) {
      const r = (await q('SELECT COALESCE(MAX(version),0) AS v FROM matrix_versions WHERE regime_code=$1', [regimeCode])).rows[0];
      return Number(r.v);
    },
    async publishVersion({ regime_code, approver }) {
      const version = (await this.latestVersion(regime_code)) + 1;
      const id = `mv_${regime_code.toLowerCase()}_${version}`;
      const rec = (await q(
        'INSERT INTO matrix_versions (id, regime_code, version, approver, status) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [id, regime_code, version, approver, 'published']
      )).rows[0];
      return rec;
    },
    async listVersions() {
      return (await q('SELECT * FROM matrix_versions ORDER BY published_at DESC')).rows;
    },
    async enqueueChange({ regime_code, summary, payload = {}, proposed_by }) {
      const id = `chg_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
      return (await q(
        'INSERT INTO change_queue (id, regime_code, summary, payload, proposed_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [id, regime_code, summary, JSON.stringify(payload), proposed_by]
      )).rows[0];
    },
    async getChange(id) {
      return (await q('SELECT * FROM change_queue WHERE id=$1', [id])).rows[0];
    },
    async listChanges(status) {
      return status
        ? (await q('SELECT * FROM change_queue WHERE status=$1 ORDER BY proposed_at', [status])).rows
        : (await q('SELECT * FROM change_queue ORDER BY proposed_at')).rows;
    },
    async reviewChange(id, patch) {
      return (await q(
        'UPDATE change_queue SET status=$2, reviewed_by=$3, reviewed_at=$4 WHERE id=$1 RETURNING *',
        [id, patch.status, patch.reviewed_by, patch.reviewed_at]
      )).rows[0];
    },
  };
}
