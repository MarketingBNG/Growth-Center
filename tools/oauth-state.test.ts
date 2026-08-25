import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXTAUTH_SECRET = 'test-secret-for-state-signing';

const { signState, verifyState } = await import('../lib/oauth-state.ts');
const { createHmac } = await import('node:crypto');

test('a freshly signed state verifies', () => {
  const state = signState('meta_ads', 'shweta@usaindiacfo.com');
  assert.equal(verifyState(state, 'meta_ads', 'shweta@usaindiacfo.com'), true);
});

// Without this binding, a crafted callback link could make a signed-in admin connect
// an account somebody else chose.
test('state is bound to the provider it was issued for', () => {
  const state = signState('meta_ads', 'shweta@usaindiacfo.com');
  assert.equal(verifyState(state, 'zoho_crm', 'shweta@usaindiacfo.com'), false);
});

test('state is bound to the user who started the flow', () => {
  const state = signState('meta_ads', 'shweta@usaindiacfo.com');
  assert.equal(verifyState(state, 'meta_ads', 'dakshita@usaindiacfo.com'), false);
});

test('a tampered payload is rejected', () => {
  const state = signState('meta_ads', 'shweta@usaindiacfo.com');
  const [, signature] = state.split('.');
  const forged = Buffer.from('meta_ads:attacker@evil.com:' + Date.now()).toString('base64url');
  assert.equal(verifyState(`${forged}.${signature}`, 'meta_ads', 'attacker@evil.com'), false);
});

test('malformed state is rejected rather than throwing', () => {
  for (const bad of ['', 'nodot', 'a.b.c', '!!!.???', '.']) {
    assert.equal(verifyState(bad, 'meta_ads', 'shweta@usaindiacfo.com'), false, `accepted ${bad}`);
  }
});

test('an expired state is rejected', () => {
  const stale = Buffer.from(`meta_ads:shweta@usaindiacfo.com:${Date.now() - 11 * 60 * 1000}`).toString('base64url');
  const payload = Buffer.from(stale, 'base64url').toString('utf8');
  const sig = createHmac('sha256', process.env.NEXTAUTH_SECRET!).update(payload).digest('base64url');
  assert.equal(verifyState(`${stale}.${sig}`, 'meta_ads', 'shweta@usaindiacfo.com'), false);
});
