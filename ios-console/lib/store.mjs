// @ts-check
/**
 * Console data store.
 *
 * Default backend is in-memory, seeded from lib/seed.mjs and snapshotted to
 * ./.data/state.json so mutations survive restarts — the MVP runs with zero infra.
 * Set CONSOLE_STATE_FILE to relocate the snapshot, or IOS_NO_PERSIST=1 to disable it
 * (used by the tests). A Postgres-backed store can be swapped in later behind the
 * same method surface; the compliance_* schema in ../compliance-monitor maps 1:1.
 *
 * @typedef {Object} ConsoleState
 * @property {any[]} obligations
 * @property {any[]} scan_history
 * @property {any[]} discoveries
 * @property {any[]} monitors
 * @property {any[]} projects
 * @property {any[]} activity
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeed } from './seed.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = resolve(HERE, '..', '.data', 'state.json');

let seq = 1000;
const uid = (p) => `${p}-${++seq}`;
// Deterministic timestamps are impossible (Date.now is fine in app code, only the
// workflow sandbox forbids it). Use a monotonic clock for created/updated stamps.
const stamp = () => new Date().toISOString();

export class Store {
  /** @param {{ file?: string, persist?: boolean, clock?: () => string }} [opts] */
  constructor(opts = {}) {
    this.file = opts.file ?? process.env.CONSOLE_STATE_FILE ?? DEFAULT_FILE;
    this.persist = opts.persist ?? process.env.IOS_NO_PERSIST !== '1';
    this.clock = opts.clock ?? stamp;
    /** @type {ConsoleState} */
    this.state = this.#load();
  }

  #load() {
    if (this.persist && existsSync(this.file)) {
      try {
        return JSON.parse(readFileSync(this.file, 'utf8'));
      } catch {
        /* corrupt snapshot — fall back to seed */
      }
    }
    return buildSeed();
  }

  #save() {
    if (!this.persist) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  /** Reset to the seed (used by tests and the UI "reset demo data" action). */
  reset() {
    this.state = buildSeed();
    this.#save();
    return this.state;
  }

  // ---- dashboard ----------------------------------------------------------
  dashboard() {
    const s = this.state;
    const byStatus = {};
    for (const o of s.obligations) byStatus[o.compliance_status] = (byStatus[o.compliance_status] || 0) + 1;
    const byTier = {};
    for (const o of s.obligations) byTier[o.risk_tier] = (byTier[o.risk_tier] || 0) + 1;
    return {
      obligations: {
        total: s.obligations.length,
        byStatus,
        byTier,
        pendingReview: s.obligations.filter((o) => o.compliance_status === 'Pending Review').length,
        unmonitored: s.obligations.filter((o) => o.compliance_status === 'Unmonitored').length,
      },
      monitors: {
        total: s.monitors.length,
        active: s.monitors.filter((m) => m.status === 'active').length,
        paused: s.monitors.filter((m) => m.status === 'paused').length,
        changed: s.monitors.filter((m) => m.last_status === 'changed').length,
        error: s.monitors.filter((m) => m.last_status === 'error').length,
      },
      discoveries: {
        total: s.discoveries.length,
        new: s.discoveries.filter((d) => d.status === 'new').length,
      },
      projects: {
        total: s.projects.length,
        balanced: s.projects.filter((p) => p.balances).length,
        approved: s.projects.filter((p) => p.approved_at).length,
        openCurative: s.projects.reduce((n, p) => n + p.curative.filter((c) => c.status === 'open').length, 0),
      },
      activity: [...s.activity].slice(0, 12),
    };
  }

  #logActivity(kind, message) {
    this.state.activity.unshift({ id: uid('act'), at: this.clock(), kind, message });
    this.state.activity = this.state.activity.slice(0, 50);
  }

  // ---- obligations --------------------------------------------------------
  listObligations({ status, sheet, q } = {}) {
    let rows = this.state.obligations;
    if (status) rows = rows.filter((o) => o.compliance_status === status);
    if (sheet) rows = rows.filter((o) => o.sheet_code === sheet);
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((o) =>
        [o.governing_agency, o.cfr_citation, o.regulation_name, o.specific_activity, o.report_form_name]
          .filter(Boolean).some((v) => v.toLowerCase().includes(needle))
      );
    }
    return rows;
  }

  getObligation(id) {
    const o = this.state.obligations.find((x) => x.id === id);
    if (!o) return null;
    const scans = this.state.scan_history
      .filter((s) => s.obligation_id === id)
      .sort((a, b) => (a.scraped_at < b.scraped_at ? 1 : -1));
    const monitor = this.state.monitors.find((m) => m.id === o.firecrawl_monitor_id) || null;
    return { ...o, scans, monitor };
  }

  /** Reconcile a monitor check → write back. { changed, diffSummary } */
  runCheck(id, { changed = false, diffSummary = null } = {}) {
    const o = this.state.obligations.find((x) => x.id === id);
    if (!o) return null;
    const at = this.clock();
    const scan = {
      id: uid('scan'), operator_id: o.operator_id, obligation_id: id, scan_kind: 'run_check',
      source_url: o.regulatory_url, scraped_at: at, changed: !!changed,
      diff_summary: changed ? (diffSummary || 'Change detected by monitor.') : null,
      firecrawl_tool: 'firecrawl_monitor_check',
    };
    this.state.scan_history.unshift(scan);
    if (changed) {
      o.compliance_status = 'Pending Review';
      o.last_scraped_at = at;
    } else {
      o.compliance_status = o.compliance_status === 'Unmonitored' ? 'Unmonitored' : 'Current';
      o.last_verified_at = at;
      o.last_scraped_at = at;
    }
    const mon = this.state.monitors.find((m) => m.id === o.firecrawl_monitor_id);
    if (mon) { mon.last_check_at = at; mon.last_status = changed ? 'changed' : 'same'; }
    this.#logActivity(changed ? 'change' : 'verify',
      `Run-check on ${o.governing_agency} (${o.cfr_citation}): ${changed ? 'CHANGED → Pending Review' : 'no change'}.`);
    this.#save();
    return this.getObligation(id);
  }

  /** Mark a Pending Review obligation as reviewed/accepted → Current. */
  acceptReview(id) {
    const o = this.state.obligations.find((x) => x.id === id);
    if (!o) return null;
    o.compliance_status = 'Current';
    o.last_verified_at = this.clock();
    this.#logActivity('verify', `${o.governing_agency} (${o.cfr_citation}) review accepted → Current.`);
    this.#save();
    return this.getObligation(id);
  }

  // ---- discoveries --------------------------------------------------------
  listDiscoveries({ status } = {}) {
    let rows = this.state.discoveries;
    if (status) rows = rows.filter((d) => d.status === status);
    return rows;
  }

  rejectDiscovery(id) {
    const d = this.state.discoveries.find((x) => x.id === id);
    if (!d) return null;
    d.status = 'rejected';
    d.reviewed_at = this.clock();
    d.reviewed_by = 'console';
    this.#logActivity('discovery', `Rejected discovered report: ${d.discovered_url}`);
    this.#save();
    return d;
  }

  /** Promote a discovery into a new (unmonitored) obligation. */
  promoteDiscovery(id) {
    const d = this.state.discoveries.find((x) => x.id === id);
    if (!d) return null;
    if (d.status === 'promoted') return { discovery: d, obligation: this.getObligation(d.promoted_obligation_id) };
    const ob = {
      id: uid('ob'), operator_id: d.operator_id, sheet_code: d.suggested_sheet || '01 – ENERGY',
      broad_industry: 'ENERGY', industry_subtype: null, specific_activity: d.summary?.slice(0, 80) || 'Discovered report',
      jurisdiction_level: d.jurisdiction_level, governing_agency: d.root_domain, regulation_name: null,
      cfr_citation: null, report_form_name: null, form_code: null, filing_frequency: null,
      key_due_dates: null, penalties: null, risk_tier: d.risk_tier || 'MEDIUM', risk_weight: null,
      policy_action: 'REVIEW', responsible_role: null, regulatory_url: d.discovered_url,
      firecrawl_monitor_id: null, compliance_status: 'Unmonitored', last_verified_at: null,
    };
    this.state.obligations.push(ob);
    d.status = 'promoted';
    d.promoted_obligation_id = ob.id;
    d.reviewed_at = this.clock();
    d.reviewed_by = 'console';
    this.#logActivity('discovery', `Promoted discovery to obligation ${ob.id} (${ob.regulatory_url}).`);
    this.#save();
    return { discovery: d, obligation: this.getObligation(ob.id) };
  }

  // ---- monitors -----------------------------------------------------------
  listMonitors() { return this.state.monitors; }

  toggleMonitor(id) {
    const m = this.state.monitors.find((x) => x.id === id);
    if (!m) return null;
    m.status = m.status === 'active' ? 'paused' : 'active';
    this.#logActivity('monitor', `Monitor ${id} ${m.status === 'active' ? 'resumed' : 'paused'}.`);
    this.#save();
    return m;
  }

  // ---- DOI projects -------------------------------------------------------
  listProjects() {
    return this.state.projects.map((p) => ({
      id: p.id, name: p.name, unit_id: p.unit_id, tract: p.tract, basis: p.basis,
      total_nri: p.total_nri, balances: p.balances, approved_at: p.approved_at,
      rows: p.rows.length, openCurative: p.curative.filter((c) => c.status === 'open').length,
    }));
  }

  getProject(id) { return this.state.projects.find((p) => p.id === id) || null; }

  /** Approve a deck — hard balance gate (deck must close to 1.000000000000). */
  approveProject(id) {
    const p = this.getProject(id);
    if (!p) return { error: 'not_found' };
    if (!p.balances) return { error: 'unbalanced', message: 'Deck does not close to 1.00000000; cannot approve.' };
    if (p.curative.some((c) => c.severity === 'critical' && c.status === 'open'))
      return { error: 'open_critical', message: 'Resolve all critical curative items before approval.' };
    p.approved_by = 'console';
    p.approved_at = this.clock();
    this.#logActivity('deck', `DOI deck "${p.name}" approved (balanced ${p.total_nri}).`);
    this.#save();
    return { project: p };
  }

  resolveCurative(projectId, curativeId, { status = 'resolved' } = {}) {
    const p = this.getProject(projectId);
    if (!p) return null;
    const c = p.curative.find((x) => x.id === curativeId);
    if (!c) return null;
    c.status = status;
    c.resolved_by = 'console';
    c.resolved_at = this.clock();
    this.#logActivity('deck', `Curative ${c.code} on "${p.name}" → ${status}.`);
    this.#save();
    return c;
  }
}
