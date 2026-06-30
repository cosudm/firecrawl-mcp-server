// @ts-check
/**
 * The Compliance Decoding Matrix engine (§04).
 *
 * "Matrix defines → iOSLENS decides." This module is the *defines* half: given a
 * set of resolved classification codes (and an optional jurisdiction / free-text
 * query), it executes the deterministic read path and returns the obligation
 * set, regime references, citations, and version IDs. It supplies the rules,
 * never the verdict — iOSLENS computes the decision from this.
 *
 * Read path (§04, "How a lookup executes"):
 *   1. Input            — resolved codes (e.g. SOC 29-1141, NAICS 622110, TX)
 *   2. Crosswalk expand — BFS over crosswalks so a partial input hits the full
 *                         CIP↔SOC↔NAICS↔SIC identity spine
 *   3. Obligation resolve — join code_obligations → obligations → regimes
 *   4. Semantic fallback  — if no exact match, pgvector similarity over embeddings
 *   5. Return            — obligations, regime refs, citations, version IDs
 */

/**
 * @typedef {import('./store.mjs').MatrixStore} MatrixStore
 * @typedef {import('./seed/seed.mjs').Obligation} Obligation
 * @typedef {import('./seed/seed.mjs').Regime} Regime
 * @typedef {import('./seed/seed.mjs').Code} Code
 */

/**
 * @typedef {Object} ResolvedObligation
 * @property {Obligation} obligation
 * @property {Regime} regime
 * @property {string} scope
 * @property {string} code_id     // which expanded code triggered it
 * @property {number} [score]     // present on semantic matches
 */

/**
 * @typedef {Object} LookupResult
 * @property {Code[]} inputCodes
 * @property {Code[]} expandedCodes
 * @property {ResolvedObligation[]} obligations
 * @property {string[]} scopes              // distinct scopes, deterministic order
 * @property {{ id: string, code: string, active: boolean }[]} regimeRefs
 * @property {string[]} citations
 * @property {Record<string, number>} versionIds   // regimeCode -> latest published version
 * @property {'exact'|'semantic'|'none'} matched
 */

/** @param {MatrixStore} store */
export function createMatrix(store) {
  /**
   * Expand resolved input codes across crosswalks (BFS, both directions) so a
   * partial input still hits the full identity spine.
   * @param {Code[]} inputCodes
   * @returns {Promise<Code[]>}
   */
  async function expand(inputCodes) {
    /** @type {Set<string>} */ const seen = new Set(inputCodes.map((c) => c.id));
    const queue = [...seen];
    while (queue.length) {
      const id = queue.shift();
      for (const nId of await store.neighbors(id)) {
        if (!seen.has(nId)) {
          seen.add(nId);
          queue.push(nId);
        }
      }
    }
    // Materialize the expanded ids back to Code rows (input + crosswalked).
    const byId = new Map(inputCodes.map((c) => [c.id, c]));
    /** @type {Code[]} */ const out = [];
    for (const id of seen) {
      out.push(byId.get(id) ?? (await store.getCode(id)));
    }
    return out.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Execute the full read path.
   * @param {{ codes: {system?: string, value: string}[], jurisdiction?: string, query?: string, semanticLimit?: number }} input
   * @returns {Promise<LookupResult>}
   */
  async function lookup(input) {
    const semanticLimit = input.semanticLimit ?? 5;
    const inputCodes = await store.resolveCodes(input.codes ?? []);
    const expandedCodes = await expand(inputCodes);

    // 3. Obligation resolution (exact path).
    const expandedIds = expandedCodes.map((c) => c.id);
    const codeObs = await store.codeObligationsFor(expandedIds);

    /** @type {ResolvedObligation[]} */ const obligations = [];
    for (const co of codeObs) {
      const obligation = await store.getObligation(co.obligation_id);
      const regime = await store.getRegime(co.regime_id);
      if (obligation && regime) obligations.push({ obligation, regime, scope: co.scope, code_id: co.code_id });
    }

    /** @type {'exact'|'semantic'|'none'} */ let matched = obligations.length ? 'exact' : 'none';

    // 4. Semantic fallback — only when the exact path found nothing.
    if (!obligations.length) {
      const queryText =
        input.query?.trim() ||
        [input.jurisdiction, ...inputCodes.map((c) => c.title), ...expandedCodes.map((c) => c.title)]
          .filter(Boolean)
          .join(' ');
      if (queryText) {
        const hits = await store.semanticSearch(store.embedder.embed(queryText), semanticLimit);
        for (const hit of hits) {
          const obligation = await store.getObligation(hit.obligation_id);
          if (!obligation) continue;
          const regime = await store.getRegime(obligation.regime_id);
          if (regime) obligations.push({ obligation, regime, scope: `semantic.${regime.code.toLowerCase()}`, code_id: '∅', score: hit.score });
        }
        if (obligations.length) matched = 'semantic';
      }
    }

    // 5. Assemble references, citations, scopes, version ids (deterministic order).
    const scopes = [...new Set(obligations.map((o) => o.scope))].sort();
    /** @type {Map<string, { id: string, code: string, active: boolean }>} */ const regimeMap = new Map();
    for (const o of obligations) regimeMap.set(o.regime.code, { id: o.regime.id, code: o.regime.code, active: o.regime.active });
    const regimeRefs = [...regimeMap.values()].sort((a, b) => a.code.localeCompare(b.code));
    const citations = [...new Set(obligations.map((o) => `${o.regime.code} ${o.obligation.citation}`))].sort();

    /** @type {Record<string, number>} */ const versionIds = {};
    for (const ref of regimeRefs) versionIds[ref.code] = await store.latestVersion(ref.code);

    return { inputCodes, expandedCodes, obligations, scopes, regimeRefs, citations, versionIds, matched };
  }

  return { lookup, expand };
}
