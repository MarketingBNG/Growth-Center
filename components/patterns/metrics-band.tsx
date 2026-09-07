'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { KpiCard } from './kpi-card';
import { TrendChart, type TrendPoint, type TrendSeries } from '@/components/charts/TrendChart';
import { WeekdayChart, type WeekdayPoint } from '@/components/charts/WeekdayChart';
import { GaugeChart } from '@/components/charts/GaugeChart';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import type { Kpi } from '@/lib/kpi';
import { sourceMeta } from '@/lib/sources';
import { usePersisted } from '@/components/use-persisted';
import { cn } from '@/lib/utils';

export type MetricsBandProps = {
  kpis: Kpi[];
  /**
   * §6.1's demoted row. "Visitors is a vanity number for a firm whose constraint is
   * senior delivery time."
   *
   * Below the primary row and smaller, not hidden behind a toggle. The manual says these
   * move to secondary, not that they go away — visitor counts are still how anybody
   * diagnoses a fall in leads, and a number you have to remember to unfold is a number
   * nobody checks against the one above it.
   */
  secondary?: Kpi[];
  /** The line explaining why the primary row is what it is. */
  secondaryNote?: string;
  trend: {
    title: string;
    subtitle?: string;
    headline?: string;
    note?: string;
    data: TrendPoint[];
    series: TrendSeries[];
  };
  weekday?: { data: WeekdayPoint[]; caption?: string };
  gauge?: { title: string; value: number | null; note?: string; target?: number | null };
  /** Reporting currency for the trend's money axis. */
  currency?: string;
  defaultOpen?: boolean;
};

/**
 * Column counts that divide the row evenly, so the last line is never a short one.
 *
 * `auto-fit` packs as many columns as fit and leaves whatever is left over stranded: six
 * cards on a 1280px screen came out four-then-two, with the dead space beside the orphans
 * reading as a missing card rather than as the end of the row. Counting off the number of
 * cards instead means every breakpoint divides the set — six goes 3+3 then 6, eight goes
 * 4+4 then 8 — and the row always ends flush.
 *
 * Written as whole literal class strings because the JIT reads them, not as an
 * interpolated `grid-cols-${n}` it would never see.
 */
const COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
  5: 'grid-cols-2 lg:grid-cols-5',
  6: 'grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6',
  8: 'grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8',
  9: 'grid-cols-3 lg:grid-cols-3 2xl:grid-cols-9',
  10: 'grid-cols-2 lg:grid-cols-5 2xl:grid-cols-10',
  12: 'grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6',
};

/** A count with no clean division — seven, eleven — keeps the packing behaviour, because
 *  a stranded card is a smaller problem than a row of seven 90px slivers. */
const PACKED = '[grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]';

function columnsFor(n: number, min = PACKED): string {
  return COLUMNS[n] ?? min;
}

/**
 * The analytics band that opens every module screen: KPI cards, then a trend chart with
 * the weekday bars and a rate gauge beside it.
 *
 * The fold state is persisted per route rather than globally — someone who does not care
 * about the numbers on Leads may still want them on the dashboard.
 */
export function MetricsBand({
  kpis,
  secondary,
  secondaryNote,
  trend,
  weekday,
  gauge,
  currency,
  defaultOpen = true,
}: MetricsBandProps) {
  const pathname = usePathname();
  const key = `gc.band.${pathname}`;
  // Stored as JSON now rather than '1'/'0'. A value written by the old version still
  // reads correctly — JSON.parse turns '1' into 1 and '0' into 0, which are the same
  // truthiness the booleans they replace had — so nobody's collapsed band springs open
  // on the first load after this ships. Boolean() normalises the type back.
  const [stored, setOpen] = usePersisted<boolean>(key, defaultOpen);
  const open = Boolean(stored);

  // Which integration the reader is currently asking about. Highlights rather than
  // filters: every figure here has exactly one source, so filtering to one would empty
  // the row instead of comparing anything. Dimming the rest answers "which of these
  // comes from GA4" while leaving the numbers on screen to be read.
  const [focus, setFocus] = useState<string | null>(null);

  const sources = [...new Set(kpis.flatMap((k) => k.sources ?? []))];

  return (
    <section className="pb-[18px]">
      <div className="pb-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? 'Hide the numbers' : 'Show the numbers'}
          {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>

      {open ? (
        <div className="flex flex-col gap-3.5">
          {/* Only worth showing when there is more than one to tell apart. */}
          {sources.length > 1 ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
                Sources
              </span>
              {sources.map((id) => {
                const meta = sourceMeta(id);
                const on = focus === id;
                const count = kpis.filter((k) => (k.sources ?? []).includes(id)).length;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    title={`${meta.name} — ${meta.hint}`}
                    onClick={() => setFocus(on ? null : id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
                      on
                        ? 'border-foreground/25 bg-secondary text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {meta.label}
                    <span className="text-[10px] font-bold tnum opacity-60">{count}</span>
                  </button>
                );
              })}
              {focus ? (
                <button
                  type="button"
                  onClick={() => setFocus(null)}
                  className="text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:underline"
                >
                  Clear
                </button>
              ) : null}
            </div>
          ) : null}

          <div className={cn('grid gap-3.5', columnsFor(kpis.length))}>
            {kpis.map((k, i) => (
              <KpiCard
                key={k.key}
                kpi={k}
                index={i}
                dimmed={focus !== null && !(k.sources ?? []).includes(focus)}
              />
            ))}
          </div>

          {secondary && secondary.length > 0 ? (
            <div>
              {secondaryNote ? (
                <p className="pb-2 text-[11px] text-muted-foreground">{secondaryNote}</p>
              ) : null}
              {/* Narrower columns than the primary row, so the two are legible as
                  different tiers without a heading saying so. */}
              <div
                className={cn(
                  'grid gap-3.5',
                  columnsFor(secondary.length, '[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]'),
                )}
              >
                {secondary.map((k, i) => (
                  <KpiCard
                    key={k.key}
                    kpi={k}
                    index={i}
                    compact
                    dimmed={focus !== null && !(k.sources ?? []).includes(focus)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid items-start gap-3.5 lg:[grid-template-columns:minmax(0,2fr)_minmax(0,1fr)]">
            <TrendChart
              title={trend.title}
              subtitle={trend.subtitle}
              headline={trend.headline}
              headlineNote={trend.note}
              data={trend.data}
              series={trend.series}
              currency={currency}
            />

            {weekday || gauge ? (
              <div className="flex flex-col gap-3.5">
                {weekday ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Leads by weekday</CardTitle>
                    </CardHeader>
                    <div className="px-5 pb-5">
                      <WeekdayChart data={weekday.data} caption={weekday.caption} />
                    </div>
                  </Card>
                ) : null}

                {gauge ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>{gauge.title}</CardTitle>
                    </CardHeader>
                    <div className="px-5 pb-5">
                      <GaugeChart
                        value={gauge.value}
                        note={gauge.note}
                        target={gauge.target}
                      />
                    </div>
                  </Card>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
