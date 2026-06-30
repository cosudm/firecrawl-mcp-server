// @ts-check
/**
 * Pure store logic — no filesystem, no seed import — so it runs identically in
 * Node (behind lib/store.mjs) and in the browser (behind the single-file build).
 *
 * Construct with an initial state plus hooks:
 *   new StoreCore(state, { clock, seedFn, save })
 *     clock  : () => ISO string      (timestamps)
 *     seedFn : () => ConsoleState    (used by reset())
 *     save   : (state) => void       (persistence side-effect; optional)
 */
let seq = 1000;
const uid = (p) => `${p}-${++seq}`;

export class StoreCore {
  constructor(state, { clock, seedFn, save } = {}) {
    /** @type {any} */
    this.state = state;
    this.clock = clock || (() => new Date().toISOString());
    this.seedFn = seedFn || (() => this.state);
    this._saveHook = save || null;
  }
  _save() { if (this._saveHook) this._saveHook(this.state); }

  reset() { this.state = this.seedFn(); this._save(); return this.state; }

  // ---- dashboard ----------------------------------------------------------
  dashboard() {
    const s = this.state;
    const byStatus = {}, byTier = {};
    for (const o of s.obligations) {
      byStatus[o.compliance_status] = (byStatus[o.compliance_status] || 0) + 1;
      byTier[o.risk_tier] = (byTier[o.risk_tier] || 0) + 1;
    }
    return {
      obligations: {
        total: s.obligations.length, byStatus, byTier,
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
      discoveries: { total: s.discoveries.length, new: s.discoveries.filter((d) => d.status === 'new').length },
      projects: {
        total: s.projects.length,
        balanced: s.projects.filter((p) => p.balances).length,
        approved: s.projects.filter((p) => p.approved_at).length,
        openCurative: s.projects.reduce((n, p) => n + p.curative.filter((c) => c.status === 'open').length, 0),
      },
      activity: [...s.activity].slice(0, 12),
    };
  }

  _logActivity(kind, message) {
    this.state.activity.unshift({ id: uid('act'), at: this.clock(), kind, message });
    this.state.activity = this.state.activity.slice(0, 50);
  }

  // ---- obligations --------------------------------------------------------
  listObligations({ status, sheet, q } = {}) {
    let rows = this.state.obligations;
    if (status) rows = rows.filter((o) => o.compliance_status === status);
    if (sheet) rows = rows.filter((o) => o.sheet_code === sheet);
    if (q) {
      const n = q.toLowerCase();
      rows = rows.filter((o) => [o.governing_agency, o.cfr_citation, o.regulation_name, o.specific_activity, o.report_form_name]
        .filter(Boolean).some((v) => v.toLowerCase().includes(n)));
    }
    return rows;
  }
  getObligation(id) {
    const o = this.state.obligations.find((x) => x.id === id);
    if (!o) return null;
    const scans = this.state.scan_history.filter((s) => s.obligation_id === id).sort((a, b) => (a.scraped_at < b.scraped_at ? 1 : -1));
    const monitor = this.state.monitors.find((m) => m.id === o.firecrawl_monitor_id) || null;
    return { ...o, scans, monitor };
  }
  runCheck(id, { changed = false, diffSummary = null } = {}) {
    const o = this.state.obligations.find((x) => x.id === id);
    if (!o) return null;
    const at = this.clock();
    this.state.scan_history.unshift({
      id: uid('scan'), operator_id: o.operator_id, obligation_id: id, scan_kind: 'run_check',
      source_url: o.regulatory_url, scraped_at: at, changed: !!changed,
      diff_summary: changed ? (diffSummary || 'Change detected by monitor.') : null, firecrawl_tool: 'firecrawl_monitor_check',
    });
    if (changed) { o.compliance_status = 'Pending Review'; o.last_scraped_at = at; }
    else { o.compliance_status = o.compliance_status === 'Unmonitored' ? 'Unmonitored' : 'Current'; o.last_verified_at = at; o.last_scraped_at = at; }
    const mon = this.state.monitors.find((m) => m.id === o.firecrawl_monitor_id);
    if (mon) { mon.last_check_at = at; mon.last_status = changed ? 'changed' : 'same'; }
    this._logActivity(changed ? 'change' : 'verify', `Run-check on ${o.governing_agency} (${o.cfr_citation}): ${changed ? 'CHANGED → Pending Review' : 'no change'}.`);
    this._save();
    return this.getObligation(id);
  }
  acceptReview(id) {
    const o = this.state.obligations.find((x) => x.id === id);
    if (!o) return null;
    o.compliance_status = 'Current'; o.last_verified_at = this.clock();
    this._logActivity('verify', `${o.governing_agency} (${o.cfr_citation}) review accepted → Current.`);
    this._save();
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
    d.status = 'rejected'; d.reviewed_at = this.clock(); d.reviewed_by = 'console';
    this._logActivity('discovery', `Rejected discovered report: ${d.discovered_url}`);
    this._save();
    return d;
  }
  promoteDiscovery(id) {
    const d = this.state.discoveries.find((x) => x.id === id);
    if (!d) return null;
    if (d.status === 'promoted') return { discovery: d, obligation: this.getObligation(d.promoted_obligation_id) };
    const ob = {
      id: uid('ob'), operator_id: d.operator_id, sheet_code: d.suggested_sheet || '01 – ENERGY', broad_industry: 'ENERGY',
      industry_subtype: null, specific_activity: d.summary?.slice(0, 80) || 'Discovered report', jurisdiction_level: d.jurisdiction_level,
      governing_agency: d.root_domain, regulation_name: null, cfr_citation: null, report_form_name: null, form_code: null,
      filing_frequency: null, key_due_dates: null, penalties: null, risk_tier: d.risk_tier || 'MEDIUM', risk_weight: null,
      policy_action: 'REVIEW', responsible_role: null, regulatory_url: d.discovered_url, firecrawl_monitor_id: null,
      compliance_status: 'Unmonitored', last_verified_at: null,
    };
    this.state.obligations.push(ob);
    d.status = 'promoted'; d.promoted_obligation_id = ob.id; d.reviewed_at = this.clock(); d.reviewed_by = 'console';
    this._logActivity('discovery', `Promoted discovery to obligation ${ob.id} (${ob.regulatory_url}).`);
    this._save();
    return { discovery: d, obligation: this.getObligation(ob.id) };
  }

  // ---- monitors -----------------------------------------------------------
  listMonitors() { return this.state.monitors; }
  toggleMonitor(id) {
    const m = this.state.monitors.find((x) => x.id === id);
    if (!m) return null;
    m.status = m.status === 'active' ? 'paused' : 'active';
    this._logActivity('monitor', `Monitor ${id} ${m.status === 'active' ? 'resumed' : 'paused'}.`);
    this._save();
    return m;
  }

  // ---- DOI projects -------------------------------------------------------
  listProjects() {
    return this.state.projects.map((p) => ({
      id: p.id, name: p.name, unit_id: p.unit_id, tract: p.tract, basis: p.basis, total_nri: p.total_nri,
      balances: p.balances, approved_at: p.approved_at, rows: p.rows.length, openCurative: p.curative.filter((c) => c.status === 'open').length,
    }));
  }
  getProject(id) { return this.state.projects.find((p) => p.id === id) || null; }
  approveProject(id) {
    const p = this.getProject(id);
    if (!p) return { error: 'not_found' };
    if (!p.balances) return { error: 'unbalanced', message: 'Deck does not close to 1.00000000; cannot approve.' };
    if (p.curative.some((c) => c.severity === 'critical' && c.status === 'open'))
      return { error: 'open_critical', message: 'Resolve all critical curative items before approval.' };
    p.approved_by = 'console'; p.approved_at = this.clock();
    this._logActivity('deck', `DOI deck "${p.name}" approved (balanced ${p.total_nri}).`);
    this._save();
    return { project: p };
  }
  resolveCurative(projectId, curativeId, { status = 'resolved' } = {}) {
    const p = this.getProject(projectId);
    if (!p) return null;
    const c = p.curative.find((x) => x.id === curativeId);
    if (!c) return null;
    c.status = status; c.resolved_by = 'console'; c.resolved_at = this.clock();
    this._logActivity('deck', `Curative ${c.code} on "${p.name}" → ${status}.`);
    this._save();
    return c;
  }
}
