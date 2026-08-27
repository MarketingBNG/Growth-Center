import { Send, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { EmptyState, NoDatabaseState } from '@/components/patterns/state';
import { SourceBadge } from '@/components/patterns/source-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { hasDb } from '@/lib/prisma';
import { sequences } from '@/lib/outreach';
import { DEMO_SOURCE } from '@/lib/sources';
import { emailStatus } from '@/lib/email';
import { fmtPercent, fmtRelative } from '@/lib/format';

export const metadata = { title: 'Outreach · Growth Center' };

const STATUS_TONE = {
  pending: 'neutral',
  active: 'info',
  replied: 'success',
  bounced: 'danger',
  unsubscribed: 'warning',
  completed: 'neutral',
} as const;

export default async function OutreachPage() {
  if (!hasDb()) {
    return (
      <>
        <PageHeader title="Outreach" subtitle="Sequences, prospects and replies." />
        <Card><NoDatabaseState /></Card>
      </>
    );
  }

  const [list, email] = await Promise.all([sequences(), Promise.resolve(emailStatus())]);

  return (
    <>
      <PageHeader title="Outreach" subtitle="Sequences, prospects and replies." />

      {/* The provider's own honesty, surfaced. Nothing is sent, and the page says so
          rather than letting "sent" rows imply delivery. */}
      <div
        className={`mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 ${
          email.sends ? 'border-success/30 bg-success/10' : 'border-warning/30 bg-warning/10'
        }`}
      >
        <TriangleAlert className={`mt-0.5 size-4 shrink-0 ${email.sends ? 'text-success' : 'text-warning'}`} />
        <p className={`text-xs ${email.sends ? 'text-success' : 'text-warning'}`}>
          Provider: <span className="font-mono">{email.providerId}</span>. {email.detail}
        </p>
      </div>

      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Send className="size-6" />}
            title="No sequences yet"
            hint="Connect Smartlead in the Integration Center, or run npm run db:seed for a demo sequence."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {list.map((s) => (
            <Card key={s.id} className="overflow-hidden">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="flex items-center gap-1.5">
                      <CardTitle>{s.name}</CardTitle>
                      <SourceBadge source={s.source ?? DEMO_SOURCE} />
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {s.steps.length} steps · {s.prospects} prospects
                      {s.ownerEmail ? ` · ${s.ownerEmail.split('@')[0]}` : ''} · created{' '}
                      {fmtRelative(s.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={s.status === 'active' ? 'success' : 'neutral'}>{s.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {fmtPercent(s.replyRate ?? 0)} reply rate
                    </span>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(s.byStatus).map(([status, count]) => (
                    <Badge key={status} tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? 'neutral'}>
                      {status} {count}
                    </Badge>
                  ))}
                </div>

                <div className="space-y-2">
                  {s.steps.map((step) => (
                    <div key={step.id} className="rounded-md border border-border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="grid size-5 shrink-0 place-items-center rounded bg-secondary text-[11px] font-semibold">
                          {step.position + 1}
                        </span>
                        <p className="text-xs font-medium">{step.subject ?? '(no subject)'}</p>
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {step.waitDays === 0 ? 'immediately' : `wait ${step.waitDays}d`} · {step.channel}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap pl-7 text-[11px] leading-relaxed text-muted-foreground">
                        {step.body}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
