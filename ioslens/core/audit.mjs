// @ts-check
/**
 * The audit / evidence store (§03).
 *
 * Append-only, immutable. One row per governance decision. It persists POINTERS,
 * never copies: decision_id, trace_id, subject_ref (an Entra object-id pointer,
 * not attributes), the decision + rationale, the matrix_refs applied, and
 * evidence_pointers (Ethos URIs + timestamps). Student records, enrollment
 * status, program detail and PII are NEVER written here.
 *
 * Two backends behind one interface, mirroring the Matrix store:
 *   - createMemoryAudit() — in-process append-only array; the default.
 *   - createPgAudit()     — INSERT into audit.decisions; UPDATE/DELETE are
 *     blocked by a database trigger (see schema.sql), so immutability holds even
 *     against application bugs.
 */

/**
 * @typedef {Object} AuditRecord
 * @property {string} decision_id
 * @property {string} trace_id
 * @property {string} subject_ref
 * @property {{ result: string, scope: string|null }} decision
 * @property {string} rationale
 * @property {string[]} matrix_refs
 * @property {{ source: string, uri: string, observed_at: string }[]} evidence_pointers
 * @property {string} decided_at
 */

/**
 * @typedef {Object} AuditStore
 * @property {string} kind
 * @property {(record: AuditRecord) => Promise<AuditRecord>} append
 * @property {(q: { traceId?: string, decisionId?: string, subjectRef?: string, limit?: number }) => Promise<AuditRecord[]>} query
 */

/** Deep-freeze a record so an appended decision cannot be mutated in memory. */
function freezeRecord(/** @type {AuditRecord} */ r) {
  for (const p of r.evidence_pointers) Object.freeze(p);
  Object.freeze(r.evidence_pointers);
  Object.freeze(r.matrix_refs);
  Object.freeze(r.decision);
  return Object.freeze(r);
}

/** @returns {AuditStore} */
export function createMemoryAudit() {
  /** @type {AuditRecord[]} */ const records = [];
  return {
    kind: 'memory',
    async append(record) {
      const frozen = freezeRecord(record);
      records.push(frozen);
      return frozen;
    },
    async query({ traceId, decisionId, subjectRef, limit = 100 } = {}) {
      let out = records;
      if (traceId) out = out.filter((r) => r.trace_id === traceId);
      if (decisionId) out = out.filter((r) => r.decision_id === decisionId);
      if (subjectRef) out = out.filter((r) => r.subject_ref === subjectRef);
      // newest first
      return out.slice().reverse().slice(0, limit);
    },
  };
}

/**
 * PostgreSQL audit store. Lazily imports `pg`.
 * @param {{ connectionString?: string, pool?: any }} [opts]
 * @returns {Promise<AuditStore>}
 */
export async function createPgAudit(opts = {}) {
  let pool = opts.pool;
  if (!pool) {
    const { default: pg } = await import('pg').catch(() => {
      throw new Error("PostgreSQL audit backend requires the 'pg' package: run `npm install pg`.");
    });
    pool = new pg.Pool({ connectionString: opts.connectionString ?? process.env.DATABASE_URL });
  }
  const q = (text, params) => pool.query(text, params);
  return {
    kind: 'postgres',
    async append(record) {
      await q(
        `INSERT INTO audit.decisions
          (decision_id, trace_id, subject_ref, decision, rationale, matrix_refs, evidence_pointers, decided_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          record.decision_id,
          record.trace_id,
          record.subject_ref,
          JSON.stringify(record.decision),
          record.rationale,
          JSON.stringify(record.matrix_refs),
          JSON.stringify(record.evidence_pointers),
          record.decided_at,
        ]
      );
      return freezeRecord(record);
    },
    async query({ traceId, decisionId, subjectRef, limit = 100 } = {}) {
      const where = [];
      const params = [];
      if (traceId) { params.push(traceId); where.push(`trace_id=$${params.length}`); }
      if (decisionId) { params.push(decisionId); where.push(`decision_id=$${params.length}`); }
      if (subjectRef) { params.push(subjectRef); where.push(`subject_ref=$${params.length}`); }
      params.push(limit);
      const sql = `SELECT * FROM audit.decisions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY decided_at DESC LIMIT $${params.length}`;
      const rows = (await q(sql, params)).rows;
      return rows.map((r) => ({
        ...r,
        decided_at: r.decided_at instanceof Date ? r.decided_at.toISOString() : r.decided_at,
      }));
    },
  };
}
