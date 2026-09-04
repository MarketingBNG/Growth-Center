import { Brain } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { NoDatabaseState } from '@/components/patterns/state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { db, hasDb } from '@/lib/prisma';
import { aiStatus, growthContext, ruleFindings } from '@/lib/ai';
import { AI_KEY_ENV } from '@/lib/enums';
import { TABLES } from '@/lib/ai-tools';
import { ageLabel } from '@/lib/insight-identity';
import { GenerateInsightsButton } from './GenerateInsightsButton';
import { DismissInsight } from './DismissInsight';
import { AskBox } from './AskBox';

export const metadata = { title: 'AI Insights · Growth Center' };

const READABLE_TABLE_COUNT = Object.keys(TABLES).length;

const KIND_TONE = {
  opportunity: 'success',
  risk: 'danger',
  anomaly: 'warning',
  recommendation: 'info',
} as const;

export default async function AiPage() {
  if (!hasDb()) {
    return (
      <>
        <PageHeader title="AI Insights" subtitle="Analysis over Growth Center's own data." />
        <Card><NoDatabaseState /></Card>
      </>
    );
  }

  const status = aiStatus();
  const [context, stored] = await Promise.all([
    growthContext(90),
    // Dismissed findings are listed too, below the rest. Hiding them entirely was the
    // old intent, but nothing could dismiss anything, so nobody discovered that a
    // dismissal was unreviewable — and a judgement call with no way back is worse than no
    // dismissal at all. Resolved findings are excluded: they are no longer true.
    db().aiInsight.findMany({
      where: { resolvedAt: null },
      // Nulls first, said explicitly: Postgres sorts them last on ASC, which would put
      // every dismissed finding above the live ones.
      orderBy: [
        { dismissedAt: { sort: 'asc', nulls: 'first' } },
        { firstSeenAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      select: {
        id: true, kind: true, title: true, body: true, provider: true, confidence: true,
        dismissedAt: true, firstSeenAt: true,
      },
    }),
  ]);

  const now = new Date();

  const computed = ruleFindings(context);

  return (
    <>
      <PageHeader
        title="AI Insights"
        subtitle="Questions answered from Growth Center's own numbers — never from anything else."
      />

      {status.configured ? (
        <div className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          Connected to {status.provider} ({status.model}). Answers come from the snapshot below
          and from read-only queries against your own data — never from anything else.
        </div>
      ) : (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
          <span className="font-medium">AI is not configured.</span> {status.reason} Set{' '}
          <span className="font-mono">{AI_KEY_ENV}</span> in{' '}
          <span className="font-mono">.env.local</span> to enable it. The observations below are
          arithmetic, not analysis — nothing on this page is invented.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AskBox configured={status.configured} />
        </div>

        <Card>
          <CardHeader><CardTitle>What the model can see</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-[11px] text-muted-foreground">
            <p>A JSON snapshot of the last {context.periodDays} days:</p>
            <p>· the funnel and its conversion rates</p>
            <p>· revenue, spend, CAC and ROAS</p>
            <p>· the previous period, for comparison</p>
            <p>· {context.channels.length} channels and {context.campaigns.length} campaigns</p>
            <p>· open pipeline and leads by status</p>
            {/* Listed because this panel is the page's promise about what an answer can be
                based on, and an omission here reads as "the model cannot see that". */}
            <p>· what each of {context.leadOwners.length} lead owners is carrying</p>
            {/* This used to end "it has no database access and cannot look anything up
                beyond this", which stopped being true the moment the read tools were added.
                A panel whose whole job is to state the limits has to state the real ones. */}
            <p className="pt-1.5 text-foreground">
              Beyond the snapshot it can read the {READABLE_TABLE_COUNT} CRM tables directly to
              look up records and totals — reading only. It cannot change anything, and it
              cannot see the integration credentials or API keys.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 pt-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Computed observations</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Derived by arithmetic from the data. No model involved, so these are always available.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {computed.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing notable in this period.</p>
            ) : computed.map((f, i) => (
              <div key={i} className="rounded-md border border-border px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium leading-snug">{f.title}</p>
                  <Badge tone={KIND_TONE[f.kind]}>{f.kind}</Badge>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Saved insights</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Written by the model when you ask for them. A finding still true on the next run
              keeps its place and its date rather than being rewritten as new; one no longer
              found drops off the list. Anything marked{' '}
              <span className="text-warning">sample</span> shipped with the demo data and was not
              produced by a model.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            <GenerateInsightsButton configured={status.configured} existing={stored.length} />

            {stored.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {status.configured
                  ? 'None yet — generate a set from the numbers above.'
                  : 'None saved.'}
              </p>
            ) : stored.map((i) => {
              const age = ageLabel(i.firstSeenAt, now);
              return (
                <div
                  key={i.id}
                  className={`rounded-md border border-border px-3 py-2 ${i.dismissedAt ? 'opacity-55' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium leading-snug">{i.title}</p>
                    <span className="flex shrink-0 items-center gap-1">
                      <Badge tone={KIND_TONE[i.kind]}>{i.kind}</Badge>
                      <Badge tone={i.provider === 'seed' ? 'warning' : 'purple'}>
                        {i.provider === 'seed' ? 'sample' : i.provider}
                      </Badge>
                      {i.provider === 'seed' ? null : (
                        <DismissInsight id={i.id} dismissed={i.dismissedAt !== null} title={i.title} />
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{i.body}</p>
                  {/* How long this has been true is the thing regeneration used to throw
                      away, and it is often the most useful fact on the row: a finding in
                      its second month is a different conversation from one raised today. */}
                  {age || i.dismissedAt ? (
                    <p className="mt-1 text-[11px] text-muted-foreground/80">
                      {[age, i.dismissedAt ? 'Dismissed' : null].filter(Boolean).join(' · ')}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <p className="flex items-center gap-1.5 pt-4 text-[11px] text-muted-foreground">
        <Brain className="size-3" />
        Answers are not stored unless you save them.
      </p>
    </>
  );
}
