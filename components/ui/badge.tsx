import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-tight whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-secondary/60 text-muted-foreground',
        info: 'border-primary/30 bg-primary/10 text-primary',
        success: 'border-success/30 bg-success/10 text-success',
        warning: 'border-warning/30 bg-warning/10 text-warning',
        danger: 'border-destructive/30 bg-destructive/10 text-destructive',
        purple: 'border-chart-4/30 bg-chart-4/10 text-chart-4',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { badgeVariants };
