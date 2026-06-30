// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../core/config.mjs';
import { createApp } from '../core/app.mjs';

async function app() {
  return createApp(loadConfig({ MCP_AUTH: 'dev' }));
}
const ctx = (roles, claims = {}) => ({ roles, claims, principal: 'tester' });
const call = (a, name, args, roles) =>
  a.mcpServer.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx(roles));

test('initialize advertises protocol + tools capability', async () => {
  const a = await app();
  const res = await a.mcpServer.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(res.result.serverInfo.name, 'ioslens');
  assert.ok(res.result.capabilities.tools);
  assert.ok(res.result.protocolVersion);
});

test('tools/list exposes exactly the five governed tools', async () => {
  const a = await app();
  const res = await a.mcpServer.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = res.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['audit.read', 'compliance.decide', 'compliance.read', 'matrix.propose', 'matrix.publish']);
});

test('compliance.read runs for a reader and returns structured content', async () => {
  const a = await app();
  const res = await call(a, 'compliance.read', { codes: [{ system: 'SOC', value: '29-1141' }] }, ['Compliance.Read']);
  assert.equal(res.result.isError, false);
  assert.equal(res.result.structuredContent.matched, 'exact');
  assert.ok(res.result.structuredContent.scopes.includes('nursing.clinical'));
});

test('Layer-1 RBAC: a reader cannot invoke compliance.decide (403 before code runs)', async () => {
  const a = await app();
  const res = await call(a, 'compliance.decide', { subjectRef: 'entra:obj:7c2a-nursing-e91' }, ['Compliance.Read']);
  assert.equal(res.error.code, -32001);
  assert.equal(res.error.data.status, 403);
});

test('compliance.decide records an audit trail readable via audit.read', async () => {
  const a = await app();
  const decide = await call(a, 'compliance.decide', { subjectRef: 'entra:obj:7c2a-nursing-e91' }, ['Compliance.Decide']);
  const trace = decide.result.structuredContent.trace_id;
  assert.ok(trace);

  const read = await call(a, 'audit.read', { traceId: trace }, ['Audit.Read']);
  assert.equal(read.result.structuredContent.count, 1);
  assert.equal(read.result.structuredContent.records[0].decision.scope, 'nursing.clinical');
});

test('matrix.propose -> matrix.publish flow with separation of duties', async () => {
  const a = await app();
  // A steward proposes.
  const proposed = await call(a, 'matrix.propose', { regimeCode: 'FERPA', summary: 'tighten directory opt-out' }, ['Matrix.Propose']);
  const changeId = proposed.result.structuredContent.id;
  assert.ok(changeId);

  // The steward cannot publish.
  const denied = await call(a, 'matrix.publish', { changeId }, ['Matrix.Propose']);
  assert.equal(denied.error.code, -32001);

  // The admin approves + publishes a new version.
  const published = await call(a, 'matrix.publish', { changeId }, ['Matrix.Admin']);
  assert.equal(published.result.structuredContent.published.regime_code, 'FERPA');
  assert.equal(published.result.structuredContent.published.version, 1);
  assert.equal(published.result.structuredContent.published.approver, 'tester');
});

test('unknown tool yields an invalid-params error', async () => {
  const a = await app();
  const res = await a.mcpServer.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'nope' } }, ctx(['Matrix.Admin']));
  assert.equal(res.error.code, -32602);
});
