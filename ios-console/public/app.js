// IOS+ Management Console — Xcode-style SPA. Runs against the HTTP API, or against
// an inlined window.IOS_API handler in the single-file build (file:// with no server).
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cl = (s) => String(s ?? '').replace(/\s+/g, ''); // "Pending Review" -> "PendingReview" for class names
const pill = (v, label) => `<span class="pill ${cl(v)}">${esc(label ?? v)}</span>`;
const dot = (v) => `<span class="dot ${cl(v)}">●</span>`;
const fmt = (t) => (t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

async function api(path, opts = {}) {
  // Inlined handler (single-file build)?
  if (typeof window !== 'undefined' && window.IOS_API) {
    const m = (opts.method || 'GET').toUpperCase();
    const u = new URL(path, 'http://x'); const q = Object.fromEntries(u.searchParams.entries());
    const body = opts.body ? JSON.parse(opts.body) : null;
    const { status, json } = window.IOS_API(m, u.pathname.replace(/^\/api/, '/api'), q, body);
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

function toast(msg, bad = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- state ----------
const SECTIONS = ['dashboard', 'compliance', 'discovery', 'decks', 'monitors'];
const SECTION_LABEL = { dashboard: 'Dashboard', compliance: 'Compliance', discovery: 'Discovery', decks: 'DOI Decks', monitors: 'Monitors' };
const sel = { section: 'dashboard', id: null };
const collapsed = {};
let cache = {};

async function loadAll() {
  const [dash, obl, disc, proj, mon] = await Promise.all([
    get('/dashboard'), get('/obligations'), get('/discoveries'), get('/projects'), get('/monitors'),
  ]);
  cache = { dash, obligations: obl.items, discoveries: disc.items, projects: proj.items, monitors: mon.items };
  return cache;
}

// ---------- toolbar / jumpbar ----------
function renderStatus() {
  const d = cache.dash;
  $('#statusSub').textContent = `${d.obligations.total} obligations · ${d.monitors.active} monitors · ${d.projects.total} decks`;
  const warn = d.obligations.pendingReview + d.discoveries.new;
  const w = $('#statusWarn'); w.hidden = warn === 0; w.querySelector('em').textContent = warn;
}
function renderJumpbar() {
  const parts = [`<span class="crumb"><span class="ico">▤</span> IOS+ Operation</span>`,
    `<span class="sep">›</span><span class="crumb">${esc(SECTION_LABEL[sel.section])}</span>`];
  if (sel.id) {
    const nm = selectedLabel();
    if (nm) parts.push(`<span class="sep">›</span><span class="crumb">${esc(nm)}</span>`);
  }
  $('#jumpbar').innerHTML = parts.join(' ');
}
function selectedLabel() {
  if (sel.section === 'compliance') return (cache.obligations.find((o) => o.id === sel.id) || {}).governing_agency;
  if (sel.section === 'decks') return (cache.projects.find((p) => p.id === sel.id) || {}).name;
  if (sel.section === 'monitors') return sel.id;
  if (sel.section === 'discovery') { const d = cache.discoveries.find((x) => x.id === sel.id); return d && d.root_domain; }
  return null;
}

// ---------- navigator ----------
function navGroup(section, ico, children) {
  const isColl = collapsed[section];
  const items = children.filter(navMatch);
  const kids = items.map((c) => `
    <div class="tw-row ${sel.section === section && sel.id === c.id ? 'sel' : ''}" data-section="${section}" data-id="${esc(c.id)}">
      ${c.status ? dot(c.status) : '<span class="tw-ico">•</span>'}<span class="lbl">${esc(c.label)}</span>${c.meta ? `<span class="count">${esc(c.meta)}</span>` : ''}
    </div>`).join('');
  return `
    <div class="tw-group">
      <div class="tw-row ${isColl ? 'collapsed' : ''} ${sel.section === section && !sel.id ? 'sel' : ''}" data-section="${section}" data-group="1">
        <span class="tri">▼</span><span class="tw-ico">${ico}</span><span class="lbl">${SECTION_LABEL[section]}</span><span class="count">${items.length}</span>
      </div>
      <div class="tw-children" ${isColl ? 'style="display:none"' : ''}>${kids}</div>
    </div>`;
}
let navFilterText = '';
function navMatch(c) { return !navFilterText || c.label.toLowerCase().includes(navFilterText); }
function renderNavigator() {
  const obl = cache.obligations.map((o) => ({ id: o.id, label: `${o.governing_agency} — ${o.cfr_citation || o.report_form_name || ''}`.trim(), status: o.compliance_status }));
  const disc = cache.discoveries.map((d) => ({ id: d.id, label: d.root_domain, status: d.status, meta: d.risk_tier }));
  const proj = cache.projects.map((p) => ({ id: p.id, label: p.name, status: p.approved_at ? 'good' : (p.balances ? 'same' : 'Error') }));
  const mon = cache.monitors.map((m) => ({ id: m.id, label: m.id, status: m.status }));
  $('#navTree').innerHTML =
    `<div class="tw-row ${sel.section === 'dashboard' ? 'sel' : ''}" data-section="dashboard" data-group="1"><span class="tri" style="visibility:hidden">▼</span><span class="tw-ico">◫</span><span class="lbl">Dashboard</span></div>`
    + navGroup('compliance', '§', obl) + navGroup('discovery', '🔎', disc) + navGroup('decks', '▦', proj) + navGroup('monitors', '◷', mon);
  $('#navTree').querySelectorAll('.tw-row').forEach((row) => {
    row.onclick = () => {
      const s = row.dataset.section;
      if (row.dataset.group && s !== 'dashboard') {
        if (sel.section === s && !sel.id) { collapsed[s] = !collapsed[s]; }
        sel.section = s; sel.id = null;
      } else { sel.section = s; sel.id = row.dataset.id || null; }
      syncTabs(); render();
    };
  });
}

// ---------- editor ----------
function group(title, rowsHtml) { return `<div class="group"><div class="ghead"><span class="tri">▼</span>${esc(title)}</div>${rowsHtml}</div>`; }
function srow(k, v) { return `<div class="srow"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`; }

async function renderEditor() {
  const body = $('#editorBody');
  if (sel.section === 'dashboard') return renderDashboard(body);
  if (sel.id) return renderDetail(body);
  return renderSectionList(body);
}

function renderDashboard(body) {
  const d = cache.dash;
  const tile = (l, n, s, k = '') => `<div class="tile ${k}"><div class="l">${l}</div><div class="n">${n}</div><div class="s">${s}</div></div>`;
  const bars = ['Current', 'Pending Review', 'Error', 'Unmonitored'].map((k) => {
    const n = d.obligations.byStatus[k] || 0, pct = d.obligations.total ? Math.round((n / d.obligations.total) * 100) : 0;
    return `<div style="margin:9px 0"><div style="display:flex;justify-content:space-between">${pill(k)}<span class="muted">${n}</span></div>
      <div style="height:7px;background:#eceef1;border-radius:5px;margin-top:4px;overflow:hidden"><div style="width:${pct}%;height:100%;background:var(--sel)"></div></div></div>`;
  }).join('');
  body.innerHTML = `
    <p class="eyebrow">Operations overview</p><h1 class="title">Dashboard</h1>
    <div class="tiles" style="margin-top:16px">
      ${tile('Obligations', d.obligations.total, `${d.obligations.byTier.CRITICAL || 0} critical`)}
      ${tile('Pending Review', d.obligations.pendingReview, 'regulatory change', d.obligations.pendingReview ? 'alert' : '')}
      ${tile('Active Monitors', d.monitors.active, `${d.monitors.changed} flagged`)}
      ${tile('New Discoveries', d.discoveries.new, 'awaiting triage', d.discoveries.new ? 'alert' : '')}
      ${tile('DOI Decks', d.projects.total, `${d.projects.balanced} balanced · ${d.projects.approved} approved`, 'good')}
      ${tile('Open Curative', d.projects.openCurative, 'defects to cure')}
    </div>
    <div class="cols2">
      <div>${group('Compliance status', bars)}</div>
      <div><div class="group"><div class="ghead"><span class="tri">▼</span>Recent activity</div>
        <ul class="feed">${(d.activity || []).map((a) => `<li><span class="fdot ${esc(a.kind)}"></span><div>${esc(a.message)}<time>${fmt(a.at)}</time></div></li>`).join('') || '<li class="muted">No activity.</li>'}</ul></div></div>
    </div>`;
}

function renderSectionList(body) {
  if (sel.section === 'compliance') {
    const rows = cache.obligations.map((o) => `<tr class="click" data-id="${o.id}"><td><b>${esc(o.governing_agency)}</b><div class="muted">${esc(o.specific_activity || '')}</div></td>
      <td>${esc(o.cfr_citation || '—')}</td><td>${pill(o.risk_tier)}</td><td>${pill(o.policy_action)}</td><td>${pill(o.compliance_status, o.compliance_status)}</td><td class="muted">${fmt(o.last_verified_at)}</td></tr>`).join('');
    body.innerHTML = `<p class="eyebrow">Universal Compliance Decoding Matrix</p><h1 class="title">Compliance</h1>
      <div class="group" style="margin-top:14px"><table class="grid"><thead><tr><th>Agency</th><th>Citation</th><th>Risk</th><th>Policy</th><th>Status</th><th>Verified</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } else if (sel.section === 'discovery') {
    const rows = cache.discoveries.map((d) => `<tr class="click" data-id="${d.id}"><td><a class="ext" href="${esc(d.discovered_url)}" target="_blank" rel="noopener">${esc(d.discovered_url)}</a><div class="muted">${esc(d.summary || '')}</div></td>
      <td>${pill(d.risk_tier || '—')}</td><td>${esc(d.jurisdiction_level || '—')}</td><td>${pill(d.status)}</td></tr>`).join('');
    body.innerHTML = `<p class="eyebrow">Firecrawl map discoveries</p><h1 class="title">Discovery</h1>
      <div class="group" style="margin-top:14px"><table class="grid"><thead><tr><th>Discovered URL</th><th>Risk</th><th>Jurisdiction</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } else if (sel.section === 'decks') {
    const rows = cache.projects.map((p) => `<tr class="click" data-id="${p.id}"><td><b>${esc(p.name)}</b></td><td class="num">${p.rows}</td><td class="num" style="font-family:ui-monospace,Menlo,monospace">${esc(p.total_nri)}</td>
      <td>${pill(p.balances ? 'good' : 'Error', p.balances ? 'balanced' : 'unbalanced')}</td><td class="num">${p.openCurative}</td><td>${p.approved_at ? pill('promoted', 'approved') : '<span class="muted">draft</span>'}</td></tr>`).join('');
    body.innerHTML = `<p class="eyebrow">Division-of-Interest decks (engine-computed)</p><h1 class="title">DOI Decks</h1>
      <div class="group" style="margin-top:14px"><table class="grid"><thead><tr><th>Project</th><th class="num">Owners</th><th class="num">Total NRI</th><th>Balanced</th><th class="num">Open curative</th><th>Approval</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } else if (sel.section === 'monitors') {
    const rows = cache.monitors.map((m) => `<tr class="click" data-id="${m.id}"><td style="font-family:ui-monospace,Menlo,monospace">${esc(m.id)}</td><td><a class="ext" href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.url)}</a></td>
      <td>${esc(m.schedule)}</td><td class="muted">${fmt(m.last_check_at)}</td><td>${pill(m.last_status)}</td><td>${pill(m.status)}</td></tr>`).join('');
    body.innerHTML = `<p class="eyebrow">Recurring server-side scrapes</p><h1 class="title">Monitors</h1>
      <div class="group" style="margin-top:14px"><table class="grid"><thead><tr><th>Monitor</th><th>URL</th><th>Schedule</th><th>Last check</th><th>Result</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  body.querySelectorAll('tr.click').forEach((tr) => tr.onclick = () => { sel.id = tr.dataset.id; render(); });
}

async function renderDetail(body) {
  if (sel.section === 'compliance') {
    const o = await get('/obligations/' + sel.id);
    body.innerHTML = `<p class="eyebrow">${esc(o.regulation_name || 'Compliance obligation')}</p><h1 class="title">${esc(o.governing_agency)} — ${esc(o.cfr_citation || o.report_form_name || '')}</h1>
      ${group('Regulation & Filing', srow('Specific activity', esc(o.specific_activity || '—')) + srow('Report / form', `${esc(o.report_form_name || '—')} <span class="muted">${esc(o.form_code || '')}</span>`)
        + srow('Filing frequency', esc(o.filing_frequency || '—')) + srow('Key due dates', esc(o.key_due_dates || '—')) + srow('Penalties', esc(o.penalties || '—')))}
      ${group('Classification', srow('Jurisdiction', esc(o.jurisdiction_level || '—')) + srow('Risk tier', pill(o.risk_tier)) + srow('Policy action', pill(o.policy_action)) + srow('Sheet', esc(o.sheet_code || '—')))}
      ${group('Monitoring', srow('Status', pill(o.compliance_status, o.compliance_status)) + srow('Source URL', o.regulatory_url ? `<a class="ext" href="${esc(o.regulatory_url)}" target="_blank" rel="noopener">${esc(o.regulatory_url)}</a>` : '—')
        + srow('Monitor', o.monitor ? `${esc(o.monitor.id)} · ${pill(o.monitor.status)} · ${esc(o.monitor.schedule)}` : '<span class="muted">none</span>') + srow('Last verified', fmt(o.last_verified_at)))}
      <div class="actions">
        <button class="btn" data-act="rc0">Run-check · no change</button>
        <button class="btn" data-act="rc1">Run-check · changed</button>
        ${o.compliance_status === 'Pending Review' ? '<button class="btn primary" data-act="accept">Accept review → Current</button>' : ''}
      </div>
      ${group(`Scan history (${(o.scans || []).length})`, `<table class="grid"><thead><tr><th>When</th><th>Result</th><th>Summary</th></tr></thead><tbody>${(o.scans || []).map((s) => `<tr><td class="muted">${fmt(s.scraped_at)}</td><td>${pill(s.changed ? 'changed' : 'same')}</td><td>${esc(s.diff_summary || '—')}</td></tr>`).join('') || '<tr><td colspan=3 class="muted">No scans.</td></tr>'}</tbody></table>`)}`;
    body.querySelector('[data-act=rc0]').onclick = () => act(() => post(`/obligations/${sel.id}/run-check`, { changed: false }), 'Verified — no change');
    body.querySelector('[data-act=rc1]').onclick = () => act(() => post(`/obligations/${sel.id}/run-check`, { changed: true, diffSummary: 'Manual run-check flagged a change.' }), 'Change recorded → Pending Review');
    const ac = body.querySelector('[data-act=accept]'); if (ac) ac.onclick = () => act(() => post(`/obligations/${sel.id}/accept`), 'Marked Current');
  } else if (sel.section === 'decks') {
    const p = await get('/projects/' + sel.id);
    const rows = [...p.rows].sort((a, b) => Number(b.nri) - Number(a.nri))
      .map((r) => `<tr><td>${esc(r.owner)}</td><td class="muted">${esc(r.type)}</td><td class="num" style="font-family:ui-monospace,Menlo,monospace">${esc(r.nri)}</td></tr>`).join('');
    const cur = p.curative.map((c) => `<tr><td style="width:84px">${pill(c.severity)}</td><td><b>${esc(c.title)}</b><div class="muted">${esc((c.detail || '').replace(/\*\*/g, ''))}</div></td>
      <td class="num" style="width:120px">${c.status === 'open' ? `<button class="btn sm" data-cur="${c.id}">Resolve</button>` : pill(c.status)}</td></tr>`).join('');
    body.innerHTML = `<p class="eyebrow">${esc(p.tract?.legal || '')}</p><h1 class="title">${esc(p.name)}</h1>
      ${group('Deck (tract basis, 8/8)', `<table class="grid"><thead><tr><th>Owner</th><th>Type</th><th class="num">NRI</th></tr></thead><tbody>${rows}<tr class="deck-total"><td colspan=2>TOTAL</td><td class="num" style="font-family:ui-monospace,Menlo,monospace">${esc(p.total_nri)}</td></tr></tbody></table>`)}
      <div class="actions"><button class="btn primary" data-act="approve" ${p.balances ? '' : 'disabled'}>Approve deck</button>${p.approved_at ? `<span class="muted" style="align-self:center">Approved ${fmt(p.approved_at)}</span>` : ''}</div>
      ${group(`Curative & defects (${p.curative.length})`, `<table class="grid"><tbody>${cur}</tbody></table>`)}`;
    body.querySelectorAll('[data-cur]').forEach((b) => b.onclick = () => act(() => post(`/projects/${sel.id}/curative/${b.dataset.cur}`, { status: 'resolved' }), 'Curative resolved'));
    body.querySelector('[data-act=approve]').onclick = () => act(() => post(`/projects/${sel.id}/approve`), 'Deck approved ✓');
  } else if (sel.section === 'discovery') {
    const d = cache.discoveries.find((x) => x.id === sel.id) || {};
    body.innerHTML = `<p class="eyebrow">Discovered report</p><h1 class="title">${esc(d.root_domain || '')}</h1>
      ${group('Candidate', srow('URL', `<a class="ext" href="${esc(d.discovered_url)}" target="_blank" rel="noopener">${esc(d.discovered_url)}</a>`) + srow('Summary', esc(d.summary || '—'))
        + srow('Matched terms', esc((d.matched_terms || []).join(', '))) + srow('Risk tier', pill(d.risk_tier || '—')) + srow('Jurisdiction', esc(d.jurisdiction_level || '—')) + srow('Status', pill(d.status)))}
      ${d.status === 'new' ? `<div class="actions"><button class="btn primary" data-act="promote">Promote to obligation</button><button class="btn danger" data-act="reject">Reject</button></div>` : ''}`;
    const pr = body.querySelector('[data-act=promote]'); if (pr) pr.onclick = () => act(() => post(`/discoveries/${sel.id}/promote`), 'Promoted to obligation');
    const rj = body.querySelector('[data-act=reject]'); if (rj) rj.onclick = () => act(() => post(`/discoveries/${sel.id}/reject`), 'Rejected');
  } else if (sel.section === 'monitors') {
    const m = cache.monitors.find((x) => x.id === sel.id) || {};
    body.innerHTML = `<p class="eyebrow">Firecrawl monitor</p><h1 class="title">${esc(m.id)}</h1>
      ${group('Monitor', srow('URL', `<a class="ext" href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.url)}</a>`) + srow('Schedule', esc(m.schedule)) + srow('Last check', fmt(m.last_check_at)) + srow('Last result', pill(m.last_status)) + srow('Status', pill(m.status)) + srow('Obligation', esc(m.obligation_id || '—')))}
      <div class="actions"><button class="btn" data-act="toggle">${m.status === 'active' ? 'Pause monitor' : 'Resume monitor'}</button></div>`;
    body.querySelector('[data-act=toggle]').onclick = () => act(() => post(`/monitors/${sel.id}/toggle`), 'Monitor updated');
  }
}

// ---------- inspector ----------
function ifield(l, v) { return `<div class="ifield"><div class="il">${esc(l)}</div><div class="iv">${v}</div></div>`; }
function renderInspector() {
  const b = $('#inspBody');
  if (sel.section === 'compliance' && sel.id) {
    const o = cache.obligations.find((x) => x.id === sel.id) || {};
    b.innerHTML = `<div class="insp-sec">Identity</div>${ifield('Agency', esc(o.governing_agency))}${ifield('Citation', `<span class="mono">${esc(o.cfr_citation || '—')}</span>`)}${ifield('Jurisdiction', esc(o.jurisdiction_level || '—'))}
      <div class="insp-sec">Risk</div>${ifield('Tier', pill(o.risk_tier))}${ifield('Policy action', pill(o.policy_action))}${ifield('Status', pill(o.compliance_status, o.compliance_status))}
      <div class="insp-sec">Source</div>${ifield('Monitor', o.firecrawl_monitor_id ? `<span class="mono">${esc(o.firecrawl_monitor_id)}</span>` : '<span class="muted">none</span>')}`;
  } else if (sel.section === 'decks' && sel.id) {
    const p = cache.projects.find((x) => x.id === sel.id) || {};
    b.innerHTML = `<div class="insp-sec">Identity</div>${ifield('Project', esc(p.name))}${ifield('Unit', esc(p.unit_id || '—'))}
      <div class="insp-sec">Deck</div>${ifield('Owners', p.rows)}${ifield('Total NRI', `<span class="mono">${esc(p.total_nri)}</span>`)}${ifield('Balanced', pill(p.balances ? 'good' : 'Error', p.balances ? 'yes' : 'no'))}${ifield('Open curative', p.openCurative)}${ifield('Approval', p.approved_at ? pill('promoted', 'approved') : '<span class="muted">draft</span>')}`;
  } else if (sel.section === 'monitors' && sel.id) {
    const m = cache.monitors.find((x) => x.id === sel.id) || {};
    b.innerHTML = `<div class="insp-sec">Identity</div>${ifield('Monitor', `<span class="mono">${esc(m.id)}</span>`)}${ifield('Schedule', esc(m.schedule))}<div class="insp-sec">State</div>${ifield('Status', pill(m.status))}${ifield('Last result', pill(m.last_status))}${ifield('Last check', fmt(m.last_check_at))}`;
  } else if (sel.section === 'discovery' && sel.id) {
    const d = cache.discoveries.find((x) => x.id === sel.id) || {};
    b.innerHTML = `<div class="insp-sec">Identity</div>${ifield('Domain', esc(d.root_domain))}${ifield('Risk', pill(d.risk_tier || '—'))}${ifield('Jurisdiction', esc(d.jurisdiction_level || '—'))}${ifield('Status', pill(d.status))}`;
  } else {
    const d = cache.dash;
    b.innerHTML = `<div class="insp-sec">Operation</div>${ifield('Operator', 'op1')}${ifield('Obligations', d.obligations.total)}${ifield('Pending review', d.obligations.pendingReview)}${ifield('Monitors active', `${d.monitors.active} / ${d.monitors.total}`)}${ifield('Decks balanced', `${d.projects.balanced} / ${d.projects.total}`)}
      <div class="insp-empty">Select an item in the navigator to inspect it.</div>`;
  }
}

// ---------- glue ----------
function syncTabs() { document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.section === sel.section)); }
async function render() { renderStatus(); renderJumpbar(); renderNavigator(); renderInspector(); await renderEditor(); }
async function act(fn, msg) { try { await fn(); await loadAll(); toast(msg); await render(); } catch (e) { toast(e.message, true); } }
async function reload() { await loadAll(); await render(); }

document.querySelectorAll('#tabbar button').forEach((b) => b.onclick = () => { sel.section = b.dataset.section; sel.id = null; syncTabs(); render(); });
$('#navFilter').oninput = (e) => { navFilterText = (e.target.value || '').toLowerCase(); renderNavigator(); };
$('#togNav').onclick = () => document.body.classList.toggle('hide-nav');
$('#togInsp').onclick = () => document.body.classList.toggle('hide-insp');
$('#btnRefresh').onclick = () => reload();
$('#btnReset').onclick = async () => { await post('/admin/reset'); sel.id = null; await reload(); toast('Demo data reset'); };

loadAll().then(render).catch((e) => { $('#editorBody').innerHTML = `<div class="group" style="color:var(--crit)">Failed to load: ${esc(e.message)}</div>`; });
