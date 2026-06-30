// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryAudit } from '../core/audit.mjs';

const rec = (over = {}) => ({
  decision_id: 'dec_1', trace_id: 'trc_1', subject_ref: 'entra:obj:x',
  decision: { result: 'pass', scope: 'nursing.clinical' },
  rationale: 'because', matrix_refs: ['HIPAA'],
  evidence_pointers: [{ source: 'ethos', uri: '/students/x', observed_at: '2026-07-02T14:31Z' }],
  decided_at: '2026-07-02T14:31:07Z', ...over,
});

test('appended records are frozen (immutable, §03)', async () => {
  const audit = createMemoryAudit();
  const stored = await audit.append(rec());
  assert.throws(() => { stored.rationale = 'changed'; }, TypeError);
  assert.throws(() => { stored.evidence_pointers.push({}); }, TypeError);
  assert.throws(() => { stored.decision.result = 'fail'; }, TypeError);
});

test('query filters by trace, decision, and subject; newest first', async () => {
  const audit = createMemoryAudit();
  await audit.append(rec({ decision_id: 'dec_1', trace_id: 'trc_a', subject_ref: 'entra:obj:1' }));
  await audit.append(rec({ decision_id: 'dec_2', trace_id: 'trc_b', subject_ref: 'entra:obj:2' }));
  await audit.append(rec({ decision_id: 'dec_3', trace_id: 'trc_b', subject_ref: 'entra:obj:2' }));

  assert.equal((await audit.query({ traceId: 'trc_a' })).length, 1);
  assert.equal((await audit.query({ subjectRef: 'entra:obj:2' })).length, 2);
  assert.equal((await audit.query({ decisionId: 'dec_2' })).length, 1);

  const newestFirst = await audit.query({ subjectRef: 'entra:obj:2' });
  assert.equal(newestFirst[0].decision_id, 'dec_3');
});

test('limit caps the result set', async () => {
  const audit = createMemoryAudit();
  for (let i = 0; i < 5; i++) await audit.append(rec({ decision_id: `dec_${i}`, trace_id: 't' }));
  assert.equal((await audit.query({ traceId: 't', limit: 2 })).length, 2);
});
