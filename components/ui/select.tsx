'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A drop-in replacement for `<select>` that keeps the same call signature — `<option>`
 * children, `value`/`defaultValue`, `onChange(e.target.value)`, `name` — but renders the
 * open list itself instead of handing it to the OS.
 *
 * That is the whole point of the component. A native `<select>` takes our classes on the
 * closed box and ignores them entirely on the popup, which the platform draws in its own
 * colours, radii and font. `color-scheme` in globals.css gets that popup to at least
 * follow light/dark; only a real listbox can match the rest of the theme.
 */

type Opt = { value: string; label: React.ReactNode; disabled?: boolean };

/** Radix reserves the empty string (it means "clear"), so an `<option value="">` — the
 *  "all"/"unassigned" row several filters rely on — needs a stand-in inside the widget. */
const EMPTY = '__empty__';
const toRadix = (v: string | undefined) => (v === '' ? EMPTY : v);
const fromRadix = (v: string) => (v === EMPTY ? '' : v);

/** Options may arrive nested in fragments or arrays from `.map()`, so walk the tree. */
function collect(children: React.ReactNode, out: Opt[] = []): Opt[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      collect((child.props as { children?: React.ReactNode }).children, out);
      return;
    }
    if (child.type === 'option') {
      const p = child.props as React.ComponentProps<'option'>;
      out.push({
        value: String(p.value ?? ''),
        label: p.children ?? String(p.value ?? ''),
        disabled: p.disabled,
      });
    }
  });
  return out;
}

export function Select({
  className,
  children,
  value,
  defaultValue,
  onChange,
  name,
  disabled,
  required,
  'aria-label': ariaLabel,
  ...props
}: React.ComponentProps<'select'>) {
  const options = collect(children);
  const controlled = value !== undefined;
  const [inner, setInner] = React.useState(String(defaultValue ?? ''));
  const current = controlled ? String(value ?? '') : inner;

  function handle(next: string) {
    const v = fromRadix(next);
    if (!controlled) setInner(v);
    // Callers only ever read `e.target.value`, so a minimal stand-in event is enough to
    // keep every existing `onChange` working unchanged.
    onChange?.({ target: { value: v, name } } as React.ChangeEvent<HTMLSelectElement>);
  }

  return (
    <>
      <SelectPrimitive.Root
        value={toRadix(current)}
        onValueChange={handle}
        disabled={disabled}
        required={required}
      >
        <SelectPrimitive.Trigger
          aria-label={ariaLabel}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-[10px] border border-border bg-card px-2.5 text-[12.5px]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50',
            'data-[placeholder]:text-muted-foreground/70',
            className,
          )}
          {...(props as React.ComponentProps<typeof SelectPrimitive.Trigger>)}
        >
          <SelectPrimitive.Value />
          <SelectPrimitive.Icon asChild>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={4}
            className={cn(
              'z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[10px]',
              'border border-border bg-popover text-popover-foreground shadow-lg',
              'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            )}
          >
            <SelectPrimitive.Viewport className="p-1">
              {options.map((o) => (
                <SelectPrimitive.Item
                  key={o.value}
                  value={toRadix(o.value)!}
                  disabled={o.disabled}
                  className={cn(
                    'relative flex cursor-default select-none items-center rounded-[7px] py-1.5 pl-2.5 pr-7 text-[12.5px] outline-none',
                    'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
                    'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                  )}
                >
                  <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center">
                    <Check className="size-3.5" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>

      {/* Radix's own hidden control would submit the `__empty__` stand-in, so carry the
          real value for forms that post this field by name. */}
      {name ? <input type="hidden" name={name} value={current} /> : null}
    </>
  );
}
