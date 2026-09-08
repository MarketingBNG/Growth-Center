import {
  ArrowDown,
  ArrowUp,
  Banknote,
  Building2,
  CalendarCheck,
  ChartLine,
  Clock,
  Eye,
  GitBranch,
  Handshake,
  Merge,
  Minus,
  Scale,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  UserPlus,
  UserX,
  Users,
} from 'lucide-react';
import { fmtCompact, fmtDays, fmtDuration, fmtMoney, fmtPercent, fmtRatio } from '@/lib/format';
import { cn } from '@/lib/utils';
import { kpiDelta, type Kpi } from '@/lib/kpi';
import { sourceMeta } from '@/lib/sources';

function show(k: Kpi): string {
  if (k.value === null) return '—';
  switch (k.format) {
    case 'money':
      return fmtMoney(k.value, false, k.currency);
    case 'percent':
      return fmtPercent(k.value);
    case 'ratio':
      return fmtRatio(k.value);
    case 'duration':
      return fmtDuration(k.value);
    case 'days':
      return fmtDays(k.value);
    default:
      return fmtCompact(k.value);
  }
}

/** Series slots, assigned in order across the row and never cycled per-card. Written as
 *  Tailwind classes rather than inline CSS vars so the utilities stay in one vocabulary —
 *  these are literals, so the JIT sees them. */
const TILE = [
  'bg-chart-1',
  'bg-chart-2',
  'bg-chart-3',
  'bg-chart-4',
  'bg-chart-5',
  'bg-chart-6',
] as const;

/** Keyed on the KPI, not on position, so the same metric wears the same glyph on every
 *  screen it appears on. */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  visitors: Eye,
  sessions: Eye,
  leads: Sparkles,
  qualified: Target,
  opportunities: Handshake,
  customers: UserPlus,
  revenue: Banknote,
  newRevenue: Banknote,
  spend: Banknote,
  cac: Scale,
  roas: Trophy,
  cpl: Scale,
  quality: Scale,
  cpql: Scale,
  consultations: CalendarCheck,
  attribution: ShieldCheck,
  response: Clock,
  unassigned: UserX,
  companies: Building2,
  contacts: Users,
  avgAccount: Banknote,
  duplicates: Merge,
  openDeals: Handshake,
  totalValue: Banknote,
  weighted: Scale,
  winRate: Trophy,
  cycle: GitBranch,
  visitorToLead: ChartLine,
  leadToQualified: ChartLine,
  oppToCustomer: ChartLine,
};

/**
 * One KPI. The delta colour follows the metric's own direction rather than the arrow's —
 * rising spend and rising CAC are not wins — and the arrow glyph carries the direction so
 * it is never conveyed by colour alone.
 *
 * Hovering or focusing the card says where the figure came from and how it is worked out.
 * Both facts existed already and neither was reachable: `hint` explains that CAC and ROAS
 * are blended across every channel while only Meta is paid, but it was only rendered when
 * a card had no value at all — so the one time it mattered was the one time it never
 * showed. The source ids come from the rows themselves, so the card names the integration
 * that actually wrote its number rather than one assumed at build time.
 */
export function KpiCard({
  kpi,
  index = 0,
  /** Recedes while the reader is asking about a different source. Not hidden: the point
   *  of the source strip is to show which figures belong together, which needs the rest
   *  of them still on screen to be compared with. */
  dimmed = false,
  /**
   * §6.1's secondary row. Smaller type and a smaller tile, so the two tiers read as
   * different weights of the same card rather than as two unrelated components.
   *
   * Everything else is identical on purpose — the tooltip, the source strip, the delta
   * and the null handling. A demoted figure is still a figure somebody will act on, and a
   * cut-down card would be the one place on the screen where a number arrives without its
   * caveats.
   */
  compact = false,
}: {
  kpi: Kpi;
  index?: number;
  dimmed?: boolean;
  compact?: boolean;
}) {
  const change = kpiDelta(kpi);
  const good = change === null || change === 0 ? null : change > 0 === kpi.higherIsBetter;
  const Arrow = change === null || Math.abs(change) < 0.05 ? Minus : change > 0 ? ArrowUp : ArrowDown;
  const Icon = ICONS[kpi.key] ?? ChartLine;

  const sources = (kpi.sources ?? []).map(sourceMeta);
  const tipId = `kpi-${kpi.key}-tip`;
  const hasTip = !!kpi.hint || sources.length > 0 || !!kpi.comparisonNote;

  return (
    <div
      className={cn(
        'group relative rounded-2xl border border-border bg-card shadow-card',
        compact ? 'px-[15px] pb-3 pt-3' : 'px-[18px] pb-[15px] pt-4',
        'transition-opacity duration-150',
        dimmed && 'opacity-35',
      )}
      // Focusable so the tooltip is reachable by keyboard, not hover alone.
      tabIndex={hasTip ? 0 : undefined}
      aria-describedby={hasTip ? tipId : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12.5px] font-semibold text-muted-foreground">{kpi.label}</p>
        <span
          aria-hidden
          className={cn(
            'grid shrink-0 place-items-center rounded-lg opacity-[0.92]',
            compact ? 'size-[21px]' : 'size-[26px]',
            TILE[index % TILE.length],
          )}
        >
          <Icon className={compact ? 'size-[11px] text-white' : 'size-[14px] text-white'} />
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-2 pt-1.5">
        <p
          className={cn(
            'font-extrabold leading-none tracking-[-0.035em] tnum',
            // Clamped rather than fixed: a number cannot reflow, so an eleven-digit
            // figure like a total pipeline value ran past the edge of its card at the
            // narrower widths. It steps down instead of spilling, and is back at full
            // size wherever there is room for it.
            compact ? 'text-[clamp(15px,1.5vw,20px)]' : 'text-[clamp(19px,1.8vw,27px)]',
          )}
        >
          {show(kpi)}
        </p>
        {change !== null ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold tnum',
              good === null
                ? 'bg-track text-muted-foreground'
                : good
                  ? 'bg-success-soft text-success-strong'
                  : 'bg-danger-soft text-danger-strong',
            )}
          >
            <Arrow className="size-[11px]" />
            {fmtPercent(Math.abs(change), 1)}
          </span>
        ) : null}
      </div>

      {/* Clamped: when a card has no value this line falls back to the full hint, and
          one long fallback used to stretch every card in the grid row to match it. The
          whole text is still a hover away in the tooltip below. */}
      <p className="line-clamp-2 pt-1.5 text-[11.5px] text-muted-foreground">
        {change === null
          ? kpi.value === null
            ? // The note comes first: when a card has no value the reason is the whole
              // message, and falling through to the hint described what the figure WOULD
              // have meant while saying nothing about why it is missing.
              (kpi.comparisonNote ?? kpi.hint ?? 'No data')
            : (kpi.comparisonNote ?? 'No prior period')
          : `vs ${show({ ...kpi, value: kpi.previous })} prior period`}
      </p>

      {hasTip ? (
        <div
          id={tipId}
          role="tooltip"
          // Hidden until the card is hovered or something inside it takes focus. No
          // JavaScript and no state: a tooltip that re-renders the row on every mouse
          // move is a worse trade than two utility classes.
          className={cn(
            'pointer-events-none absolute left-3 right-3 top-full z-20 mt-1.5 rounded-xl border border-border',
            'bg-card p-3 text-left shadow-card opacity-0 transition-opacity duration-100',
            'group-hover:opacity-100 group-focus-within:opacity-100 group-focus:opacity-100',
          )}
        >
          {sources.length ? (
            <>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {sources.length > 1 ? 'Sources' : 'Source'}
              </p>
              <ul className="pt-1">
                {sources.map((s) => (
                  <li key={s.name} className="text-[11.5px]">
                    <span className="font-semibold text-foreground">{s.name}</span>
                    <span className="text-muted-foreground"> — {s.hint}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {kpi.hint ? (
            <p className={cn('text-[11.5px] text-muted-foreground', sources.length && 'pt-2')}>
              {kpi.hint}
            </p>
          ) : null}

          {kpi.comparisonNote ? (
            <p className="pt-2 text-[11.5px] text-muted-foreground">{kpi.comparisonNote}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
