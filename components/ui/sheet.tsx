'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A side panel. Built on the same Radix Dialog as `Modal`, which already handles the
 * overlay, the focus trap and Escape — the difference is only where it enters from.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  side = 'right',
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  side?: 'right' | 'left';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/[.32] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className={cn(
            'fixed inset-y-0 z-50 flex w-[440px] max-w-[calc(100vw-2rem)] flex-col bg-card shadow-drawer',
            side === 'right' ? 'right-0 border-l border-border' : 'left-0 border-r border-border',
            'data-[state=open]:animate-in data-[state=open]:fade-in',
            side === 'right'
              ? 'data-[state=open]:slide-in-from-right-7'
              : 'data-[state=open]:slide-in-from-left-7',
            'duration-200',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-[22px] pb-4 pt-5">
            <div className="min-w-0">
              <Dialog.Title className="text-[17px] font-extrabold tracking-[-0.02em]">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <X className="size-4" />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-[22px]">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
