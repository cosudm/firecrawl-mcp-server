// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createJwtVerifier, devSignJwt, AuthError } from '../authz/jwt.mjs';

/** Build a verifier wired to an in-memory JWKS (no network). */
function harness({ issuer = 'https://login.microsoftonline.com/tid/v2.0', audience = 'api://ioslens', clock } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'kid-1';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  let fetches = 0;
  const fetchJwks = async () => { fetches++; return { keys: [jwk] }; };
  const verifier = createJwtVerifier({ jwksUri: 'memory://jwks', issuer, audience, fetchJwks, clock });
  const sign = (claims, kid = 'kid-1') => devSignJwt({ privateKey, kid, claims });
  const now = () => Math.floor((clock ? clock() : Date.now()) / 1000);
  return { verifier, sign, now, fetchCount: () => fetches };
}

const baseClaims = (now) => ({
  iss: 'https://login.microsoftonline.com/tid/v2.0',
  aud: 'api://ioslens',
  exp: now() + 3600,
  nbf: now() - 60,
  oid: 'user-oid-1',
  roles: ['Compliance.Decide'],
});

test('a valid Entra JWT verifies and returns claims', async () => {
  const h = harness();
  const claims = await h.verifier.verify(h.sign(baseClaims(h.now)));
  assert.equal(claims.oid, 'user-oid-1');
  assert.deepEqual(claims.roles, ['Compliance.Decide']);
});

test('a tampered signature is rejected', async () => {
  const h = harness();
  const token = h.sign(baseClaims(h.now));
  const tampered = token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  await assert.rejects(() => h.verifier.verify(tampered), (e) => e instanceof AuthError && e.status === 401);
});

test('issuer mismatch is rejected', async () => {
  const h = harness();
  const claims = { ...baseClaims(h.now), iss: 'https://evil.example/v2.0' };
  await assert.rejects(() => h.verifier.verify(h.sign(claims)), /issuer mismatch/);
});

test('audience mismatch is rejected', async () => {
  const h = harness();
  const claims = { ...baseClaims(h.now), aud: 'api://someone-else' };
  await assert.rejects(() => h.verifier.verify(h.sign(claims)), /audience mismatch/);
});

test('an expired token is rejected', async () => {
  const h = harness();
  const claims = { ...baseClaims(h.now), exp: h.now() - 120, nbf: h.now() - 240 };
  await assert.rejects(() => h.verifier.verify(h.sign(claims)), /token expired/);
});

test('an unknown kid triggers exactly one JWKS refresh then fails', async () => {
  const h = harness();
  const token = h.sign(baseClaims(h.now), 'rotated-kid');
  await assert.rejects(() => h.verifier.verify(token), /no signing key for kid/);
  assert.ok(h.fetchCount() >= 1);
});

test('a malformed token is rejected without crashing', async () => {
  const h = harness();
  await assert.rejects(() => h.verifier.verify('not-a-jwt'), /malformed JWT/);
  await assert.rejects(() => h.verifier.verify(''), /missing bearer token/);
});
