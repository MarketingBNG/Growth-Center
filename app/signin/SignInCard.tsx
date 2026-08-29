'use client';

import { signIn } from 'next-auth/react';
import { TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ALLOWED_DOMAINS } from '@/lib/roles';

/** AccessDenied is what the roster check returns for a valid Google account that is
 *  not on the roster — worth naming, because it is not a broken login. */
function message(error?: string) {
  if (!error) return null;
  if (error === 'AccessDenied') {
    return `That Google account is not on the Growth Center roster. Ask Karan or Shweta to add it.`;
  }
  return 'Sign-in failed. Please try again.';
}

export function SignInCard({
  error,
  configured,
  returnTo,
}: {
  error?: string;
  configured: boolean;
  /** Already validated on the server — never pass a raw `?from=` here. */
  returnTo: string;
}) {
  const msg = message(error);

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2.5 pb-5">
            <span className="grid size-9 place-items-center rounded-md bg-primary/15 text-primary">
              <TrendingUp className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Growth Center</p>
              <p className="text-xs text-muted-foreground">BNG Advisors</p>
            </div>
          </div>

          {msg ? (
            <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {msg}
            </p>
          ) : null}

          {configured ? (
            <Button className="w-full" onClick={() => signIn('google', { callbackUrl: returnTo })}>
              Continue with Google
            </Button>
          ) : (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
              Google sign-in is not configured. Set{' '}
              <code className="font-mono">GOOGLE_CLIENT_ID</code> and{' '}
              <code className="font-mono">GOOGLE_CLIENT_SECRET</code> in{' '}
              <code className="font-mono">.env.local</code>.
            </div>
          )}

          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Restricted to {ALLOWED_DOMAINS.join(' and ')} accounts on the Growth Center roster.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
