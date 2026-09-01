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
export const FunnelChart = dynamic(() => import('./FunnelChartImpl').then((m) => m.FunnelChart), {
  ssr: false,
  // Roughly five stage rows at ~50px. Stage count varies, so this is an estimate.
  loading: () => <Skeleton className="h-[260px] w-full rounded-xl" />,
});

export type { Stage } from './FunnelChartImpl';
