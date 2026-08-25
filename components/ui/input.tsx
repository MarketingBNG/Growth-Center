import * as React from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/70',
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
        'min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/70',
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
        'h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      className={cn('text-xs font-medium text-muted-foreground', className)}
      {...props}
    />
  );
}
