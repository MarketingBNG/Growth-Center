import * as React from 'react';
import { cn } from '@/lib/utils';

/** Wraps the table in its own horizontal scroll container so a wide table never makes
 *  the page scroll sideways. */
export function TableWrap({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('w-full overflow-x-auto', className)} {...props} />;
}

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return <table className={cn('w-full caption-bottom text-sm', className)} {...props} />;
}

export function THead({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b [&_tr]:border-border', className)} {...props} />;
}

export function TBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TR({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn('border-b border-border/70 transition-colors hover:bg-secondary/40', className)}
      {...props}
    />
  );
}

export function TH({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'h-9 px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-3 py-2.5 align-middle', className)} {...props} />;
}
