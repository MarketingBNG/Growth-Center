'use client';

import { useSearchParamUpdate } from '@/components/patterns/use-search-param-update';
import { cn } from '@/lib/shared/utils';

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
  const { pending, update } = useSearchParamUpdate();

  // Deliberately keeps `page`, where the list filters drop it: this pair sits above cards
  // and a chart rather than a paged table, so there is no page number to invalidate.
  function set(key: 'channelId' | 'source', id: string) {
    update((next) => {
      if (id) next.set(key, id);
      else next.delete(key);
    });
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
