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
