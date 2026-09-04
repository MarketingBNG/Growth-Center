import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoneyCompact, fmtPercent } from '@/lib/format';
import type { AttributionHealth as Health, Coverage } from '@/lib/attribution';

// How much of the book the channel figures on this page are actually built from.
//
// It sits above the channel chart and the campaign table rather than in the metrics band,
// because it is not a business result — it is the standard of evidence for the results
// beside it, and putting it among them would invite it to be read as one.

/** A stage's bar. Width is the coverage, so a short bar means a weak claim. */
function Stage({
  label,
  coverage,
  format,
  ok,
}: {
  label: string;
  coverage: Coverage;
  format: (n: number) => string;
  ok: boolean;
}) {
  const pct = coverage.percent;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-sm font-medium tabular-nums">
          {pct === null ? '—' : fmtPercent(pct)}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${label}: ${pct === null ? 'nothing to measure' : `${Math.round(pct)}% attributed`}`}
      >
        <div
          className={`h-full rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`}
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>
      <p className="text-[11px] tabular-nums text-muted-foreground">
        {pct === null
          ? 'Nothing in this period'
          : `${format(coverage.covered)} of ${format(coverage.total)}`}
      </p>
    </div>
  );
}

export function AttributionHealth({ health }: { health: Health }) {
  // Compact, because this line pairs two amounts inside a third of a card and the exact
  // rupee is not the point — the ratio between them is.
  const money = (n: number) => fmtMoneyCompact(n, health.currency);
  const count = (n: number) => n.toLocaleString();

  // A stage passes on its own coverage, not on the workspace threshold, which is a rule
  // about revenue. Marking leads amber for missing a revenue standard would report the
  // healthiest part of the chain as the problem.
  const healthy = (c: Coverage) => c.percent === null || c.percent >= health.threshold;

  return (
    <Card className="mb-[18px]">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <CardTitle>Attribution coverage</CardTitle>
          <span className="text-[11px] text-muted-foreground">
            Threshold {health.threshold}% of revenue · set in Settings
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Stage label="Leads" coverage={health.leads} format={count} ok={healthy(health.leads)} />
          <Stage label="Deals" coverage={health.deals} format={count} ok={healthy(health.deals)} />
          <Stage
            label="Revenue"
            coverage={health.revenue}
            format={money}
            ok={healthy(health.revenue)}
          />
        </div>

        {health.sufficient === false ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-500">
            Below the threshold. The channel figures below are computed over the attributed
            part only — treat the ranking as a hint, not a basis for moving budget.
          </p>
        ) : null}

        {/* Said whichever way it falls, because the shape of the loss is the actionable
            part: the CRM records a channel on nearly every lead, and loses it at the deal.
            Most deals here are opened straight on an account and never converted from a
            lead, so there is no lead whose channel they could inherit. */}
        {health.deals.percent !== null &&
        health.leads.percent !== null &&
        health.leads.percent - health.deals.percent > 20 ? (
          <p className="text-[11px] text-muted-foreground">
            Leads carry a channel; deals mostly do not. Deals opened straight on an account,
            rather than converted from a lead, have no lead source to inherit — that is where
            the trail is lost.
          </p>
        ) : null}
      </CardHeader>
    </Card>
  );
}
