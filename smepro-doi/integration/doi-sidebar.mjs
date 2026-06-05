// @ts-check
/**
 * SMEPro DOI Builder — embeddable intelligence-sidebar widget.
 *
 * Framework-agnostic: mount into any container (React ref, Vue, or plain DOM).
 * Context-aware: call setContext() when the map selection changes (tract/unit/well)
 * and the panel scopes its header to it.
 *
 *   import { mountDoiSidebar } from './doi-sidebar.mjs';
 *   const sb = mountDoiSidebar(document.getElementById('intel-rail'), {
 *     context: { label: 'Morales Unit #1H', sublabel: 'Tract 1 · 40 ac' },
 *     // host-provided, AUTHENTICATED extractor (Reporter IOS+ backend → Claude):
 *     extract: (payload) => fetch('/api/title/extract', {
 *       method:'POST', headers:{'content-type':'application/json', authorization:`Bearer ${idToken}`},
 *       body: JSON.stringify(payload) }).then(r => r.json()),
 *     onDeckBuilt: (analysis, project) => saveToReporter(analysis, project), // persist + audit
 *   });
 *   // later: sb.setContext({...}); sb.loadProject(project); sb.destroy();
 *
 * The deterministic engine does ALL math; the host injects networking/auth.
 */
import { analyzeTitleProject } from '../engine/engine.mjs';
import { extractFromText, buildProjectFromExtraction } from '../engine/extraction.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PRETTY = { mineralConveyance: 'Deed', oilGasLease: 'O&G Lease', assignment: 'Assignment', orriAssignment: 'ORRI Assignment', affidavitOfHeirship: 'Affidavit of Heirship', unitDesignation: 'Unit Designation', completionReport: 'Completion' };
const TYPE_CLASS = { 'Royalty (NPRI)': 'npri', 'Mineral (Lessor Royalty)': 'min', 'ORRI': 'orri', 'Working Interest (NRI)': 'wi' };
const LOGO = `<svg class="doi-sb__logo" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="16" height="16" rx="3" fill="#0E2548"/><rect x="20" y="0" width="16" height="16" rx="3" fill="#34A853"/><rect x="0" y="20" width="16" height="16" rx="3" fill="#557095"/><rect x="20" y="20" width="16" height="16" rx="3" fill="#0A1E3D"/><path d="M8 4v8M4 8h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M23 23.5 28 21.5 33 23.5C33 27 31 30.5 28 32.5 25 30.5 23 27 23 23.5Z" stroke="#fff" stroke-width="1.2" fill="none"/></svg>`;

function abToBase64(buf) {
  const b = new Uint8Array(buf); let s = ''; const c = 0x8000;
  for (let i = 0; i < b.length; i += c) s += String.fromCharCode.apply(null, b.subarray(i, i + c));
  return btoa(s);
}
const safeAnalyze = (project) => { try { return { ok: true, a: analyzeTitleProject(project), project }; } catch (e) { return { ok: false, error: e.message }; } };

const TABS = [
  { id: 'import', label: 'Import' }, { id: 'run', label: 'Run Sheet' }, { id: 'tree', label: 'Ownership' },
  { id: 'lease', label: 'Lease' }, { id: 'doi', label: 'DOI' }, { id: 'cure', label: 'Curative' },
];

/**
 * @param {HTMLElement} container
 * @param {{ project?:any, context?:{label:string,sublabel?:string}, extract?:(p:any)=>Promise<any>,
 *           onDeckBuilt?:(analysis:any,project:any)=>void, sampleText?:string }} [opts]
 */
export function mountDoiSidebar(container, opts = {}) {
  const init = opts.project ? safeAnalyze(opts.project) : null;
  const st = {
    tab: init && init.ok ? 'doi' : 'import',
    basis: 'tract',
    context: opts.context || null,
    result: init && init.ok ? init.a : null,
    error: init && !init.ok ? init.error : null,
    extraction: null,
    intakeText: opts.sampleText || '',
    intakePdf: null,
    extract: opts.extract || null,
    onDeckBuilt: opts.onDeckBuilt || null,
  };

  const root = document.createElement('div');
  root.className = 'doi-sb';
  container.appendChild(root);

  const dec = (f, p = 8) => f.toDecimal(p);

  /* ---- panels ---- */
  function panelImport() {
    if (st.extraction) return panelReview();
    const aiReady = !!st.extract;
    return `<h3>Import title records</h3>
      <p class="sub">Paste text or load a file, then review every extracted field (with source + confidence) before any decimal is computed.</p>
      <div class="row">
        <label class="btn">Load .txt/.pdf<input id="f" type="file" accept=".txt,.md,.csv,.pdf" hidden></label>
        ${st.intakePdf ? `<span class="chip chip--info">PDF: ${esc(st.intakePdf.name)}</span>` : ''}
      </div>
      <textarea id="ta" spellcheck="false">${esc(st.intakeText)}</textarea>
      <div class="row" style="margin-top:10px">
        ${aiReady ? `<button class="btn btn--primary" id="ai">Extract with Claude ▷</button>` : ''}
        <button class="btn" id="heur">Extract (heuristic)</button>
      </div>
      ${aiReady ? '' : `<p class="muted" style="font-size:11px">AI extraction (scanned PDFs / free-form deeds) activates when the host wires an authenticated <code>extract()</code>.</p>`}`;
  }
  function panelReview() {
    const r = st.extraction;
    const need = r.documents.reduce((a, d) => a + d.fields.filter((f) => f.needsDecision).length, 0);
    const cards = r.documents.map((d, di) => `<div class="rv">
      <div class="rv__h"><span class="pill wi">${esc(PRETTY[d.kind] || d.kind)}</span><b>${esc(d.title)}</b></div>
      ${d.fields.map((f, fi) => {
        const editable = typeof f.value !== 'object';
        return `<div class="rvf ${f.needsDecision ? 'need' : ''}">
          <div class="rvf__top">
            <label><input type="checkbox" data-d="${di}" data-f="${fi}" class="inc" ${f.status === 'rejected' ? '' : 'checked'}/>${esc(f.label)}</label>
            <span class="chip ${f.needsDecision ? 'chip--hi' : f.confidence >= 0.8 ? 'chip--ok' : 'chip--info'}">${f.needsDecision ? 'decide' : Math.round(f.confidence * 100) + '%'}</span>
          </div>
          ${editable ? `<input class="v" data-d="${di}" data-f="${fi}" value="${esc(f.value)}"/>` : `<div class="snip mono">${esc(JSON.stringify(f.value))}</div>`}
          ${f.snippet ? `<div class="snip">${esc(f.snippet.slice(0, 90))}</div>` : ''}
        </div>`;
      }).join('')}</div>`).join('');
    return `<h3>Confirm extracted facts</h3>
      <div class="row">
        <span class="chip chip--info">${r.documents.length} docs</span>
        <span class="chip ${need ? 'chip--hi' : 'chip--ok'}">${need} need a decision</span>
        <span class="chip chip--info">${r.engine}</span>
      </div>
      <div class="row"><button class="btn" id="back">← Text</button><button class="btn btn--primary" id="build">Build DOI →</button></div>
      ${cards}`;
  }
  function panelDoi() {
    if (!st.result) return `<p class="muted">Import documents and build the deck first.</p>`;
    const d = st.result.doi, useUnit = st.basis === 'unit' && st.result.unit;
    const rows = [...d.rows].sort((a, b) => b.nri.toNumber() - a.nri.toNumber()).map((r) => `<tr>
      <td>${esc(r.owner)}</td><td><span class="pill ${TYPE_CLASS[r.type] || ''}">${esc(r.type.replace(/ \(.*\)/, ''))}</span></td>
      <td class="num">${dec(useUnit ? r.unitNri : r.nri)}</td></tr>`).join('');
    const total = useUnit ? d.unitFactor : d.total;
    return `<h3>Division of Interest${useUnit ? ` · unit ×${dec(d.unitFactor, 4)}` : ''}</h3>
      <div class="row">
        <button class="btn ${st.basis === 'tract' ? 'btn--primary' : ''}" data-basis="tract">Tract 8/8</button>
        <button class="btn ${st.basis === 'unit' ? 'btn--primary' : ''}" data-basis="unit" ${st.result.unit ? '' : 'disabled'}>Unit</button>
      </div>
      <table class="tbl"><thead><tr><th>Owner</th><th>Type</th><th class="num">${useUnit ? 'Unit NRI' : 'NRI'}</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2">TOTAL</td><td class="num">${dec(total)}</td></tr></tfoot></table>`;
  }
  function panelCure() {
    if (!st.result) return `<p class="muted">No analysis yet.</p>`;
    return st.result.curative.map((c) => `<div class="flag flag--${c.severity}"><div class="fr"></div>
      <div class="fb"><div class="ft">${esc(c.title)}</div><div class="fd">${esc(c.detail).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</div></div></div>`).join('');
  }
  function panelTree() {
    if (!st.result) return `<p class="muted">No analysis yet.</p>`;
    const d = st.result.doi, pct = (f) => (f.toNumber() * 100).toFixed(3) + '%';
    const o = st.result.ownership;
    const line = (n, frac) => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--g30)"><span>${esc(n)}</span><span class="mono muted">${esc(frac)}</span></div>`;
    return `<h3>How 8/8 splits</h3>
      <div class="bar"><span style="width:${pct(d.totalNpri)};background:#34A853"></span><span style="width:${pct(d.mineralRoyaltyPool)};background:#003070"></span><span style="width:${pct(d.totalOrri)};background:#6070B0"></span><span style="width:${pct(d.wiNet)};background:#002040"></span></div>
      <div class="row"><span class="chip chip--ok">NPRI ${dec(d.totalNpri, 4)}</span><span class="chip chip--info">Min ${dec(d.mineralRoyaltyPool, 4)}</span><span class="chip chip--info">ORRI ${dec(d.totalOrri, 4)}</span><span class="chip chip--info">WI ${dec(d.wiNet, 4)}</span></div>
      <h3 style="margin-top:14px">Royalty owners</h3>
      ${o.npris.flatMap((n) => n.owners.map((x) => line(x.name, x.share.toFractionString() + ' NPRI'))).join('')}
      ${o.minerals.map((m) => line(m.name, m.fraction.toFractionString() + ' min')).join('')}
      <h3 style="margin-top:14px">Leasehold</h3>
      ${o.orris.map((x) => line(x.name, dec(x.quantum, 4) + ' ORRI')).join('')}
      ${o.wi.map((w) => line(w.name, w.fraction.toFractionString() + ' WI')).join('')}`;
  }
  function panelLease() {
    if (!st.result || !st.result.lease) return `<p class="muted">No lease found.</p>`;
    const L = st.result.lease, d = st.result.doi;
    return `<div class="stat"><div class="l">Operator</div><div class="v" style="font-size:13px">${esc(st.result.ownership.wi.map((w) => w.name).join(', '))}</div></div>
      <div class="stat"><div class="l">Lease royalty</div><div class="v">${L.royalty.toFractionString()}</div></div>
      <div class="stat"><div class="l">ORRI burden</div><div class="v">${dec(d.totalOrri, 4)}</div></div>
      <div class="stat"><div class="l">Net WI NRI</div><div class="v">${dec(d.wiNet)}</div></div>
      ${L.pughDepthNote ? `<p class="muted" style="font-size:11px;margin-top:8px"><b>Pugh:</b> ${esc(L.pughDepthNote)}</p>` : ''}`;
  }
  function panelRun() {
    if (!st.result) return `<p class="muted">No analysis yet.</p>`;
    return `<div class="timeline">${st.result.runSheet.map((d) => `<div class="tli">
      <div class="d">${esc(d.date)}</div><div class="t">${esc(d.title || d.id)}</div>
      ${(d.effects || []).map((e) => `<div class="muted" style="font-size:11px">→ ${esc(e)}</div>`).join('')}</div>`).join('')}</div>`;
  }

  function body() {
    switch (st.tab) {
      case 'import': return panelImport();
      case 'run': return panelRun();
      case 'tree': return panelTree();
      case 'lease': return panelLease();
      case 'doi': return panelDoi();
      case 'cure': return panelCure();
      default: return '';
    }
  }
  function footer() {
    if (st.tab === 'import' || !st.result) return '';
    const balanced = st.result.doi.balances;
    return `<span class="chip ${balanced ? 'chip--ok' : 'chip--err'}">${balanced ? '✓ balances 1.00000000' : '✗ unbalanced'}</span>
      <span style="flex:1"></span>
      <button class="btn" id="csv">CSV</button>
      ${st.onDeckBuilt ? `<button class="btn btn--primary" id="save">Save to Reporter</button>` : ''}`;
  }

  function render() {
    const hasResult = !!st.result;
    root.innerHTML = `
      <div class="doi-sb__head">${LOGO}
        <div class="doi-sb__t"><b>Title / DOI</b><span>SMEPro Engine</span></div>
        ${st.context ? `<div class="doi-sb__ctx"><b>${esc(st.context.label)}</b>${st.context.sublabel ? esc(st.context.sublabel) : ''}</div>` : ''}
      </div>
      <div class="doi-sb__tabs">${TABS.map((t) => `<button class="doi-sb__tab ${st.tab === t.id ? 'is-on' : ''}" data-tab="${t.id}" ${t.id !== 'import' && !hasResult ? 'disabled' : ''}>${t.label}</button>`).join('')}</div>
      <div class="doi-sb__body">${st.error ? `<div class="flag flag--critical"><div class="fr"></div><div class="fb"><div class="ft">Could not analyze</div><div class="fd">${esc(st.error)}</div></div></div>` : body()}
        <div class="disc">Work product for landman review — not a title opinion. Math is exact (rational).</div></div>
      <div class="doi-sb__foot">${footer()}</div>`;
    wire();
  }

  function wire() {
    root.querySelectorAll('[data-tab]').forEach((el) => el.addEventListener('click', () => { if (!el.disabled) { st.tab = el.getAttribute('data-tab'); render(); } }));
    root.querySelectorAll('[data-basis]').forEach((el) => el.addEventListener('click', () => { if (!el.disabled) { st.basis = el.getAttribute('data-basis'); render(); } }));

    const ta = root.querySelector('#ta'); if (ta) ta.addEventListener('input', () => { st.intakeText = ta.value; });
    const f = root.querySelector('#f');
    if (f) f.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0]; if (!file) return;
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        st.intakePdf = { name: file.name, base64: abToBase64(await file.arrayBuffer()), mediaType: 'application/pdf' };
      } else { st.intakeText = await file.text(); st.intakePdf = null; }
      render();
    });
    const heur = root.querySelector('#heur');
    if (heur) heur.addEventListener('click', () => {
      const t = (root.querySelector('#ta') || {}).value || st.intakeText;
      if (!t.trim()) return alert('Paste or load text first (heuristic needs a text layer).');
      try { st.extraction = extractFromText(t); render(); } catch (err) { alert('Extraction failed: ' + err.message); }
    });
    const ai = root.querySelector('#ai');
    if (ai) ai.addEventListener('click', async () => {
      ai.disabled = true; ai.textContent = 'Extracting…';
      try {
        const t = (root.querySelector('#ta') || {}).value || st.intakeText;
        const payload = st.intakePdf ? { pdfBase64: st.intakePdf.base64, mediaType: st.intakePdf.mediaType, text: t || undefined } : { text: t };
        st.extraction = await st.extract(payload); render();
      } catch (err) { alert('Claude extraction failed: ' + err.message); render(); }
    });
    const back = root.querySelector('#back'); if (back) back.addEventListener('click', () => { st.extraction = null; render(); });
    root.querySelectorAll('.v').forEach((el) => el.addEventListener('input', () => { const fd = st.extraction.documents[+el.dataset.d].fields[+el.dataset.f]; fd.value = el.value; fd.status = 'edited'; }));
    root.querySelectorAll('.inc').forEach((el) => el.addEventListener('change', () => { const fd = st.extraction.documents[+el.dataset.d].fields[+el.dataset.f]; fd.status = el.checked ? 'pending' : 'rejected'; }));
    const build = root.querySelector('#build');
    if (build) build.addEventListener('click', () => {
      try {
        const project = buildProjectFromExtraction(st.extraction);
        st.result = analyzeTitleProject(project); st.lastProject = project; st.extraction = null; st.tab = 'doi'; render();
        if (st.onDeckBuilt) st.onDeckBuilt(st.result, project);
      } catch (err) { alert('Could not build analysis: ' + err.message); }
    });
    const csv = root.querySelector('#csv'); if (csv) csv.addEventListener('click', () => downloadCsv());
    const save = root.querySelector('#save'); if (save && st.onDeckBuilt) save.addEventListener('click', () => st.onDeckBuilt(st.result, st.lastProject || null));
  }

  function downloadCsv() {
    const useUnit = st.basis === 'unit' && st.result.unit;
    const head = ['Owner', 'Type', 'Fractional Share', useUnit ? 'Unit NRI' : 'NRI', 'Source'];
    const lines = [head.join(',')];
    for (const r of st.result.doi.rows) lines.push([r.owner, r.type, r.fractionLabel, dec(useUnit ? r.unitNri : r.nri), r.source].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `DOI_${(st.context && st.context.label || 'deck').replace(/[^a-z0-9]+/gi, '_')}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  render();
  return {
    setContext(ctx) { st.context = ctx; render(); },
    loadProject(project) { const r = safeAnalyze(project); st.result = r.ok ? r.a : null; st.error = r.ok ? null : r.error; st.tab = r.ok ? 'doi' : 'import'; render(); },
    getResult() { return st.result; },
    destroy() { root.remove(); },
  };
}

export default mountDoiSidebar;
