import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/** Pills, not chips: soft ground plus the solid status colour for the text. The tone
 *  mapping is unchanged from before. Text uses the *-strong tokens, which are the same
 *  hues stepped dark enough to clear 4.5:1 on their own ground at 11px bold. */
const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-[9px] py-[3px] text-[11px] font-bold leading-tight',
  {
    variants: {
      tone: {
        neutral: 'bg-track text-muted-foreground',
        info: 'bg-primary-soft text-info-strong',
        success: 'bg-success-soft text-success-strong',
        warning: 'bg-warning-soft text-warning-strong',
        danger: 'bg-danger-soft text-danger-strong',
        purple: 'bg-purple-soft text-purple-strong',
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
