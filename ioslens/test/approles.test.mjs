// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeTool, rolesFromClaims, TOOL_POLICY, APP_ROLES } from '../authz/approles.mjs';
import { AuthError } from '../authz/jwt.mjs';

test('every tool maps to at least one real App Role', () => {
  for (const [tool, roles] of Object.entries(TOOL_POLICY)) {
    assert.ok(roles.length > 0, `${tool} has no roles`);
    for (const r of roles) assert.ok(APP_ROLES[r], `${tool} references unknown role ${r}`);
  }
});

test('Compliance.Read may read but not decide, propose, publish, or audit', () => {
  const roles = ['Compliance.Read'];
  assert.doesNotThrow(() => authorizeTool('compliance.read', roles));
  for (const denied of ['compliance.decide', 'matrix.propose', 'matrix.publish', 'audit.read']) {
    assert.throws(() => authorizeTool(denied, roles), (e) => e instanceof AuthError && e.status === 403);
  }
});

test('separation of duties: Matrix.Propose cannot publish; Matrix.Admin can do both', () => {
  assert.doesNotThrow(() => authorizeTool('matrix.propose', ['Matrix.Propose']));
  assert.throws(() => authorizeTool('matrix.publish', ['Matrix.Propose']), /role required/);
  assert.doesNotThrow(() => authorizeTool('matrix.publish', ['Matrix.Admin']));
  assert.doesNotThrow(() => authorizeTool('matrix.propose', ['Matrix.Admin']));
});

test('no role at all is rejected before any code runs', () => {
  assert.throws(() => authorizeTool('compliance.read', []), (e) => e instanceof AuthError && e.status === 403);
});

test('rolesFromClaims handles array, space-string, and scp', () => {
  assert.deepEqual(rolesFromClaims({ roles: ['A', 'B'] }), ['A', 'B']);
  assert.deepEqual(rolesFromClaims({ roles: 'A B' }), ['A', 'B']);
  assert.deepEqual(rolesFromClaims({ scp: 'Compliance.Read' }), ['Compliance.Read']);
  assert.deepEqual(rolesFromClaims({}), []);
});
