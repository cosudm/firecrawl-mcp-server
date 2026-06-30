// @ts-check
/**
 * Seed data for the IOS+ Management Console MVP.
 *
 * Compliance rows are drawn from the real ENERGY sheet of the Universal Compliance
 * Decoding Matrix. The DOI deck is NOT mocked — it is computed by the actual
 * smepro-doi engine from the Benton/Morales golden fixture, then serialized, so the
 * console shows decimals that close to exactly 1.00000000.
 */
import { analyzeTitleProject } from '../../smepro-doi/engine/engine.mjs';
import { bentonMorales } from '../../smepro-doi/engine/cases/benton-morales.mjs';
import { serializeDeck } from '../../smepro-doi/integration/serialize.mjs';

const now = '2026-06-30T00:00:00.000Z';

/** Build the seeded DOI project + deck + curative from the engine (real math). */
function seedDoiProject() {
  const analysis = analyzeTitleProject(bentonMorales);
  const deck = serializeDeck(analysis, bentonMorales, { basis: 'tract' });
  const curative = (analysis.curative || []).map((c, i) => ({
    id: `cur-${i + 1}`,
    code: c.code,
    severity: c.severity,
    title: c.title,
    detail: c.detail,
    status: 'open',
    resolved_by: null,
    resolved_at: null,
  }));
  return {
    id: 'proj-benton-morales',
    operator_id: 'op1',
    name: bentonMorales.name,
    unit_id: 'unit-galv-a112',
    tract: bentonMorales.tract,
    basis: deck.basis,
    rows: deck.rows,
    summary: deck.summary,
    total_nri: deck.totalNri,
    balances: deck.balances,
    approved_by: null,
    approved_at: null,
    created_at: now,
    project: bentonMorales, // source of truth, re-analyzable
    curative,
  };
}

/** @returns {import('./store.mjs').ConsoleState} */
export function buildSeed() {
  const obligations = [
    {
      id: 'ob-epa-spcc', operator_id: 'op1', sheet_code: '01 – ENERGY',
      broad_industry: 'ENERGY', industry_subtype: 'Oil & Gas – Drilling & Exploration',
      specific_activity: 'Spill Prevention (SPCC) Plan', jurisdiction_level: 'Federal',
      governing_agency: 'EPA', regulation_name: 'Clean Water Act §311; Oil Pollution Act',
      cfr_citation: '40 CFR Part 112', report_form_name: 'Spill Prevention Control & Countermeasure Plan',
      form_code: 'SPCC Plan (PE-certified)', filing_frequency: 'Updated every 5 years',
      key_due_dates: 'Amendment within 6 months of facility change',
      penalties: 'Up to $54,833/day per violation', risk_tier: 'CRITICAL', risk_weight: 9,
      policy_action: 'BLOCK', responsible_role: 'EHS Manager',
      regulatory_url: 'https://www.ecfr.gov/current/title-40/chapter-I/subchapter-D/part-112',
      firecrawl_monitor_id: 'mon_epa_spcc', compliance_status: 'Pending Review',
      last_verified_at: '2026-06-20T00:00:00.000Z',
    },
    {
      id: 'ob-epa-ghg', operator_id: 'op1', sheet_code: '01 – ENERGY',
      broad_industry: 'ENERGY', industry_subtype: 'Oil & Gas – Drilling & Exploration',
      specific_activity: 'GHG Emissions Reporting – Upstream', jurisdiction_level: 'Federal',
      governing_agency: 'EPA', regulation_name: 'Clean Air Act §114; Mandatory GHG Reporting',
      cfr_citation: '40 CFR Part 98, Subpart W', report_form_name: 'Greenhouse Gas Report – Petroleum & Natural Gas',
      form_code: 'EPA e-GGRT submission', filing_frequency: 'Annual',
      key_due_dates: 'March 31 (prior year data)', penalties: '$51,796/day per violation (CAA)',
      risk_tier: 'HIGH', risk_weight: 7, policy_action: 'REVIEW', responsible_role: 'Environmental / Sustainability',
      regulatory_url: 'https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-98/subpart-W',
      firecrawl_monitor_id: 'mon_epa_ghg', compliance_status: 'Current',
      last_verified_at: '2026-06-28T00:00:00.000Z',
    },
    {
      id: 'ob-bsee-apd', operator_id: 'op1', sheet_code: '01 – ENERGY',
      broad_industry: 'ENERGY', industry_subtype: 'Oil & Gas – Drilling & Exploration',
      specific_activity: 'Offshore Drilling Plan Submission', jurisdiction_level: 'Federal',
      governing_agency: 'BSEE / BOEM', regulation_name: 'Outer Continental Shelf Lands Act Regulations',
      cfr_citation: '30 CFR 250', report_form_name: 'Application for Permit to Drill',
      form_code: 'APD (Form BSEE-0123)', filing_frequency: 'Per Well',
      key_due_dates: 'Before spud; min 30 days prior', penalties: 'Shut-in; civil penalty up to $40,000/day',
      risk_tier: 'CRITICAL', risk_weight: 8, policy_action: 'BLOCK', responsible_role: 'VP Operations',
      regulatory_url: 'https://www.ecfr.gov/current/title-30/chapter-II/subchapter-B/part-250',
      firecrawl_monitor_id: 'mon_bsee_apd', compliance_status: 'Current',
      last_verified_at: '2026-06-29T00:00:00.000Z',
    },
    {
      id: 'ob-osha-psm', operator_id: 'op1', sheet_code: '01 – ENERGY',
      broad_industry: 'ENERGY', industry_subtype: 'Oil & Gas – Drilling & Exploration',
      specific_activity: 'OSHA Process Safety Management', jurisdiction_level: 'Federal',
      governing_agency: 'OSHA', regulation_name: 'OSH Act; 29 CFR 1910.119',
      cfr_citation: '29 CFR 1910.119', report_form_name: 'Process Hazard Analysis (PHA)',
      form_code: 'PHA Documentation', filing_frequency: 'Every 5 years revalidation',
      key_due_dates: 'Ongoing; PHA every 5 yrs', penalties: '$15,625/day per willful violation',
      risk_tier: 'HIGH', risk_weight: 7, policy_action: 'REVIEW', responsible_role: 'Legal / Compliance',
      regulatory_url: 'https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-H/section-1910.119',
      firecrawl_monitor_id: 'mon_osha_psm', compliance_status: 'Current',
      last_verified_at: '2026-06-27T00:00:00.000Z',
    },
    {
      id: 'ob-ferc-rate', operator_id: 'op1', sheet_code: '01 – ENERGY',
      broad_industry: 'ENERGY', industry_subtype: 'Oil & Gas – Midstream / Pipeline',
      specific_activity: 'Interstate Pipeline Rate Filing', jurisdiction_level: 'Federal',
      governing_agency: 'FERC', regulation_name: 'Natural Gas Act §4; 18 CFR Part 154',
      cfr_citation: '18 CFR Part 154', report_form_name: 'Tariff / Rate Schedule Filing',
      form_code: 'eTariff', filing_frequency: 'Per Rate Change',
      key_due_dates: '30–60 days before effective date', penalties: 'Rate rejection; refunds',
      risk_tier: 'MEDIUM', risk_weight: 5, policy_action: 'WARN', responsible_role: 'Regulatory Affairs',
      regulatory_url: 'https://www.ecfr.gov/current/title-18/chapter-I/subchapter-E/part-154',
      firecrawl_monitor_id: 'mon_ferc_rate', compliance_status: 'Error',
      last_verified_at: '2026-06-18T00:00:00.000Z',
    },
    {
      id: 'ob-txrrc-w3', operator_id: 'op1', sheet_code: '01 – ENERGY',
      broad_industry: 'ENERGY', industry_subtype: 'Oil & Gas – Production',
      specific_activity: 'Plugging Report', jurisdiction_level: 'State – TX',
      governing_agency: 'TX RRC', regulation_name: 'Texas Natural Resources Code; 16 TAC §3.14',
      cfr_citation: '16 TAC §3.14', report_form_name: 'Plugging Record',
      form_code: 'Form W-3', filing_frequency: 'Per Well Event',
      key_due_dates: 'Within 30 days of plugging', penalties: 'Up to $10,000/day (state)',
      risk_tier: 'MEDIUM', risk_weight: 4, policy_action: 'WARN', responsible_role: 'Field Operations',
      regulatory_url: 'https://www.rrc.texas.gov/oil-and-gas/publications-and-notices/forms/',
      firecrawl_monitor_id: null, compliance_status: 'Unmonitored',
      last_verified_at: null,
    },
  ];

  const scan_history = [
    {
      id: 'scan-1', operator_id: 'op1', obligation_id: 'ob-epa-spcc', scan_kind: 'run_check',
      source_url: obligations[0].regulatory_url, scraped_at: '2026-06-29T11:02:00.000Z',
      changed: true, firecrawl_tool: 'firecrawl_monitor_check',
      diff_summary: 'Penalty ceiling updated from $54,833 to a new annually-adjusted figure; PE re-certification window language revised.',
    },
    {
      id: 'scan-2', operator_id: 'op1', obligation_id: 'ob-epa-ghg', scan_kind: 'run_check',
      source_url: obligations[1].regulatory_url, scraped_at: '2026-06-28T11:00:00.000Z',
      changed: false, firecrawl_tool: 'firecrawl_monitor_check', diff_summary: null,
    },
    {
      id: 'scan-3', operator_id: 'op1', obligation_id: 'ob-bsee-apd', scan_kind: 'run_check',
      source_url: obligations[2].regulatory_url, scraped_at: '2026-06-29T11:01:00.000Z',
      changed: false, firecrawl_tool: 'firecrawl_monitor_check', diff_summary: null,
    },
  ];

  const discoveries = [
    {
      id: 'disc-1', operator_id: 'op1', root_domain: 'epa.gov',
      discovered_url: 'https://www.epa.gov/system/files/documents/2026-final-methane-rule.pdf',
      matched_terms: ['2026', 'final-rule'], risk_tier: 'HIGH', jurisdiction_level: 'Federal',
      suggested_sheet: '01 – ENERGY', summary: 'EPA 2026 final methane rule for oil & gas; new LDAR cadence and reporting thresholds.',
      status: 'new', discovered_at: '2026-06-30T09:00:00.000Z', reviewed_by: null, reviewed_at: null,
    },
    {
      id: 'disc-2', operator_id: 'op1', root_domain: 'rrc.texas.gov',
      discovered_url: 'https://www.rrc.texas.gov/media/2026-draft-flaring-guidance/',
      matched_terms: ['2026', 'draft'], risk_tier: 'MEDIUM', jurisdiction_level: 'State – TX',
      suggested_sheet: '01 – ENERGY', summary: 'TX RRC draft flaring/venting guidance; comment period open.',
      status: 'new', discovered_at: '2026-06-30T09:05:00.000Z', reviewed_by: null, reviewed_at: null,
    },
  ];

  const monitors = [
    { id: 'mon_epa_spcc', obligation_id: 'ob-epa-spcc', url: obligations[0].regulatory_url, status: 'active', schedule: 'weekly', last_check_at: '2026-06-29T11:02:00.000Z', last_status: 'changed' },
    { id: 'mon_epa_ghg', obligation_id: 'ob-epa-ghg', url: obligations[1].regulatory_url, status: 'active', schedule: 'weekly', last_check_at: '2026-06-28T11:00:00.000Z', last_status: 'same' },
    { id: 'mon_bsee_apd', obligation_id: 'ob-bsee-apd', url: obligations[2].regulatory_url, status: 'active', schedule: 'daily', last_check_at: '2026-06-29T11:01:00.000Z', last_status: 'same' },
    { id: 'mon_osha_psm', obligation_id: 'ob-osha-psm', url: obligations[3].regulatory_url, status: 'active', schedule: 'weekly', last_check_at: '2026-06-27T10:00:00.000Z', last_status: 'same' },
    { id: 'mon_ferc_rate', obligation_id: 'ob-ferc-rate', url: obligations[4].regulatory_url, status: 'paused', schedule: 'weekly', last_check_at: '2026-06-18T10:00:00.000Z', last_status: 'error' },
  ];

  return {
    obligations,
    scan_history,
    discoveries,
    monitors,
    projects: [seedDoiProject()],
    activity: [
      { id: 'act-1', at: '2026-06-30T09:05:00.000Z', kind: 'discovery', message: 'Firecrawl map surfaced 2 new candidate reports (EPA, TX RRC).' },
      { id: 'act-2', at: '2026-06-29T11:02:00.000Z', kind: 'change', message: 'Change detected on EPA SPCC (40 CFR Part 112) — moved to Pending Review.' },
    ],
  };
}
