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
 * The analytics band that opens every module screen: KPI cards, then a trend chart with
 * the weekday bars and a rate gauge beside it.
 *
 * The fold state is persisted per route rather than globally — someone who does not care
 * about the numbers on Leads may still want them on the dashboard.
 */
export function MetricsBand({
  kpis,
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

          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
            {kpis.map((k, i) => (
              <KpiCard
                key={k.key}
                kpi={k}
                index={i}
                dimmed={focus !== null && !(k.sources ?? []).includes(focus)}
              />
            ))}
          </div>

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
