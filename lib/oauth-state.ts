import { createHmac, timingSafeEqual } from 'node:crypto';

// CSRF protection for the OAuth round trip.
//
// The state parameter is signed with NEXTAUTH_SECRET and carries the provider id, the
// user who started the flow, and a timestamp. Without this, a crafted callback link
// could make a signed-in admin connect an account chosen by someone else.

const TTL_MS = 10 * 60 * 1000;

function sign(payload: string): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is not set');
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signState(providerId: string, email: string): string {
  const payload = `${providerId}:${email}:${Date.now()}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

export function verifyState(state: string, providerId: string, email: string): boolean {
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) return false;

  let payload: string;
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return false;
  }

  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return false;
  }

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const [gotProvider, gotEmail, issued] = payload.split(':');
  if (gotProvider !== providerId || gotEmail !== email) return false;
  return Date.now() - Number(issued) < TTL_MS;
}
