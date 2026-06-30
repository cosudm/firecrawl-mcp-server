// @ts-check
/**
 * iOSLENS resolver — the decision engine, not a system of record (§03).
 *
 * "Matrix defines → iOSLENS decides." This is the *decides* half. It reads
 * production data transiently to compute a governance boundary, then persists
 * ONLY the decision and its evidence pointers — never the underlying records.
 * That contract is what keeps the platform out of FERPA-repository territory.
 *
 * Decision lifecycle (§03, "Decision lifecycle"):
 *   1. Gather   — identity from Entra, context from Ethos, rules from the Matrix
 *                 (all held in memory only).
 *   2. Evaluate — join the three sources; evaluate identity against the regime
 *                 boundary; determine scope, obligations, citations.
 *   3. Decide   — produce a governance decision: result, scope, obligation set,
 *                 citation requirements, deterministic rationale.
 *   4. Expose   — return the decision (the only artifact that leaves the resolver).
 *   5. Record   — append decision + rationale + trace id + evidence POINTERS.
 *   6. Discard  — source attribute values are dropped; never written to disk.
 */

/**
 * @typedef {import('../matrix/matrix.mjs').LookupResult} LookupResult
 * @typedef {import('../matrix/matrix.mjs').ResolvedObligation} ResolvedObligation
 * @typedef {import('./audit.mjs').AuditStore} AuditStore
 * @typedef {import('./audit.mjs').AuditRecord} AuditRecord
 * @typedef {import('../flows/entra.mjs').IdentityClient} IdentityClient
 * @typedef {import('../flows/ethos.mjs').ContextClient} ContextClient
 */

/** Canonical ordering of the identity spine, so rationale reads CIP→SOC→NAICS→SIC. */
const SYSTEM_ORDER = { CIP: 0, SOC: 1, NAICS: 2, SIC: 3 };

/** Last dotted segment of a scope, e.g. "nursing.clinical" -> "clinical". */
function scopeLeaf(scope) {
  const parts = String(scope).split('.');
  return parts[parts.length - 1];
}

/**
 * Choose the governed scope from resolved obligations: the best-supported scope
 * (most distinct contributing codes), tie-broken by name. This deterministically
 * reproduces the §03 example — SOC 29-1141 + NAICS 622110 (HIPAA) outweighs the
 * single CIP-driven academic scope, yielding `nursing.clinical`.
 * @param {ResolvedObligation[]} obligations
 * @returns {string|null}
 */
function chooseScope(obligations) {
  /** @type {Map<string, Set<string>>} */ const codesByScope = new Map();
  for (const o of obligations) {
    if (!codesByScope.has(o.scope)) codesByScope.set(o.scope, new Set());
    codesByScope.get(o.scope).add(o.code_id);
  }
  let best = null;
  let bestCount = -1;
  for (const scope of [...codesByScope.keys()].sort()) {
    const count = codesByScope.get(scope).size;
    if (count > bestCount) { best = scope; bestCount = count; }
  }
  return best;
}

/**
 * @param {{
 *   matrix: { lookup: (i: any) => Promise<LookupResult> },
 *   audit: AuditStore,
 *   entra: IdentityClient,
 *   ethos: ContextClient,
 *   ids?: { decisionId: () => string, traceId: () => string },
 *   clock?: () => string,
 *   activeOnly?: boolean,
 * }} deps
 */
export function createResolver(deps) {
  const clock = deps.clock ?? (() => new Date().toISOString());

  // Resolve the id generator: prefer the injected one (deterministic tests),
  // else lazily import the default crypto-backed generator.
  /** @returns {Promise<{decisionId:()=>string, traceId:()=>string}>} */
  async function idGen() {
    return deps.ids ?? (await import('./ids.mjs')).defaultIds();
  }

  /**
   * Compute one governance decision for a subject.
   * @param {{
   *   subjectRef: string,
   *   codes?: { system?: string, value: string }[],
   *   requestedScope?: string,
   *   jurisdiction?: string,
   *   query?: string,
   *   activeOnly?: boolean,
   * }} request
   * @returns {Promise<{
   *   decision_id: string, trace_id: string, subject_ref: string,
   *   decision: { result: string, scope: string|null, obligations: string[], citations: string[] },
   *   rationale: string, matrix_refs: string[],
   *   evidence_pointers: { source: string, uri: string, observed_at: string }[],
   *   decided_at: string, matched: string, version_ids: Record<string, number>,
   * }>}
   */
  async function resolve(request) {
    const gen = await idGen();
    const decision_id = gen.decisionId();
    const trace_id = gen.traceId();
    const decided_at = clock();
    const subject_ref = request.subjectRef;
    const activeOnly = request.activeOnly ?? deps.activeOnly ?? false;

    // 1. GATHER — identity, context, rules (memory only).
    const identity = await deps.entra.resolve(subject_ref);
    const ctx = await deps.ethos.context(subject_ref);
    const evidence_pointers = ctx.evidence ?? [];

    /** Build + persist an immutable audit record (steps 5 + 6). */
    const finalize = async (/** @type {{result:string, scope:string|null, obligations:string[], citations:string[]}} */ decision, /** @type {string} */ rationale, /** @type {string[]} */ matrix_refs, /** @type {string} */ matched, /** @type {Record<string,number>} */ version_ids) => {
      /** @type {AuditRecord} */
      const record = {
        decision_id, trace_id, subject_ref,
        decision: { result: decision.result, scope: decision.scope }, // §03: only result + scope persist in the decision field
        rationale, matrix_refs, evidence_pointers,
        decided_at,
      };
      await deps.audit.append(record);
      // 6. DISCARD — drop transient source attribute values from memory.
      // identity.role/department and ctx.codes/enrollmentStatus/programDetail are
      // never referenced again and never written to disk.
      return { decision_id, trace_id, subject_ref, decision, rationale, matrix_refs, evidence_pointers, decided_at, matched, version_ids };
    };

    // Identity must resolve. Unknown subject → fail, no scope.
    if (!identity) {
      return finalize({ result: 'fail', scope: null, obligations: [], citations: [] }, 'unknown subject — no Entra identity resolved', [], 'none', {});
    }

    // Flow B liveness: a dropped/graduated subject is un-scoped at resolution time.
    if (ctx.enrollmentStatus !== 'active') {
      return finalize(
        { result: 'fail', scope: null, obligations: [], citations: [] },
        `enrollment ${ctx.enrollmentStatus} → un-scoped`,
        [], 'none', {}
      );
    }

    // 2. EVALUATE — load rules from the Matrix using the live codes.
    const codes = request.codes?.length ? request.codes : ctx.codes;
    const lookup = await deps.matrix.lookup({ codes, jurisdiction: request.jurisdiction, query: request.query });
    let obligations = lookup.obligations;
    if (activeOnly) obligations = obligations.filter((o) => o.regime.active);

    if (!obligations.length) {
      return finalize(
        { result: 'fail', scope: null, obligations: [], citations: [] },
        'no applicable obligations for resolved codes',
        [], lookup.matched, lookup.versionIds
      );
    }

    // 3. DECIDE — determine the governed scope and the obligations that apply to it.
    const available = [...new Set(obligations.map((o) => o.scope))].sort();
    let scope = request.requestedScope ?? chooseScope(obligations);
    let result = 'pass';
    if (request.requestedScope && !available.includes(request.requestedScope)) {
      result = 'fail';
      scope = null;
    }

    const scoped = scope ? obligations.filter((o) => o.scope === scope) : [];
    const obligationIds = [...new Set(scoped.map((o) => o.obligation.id))].sort();
    const citations = [...new Set(scoped.map((o) => `${o.regime.code} ${o.obligation.citation}`))].sort();
    const regimeCodes = [...new Set(scoped.map((o) => o.regime.code))].sort();
    const contributingCodes = [...new Set(scoped.map((o) => o.code_id))]
      .map((cid) => lookup.expandedCodes.find((c) => c.id === cid))
      .filter(Boolean)
      .sort((a, b) => (SYSTEM_ORDER[a.system] ?? 9) - (SYSTEM_ORDER[b.system] ?? 9) || a.value.localeCompare(b.value))
      .map((c) => `${c.system} ${c.value}`.trim());

    const rationale = scope
      ? `${[...contributingCodes, ...regimeCodes].join(' + ')} → ${scopeLeaf(scope)} scope`
      : `requested scope ${request.requestedScope} not available (have: ${available.join(', ')})`;

    const matrix_refs = [...regimeCodes, ...obligationIds];

    // 4. EXPOSE + 5. RECORD + 6. DISCARD
    return finalize({ result, scope, obligations: obligationIds, citations }, rationale, matrix_refs, lookup.matched, lookup.versionIds);
  }

  return { resolve };
}
