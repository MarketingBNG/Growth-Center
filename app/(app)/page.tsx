import Link from 'next/link';
import { Check, X, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { currentUser } from '@/lib/auth';
import { hasDb } from '@/lib/prisma';
import { hasEncryptionKey } from '@/lib/crypto';

export const metadata = { title: 'Dashboard · Growth Center' };

type Check = { label: string; ok: boolean; required: boolean; hint: string };

export default async function DashboardPage() {
  const user = await currentUser();

  const checks: Check[] = [
    {
      label: 'Database',
      ok: hasDb(),
      required: true,
      hint: 'DATABASE_URL — a Neon connection string. Then npm run db:migrate && npm run db:seed.',
    },
    {
      label: 'Google sign-in',
      ok: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
      required: true,
      hint: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    },
    {
      label: 'Credential encryption',
      ok: hasEncryptionKey(),
      required: true,
      hint: 'APP_ENCRYPTION_KEY — 64 hex characters, from openssl rand -hex 32. Integrations cannot be connected without it.',
    },
    {
      label: 'AI insights',
      ok: !!process.env.ANTHROPIC_API_KEY,
      required: false,
      hint: 'ANTHROPIC_API_KEY. Without it, AI Insights says so and shows only labelled samples.',
    },
  ];

  const blocking = checks.filter((c) => c.required && !c.ok);

  return (
    <>
      <PageHeader
        title={`Good to see you, ${user?.name.split(' ')[0] ?? 'there'}`}
        subtitle="The command centre for BNG's growth engine."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Setup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {checks.map((c) => (
              <div key={c.label} className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0">
                  {c.ok ? (
                    <Check className="size-4 text-success" />
                  ) : c.required ? (
                    <X className="size-4 text-destructive" />
                  ) : (
                    <TriangleAlert className="size-4 text-warning" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {c.label}
                    {!c.required ? (
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">optional</span>
                    ) : null}
                  </p>
                  {!c.ok ? <p className="text-xs text-muted-foreground">{c.hint}</p> : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What is next</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Phase 1 is in: sign-in, the roster and permission layer, the schema, and this shell.
            </p>
            <p>
              Phase 2 builds CRM, Leads and Pipeline. Phase 3 replaces this card with real KPIs,
              the funnel and campaign performance.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/integrations">See integrations</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {blocking.length ? (
        <p className="pt-4 text-xs text-muted-foreground">
          {blocking.length} required item{blocking.length > 1 ? 's' : ''} still unset — pages that
          need the database will say so rather than fail.
        </p>
      ) : null}
    </>
  );
}
