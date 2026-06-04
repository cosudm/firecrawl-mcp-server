// @ts-check
/*
 * SMEPro DOI Builder — UI layer.
 *
 * This file is engine-agnostic in spirit: it reads ONLY the result object returned
 * by analyzeTitleProject() and renders the five steps. It performs no title math.
 *
 * In the single-file build, `analyzeTitleProject`, `bentonMorales`, and `Fraction`
 * are concatenated into scope ahead of this file. In dev (module mode) they are
 * attached to window.SMEPRO by index.html. We resolve from either location.
 */
const ENGINE = (typeof analyzeTitleProject !== 'undefined')
  ? { analyzeTitleProject, project: bentonMorales, extractFromText, buildProjectFromExtraction, sourceText: bentonMoralesSource }
  : window.SMEPRO;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);

let BASIS = 'tract'; // 'tract' | 'unit'
let MODE = 'analysis';      // 'analysis' | 'intake' | 'review'
let EXTRACTION = null;      // current ExtractionResult during import
let RESULT = ENGINE.analyzeTitleProject(ENGINE.project);

// v1.1 import state
let BACKEND = { available: false, hasKey: false, model: null };
let INTAKE_TEXT = null;     // current Intake textarea content (persists across repaints)
let INTAKE_PDF = null;      // { name, base64, mediaType } when a PDF is loaded

/* ----------------------------------------------------------- Run sheet ----- */
function renderRunSheet(r) {
  const items = r.runSheet.map((d) => {
    const lang = d.exactLanguage ? `<div class="tl-lang">“${esc(d.exactLanguage)}”</div>` : '';
    const effects = (d.effects || []).map((e) => `<li>${esc(e)}</li>`).join('');
    const rec = d.recording ? ` · <span class="src">${esc(d.recording)}</span>` : '';
    return `<div class="tl-item">
      <div class="tl-date">${esc(d.date)}${rec}</div>
      <div class="tl-title">${esc(d.title || d.id)}</div>
      <div class="tl-meta">${esc(prettyKind(d.kind))}</div>
      <ul class="tl-effects">${effects}</ul>
      ${lang}
    </div>`;
  }).join('');
  return `<div class="card"><div class="card__title">Chronological Run Sheet · ${r.runSheet.length} instruments</div>
    <div class="timeline">${items}</div></div>`;
}
function prettyKind(k) {
  return ({ mineralConveyance: 'Deed / Mineral Conveyance', oilGasLease: 'Oil & Gas Lease', assignment: 'Assignment of Lease',
    orriAssignment: 'ORRI Assignment', affidavitOfHeirship: 'Affidavit of Heirship', unitDesignation: 'Unit Designation',
    completionReport: 'Completion Report' }[k] || k);
}

/* ------------------------------------------------------- Ownership tree ----- */
function renderOwnership(r) {
  const o = r.ownership;
  const npri = o.npris[0];
  const npriOwners = npri ? npri.owners.map((x) =>
    `<div class="tree-row"><span class="nm">${esc(x.name)}</span>
       <span class="frac">${esc(x.share.toFractionString())} of NPRI</span>
       <span class="role">non-participating royalty</span></div>`).join('') : '';
  const minerals = o.minerals.map((m) =>
    `<div class="tree-row"><span class="nm">${esc(m.name)}</span>
       <span class="frac">${esc(m.fraction.toFractionString())} minerals</span>
       <span class="role">executive + royalty</span></div>`).join('');
  const wi = o.wi.map((w) =>
    `<div class="tree-row"><span class="nm">${esc(w.name)}</span>
       <span class="frac">${esc(w.fraction.toFractionString())} WI</span></div>`).join('');
  const orris = o.orris.map((x) =>
    `<div class="tree-row"><span class="nm">${esc(x.name)}</span>
       <span class="frac">${esc(x.quantum.toDecimal(4))} ORRI</span></div>`).join('');

  const royalty = r.doi.royalty, wiGross = r.doi.wiGross;
  const bar = `<div class="bar">
    <span style="width:${pct(r.doi.totalNpri)}; background:#34A853" title="NPRI"></span>
    <span style="width:${pct(r.doi.mineralRoyaltyPool)}; background:#003070" title="Mineral royalty"></span>
    <span style="width:${pct(r.doi.totalOrri)}; background:#6070B0" title="ORRI"></span>
    <span style="width:${pct(r.doi.wiNet)}; background:#002040" title="WI net"></span>
  </div>`;

  return `<div class="card">
    <div class="card__title">How 100% of production splits (8/8 → 1.00000000)</div>
    ${bar}
    <div class="kpi-row note">
      <span class="badge badge--ok"><span class="dot" style="background:#34A853"></span>NPRI ${r.doi.totalNpri.toDecimal(4)}</span>
      <span class="badge badge--info"><span class="dot" style="background:#003070"></span>Mineral royalty ${r.doi.mineralRoyaltyPool.toDecimal(4)}</span>
      <span class="badge badge--info" style="color:#3B5270"><span class="dot" style="background:#6070B0"></span>ORRI ${r.doi.totalOrri.toDecimal(4)}</span>
      <span class="badge badge--info"><span class="dot" style="background:#002040"></span>WI net ${r.doi.wiNet.toDecimal(4)}</span>
    </div>
  </div>
  <div class="flow">
    <div class="card"><div class="card__title">Royalty Estate · ${royalty.toDecimal(4)} of 8/8</div>
      <div class="pool"><h4>Non-Participating Royalty (carved off the top)</h4>${npriOwners}</div>
      <div class="pool" style="margin-top:12px"><h4>Participating Minerals (share remaining royalty)</h4>${minerals}</div>
    </div>
    <div class="card"><div class="card__title">Leasehold Estate · ${wiGross.toDecimal(4)} of 8/8</div>
      <div class="pool"><h4>Overriding Royalty (carved off the WI)</h4>${orris}</div>
      <div class="pool" style="margin-top:12px"><h4>Working Interest</h4>${wi}</div>
    </div>
  </div>`;
}
function pct(frac) { return (frac.toNumber() * 100).toFixed(4) + '%'; }

/* --------------------------------------------------------- Lease step ------ */
function renderLease(r) {
  const L = r.lease;
  const rows = r.ownership.orris.map((o) =>
    `<tr><td>${esc(o.name)}</td><td>ORRI</td><td class="num">${o.quantum.toDecimal(4)}</td><td class="src">${esc(o.id)}</td></tr>`).join('');
  return `<div class="summary-grid">
      <div class="stat"><div class="stat__label">Operator / WI</div><div class="stat__value">${esc(r.ownership.wi.map(w=>w.name).join(', '))}</div></div>
      <div class="stat"><div class="stat__label">Lease Royalty</div><div class="stat__value">${L.royalty.toFractionString()}</div><div class="stat__hint">${L.royalty.toDecimal(5)}</div></div>
      <div class="stat"><div class="stat__label">Total ORRI Burden</div><div class="stat__value">${r.doi.totalOrri.toDecimal(4)}</div></div>
      <div class="stat"><div class="stat__label">Net WI NRI</div><div class="stat__value">${r.doi.wiNet.toDecimal(5)}</div><div class="stat__hint">8/8 − royalty − ORRI</div></div>
    </div>
    <div class="card"><div class="card__title">Overriding Royalty Interests</div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Owner</th><th>Type</th><th>Quantum</th><th>Source</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="muted">None of record.</td></tr>'}</tbody></table></div>
    </div>
    ${L.pughDepthNote ? `<div class="card"><div class="card__title">Lease provisions</div>
      <p class="tl-meta"><strong>Pugh / depth:</strong> ${esc(L.pughDepthNote)}</p>
      ${L.noDeductionsNote ? `<p class="tl-meta"><strong>Cost-bearing:</strong> ${esc(L.noDeductionsNote)}</p>` : ''}</div>` : ''}`;
}

/* ----------------------------------------------------------- DOI deck ------ */
function renderDoi(r) {
  const unit = r.unit;
  const useUnit = BASIS === 'unit' && unit;
  const rows = [...r.doi.rows].sort((a, b) => b.nri.toNumber() - a.nri.toNumber());
  const body = rows.map((row) => {
    const dec = (useUnit ? row.unitNri : row.nri).toDecimal(8);
    return `<tr>
      <td>${esc(row.owner)}</td>
      <td><span class="type-pill" data-t="${esc(row.type)}">${esc(row.type)}</span></td>
      <td class="muted">${esc(row.fractionLabel)}</td>
      <td class="num">${dec}</td>
      <td class="src">${esc(row.source)}</td>
    </tr>`;
  }).join('');
  const totalFrac = useUnit ? r.doi.unitFactor : r.doi.total;
  const totalDec = totalFrac.toDecimal(8);
  const balanced = r.doi.balances;

  return `<div class="toolbar">
      <div class="toggle">
        <button class="${BASIS==='tract'?'is-active':''}" data-basis="tract">Tract basis (8/8)</button>
        <button class="${BASIS==='unit'?'is-active':''}" data-basis="unit" ${unit?'':'disabled'}>Unit basis (×${unit?r.doi.unitFactor.toDecimal(3):'—'})</button>
      </div>
      <span class="${balanced?'badge badge--ok':'badge badge--critical'}">
        ${balanced ? '✓ Balances to exactly 1.00000000' : '✗ Does NOT balance — export blocked'}
      </span>
      <span style="flex:1"></span>
      <button class="btn" id="dl-csv">Export DOI CSV</button>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Owner Name</th><th>Interest Type</th><th>Fractional Share</th>
          <th class="num">${useUnit ? 'Unit NRI' : 'NRI'} Decimal</th><th>Source</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td colspan="3">TOTAL ${useUnit ? '(subject tract share of unit)' : ''}</td>
          <td class="num">${totalDec}</td><td></td></tr></tfoot>
      </table></div>
    </div>
    ${useUnit ? `<p class="note">Unit basis applies the ${r.doi.unitFactor.toFractionString()} participation factor (${unit.tractAcres}/${unit.unitAcres} ac). Tracts 2 & 3 are unmodeled, so this does not close to 1.0 across the full ${esc(unit.name)}.</p>` : ''}`;
}

function toCsv(r) {
  const useUnit = BASIS === 'unit' && r.unit;
  const head = ['Owner Name', 'Interest Type', 'Fractional Share', useUnit ? 'Unit NRI Decimal' : 'NRI Decimal', 'Source'];
  const lines = [head.join(',')];
  for (const row of r.doi.rows) {
    const dec = (useUnit ? row.unitNri : row.nri).toDecimal(8);
    lines.push([row.owner, row.type, row.fractionLabel, dec, row.source]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
  }
  lines.push(['TOTAL', '', '', (useUnit ? r.doi.unitFactor : r.doi.total).toDecimal(8), ''].map((c)=>`"${c}"`).join(','));
  return lines.join('\n');
}

/* --------------------------------------------------------- Curative -------- */
function renderCurative(r) {
  const counts = { critical: 0, high: 0, medium: 0, info: 0 };
  r.curative.forEach((c) => counts[c.severity]++);
  const chips = `<div class="toolbar">
    <span class="badge badge--critical">${counts.critical} Critical</span>
    <span class="badge badge--high">${counts.high} High</span>
    <span class="badge badge--medium">${counts.medium} Medium</span>
    <span class="badge badge--info">${counts.info} Info</span></div>`;
  const flags = r.curative.map((c) => `
    <div class="flag flag--${c.severity}"><div class="flag__rail"></div>
      <div class="flag__body">
        <div class="flag__head">
          <span class="badge badge--${c.severity}">${c.severity.toUpperCase()}</span>
          <span class="flag__title">${esc(c.title)}</span>
          <span class="flag__code">${esc(c.code)}</span>
        </div>
        <div class="flag__detail">${mdBold(esc(c.detail))}</div>
      </div></div>`).join('');
  return chips + flags;
}
function mdBold(s) { return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }

/* ----------------------------------------------------------- Summary ------- */
function renderSummary(r) {
  return `<div class="summary-grid">
    <div class="stat"><div class="stat__label">Tract</div><div class="stat__value" style="font-size:16px">${esc(r.project.tract.name)}</div><div class="stat__hint">${r.project.tract.grossAcres} gross acres · ${esc(r.project.tract.county || '')} Co., ${esc(r.project.tract.state || '')}</div></div>
    <div class="stat"><div class="stat__label">Stakeholders</div><div class="stat__value">${r.doi.rows.length}</div><div class="stat__hint">on the DOI deck</div></div>
    <div class="stat"><div class="stat__label">Deck Balance</div><div class="stat__value">${r.doi.total.toDecimal(8)}</div><div class="stat__hint">${r.doi.balances ? '✓ exact' : '✗ unbalanced'}</div></div>
    <div class="stat"><div class="stat__label">Curative Items</div><div class="stat__value">${r.curative.length}</div><div class="stat__hint">${r.curative.filter(c=>c.severity==='critical').length} critical</div></div>
  </div>`;
}

/* ------------------------------------------------------------- Wire --------- */
/* --------------------------------------------------------- Intake ---------- */
const isHttp = () => typeof location !== 'undefined' && /^https?:$/.test(location.protocol);

async function probeBackend() {
  if (!isHttp()) return;
  try {
    const h = await (await fetch('/api/health')).json();
    BACKEND = { available: true, hasKey: !!h.hasKey, model: h.model };
  } catch { BACKEND = { available: false, hasKey: false, model: null }; }
  if (MODE === 'intake') paint();
}

function abToBase64(buf) {
  const bytes = new Uint8Array(buf); let bin = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}
let _pdfjs = null;
async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  const v = '4.7.76';
  const lib = await import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${v}/build/pdf.min.mjs`);
  lib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${v}/build/pdf.worker.min.mjs`;
  return (_pdfjs = lib);
}
async function pdfToText(arrayBuffer) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(' ') + '\n';
  }
  return text.trim();
}
async function backendExtract(payload) {
  const res = await fetch('/api/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

function backendChip() {
  if (!isHttp()) return `<span class="badge badge--medium" title="Open via the backend (npm start) to enable AI">Offline file · heuristic only</span>`;
  if (!BACKEND.available) return `<span class="badge badge--medium">AI backend: not detected</span>`;
  if (!BACKEND.hasKey) return `<span class="badge badge--info">AI backend: connected · no key set</span>`;
  return `<span class="badge badge--ok">AI backend: ready · ${esc(BACKEND.model || 'claude')}</span>`;
}

function renderIntake() {
  const text = INTAKE_TEXT != null ? INTAKE_TEXT : (ENGINE.sourceText || '');
  const aiReady = isHttp() && BACKEND.available && BACKEND.hasKey;
  const pdfNote = INTAKE_PDF
    ? `PDF loaded: <b>${esc(INTAKE_PDF.name)}</b> (~${Math.round(INTAKE_PDF.base64.length * 0.75 / 1024)} KB). “Extract with Claude” reads the PDF directly (incl. scanned pages); “Extract (heuristic)” uses the text below.`
    : 'Paste text, or load a <code>.txt</code> / <code>.pdf</code>. Text-PDFs are parsed in-browser; scanned PDFs need the Claude backend.';
  return `<div class="card">
      <div class="card__title">Import title records</div>
      <p class="step__sub" style="margin-bottom:12px">Two ways in: the <b>offline heuristic</b> (paste / <code>.txt</code> / text-PDF), or <b>Claude AI</b> via the backend
        (handles scanned PDFs and free-form deeds). Both produce the same review with a source snippet and confidence per field.</p>
      <div class="toolbar">
        <label class="btn">Load file (.txt/.pdf)<input id="intake-file" type="file" accept=".txt,.md,.csv,.pdf,text/plain,application/pdf" style="display:none"></label>
        <button class="btn" id="intake-sample">Load sample</button>
        ${backendChip()}
        <span style="flex:1"></span>
        <button class="btn" id="extract-btn">Extract (heuristic)</button>
        <button class="btn btn--primary" id="extract-ai-btn" ${aiReady ? '' : 'disabled'} title="${aiReady ? 'Extract with Claude' : 'Run the backend with ANTHROPIC_API_KEY to enable'}">Extract with Claude&nbsp;▷</button>
      </div>
      <div id="intake-hint" class="note" style="margin-bottom:8px">${pdfNote}</div>
      <textarea id="intake-text" spellcheck="false" style="width:100%; min-height:340px; font-family:var(--font-mono); font-size:12.5px;
        border:1px solid var(--border-strong); border-radius:var(--r-md); padding:14px; resize:vertical; color:var(--ink); background:var(--surface-2);">${esc(text)}</textarea>
      <p class="note" style="margin-top:10px">Heuristic mode keeps data in the browser. AI mode sends the document to your backend (<code>server/api.mjs</code>),
        which calls Claude with the key held server-side.</p>
    </div>`;
}

/* --------------------------------------------------------- Review ---------- */
function confChip(c) {
  const pctv = Math.round((c.confidence || 0) * 100);
  const cls = c.needsDecision ? 'high' : c.confidence >= 0.8 ? 'ok' : c.confidence >= 0.6 ? 'info' : 'medium';
  return `<span class="badge badge--${cls}">${c.needsDecision ? 'Needs decision' : pctv + '%'}</span>`;
}
function fieldRow(di, fi, f) {
  const editable = typeof f.value !== 'object';
  const valCell = editable
    ? `<input class="rv-input" data-d="${di}" data-f="${fi}" value="${esc(f.value)}" />`
    : `<code class="src">${esc(JSON.stringify(f.value))}</code>`;
  return `<tr class="${f.needsDecision ? 'rv-needs' : ''}">
      <td><label class="rv-inc"><input type="checkbox" data-d="${di}" data-f="${fi}" ${f.status === 'rejected' ? '' : 'checked'}/> ${esc(f.label)}</label></td>
      <td>${valCell}</td>
      <td>${confChip(f)}</td>
      <td class="src" title="${esc(f.snippet || '')}">${esc((f.snippet || '').slice(0, 70))}${(f.snippet || '').length > 70 ? '…' : ''}</td>
    </tr>`;
}
function renderReview() {
  const r = EXTRACTION;
  const need = r.documents.reduce((a, d) => a + d.fields.filter((f) => f.needsDecision).length, 0);
  const total = r.documents.reduce((a, d) => a + d.fields.length, 0);
  const cards = r.documents.map((d, di) => `
    <div class="card">
      <div class="flag__head" style="margin-bottom:12px">
        <span class="type-pill" data-t="Working Interest (NRI)">${esc(prettyKind(d.kind))}</span>
        <span class="flag__title">${esc(d.title)}</span>
        <span class="flag__code">${esc(d.id)}</span>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Field (include?)</th><th>Value</th><th>Confidence</th><th>Source snippet</th></tr></thead>
        <tbody>${d.fields.map((f, fi) => fieldRow(di, fi, f)).join('')}</tbody>
      </table></div>
    </div>`).join('');
  return `<div class="summary-grid">
      <div class="stat"><div class="stat__label">Documents</div><div class="stat__value">${r.documents.length}</div></div>
      <div class="stat"><div class="stat__label">Fields extracted</div><div class="stat__value">${total}</div></div>
      <div class="stat"><div class="stat__label">Need your decision</div><div class="stat__value" style="color:${need?'#B4530E':'var(--smepro-success)'}">${need}</div></div>
      <div class="stat"><div class="stat__label">Parties</div><div class="stat__value">${r.parties.length}</div></div>
    </div>
    <div class="toolbar">
      <button class="btn" id="back-intake">← Back to text</button>
      <span class="note">Edit any value inline; untick to exclude. Amber rows are SME judgment calls.</span>
      <span style="flex:1"></span>
      <button class="btn btn--primary" id="build-btn">Build DOI Analysis →</button>
    </div>
    ${r.notes && r.notes.length ? `<div class="flag flag--medium"><div class="flag__rail"></div><div class="flag__body"><div class="flag__detail">${r.notes.map(esc).join('<br/>')}</div></div></div>` : ''}
    ${cards}`;
}

const STEPS = [
  { id: 'overview',  num: '•', label: 'Overview',          render: renderSummary,   eyebrow: 'Title Project', title: (r)=>esc(r.project.name), sub: (r)=>esc(r.project.tract.legal) },
  { id: 'runsheet',  num: '1', label: 'Run Sheet',         render: renderRunSheet,  eyebrow: 'Step 1', title: ()=>'Chronological Run Sheet', sub: ()=>'Every instrument in date order, with its effect on the estate.' },
  { id: 'ownership', num: '2', label: 'Ownership Tree',    render: renderOwnership, eyebrow: 'Step 2', title: ()=>'Property Fractions & Ownership', sub: ()=>'How the original 100% mineral estate split into today’s royalty and working-interest owners.' },
  { id: 'lease',     num: '3', label: 'Lease & Royalty',   render: renderLease,     eyebrow: 'Step 3', title: ()=>'Active Lease & Royalty Analysis', sub: ()=>'The governing lease, the operator, and every overriding royalty burden.' },
  { id: 'doi',       num: '4', label: 'DOI Deck',          render: renderDoi,       eyebrow: 'Step 4', title: ()=>'Final Division of Interest', sub: ()=>'Net Revenue Interest for every stakeholder. Must sum to exactly 1.00000000.' },
  { id: 'curative',  num: '5', label: 'Curative & Defects', render: renderCurative, eyebrow: 'Step 5', title: ()=>'Title Curative & Defects', sub: ()=>'Judgment calls and gaps a landman must resolve before relying on this deck.' },
];

const stepExists = (id) => STEPS.some((s) => s.id === id);
const initHash = (location.hash || '').replace('#', '');
let ACTIVE = stepExists(initHash) ? initHash : 'overview';
if (initHash === 'intake') MODE = 'intake';
window.addEventListener('hashchange', () => {
  const id = (location.hash || '').replace('#', '');
  if (id === 'intake') { MODE = 'intake'; paint(); }
  else if (stepExists(id)) { MODE = 'analysis'; ACTIVE = id; paint(); }
});

function paint() {
  // --- Nav ---
  const intakeActive = MODE === 'intake' || MODE === 'review';
  const steps = STEPS.map((s) => `<div class="nav__item ${MODE==='analysis' && s.id===ACTIVE?'is-active':''}" data-step="${s.id}">
      <span class="nav__num">${s.num}</span>${s.label}</div>`).join('');
  $('#nav-items').innerHTML = `
    <div class="nav__group">Import</div>
    <div class="nav__item ${intakeActive?'is-active':''}" data-go="intake"><span class="nav__num">↑</span>Intake &amp; Extract</div>
    <hr class="nav__hr"/>
    <div class="nav__group">Workflow</div>${steps}
    <hr class="nav__hr"/>
    <div class="nav__legal">${esc(RESULT.project.name)}</div>`;

  // --- Main ---
  let head, bodyHtml;
  if (MODE === 'intake') {
    head = { eyebrow: 'Import', title: 'Intake &amp; Extract', sub: 'Bring title records in, then review what was extracted before computing decimals.' };
    bodyHtml = renderIntake();
  } else if (MODE === 'review') {
    head = { eyebrow: 'Import · Review & Confirm', title: 'Confirm Extracted Facts', sub: 'Every field shows its source snippet and a confidence score. Resolve the amber judgment calls, then build the analysis.' };
    bodyHtml = renderReview();
  } else {
    const s = STEPS.find((x) => x.id === ACTIVE) || STEPS[0];
    head = { eyebrow: s.eyebrow, title: s.title(RESULT), sub: s.sub(RESULT) };
    bodyHtml = s.render(RESULT);
  }
  $('#main').innerHTML = `<div class="step is-active">
      <div class="step__head">
        <div class="step__eyebrow">${head.eyebrow}</div>
        <h1 class="step__title">${head.title}</h1>
        <p class="step__sub">${head.sub}</p>
      </div>
      ${bodyHtml}
      <div class="disclaimer">Title-examination work product for landman/analyst review. Not a title opinion or legal advice.
        Internal arithmetic is exact (rational); displayed decimals are round-half-up to 8 places.</div>
    </div>`;
  wireEvents();
}

function goAnalysis(stepId) { MODE = 'analysis'; ACTIVE = stepId || 'overview'; if (history.replaceState) history.replaceState(null, '', '#' + ACTIVE); paint(); }

function wireEvents() {
  document.querySelectorAll('[data-go]').forEach((el) =>
    el.addEventListener('click', () => { MODE = el.getAttribute('data-go'); if (MODE === 'intake' && history.replaceState) history.replaceState(null, '', '#intake'); paint(); }));
  document.querySelectorAll('[data-step]').forEach((el) =>
    el.addEventListener('click', () => goAnalysis(el.getAttribute('data-step'))));
  document.querySelectorAll('[data-basis]').forEach((el) =>
    el.addEventListener('click', () => { if (!el.disabled) { BASIS = el.getAttribute('data-basis'); paint(); } }));

  const csv = $('#dl-csv');
  if (csv) csv.addEventListener('click', () => {
    const blob = new Blob([toCsv(RESULT)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `DOI_${RESULT.project.name.replace(/[^a-z0-9]+/gi, '_')}_${BASIS}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  });

  // Intake
  const ta = $('#intake-text');
  if (ta) ta.addEventListener('input', () => { INTAKE_TEXT = ta.value; });
  const sampleBtn = $('#intake-sample');
  if (sampleBtn) sampleBtn.addEventListener('click', () => { INTAKE_TEXT = ENGINE.sourceText || ''; INTAKE_PDF = null; paint(); });
  const hint = (html) => { const h = $('#intake-hint'); if (h) h.innerHTML = html; };

  const fileInput = $('#intake-file');
  if (fileInput) fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isPdf) {
      const buf = await file.arrayBuffer();
      INTAKE_PDF = { name: file.name, base64: abToBase64(buf), mediaType: 'application/pdf' };
      hint(`PDF loaded: <b>${esc(file.name)}</b>. Reading text in-browser…`);
      try { const txt = await pdfToText(buf.slice(0)); INTAKE_TEXT = txt; paint(); }
      catch { hint(`PDF loaded: <b>${esc(file.name)}</b>. In-browser text layer unavailable (likely scanned or offline) — use <b>Extract with Claude</b>.`); }
    } else {
      const reader = new FileReader();
      reader.onload = () => { INTAKE_TEXT = String(reader.result || ''); INTAKE_PDF = null; paint(); };
      reader.readAsText(file);
    }
  });

  const extractBtn = $('#extract-btn');
  if (extractBtn) extractBtn.addEventListener('click', () => {
    const text = ($('#intake-text') && $('#intake-text').value) || '';
    if (!text.trim()) { alert('Paste or load some title text first (heuristic mode needs a text layer).'); return; }
    try { EXTRACTION = ENGINE.extractFromText(text); MODE = 'review'; paint(); }
    catch (err) { alert('Extraction failed: ' + err.message); }
  });

  const aiBtn = $('#extract-ai-btn');
  if (aiBtn) aiBtn.addEventListener('click', async () => {
    aiBtn.disabled = true; const label = aiBtn.innerHTML; aiBtn.innerHTML = 'Extracting…';
    try {
      const text = ($('#intake-text') && $('#intake-text').value) || '';
      const payload = INTAKE_PDF ? { pdfBase64: INTAKE_PDF.base64, mediaType: INTAKE_PDF.mediaType, text: text || undefined } : { text };
      EXTRACTION = await backendExtract(payload);
      MODE = 'review'; paint();
    } catch (err) {
      aiBtn.disabled = false; aiBtn.innerHTML = label;
      alert('Claude extraction failed:\n' + err.message);
    }
  });

  // Review
  const back = $('#back-intake');
  if (back) back.addEventListener('click', () => { MODE = 'intake'; paint(); });
  document.querySelectorAll('.rv-input').forEach((el) => el.addEventListener('input', () => {
    const f = EXTRACTION.documents[+el.dataset.d].fields[+el.dataset.f];
    f.value = el.value; f.status = 'edited';
  }));
  document.querySelectorAll('.rv-inc input').forEach((el) => el.addEventListener('change', () => {
    const f = EXTRACTION.documents[+el.dataset.d].fields[+el.dataset.f];
    f.status = el.checked ? (f.status === 'rejected' ? 'pending' : f.status) : 'rejected';
  }));
  const build = $('#build-btn');
  if (build) build.addEventListener('click', () => {
    try {
      const project = ENGINE.buildProjectFromExtraction(EXTRACTION);
      RESULT = ENGINE.analyzeTitleProject(project);
      $('#asof').textContent = RESULT.project.asOfDate || '';
      goAnalysis('overview');
    } catch (err) { alert('Could not build analysis:\n' + err.message); }
  });
}

$('#asof').textContent = RESULT.project.asOfDate || '';
paint();
probeBackend();
