// @ts-check
/**
 * Deck serializer — turn the engine's analysis (which carries exact `Fraction`
 * instances) into a JSON-safe payload ready to POST and persist.
 *
 * Why this exists: `onDeckBuilt(analysis, project)` hands back the raw output of
 * `analyzeTitleProject`, whose decimals are `Fraction` objects. `JSON.stringify`
 * would mangle them. This flattens to fixed-place decimal STRINGS (so a value like
 * 0.12500000 never becomes a lossy float) plus the human fraction labels, in the
 * exact shape the `doi_decks` / `doi_curative` tables expect.
 *
 * The math is NOT redone here — we only read what the deterministic engine already
 * computed. `balances` is the engine's own exact rational equality with 1.
 *
 *   import { serializeDeck } from '@smepro/doi/integration/serialize.mjs';
 *   const payload = serializeDeck(analysis, project, { unitId, basis: 'tract' });
 *   await fetch('/api/title/analyze', { method: 'POST', body: JSON.stringify(payload) });
 */

/** A Fraction-or-undefined → fixed-place decimal string (or null). */
const dec = (f, places = 8) => (f && typeof f.toDecimal === 'function' ? f.toDecimal(places) : null);
const frac = (f) => (f && typeof f.toFractionString === 'function' ? f.toFractionString() : null);

/**
 * @param {any} analysis  Return value of analyzeTitleProject().
 * @param {import('../engine/schema.mjs').TitleProject} project  The engine input (source of truth).
 * @param {{ unitId?: string, basis?: 'tract'|'unit' }} [opts]
 */
export function serializeDeck(analysis, project, opts = {}) {
  const { doi, curative = [] } = analysis || {};
  if (!doi) throw new Error('serializeDeck: analysis.doi is missing — pass the result of analyzeTitleProject().');
  const basis = opts.basis === 'unit' ? 'unit' : 'tract';

  const rows = (doi.rows || []).map((r) => ({
    owner: r.owner,
    partyId: r.partyId,
    type: r.type,
    fractionLabel: r.fractionLabel,
    nri: dec(r.nri, 8),                 // tract-basis NRI (closes to 1.00000000)
    unitNri: dec(r.unitNri, 8),         // unit-basis NRI (× participation factor)
    source: r.source,
  }));

  return {
    // Source of truth — re-analyzable at any time to reproduce this deck byte-for-byte.
    project,
    unitId: opts.unitId ?? null,
    tract: project?.tract ?? null,
    basis,
    unitFactor: dec(doi.unitFactor, 12),
    rows,
    totalNri: dec(doi.total, 12),       // tract basis: must equal 1.000000000000
    balances: !!doi.balances,           // engine's exact rational check, not a float compare
    summary: {
      royalty: frac(doi.royalty),
      totalNpri: dec(doi.totalNpri, 8),
      mineralRoyaltyPool: dec(doi.mineralRoyaltyPool, 8),
      totalOrri: dec(doi.totalOrri, 8),
      wiNet: dec(doi.wiNet, 8),
    },
    curative: curative.map((c) => ({
      code: c.code,
      severity: c.severity,
      title: c.title,
      detail: c.detail,
    })),
  };
}

export default serializeDeck;
