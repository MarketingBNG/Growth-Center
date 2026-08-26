import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A labelled form control.
 *
 * The control is nested INSIDE the `<label>` so the association is implicit and needs no
 * id plumbing. It used to sit as a sibling of a bare `<label>` with no `htmlFor`, which
 * meant no field in any modal form had an accessible name — a screen reader announced
 * "edit text" and nothing else. Wrapping is the one arrangement that cannot drift out of
 * sync the way a hand-written id pair can.
 *
 * `required` marks the label visually; put the real `required` attribute on the control
 * too, so the browser and assistive tech both know.
 */
export function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <label className="block space-y-1">
        <span className="block text-xs font-medium text-muted-foreground">
          {label}
          {required ? (
            <span className="text-destructive" aria-hidden>
              {' '}
              *
            </span>
          ) : null}
        </span>
        {children}
      </label>
      {/* Outside the <label> deliberately. Inside, its text became part of the field's
          accessible name — "EmailUsed to detect duplicates and link the CRM record."
          rather than "Email". */}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
