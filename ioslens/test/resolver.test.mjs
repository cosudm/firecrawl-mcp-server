// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../matrix/store.mjs';
import { createMatrix } from '../matrix/matrix.mjs';
import { createMemoryAudit } from '../core/audit.mjs';
import { createResolver } from '../core/resolver.mjs';
import { createMockEntra } from '../flows/entra.mjs';
import { createMockEthos } from '../flows/ethos.mjs';

function build(overrides = {}) {
  const store = createMemoryStore();
  const matrix = createMatrix(store);
  const audit = createMemoryAudit();
  const ids = { decisionId: () => 'dec_test1', traceId: () => 'trc_test1' };
  const clock = () => '2026-07-02T14:31:07Z';
  const resolver = createResolver({
    matrix, audit,
    entra: overrides.entra ?? createMockEntra(),
    ethos: overrides.ethos ?? createMockEthos({ clock }),
    ids, clock,
  });
  return { store, audit, resolver };
}

test('reproduces the §03 worked example: nursing.clinical with the documented rationale', async () => {
  const { resolver, audit } = build();
  const d = await resolver.resolve({ subjectRef: 'entra:obj:7c2a-nursing-e91' });

  assert.equal(d.decision.result, 'pass');
  assert.equal(d.decision.scope, 'nursing.clinical');
  assert.equal(d.rationale, 'SOC 29-1141 + NAICS 622110 + HIPAA → clinical scope');
  assert.equal(d.decision_id, 'dec_test1');
  assert.equal(d.trace_id, 'trc_test1');

  // An immutable audit record was written with pointers only.
  const recs = await audit.query({ traceId: 'trc_test1' });
  assert.equal(recs.length, 1);
  const rec = recs[0];
  assert.equal(rec.subject_ref, 'entra:obj:7c2a-nursing-e91');
  assert.deepEqual(rec.decision, { result: 'pass', scope: 'nursing.clinical' });
  assert.equal(rec.evidence_pointers[0].source, 'ethos');
  assert.match(rec.evidence_pointers[0].uri, /^\/students\//);
});

test('the audit record never contains PII / source records', async () => {
  const { resolver, audit } = build();
  await resolver.resolve({ subjectRef: 'entra:obj:7c2a-nursing-e91' });
  const rec = (await audit.query({ traceId: 'trc_test1' }))[0];
  const serialized = JSON.stringify(rec);
  // No enrollment status, no program detail, no directory attributes leaked.
  assert.doesNotMatch(serialized, /clinical rotation/i); // programDetail value
  assert.doesNotMatch(serialized, /enrollmentStatus|"active"/);
  assert.doesNotMatch(serialized, /BSN/);
  // Only the pointer + timestamp of the Ethos read is kept.
  assert.ok(rec.evidence_pointers.every((p) => Object.keys(p).sort().join(',') === 'observed_at,source,uri'));
});

test('a dropped enrollment is un-scoped at resolution time (Flow B liveness)', async () => {
  const ethos = createMockEthos({
    fixtures: { 'entra:obj:7c2a-nursing-e91': { codes: [{ system: 'SOC', value: '29-1141' }], enrollmentStatus: 'dropped' } },
    clock: () => '2026-07-02T18:00:00Z',
  });
  const { resolver } = build({ ethos });
  const d = await resolver.resolve({ subjectRef: 'entra:obj:7c2a-nursing-e91' });
  assert.equal(d.decision.result, 'fail');
  assert.equal(d.decision.scope, null);
  assert.match(d.rationale, /enrollment dropped → un-scoped/);
});

test('unknown subject (no Entra identity) fails closed', async () => {
  const { resolver } = build();
  const d = await resolver.resolve({ subjectRef: 'entra:obj:does-not-exist' });
  assert.equal(d.decision.result, 'fail');
  assert.equal(d.decision.scope, null);
  assert.match(d.rationale, /unknown subject/);
});

test('requestedScope outside the resolved set fails', async () => {
  const { resolver } = build();
  const d = await resolver.resolve({ subjectRef: 'entra:obj:7c2a-nursing-e91', requestedScope: 'finance.treasury' });
  assert.equal(d.decision.result, 'fail');
  assert.equal(d.decision.scope, null);
});

test('activeOnly restricts to pilot-active regimes (no HIPAA -> academic scope)', async () => {
  const { resolver } = build();
  const d = await resolver.resolve({ subjectRef: 'entra:obj:7c2a-nursing-e91', activeOnly: true });
  assert.equal(d.decision.result, 'pass');
  assert.equal(d.decision.scope, 'nursing.academic');
});
