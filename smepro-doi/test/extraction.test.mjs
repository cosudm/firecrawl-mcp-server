// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromText, buildProjectFromExtraction, parseDate } from '../engine/extraction.mjs';
import { analyzeTitleProject } from '../engine/engine.mjs';
import { bentonMoralesSource } from '../engine/cases/benton-morales-source.mjs';

const result = extractFromText(bentonMoralesSource);
const doc = (kind) => result.documents.find((d) => d.kind === kind);
const fval = (d, path) => d.fields.find((f) => f.path === path)?.value;

test('parseDate handles the common deed formats', () => {
  assert.equal(parseDate('March 14, 2011'), '2011-03-14');
  assert.equal(parseDate('06/01/2013'), '2013-06-01');
  assert.equal(parseDate('2022-02-18'), '2022-02-18');
});

test('splits all eight instruments with correct kinds, in order', () => {
  assert.equal(result.documents.length, 8);
  assert.deepEqual(result.documents.map((d) => d.kind), [
    'mineralConveyance', 'oilGasLease', 'mineralConveyance', 'assignment',
    'affidavitOfHeirship', 'orriAssignment', 'unitDesignation', 'completionReport',
  ]);
});

test('recovers the key facts from raw text', () => {
  assert.equal(fval(doc('oilGasLease'), 'royalty'), '1/5');
  const wd = result.documents.find((d) => d.instrument === 'Warranty Deed');
  assert.equal(fval(wd, 'reservation.quantum'), '1/4');
  assert.equal(fval(wd, 'reservation.term.years'), 20);
  const md = result.documents.find((d) => d.instrument === 'Mineral Deed');
  assert.equal(fval(md, 'conveyMineralFraction'), '1/2');
  const asg = doc('assignment');
  assert.equal(fval(asg, 'wiFraction'), '1');
  assert.equal(fval(asg, 'statedNri'), '0.8');
  assert.equal(fval(asg, 'reservedOrri').quantum, '0.04');
  assert.equal(fval(doc('orriAssignment'), 'quantum'), '0.01');
  assert.equal(fval(doc('unitDesignation'), 'unitAcres'), 320);
  assert.equal(fval(doc('unitDesignation'), 'tractAcres'), 40);
});

test('flags the SME judgment calls for human decision (low confidence)', () => {
  const wd = result.documents.find((d) => d.instrument === 'Warranty Deed');
  const basis = wd.fields.find((f) => f.path === 'reservation.basis');
  assert.equal(basis.needsDecision, true);
  assert.ok(basis.confidence < 0.5);
  const split = doc('affidavitOfHeirship').fields.find((f) => f.path === 'distributions');
  assert.equal(split.needsDecision, true);
});

test('every extracted field carries provenance (a source snippet)', () => {
  for (const d of result.documents)
    for (const f of d.fields)
      assert.ok(typeof f.snippet === 'string' && f.snippet.length > 0, `${d.id}.${f.path} missing snippet`);
});

test('identifies the parties', () => {
  const names = result.parties.map((p) => p.name);
  for (const n of ['Cypress Ridge Holdings, LLC', 'Lone Star Royalty Partners, LP', 'Falcon Exploration, LLC',
    'Red River Operating, LLC', 'Horizon Minerals, LLC', 'Harold J. Benton', 'Marlene S. Benton'])
    assert.ok(names.some((x) => x.includes(n.split(',')[0])), `missing party ${n}`);
});

test('assembled project analyzes and balances to exactly 1.00000000', () => {
  const project = buildProjectFromExtraction(result);
  const analysis = analyzeTitleProject(project);
  assert.equal(analysis.doi.balances, true);
  assert.equal(analysis.doi.total.toDecimal(8), '1.00000000');
  // Spot-check the marquee decimals survived the full round-trip.
  const nri = (name) => analysis.doi.rows.filter((r) => r.owner.includes(name))
    .reduce((a, r) => a.add(r.nri), analysis.doi.total.constructor.ZERO).toDecimal(8);
  assert.equal(nri('Red River'), '0.75000000');
  assert.equal(nri('Marlene'), '0.03333333');
  assert.equal(nri('Cypress'), '0.07500000');
});
