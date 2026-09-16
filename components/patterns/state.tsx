import * as React from 'react';
import { cn } from '@/lib/shared/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/patterns/page-header';

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon ? <div className="mb-3 text-muted-foreground/60">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-xs text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  detail,
  retry,
}: {
  title?: string;
  detail?: string;
  retry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <p className="text-sm font-medium text-destructive">{title}</p>
      {detail ? <p className="mt-1 max-w-md text-xs text-muted-foreground">{detail}</p> : null}
      {retry ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={retry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The failure message a mutation left behind, shown next to the control that failed.
 *
 * This was written thirty-odd times by hand, and drifted into four spellings of one idea —
 * `<p>` or `<span>`, `text-xs` or `text-meta` — so the same failure looked different
 * depending on which button produced it. The two axes are kept as props rather than
 * flattened: the density choice is deliberate in the layouts that made it, and collapsing
 * them would restyle half the app.
 *
 * Renders nothing when `error` is null, so callers do not need the `{error ? … : null}`
 * wrapper that used to surround every copy.
 */
export function ErrorText({
  error,
  as: Tag = 'p',
  size = 'xs',
  className,
}: {
  error?: string | null;
  as?: 'p' | 'span';
  size?: 'xs' | 'meta';
  className?: string;
}) {
  if (!error) return null;
  return (
    <Tag className={cn(size === 'meta' ? 'text-meta' : 'text-xs', 'text-destructive', className)}>
      {error}
    </Tag>
  );
}

/**
 * The same message given a tinted box, for failures that need to carry a whole panel
 * rather than sit beside one control.
 *
 * `compact` is the denser spelling used where the box sits inside an already-tight card.
 * Takes `children` instead of `error` where the message is composed rather than caught —
 * an unset environment variable explaining itself, say.
 */
export function ErrorBanner({
  error,
  tone = 'default',
  className,
  children,
}: {
  error?: string | null;
  tone?: 'default' | 'compact';
  className?: string;
  children?: React.ReactNode;
}) {
  const content = children ?? error;
  if (!content) return null;
  return (
    <p
      className={cn(
        'border border-destructive/30 bg-destructive/10 text-destructive',
        tone === 'compact' ? 'rounded px-2 py-1 text-meta' : 'rounded-md px-3 py-2 text-xs',
        className,
      )}
    >
      {content}
    </p>
  );
}

/** Shown on every page when DATABASE_URL is absent, instead of a stack trace. */
export function NoDatabaseState() {
  return (
    <EmptyState
      title="No database configured"
      hint={
        <>
          Set <code className="rounded bg-secondary px-1 py-0.5 font-mono text-meta">DATABASE_URL</code>{' '}
          in <code className="rounded bg-secondary px-1 py-0.5 font-mono text-meta">.env.local</code> to a
          Neon connection string, then run <code className="rounded bg-secondary px-1 py-0.5 font-mono text-meta">npm run db:migrate</code>{' '}
          and <code className="rounded bg-secondary px-1 py-0.5 font-mono text-meta">npm run db:seed</code>.
        </>
      }
    />
  );
}

/**
 * The whole screen a page returns when there is no database to read.
 *
 * Seven pages spelled this out identically — header, card, NoDatabaseState — and differed
 * only in their own two strings, so the header had to be repeated above the guard as well
 * as below it. Passing the strings in keeps each page saying who it is while the shape
 * lives in one place.
 */
export function noDatabasePage(title: string, subtitle?: React.ReactNode) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Card>
        <NoDatabaseState />
      </Card>
    </>
  );
}
