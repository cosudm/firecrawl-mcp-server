// @ts-check
/**
 * Embedding provider for the Matrix semantic-fallback path (§04, step 4).
 *
 * The pilot ships a DETERMINISTIC, dependency-free embedder so the
 * semantic-fallback path is reproducible (§06, open item 6: "confirm the
 * embedding model + dimensionality so the semantic-fallback path is
 * reproducible"). Same text + same model id + same dimensionality always
 * produces the same vector — no network, no drift, fully testable.
 *
 * In production this is swappable: pass a `{ model, dim, embed }` provider that
 * calls a hosted embedding model (e.g. text-embedding-3-small at dim 1536). The
 * Matrix engine only depends on the `embed()` contract and cosine similarity, so
 * the rest of the system is indifferent to which provider is wired in.
 */
import { createHash } from 'node:crypto';

export const DEFAULT_DIM = 1536;
export const DEFAULT_MODEL = 'ioslens-hash-v1';

/**
 * @typedef {Object} EmbeddingProvider
 * @property {string} model
 * @property {number} dim
 * @property {(text: string) => Float64Array} embed
 */

/**
 * Deterministic feature-hashing embedder. Tokenizes text, hashes each token to a
 * dimension with a signed contribution (the hashing trick), then L2-normalizes.
 * Cosine similarity over these vectors is a stable, reproducible proxy for
 * lexical/semantic overlap — adequate for the pilot's fallback ranking.
 *
 * @param {{ model?: string, dim?: number }} [opts]
 * @returns {EmbeddingProvider}
 */
export function createHashEmbedder(opts = {}) {
  const dim = opts.dim ?? DEFAULT_DIM;
  const model = opts.model ?? DEFAULT_MODEL;

  /** @param {string} token @returns {[number, number]} bucket index + sign */
  function hashToken(token) {
    const h = createHash('sha256').update(token).digest();
    // first 4 bytes → bucket; next byte's low bit → sign
    const bucket = h.readUInt32BE(0) % dim;
    const sign = (h[4] & 1) === 0 ? 1 : -1;
    return [bucket, sign];
  }

  /** @param {string} text @returns {Float64Array} */
  function embed(text) {
    const vec = new Float64Array(dim);
    const tokens = String(text)
      .toLowerCase()
      .replace(/[^a-z0-9§]+/g, ' ')
      .split(' ')
      .filter(Boolean);
    for (const token of tokens) {
      const [bucket, sign] = hashToken(token);
      vec[bucket] += sign;
    }
    // L2 normalize so cosine similarity == dot product
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) vec[i] /= norm;
    return vec;
  }

  return { model, dim, embed };
}

/**
 * Cosine similarity for two equal-length, finite vectors. Inputs from the hash
 * embedder are pre-normalized, so this reduces to a dot product but stays
 * correct for un-normalized production vectors too.
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @returns {number}
 */
export function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
