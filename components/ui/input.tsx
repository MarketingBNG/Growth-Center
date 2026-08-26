import * as React from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-[10px] border border-border bg-card px-3 text-[12.5px] placeholder:text-muted-foreground/70',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-20 w-full rounded-[10px] border border-border bg-card px-3 py-2 text-[12.5px] placeholder:text-muted-foreground/70',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 w-full rounded-[10px] border border-border bg-card px-2.5 text-[12.5px]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A form label. Callers must either pass `htmlFor` or nest the control inside it —
 * a bare sibling label gives the field no accessible name at all, which is what every
 * form here used to do. `components/patterns/field.tsx` does the nesting for you and is
 * the preferred way in.
 */
export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      className={cn('block text-xs font-medium text-muted-foreground', className)}
      {...props}
    />
  );
}
