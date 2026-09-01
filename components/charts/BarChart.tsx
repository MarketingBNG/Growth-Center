'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Recharts, loaded when the chart is, not when the page is.
 *
 * The library is around a hundred kilobytes and every screen that draws anything pulled
 * it into its first-load bundle — /pipeline was 276kB, /leads and /crm not far behind —
 * even though the charts sit below the fold and the page is readable without them.
 *
 * `ssr: false` because these render nothing useful on the server anyway: Recharts
 * measures its container before it can lay an axis out, so the server pass produced
 * markup the client immediately threw away. The skeleton holds roughly the same box —
 * this chart sizes itself to its data, so the height cannot be known before the data is.
 */
export const BarChart = dynamic(() => import('./BarChartImpl').then((m) => m.BarChart), {
  ssr: false,
  // BarChart sizes itself to its row count (max(140, rows * 34 + 24)), so this is a
  // middle estimate rather than an exact match - it cannot be known before the data is.
  loading: () => <Skeleton className="h-[200px] w-full rounded-xl" />,
});

export type { BarDatum } from './BarChartImpl';
