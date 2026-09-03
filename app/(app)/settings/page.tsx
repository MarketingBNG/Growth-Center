import { redirect } from 'next/navigation';
import { Check, X, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { NoDatabaseState } from '@/components/patterns/state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { currentUser } from '@/lib/auth';
import { can } from '@/lib/roles';
import { db, hasDb } from '@/lib/prisma';
import { hasEncryptionKey } from '@/lib/crypto';
import { aiStatus } from '@/lib/ai';
import { AI_KEY_ENV } from '@/lib/enums';
import { refreshRatesIfStale } from '@/lib/settings';
import { emailStatus } from '@/lib/email';
import { fmtDate, fmtRelative } from '@/lib/format';
import { ApiKeys } from './ApiKeys';
import { CurrencySettings } from './CurrencySettings';
import { RevokeKey } from './RevokeKey';

export const metadata = { title: 'Settings · Growth Center' };

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
  const [keys, channels, pipelines, currency] = await Promise.all([
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
    { label: 'Outreach sending', ok: email.sends, required: false, detail: email.detail },
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
              Only a partner or controller can change this.
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
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">optional</span>
                    ) : null}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{e.detail}</p>
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
                  <span className="font-mono text-[11px] text-muted-foreground">{c.slug}</span>
                </span>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-muted-foreground">
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
                    <p className="text-[11px] text-muted-foreground tnum">{s.probability}% probability</p>
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
            <p className="text-[11px] text-muted-foreground">
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
              API keys are managed by partners and controllers. Your role ({user.role}) cannot see
              or create them.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
