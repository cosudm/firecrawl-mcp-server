// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../core/config.mjs';
import { createApp } from '../core/app.mjs';
import { createHttpTransport } from '../mcp/transport-http.mjs';

/** Build a 2-segment "dev" token the insecure dev verifier decodes (header.payload). */
function devToken(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(claims)}`;
}

async function start() {
  const app = await createApp(loadConfig({ MCP_AUTH: 'dev' }));
  const server = createHttpTransport({ server: app.mcpServer, verifier: app.verifier, health: app.health });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

const post = (base, body, token) =>
  fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

test('GET /healthz reports backend kinds', async () => {
  const s = await start();
  const h = await (await fetch(`${s.base}/healthz`)).json();
  assert.equal(h.ok, true);
  assert.equal(h.store, 'memory');
  assert.ok(Array.isArray(h.tools));
  await s.close();
});

test('a request without a bearer token is rejected (401)', async () => {
  const s = await start();
  const res = await post(s.base, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(res.status, 401);
  await s.close();
});

test('an authenticated tools/call resolves the governed boundary', async () => {
  const s = await start();
  const token = devToken({ oid: 'u1', roles: ['Compliance.Decide'] });
  const res = await post(s.base, {
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'compliance.decide', arguments: { subjectRef: 'entra:obj:7c2a-nursing-e91' } },
  }, token);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.result.structuredContent.decision.scope, 'nursing.clinical');
  await s.close();
});

test('RBAC denial surfaces as a JSON-RPC error over HTTP 200', async () => {
  const s = await start();
  const token = devToken({ oid: 'u1', roles: ['Compliance.Read'] });
  const res = await post(s.base, {
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'compliance.decide', arguments: { subjectRef: 'entra:obj:7c2a-nursing-e91' } },
  }, token);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.error.code, -32001);
  assert.equal(body.error.data.status, 403);
  await s.close();
});
