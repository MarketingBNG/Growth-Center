import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

// AES-256-GCM for integration credentials. Server-only: importing this into a client
// component would put APP_ENCRYPTION_KEY in the browser bundle.

export type Sealed = { ciphertext: string; iv: string; authTag: string };

function key(): Buffer {
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (!hex) throw new Error('APP_ENCRYPTION_KEY is not set');
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('APP_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)');
  }
  return Buffer.from(hex, 'hex');
}

export function seal(plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function open(sealed: Sealed): string {
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export const hasEncryptionKey = () => /^[0-9a-f]{64}$/i.test(process.env.APP_ENCRYPTION_KEY || '');

// API keys are compared by hash, so a leaked database yields no usable key. SHA-256
// rather than bcrypt on purpose: these are 32 bytes of CSPRNG output, not passwords —
// there is no dictionary to slow an attacker down against.
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const plaintext = `gc_${randomBytes(24).toString('base64url')}`;
  return { plaintext, hash: hashApiKey(plaintext), prefix: plaintext.slice(0, 11) };
}
