'use client';

import { Bar, BarChart as ReBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AXIS, ChartFrame, GRID, SERIES, Tip } from './chart-parts';
import { fmtCompact, fmtMoney } from '@/lib/format';

export type BarDatum = { label: string; value: number };

/** Horizontal bars for comparing a handful of named things — channels, campaigns.
 *  Horizontal because the labels are words, and words do not fit under vertical bars. */
export function BarChart({
  title,
  subtitle,
  data,
  kind = 'number',
  height,
  currency,
}: {
  title: string;
  subtitle?: string;
  data: BarDatum[];
  kind?: 'number' | 'money';
  /** Reporting currency for a `money` chart, passed down from the server. */
  currency?: string;
  height?: number;
}) {
  const fmt = (v: number) => (kind === 'money' ? fmtMoney(v, false, currency) : fmtCompact(v));
  const h = height ?? Math.max(140, data.length * 34 + 24);

  return (
    <ChartFrame title={title} subtitle={subtitle}>
      <ResponsiveContainer width="100%" height={h}>
        <ReBarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 0 }}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" {...AXIS} tickFormatter={fmt} />
          <YAxis type="category" dataKey="label" {...AXIS} width={112} />
          <Tooltip
            cursor={{ fill: 'var(--secondary)', fillOpacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0];
              return (
                <Tip
                  label={String(d.payload.label)}
                  rows={[{ key: 'v', label: title, value: fmt(Number(d.value)), color: SERIES[0] }]}
                />
              );
            }}
          />
          {/* 4px rounded data-end, square against the baseline. */}
          <Bar
            dataKey="value"
            fill={SERIES[0]}
            radius={[0, 4, 4, 0]}
            maxBarSize={18}
            isAnimationActive={false}
          />
        </ReBarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
