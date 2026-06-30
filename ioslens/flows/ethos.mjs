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
