'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { KpiCard } from './kpi-card';
import { TrendChart, type TrendPoint, type TrendSeries } from '@/components/charts/TrendChart';
import { WeekdayChart, type WeekdayPoint } from '@/components/charts/WeekdayChart';
import { GaugeChart } from '@/components/charts/GaugeChart';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Kpi } from '@/lib/kpi';

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
  defaultOpen = true,
}: MetricsBandProps) {
  const pathname = usePathname();
  const key = `gc.band.${pathname}`;
  const [open, setOpen] = useState(defaultOpen);
  const [ready, setReady] = useState(false);

  // Read after mount: reading localStorage during render would make the server and
  // client markup disagree.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setOpen(raw === '1');
    } catch {
      /* a blocked localStorage is not worth breaking the page over */
    }
    setReady(true);
  }, [key]);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(key, open ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [key, open, ready]);

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
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
            {kpis.map((k, i) => (
              <KpiCard key={k.key} kpi={k} index={i} />
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
                        action={
                          <Button variant="outline" className="h-[30px] rounded-full px-3 text-xs">
                            Show details
                          </Button>
                        }
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
