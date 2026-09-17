'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Split out and loaded on demand, like its neighbours — but not for their reason.
 *
 * The other wrappers in this directory carry an argument about Recharts: a hundred
 * kilobytes that every screen drawing anything pulled into its first-load bundle. That
 * argument was copied here, and it is not true of this chart. WeekdayChartImpl draws its own
 * SVG and imports no chart library at all, so there is no library being deferred.
 *
 * What the split still does is keep the component out of the server pass and hold its box
 * while it arrives. Whether `ssr: false` earns its place on a component that renders
 * perfectly well on the server is a live question — SparklineImpl's own header argues it
 * does not — and changing it changes what the first paint contains, so it is left as it
 * is rather than quietly flipped.
 */
export const WeekdayChart = dynamic(() => import('./WeekdayChartImpl').then((m) => m.WeekdayChart), {
  ssr: false,
  // The 118px bar row plus its headline.
  loading: () => <Skeleton className="h-[146px] w-full rounded-xl" />,
});

export type { WeekdayPoint } from './WeekdayChartImpl';
