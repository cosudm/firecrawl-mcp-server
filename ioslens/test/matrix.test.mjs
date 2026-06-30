// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../matrix/store.mjs';
import { createMatrix } from '../matrix/matrix.mjs';

test('crosswalk expansion reaches the full identity spine from a partial input', async () => {
  const matrix = createMatrix(createMemoryStore());
  // Input only CIP; expansion must reach SOC, NAICS, SIC via crosswalks.
  const r = await matrix.lookup({ codes: [{ system: 'CIP', value: '51.3801' }] });
  const expanded = r.expandedCodes.map((c) => `${c.system} ${c.value}`);
  assert.ok(expanded.includes('CIP 51.3801'));
  assert.ok(expanded.includes('SOC 29-1141'));
  assert.ok(expanded.includes('NAICS 622110'));
  assert.ok(expanded.includes('SIC 8062'));
});

test('obligation resolution joins code_obligations -> obligations -> regimes', async () => {
  const matrix = createMatrix(createMemoryStore());
  const r = await matrix.lookup({ codes: [{ system: 'SOC', value: '29-1141' }] });
  assert.equal(r.matched, 'exact');
  const regimeCodes = r.regimeRefs.map((x) => x.code);
  assert.ok(regimeCodes.includes('HIPAA'));
  assert.ok(r.scopes.includes('nursing.clinical'));
  // citations are regime-prefixed and de-duplicated
  assert.ok(r.citations.some((c) => c.startsWith('HIPAA 45 CFR')));
});

test('semantic fallback fires only when no exact code match exists', async () => {
  const matrix = createMatrix(createMemoryStore());
  // A code value that is not in the spine -> no exact match -> semantic path.
  const r = await matrix.lookup({ codes: [{ system: 'SOC', value: '99-9999' }], query: 'student privacy consent to disclose education records' });
  assert.equal(r.matched, 'semantic');
  assert.ok(r.obligations.length > 0);
  // The nearest obligation by meaning should be the FERPA consent rule.
  assert.ok(r.obligations.some((o) => o.obligation.id === 'ob_ferpa_consent'));
});

test('no codes and no query -> matched none', async () => {
  const matrix = createMatrix(createMemoryStore());
  const r = await matrix.lookup({ codes: [] });
  assert.equal(r.matched, 'none');
  assert.deepEqual(r.obligations, []);
});
