// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fraction, F, sum } from '../engine/fraction.mjs';

test('parses fractions, decimals, and integers exactly', () => {
  assert.equal(F('1/4').toFractionString(), '1/4');
  assert.equal(F('0.25').toFractionString(), '1/4');
  assert.equal(F('3/16').toFractionString(), '3/16');
  assert.equal(F('0.0625').toFractionString(), '1/16');
  assert.equal(F('-0.5').toFractionString(), '-1/2');
  assert.equal(F(3).toFractionString(), '3');
});

test('arithmetic is exact where floats are not', () => {
  // 1/30 + 1/120 + 1/120 must be exactly 1/20.
  const total = F('1/30').add('1/120').add('1/120');
  assert.equal(total.toFractionString(), '1/20');
  assert.ok(total.eq('0.05'));
});

test('round-half-up decimal formatting', () => {
  assert.equal(F('1/30').toDecimal(8), '0.03333333');
  assert.equal(F('1/6').toDecimal(8), '0.16666667');
  assert.equal(F('1/8').toDecimal(8), '0.12500000');
  assert.equal(F('1').toDecimal(8), '1.00000000');
});

test('sum helper totals exactly', () => {
  assert.ok(sum(['1/2', '1/3', '1/6']).eq(1));
});
