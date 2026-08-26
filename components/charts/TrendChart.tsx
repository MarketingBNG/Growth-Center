'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AXIS, ChartFrame, GRID, SERIES, Tip } from './chart-parts';
import { fmtCompact, fmtDay, fmtMoneyCompact } from '@/lib/format';

export type TrendPoint = { date: string; [key: string]: string | number };

export type TrendSeries = { key: string; label: string; kind: 'number' | 'money' };

/**
 * One or more series that share a unit. Deliberately has no second y-axis: two
 * measures of different scale get two charts, never two scales on one — a dual axis
 * lets the author choose which line appears to be winning.
 *
 * Series identity is never colour-alone: the first series is solid with an area fill,
 * the second is dashed, and the legend names both.
 */
export function TrendChart({
  title,
  subtitle,
  data,
  series,
  height = 220,
  headline,
  headlineNote,
}: {
  title: string;
  subtitle?: string;
  data: TrendPoint[];
  series: TrendSeries[];
  height?: number;
  /** Pre-formatted figure shown above the plot. */
  headline?: string;
  headlineNote?: string;
}) {
  const colored = series.map((s, i) => ({ ...s, color: SERIES[i % SERIES.length] }));
  const fmt = (v: number, kind: TrendSeries['kind']) =>
    kind === 'money' ? fmtMoneyCompact(v) : fmtCompact(v);

  const label = (raw: string) => (raw.length === 7 ? monthLabel(raw) : fmtDay(raw));

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      legend={colored.map((c, i) => ({ label: c.label, color: c.color, dashed: i > 0 }))}
    >
      {headline ? (
        <div className="px-3 pb-1 pt-1">
          <p className="text-[32px] font-extrabold leading-none tracking-[-0.04em] tnum">
            {headline}
          </p>
          {headlineNote ? (
            <p className="pt-1.5 text-[11.5px] text-muted-foreground">{headlineNote}</p>
          ) : null}
        </div>
      ) : null}

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>
          <defs>
            {colored.map((s) => (
              <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.26} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="date" {...AXIS} tickFormatter={label} minTickGap={28} />
          <YAxis
            {...AXIS}
            width={46}
            tickCount={5}
            tickFormatter={(v) => fmt(Number(v), colored[0].kind)}
          />
          <Tooltip
            cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '4 3' }}
            content={({ active, payload, label: raw }) => {
              if (!active || !payload?.length) return null;
              return (
                <Tip
                  label={label(String(raw))}
                  rows={payload.map((p) => {
                    const s = colored.find((c) => c.key === p.dataKey);
                    return {
                      key: String(p.dataKey),
                      label: s?.label ?? String(p.dataKey),
                      value: fmt(Number(p.value), s?.kind ?? 'number'),
                      color: s?.color ?? SERIES[0],
                    };
                  })}
                />
              );
            }}
          />
          {colored.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={i === 0 ? 2.4 : 2}
              strokeLinejoin="round"
              strokeLinecap="round"
              // Only the first series carries a fill. Two stacked translucent areas
              // muddied the overlap into a third colour that meant nothing.
              strokeDasharray={i === 0 ? undefined : '5 4'}
              fill={i === 0 ? `url(#fill-${s.key})` : 'transparent'}
              // A dot per point becomes noise at 365 points; the hover crosshair is
              // what makes individual values readable.
              dot={false}
              activeDot={{ r: 4.5, strokeWidth: 2.5, stroke: 'var(--card)' }}
              // Off deliberately: the left-to-right reveal made a fully populated
              // 30-point series read as a 3-point stub for its first second.
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function monthLabel(ym: string) {
  const [y, m] = ym.split('-');
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}
