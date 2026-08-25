'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { cn } from '@/lib/utils';

export function ChannelFilter({
  channels,
  current,
}: {
  channels: { id: string; name: string }[];
  current: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(id: string) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set('channelId', id);
    else next.delete('channelId');
    startTransition(() => router.replace(`?${next.toString()}`));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 pb-4" data-pending={pending || undefined}>
      <Chip active={!current} onClick={() => set('')}>
        All channels
      </Chip>
      {channels.map((c) => (
        <Chip key={c.id} active={current === c.id} onClick={() => set(c.id)}>
          {c.name}
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs transition-colors',
        active
          ? 'border-primary/40 bg-primary/12 font-medium text-primary'
          : 'border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
