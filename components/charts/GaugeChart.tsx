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
 * markup the client immediately threw away. The skeleton holds the same box, so nothing
 * below it jumps when the chart arrives.
 */
export const GaugeChart = dynamic(() => import('./GaugeChartImpl').then((m) => m.GaugeChart), {
  ssr: false,
  // The gauge is a 200x96 viewBox capped at max-w-[200px], not a full-width block.
  loading: () => <Skeleton className="h-[96px] w-full max-w-[200px] rounded-xl" />,
});

