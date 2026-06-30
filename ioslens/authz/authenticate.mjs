// @ts-check
/**
 * Layer 1 authentication glue: validated JWT claims → caller context.
 *
 * Combines the cryptographic verifier (jwt.mjs) with the role extraction
 * (approles.mjs) to produce the `{ claims, roles, principal }` context the MCP
 * dispatcher authorizes against. Throws AuthError on any validation failure.
 */
import { rolesFromClaims } from './approles.mjs';

/**
 * @param {import('./jwt.mjs').JwtVerifier} verifier
 * @param {string} token bearer token (no "Bearer " prefix)
 * @returns {Promise<{ claims: Record<string, any>, roles: string[], principal: string }>}
 */
export async function authenticate(verifier, token) {
  const claims = await verifier.verify(token); // throws AuthError on failure
  const roles = rolesFromClaims(claims);
  const principal = claims.oid || claims.sub || claims.appid || claims.azp || 'unknown';
  return { claims, roles, principal };
}
