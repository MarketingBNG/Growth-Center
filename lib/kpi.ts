import { delta } from './calc.ts';

// The KPI shape and its delta arithmetic, split out of lib/metrics.ts so a client
// component can render a card without dragging the database into the browser bundle.
//
// lib/metrics.ts imports lib/prisma. `MetricsBand` is a client component and renders
// `KpiCard`, so anything KpiCard imports as a VALUE lands in the client graph — and a
// value import of lib/metrics would follow the chain into the `pg` driver and break the
// build. Only lib/calc.ts is imported here, which imports nothing.

export type Kpi = {
  key: string;
  label: string;
  value: number | null;
  previous: number | null;
  format: 'number' | 'money' | 'percent' | 'ratio' | 'duration' | 'days';
  /** False where a rise is bad, so the delta colour is not simply "up is green". */
  higherIsBetter: boolean;
  hint?: string;
};

/** Percentage change against the prior period, or null with nothing to compare to. */
export const kpiDelta = (k: Kpi): number | null =>
  k.value === null || k.previous === null ? null : delta(k.value, k.previous);
