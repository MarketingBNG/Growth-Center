import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

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

/** Shown on every page when DATABASE_URL is absent, instead of a stack trace. */
export function NoDatabaseState() {
  return (
    <EmptyState
      title="No database configured"
      hint={
        <>
          Set <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[11px]">DATABASE_URL</code>{' '}
          in <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[11px]">.env.local</code> to a
          Neon connection string, then run <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[11px]">npm run db:migrate</code>{' '}
          and <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[11px]">npm run db:seed</code>.
        </>
      }
    />
  );
}
