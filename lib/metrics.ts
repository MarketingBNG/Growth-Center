/**
 * The metrics layer's front door.
 *
 * Three files behind it now -- window.ts for the date arithmetic, core.ts for the figures,
 * kpis.ts for the per-screen card sets -- where there used to be one of 1,772 lines. This
 * stays so every existing import keeps working and no caller has to know which of the
 * three a name comes from.
 */
// `Range` and `rangeFor` live in lib/range.ts now — lib/attribution.ts needs the same
// window arithmetic and this module imports lib/attribution.ts. Re-exported because every
// screen and half the library already ask this module for them, and moving a file should
// not move a hundred import lines.
export { rangeFor, type Range } from './shared/range.ts';

// The Kpi shape and its delta live in lib/kpi.ts so client components can use them
// without pulling the database in. Re-exported here because this is where callers
// already expect to find them.
export { kpiDelta } from './shared/kpi.ts';
export type { Kpi } from './shared/kpi.ts';
export * from './metrics/window.ts';
export * from './metrics/core.ts';
export * from './metrics/kpis.ts';
