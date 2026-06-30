// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../lib/store.mjs';
import { createApi } from '../lib/api.mjs';

// Isolated, non-persistent store per suite run.
process.env.IOS_NO_PERSIST = '1';
const fresh = () => createApi(new Store({ persist: false }));

test('dashboard aggregates seed data', () => {
  const api = fresh();
  const { status, json } = api('GET', '/api/dashboard');
  assert.equal(status, 200);
  assert.ok(json.obligations.total >= 5);
  assert.equal(json.obligations.pendingReview, 1);
  assert.ok(json.projects.balanced >= 1);
});

test('DOI deck is engine-computed and balances to 1.0', () => {
  const api = fresh();
  const { json: list } = api('GET', '/api/projects');
  const id = list.items[0].id;
  const { status, json } = api('GET', '/api/projects/' + id);
  assert.equal(status, 200);
  assert.equal(json.balances, true);
  assert.equal(json.total_nri, '1.000000000000');
  assert.equal(json.rows.length, 8);
});

test('obligations list filters by status and search', () => {
  const api = fresh();
  assert.equal(api('GET', '/api/obligations', { status: 'Pending Review' }).json.items.length, 1);
  assert.ok(api('GET', '/api/obligations', { q: 'EPA' }).json.items.length >= 2);
});

test('run-check (changed) flips status to Pending Review and logs a scan', () => {
  const api = fresh();
  const r = api('POST', '/api/obligations/ob-bsee-apd/run-check', {}, { changed: true, diffSummary: 'x' });
  assert.equal(r.status, 200);
  assert.equal(r.json.compliance_status, 'Pending Review');
  assert.equal(r.json.scans[0].changed, true);
});

test('run-check (no change) sets Current and stamps verified', () => {
  const api = fresh();
  const r = api('POST', '/api/obligations/ob-epa-spcc/run-check', {}, { changed: false });
  assert.equal(r.json.compliance_status, 'Current');
  assert.ok(r.json.last_verified_at);
});

test('promote discovery creates an unmonitored obligation', () => {
  const api = fresh();
  const before = api('GET', '/api/obligations').json.items.length;
  const r = api('POST', '/api/discoveries/disc-1/promote');
  assert.equal(r.status, 200);
  assert.equal(r.json.obligation.compliance_status, 'Unmonitored');
  assert.equal(api('GET', '/api/obligations').json.items.length, before + 1);
  assert.equal(api('GET', '/api/discoveries', { status: 'promoted' }).json.items.length, 1);
});

test('reject discovery marks it rejected', () => {
  const api = fresh();
  const r = api('POST', '/api/discoveries/disc-2/reject');
  assert.equal(r.json.status, 'rejected');
});

test('monitor toggle flips active/paused', () => {
  const api = fresh();
  assert.equal(api('POST', '/api/monitors/mon_epa_ghg/toggle').json.status, 'paused');
  assert.equal(api('POST', '/api/monitors/mon_epa_ghg/toggle').json.status, 'active');
});

test('approve is gated until critical curative resolved', () => {
  const api = fresh();
  const id = api('GET', '/api/projects').json.items[0].id;
  const proj = api('GET', '/api/projects/' + id).json;
  const crit = proj.curative.filter((c) => c.severity === 'critical');
  if (crit.length) {
    const blocked = api('POST', `/api/projects/${id}/approve`);
    assert.equal(blocked.status, 409);
    for (const c of crit) api('POST', `/api/projects/${id}/curative/${c.id}`, {}, { status: 'resolved' });
  }
  const ok = api('POST', `/api/projects/${id}/approve`);
  assert.equal(ok.status, 200);
  assert.ok(ok.json.project.approved_at);
});

test('unknown route returns 404', () => {
  assert.equal(fresh()('GET', '/api/nope').status, 404);
});
