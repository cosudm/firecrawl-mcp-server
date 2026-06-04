// @ts-check
/**
 * Raw source text fixture — the eight Benton/Morales instruments as a title
 * abstractor would paste them (OCR'd deeds, run-sheet notes). Used to exercise
 * the heuristic extractor end-to-end in the test suite and to prefill the
 * Intake screen for the demo.
 */
export const bentonMoralesSource = `WARRANTY DEED
Date: March 14, 2011
Grantor: Harold J. Benton and wife, Marlene S. Benton
Grantee: Cypress Ridge Holdings, LLC
Legal Description: Tract 1: 40.000 acres, more or less, being the North 40 acres of the J. Morales Survey, A-112, Galveston County, Texas, described in a deed recorded in Vol. 842, Pg. 119, G.C.O.R.
Reservations: Grantors reserve an undivided 1/4 (0.25) NPRI in all oil, gas, and other minerals for a term of 20 years and as long thereafter as production continues.
Consideration: $210,000
Recording: Doc. No. 2011031457, Galveston County Official Records

OIL AND GAS LEASE
Date: June 1, 2013
Lessor: Cypress Ridge Holdings, LLC
Lessee: Falcon Exploration, LLC
Royalty: 1/5 (0.20)
Primary Term: 3 years
Horizontal Pugh Clause: Releases depths below 100' below deepest producing perforation.
Continuous Development: 120-day gap.
No-Deductions clause (modified: allows post-production costs after marketable condition).
Recording: Doc. No. 2013060154, G.C.O.R.

MINERAL DEED
Date: July 2, 2014
Grantor: Cypress Ridge Holdings, LLC
Grantee: Lone Star Royalty Partners, LP
Conveyance: Grantor conveys an undivided 50% interest in the minerals in and under 40.000 acres, J. Morales Survey, A-112, Galveston County, Texas.
Subject to: Existing NPRI of 0.25 reserved by Benton family; existing oil & gas lease dated 06/01/2013 to Falcon Exploration, LLC.
Recording: Doc. No. 2014070291, G.C.O.R.

ASSIGNMENT OF OIL & GAS LEASE
Date: January 5, 2016
Assignor: Falcon Exploration, LLC
Assignee: Red River Operating, LLC
Interest Assigned: 100% WI / 80% NRI.
Subject to 4% ORRI retained by Assignor.
Subject to 1% ORRI previously conveyed to Horizon Minerals, LLC.
Recording: Doc. No. 2016010512, G.C.O.R.

AFFIDAVIT OF HEIRSHIP
Date: April 22, 2018
Decedent: Harold J. Benton
Date of Death: October 22, 2017
Heirs:
Marlene S. Benton (surviving spouse) — 1/2 community + 1/3 separate
Jacob Benton (son) — 1/3 separate
Emily Benton (daughter) — 1/3 separate
Property Affected: 0.25 NPRI reserved in 2011 Warranty Deed.
Recording: Doc. No. 2018042219, G.C.O.R.

ASSIGNMENT OF OVERRIDING ROYALTY
Date: September 14, 2020
Assignor: Falcon Exploration, LLC
Assignee: Horizon Minerals, LLC
Interest: 1% ORRI.

DESIGNATION OF HORIZONTAL UNIT
Date: November 3, 2021
Operator: Red River Operating, LLC
Unit Name: Morales Unit
Acreage: 320.00 acres
Tracts: Tract 1 — 40 acres (subject tract); Tract 2 — 120 acres; Tract 3 — 160 acres.
Recording: Doc. No. 2021110308, G.C.O.R.

COMPLETION REPORT
Date: February 18, 2022
Well: Morales Unit #1H
Producing from 7,800-8,200 ft.`;

export default bentonMoralesSource;
