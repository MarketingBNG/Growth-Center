import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SpeedToLead as Distribution } from '@/lib/speed-to-lead';

/**
 * Appendix C's speed to lead: the distribution, including the untouched.
 *
 * The untouched band is drawn in the danger colour and sits at the bottom, apart from the
 * response bands, because it is not a slower response — it is the absence of one. Putting
 * it in the same series as "over a week" would read as the tail of a distribution rather
 * than as the thing the whole card exists to show.
 *
 * On this data it is 59% of a year's leads, against a median response of two days. The
 * median alone described a slow but functioning process; it was measured over the 41% that
 * got an answer.
 */
function hours(n: number): string {
  if (n < 1) return `${Math.round(n * 60)}m`;
  if (n < 48) return `${n < 10 ? n.toFixed(1) : Math.round(n)}h`;
  return `${Math.round(n / 24)}d`;
}

export function SpeedToLead({ data }: { data: Distribution }) {
  if (data.total === 0) return null;

  // Scaled to the largest band rather than to the total, so the shape of the distribution
  // is legible. Against the total every bar would be a sliver beside the untouched one.
  const widest = Math.max(...data.bands.map((b) => b.leads), 1);

  return (
    <Card className="mb-[18px]">
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <CardTitle>Speed to lead</CardTitle>
          <span className="text-[11px] text-muted-foreground">
            {data.medianHours === null
              ? 'Nothing was contacted in this period'
              : `Median ${hours(data.medianHours)} across the ${data.touched.toLocaleString()} that were contacted`}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-1.5">
        {data.bands.map((b) => (
          <div key={b.key} className="flex items-center gap-3">
            <span className="w-[104px] shrink-0 text-[11px] text-muted-foreground">{b.label}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-track">
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${(b.leads / widest) * 100}%` }}
              />
            </span>
            <span className="w-14 shrink-0 text-right text-[11px] tabular-nums">
              {b.leads.toLocaleString()}
            </span>
            <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              {b.percent}%
            </span>
          </div>
        ))}

        {/* Separated by a rule, not just by colour: this is a different kind of fact from
            the bands above it. */}
        <div className="!mt-3 border-t pt-3">
          <div className="flex items-center gap-3">
            <span className="w-[104px] shrink-0 text-[11px] font-medium text-destructive">
              Never contacted
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-track">
              <span
                className="block h-full rounded-full bg-destructive"
                style={{ width: `${data.untouchedPercent}%` }}
              />
            </span>
            <span className="w-14 shrink-0 text-right text-[11px] font-medium tabular-nums text-destructive">
              {data.untouched.toLocaleString()}
            </span>
            <span className="w-11 shrink-0 text-right text-[11px] font-medium tabular-nums text-destructive">
              {data.untouchedPercent}%
            </span>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {/* Said plainly, because the median above it invites the opposite conclusion.
                This bar is measured against every lead in the period; the bands above are
                measured against the same total, so the two can be read together. */}
            Past the {data.slaHours}-hour first-contact SLA with no call, email or meeting
            logged. The median is the response time of the leads that got one, so it says
            nothing about these.
            {data.tooRecent > 0
              ? ` A further ${data.tooRecent.toLocaleString()} arrived too recently to be late yet.`
              : ''}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
