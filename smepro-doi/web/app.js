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
  ? { analyzeTitleProject, project: bentonMorales }
  : window.SMEPRO;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);

let BASIS = 'tract'; // 'tract' | 'unit'
const RESULT = ENGINE.analyzeTitleProject(ENGINE.project);

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
    <span style="width:${pct(r.doi.totalNpri)}; background:#5aa06f" title="NPRI"></span>
    <span style="width:${pct(r.doi.mineralRoyaltyPool)}; background:#2f7fc4" title="Mineral royalty"></span>
    <span style="width:${pct(r.doi.totalOrri)}; background:#c4892b" title="ORRI"></span>
    <span style="width:${pct(r.doi.wiNet)}; background:#7a6cc0" title="WI net"></span>
  </div>`;

  return `<div class="card">
    <div class="card__title">How 100% of production splits (8/8 → 1.00000000)</div>
    ${bar}
    <div class="kpi-row note">
      <span class="badge badge--ok"><span class="dot" style="background:#5aa06f"></span>NPRI ${r.doi.totalNpri.toDecimal(4)}</span>
      <span class="badge badge--info"><span class="dot" style="background:#2f7fc4"></span>Mineral royalty ${r.doi.mineralRoyaltyPool.toDecimal(4)}</span>
      <span class="badge badge--medium"><span class="dot" style="background:#c4892b"></span>ORRI ${r.doi.totalOrri.toDecimal(4)}</span>
      <span class="badge badge--info"><span class="dot" style="background:#7a6cc0"></span>WI net ${r.doi.wiNet.toDecimal(4)}</span>
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
const STEPS = [
  { id: 'overview',  num: '•', label: 'Overview',          render: renderSummary,   eyebrow: 'Title Project', title: (r)=>esc(r.project.name), sub: (r)=>esc(r.project.tract.legal) },
  { id: 'runsheet',  num: '1', label: 'Run Sheet',         render: renderRunSheet,  eyebrow: 'Step 1', title: ()=>'Chronological Run Sheet', sub: ()=>'Every instrument in date order, with its effect on the estate.' },
  { id: 'ownership', num: '2', label: 'Ownership Tree',    render: renderOwnership, eyebrow: 'Step 2', title: ()=>'Property Fractions & Ownership', sub: ()=>'How the original 100% mineral estate split into today’s royalty and working-interest owners.' },
  { id: 'lease',     num: '3', label: 'Lease & Royalty',   render: renderLease,     eyebrow: 'Step 3', title: ()=>'Active Lease & Royalty Analysis', sub: ()=>'The governing lease, the operator, and every overriding royalty burden.' },
  { id: 'doi',       num: '4', label: 'DOI Deck',          render: renderDoi,       eyebrow: 'Step 4', title: ()=>'Final Division of Interest', sub: ()=>'Net Revenue Interest for every stakeholder. Must sum to exactly 1.00000000.' },
  { id: 'curative',  num: '5', label: 'Curative & Defects', render: renderCurative, eyebrow: 'Step 5', title: ()=>'Title Curative & Defects', sub: ()=>'Judgment calls and gaps a landman must resolve before relying on this deck.' },
];

let ACTIVE = 'overview';
function paint() {
  const nav = STEPS.map((s) => `<div class="nav__item ${s.id===ACTIVE?'is-active':''}" data-step="${s.id}">
      <span class="nav__num">${s.num}</span>${s.label}</div>`).join('');
  $('#nav-items').innerHTML = `<div class="nav__group">Workflow</div>${nav}`;

  const s = STEPS.find((x) => x.id === ACTIVE);
  $('#main').innerHTML = `<div class="step is-active">
      <div class="step__head">
        <div class="step__eyebrow">${s.eyebrow}</div>
        <h1 class="step__title">${s.title(RESULT)}</h1>
        <p class="step__sub">${s.sub(RESULT)}</p>
      </div>
      ${s.render(RESULT)}
      <div class="disclaimer">Title-examination work product for landman/analyst review. Not a title opinion or legal advice.
        Internal arithmetic is exact (rational); displayed decimals are round-half-up to 8 places.</div>
    </div>`;
  wireStepEvents();
}
function wireStepEvents() {
  document.querySelectorAll('[data-step]').forEach((el) =>
    el.addEventListener('click', () => { ACTIVE = el.getAttribute('data-step'); paint(); }));
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
}

$('#asof').textContent = RESULT.project.asOfDate || '';
paint();
