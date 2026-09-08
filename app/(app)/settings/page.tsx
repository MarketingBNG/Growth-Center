import { redirect } from 'next/navigation';
import { Check, X, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { NoDatabaseState } from '@/components/patterns/state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Capacity } from './Capacity';
import { capacitySetting } from '@/lib/capacity';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { currentUser } from '@/lib/auth';
import { can } from '@/lib/roles';
import { db, hasDb } from '@/lib/prisma';
import { hasEncryptionKey } from '@/lib/crypto';
import { aiStatus } from '@/lib/ai';
import { describeRow, phraseAction, recentAuditEvents } from '@/lib/audit';
import { AI_KEY_ENV } from '@/lib/enums';
import { refreshRatesIfStale } from '@/lib/settings';
import { emailStatus } from '@/lib/email';
import { cliqConfigured } from '@/lib/cliq';
import { fmtDate, fmtRelative } from '@/lib/format';
import { attributionHealth } from '@/lib/attribution';
import { thresholds } from '@/lib/settings';
import { ApiKeys } from './ApiKeys';
import { Thresholds } from './Thresholds';
import { MarketingRoster } from './MarketingRoster';
import { InsightOwners } from './InsightOwners';
import { marketingRoster } from '@/lib/roster';
import { attributionCeiling } from '@/lib/attribution-ceiling';
import { ownerBindings } from '@/lib/settings';
import { assignableOwners } from '@/lib/insight-actions';
import { fmtMoneyCompact } from '@/lib/format';
import { CurrencySettings } from './CurrencySettings';
import { VerifyEmail } from './VerifyEmail';
import { RevokeKey } from './RevokeKey';

export const metadata = { title: 'Settings · Growth Center' };

/** The window the attribution figure on this page is measured over. Matches the Marketing
 *  page's widest preset, so the two do not quote different coverage for the same book. */
function yearAgo(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d;
}

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect('/signin');

  if (!hasDb()) {
    return (
      <>
        <PageHeader title="Settings" subtitle="Workspace configuration." />
        <Card><NoDatabaseState /></Card>
      </>
    );
  }

  const manageKeys = can(user.role, 'apikeys:manage');
  const manageSettings = can(user.role, 'settings:manage');
  const [keys, channels, pipelines, currency, audit, health, ceiling, limits, capacity, roster, insightOwners, assignable] = await Promise.all([
    manageKeys
      ? db().apiKey.findMany({
          orderBy: { createdAt: 'desc' },
          // Never selects `hash`. A page that renders keys has no business loading them.
          select: { id: true, name: true, prefix: true, createdByEmail: true, createdAt: true, lastUsedAt: true, revokedAt: true },
        })
      : Promise.resolve([]),
    db().channel.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true, kind: true } }),
    db().pipeline.findMany({
      orderBy: { createdAt: 'asc' },
      include: { stages: { orderBy: { position: 'asc' } } },
    }),
    // Refreshed on read as well as on the cron, so opening the page after a quiet
    // week converts at today's rate rather than last week's.
    refreshRatesIfStale(),
    manageSettings ? recentAuditEvents(50) : Promise.resolve([]),
    // The last year, so the figure shown beside the threshold is the one the Marketing
    // page's default range is judged against.
    attributionHealth(yearAgo(), new Date()),
    // Over the same year, so the ceiling and the coverage beside it describe one window.
    attributionCeiling(yearAgo(), new Date()),
    thresholds(),
    capacitySetting(),
    marketingRoster(),
    ownerBindings(),
    assignableOwners(),
  ]);

  const ai = aiStatus();
  const email = emailStatus();

  const env = [
    { label: 'Database', ok: hasDb(), required: true, detail: 'DATABASE_URL' },
    {
      label: 'Google sign-in',
      ok: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
      required: true,
      detail: 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET',
    },
    {
      label: 'Credential encryption',
      ok: hasEncryptionKey(),
      required: true,
      detail: 'APP_ENCRYPTION_KEY — integrations cannot be connected without it',
    },
    { label: 'AI insights', ok: ai.configured, required: false, detail: AI_KEY_ENV },
    { label: 'Email sending', ok: email.sends, required: false, detail: email.detail },
    {
      label: 'Cliq notifications',
      ok: cliqConfigured(),
      required: false,
      // Not required, and said so: mail and chat are independent, and the digest runs with
      // either, both or neither. Worth showing because a refused mailbox is the current
      // state, and chat is the route that would still get through.
      detail: cliqConfigured()
        ? 'The daily digest also posts to Zoho Cliq.'
        : 'Not set. CLIQ_WEBHOOK_URL posts the digest to a Cliq channel as well as by email.',
    },
  ];

  return (
    <>
      <PageHeader title="Settings" subtitle="Workspace configuration and connection health." />

      {/* First on the page because it changes every money figure in the app, and because
          getting it wrong is not obvious from the numbers — a rupee rendered with a
          dollar sign looks entirely plausible. */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Currency</CardTitle>
          <p className="text-xs text-muted-foreground">
            Deals and ad spend arrive in the currency each system bills in. Everything is
            converted to the reporting currency below before it is added up.
          </p>
        </CardHeader>
        <CardContent>
          {manageSettings ? (
            <CurrencySettings initial={currency} />
          ) : (
            <p className="text-xs text-muted-foreground">
              Reporting in <span className="font-medium text-foreground">{currency.reporting}</span>.
              Only an owner can change this.
            </p>
          )}
        </CardContent>
      </Card>

      {/* D7. Beside the roster because the two answer halves of one question: the roster
          says whose debt is this team's, and this says which desk each finding lands on.
          §5.2's own rule is that a finding with no owner here is a configuration error
          shown to a person — so an unbound desk raises one rather than going quiet. */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Who each finding goes to</CardTitle>
          <p className="text-xs text-muted-foreground">
            Twelve of the sixteen rules produce findings with nobody on them. The desks are
            fixed — paid-media findings belong to whoever runs paid media — and who sits at
            each one is set here. Left blank, the rules say so instead of routing work to
            nobody.
          </p>
        </CardHeader>
        <CardContent>
          {manageSettings ? (
            <InsightOwners initial={insightOwners} owners={assignable} />
          ) : (
            <p className="text-xs text-muted-foreground">
              {Object.keys(insightOwners).length} of 8 desks have somebody on them. Only an
              owner can change this.
            </p>
          )}
        </CardContent>
      </Card>

      {/* D2. Above the thresholds because it decides *whose* work the rules are about,
          and no threshold makes a queue of the wrong eighteen people workable. */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Marketing roster</CardTitle>
          <p className="text-xs text-muted-foreground">
            Who this team is accountable for. The task queue raises a finding per person on
            this list and summarises everybody else as one Firm hygiene item. With nobody on
            it the queue counts the whole firm — eighteen people today, of whom one is on
            this team — and says so rather than going quiet.
          </p>
        </CardHeader>
        <CardContent>
          {manageSettings ? (
            <MarketingRoster initial={roster} />
          ) : (
            <p className="text-xs text-muted-foreground">
              {roster.length === 0
                ? 'Nobody has been added yet. Only an owner can change this.'
                : `${roster.length} on the roster. Only an owner can change this.`}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Thresholds</CardTitle>
          <p className="text-xs text-muted-foreground">
            The numbers the AI Insights rules compare against. Every one used to be a literal
            in the source; each change here is recorded in the activity log below, because
            lowering a threshold is how a finding stops being raised.
          </p>
          {/* The attribution threshold is the one number here that can be set out of
              reach, and §21.4's refusal rests on it. Shown with its ceiling because
              "attribution is 10.1%" invites a data-entry project, while "45.0% is all
              this history can ever reach" is the fact that decides what the bar should
              be. Whoever sets it should not have to go and compute this first. */}
          {ceiling.ceilingPercent !== null && ceiling.ceilingPercent < health.threshold ? (
            <p className="mt-2 rounded border border-warning/30 bg-warning/10 px-2 py-1.5 text-meta text-warning">
              Revenue attribution cannot reach its {health.threshold}% threshold on this
              history. Attributing everything the CRM has evidence for would reach{' '}
              <span className="font-medium">{ceiling.ceilingPercent.toFixed(1)}%</span> —{' '}
              {fmtMoneyCompact(ceiling.unreachable, ceiling.currency)} of the last year’s
              revenue has no channel recorded anywhere, because the deal was opened
              directly rather than converted from a lead. Until that changes for new work,
              every scale decision stays refused.
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          {manageSettings ? (
            <Thresholds initial={limits} />
          ) : (
            <p className="text-xs text-muted-foreground">
              Revenue attribution must reach{' '}
              <span className="font-medium text-foreground">{health.threshold}%</span>; it is
              currently{' '}
              <span className="font-medium text-foreground">
                {health.revenue.percent === null ? '—' : `${health.revenue.percent.toFixed(1)}%`}
              </span>
              . Only an owner can change these.
            </p>
          )}
        </CardContent>
      </Card>

      {/* §6.2. Beside the thresholds because it is the same kind of number: a figure the
          firm decides, recorded with an author, that the rest of the app then treats as
          fact. */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Delivery capacity</CardTitle>
          <p className="text-xs text-muted-foreground">
            How many new consultations the firm can serve in a month. Zoho Projects measures
            what delivery is already carrying; it cannot say what more it can take on, so this
            is entered by a person and their name goes with it.
          </p>
        </CardHeader>
        <CardContent>
          {manageSettings ? (
            <Capacity initial={capacity} />
          ) : (
            <p className="text-xs text-muted-foreground">
              {capacity.monthlyConsultations === null
                ? 'No ceiling has been set. Only an owner can set one.'
                : `${capacity.monthlyConsultations} consultations a month. Only an owner can change it.`}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Environment</CardTitle></CardHeader>
          <CardContent className="space-y-2.5">
            {env.map((e) => (
              <div key={e.label} className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0">
                  {e.ok ? (
                    <Check className="size-4 text-success" />
                  ) : e.required ? (
                    <X className="size-4 text-destructive" />
                  ) : (
                    <TriangleAlert className="size-4 text-warning" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {e.label}
                    {!e.required ? (
                      <span className="ml-1.5 text-meta font-normal text-muted-foreground">optional</span>
                    ) : null}
                  </p>
                  <p className="text-meta text-muted-foreground">{e.detail}</p>
                  {/* Only under the email row, and only for someone who can act on it.
                      "Configured" and "the server accepts these credentials" are
                      different claims, and the digest not arriving is the only symptom
                      either way. */}
                  {e.label === 'Email sending' && manageSettings ? (
                    <div className="mt-1.5">
                      <VerifyEmail configured={email.smtpConfigured} />
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Channels</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {channels.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2">
                <span className="text-sm">{c.name}</span>
                <span className="flex items-center gap-2">
                  <Badge tone="neutral">{c.kind}</Badge>
                  <span className="font-mono text-meta text-muted-foreground">{c.slug}</span>
                </span>
              </div>
            ))}
            <p className="pt-1 text-meta text-muted-foreground">
              Channels are a table rather than an enum, so adding one needs no migration.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="pt-4">
        {pipelines.map((p) => (
          <Card key={p.id} className="mb-4">
            <CardHeader>
              <CardTitle>
                Pipeline — {p.name}
                {p.isDefault ? <Badge tone="info" className="ml-2">default</Badge> : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {p.stages.map((s) => (
                  <div key={s.id} className="rounded-md border border-border px-2.5 py-1.5">
                    <p className="text-xs font-medium">
                      {s.name}
                      {s.isWon ? <span className="ml-1 text-success">won</span> : null}
                      {s.isLost ? <span className="ml-1 text-destructive">lost</span> : null}
                    </p>
                    <p className="text-meta text-muted-foreground tnum">{s.probability}% probability</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {manageKeys ? (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>API keys</CardTitle>
            <p className="text-meta text-muted-foreground">
              For website forms posting to{' '}
              <span className="font-mono">POST /api/public/v1/leads</span> with an{' '}
              <span className="font-mono">X-API-Key</span> header. Only a SHA-256 hash is stored, so
              a key is shown exactly once — when it is created.
            </p>
          </CardHeader>
          <ApiKeys />
          {keys.length > 0 ? (
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Prefix</TH>
                    <TH>Created by</TH>
                    <TH className="text-right">Created</TH>
                    <TH className="text-right">Last used</TH>
                    <TH>Status</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {keys.map((k) => (
                    <TR key={k.id}>
                      <TD className="font-medium">{k.name}</TD>
                      <TD className="font-mono text-xs text-muted-foreground">{k.prefix}…</TD>
                      <TD className="text-muted-foreground">{k.createdByEmail.split('@')[0]}</TD>
                      <TD className="text-right text-muted-foreground">{fmtDate(k.createdAt)}</TD>
                      <TD className="text-right text-muted-foreground">
                        {k.lastUsedAt ? fmtRelative(k.lastUsedAt) : 'never'}
                      </TD>
                      <TD>
                        {k.revokedAt ? (
                          <Badge tone="danger">revoked</Badge>
                        ) : (
                          <Badge tone="success">active</Badge>
                        )}
                      </TD>
                      <TD className="text-right">
                        {k.revokedAt ? null : <RevokeKey id={k.id} name={k.name} />}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          ) : (
            <p className="px-5 pb-5 text-xs text-muted-foreground">No keys yet.</p>
          )}
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">
              API keys are managed by owners. Your role ({user.role}) cannot see or create them.
            </p>
          </CardContent>
        </Card>
      )}

      {manageSettings ? (
        <Card className="mt-4 overflow-hidden">
          <CardHeader>
            <CardTitle>Activity log</CardTitle>
            <p className="text-meta text-muted-foreground">
              Who changed what, newest first. Both the administrative acts — connections,
              keys, roles, access, thresholds, currency — and changes to records: a lead
              reassigned, a deal moved, a task ticked off. Those come from the activity
              trail on the records themselves rather than being written twice, and the
              nightly import is filtered out. Nothing here is edited or removed, so this is
              the answer to a question asked months later.
            </p>
          </CardHeader>
          {audit.length > 0 ? (
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Who</TH>
                    <TH>What</TH>
                    <TH>Detail</TH>
                  </TR>
                </THead>
                <TBody>
                  {audit.map((e) => (
                    <TR key={e.id}>
                      {/* The exact time on hover. Four separate connect events inside one
                          day all read "10d ago", so the log looked like it was repeating
                          itself when it was recording four real attempts — which is the
                          part somebody debugging a flapping integration needs to see. */}
                      <TD
                        className="whitespace-nowrap text-muted-foreground"
                        title={e.createdAt.toISOString()}
                      >
                        {fmtRelative(e.createdAt)}
                      </TD>
                      <TD className="whitespace-nowrap font-medium">
                        {e.actorEmail.split('@')[0]}
                      </TD>
                      <TD>{phraseAction(e.action)}</TD>
                      <TD className="text-muted-foreground">{describeRow(e) || '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          ) : (
            <p className="px-5 pb-5 text-xs text-muted-foreground">
              Nothing recorded yet. Entries appear as people connect sources, change roles
              and move content.
            </p>
          )}
        </Card>
      ) : null}
    </>
  );
}
