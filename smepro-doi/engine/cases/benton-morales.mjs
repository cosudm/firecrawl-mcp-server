// @ts-check
/**
 * Seed case: North 40 ac, J. Morales Survey A-112, Galveston County, TX.
 * Encodes the eight source instruments supplied for the title audit. This is the
 * golden fixture the test suite uses to prove the engine balances to 1.0 and
 * reproduces the analyst-approved decimals.
 */

/** @type {import('../schema.mjs').TitleProject} */
export const bentonMorales = {
  name: 'Benton / Morales — N. 40 ac, J. Morales Svy A-112',
  asOfDate: '2026-06-04',
  tract: {
    name: 'Tract 1 — North 40 ac, J. Morales Survey A-112',
    grossAcres: 40,
    legal: 'North 40.000 acres of the J. Morales Survey, A-112, Galveston County, Texas (orig. Vol. 842, Pg. 119, G.C.O.R.)',
    county: 'Galveston',
    state: 'TX',
  },
  rootOwner: 'benton-h',
  parties: [
    { id: 'benton-h', name: 'Harold J. Benton', type: 'individual' },
    { id: 'benton-m', name: 'Marlene S. Benton', type: 'individual' },
    { id: 'benton-jacob', name: 'Jacob Benton', type: 'individual' },
    { id: 'benton-emily', name: 'Emily Benton', type: 'individual' },
    { id: 'cypress', name: 'Cypress Ridge Holdings, LLC', type: 'entity' },
    { id: 'lonestar', name: 'Lone Star Royalty Partners, LP', type: 'entity' },
    { id: 'falcon', name: 'Falcon Exploration, LLC', type: 'entity' },
    { id: 'redriver', name: 'Red River Operating, LLC', type: 'entity' },
    { id: 'horizon', name: 'Horizon Minerals, LLC', type: 'entity' },
  ],
  documents: [
    {
      id: 'WD-2011',
      date: '2011-03-14',
      recording: 'Doc. No. 2011031457, G.C.O.R.',
      title: 'Warranty Deed — Benton → Cypress Ridge',
      kind: 'mineralConveyance',
      instrument: 'Warranty Deed',
      grantor: 'benton-h',
      grantee: 'cypress',
      conveyMineralFraction: '1', // conveys the whole tract; minerals follow, NPRI reserved
      exactLanguage:
        'Grantors reserve an undivided 1/4 (0.25) NPRI in all oil, gas, and other minerals for a term of 20 years and as long thereafter as production continues.',
      reservation: {
        id: 'NPRI-BENTON',
        quantum: '1/4',
        // Source language ("1/4 NPRI in all minerals") reads as fixed, but the DO
        // inputs say "25% of royalty". Fixed would exceed the 1/5 lease royalty and
        // is economically impossible, so we operate on the floating reading and flag.
        basis: 'floating',
        ambiguous: true,
        interpretationNote:
          'Deed language ("1/4 NPRI in all minerals") could be read as fixed 1/4 of 8/8; DO inputs say "25% of royalty". Floating used because fixed (0.25) exceeds the 0.20 lease royalty.',
        term: { years: 20, plusProduction: true },
        // Reserved by Harold & wife Marlene as community property → 1/2 each.
        owners: [
          { party: 'benton-h', share: '1/2' },
          { party: 'benton-m', share: '1/2' },
        ],
      },
    },
    {
      id: 'OGL-2013',
      date: '2013-06-01',
      recording: 'Doc. No. 2013060154, G.C.O.R.',
      title: 'Oil & Gas Lease — Cypress Ridge → Falcon',
      kind: 'oilGasLease',
      lessor: 'cypress',
      lessee: 'falcon',
      royalty: '1/5',
      primaryTermYears: 3,
      pughDepthNote:
        'Horizontal Pugh clause releases depths below 100′ beneath the deepest producing perforation (lease maintained to ~8,300′ given the 8,200′ deepest perf).',
      noDeductionsNote:
        'Modified no-deductions clause: post-production costs allowed once production is in marketable condition.',
    },
    {
      id: 'MD-2014',
      date: '2014-07-02',
      recording: 'Doc. No. 2014070291, G.C.O.R.',
      title: 'Mineral Deed — Cypress Ridge → Lone Star',
      kind: 'mineralConveyance',
      instrument: 'Mineral Deed',
      grantor: 'cypress',
      grantee: 'lonestar',
      conveyMineralFraction: '1/2', // undivided 50% of the tract minerals
      exactLanguage: 'Conveys an undivided 50% interest in the minerals; subject to the Benton NPRI and the 2013 Falcon lease.',
    },
    {
      id: 'ASG-2016',
      date: '2016-01-05',
      recording: 'Doc. No. 2016010512, G.C.O.R.',
      title: 'Assignment of OGL — Falcon → Red River',
      kind: 'assignment',
      assignor: 'falcon',
      assignee: 'redriver',
      wiFraction: '1',
      statedNri: '0.80', // recital — engine cross-checks against computed net WI NRI
      reservedOrri: { quantum: '0.04', owner: 'falcon' },
      recitedOrri: [
        { quantum: '0.01', owner: 'horizon', note: 'previously conveyed to Horizon Minerals' },
      ],
    },
    {
      id: 'AOH-2018',
      date: '2018-04-22',
      recording: 'Doc. No. 2018042219, G.C.O.R.',
      title: 'Affidavit of Heirship — Harold J. Benton',
      kind: 'affidavitOfHeirship',
      decedent: 'benton-h',
      dateOfDeath: '2017-10-22',
      affects: 'npri',
      npriId: 'NPRI-BENTON',
      communityProperty: true,
      survivingSpouse: 'benton-m',
      // Harold's 1/2 community share of the NPRI passes 1/3 spouse, 1/3 each child
      // (TX separate-personal-property intestacy). Marlene keeps her own 1/2.
      distributions: [
        { heir: 'benton-m', share: '1/3' },
        { heir: 'benton-jacob', share: '1/3' },
        { heir: 'benton-emily', share: '1/3' },
      ],
    },
    {
      id: 'ORRI-2020',
      date: '2020-09-14',
      title: 'ORRI Assignment — Falcon → Horizon',
      kind: 'orriAssignment',
      assignor: 'falcon',
      assignee: 'horizon',
      quantum: '0.01',
      note: 'Conveyance of the 1% ORRI recited as pre-existing in the 2016 assignment.',
    },
    {
      id: 'UNIT-2021',
      date: '2021-11-03',
      recording: 'Doc. No. 2021110308, G.C.O.R.',
      title: 'Designation of Horizontal Unit — Morales Unit',
      kind: 'unitDesignation',
      unitName: 'Morales Unit',
      unitAcres: 320,
      tractAcres: 40,
      otherTracts: [
        { name: 'Tract 2', acres: 120 },
        { name: 'Tract 3', acres: 160 },
      ],
    },
    {
      id: 'COMP-2022',
      date: '2022-02-18',
      title: 'Completion Report — Morales Unit #1H',
      kind: 'completionReport',
      well: 'Morales Unit #1H',
      intervalTopFt: 7800,
      intervalBottomFt: 8200,
    },
  ],
};

export default bentonMorales;
