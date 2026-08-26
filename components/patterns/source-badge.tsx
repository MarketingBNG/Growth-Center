import { cn } from '@/lib/utils';
import { sourceMeta, type SourceTone } from '@/lib/sources';

// Where a figure came from, shown next to the figure itself. Provenance used to live
// only on the Analytics page, so every other page presented seeded numbers exactly like
// reported ones.

const TONE: Record<SourceTone, string> = {
  // Deliberately quiet. This appears on every row, so a loud badge would compete with
  // the numbers it is annotating.
  live: 'border-success/30 bg-success-soft text-success-strong',
  seeded: 'border-warning/40 bg-warning-soft text-warning-strong',
  internal: 'border-border bg-secondary/60 text-muted-foreground',
};

export function SourceBadge({
  source,
  className,
  full = false,
}: {
  source: string | null | undefined;
  className?: string;
  /** Use the full provider name rather than the short label. */
  full?: boolean;
}) {
  const meta = sourceMeta(source);

  return (
    <span
      title={meta.hint}
      className={cn(
        'inline-flex shrink-0 items-center rounded border px-1.5 py-px text-[10px] font-medium leading-4',
        TONE[meta.tone],
        className,
      )}
    >
      {full ? meta.name : meta.label}
    </span>
  );
}

/**
 * The provenance line under a page header: "Spend Meta · Visitors seeded".
 *
 * States where each figure on the page comes from before the reader has taken in a
 * single number, which is the part that was missing — a page of mixed real and seeded
 * figures looked entirely uniform.
 */
export function SourceLine({
  items,
  className,
}: {
  /** One entry per figure. `sources` is a list because a single figure can legitimately
   *  blend platforms — spend from Meta plus a seeded campaign is two badges, not one
   *  averaged claim. */
  items: { label: string; sources: (string | null)[] }[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-4', className)}>
      <span className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        Sources
      </span>
      {items.map((item) => {
        const unique = [...new Set(item.sources.length ? item.sources : [null])];
        return (
          <span key={item.label} className="inline-flex items-center gap-1.5 text-[11px]">
            <span className="text-muted-foreground">{item.label}</span>
            {unique.map((s) => (
              <SourceBadge key={s ?? 'internal'} source={s} />
            ))}
          </span>
        );
      })}
    </div>
  );
}
