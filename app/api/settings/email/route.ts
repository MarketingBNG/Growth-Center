import { route } from '@/lib/api';
import { verifyEmail } from '@/lib/email';

/**
 * Proves the SMTP credentials without sending anything.
 *
 * Worth its own endpoint because the two failures look identical from the outside: a
 * digest that never arrives is the only symptom of a wrong password, an unreachable host,
 * a blocked port and a mailbox that has been suspended. This separates "the credentials
 * are set" — which the settings page already reports — from "the server accepts them".
 *
 * Behind settings:manage: it names the host and returns the mail server's own error text.
 */
export const POST = route('settings:manage', async () => {
  return await verifyEmail();
});
