// @ts-check
/**
 * Identifier generation for decisions and traces.
 *
 * decision_id (dec_…) names one immutable governance decision; trace_id (trc_…)
 * carries end-to-end correlation across the gather→record lifecycle. Both are
 * generated here so the format is consistent and the generator is injectable for
 * deterministic tests.
 */
import { randomBytes } from 'node:crypto';

/** @param {string} prefix @param {number} bytes */
function token(prefix, bytes) {
  return `${prefix}_${randomBytes(bytes).toString('hex')}`;
}

/** @returns {string} e.g. dec_8f3a21c9 */
export function decisionId() {
  return token('dec', 4);
}

/** @returns {string} e.g. trc_44b1e0a7 */
export function traceId() {
  return token('trc', 4);
}

/**
 * Default id generator. Tests pass a deterministic stub implementing the same
 * shape to get stable decision/trace ids.
 * @returns {{ decisionId: () => string, traceId: () => string }}
 */
export function defaultIds() {
  return { decisionId, traceId };
}
