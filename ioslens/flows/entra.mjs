// @ts-check
/**
 * Flow A — identity, via Entra Connect (slow-changing) (§01).
 *
 * The lean identity facts needed to resolve a caller: the Entra object id (the
 * pointer that becomes `subject_ref`), plus the slow-changing role/department/
 * program tag synced from Banner→AD→Entra. iOSLENS reads identity here; it never
 * persists the attributes, only the object-id pointer.
 *
 * Production wires `resolve()` to Microsoft Graph (or trusts the validated JWT's
 * claims). The pilot ships an in-memory directory so the platform runs offline.
 */

/**
 * @typedef {Object} Identity
 * @property {string} subjectRef           // entra:obj:... — the persisted pointer
 * @property {string} [role]               // slow-changing directory facts (transient)
 * @property {string} [department]
 * @property {string} [programTag]
 */

/**
 * @typedef {Object} IdentityClient
 * @property {(subjectRef: string) => Promise<Identity|undefined>} resolve
 */

/**
 * In-memory identity directory for the pilot.
 * @param {{ directory?: Record<string, Omit<Identity,'subjectRef'>> }} [opts]
 * @returns {IdentityClient}
 */
export function createMockEntra(opts = {}) {
  const directory = opts.directory ?? {
    'entra:obj:7c2a-nursing-e91': { role: 'student', department: 'Nursing', programTag: 'BSN' },
    'entra:obj:3b11-cs-a42': { role: 'student', department: 'ComputerScience', programTag: 'BS-CS' },
    'entra:obj:9f00-faculty-d27': { role: 'faculty', department: 'Nursing', programTag: 'FAC' },
  };
  return {
    async resolve(subjectRef) {
      const attrs = directory[subjectRef];
      return attrs ? { subjectRef, ...attrs } : undefined;
    },
  };
}

/**
 * Identity from an already-validated JWT — the production-lean path. Entra has
 * already authenticated the caller (Layer 1); the `oid`/`sub` claim is the
 * pointer and role claims are the slow-changing facts, so no extra Graph call is
 * needed.
 * @param {{ oid?: string, sub?: string, roles?: string[], dept?: string, programTag?: string }} claims
 * @returns {IdentityClient}
 */
export function createClaimsEntra(claims) {
  const subjectRef = `entra:obj:${claims.oid ?? claims.sub}`;
  return {
    async resolve(ref) {
      if (ref && ref !== subjectRef) return undefined;
      return { subjectRef, role: claims.roles?.[0], department: claims.dept, programTag: claims.programTag };
    },
  };
}

// ---------------------------------------------------------------------------
// Live Entra identity via Microsoft Graph (production).
// ---------------------------------------------------------------------------

/**
 * Client-credentials token provider for app-only Microsoft Graph / Ethos calls.
 * Holds the App Registration's client id + secret (kept in Key Vault, never in
 * code — §02), exchanges them at the Entra token endpoint, and caches the token
 * until shortly before expiry. Egress-only (outbound 443).
 *
 * @param {{ tenant: string, clientId: string, clientSecret: string, scope?: string, fetchImpl?: typeof fetch }} opts
 * @returns {() => Promise<string>}
 */
export function createEntraAppTokenProvider(opts) {
  const doFetch = opts.fetchImpl ?? fetch;
  const scope = opts.scope ?? 'https://graph.microsoft.com/.default';
  const url = `https://login.microsoftonline.com/${opts.tenant}/oauth2/v2.0/token`;
  /** @type {{ token: string, expiresAt: number }|null} */ let cached = null;
  return async () => {
    if (cached && Date.now() < cached.expiresAt) return cached.token;
    const body = new URLSearchParams({ client_id: opts.clientId, client_secret: opts.clientSecret, grant_type: 'client_credentials', scope });
    const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) throw new Error(`Entra token request failed: ${res.status}`);
    const json = await res.json();
    cached = { token: json.access_token, expiresAt: Date.now() + Math.max(60, (json.expires_in ?? 3600) - 60) * 1000 };
    return cached.token;
  };
}

/**
 * Live identity client backed by Microsoft Graph. Resolves any subject pointer
 * (`entra:obj:<oid>`) to the lean, slow-changing directory facts (§01, Flow A).
 * Only the object-id pointer is ever persisted downstream; the attributes
 * returned here are transient inputs to the decision.
 *
 * @param {{ tokenProvider: () => Promise<string>, fetchImpl?: typeof fetch, select?: string, graphBase?: string }} opts
 * @returns {IdentityClient}
 */
export function createGraphEntra(opts) {
  const doFetch = opts.fetchImpl ?? fetch;
  const graphBase = (opts.graphBase ?? 'https://graph.microsoft.com/v1.0').replace(/\/+$/, '');
  const select = opts.select ?? 'id,jobTitle,department';
  return {
    async resolve(subjectRef) {
      const oid = String(subjectRef).replace(/^entra:obj:/, '');
      const res = await doFetch(`${graphBase}/users/${encodeURIComponent(oid)}?$select=${encodeURIComponent(select)}`, {
        headers: { Authorization: `Bearer ${await opts.tokenProvider()}`, Accept: 'application/json' },
      });
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`Graph /users failed: ${res.status}`);
      const u = await res.json();
      return { subjectRef, role: u.jobTitle || undefined, department: u.department || undefined, programTag: undefined };
    },
  };
}
