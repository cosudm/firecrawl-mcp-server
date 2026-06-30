// @ts-check
/**
 * Flow B — governance context, via Ethos (live, at resolution time) (§01).
 *
 * The volatile compliance context iOSLENS reads live and discards: the subject's
 * classification codes (CIP/SOC/NAICS), program detail, and enrollment status.
 * Because it is read at resolution time, "a student who drops a program this
 * morning is correctly un-scoped this afternoon."
 *
 * Crucially, the resolver keeps only the EVIDENCE POINTER each context read
 * returns — the Ethos URI + observed_at timestamp — never the record body (§03).
 *
 * Production wires `context()` to the Ellucian Ethos REST/OAuth2 APIs
 * (persons, students, academic-programs, sections — §06.5). The pilot ships an
 * in-memory fixture so Flow B runs offline.
 */

/**
 * @typedef {Object} GovernanceContext
 * @property {{ system: string, value: string }[]} codes  // resolved classification codes
 * @property {string} enrollmentStatus                     // active | dropped | graduated | none
 * @property {string} [programDetail]
 * @property {{ source: string, uri: string, observed_at: string }[]} evidence  // pointers, not bodies
 */

/**
 * @typedef {Object} ContextClient
 * @property {(subjectRef: string) => Promise<GovernanceContext>} context
 */

/**
 * In-memory Ethos fixture for the pilot.
 * @param {{ fixtures?: Record<string, Omit<GovernanceContext,'evidence'> & { evidence?: any[] }>, clock?: () => string }} [opts]
 * @returns {ContextClient}
 */
export function createMockEthos(opts = {}) {
  const clock = opts.clock ?? (() => new Date().toISOString());
  const fixtures = opts.fixtures ?? {
    'entra:obj:7c2a-nursing-e91': {
      codes: [{ system: 'CIP', value: '51.3801' }, { system: 'SOC', value: '29-1141' }, { system: 'NAICS', value: '622110' }],
      enrollmentStatus: 'active',
      programDetail: 'BSN — clinical rotation',
    },
    'entra:obj:3b11-cs-a42': {
      codes: [{ system: 'CIP', value: '11.0701' }],
      enrollmentStatus: 'active',
      programDetail: 'BS Computer Science',
    },
    'entra:obj:9f00-faculty-d27': {
      codes: [{ system: 'CIP', value: '51.3801' }, { system: 'SOC', value: '29-1141' }],
      enrollmentStatus: 'active',
      programDetail: 'Nursing faculty',
    },
  };
  return {
    async context(subjectRef) {
      const f = fixtures[subjectRef];
      if (!f) {
        return { codes: [], enrollmentStatus: 'none', evidence: [{ source: 'ethos', uri: `/persons/${encodeURIComponent(subjectRef)}`, observed_at: clock() }] };
      }
      // Each context read yields an evidence POINTER — uri + timestamp, never the body.
      const evidence = f.evidence ?? [{ source: 'ethos', uri: `/students/${encodeURIComponent(subjectRef)}`, observed_at: clock() }];
      return { codes: f.codes, enrollmentStatus: f.enrollmentStatus, programDetail: f.programDetail, evidence };
    },
  };
}

// ---------------------------------------------------------------------------
// Live Ellucian Ethos client (Flow B, production).
// ---------------------------------------------------------------------------

/**
 * A live Ethos client. Ethos is the single integration surface — cloud apps
 * reach Banner only through it (§01). The client authenticates with an Ethos API
 * key (exchanged for a short-lived bearer token), reads the subject's academic
 * programs live, maps them to CIP codes + enrollment status, and returns
 * evidence POINTERS (resource URIs + observed_at) — never the record bodies (§03).
 *
 * Egress-only: outbound HTTPS to the Ethos platform; nothing inbound. `fetchImpl`
 * and `resolvePersonId` are injectable so the mapping is fully testable offline.
 *
 * @param {{
 *   baseUrl: string,                 // e.g. https://integrate.elluciancloud.com
 *   apiKey?: string,                 // Ethos API key (exchanged at POST /auth)
 *   tokenProvider?: () => Promise<string>,  // overrides the apiKey exchange
 *   resolvePersonId?: (subjectRef: string) => Promise<string>|string, // Entra oid -> Ethos person GUID
 *   fetchImpl?: typeof fetch,
 *   clock?: () => string,
 *   mediaVersion?: number,           // EEDM media-type version (default 16)
 * }} opts
 * @returns {import('./ethos.mjs').ContextClient}
 */
export function createEthosClient(opts) {
  if (!opts?.baseUrl) throw new Error('createEthosClient requires baseUrl');
  const doFetch = opts.fetchImpl ?? fetch;
  const clock = opts.clock ?? (() => new Date().toISOString());
  const base = opts.baseUrl.replace(/\/+$/, '');
  const accept = `application/vnd.hedtech.integration.v${opts.mediaVersion ?? 16}+json`;
  // Default person-id mapping strips the entra pointer prefix; institutions with a
  // Banner-id <-> Ethos-GUID indirection inject their own resolver.
  const resolvePersonId = opts.resolvePersonId ?? ((ref) => String(ref).replace(/^entra:obj:/, ''));

  /** @type {{ token: string, expiresAt: number }|null} */ let cached = null;
  async function token() {
    if (opts.tokenProvider) return opts.tokenProvider();
    if (cached && Date.now() < cached.expiresAt) return cached.token;
    if (!opts.apiKey) throw new Error('Ethos client needs apiKey or tokenProvider');
    const res = await doFetch(`${base}/auth`, { method: 'POST', headers: { Authorization: `Bearer ${opts.apiKey}` } });
    if (!res.ok) throw new Error(`Ethos /auth failed: ${res.status}`);
    const tok = (await res.text()).trim();
    cached = { token: tok, expiresAt: Date.now() + 4 * 60 * 1000 }; // Ethos tokens ~5min; refresh at 4
    return tok;
  }

  async function getJson(path) {
    const res = await doFetch(`${base}${path}`, { headers: { Authorization: `Bearer ${await token()}`, Accept: accept } });
    if (!res.ok) throw new Error(`Ethos GET ${path} failed: ${res.status}`);
    return res.json();
  }

  return {
    async context(subjectRef) {
      const personId = await resolvePersonId(subjectRef);
      /** @type {{source:string,uri:string,observed_at:string}[]} */ const evidence = [];
      const stamp = (uri) => { evidence.push({ source: 'ethos', uri, observed_at: clock() }); };

      // 1. The subject's academic programs (EEDM student-academic-programs).
      const sapPath = `/api/student-academic-programs?criteria=${encodeURIComponent(JSON.stringify({ student: { id: personId } }))}`;
      let saps;
      try {
        saps = await getJson(sapPath);
        stamp(sapPath);
      } catch {
        // No program rows resolvable -> treat as un-enrolled, but still record the read.
        stamp(sapPath);
        return { codes: [], enrollmentStatus: 'none', evidence };
      }
      const rows = Array.isArray(saps) ? saps : [];
      // Prefer an active program; else the first row.
      const active = rows.find((r) => statusOf(r) === 'active') ?? rows[0];
      if (!active) return { codes: [], enrollmentStatus: 'none', evidence };

      const enrollmentStatus = statusOf(active);
      const programDetail = active.preferredName || active.program?.title || active.academicProgram?.title || undefined;

      // 2. The academic program -> CIP code (the identity-spine input for the Matrix).
      /** @type {{system:string,value:string}[]} */ const codes = [];
      const programId = active.program?.id || active.academicProgram?.id || active.academicPrograms?.[0]?.id;
      if (programId) {
        try {
          const prog = await getJson(`/api/academic-programs/${programId}`);
          stamp(`/api/academic-programs/${programId}`);
          const cip = prog.cip?.code || prog.cipCode || prog.cip?.value;
          if (cip) codes.push({ system: 'CIP', value: String(cip) });
        } catch {
          /* CIP unresolved — the Matrix can still semantic-fallback on program detail */
        }
      }
      return { codes, enrollmentStatus, programDetail, evidence };
    },
  };
}

/** Normalize an Ethos enrollment status onto the resolver's vocabulary. */
function statusOf(sap) {
  const raw = String(sap?.enrollmentStatus?.status || sap?.enrollmentStatus?.detail?.id || sap?.status || '').toLowerCase();
  if (raw.includes('active')) return 'active';
  if (raw.includes('complete') || raw.includes('graduat')) return 'graduated';
  if (raw.includes('inactive') || raw.includes('withdraw') || raw.includes('drop')) return 'dropped';
  return raw || 'none';
}
