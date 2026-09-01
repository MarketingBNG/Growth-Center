import { Skeleton } from '@/components/ui/skeleton';

/**
 * Placeholder for a module screen while its data resolves. Mirrors the usual shape —
 * title, KPI row, then content — so the page does not visibly reflow on arrival.
 *
 * Mounted through per-segment `loading.tsx` files rather than one at the route-group
 * root, deliberately. A loading boundary makes Next stream immediately, which flushes
 * response headers with a 200 — so a boundary above a route that calls `notFound()`
 * turns its 404 into a 200. Segments containing a detail page (`leads`, `crm`,
 * `pipeline`, and the dashboard at the group root) therefore have no skeleton; correct
 * status wins over a nicer wait.
 */
/**
 * `headless` leaves out the title block.
 *
 * Pages migrated to a prerendered shell render their own PageHeader outside the Suspense
 * boundary — that is the part that no longer waits — so a skeleton standing in for the
 * body must not draw a second title beneath the real one.
 */
export function PageSkeleton({ headless = false }: { headless?: boolean }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      {headless ? null : (
        <div className="pb-5">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-2 h-4 w-96" />
        </div>
      )}

      <div className="grid gap-3.5 pb-[18px] [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-2xl" />
        ))}
      </div>

      <div className="grid items-start gap-3.5 lg:[grid-template-columns:minmax(0,2fr)_minmax(0,1fr)]">
        <Skeleton className="h-[320px] rounded-2xl" />
        <div className="flex flex-col gap-3.5">
          <Skeleton className="h-[180px] rounded-2xl" />
          <Skeleton className="h-[130px] rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
