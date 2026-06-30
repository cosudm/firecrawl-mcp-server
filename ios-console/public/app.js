// Reporter IOS+ Management Console — SPA (vanilla, no build).
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cls = (s) => String(s ?? '').replace(/\s+/g, '.'); // "Pending Review" -> "Pending.Review" for pill class
const pill = (v) => `<span class="pill ${cls(v)}">${esc(v)}</span>`;
const fmt = (t) => (t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

async function api(path, opts) {
  const res = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.message || json.error || res.statusText), { body: json, status: res.status });
  return json;
}
function toast(msg, bad = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}
function modal(html) {
  $('#modalBody').innerHTML = html; $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; }

// ---------- views ----------
const views = {};

views.dashboard = async () => {
  const d = await api('/dashboard');
  const stat = (label, num, sub, kind = '') =>
    `<div class="card stat ${kind}"><div class="label">${label}</div><div class="num">${num}</div>${sub ? `<div class="sub2">${sub}</div>` : ''}</div>`;
  view.innerHTML = `
    <h2 class="section">Operations Dashboard</h2>
    <p class="sub">Live state across compliance, monitoring, discovery, and division-of-interest decks.</p>
    <div class="grid stats">
      ${stat('Obligations', d.obligations.total, `${d.obligations.byTier.CRITICAL || 0} critical`)}
      ${stat('Pending Review', d.obligations.pendingReview, 'regulatory change detected', d.obligations.pendingReview ? 'alert' : '')}
      ${stat('Active Monitors', d.monitors.active, `${d.monitors.changed} flagged change`)}
      ${stat('Discoveries (new)', d.discoveries.new, 'awaiting triage', d.discoveries.new ? 'alert' : '')}
      ${stat('DOI Decks', d.projects.total, `${d.projects.balanced} balanced · ${d.projects.approved} approved`, 'good')}
      ${stat('Open Curative', d.projects.openCurative, 'title defects to cure')}
    </div>
    <div class="cols2" style="margin-top:16px">
      <div class="card">
        <h4>Compliance status</h4>
        ${statusBars(d.obligations.byStatus, d.obligations.total)}
      </div>
      <div class="card">
        <h4>Recent activity</h4>
        <ul class="feed">${(d.activity || []).map((a) =>
          `<li><span class="dot ${esc(a.kind)}"></span><div><div>${esc(a.message)}</div><time>${fmt(a.at)}</time></div></li>`).join('') || '<li class="muted">No activity yet.</li>'}</ul>
      </div>
    </div>`;
};
function statusBars(byStatus, total) {
  const order = ['Current', 'Pending Review', 'Error', 'Unmonitored'];
  return order.map((k) => {
    const n = byStatus[k] || 0; const pct = total ? Math.round((n / total) * 100) : 0;
    return `<div style="margin:8px 0"><div style="display:flex;justify-content:space-between"><span>${pill(k)}</span><span class="muted">${n}</span></div>
      <div style="height:8px;background:#eef0f3;border-radius:6px;margin-top:4px;overflow:hidden"><div style="width:${pct}%;height:100%;background:var(--brand)"></div></div></div>`;
  }).join('');
};

views.compliance = async () => {
  const q = new URLSearchParams(views._cf || {});
  const { items } = await api('/obligations?' + q);
  view.innerHTML = `
    <h2 class="section">Compliance Matrix</h2>
    <p class="sub">Universal Compliance Decoding Matrix — obligations and their monitor state.</p>
    <div class="toolbar">
      <input type="search" id="cq" placeholder="Search agency, CFR, rule…" value="${esc((views._cf||{}).q||'')}">
      <select id="cstatus">${['', 'Current', 'Pending Review', 'Error', 'Unmonitored'].map((s) => `<option ${((views._cf||{}).status===s)?'selected':''} value="${s}">${s || 'All statuses'}</option>`).join('')}</select>
      <div class="spacer"></div><span class="muted">${items.length} obligation(s)</span>
    </div>
    <div class="card" style="padding:0">
      <table><thead><tr><th>Agency</th><th>Citation</th><th>Report / Form</th><th>Risk</th><th>Policy</th><th>Status</th><th>Verified</th></tr></thead>
      <tbody>${items.map((o) => `
        <tr class="row-click" data-id="${o.id}">
          <td><strong>${esc(o.governing_agency)}</strong><div class="muted">${esc(o.specific_activity||'')}</div></td>
          <td class="mono">${esc(o.cfr_citation||'—')}</td>
          <td>${esc(o.report_form_name||'—')}<div class="muted">${esc(o.form_code||'')}</div></td>
          <td>${pill(o.risk_tier)}</td><td>${pill(o.policy_action)}</td>
          <td>${pill(o.compliance_status)}</td><td class="muted">${fmt(o.last_verified_at)}</td>
        </tr>`).join('') || `<tr><td colspan="7" class="muted" style="padding:24px;text-align:center">No matches.</td></tr>`}</tbody></table>
    </div>`;
  $('#cq').oninput = debounce((e) => { views._cf = { ...(views._cf||{}), q: e.target.value || undefined }; views.compliance(); }, 250);
  $('#cstatus').onchange = (e) => { views._cf = { ...(views._cf||{}), status: e.target.value || undefined }; views.compliance(); };
  view.querySelectorAll('.row-click').forEach((tr) => tr.onclick = () => obligationModal(tr.dataset.id));
};

async function obligationModal(id) {
  const o = await api('/obligations/' + id);
  modal(`
    <h3>${esc(o.governing_agency)} — ${esc(o.cfr_citation || o.report_form_name || '')}</h3>
    <p class="muted">${esc(o.regulation_name || '')}</p>
    <dl class="kv">
      <dt>Specific activity</dt><dd>${esc(o.specific_activity || '—')}</dd>
      <dt>Report / form</dt><dd>${esc(o.report_form_name || '—')} <span class="muted">${esc(o.form_code||'')}</span></dd>
      <dt>Filing frequency</dt><dd>${esc(o.filing_frequency || '—')}</dd>
      <dt>Key due dates</dt><dd>${esc(o.key_due_dates || '—')}</dd>
      <dt>Penalties</dt><dd>${esc(o.penalties || '—')}</dd>
      <dt>Risk / policy</dt><dd>${pill(o.risk_tier)} ${pill(o.policy_action)} ${o.risk_weight!=null?`<span class="muted">weight ${o.risk_weight}</span>`:''}</dd>
      <dt>Jurisdiction</dt><dd>${esc(o.jurisdiction_level || '—')}</dd>
      <dt>Status</dt><dd>${pill(o.compliance_status)}</dd>
      <dt>Source</dt><dd>${o.regulatory_url ? `<a class="ext" href="${esc(o.regulatory_url)}" target="_blank" rel="noopener">${esc(o.regulatory_url)}</a>` : '—'}</dd>
      <dt>Monitor</dt><dd>${o.monitor ? `${esc(o.monitor.id)} · ${pill(o.monitor.status)} · ${esc(o.monitor.schedule)}` : '<span class="muted">none</span>'}</dd>
    </dl>
    <div class="btn-row">
      <button class="btn" id="rcSame">Run-check · no change</button>
      <button class="btn" id="rcChanged">Run-check · changed</button>
      ${o.compliance_status === 'Pending Review' ? '<button class="btn primary" id="accept">Accept review → Current</button>' : ''}
    </div>
    <h4 style="margin-top:20px">Scan history</h4>
    <table><thead><tr><th>When</th><th>Result</th><th>Summary</th></tr></thead><tbody>
    ${(o.scans||[]).map((s)=>`<tr><td class="muted">${fmt(s.scraped_at)}</td><td>${pill(s.changed?'changed':'same')}</td><td>${esc(s.diff_summary||'—')}</td></tr>`).join('')||'<tr><td colspan=3 class="muted">No scans.</td></tr>'}
    </tbody></table>`);
  const rc = (changed) => async () => {
    try { await api(`/obligations/${id}/run-check`, { method: 'POST', body: JSON.stringify({ changed, diffSummary: changed ? 'Manual run-check flagged a change.' : null }) });
      toast(changed ? 'Change recorded → Pending Review' : 'Verified — no change'); closeModal(); current(); } catch (e) { toast(e.message, true); }
  };
  $('#rcSame').onclick = rc(false); $('#rcChanged').onclick = rc(true);
  if ($('#accept')) $('#accept').onclick = async () => { try { await api(`/obligations/${id}/accept`, { method:'POST' }); toast('Marked Current'); closeModal(); current(); } catch(e){ toast(e.message,true); } };
}

views.discovery = async () => {
  const { items } = await api('/discoveries');
  view.innerHTML = `
    <h2 class="section">Discovery Inbox</h2>
    <p class="sub">New report URLs surfaced by Firecrawl <code>map</code>. Promote into the matrix or reject.</p>
    <div class="card" style="padding:0"><table>
      <thead><tr><th>Discovered URL</th><th>Matched</th><th>Risk</th><th>Jurisdiction</th><th>Status</th><th></th></tr></thead>
      <tbody>${items.map((d)=>`<tr>
        <td><a class="ext" href="${esc(d.discovered_url)}" target="_blank" rel="noopener">${esc(d.discovered_url)}</a>
            <div class="muted">${esc(d.summary||'')}</div></td>
        <td class="muted">${(d.matched_terms||[]).map(esc).join(', ')}</td>
        <td>${pill(d.risk_tier||'—')}</td><td>${esc(d.jurisdiction_level||'—')}</td><td>${pill(d.status)}</td>
        <td class="num">${d.status==='new'?`<div class="btn-row"><button class="btn primary sm" data-promote="${d.id}">Promote</button><button class="btn danger sm" data-reject="${d.id}">Reject</button></div>`:'<span class="muted">—</span>'}</td>
      </tr>`).join('')||'<tr><td colspan=6 class="muted" style="padding:24px;text-align:center">Inbox empty.</td></tr>'}</tbody></table></div>`;
  view.querySelectorAll('[data-promote]').forEach((b)=>b.onclick=async()=>{try{await api(`/discoveries/${b.dataset.promote}/promote`,{method:'POST'});toast('Promoted to obligation');current();}catch(e){toast(e.message,true);}});
  view.querySelectorAll('[data-reject]').forEach((b)=>b.onclick=async()=>{try{await api(`/discoveries/${b.dataset.reject}/reject`,{method:'POST'});toast('Rejected');current();}catch(e){toast(e.message,true);}});
};

views.decks = async () => {
  const { items } = await api('/projects');
  view.innerHTML = `
    <h2 class="section">Division-of-Interest Decks</h2>
    <p class="sub">NRI decks computed by the deterministic title engine — every deck must close to <span class="mono">1.00000000</span>.</p>
    <div class="card" style="padding:0"><table>
      <thead><tr><th>Project</th><th>Unit</th><th class="num">Owners</th><th class="num">Total NRI</th><th>Balanced</th><th class="num">Open curative</th><th>Approval</th></tr></thead>
      <tbody>${items.map((p)=>`<tr class="row-click" data-id="${p.id}">
        <td><strong>${esc(p.name)}</strong></td><td class="muted">${esc(p.unit_id||'—')}</td>
        <td class="num">${p.rows}</td><td class="num mono">${esc(p.total_nri)}</td>
        <td>${pill(p.balances?'good':'Error')}</td><td class="num">${p.openCurative}</td>
        <td>${p.approved_at?pill('promoted'):'<span class="muted">draft</span>'}</td>
      </tr>`).join('')}</tbody></table></div>`;
  view.querySelectorAll('.row-click').forEach((tr)=>tr.onclick=()=>deckModal(tr.dataset.id));
};

async function deckModal(id) {
  const p = await api('/projects/' + id);
  const rows = [...p.rows].sort((a,b)=>Number(b.nri)-Number(a.nri));
  modal(`
    <h3>${esc(p.name)}</h3>
    <p class="muted">${esc(p.tract?.legal||'')}</p>
    <dl class="kv">
      <dt>Basis</dt><dd>${esc(p.basis)}</dd>
      <dt>Total NRI</dt><dd class="mono">${esc(p.total_nri)} ${p.balances?pill('good'):pill('Error')}</dd>
      <dt>Approval</dt><dd>${p.approved_at?`${pill('promoted')} <span class="muted">${fmt(p.approved_at)}</span>`:'<span class="muted">draft</span>'}</dd>
    </dl>
    <h4>Deck (tract basis, 8/8)</h4>
    <table><thead><tr><th>Owner</th><th>Type</th><th class="num">NRI</th></tr></thead><tbody>
      ${rows.map((r)=>`<tr><td>${esc(r.owner)}</td><td class="muted">${esc(r.type)}</td><td class="num mono">${esc(r.nri)}</td></tr>`).join('')}
      <tr class="deck-total"><td colspan=2>TOTAL</td><td class="num mono">${esc(p.total_nri)}</td></tr>
    </tbody></table>
    <h4 style="margin-top:18px">Curative & defects (${p.curative.length})</h4>
    <table><tbody>${p.curative.map((c)=>`<tr>
      <td style="width:90px">${pill(c.severity)}</td>
      <td><strong>${esc(c.title)}</strong><div class="muted">${esc((c.detail||'').replace(/\*\*/g,''))}</div></td>
      <td class="num" style="width:130px">${c.status==='open'?`<button class="btn sm" data-cur="${c.id}">Mark resolved</button>`:pill(c.status)}</td>
    </tr>`).join('')}</tbody></table>
    <div class="btn-row" style="margin-top:18px">
      <button class="btn primary" id="approve" ${(!p.balances)?'disabled title="deck unbalanced"':''}>Approve deck</button>
    </div>`);
  view.querySelectorAll && document.querySelectorAll('[data-cur]').forEach((b)=>b.onclick=async()=>{try{await api(`/projects/${id}/curative/${b.dataset.cur}`,{method:'POST',body:JSON.stringify({status:'resolved'})});toast('Curative resolved');deckModal(id);current();}catch(e){toast(e.message,true);}});
  const ap = document.querySelector('#approve');
  if (ap) ap.onclick = async () => { try { await api(`/projects/${id}/approve`,{method:'POST'}); toast('Deck approved ✓'); closeModal(); current(); } catch(e){ toast(e.message,true); } };
}

views.monitors = async () => {
  const { items } = await api('/monitors');
  view.innerHTML = `
    <h2 class="section">Firecrawl Monitors</h2>
    <p class="sub">Recurring server-side scrapes that diff each result. Loop 1 reconciles checks into the matrix.</p>
    <div class="card" style="padding:0"><table>
      <thead><tr><th>Monitor</th><th>URL</th><th>Schedule</th><th>Last check</th><th>Last result</th><th>Status</th><th></th></tr></thead>
      <tbody>${items.map((m)=>`<tr>
        <td class="mono">${esc(m.id)}</td>
        <td><a class="ext" href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.url)}</a></td>
        <td>${esc(m.schedule)}</td><td class="muted">${fmt(m.last_check_at)}</td>
        <td>${pill(m.last_status)}</td><td>${pill(m.status)}</td>
        <td class="num"><button class="btn sm" data-tog="${m.id}">${m.status==='active'?'Pause':'Resume'}</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  view.querySelectorAll('[data-tog]').forEach((b)=>b.onclick=async()=>{try{await api(`/monitors/${b.dataset.tog}/toggle`,{method:'POST'});toast('Monitor updated');current();}catch(e){toast(e.message,true);}});
};

// ---------- shell ----------
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }
let _view = 'dashboard';
const current = () => views[_view]();
async function go(name) {
  _view = name;
  document.querySelectorAll('#tabs button').forEach((b)=>b.classList.toggle('active', b.dataset.view===name));
  view.innerHTML = '<div class="loading">Loading…</div>';
  try { await views[name](); } catch (e) { view.innerHTML = `<div class="card" style="color:var(--crit)">Error: ${esc(e.message)}</div>`; }
}
document.querySelectorAll('#tabs button').forEach((b)=>b.onclick=()=>go(b.dataset.view));
$('#modalClose').onclick = closeModal;
$('#modal').onclick = (e)=>{ if (e.target.id==='modal') closeModal(); };
$('#reset').onclick = async ()=>{ await api('/admin/reset',{method:'POST'}); toast('Demo data reset'); current(); };

async function health(){ try { await api('/health'); $('#health').className='health ok'; } catch { $('#health').className='health bad'; } }
health(); setInterval(health, 15000);
go('dashboard');
