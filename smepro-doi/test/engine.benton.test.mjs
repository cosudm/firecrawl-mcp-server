// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTitleProject } from '../engine/engine.mjs';
import { bentonMorales } from '../engine/cases/benton-morales.mjs';

const result = analyzeTitleProject(bentonMorales);
const byOwner = (name) => result.doi.rows.filter((r) => r.owner === name);
const nri = (name) => byOwner(name).reduce((a, r) => a.add(r.nri), result.doi.rows[0].nri.constructor.ZERO);

test('DOI deck balances to exactly 1.00000000', () => {
  assert.equal(result.doi.balances, true);
  assert.equal(result.doi.total.toFractionString(), '1');
  assert.equal(result.doi.total.toDecimal(8), '1.00000000');
});

test('royalty / ORRI / WI partition is correct', () => {
  assert.equal(result.doi.royalty.toDecimal(8), '0.20000000');
  assert.equal(result.doi.totalNpri.toDecimal(8), '0.05000000');        // floating: 1/4 × 1/5
  assert.equal(result.doi.mineralRoyaltyPool.toDecimal(8), '0.15000000');
  assert.equal(result.doi.totalOrri.toDecimal(8), '0.05000000');        // 4% + 1%
  assert.equal(result.doi.wiNet.toDecimal(8), '0.75000000');            // 0.80 − 0.05
});

test('reproduces the analyst-approved tract-basis decimals', () => {
  assert.equal(nri('Marlene S. Benton').toDecimal(8), '0.03333333');
  assert.equal(nri('Jacob Benton').toDecimal(8), '0.00833333');
  assert.equal(nri('Emily Benton').toDecimal(8), '0.00833333');
  assert.equal(nri('Cypress Ridge Holdings, LLC').toDecimal(8), '0.07500000');
  assert.equal(nri('Lone Star Royalty Partners, LP').toDecimal(8), '0.07500000');
  assert.equal(nri('Falcon Exploration, LLC').toDecimal(8), '0.04000000');
  assert.equal(nri('Horizon Minerals, LLC').toDecimal(8), '0.01000000');
  assert.equal(nri('Red River Operating, LLC').toDecimal(8), '0.75000000');
});

test('NPRI ownership: Marlene 2/3, children 1/6 each (of the NPRI)', () => {
  const npri = result.ownership.npris[0];
  const share = (name) => npri.owners.find((o) => o.name === name).share.toFractionString();
  assert.equal(share('Marlene S. Benton'), '2/3');
  assert.equal(share('Jacob Benton'), '1/6');
  assert.equal(share('Emily Benton'), '1/6');
});

test('unit allocation factor is 40/320 = 1/8', () => {
  assert.equal(result.doi.unitFactor.toFractionString(), '1/8');
  assert.equal(nri('Red River Operating, LLC').mul('1/8').toDecimal(8), '0.09375000');
  // Subject-tract share of the unit sums to the participation factor.
  const unitTotal = result.doi.rows.reduce((a, r) => a.add(r.unitNri), result.doi.total.constructor.ZERO);
  assert.equal(unitTotal.toFractionString(), '1/8');
});

test('curative surfaces the material defects', () => {
  const codes = new Set(result.curative.map((c) => c.code));
  for (const code of ['NPRI_INTERPRETATION', 'WI_NRI_MISMATCH', 'ORRI_RECITAL_GAP', 'HEIRSHIP_RELIANCE', 'TERM_NPRI', 'PUGH_DEPTH', 'UNIT_INCOMPLETE']) {
    assert.ok(codes.has(code), `expected curative flag ${code}`);
  }
  // The interpretation conflict must be flagged CRITICAL.
  assert.equal(result.curative.find((c) => c.code === 'NPRI_INTERPRETATION').severity, 'critical');
});
