import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.APP_ENCRYPTION_KEY = 'a'.repeat(64);

const { seal, open, generateApiKey, hashApiKey } = await import('../lib/crypto.ts');

test('seal then open round-trips', () => {
  const secret = JSON.stringify({ refreshToken: 'zoho-token-123', scope: 'ZohoCRM.modules.ALL' });
  assert.equal(open(seal(secret)), secret);
});

test('each seal uses a fresh IV', () => {
  const a = seal('same input');
  const b = seal('same input');
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test('a tampered ciphertext fails the auth tag rather than decrypting', () => {
  const sealed = seal('sensitive');
  const bytes = Buffer.from(sealed.ciphertext, 'base64');
  bytes[0] ^= 0xff;
  assert.throws(() => open({ ...sealed, ciphertext: bytes.toString('base64') }));
});

test('API keys are prefixed, hashed, and never equal their hash', () => {
  const { plaintext, hash, prefix } = generateApiKey();
  assert.ok(plaintext.startsWith('gc_'));
  assert.equal(prefix, plaintext.slice(0, 11));
  assert.equal(hash, hashApiKey(plaintext));
  assert.notEqual(hash, plaintext);
});

test('two generated API keys differ', () => {
  assert.notEqual(generateApiKey().plaintext, generateApiKey().plaintext);
});
