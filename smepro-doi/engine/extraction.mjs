// @ts-check
/**
 * Document extraction layer.
 *
 * Principle: the extractor reasons about LANGUAGE and produces a *draft* Title
 * Project with field-level provenance (source snippet) and a confidence score.
 * A human confirms/edits in the UI, and only then does the deterministic engine
 * compute decimals. The extractor never does title math.
 *
 * Two implementations share the ExtractionResult contract:
 *   - this file: a dependency-free HEURISTIC extractor (works offline, in-browser)
 *   - extractors/claude.mjs: the production LLM adapter (schema-constrained tool use)
 *
 * Judgment calls the text cannot settle (NPRI fixed-vs-floating, heirship math,
 * community characterization) are emitted at LOW confidence and flagged
 * `needsDecision` so the review UI forces a human to resolve them.
 */

import { Fraction, F } from './fraction.mjs';

/**
 * @typedef {Object} ExtractionField
 * @property {string} path        Dot-path into the draft document (e.g. "royalty").
 * @property {string} label       Human label.
 * @property {any} value          Parsed value (string|number|object).
 * @property {string} [raw]       Raw matched text.
 * @property {string} [snippet]   Surrounding source text (provenance).
 * @property {number} confidence  0..1.
 * @property {boolean} [needsDecision]  True for SME judgment calls.
 * @property {'pending'|'confirmed'|'edited'|'rejected'} status
 */

/**
 * @typedef {Object} ExtractedDocument
 * @property {string} id
 * @property {string} kind
 * @property {string} [instrument]
 * @property {number} kindConfidence
 * @property {string} title
 * @property {string} sourceText
 * @property {ExtractionField[]} fields
 * @property {string[]} warnings
 */

/**
 * @typedef {Object} ExtractionResult
 * @property {ExtractedDocument[]} documents
 * @property {Array<{id:string,name:string,type:'individual'|'entity'}>} parties
 * @property {import('./schema.mjs').Tract} [tract]
 * @property {string} [rootOwner]
 * @property {string[]} notes
 * @property {'heuristic'|'claude'|'gemini'} engine
 */

const MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,
  jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
const pad = (n) => String(n).padStart(2, '0');

/** @param {string} s @returns {string|null} ISO yyyy-mm-dd */
export function parseDate(s) {
  if (!s) return null;
  s = s.trim();
  let m;
  if ((m = s.match(/(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  if ((m = s.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/))) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo) return `${m[3]}-${pad(mo)}-${pad(Number(m[2]))}`;
  }
  return null;
}

const ENTITY_RE = /\b(LLC|L\.L\.C|LP|L\.P|Inc|Ltd|Company|Co\.|Corp|Partners|Holdings|Operating|Exploration|Minerals|Royalty|Resources|Energy|Trust)\b/i;
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const partyType = (name) => (ENTITY_RE.test(name) ? 'entity' : 'individual');
const clean = (s) => (s || '').replace(/\s+/g, ' ').replace(/[.,;]\s*$/, '').trim();

/**
 * Primary grantor name: drop a co-grantor spouse ("… and wife, …") and any
 * marital/individual descriptor, but PRESERVE entity suffixes (", LLC", ", LP").
 */
function primaryName(s) {
  let first = String(s).split(/\s+and\s+(?:wife|husband|spouse)\b|\s+&\s+|\s*;\s*/i)[0];
  first = first.replace(/,\s*(a\s+(?:single|married|widowed|unmarried)\b.*|et\s+ux\.?.*|individually.*)$/i, '');
  return clean(first);
}
/** Spouse name if a co-grantor spouse is named. */
function spouseName(s) {
  const m = String(s).match(/and\s+(?:wife|husband|spouse),?\s+([A-Z][A-Za-z.\s'-]+?)\s*$/i);
  return m ? clean(m[1]) : null;
}

const snippetAround = (text, idx, len) =>
  clean(text.slice(Math.max(0, idx - 36), Math.min(text.length, idx + len + 64)));

/**
 * Kind detectors, in priority order (specific → general).
 * @type {Array<{re: RegExp, kind: string, instrument?: string}>}
 */
const KIND_RULES = [
  { re: /ASSIGNMENT OF OVERRIDING ROYALTY|OVERRIDING ROYALTY ASSIGNMENT|ORRI ASSIGNMENT/i, kind: 'orriAssignment' },
  { re: /ASSIGNMENT(?: OF)?\s+(?:OIL\s*&?\s*(?:AND)?\s*GAS\s+LEASE|OGL|LEASE)/i, kind: 'assignment' },
  { re: /OIL\s+(?:AND|&)\s+GAS\s+LEASE/i, kind: 'oilGasLease' },
  { re: /WARRANTY DEED/i, kind: 'mineralConveyance', instrument: 'Warranty Deed' },
  { re: /MINERAL DEED/i, kind: 'mineralConveyance', instrument: 'Mineral Deed' },
  { re: /ROYALTY DEED/i, kind: 'mineralConveyance', instrument: 'Royalty Deed' },
  { re: /AFFIDAVIT OF HEIRSHIP/i, kind: 'affidavitOfHeirship' },
  { re: /DESIGNATION OF .*UNIT|UNIT DESIGNATION|HORIZONTAL UNIT/i, kind: 'unitDesignation' },
  { re: /COMPLETION REPORT/i, kind: 'completionReport' },
];

const PRETTY = { mineralConveyance: 'Deed', oilGasLease: 'Oil & Gas Lease', assignment: 'Assignment of Lease',
  orriAssignment: 'ORRI Assignment', affidavitOfHeirship: 'Affidavit of Heirship', unitDesignation: 'Unit Designation', completionReport: 'Completion Report' };

/** Is this single line a document HEADING (uppercase-dominant, short)? */
function isHeading(line) {
  const t = line.trim();
  if (!t || t.length > 70) return false;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4) return false;
  const upper = t.replace(/[^A-Z]/g, '').length;
  return upper / letters.length > 0.6;
}
function detectKind(line) {
  for (const r of KIND_RULES) if (r.re.test(line)) return r;
  return null;
}

/** Split raw text into typed blocks. */
function splitBlocks(text) {
  const lines = text.split(/\r?\n/);
  /** @type {Array<{kind:string,instrument?:string,header:string,text:string}>} */
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const k = isHeading(line) ? detectKind(line) : null;
    if (k) {
      cur = { kind: k.kind, instrument: k.instrument, header: line.trim(), text: '' };
      blocks.push(cur);
    } else if (cur) {
      cur.text += line + '\n';
    }
  }
  return blocks;
}

/**
 * Build one extraction field by running a regex against block text.
 * @returns {ExtractionField|null}
 */
function field(block, path, label, re, { conf = 0.85, group = 1, transform = (x) => clean(x), needsDecision = false } = {}) {
  const m = block.text.match(re);
  if (!m) return null;
  const raw = m[group] != null ? m[group] : m[0];
  return {
    path, label, value: transform(raw), raw: clean(raw),
    snippet: snippetAround(block.text, m.index ?? 0, m[0].length),
    confidence: conf, needsDecision, status: 'pending',
  };
}

/** Register a party and return its id. */
function ensureParty(map, name) {
  const nm = clean(name);
  if (!nm) return null;
  const id = slug(nm);
  if (!map.has(id)) map.set(id, { id, name: nm, type: partyType(nm) });
  return id;
}

/**
 * Heuristic extraction from raw title text.
 * @param {string} rawText
 * @returns {ExtractionResult}
 */
export function extractFromText(rawText) {
  const parties = new Map();
  /** @type {ExtractedDocument[]} */
  const documents = [];
  /** @type {string[]} */ const notes = [];
  /** @type {import('./schema.mjs').Tract|undefined} */ let tract;
  let rootOwner;

  const blocks = splitBlocks(rawText);
  if (!blocks.length) notes.push('No recognizable document headings were found. Paste each instrument with its type as a heading (e.g. "WARRANTY DEED").');

  let seq = 0;
  for (const b of blocks) {
    seq++;
    /** @type {ExtractionField[]} */ const fields = [];
    /** @type {string[]} */ const warnings = [];
    const push = (f) => { if (f) fields.push(f); };

    const dateField = field(b, 'date', 'Date', /Date(?:d)?:?\s*([A-Za-z]+\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i,
      { conf: 0.9, transform: (x) => parseDate(x) || clean(x) });
    push(dateField);
    const isoDate = dateField?.value && /^\d{4}-\d{2}-\d{2}$/.test(dateField.value) ? dateField.value : null;
    const year = isoDate ? isoDate.slice(0, 4) : String(2000 + seq);
    push(field(b, 'recording', 'Recording', /Doc(?:ument)?\.?\s*No\.?\s*([\w-]+)/i, { conf: 0.8 }));

    const partyField = (path, label, re, { conf = 0.9, transform = clean } = {}) => {
      const f = field(b, path, label, re, { conf, transform });
      if (f) { ensureParty(parties, f.value); push(f); }
      return f;
    };

    switch (b.kind) {
      case 'mineralConveyance': {
        const g = partyField('grantor', 'Grantor', /Grantor:?\s*(.+)/i, { transform: primaryName });
        partyField('grantee', 'Grantee', /Grantee:?\s*(.+)/i);
        // Mineral fraction conveyed
        const fracF = field(b, 'conveyMineralFraction', 'Mineral interest conveyed',
          /undivided\s+(\d+\s*%|\d+\/\d+)\s*(?:interest)?\s*(?:in(?: and under)?(?: the)?)?\s*minerals/i,
          { conf: 0.8, transform: (x) => pctOrFrac(x) });
        if (fracF) push(fracF);
        else push({ path: 'conveyMineralFraction', label: 'Mineral interest conveyed', value: '1',
          confidence: 0.5, status: 'pending', snippet: 'Defaulted to whole (100%) — confirm.', needsDecision: true });
        // Legal / acreage
        push(field(b, 'tract.legal', 'Legal description', /Legal Description:?\s*(.+)/i, { conf: 0.75 }));
        push(field(b, 'tract.grossAcres', 'Gross acres', /([\d,]+(?:\.\d+)?)\s*acres/i, { conf: 0.7, transform: (x) => Number(x.replace(/,/g, '')) }));
        // Reservation → NPRI
        const resv = b.text.match(/reserv\w*[\s\S]*?undivided\s+(\d+\/\d+|\d?\.\d+)[\s\S]*?NPRI[\s\S]*?(?:production continues|\.|$)/i);
        if (resv) {
          const quantum = pctOrFrac(resv[1]);
          const termM = resv[0].match(/term of (\d+)\s*years/i);
          push({ path: 'reservation.quantum', label: 'Reserved NPRI', value: quantum, raw: clean(resv[1]),
            snippet: snippetAround(b.text, resv.index ?? 0, resv[0].length), confidence: 0.85, status: 'pending' });
          // Basis is the classic ambiguity — force a human decision.
          push({ path: 'reservation.basis', label: 'NPRI basis (fixed vs. fraction-of-royalty)',
            value: 'floating', confidence: 0.35, needsDecision: true, status: 'pending',
            snippet: '“…NPRI in all oil, gas, and other minerals…” can read as fixed (of 8/8) or floating (of royalty). Defaulted to floating; confirm.' });
          if (termM) push({ path: 'reservation.term.years', label: 'NPRI term (years)', value: Number(termM[1]),
            raw: termM[0], snippet: snippetAround(b.text, (resv.index ?? 0) + (termM.index ?? 0), termM[0].length), confidence: 0.8, status: 'pending' });
          // Community + co-owner split from "and wife/husband"
          const sp = g ? spouseName(g.raw) : null;
          if (sp) {
            ensureParty(parties, sp);
            push({ path: 'reservation.owners', label: 'NPRI reserved by', value: [primaryName(g.raw), sp],
              confidence: 0.7, needsDecision: true, status: 'pending',
              snippet: `Reserved by "${clean(g.raw)}" — split 1/2 each as community property by default; confirm characterization.` });
          }
        }
        if (!tract) {
          const legal = fields.find((f) => f.path === 'tract.legal')?.value;
          const acres = fields.find((f) => f.path === 'tract.grossAcres')?.value;
          tract = { name: clean(legal || b.header).slice(0, 80), grossAcres: Number(acres) || 0, legal: clean(legal || ''), state: /Texas|, TX/i.test(b.text) ? 'TX' : undefined, county: (b.text.match(/([A-Z][a-z]+)\s+County/) || [])[1] };
        }
        if (g && !rootOwner) rootOwner = slug(primaryName(g.raw));
        break;
      }
      case 'oilGasLease': {
        partyField('lessor', 'Lessor', /Lessor:?\s*(.+)/i);
        partyField('lessee', 'Lessee', /Lessee:?\s*(.+)/i);
        push(field(b, 'royalty', 'Lease royalty', /Royalty:?\s*(\d+\/\d+)/i, { conf: 0.9 }));
        push(field(b, 'primaryTermYears', 'Primary term (years)', /Primary Term:?\s*(\d+)/i, { conf: 0.85, transform: (x) => Number(x) }));
        push(field(b, 'pughDepthNote', 'Pugh / depth clause', /(Pugh[^.]*\.|Releases depths[^.]*\.)/i, { conf: 0.7 }));
        push(field(b, 'noDeductionsNote', 'Cost-bearing clause', /(No-?Deductions[^.]*\.|post-production[^.]*\.)/i, { conf: 0.7 }));
        break;
      }
      case 'assignment': {
        partyField('assignor', 'Assignor', /Assignor:?\s*(.+)/i);
        partyField('assignee', 'Assignee', /Assignee:?\s*(.+)/i);
        push(field(b, 'wiFraction', 'Working interest assigned', /(\d+)\s*%\s*WI/i, { conf: 0.85, transform: (x) => (Number(x) / 100).toString() }));
        push(field(b, 'statedNri', 'Recited NRI', /(\d+(?:\.\d+)?)\s*%\s*NRI/i, { conf: 0.6, transform: (x) => (Number(x) / 100).toString(), needsDecision: true }));
        const ro = b.text.match(/(\d+(?:\.\d+)?)\s*%\s*ORRI\s+retained\s+by\s+(?:Assignor|([^.\n]+))/i);
        if (ro) {
          const ownerName = ro[2] ? clean(ro[2]) : (fields.find((f) => f.path === 'assignor')?.value);
          ensureParty(parties, ownerName);
          push({ path: 'reservedOrri', label: 'ORRI reserved in assignment', value: { quantum: (Number(ro[1]) / 100).toString(), owner: ownerName },
            raw: clean(ro[0]), snippet: snippetAround(b.text, ro.index ?? 0, ro[0].length), confidence: 0.8, status: 'pending' });
        }
        const rc = b.text.match(/(\d+(?:\.\d+)?)\s*%\s*ORRI\s+(?:previously\s+)?conveyed\s+to\s+([^.\n]+)/i);
        if (rc) {
          ensureParty(parties, clean(rc[2]));
          push({ path: 'recitedOrri', label: 'ORRI recited as pre-existing', value: [{ quantum: (Number(rc[1]) / 100).toString(), owner: clean(rc[2]), note: 'recited as previously conveyed' }],
            raw: clean(rc[0]), snippet: snippetAround(b.text, rc.index ?? 0, rc[0].length), confidence: 0.7, status: 'pending' });
        }
        break;
      }
      case 'orriAssignment': {
        partyField('assignor', 'Assignor', /Assignor:?\s*(.+)/i);
        partyField('assignee', 'Assignee', /Assignee:?\s*(.+)/i);
        const qm = b.text.match(/(?:Interest:?\s*)?(\d+(?:\.\d+)?)\s*%\s*ORRI|Interest:?\s*(\d+(?:\.\d+)?)\s*%/i);
        if (qm) {
          const pctStr = qm[1] ?? qm[2];
          push({ path: 'quantum', label: 'ORRI conveyed', value: (Number(pctStr) / 100).toString(), raw: clean(qm[0]),
            snippet: snippetAround(b.text, qm.index ?? 0, qm[0].length), confidence: 0.85, status: 'pending' });
        }
        break;
      }
      case 'affidavitOfHeirship': {
        const dec = partyField('decedent', 'Decedent', /Decedent:?\s*(.+)/i);
        if (dec) dec.value = primaryName(dec.raw);
        push(field(b, 'dateOfDeath', 'Date of death', /Date of Death:?\s*(.+)/i, { conf: 0.85, transform: (x) => parseDate(x) || clean(x) }));
        push({ path: 'communityProperty', label: 'Community property', value: /community/i.test(b.text), confidence: 0.6, needsDecision: true, status: 'pending',
          snippet: /community/i.test(b.text) ? 'Affidavit references "community"; characterization affects the split — confirm.' : 'No community reference found — confirm.' });
        // Heirs block
        const heirLines = [...b.text.matchAll(/^\s*([A-Z][A-Za-z.\s]+?)\s*\(([^)]*)\)\s*[—\-]\s*([^\n]+)$/gm)];
        if (heirLines.length) {
          const heirs = heirLines.map((h) => ({ name: clean(h[1]), role: clean(h[2]), raw: clean(h[3]) }));
          heirs.forEach((h) => ensureParty(parties, h.name));
          const spouse = heirs.find((h) => /spouse/i.test(h.role));
          if (spouse) push({ path: 'survivingSpouse', label: 'Surviving spouse', value: spouse.name, confidence: 0.85, status: 'pending', snippet: clean(spouse.raw) });
          push({ path: 'distributions', label: `Heirship split (${heirs.length} heirs)`,
            value: heirs.map((h) => ({ heir: h.name, share: `1/${heirs.length}` })),
            confidence: 0.4, needsDecision: true, status: 'pending',
            snippet: `Parsed heirs: ${heirs.map((h) => `${h.name} (${h.raw})`).join('; ')}. Defaulted to equal shares of the decedent's interest — confirm the intestacy/community math.` });
        }
        break;
      }
      case 'unitDesignation': {
        push(field(b, 'unitName', 'Unit name', /Unit Name:?\s*(.+)|([A-Z][\w ]*?Unit)\b/i, { conf: 0.8 }));
        push(field(b, 'unitAcres', 'Unit acres', /Acreage:?\s*([\d,]+(?:\.\d+)?)/i, { conf: 0.85, transform: (x) => Number(x.replace(/,/g, '')) }));
        const t1 = b.text.match(/Tract\s*1[^\d]*?([\d.]+)\s*ac/i);
        if (t1) push({ path: 'tractAcres', label: 'Subject tract acres', value: Number(t1[1]), raw: clean(t1[0]), snippet: snippetAround(b.text, t1.index ?? 0, t1[0].length), confidence: 0.8, status: 'pending' });
        const others = [...b.text.matchAll(/Tract\s*([2-9]\d*)\s*[—\-]\s*(\d+(?:\.\d+)?)\s*ac/gi)].map((m) => ({ name: `Tract ${m[1]}`, acres: Number(m[2]) }));
        if (others.length) push({ path: 'otherTracts', label: 'Other unit tracts', value: others, confidence: 0.75, status: 'pending', snippet: others.map((o) => `${o.name}: ${o.acres} ac`).join(', ') });
        partyField('operator', 'Operator', /Operator:?\s*(.+)/i, 0.8);
        break;
      }
      case 'completionReport': {
        push(field(b, 'well', 'Well', /Well:?\s*(.+)|([A-Z][\w ]*#\s*\d+H?)/i, { conf: 0.8 }));
        const iv = b.text.match(/([\d,]+)\s*[-–]\s*([\d,]+)\s*ft/i);
        if (iv) {
          push({ path: 'intervalTopFt', label: 'Interval top (ft)', value: Number(iv[1].replace(/,/g, '')), raw: clean(iv[0]), snippet: snippetAround(b.text, iv.index ?? 0, iv[0].length), confidence: 0.8, status: 'pending' });
          push({ path: 'intervalBottomFt', label: 'Interval bottom (ft)', value: Number(iv[2].replace(/,/g, '')), raw: clean(iv[0]), snippet: snippetAround(b.text, iv.index ?? 0, iv[0].length), confidence: 0.8, status: 'pending' });
        }
        break;
      }
      default:
        warnings.push(`Unhandled document kind: ${b.kind}`);
    }

    documents.push({
      id: `${kindAbbrev(b.kind)}-${year}`,
      kind: b.kind, instrument: b.instrument,
      kindConfidence: 0.95,
      title: `${b.instrument || PRETTY[b.kind] || b.kind} — ${year}`,
      sourceText: b.text.trim(),
      fields, warnings,
    });
  }

  if (!rootOwner && parties.size) rootOwner = [...parties.keys()][0];

  return { documents, parties: [...parties.values()], tract, rootOwner, notes, engine: 'heuristic' };
}

function kindAbbrev(kind) {
  return { mineralConveyance: 'DEED', oilGasLease: 'OGL', assignment: 'ASG', orriAssignment: 'ORRI',
    affidavitOfHeirship: 'AOH', unitDesignation: 'UNIT', completionReport: 'COMP' }[kind] || 'DOC';
}

/** "50%" → "1/2"; "1/4" → "1/4"; "0.25" → "0.25". */
function pctOrFrac(s) {
  s = String(s).trim();
  if (s.includes('%')) return F(Number(s.replace('%', '')) / 100).toFractionString();
  return s;
}

/**
 * Assemble a (confirmed) ExtractionResult into a TitleProject the engine can run.
 * Reads each field's current value; rejected fields are skipped.
 * @param {ExtractionResult} result
 * @returns {import('./schema.mjs').TitleProject}
 */
export function buildProjectFromExtraction(result) {
  const val = (doc, path) => {
    const f = doc.fields.find((x) => x.path === path && x.status !== 'rejected');
    return f ? f.value : undefined;
  };

  // Find the NPRI-bearing conveyance so the affidavit can target it.
  const npriDoc = result.documents.find((d) => d.kind === 'mineralConveyance' && val(d, 'reservation.quantum'));
  const npriId = npriDoc ? `NPRI-${npriDoc.id}` : undefined;

  const documents = result.documents.map((d) => {
    const base = { id: d.id, date: val(d, 'date'), recording: val(d, 'recording'), title: d.title };
    switch (d.kind) {
      case 'mineralConveyance': {
        const reservation = val(d, 'reservation.quantum') ? {
          id: `NPRI-${d.id}`,
          quantum: val(d, 'reservation.quantum'),
          basis: val(d, 'reservation.basis') || 'floating',
          ambiguous: true,
          term: val(d, 'reservation.term.years') ? { years: val(d, 'reservation.term.years'), plusProduction: true } : undefined,
          owners: ownersFrom(val(d, 'reservation.owners'), result),
        } : undefined;
        return { ...base, kind: 'mineralConveyance', instrument: d.instrument || 'Deed',
          grantor: slug(val(d, 'grantor') || ''), grantee: slug(val(d, 'grantee') || ''),
          conveyMineralFraction: val(d, 'conveyMineralFraction') || '1', reservation };
      }
      case 'oilGasLease':
        return { ...base, kind: 'oilGasLease', lessor: slug(val(d, 'lessor') || ''), lessee: slug(val(d, 'lessee') || ''),
          royalty: val(d, 'royalty') || '1/8', primaryTermYears: val(d, 'primaryTermYears'),
          pughDepthNote: val(d, 'pughDepthNote'), noDeductionsNote: val(d, 'noDeductionsNote') };
      case 'assignment': {
        const ro = val(d, 'reservedOrri'); const rc = val(d, 'recitedOrri');
        return { ...base, kind: 'assignment', assignor: slug(val(d, 'assignor') || ''), assignee: slug(val(d, 'assignee') || ''),
          wiFraction: val(d, 'wiFraction') || '1', statedNri: val(d, 'statedNri'),
          reservedOrri: ro ? { quantum: ro.quantum, owner: slug(ro.owner) } : undefined,
          recitedOrri: rc ? rc.map((x) => ({ quantum: x.quantum, owner: slug(x.owner), note: x.note })) : undefined };
      }
      case 'orriAssignment':
        return { ...base, kind: 'orriAssignment', assignor: slug(val(d, 'assignor') || ''), assignee: slug(val(d, 'assignee') || ''), quantum: val(d, 'quantum') || '0' };
      case 'affidavitOfHeirship':
        return { ...base, kind: 'affidavitOfHeirship', decedent: slug(val(d, 'decedent') || ''),
          dateOfDeath: val(d, 'dateOfDeath'), affects: 'npri', npriId,
          communityProperty: !!val(d, 'communityProperty'), survivingSpouse: val(d, 'survivingSpouse') ? slug(val(d, 'survivingSpouse')) : undefined,
          distributions: (val(d, 'distributions') || []).map((x) => ({ heir: slug(x.heir), share: x.share })) };
      case 'unitDesignation':
        return { ...base, kind: 'unitDesignation', unitName: val(d, 'unitName') || 'Unit',
          unitAcres: val(d, 'unitAcres') || 0, tractAcres: val(d, 'tractAcres') || 0, otherTracts: val(d, 'otherTracts') || [] };
      case 'completionReport':
        return { ...base, kind: 'completionReport', well: val(d, 'well') || 'Well', intervalTopFt: val(d, 'intervalTopFt'), intervalBottomFt: val(d, 'intervalBottomFt') };
      default:
        return { ...base, kind: d.kind };
    }
  });

  return {
    name: result.tract?.name ? `Extracted — ${result.tract.name}` : 'Extracted Title Project',
    asOfDate: new Date().toISOString().slice(0, 10),
    tract: result.tract || { name: 'Tract', grossAcres: 0, legal: '' },
    rootOwner: result.rootOwner || (result.parties[0] && result.parties[0].id) || 'owner',
    parties: result.parties,
    documents,
  };
}

/** NPRI owners: split named reservors equally; else default a single owner placeholder. */
function ownersFrom(ownerNames, result) {
  if (Array.isArray(ownerNames) && ownerNames.length) {
    const share = `1/${ownerNames.length}`;
    return ownerNames.map((n) => ({ party: slug(n), share }));
  }
  const root = result.rootOwner || (result.parties[0] && result.parties[0].id);
  return root ? [{ party: root, share: '1' }] : [];
}

export { slug as partySlug };
