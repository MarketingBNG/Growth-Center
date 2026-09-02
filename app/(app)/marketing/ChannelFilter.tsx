'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { cn } from '@/lib/utils';

/**
 * Two filters, deliberately side by side: channel answers "which part of the business",
 * source answers "who reported this". They are different questions and were being
 * conflated — a Meta Ads channel could hold a seeded campaign.
 */
export function ChannelFilter({
  channels,
  current,
  sources,
  currentSource,
}: {
  channels: { id: string; name: string }[];
  current: string;
  sources: { id: string; name: string }[];
  currentSource: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(key: 'channelId' | 'source', id: string) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set(key, id);
    else next.delete(key);
    startTransition(() => router.replace(`?${next.toString()}`, { scroll: false }));
  }

  return (
    <div className="space-y-1.5 pb-4" data-pending={pending || undefined}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip active={!current} onClick={() => set('channelId', '')}>
          All channels
        </Chip>
        {channels.map((c) => (
          <Chip key={c.id} active={current === c.id} onClick={() => set('channelId', c.id)}>
            {c.name}
          </Chip>
        ))}
      </div>

      {/* Shown while a source is selected even if it is the only one left: narrowing to a
          channel can drop the row to a single source, and the chip that clears the filter
          went with it — leaving an empty table and no way back to it. */}
      {sources.length > 1 || currentSource ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={!currentSource} onClick={() => set('source', '')}>
            All sources
          </Chip>
          {sources.map((s) => (
            <Chip
              key={s.id}
              active={currentSource === s.id}
              onClick={() => set('source', s.id)}
            >
              {s.name}
            </Chip>
          ))}
        </div>
      ) : null}
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
