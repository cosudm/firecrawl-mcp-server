// @ts-check
/**
 * Layer 1 — the door (§05). Local, egress-only Entra JWT validation.
 *
 * The control-plane MCP server validates the bearer JWT ITSELF against Entra's
 * public keys: it fetches the JWKS over outbound 443 (cached), verifies the
 * RS256 signature, then checks issuer, audience, expiry/nbf. It never opens an
 * inbound port to Entra and never calls back per-request — the same egress-only
 * posture as Entra Connect. On any failure the caller is rejected with 403
 * before any tool code runs.
 *
 * Verification uses only node:crypto (createPublicKey supports JWK directly), so
 * there is no JWT/JOSE dependency. `fetchJwks` is injectable for offline tests.
 */
import { createPublicKey, verify as cryptoVerify, sign as cryptoSign, randomUUID } from 'node:crypto';

/** base64url -> Buffer */
function b64urlToBuf(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
/** Buffer/utf8 -> base64url string */
function toB64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Thrown on any Layer-1 rejection. `.status` is 401/403 for transports to surface. */
export class AuthError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 403) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/**
 * @typedef {Object} JwtVerifier
 * @property {(token: string) => Promise<Record<string, any>>} verify  // returns validated claims
 */

/**
 * Build a JWKS-backed RS256 verifier.
 * @param {{
 *   jwksUri: string,
 *   issuer: string | string[],
 *   audience: string | string[],
 *   fetchJwks?: () => Promise<{ keys: any[] }>,
 *   clock?: () => number,            // ms epoch
 *   leewaySec?: number,
 *   cacheTtlMs?: number,
 * }} config
 * @returns {JwtVerifier}
 */
export function createJwtVerifier(config) {
  const leeway = (config.leewaySec ?? 60) * 1000;
  const now = config.clock ?? (() => Date.now());
  const ttl = config.cacheTtlMs ?? 60 * 60 * 1000; // 1h
  const issuers = new Set(Array.isArray(config.issuer) ? config.issuer : [config.issuer]);
  const audiences = new Set(Array.isArray(config.audience) ? config.audience : [config.audience]);

  /** @type {Map<string, import('node:crypto').KeyObject>} */ let keyCache = new Map();
  let cachedAt = 0;

  const doFetch = config.fetchJwks ?? (async () => {
    const res = await fetch(config.jwksUri, { method: 'GET' });
    if (!res.ok) throw new AuthError(`JWKS fetch failed: ${res.status}`, 401);
    return /** @type {{keys:any[]}} */ (await res.json());
  });

  async function refreshKeys() {
    const jwks = await doFetch();
    const next = new Map();
    for (const jwk of jwks.keys ?? []) {
      if (!jwk.kid) continue;
      try {
        next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
      } catch {
        /* skip malformed key */
      }
    }
    keyCache = next;
    cachedAt = now();
  }

  /** @param {string} kid */
  async function keyFor(kid) {
    if (!keyCache.has(kid) || now() - cachedAt > ttl) await refreshKeys();
    const key = keyCache.get(kid);
    if (!key) {
      // Unknown kid: force one refresh in case of key rotation, then give up.
      await refreshKeys();
      const retry = keyCache.get(kid);
      if (!retry) throw new AuthError(`no signing key for kid ${kid}`, 401);
      return retry;
    }
    return key;
  }

  return {
    async verify(token) {
      if (!token || typeof token !== 'string') throw new AuthError('missing bearer token', 401);
      const parts = token.split('.');
      if (parts.length !== 3) throw new AuthError('malformed JWT', 401);
      const [h, p, s] = parts;

      let header, claims;
      try {
        header = JSON.parse(b64urlToBuf(h).toString('utf8'));
        claims = JSON.parse(b64urlToBuf(p).toString('utf8'));
      } catch {
        throw new AuthError('unparseable JWT segments', 401);
      }
      if (header.alg !== 'RS256') throw new AuthError(`unsupported alg ${header.alg}`, 401);
      if (!header.kid) throw new AuthError('JWT missing kid', 401);

      // Signature.
      const key = await keyFor(header.kid);
      const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, b64urlToBuf(s));
      if (!ok) throw new AuthError('invalid signature', 401);

      // Claims.
      const t = now();
      if (claims.exp != null && t > claims.exp * 1000 + leeway) throw new AuthError('token expired', 401);
      if (claims.nbf != null && t < claims.nbf * 1000 - leeway) throw new AuthError('token not yet valid', 401);
      if (!issuers.has(claims.iss)) throw new AuthError('issuer mismatch', 401);
      const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!auds.some((a) => audiences.has(a))) throw new AuthError('audience mismatch', 401);

      return claims;
    },
  };
}

/**
 * A trivial verifier for local/offline development (MCP_AUTH=dev). It decodes the
 * JWT WITHOUT verifying the signature and trusts its claims. NEVER use in
 * production — the whole point of Layer 1 is cryptographic validation.
 * @returns {JwtVerifier}
 */
export function createInsecureDevVerifier() {
  return {
    async verify(token) {
      const parts = String(token).split('.');
      if (parts.length < 2) throw new AuthError('malformed dev token', 401);
      try {
        return JSON.parse(b64urlToBuf(parts[1]).toString('utf8'));
      } catch {
        throw new AuthError('unparseable dev token', 401);
      }
    },
  };
}

/**
 * Dev/test helper: mint a signed RS256 JWT from a private key. Used by the test
 * suite (with a generated keypair) and for issuing local tokens; not part of the
 * request path.
 * @param {{ privateKey: import('node:crypto').KeyObject, kid: string, claims: Record<string, any> }} args
 * @returns {string}
 */
export function devSignJwt({ privateKey, kid, claims }) {
  const header = toB64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payload = toB64url(JSON.stringify({ jti: randomUUID(), ...claims }));
  const sig = toB64url(cryptoSign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey));
  return `${header}.${payload}.${sig}`;
}
