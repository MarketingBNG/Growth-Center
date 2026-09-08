import { cn } from '@/lib/utils';

/**
 * A figure with no comparison behind it.
 *
 * The other half of the pair with KpiCard: that one carries an icon and a change against
 * a prior period, this one is for numbers where a delta would be meaningless or is not
 * available. Everything else about them matches on purpose — same radius, same padding,
 * same label weight, same value treatment — because a reader should not have to work out
 * whether two figures are the same kind of thing from how they are drawn.
 *
 * It replaces four local copies. `Stat` had been redeclared in the ads, SEO, social and
 * content pages; three were identical and the fourth had drifted to its own label size,
 * tracking and weight, so the same figure was set four ways across four screens. The
 * clamped value size is KpiCard's, for the same reason: a number cannot reflow, so an
 * eleven-digit figure has to step down rather than run past the edge of its card.
 */
export function StatTile({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: string;
  /** A line under the figure — what it excludes, what it is measured against. */
  sub?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-card px-[18px] pb-[15px] pt-4 shadow-card',
        className,
      )}
    >
      <p className="text-body font-semibold text-muted-foreground">{label}</p>
      <p className="pt-1.5 text-[clamp(17px,1.6vw,23px)] font-extrabold leading-none tracking-[-0.035em] tnum">
        {value}
      </p>
      {sub ? <p className="pt-1.5 text-meta leading-snug text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
