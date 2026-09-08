import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { costPerConsultation } from '@/lib/metrics';
import { fmtMoney, fmtNumber } from '@/lib/format';
import type { Range } from '@/lib/metrics';

// §6.1's "CPQL by paid channel", which is the half of the clause a card cannot carry.
//
// "A blended number cannot be acted on. Nobody can buy blended." The card above reports
// one figure for the whole business; this is the same figure per channel, which is the
// form a budget decision is actually made in.

export async function CostPerConsultation({ range, currency }: { range: Range; currency: string }) {
  const rows = await costPerConsultation(range);
  if (rows.length === 0) return null;

  const money = (n: number | null) => (n === null ? '—' : fmtMoney(n, false, currency));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost per consultation by channel</CardTitle>
      </CardHeader>
      <div className="space-y-1.5 px-4 pb-4 text-xs">
        {rows.map((r) => (
          <div key={r.id} className="flex items-baseline justify-between gap-3">
            <span className="truncate">{r.name}</span>
            <span className="shrink-0 text-muted-foreground">
              <span className="tnum">{fmtNumber(r.consultations)}</span> from{' '}
              <span className="tnum">{money(r.acquisitionSpend)}</span> ·{' '}
              {/* An em-dash where a channel spent money and held no consultation. A cost
                  per consultation of "infinity" is not a number, and zero would be worse. */}
              <span className="tnum font-semibold text-foreground">{money(r.costPer)}</span>
            </span>
          </div>
        ))}
        <p className="pt-1.5 text-meta text-muted-foreground">
          Only the channels that carried acquisition spend. An organic channel&rsquo;s
          consultations cost something and nothing measures what, so a row of dashes under a
          heading about cost would be noise. Recruitment spend is excluded.
        </p>
      </div>
    </Card>
  );
}
