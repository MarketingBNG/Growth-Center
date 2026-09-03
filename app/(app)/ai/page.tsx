import { Brain } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { NoDatabaseState } from '@/components/patterns/state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { db, hasDb } from '@/lib/prisma';
import { aiStatus, growthContext, ruleFindings } from '@/lib/ai';
import { AI_KEY_ENV } from '@/lib/enums';
import { AskBox } from './AskBox';

export const metadata = { title: 'AI Insights · Growth Center' };

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
    db().aiInsight.findMany({
      where: { dismissedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, kind: true, title: true, body: true, provider: true, confidence: true },
    }),
  ]);

  const computed = ruleFindings(context);

  return (
    <>
      <PageHeader
        title="AI Insights"
        subtitle="Questions answered from Growth Center's own numbers — never from anything else."
      />

      {status.configured ? (
        <div className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          Connected to {status.provider} ({status.model}). Answers are generated from the growth
          snapshot below and cite only figures contained in it.
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
            <p className="pt-1.5 text-foreground">
              It has no database access and cannot look anything up beyond this.
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
              Anything marked <span className="text-warning">sample</span> shipped with the demo data
              and was not produced by a model.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {stored.length === 0 ? (
              <p className="text-xs text-muted-foreground">None saved.</p>
            ) : stored.map((i) => (
              <div key={i.id} className="rounded-md border border-border px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium leading-snug">{i.title}</p>
                  <span className="flex shrink-0 gap-1">
                    <Badge tone={KIND_TONE[i.kind]}>{i.kind}</Badge>
                    <Badge tone={i.provider === 'seed' ? 'warning' : 'purple'}>
                      {i.provider === 'seed' ? 'sample' : i.provider}
                    </Badge>
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{i.body}</p>
              </div>
            ))}
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
