// @ts-check
/**
 * Seed content for the Compliance Decoding Matrix (§04).
 *
 * Ten regimes are seeded (FERPA, GLBA, HIPAA, SACSCOC, THECB, TAC §202, ABET,
 * AACSB, NC-SARA, CLERY). The education core — FERPA, THECB, SACSCOC — is marked
 * `active` for the pilot (§04, "Pilot regime scope"); the rest are seeded and
 * available as the pilot expands.
 *
 * This is illustrative pilot content. In production, SMEPro authors and
 * version-controls the Matrix content and deploys it as a versioned release
 * (§04, "Population & currency"); this module is the v1 release payload.
 *
 * The dataset deliberately reproduces the worked example from §03/§04:
 *   CIP 51.3801 → SOC 29-1141 → NAICS 622110, and
 *   SOC 29-1141 + NAICS 622110 + HIPAA → nursing.clinical scope.
 */

/** @typedef {{ id: string, code: string, name: string, citation_root: string, active: boolean }} Regime */
/** @typedef {{ id: string, regime_id: string, name: string, citation: string, rule_text: string }} Obligation */
/** @typedef {{ id: string, system: string, value: string, title: string }} Code */
/** @typedef {{ id: string, from_code_id: string, to_code_id: string, relation: string }} Crosswalk */
/** @typedef {{ id: string, code_id: string, regime_id: string, obligation_id: string, scope: string }} CodeObligation */

/** @type {Regime[]} */
export const regimes = [
  { id: 'reg_ferpa',   code: 'FERPA',   name: 'Family Educational Rights and Privacy Act', citation_root: '20 U.S.C. 1232g',  active: true },
  { id: 'reg_thecb',   code: 'THECB',   name: 'Texas Higher Education Coordinating Board',  citation_root: 'Tex. Educ. Code 61', active: true },
  { id: 'reg_sacscoc', code: 'SACSCOC', name: 'Southern Assoc. of Colleges and Schools COC', citation_root: 'SACSCOC Principles', active: true },
  { id: 'reg_hipaa',   code: 'HIPAA',   name: 'Health Insurance Portability and Accountability Act', citation_root: '45 CFR 160-164', active: false },
  { id: 'reg_glba',    code: 'GLBA',    name: 'Gramm-Leach-Bliley Act',                     citation_root: '15 U.S.C. 6801',   active: false },
  { id: 'reg_tac202',  code: 'TAC202',  name: 'Texas Administrative Code §202 (Information Security)', citation_root: '1 TAC §202', active: false },
  { id: 'reg_abet',    code: 'ABET',    name: 'Accreditation Board for Engineering and Technology', citation_root: 'ABET Criteria', active: false },
  { id: 'reg_aacsb',   code: 'AACSB',   name: 'Assoc. to Advance Collegiate Schools of Business', citation_root: 'AACSB Standards', active: false },
  { id: 'reg_ncsara',  code: 'NC-SARA', name: 'National Council for State Authorization Reciprocity', citation_root: 'NC-SARA Manual', active: false },
  { id: 'reg_clery',   code: 'CLERY',   name: 'Jeanne Clery Disclosure Act',               citation_root: '20 U.S.C. 1092(f)', active: false },
];

/** @type {Obligation[]} */
export const obligations = [
  // FERPA (active)
  { id: 'ob_ferpa_consent',   regime_id: 'reg_ferpa',   name: 'Prior Consent to Disclose',  citation: '34 CFR 99.30', rule_text: 'A student\'s education records may not be disclosed without prior written consent, except under enumerated exceptions.' },
  { id: 'ob_ferpa_directory', regime_id: 'reg_ferpa',   name: 'Directory Information',       citation: '34 CFR 99.37', rule_text: 'Directory information may be disclosed without consent only if the student has not opted out.' },
  // THECB (active)
  { id: 'ob_thecb_cip',       regime_id: 'reg_thecb',   name: 'CIP Program Reporting',       citation: '19 TAC §13.42', rule_text: 'Institutions report program inventory by CIP code to the Coordinating Board.' },
  { id: 'ob_thecb_60x30',     regime_id: 'reg_thecb',   name: '60x30TX Completion Reporting', citation: 'Tex. Educ. Code 61.0512', rule_text: 'Completion and credential outcomes are reported under the 60x30TX strategic plan.' },
  // SACSCOC (active)
  { id: 'ob_sacscoc_ie',      regime_id: 'reg_sacscoc', name: 'Institutional Effectiveness', citation: 'SACSCOC 8.2', rule_text: 'The institution identifies outcomes, assesses achievement, and uses results for improvement.' },
  { id: 'ob_sacscoc_qep',     regime_id: 'reg_sacscoc', name: 'Quality Enhancement Plan',    citation: 'SACSCOC 7.2', rule_text: 'A QEP addresses a topic important to improving student learning.' },
  // HIPAA (seeded)
  { id: 'ob_hipaa_privacy',   regime_id: 'reg_hipaa',   name: 'Privacy Rule',               citation: '45 CFR 164.500', rule_text: 'Protected health information may be used or disclosed only as the Privacy Rule permits.' },
  { id: 'ob_hipaa_security',  regime_id: 'reg_hipaa',   name: 'Security Rule',              citation: '45 CFR 164.300', rule_text: 'Administrative, physical, and technical safeguards protect electronic PHI.' },
  // GLBA (seeded)
  { id: 'ob_glba_safeguards', regime_id: 'reg_glba',    name: 'Safeguards Rule',           citation: '16 CFR 314', rule_text: 'Maintain a comprehensive information security program for customer financial information.' },
  // TAC §202 (seeded)
  { id: 'ob_tac202_controls', regime_id: 'reg_tac202',  name: 'Security Control Standards', citation: '1 TAC §202.76', rule_text: 'State institutions implement a security control standards catalog.' },
  // ABET (seeded)
  { id: 'ob_abet_outcomes',   regime_id: 'reg_abet',    name: 'Student Outcomes',          citation: 'ABET Criterion 3', rule_text: 'Programs assess and document attainment of student outcomes.' },
  // AACSB (seeded)
  { id: 'ob_aacsb_aol',       regime_id: 'reg_aacsb',   name: 'Assurance of Learning',     citation: 'AACSB Std 5', rule_text: 'Curricula management and assurance-of-learning processes demonstrate learning outcomes.' },
  // NC-SARA (seeded)
  { id: 'ob_ncsara_auth',     regime_id: 'reg_ncsara',  name: 'State Authorization',       citation: 'NC-SARA §3', rule_text: 'Distance education across state lines operates under reciprocity authorization.' },
  // CLERY (seeded)
  { id: 'ob_clery_asr',       regime_id: 'reg_clery',   name: 'Annual Security Report',    citation: '20 U.S.C. 1092(f)', rule_text: 'Institutions publish an annual security report and crime statistics.' },
];

/** @type {Code[]} */
export const codes = [
  // Nursing spine (the worked example)
  { id: 'code_cip_513801',  system: 'CIP',   value: '51.3801', title: 'Registered Nursing/Registered Nurse' },
  { id: 'code_soc_291141',  system: 'SOC',   value: '29-1141', title: 'Registered Nurses' },
  { id: 'code_naics_622110', system: 'NAICS', value: '622110', title: 'General Medical and Surgical Hospitals' },
  { id: 'code_sic_8062',    system: 'SIC',   value: '8062',    title: 'General Medical & Surgical Hospitals' },
  // Computer science spine
  { id: 'code_cip_110701',  system: 'CIP',   value: '11.0701', title: 'Computer Science' },
  { id: 'code_soc_151252',  system: 'SOC',   value: '15-1252', title: 'Software Developers' },
  { id: 'code_naics_511210', system: 'NAICS', value: '511210', title: 'Software Publishers' },
  // Business spine
  { id: 'code_cip_520201',  system: 'CIP',   value: '52.0201', title: 'Business Administration and Management' },
  { id: 'code_soc_113021',  system: 'SOC',   value: '11-3021', title: 'Computer and Information Systems Managers' },
];

/** @type {Crosswalk[]} */
export const crosswalks = [
  { id: 'xw_cip513801_soc291141',  from_code_id: 'code_cip_513801',  to_code_id: 'code_soc_291141',  relation: 'maps_to' },
  { id: 'xw_soc291141_naics622110', from_code_id: 'code_soc_291141',  to_code_id: 'code_naics_622110', relation: 'maps_to' },
  { id: 'xw_naics622110_sic8062',  from_code_id: 'code_naics_622110', to_code_id: 'code_sic_8062',     relation: 'maps_to' },
  { id: 'xw_cip110701_soc151252',  from_code_id: 'code_cip_110701',  to_code_id: 'code_soc_151252',  relation: 'maps_to' },
  { id: 'xw_soc151252_naics511210', from_code_id: 'code_soc_151252',  to_code_id: 'code_naics_511210', relation: 'maps_to' },
  { id: 'xw_cip520201_soc113021',  from_code_id: 'code_cip_520201',  to_code_id: 'code_soc_113021',  relation: 'maps_to' },
];

/** @type {CodeObligation[]} */
export const codeObligations = [
  // Nursing — clinical (HIPAA) — the §03 worked example
  { id: 'co_soc291141_hipaa_priv', code_id: 'code_soc_291141',  regime_id: 'reg_hipaa',   obligation_id: 'ob_hipaa_privacy',  scope: 'nursing.clinical' },
  { id: 'co_soc291141_hipaa_sec',  code_id: 'code_soc_291141',  regime_id: 'reg_hipaa',   obligation_id: 'ob_hipaa_security', scope: 'nursing.clinical' },
  { id: 'co_naics622110_hipaa_priv', code_id: 'code_naics_622110', regime_id: 'reg_hipaa', obligation_id: 'ob_hipaa_privacy', scope: 'nursing.clinical' },
  // Nursing — academic (active pilot regimes)
  { id: 'co_cip513801_ferpa',  code_id: 'code_cip_513801', regime_id: 'reg_ferpa',   obligation_id: 'ob_ferpa_consent', scope: 'nursing.academic' },
  { id: 'co_cip513801_thecb',  code_id: 'code_cip_513801', regime_id: 'reg_thecb',   obligation_id: 'ob_thecb_cip',     scope: 'nursing.academic' },
  { id: 'co_cip513801_sacscoc', code_id: 'code_cip_513801', regime_id: 'reg_sacscoc', obligation_id: 'ob_sacscoc_ie',   scope: 'nursing.academic' },
  // Computer science — academic
  { id: 'co_cip110701_ferpa',  code_id: 'code_cip_110701', regime_id: 'reg_ferpa',   obligation_id: 'ob_ferpa_consent', scope: 'cs.academic' },
  { id: 'co_cip110701_abet',   code_id: 'code_cip_110701', regime_id: 'reg_abet',    obligation_id: 'ob_abet_outcomes', scope: 'cs.academic' },
  { id: 'co_cip110701_thecb',  code_id: 'code_cip_110701', regime_id: 'reg_thecb',   obligation_id: 'ob_thecb_cip',     scope: 'cs.academic' },
  // Business — academic
  { id: 'co_cip520201_aacsb',  code_id: 'code_cip_520201', regime_id: 'reg_aacsb',   obligation_id: 'ob_aacsb_aol',     scope: 'business.academic' },
  { id: 'co_cip520201_ferpa',  code_id: 'code_cip_520201', regime_id: 'reg_ferpa',   obligation_id: 'ob_ferpa_consent', scope: 'business.academic' },
];

/**
 * The complete v1 Matrix release payload.
 * @returns {{ regimes: Regime[], obligations: Obligation[], codes: Code[], crosswalks: Crosswalk[], codeObligations: CodeObligation[] }}
 */
export function seedData() {
  return { regimes, obligations, codes, crosswalks, codeObligations };
}
