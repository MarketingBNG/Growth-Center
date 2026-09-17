'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/shared/utils';
import { Button } from '@/components/ui/button';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
            'max-h-[calc(100vh-4rem)] overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-2xl',
            'data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 pb-4">
            <div>
              <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <X className="size-4" />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * A dialog's Cancel / submit pair.
 *
 * Four dialogs wrote this out, down to the same "Saving…" while a write is in flight —
 * which is worth having in one place, because it is the sentence that tells someone their
 * click registered.
 *
 * `pt-1` is the default rather than something each dialog repeats. Three of the four
 * carried it and the fourth did not — four pixels nobody chose, so the three won. The
 * odd one out (the new-content dialog) gains that gap and now matches its siblings.
 * `className` stays for a dialog that genuinely needs different spacing.
 */
export function ModalFooter({
  onCancel,
  busy,
  submit,
  className,
}: {
  onCancel: () => void;
  busy: boolean;
  /** What the submit button says when it is not busy. */
  submit: string;
  className?: string;
}) {
  return (
    <div className={cn('flex justify-end gap-2 pt-1', className)}>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : submit}
      </Button>
    </div>
  );
}
