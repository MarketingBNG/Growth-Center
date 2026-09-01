'use client';

import { useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Catches an unexpected throw anywhere in the tree.
 *
 * Without this, production showed "Application error: a client-side exception has
 * occurred" — no context and no way back. The message is deliberately not rendered: it can
 * carry internals, and `digest` is the handle for correlating with server logs.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app]', error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6">
      <div className="flex max-w-[460px] flex-col items-center gap-3 text-center">
        <span className="grid size-11 place-items-center rounded-xl bg-danger-soft text-destructive">
          <TriangleAlert className="size-5" />
        </span>
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">Something went wrong</h1>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          The page could not be rendered. Nothing was saved. Try again — if it keeps
          happening, the reference below will be in the server logs.
        </p>
        {error.digest ? (
          <p className="font-mono text-[11px] text-muted-foreground">ref {error.digest}</p>
        ) : null}
        <div className="mt-1 flex gap-2">
          <Button onClick={reset}>Try again</Button>
          {/* A plain anchor, deliberately, and the rule is suppressed rather than
              followed: this boundary is showing because the tree below it failed to
              render, and both a <Link> and a router push are client navigations that
              would carry that same broken tree to the dashboard. A document load is the
              point — it rebuilds the app from scratch, which is the only thing that
              reliably clears whatever caused this. */}
          <Button variant="outline" asChild>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/">Back to the dashboard</a>
          </Button>
        </div>
      </div>
    </main>
  );
}
