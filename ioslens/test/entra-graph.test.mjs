// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphEntra, createEntraAppTokenProvider } from '../flows/entra.mjs';

const ok = (body) => ({ ok: true, status: 200, async json() { return body; } });

test('Graph identity client resolves a subject pointer to directory facts', async () => {
  let seenAuth;
  const fetchImpl = async (url, init) => {
    if (String(url).includes('/users/')) {
      seenAuth = init.headers.Authorization;
      return ok({ id: 'oid-1', jobTitle: 'student', department: 'Nursing' });
    }
    return { ok: false, status: 404 };
  };
  const entra = createGraphEntra({ tokenProvider: async () => 'graph-token', fetchImpl });
  const id = await entra.resolve('entra:obj:oid-1');
  assert.equal(id.subjectRef, 'entra:obj:oid-1');
  assert.equal(id.role, 'student');
  assert.equal(id.department, 'Nursing');
  assert.equal(seenAuth, 'Bearer graph-token');
});

test('a 404 from Graph yields undefined (unknown subject -> fail closed)', async () => {
  const entra = createGraphEntra({ tokenProvider: async () => 't', fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.equal(await entra.resolve('entra:obj:missing'), undefined);
});

test('app token provider exchanges client credentials and caches the token', async () => {
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls++;
    assert.ok(String(url).includes('/oauth2/v2.0/token'));
    assert.match(String(init.body), /grant_type=client_credentials/);
    return ok({ access_token: 'app-token-xyz', expires_in: 3600 });
  };
  const provider = createEntraAppTokenProvider({ tenant: 'tid', clientId: 'cid', clientSecret: 'sec', fetchImpl });
  assert.equal(await provider(), 'app-token-xyz');
  assert.equal(await provider(), 'app-token-xyz');
  assert.equal(calls, 1); // cached
});
