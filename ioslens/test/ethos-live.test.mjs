// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEthosClient } from '../flows/ethos.mjs';

/** A stub fetch that serves Ethos-shaped JSON and counts calls per path prefix. */
function stubFetch(routes) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      for (const [prefix, handler] of routes) {
        if (String(url).includes(prefix)) return handler(url, init);
      }
      return { ok: false, status: 404, async text() { return ''; }, async json() { return {}; } };
    },
  };
}
const ok = (body) => ({ ok: true, status: 200, async text() { return typeof body === 'string' ? body : JSON.stringify(body); }, async json() { return body; } });

test('live Ethos client maps academic programs to codes/enrollment/evidence pointers', async () => {
  const s = stubFetch([
    ['/auth', () => ok('ethos-token-abc')],
    ['/api/student-academic-programs', () => ok([
      { enrollmentStatus: { status: 'active' }, preferredName: 'BSN', program: { id: 'prog-guid-1' } },
    ])],
    ['/api/academic-programs/prog-guid-1', () => ok({ id: 'prog-guid-1', cip: { code: '51.3801' } })],
  ]);
  const client = createEthosClient({ baseUrl: 'https://ethos.example', apiKey: 'key', fetchImpl: s.fetch, clock: () => '2026-07-02T14:31Z' });

  const ctx = await client.context('entra:obj:7c2a-nursing-e91');
  assert.deepEqual(ctx.codes, [{ system: 'CIP', value: '51.3801' }]);
  assert.equal(ctx.enrollmentStatus, 'active');
  assert.equal(ctx.programDetail, 'BSN');
  // Evidence is pointers only — uri + timestamp, never bodies.
  assert.ok(ctx.evidence.length >= 1);
  for (const p of ctx.evidence) assert.deepEqual(Object.keys(p).sort(), ['observed_at', 'source', 'uri']);
});

test('the Ethos bearer token is fetched once and reused across reads', async () => {
  const s = stubFetch([
    ['/auth', () => ok('tok')],
    ['/api/student-academic-programs', () => ok([])],
  ]);
  const client = createEthosClient({ baseUrl: 'https://ethos.example', apiKey: 'key', fetchImpl: s.fetch });
  await client.context('entra:obj:a');
  await client.context('entra:obj:b');
  const authCalls = s.calls.filter((c) => c.url.includes('/auth')).length;
  assert.equal(authCalls, 1);
});

test('a subject with no programs is reported as un-enrolled (fails closed downstream)', async () => {
  const s = stubFetch([
    ['/auth', () => ok('tok')],
    ['/api/student-academic-programs', () => ok([])],
  ]);
  const client = createEthosClient({ baseUrl: 'https://ethos.example', apiKey: 'key', fetchImpl: s.fetch });
  const ctx = await client.context('entra:obj:none');
  assert.equal(ctx.enrollmentStatus, 'none');
  assert.deepEqual(ctx.codes, []);
});
