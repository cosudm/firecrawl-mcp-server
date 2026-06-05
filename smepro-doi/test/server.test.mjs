// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../server/api.mjs';

/** Start a server on an ephemeral port; returns base URL + close(). */
async function start(config) {
  const server = createApiServer(config);
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

const stubResult = { engine: 'claude', parties: [], documents: [{ id: 'D1', kind: 'oilGasLease', title: 'L', fields: [] }], notes: [] };

test('GET /api/health reports key presence + model', async () => {
  const s = await start({ apiKey: 'sk-test', model: 'claude-opus-4-8', extractor: async () => stubResult });
  const h = await (await fetch(`${s.base}/api/health`)).json();
  assert.equal(h.ok, true);
  assert.equal(h.hasKey, true);
  assert.equal(h.model, 'claude-opus-4-8');
  assert.equal(h.engine, 'claude');
  assert.equal(h.keyInfo.prefix, 'sk-test'); // safe diagnostic, no secret
  assert.equal(h.keyInfo.hadQuotes, false);
  await s.close();
});

test('POST /api/extract (text) returns the extractor result', async () => {
  let seen;
  const s = await start({ apiKey: 'sk-test', extractor: async (input) => { seen = input; return stubResult; } });
  const res = await fetch(`${s.base}/api/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'WARRANTY DEED' }) });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), stubResult);
  assert.equal(seen.text, 'WARRANTY DEED');
  await s.close();
});

test('POST /api/extract (pdf) forwards the base64 document', async () => {
  let seen;
  const s = await start({ apiKey: 'sk-test', extractor: async (input) => { seen = input; return stubResult; } });
  const res = await fetch(`${s.base}/api/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pdfBase64: 'JVBERi0=', mediaType: 'application/pdf' }) });
  assert.equal(res.status, 200);
  assert.equal(seen.pdfBase64, 'JVBERi0=');
  await s.close();
});

test('without a key, /api/extract returns 503 (heuristic still works client-side)', async () => {
  const s = await start({ apiKey: '', extractor: async () => stubResult });
  const res = await fetch(`${s.base}/api/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x' }) });
  assert.equal(res.status, 503);
  await s.close();
});

test('serves the app at /', async () => {
  const s = await start({ apiKey: 'sk-test', extractor: async () => stubResult });
  const res = await fetch(`${s.base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /DOI Builder/);
  await s.close();
});
