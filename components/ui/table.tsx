import * as React from 'react';
import { cn } from '@/lib/utils';

/** Wraps the table in its own horizontal scroll container so a wide table never makes
 *  the page scroll sideways. */
export function TableWrap({ className, ...props }: React.ComponentProps<'div'>) {
  // scroll-x-hint draws an edge shadow only while there is content past that edge, so a
  // table wider than its card says so instead of silently losing its last column.
  return <div className={cn('w-full overflow-x-auto scroll-x-hint', className)} {...props} />;
}

/** The card the table sits in: rounded, bordered, clipped, with `TableWrap` scrolling
 *  inside it rather than the card itself. */
export function TableCard({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-border bg-card shadow-card',
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return <table className={cn('w-full caption-bottom text-[13px]', className)} {...props} />;
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
      className={cn('border-b border-border/60 transition-colors hover:bg-secondary/40', className)}
      {...props}
    />
  );
}

/** Exported so `SortHeader` can render its own `<th>` — aria-sort belongs on the cell,
 *  not on the button inside it — without restating these classes. */
export const TH_CLASS =
  'px-5 py-[9px] text-left align-middle text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground';

export function TH({ className, ...props }: React.ComponentProps<'th'>) {
  return <th className={cn(TH_CLASS, className)} {...props} />;
}

export function TD({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-5 py-3 align-middle', className)} {...props} />;
}

/** First column: the row's identity, so it carries the weight. */
export function TDName({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-5 py-3 align-middle font-semibold text-foreground', className)} {...props} />;
}

/** Numeric column: right-aligned and recessive, so the eye compares magnitudes down the
 *  column rather than reading each cell. */
export function TDNum({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      className={cn('px-5 py-3 text-right align-middle tabular-nums text-muted-foreground', className)}
      {...props}
    />
  );
}

export function THNum({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'px-5 py-[9px] text-right align-middle text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
