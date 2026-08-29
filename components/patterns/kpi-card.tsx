import {
  ArrowDown,
  ArrowUp,
  Banknote,
  Building2,
  ChartLine,
  Clock,
  Eye,
  GitBranch,
  Handshake,
  Merge,
  Minus,
  Scale,
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
 */
export function KpiCard({ kpi, index = 0 }: { kpi: Kpi; index?: number }) {
  const change = kpiDelta(kpi);
  const good = change === null || change === 0 ? null : change > 0 === kpi.higherIsBetter;
  const Arrow = change === null || Math.abs(change) < 0.05 ? Minus : change > 0 ? ArrowUp : ArrowDown;
  const Icon = ICONS[kpi.key] ?? ChartLine;

  return (
    <div className="rounded-2xl border border-border bg-card px-[18px] pb-[15px] pt-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12.5px] font-semibold text-muted-foreground">{kpi.label}</p>
        <span
          aria-hidden
          className={cn(
            'grid size-[26px] shrink-0 place-items-center rounded-lg opacity-[0.92]',
            TILE[index % TILE.length],
          )}
        >
          <Icon className="size-[14px] text-white" />
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-2 pt-1.5">
        <p className="text-[27px] font-extrabold leading-none tracking-[-0.035em] tnum">
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

      <p className="pt-1.5 text-[11.5px] text-muted-foreground">
        {change === null
          ? kpi.value === null
            ? (kpi.hint ?? 'No data')
            : 'No prior period'
          : `vs ${show({ ...kpi, value: kpi.previous })} prior period`}
      </p>
    </div>
  );
}
