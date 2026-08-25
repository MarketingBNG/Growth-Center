import { PageHeader } from '@/components/patterns/page-header';
import { NoDatabaseState } from '@/components/patterns/state';
import { Card } from '@/components/ui/card';
import { redirect } from 'next/navigation';
import { hasDb } from '@/lib/prisma';
import { hasEncryptionKey } from '@/lib/crypto';
import { cards } from '@/lib/integrations/service';
import { can } from '@/lib/roles';
import { currentUser } from '@/lib/auth';
import { IntegrationGrid } from './IntegrationGrid';

export const metadata = { title: 'Integrations · Growth Center' };

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!hasDb()) {
    return (
      <>
        <PageHeader title="Integrations" subtitle="Connect the platforms Growth Center reads from." />
        <Card>
          <NoDatabaseState />
        </Card>
      </>
    );
  }

  // currentUser + redirect, never requireUser: requireUser throws HttpError, which is
  // the contract route handlers expect. In a page it logged a stack trace on every
  // signed-out request and only avoided a 500 because the layout's redirect won the
  // race.
  const user = await currentUser();
  if (!user) redirect('/signin');
  const params = await searchParams;
  const list = await cards();

  const connected = list.filter((c) => c.state === 'connected').length;
  const demo = list.filter((c) => c.state === 'demo_data').length;

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle={
          connected === 0
            ? `Nothing is connected yet${demo ? ` — ${demo} module${demo > 1 ? 's are' : ' is'} showing seeded demo data` : ''}.`
            : `${connected} connected${demo ? `, ${demo} still on demo data` : ''}.`
        }
      />

      {!hasEncryptionKey() ? (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          <span className="font-mono">APP_ENCRYPTION_KEY</span> is not set, so credentials cannot be
          stored safely. Nothing can be connected until it is — generate one with{' '}
          <span className="font-mono">openssl rand -hex 32</span>.
        </div>
      ) : null}

      {typeof params.error === 'string' ? (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          {params.error}
        </div>
      ) : null}
      {typeof params.connected === 'string' ? (
        <div className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-xs text-success">
          {params.connected} connected. Run a sync to pull its data in.
        </div>
      ) : null}

      <IntegrationGrid cards={list} canManage={can(user.role, 'integrations:manage')} />
    </>
  );
}
