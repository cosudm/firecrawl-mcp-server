// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTitleProject } from '../engine/engine.mjs';
import { bentonMorales } from '../engine/cases/benton-morales.mjs';
import { serializeDeck } from '../integration/serialize.mjs';

const analysis = analyzeTitleProject(bentonMorales);

test('serializeDeck is JSON-safe (no Fraction instances leak through)', () => {
  const deck = serializeDeck(analysis, bentonMorales, { unitId: 'UNIT-1' });
  const round = JSON.parse(JSON.stringify(deck)); // throws/changes nothing if already plain
  assert.deepEqual(round, deck);
  // Decimals are STRINGS, never floats.
  for (const r of deck.rows) assert.equal(typeof r.nri, 'string');
});

test('tract-basis deck reflects the engine balance and closes to 1.00000000', () => {
  const deck = serializeDeck(analysis, bentonMorales);
  assert.equal(deck.balances, analysis.doi.balances);
  if (deck.balances) assert.equal(deck.totalNri, '1.000000000000');
  assert.equal(deck.basis, 'tract');
});

test('carries unitId, tract, curative codes, and per-row provenance', () => {
  const deck = serializeDeck(analysis, bentonMorales, { unitId: 'UNIT-1' });
  assert.equal(deck.unitId, 'UNIT-1');
  assert.equal(deck.tract, bentonMorales.tract);
  assert.ok(Array.isArray(deck.curative));
  assert.ok(deck.curative.every((c) => c.code && c.severity && c.title));
  assert.ok(deck.rows.every((r) => 'source' in r && 'fractionLabel' in r));
});

test('requires a folded analysis', () => {
  assert.throws(() => serializeDeck({}, bentonMorales), /analysis\.doi is missing/);
});
