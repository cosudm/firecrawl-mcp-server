// @ts-check
/**
 * Title Project schema — the typed domain model.
 *
 * This is the contract that document extraction writes to, the calc engine
 * validates and folds, and the UI renders. Keeping one authoritative shape is
 * what lets a non-expert front end stay honest: every decimal on screen is
 * traceable back to one of these instruments.
 *
 * Interests are expressed with whatever notation a deed actually uses
 * ("1/4", "0.25", "3/16") and parsed exactly by Fraction.from at fold time.
 */

/**
 * @typedef {'individual'|'entity'} PartyType
 * @typedef {{ id: string, name: string, type: PartyType }} Party
 */

/**
 * @typedef {Object} Tract
 * @property {string} name
 * @property {number} grossAcres
 * @property {string} legal      Full legal description.
 * @property {string} [county]
 * @property {string} [state]
 */

/**
 * A royalty interest reserved out of the mineral estate (Non-Participating
 * Royalty Interest). `basis` is the crux of most NPRI disputes:
 *  - 'fixed'    => holder gets `quantum` of gross 8/8 production, regardless of
 *                  the lease royalty (a "1/4 royalty").
 *  - 'floating' => holder gets `quantum` OF the lease royalty (a "1/4 OF royalty").
 * When the source language is ambiguous, set `ambiguous: true` and record the
 * `interpretationNote`; the curative engine will surface both readings.
 *
 * @typedef {Object} NpriReservation
 * @property {string} id
 * @property {string|number} quantum            e.g. "1/4"
 * @property {'fixed'|'floating'} basis
 * @property {boolean} [ambiguous]
 * @property {string} [interpretationNote]
 * @property {string|number} [appliesToMineralFraction]  Default "1" (whole tract).
 * @property {{ years: number, plusProduction: boolean }} [term]  Term reservation.
 * @property {Array<{ party: string, share: string|number }>} owners  Shares of THIS npri, sum to 1.
 */

/**
 * @typedef {Object} DocBase
 * @property {string} id
 * @property {string} date           ISO yyyy-mm-dd (execution or recording).
 * @property {string} [recording]    Instrument / document number.
 * @property {string} [title]        Human label for the run sheet.
 */

/**
 * Mineral / Warranty / Royalty deed conveying a participating mineral interest.
 * @typedef {DocBase & {
 *   kind: 'mineralConveyance',
 *   instrument: string,
 *   grantor: string,
 *   grantee: string,
 *   conveyMineralFraction: string|number,   Absolute fraction of the tract minerals conveyed.
 *   reservation?: NpriReservation,
 *   exactLanguage?: string
 * }} MineralConveyance
 */

/**
 * @typedef {DocBase & {
 *   kind: 'oilGasLease',
 *   lessor: string,
 *   lessee: string,
 *   royalty: string|number,
 *   primaryTermYears?: number,
 *   pughDepthNote?: string,
 *   noDeductionsNote?: string,
 *   exactLanguage?: string
 * }} OilGasLease
 */

/**
 * Assignment of the leasehold / working interest. May reserve an ORRI and may
 * recite ORRIs said to be already outstanding (which we cross-check).
 * @typedef {DocBase & {
 *   kind: 'assignment',
 *   assignor: string,
 *   assignee: string,
 *   wiFraction?: string|number,                 Absolute fraction of WI assigned (default all).
 *   statedNri?: string|number,                  NRI recited in the instrument (for cross-check).
 *   reservedOrri?: { quantum: string|number, owner: string },
 *   recitedOrri?: Array<{ quantum: string|number, owner: string, note?: string }>
 * }} Assignment
 */

/**
 * Stand-alone ORRI conveyance (carved from the leasehold/WI).
 * @typedef {DocBase & {
 *   kind: 'orriAssignment',
 *   assignor: string,
 *   assignee: string,
 *   quantum: string|number,
 *   note?: string
 * }} OrriAssignment
 */

/**
 * Affidavit of Heirship / probate distributing a decedent's interest.
 * @typedef {DocBase & {
 *   kind: 'affidavitOfHeirship',
 *   decedent: string,
 *   dateOfDeath?: string,
 *   affects: 'npri'|'mineral',
 *   npriId?: string,
 *   communityProperty?: boolean,
 *   survivingSpouse?: string,
 *   distributions: Array<{ heir: string, share: string|number }>  Shares of decedent's interest, sum to 1.
 * }} AffidavitOfHeirship
 */

/**
 * @typedef {DocBase & {
 *   kind: 'unitDesignation',
 *   unitName: string,
 *   unitAcres: number,
 *   tractAcres: number,
 *   otherTracts?: Array<{ name: string, acres: number }>
 * }} UnitDesignation
 */

/**
 * @typedef {DocBase & {
 *   kind: 'completionReport',
 *   well: string,
 *   intervalTopFt?: number,
 *   intervalBottomFt?: number
 * }} CompletionReport
 */

/**
 * @typedef {MineralConveyance|OilGasLease|Assignment|OrriAssignment|AffidavitOfHeirship|UnitDesignation|CompletionReport} TitleDocument
 */

/**
 * @typedef {Object} TitleProject
 * @property {string} name
 * @property {Tract} tract
 * @property {string} rootOwner            Party id that holds 100% of minerals at time zero.
 * @property {Party[]} parties
 * @property {TitleDocument[]} documents   Will be processed in chronological order.
 * @property {string} [asOfDate]
 */

/** Document kinds, exported for UI menus / validation. */
export const DOC_KINDS = /** @type {const} */ ([
  'mineralConveyance',
  'oilGasLease',
  'assignment',
  'orriAssignment',
  'affidavitOfHeirship',
  'unitDesignation',
  'completionReport',
]);

/**
 * Lightweight structural validation. Returns a list of human-readable problems;
 * empty array means the project is well-formed enough to fold.
 * @param {TitleProject} project
 * @returns {string[]}
 */
export function validateProject(project) {
  /** @type {string[]} */
  const errors = [];
  if (!project.tract) errors.push('Project is missing a tract.');
  const ids = new Set((project.parties || []).map((p) => p.id));
  if (!ids.has(project.rootOwner)) errors.push(`rootOwner "${project.rootOwner}" is not a declared party.`);

  const ref = (/** @type {string|undefined} */ id, /** @type {string} */ where) => {
    if (id && !ids.has(id)) errors.push(`Unknown party "${id}" referenced in ${where}.`);
  };

  for (const d of project.documents || []) {
    if (!DOC_KINDS.includes(/** @type {any} */ (d.kind))) {
      errors.push(`Document ${d.id}: unknown kind "${d.kind}".`);
      continue;
    }
    switch (d.kind) {
      case 'mineralConveyance':
        ref(d.grantor, `${d.id}.grantor`);
        ref(d.grantee, `${d.id}.grantee`);
        (d.reservation?.owners || []).forEach((o) => ref(o.party, `${d.id}.reservation.owners`));
        break;
      case 'oilGasLease':
        ref(d.lessor, `${d.id}.lessor`);
        ref(d.lessee, `${d.id}.lessee`);
        break;
      case 'assignment':
        ref(d.assignor, `${d.id}.assignor`);
        ref(d.assignee, `${d.id}.assignee`);
        if (d.reservedOrri) ref(d.reservedOrri.owner, `${d.id}.reservedOrri.owner`);
        (d.recitedOrri || []).forEach((o) => ref(o.owner, `${d.id}.recitedOrri`));
        break;
      case 'orriAssignment':
        ref(d.assignor, `${d.id}.assignor`);
        ref(d.assignee, `${d.id}.assignee`);
        break;
      case 'affidavitOfHeirship':
        ref(d.decedent, `${d.id}.decedent`);
        if (d.survivingSpouse) ref(d.survivingSpouse, `${d.id}.survivingSpouse`);
        d.distributions.forEach((dist) => ref(dist.heir, `${d.id}.distributions`));
        break;
      default:
        break;
    }
  }
  return errors;
}
