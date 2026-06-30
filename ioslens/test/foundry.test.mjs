// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../matrix/store.mjs';
import { createFoundryMonitor, createWebFeedSource } from '../foundry/monitor.mjs';

test('monitor enqueues proposals into change_queue as pending, proposed_by Foundry', async () => {
  const store = createMemoryStore();
  const monitor = createFoundryMonitor({
    store,
    sources: [{ regimeCode: 'FERPA', fetchProposals: async () => [{ summary: 'directory opt-out tightening', payload: { cfr: '34 CFR 99.37' } }] }],
  });
  const { enqueued } = await monitor.runOnce();
  assert.equal(enqueued.length, 1);

  const pending = await store.listChanges('pending');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].regime_code, 'FERPA');
  assert.equal(pending[0].proposed_by, 'Foundry');
  assert.equal(pending[0].status, 'pending');
});

test('Foundry cannot publish — only the change_queue write path exists', async () => {
  const store = createMemoryStore();
  const monitor = createFoundryMonitor({ store, sources: [{ regimeCode: 'THECB', fetchProposals: async () => [{ summary: 'x' }] }] });
  // The monitor surface is exactly { runOnce, start } — no publish capability.
  assert.deepEqual(Object.keys(monitor).sort(), ['runOnce', 'start']);
  await monitor.runOnce();
  assert.equal((await store.listVersions()).length, 0); // nothing published
});

test('re-running de-duplicates against the pending queue', async () => {
  const store = createMemoryStore();
  const source = { regimeCode: 'SACSCOC', fetchProposals: async () => [{ summary: 'IE evidence rule update' }] };
  const monitor = createFoundryMonitor({ store, sources: [source] });
  const first = await monitor.runOnce();
  const second = await monitor.runOnce();
  assert.equal(first.enqueued.length, 1);
  assert.equal(second.enqueued.length, 0);
  assert.equal(second.skipped, 1);
  assert.equal((await store.listChanges('pending')).length, 1);
});

test('a failing source is isolated and reported, others still run', async () => {
  const store = createMemoryStore();
  const monitor = createFoundryMonitor({
    store,
    sources: [
      { regimeCode: 'FERPA', name: 'bad', fetchProposals: async () => { throw new Error('feed down'); } },
      { regimeCode: 'THECB', fetchProposals: async () => [{ summary: 'CIP reporting change' }] },
    ],
  });
  const res = await monitor.runOnce();
  assert.equal(res.enqueued.length, 1);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0].error, /feed down/);
});

test('web-feed source parses a fetched body into proposals', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, async json() { return { items: [{ title: 'GLBA safeguards update' }] }; } });
  const source = createWebFeedSource({ regimeCode: 'GLBA', url: 'https://feed.example/glba', fetchImpl, parse: (b) => b.items.map((i) => ({ summary: i.title })) });
  const proposals = await source.fetchProposals();
  assert.deepEqual(proposals, [{ summary: 'GLBA safeguards update' }]);
});

test('the enqueued proposal can be published by a Matrix.Admin (end-to-end currency loop)', async () => {
  const store = createMemoryStore();
  const monitor = createFoundryMonitor({ store, sources: [{ regimeCode: 'FERPA', fetchProposals: async () => [{ summary: 'update' }] }] });
  const { enqueued } = await monitor.runOnce();
  const changeId = enqueued[0].id;

  // Simulate the Matrix.Admin approval path (as matrix.publish does).
  await store.reviewChange(changeId, { status: 'approved', reviewed_by: 'compliance-board', reviewed_at: '2026-07-02T00:00:00Z' });
  const version = await store.publishVersion({ regime_code: 'FERPA', approver: 'compliance-board' });
  assert.equal(version.version, 1);
  assert.equal((await store.getChange(changeId)).status, 'approved');
});
