// IOS+ Management Console — Xcode project-editor SPA.
// Runs against the HTTP API, or an inlined window.IOS_API (single-file offline build).
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cl = (s) => String(s ?? '').replace(/\s+/g, '');
const pill = (v, label) => `<span class="pill ${cl(v)}">${esc(label ?? v)}</span>`;
const dot = (v) => `<span class="dot ${cl(v)}">●</span>`;
const fmt = (t) => (t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

async function api(path, opts = {}) {
  if (typeof window !== 'undefined' && window.IOS_API) {
    const m = (opts.method || 'GET').toUpperCase();
    const u = new URL(path, 'http://x'); const q = Object.fromEntries(u.searchParams.entries());
    const body = opts.body ? JSON.parse(opts.body) : null;
    const { status, json } = window.IOS_API(m, u.pathname, q, body);
    if (status >= 400) throw Object.assign(new Error(json.message || json.error || 'error'), { status, body: json });
    return json;
  }
  const res = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.message || json.error || res.statusText), { status: res.status, body: json });
  return json;
}
const get = (p) => api(p);
const post = (p, body) => api(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
function toast(msg, bad = false) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600); }

const SECTION_LABEL = { dashboard: 'Dashboard', compliance: 'Compliance', discovery: 'Discovery', decks: 'DOI Decks', monitors: 'Monitors' };
const FILTERS = {
  compliance: [['all', 'All'], ['Pending Review', 'Pending'], ['Current', 'Current'], ['Error', 'Error'], ['Unmonitored', 'Unmonitored']],
  monitors: [['all', 'All'], ['active', 'Active'], ['paused', 'Paused']],
  discovery: [['all', 'All'], ['new', 'New'], ['promoted', 'Promoted'], ['rejected', 'Rejected']],
  decks: [['all', 'All'], ['balanced', 'Balanced'], ['approved', 'Approved'], ['draft', 'Draft']],
};
const TI = { proj: ['proj', 'I+'], ob: ['ob', '§'], mon: ['mon', '◷'], deck: ['deck', '▦'], disc: ['disc', '🔎'] };

const sel = { section: 'dashboard', targetId: null, filter: 'all', query: '' };
const collapsed = {};
let cache = {};

async function loadAll() {
  const [dash, obl, disc, proj, mon] = await Promise.all([get('/dashboard'), get('/obligations'), get('/discoveries'), get('/projects'), get('/monitors')]);
  cache = { dash, obligations: obl.items, discoveries: disc.items, projects: proj.items, monitors: mon.items };
}

// ---- which entities belong to the active section (filtered) ----
function entities() {
  const q = sel.query.toLowerCase();
  let list;
  if (sel.section === 'compliance') list = cache.obligations.map((o) => ({ id: o.id, kind: 'ob', name: `${o.governing_agency} — ${o.cfr_citation || o.report_form_name || ''}`.trim(), status: o.compliance_status, meta: o.risk_tier, _ok: sel.filter === 'all' || o.compliance_status === sel.filter }));
  else if (sel.section === 'monitors') list = cache.monitors.map((m) => ({ id: m.id, kind: 'mon', name: m.id, status: m.status, meta: m.last_status, _ok: sel.filter === 'all' || m.status === sel.filter }));
  else if (sel.section === 'discovery') list = cache.discoveries.map((d) => ({ id: d.id, kind: 'disc', name: d.root_domain, status: d.status, meta: d.risk_tier, _ok: sel.filter === 'all' || d.status === sel.filter }));
  else if (sel.section === 'decks') list = cache.projects.map((p) => ({ id: p.id, kind: 'deck', name: p.name, status: p.approved_at ? 'good' : (p.balances ? 'same' : 'Error'), meta: p.balances ? 'balanced' : 'unbalanced', _ok: sel.filter === 'all' || (sel.filter === 'balanced' && p.balances) || (sel.filter === 'approved' && p.approved_at) || (sel.filter === 'draft' && !p.approved_at) }));
  else list = [];
  return list.filter((e) => e._ok && (!q || e.name.toLowerCase().includes(q)));
}

// ---- toolbar / crumb ----
function renderChrome() {
  const d = cache.dash;
  $('#statusSub').textContent = `${d.obligations.total} obligations · ${d.monitors.active} monitors · ${d.projects.total} decks`;
  const warn = d.obligations.pendingReview + d.discoveries.new;
  const w = $('#statusWarn'); w.hidden = warn === 0; w.querySelector('em').textContent = warn;
  $('#ebWarn').textContent = '⚠ ' + warn;
  let crumb = `IOS+ Operation › ${SECTION_LABEL[sel.section]}`;
  if (sel.targetId) { const e = entities().find((x) => x.id === sel.targetId); if (e) crumb += ` › ${e.name}`; }
  $('#ebCrumb').textContent = crumb;
}

// ---- navigator ----
function navGroup(section, ico, items) {
  const isColl = collapsed[section];
  const kids = items.map((c) => `<div class="tw-row ${sel.section === section && sel.targetId === c.id ? 'sel' : ''}" data-section="${section}" data-id="${esc(c.id)}">${dot(c.status)}<span class="lbl">${esc(c.name)}</span></div>`).join('');
  return `<div class="tw-group"><div class="tw-row ${isColl ? 'collapsed' : ''} ${sel.section === section && !sel.targetId ? 'sel' : ''}" data-section="${section}" data-group="1"><span class="tri">▼</span><span class="tw-ico">${ico}</span><span class="lbl">${SECTION_LABEL[section]}</span><span class="count">${items.length}</span></div><div class="tw-children" ${isColl ? 'style="display:none"' : ''}>${kids}</div></div>`;
}
function renderNavigator() {
  const all = (section) => { const s = sel.section, f = sel.filter, q = sel.query; sel.section = section; sel.filter = 'all'; sel.query = ''; const e = entities(); sel.section = s; sel.filter = f; sel.query = q; return e; };
  $('#navTree').innerHTML =
    `<div class="tw-row ${sel.section === 'dashboard' ? 'sel' : ''}" data-section="dashboard" data-group="1"><span class="tri" style="visibility:hidden">▼</span><span class="tw-ico">◫</span><span class="lbl">Dashboard</span></div>`
    + navGroup('compliance', '§', all('compliance')) + navGroup('discovery', '🔎', all('discovery')) + navGroup('decks', '▦', all('decks')) + navGroup('monitors', '◷', all('monitors'));
  $('#navTree').querySelectorAll('.tw-row').forEach((row) => row.onclick = () => {
    const s = row.dataset.section;
    if (row.dataset.group && s !== 'dashboard' && sel.section === s && !sel.targetId) collapsed[s] = !collapsed[s];
    sel.section = s; sel.targetId = row.dataset.id || null; if (row.dataset.group) sel.filter = 'all';
    render();
  });
}

// ---- sub-toolbar ----
function renderSubbar() {
  const bar = $('#subbar');
  const fs = FILTERS[sel.section];
  if (!fs) { bar.className = 'subbar hidden'; bar.innerHTML = ''; return; }
  bar.className = 'subbar';
  bar.innerHTML = `<div class="seg">${fs.map(([v, l]) => `<button data-f="${v}" class="${sel.filter === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <span class="plus">+</span>
    <div class="search"><input id="subSearch" type="search" placeholder="Search ${SECTION_LABEL[sel.section]}" value="${esc(sel.query)}"></div>`;
  bar.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { sel.filter = b.dataset.f; sel.targetId = null; render(); });
  const si = $('#subSearch'); si.oninput = (e) => { sel.query = e.target.value || ''; renderTargets(); renderSettings(); };
}

// ---- targets (PROJECT / TARGETS) ----
function tgIcon(kind) { const [c, g] = TI[kind] || TI.ob; return `<span class="ti ${c}">${g}</span>`; }
function renderTargets() {
  const col = $('#targets');
  if (sel.section === 'dashboard') {
    col.innerHTML = `<div class="tg-head">Project</div><div class="tg-row sel"><span class="ti proj">I+</span><span class="tn">IOS+ Operation</span></div>`;
    return;
  }
  const items = entities();
  col.innerHTML = `<div class="tg-head">Project</div>
    <div class="tg-row ${!sel.targetId ? 'sel' : ''}" data-id=""><span class="ti proj">I+</span><span class="tn">IOS+ Operation</span></div>
    <div class="tg-head">Targets · ${SECTION_LABEL[sel.section]}</div>
    ${items.map((e) => `<div class="tg-row ${sel.targetId === e.id ? 'sel' : ''}" data-id="${esc(e.id)}">${tgIcon(e.kind)}<span class="tn">${esc(e.name)}</span><span class="tmeta">${dot(e.status)}</span></div>`).join('') || '<div class="tg-row muted">No matches</div>'}`;
  col.querySelectorAll('.tg-row[data-id]').forEach((r) => r.onclick = () => { sel.targetId = r.dataset.id || null; renderTargets(); renderSettings(); renderInspector(); renderChrome(); });
}

// ---- settings (grouped Setting | value) ----
function grp(title, target, rows) {
  return `<div class="grp"><div class="grp-h"><span class="tri">▼</span>${esc(title)}</div>
    <div class="srow head"><div>Setting</div><div class="tgt">${tgIcon(target.kind)} ${esc(target.name)}</div></div>${rows}</div>`;
}
function sr(k, v) { return `<div class="srow"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`; }
const PROJ = { kind: 'proj', name: 'IOS+ Operation' };

async function renderSettings() {
  const body = $('#settings');
  if (sel.section === 'dashboard') return dashboardSettings(body);
  if (!sel.targetId) return overviewSettings(body);
  return detailSettings(body);
}

function dashboardSettings(body) {
  const d = cache.dash;
  const tile = (l, n, s, k = '') => `<div class="tile ${k}"><div class="l">${l}</div><div class="n">${n}</div><div class="s">${s}</div></div>`;
  const bars = ['Current', 'Pending Review', 'Error', 'Unmonitored'].map((k) => { const n = d.obligations.byStatus[k] || 0, p = d.obligations.total ? Math.round(n / d.obligations.total * 100) : 0; return `<div style="margin:8px 0"><div style="display:flex;justify-content:space-between">${pill(k)}<span class="muted">${n}</span></div><div style="height:7px;background:#eceef1;border-radius:5px;margin-top:4px;overflow:hidden"><div style="width:${p}%;height:100%;background:var(--sel)"></div></div></div>`; }).join('');
  body.innerHTML = `<p class="s-eyebrow">Operations overview · IOS+ Operation</p>
    <div class="tiles">
      ${tile('Obligations', d.obligations.total, `${d.obligations.byTier.CRITICAL || 0} critical`)}
      ${tile('Pending Review', d.obligations.pendingReview, 'regulatory change', d.obligations.pendingReview ? 'alert' : '')}
      ${tile('Active Monitors', d.monitors.active, `${d.monitors.changed} flagged`)}
      ${tile('New Discoveries', d.discoveries.new, 'awaiting triage', d.discoveries.new ? 'alert' : '')}
      ${tile('DOI Decks', d.projects.total, `${d.projects.balanced} balanced · ${d.projects.approved} approved`, 'good')}
      ${tile('Open Curative', d.projects.openCurative, 'defects to cure')}
    </div>
    <div class="cols2"><div class="grp"><div class="grp-h"><span class="tri">▼</span>Compliance status</div>${bars}</div>
    <div class="grp"><div class="grp-h"><span class="tri">▼</span>Recent activity</div><ul class="feed">${(d.activity || []).map((a) => `<li><span class="fdot ${esc(a.kind)}"></span><div>${esc(a.message)}<time>${fmt(a.at)}</time></div></li>`).join('')}</ul></div></div>`;
}

function overviewSettings(body) {
  const d = cache.dash; const items = entities();
  let summary = '', table = '';
  if (sel.section === 'compliance') {
    summary = sr('Total obligations', cache.obligations.length) + sr('Pending review', d.obligations.pendingReview) + sr('Unmonitored', d.obligations.unmonitored) + sr('Critical', d.obligations.byTier.CRITICAL || 0);
    table = `<table class="grid"><thead><tr><th>Agency</th><th>Citation</th><th>Risk</th><th>Policy</th><th>Status</th></tr></thead><tbody>${items.map((e) => { const o = cache.obligations.find((x) => x.id === e.id); return `<tr class="click" data-id="${o.id}"><td><b>${esc(o.governing_agency)}</b></td><td>${esc(o.cfr_citation || '—')}</td><td>${pill(o.risk_tier)}</td><td>${pill(o.policy_action)}</td><td>${pill(o.compliance_status, o.compliance_status)}</td></tr>`; }).join('')}</tbody></table>`;
  } else if (sel.section === 'monitors') {
    summary = sr('Total monitors', d.monitors.total) + sr('Active', d.monitors.active) + sr('Paused', d.monitors.paused) + sr('Flagged change', d.monitors.changed);
    table = `<table class="grid"><thead><tr><th>Monitor</th><th>Schedule</th><th>Last result</th><th>Status</th></tr></thead><tbody>${items.map((e) => { const m = cache.monitors.find((x) => x.id === e.id); return `<tr class="click" data-id="${m.id}"><td class="mono">${esc(m.id)}</td><td>${esc(m.schedule)}</td><td>${pill(m.last_status)}</td><td>${pill(m.status)}</td></tr>`; }).join('')}</tbody></table>`;
  } else if (sel.section === 'discovery') {
    summary = sr('Total discoveries', d.discoveries.total) + sr('New (awaiting triage)', d.discoveries.new);
    table = `<table class="grid"><thead><tr><th>URL</th><th>Risk</th><th>Status</th></tr></thead><tbody>${items.map((e) => { const x = cache.discoveries.find((y) => y.id === e.id); return `<tr class="click" data-id="${x.id}"><td><a class="ext" href="${esc(x.discovered_url)}" target="_blank" rel="noopener">${esc(x.discovered_url)}</a></td><td>${pill(x.risk_tier || '—')}</td><td>${pill(x.status)}</td></tr>`; }).join('')}</tbody></table>`;
  } else if (sel.section === 'decks') {
    summary = sr('Total decks', d.projects.total) + sr('Balanced', d.projects.balanced) + sr('Approved', d.projects.approved) + sr('Open curative', d.projects.openCurative);
    table = `<table class="grid"><thead><tr><th>Project</th><th class="num">Owners</th><th class="num">Total NRI</th><th>Balanced</th><th>Approval</th></tr></thead><tbody>${items.map((e) => { const p = cache.projects.find((x) => x.id === e.id); return `<tr class="click" data-id="${p.id}"><td><b>${esc(p.name)}</b></td><td class="num">${p.rows}</td><td class="num mono">${esc(p.total_nri)}</td><td>${pill(p.balances ? 'balanced' : 'unbalanced')}</td><td>${p.approved_at ? pill('approved') : '<span class="muted">draft</span>'}</td></tr>`; }).join('')}</tbody></table>`;
  }
  body.innerHTML = `<p class="s-eyebrow">${SECTION_LABEL[sel.section]} · project-level</p>${grp('Summary', PROJ, summary)}${grp(SECTION_LABEL[sel.section], PROJ, table)}`;
  body.querySelectorAll('tr.click').forEach((tr) => tr.onclick = () => { sel.targetId = tr.dataset.id; render(); });
}

async function detailSettings(body) {
  const id = sel.targetId;
  if (sel.section === 'compliance') {
    const o = await get('/obligations/' + id); const T = { kind: 'ob', name: `${o.governing_agency} — ${o.cfr_citation || ''}`.trim() };
    body.innerHTML = `<p class="s-eyebrow">${esc(o.regulation_name || 'Compliance obligation')}</p>
      ${grp('Regulation & Filing', T, sr('Specific activity', esc(o.specific_activity || '—')) + sr('Report / form', `${esc(o.report_form_name || '—')} <span class="muted">${esc(o.form_code || '')}</span>`) + sr('Filing frequency', esc(o.filing_frequency || '—')) + sr('Key due dates', esc(o.key_due_dates || '—')) + sr('Penalties', esc(o.penalties || '—')))}
      ${grp('Classification', T, sr('Jurisdiction level', esc(o.jurisdiction_level || '—')) + sr('Risk tier', pill(o.risk_tier)) + sr('Policy action', pill(o.policy_action)) + sr('Sheet', esc(o.sheet_code || '—')))}
      ${grp('Monitoring', T, sr('Compliance status', pill(o.compliance_status, o.compliance_status)) + sr('Source URL', o.regulatory_url ? `<a class="ext" href="${esc(o.regulatory_url)}" target="_blank" rel="noopener">${esc(o.regulatory_url)}</a>` : '—') + sr('Monitor', o.monitor ? `${esc(o.monitor.id)} · ${pill(o.monitor.status)} · ${esc(o.monitor.schedule)}` : '<span class="muted">none</span>') + sr('Last verified', fmt(o.last_verified_at)))}
      <div class="actions"><button class="btn" data-a="rc0">Run-check · no change</button><button class="btn" data-a="rc1">Run-check · changed</button>${o.compliance_status === 'Pending Review' ? '<button class="btn primary" data-a="accept">Accept review → Current</button>' : ''}</div>
      ${grp(`Scan history (${(o.scans || []).length})`, T, `<table class="grid"><thead><tr><th>When</th><th>Result</th><th>Summary</th></tr></thead><tbody>${(o.scans || []).map((s) => `<tr><td class="muted">${fmt(s.scraped_at)}</td><td>${pill(s.changed ? 'changed' : 'same')}</td><td>${esc(s.diff_summary || '—')}</td></tr>`).join('') || '<tr><td colspan=3 class="muted">No scans.</td></tr>'}</tbody></table>`)}`;
    body.querySelector('[data-a=rc0]').onclick = () => act(() => post(`/obligations/${id}/run-check`, { changed: false }), 'Verified — no change');
    body.querySelector('[data-a=rc1]').onclick = () => act(() => post(`/obligations/${id}/run-check`, { changed: true, diffSummary: 'Manual run-check flagged a change.' }), 'Change recorded → Pending Review');
    const ac = body.querySelector('[data-a=accept]'); if (ac) ac.onclick = () => act(() => post(`/obligations/${id}/accept`), 'Marked Current');
  } else if (sel.section === 'decks') {
    const p = await get('/projects/' + id); const T = { kind: 'deck', name: p.name };
    const rows = [...p.rows].sort((a, b) => Number(b.nri) - Number(a.nri)).map((r) => `<tr><td>${esc(r.owner)}</td><td class="muted">${esc(r.type)}</td><td class="num mono">${esc(r.nri)}</td></tr>`).join('');
    const cur = p.curative.map((c) => `<tr><td style="width:84px">${pill(c.severity)}</td><td><b>${esc(c.title)}</b><div class="muted">${esc((c.detail || '').replace(/\*\*/g, ''))}</div></td><td class="num" style="width:110px">${c.status === 'open' ? `<button class="btn sm" data-cur="${c.id}">Resolve</button>` : pill(c.status)}</td></tr>`).join('');
    body.innerHTML = `<p class="s-eyebrow">${esc(p.tract?.legal || '')}</p>
      ${grp('Identity', T, sr('Project', esc(p.name)) + sr('Unit', esc(p.unit_id || '—')) + sr('Basis', esc(p.basis)) + sr('Total NRI', `<span class="mono">${esc(p.total_nri)}</span> ${pill(p.balances ? 'balanced' : 'unbalanced')}`) + sr('Approval', p.approved_at ? `${pill('approved')} <span class="muted">${fmt(p.approved_at)}</span>` : '<span class="muted">draft</span>'))}
      ${grp('Deck (tract basis, 8/8)', T, `<table class="grid"><thead><tr><th>Owner</th><th>Type</th><th class="num">NRI</th></tr></thead><tbody>${rows}<tr class="deck-total"><td colspan=2>TOTAL</td><td class="num mono">${esc(p.total_nri)}</td></tr></tbody></table>`)}
      <div class="actions"><button class="btn primary" data-a="approve" ${p.balances ? '' : 'disabled'}>Approve deck</button></div>
      ${grp(`Curative & defects (${p.curative.length})`, T, `<table class="grid"><tbody>${cur}</tbody></table>`)}`;
    body.querySelectorAll('[data-cur]').forEach((b) => b.onclick = () => act(() => post(`/projects/${id}/curative/${b.dataset.cur}`, { status: 'resolved' }), 'Curative resolved'));
    body.querySelector('[data-a=approve]').onclick = () => act(() => post(`/projects/${id}/approve`), 'Deck approved ✓');
  } else if (sel.section === 'discovery') {
    const d = cache.discoveries.find((x) => x.id === id) || {}; const T = { kind: 'disc', name: d.root_domain || '' };
    body.innerHTML = `<p class="s-eyebrow">Discovered report</p>
      ${grp('Candidate', T, sr('URL', `<a class="ext" href="${esc(d.discovered_url)}" target="_blank" rel="noopener">${esc(d.discovered_url)}</a>`) + sr('Summary', esc(d.summary || '—')) + sr('Matched terms', esc((d.matched_terms || []).join(', '))) + sr('Risk tier', pill(d.risk_tier || '—')) + sr('Jurisdiction', esc(d.jurisdiction_level || '—')) + sr('Suggested sheet', esc(d.suggested_sheet || '—')) + sr('Status', pill(d.status)))}
      ${d.status === 'new' ? '<div class="actions"><button class="btn primary" data-a="promote">Promote to obligation</button><button class="btn danger" data-a="reject">Reject</button></div>' : ''}`;
    const pr = body.querySelector('[data-a=promote]'); if (pr) pr.onclick = () => act(() => post(`/discoveries/${id}/promote`), 'Promoted to obligation');
    const rj = body.querySelector('[data-a=reject]'); if (rj) rj.onclick = () => act(() => post(`/discoveries/${id}/reject`), 'Rejected');
  } else if (sel.section === 'monitors') {
    const m = cache.monitors.find((x) => x.id === id) || {}; const T = { kind: 'mon', name: m.id };
    body.innerHTML = `<p class="s-eyebrow">Firecrawl monitor</p>
      ${grp('Monitor', T, sr('URL', `<a class="ext" href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.url)}</a>`) + sr('Schedule', esc(m.schedule)) + sr('Last check', fmt(m.last_check_at)) + sr('Last result', pill(m.last_status)) + sr('Status', pill(m.status)) + sr('Obligation', esc(m.obligation_id || '—')))}
      <div class="actions"><button class="btn" data-a="toggle">${m.status === 'active' ? 'Pause monitor' : 'Resume monitor'}</button></div>`;
    body.querySelector('[data-a=toggle]').onclick = () => act(() => post(`/monitors/${id}/toggle`), 'Monitor updated');
  }
}

// ---- inspector ----
function ifield(l, v) { return `<div class="ifield"><div class="il">${esc(l)}</div><div class="iv">${v}</div></div>`; }
function renderInspector() {
  const b = $('#inspBody');
  const o = sel.section === 'compliance' && sel.targetId && cache.obligations.find((x) => x.id === sel.targetId);
  const p = sel.section === 'decks' && sel.targetId && cache.projects.find((x) => x.id === sel.targetId);
  const m = sel.section === 'monitors' && sel.targetId && cache.monitors.find((x) => x.id === sel.targetId);
  const dd = sel.section === 'discovery' && sel.targetId && cache.discoveries.find((x) => x.id === sel.targetId);
  if (o) b.innerHTML = `<div class="insp-sec">Identity and Type</div>${ifield('Agency', esc(o.governing_agency))}${ifield('Citation', `<span class="iv mono">${esc(o.cfr_citation || '—')}</span>`)}${ifield('Type', 'Compliance obligation')}<div class="insp-sec">Risk</div>${ifield('Tier', pill(o.risk_tier))}${ifield('Policy', pill(o.policy_action))}${ifield('Status', pill(o.compliance_status, o.compliance_status))}<div class="insp-sec">Source</div>${ifield('Monitor', o.firecrawl_monitor_id ? `<span class="mono">${esc(o.firecrawl_monitor_id)}</span>` : '<span class="muted">none</span>')}`;
  else if (p) b.innerHTML = `<div class="insp-sec">Identity and Type</div>${ifield('Project', esc(p.name))}${ifield('Unit', esc(p.unit_id || '—'))}${ifield('Type', 'DOI deck')}<div class="insp-sec">Deck</div>${ifield('Owners', p.rows)}${ifield('Total NRI', `<span class="mono">${esc(p.total_nri)}</span>`)}${ifield('Balanced', pill(p.balances ? 'balanced' : 'unbalanced'))}${ifield('Open curative', p.openCurative)}${ifield('Approval', p.approved_at ? pill('approved') : '<span class="muted">draft</span>')}`;
  else if (m) b.innerHTML = `<div class="insp-sec">Identity and Type</div>${ifield('Monitor', `<span class="mono">${esc(m.id)}</span>`)}${ifield('Type', 'Firecrawl monitor')}${ifield('Schedule', esc(m.schedule))}<div class="insp-sec">State</div>${ifield('Status', pill(m.status))}${ifield('Last result', pill(m.last_status))}${ifield('Last check', fmt(m.last_check_at))}`;
  else if (dd) b.innerHTML = `<div class="insp-sec">Identity and Type</div>${ifield('Domain', esc(dd.root_domain))}${ifield('Type', 'Discovered report')}${ifield('Risk', pill(dd.risk_tier || '—'))}${ifield('Jurisdiction', esc(dd.jurisdiction_level || '—'))}${ifield('Status', pill(dd.status))}`;
  else { const d = cache.dash; b.innerHTML = `<div class="insp-sec">Identity and Type</div>${ifield('Name', 'IOS+ Operation')}${ifield('Operator', 'op1')}${ifield('Type', 'Management console')}<div class="insp-sec">Totals</div>${ifield('Obligations', d.obligations.total)}${ifield('Pending review', d.obligations.pendingReview)}${ifield('Monitors active', `${d.monitors.active} / ${d.monitors.total}`)}${ifield('Decks balanced', `${d.projects.balanced} / ${d.projects.total}`)}<div class="insp-empty">Select a target to inspect it.</div>`; }
}

// ---- glue ----
function syncTabs() { document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.section === sel.section)); }
async function render() { syncTabs(); renderChrome(); renderNavigator(); renderSubbar(); renderTargets(); renderInspector(); await renderSettings(); }
async function act(fn, msg) { try { await fn(); await loadAll(); toast(msg); await render(); } catch (e) { toast(e.message, true); } }
async function reload() { await loadAll(); await render(); }

document.querySelectorAll('#tabbar button').forEach((b) => b.onclick = () => { sel.section = b.dataset.section; sel.targetId = null; sel.filter = 'all'; sel.query = ''; render(); });
$('#navFilter').oninput = (e) => { sel.query = (e.target.value || ''); renderNavigator(); renderTargets(); };
$('#togNav').onclick = () => document.body.classList.toggle('hide-nav');
$('#togInsp').onclick = () => document.body.classList.toggle('hide-insp');
$('#btnRefresh').onclick = () => reload();
$('#btnAdd').onclick = () => { if (sel.section === 'compliance' && sel.targetId) act(() => post(`/obligations/${sel.targetId}/run-check`, { changed: false }), 'Run-check queued'); else toast('Select an obligation to run a check'); };
$('#btnReset').onclick = async () => { await post('/admin/reset'); sel.targetId = null; await reload(); toast('Demo data reset'); };

loadAll().then(render).catch((e) => { $('#settings').innerHTML = `<div class="grp" style="color:var(--crit)">Failed to load: ${esc(e.message)}</div>`; });
