import { PageHeader } from '@/components/patterns/page-header';
import { redirect } from 'next/navigation';
import { hasDb } from '@/lib/platform/prisma';
import type { PageParams } from '@/lib/shared/range';
import { hasEncryptionKey } from '@/lib/access/crypto';
import { cards } from '@/lib/integrations/service';
import { can } from '@/lib/access/roles';
import { currentUser } from '@/lib/access/auth';
import { ErrorBanner, noDatabasePage } from '@/components/patterns/state';
import { IntegrationGrid } from './IntegrationGrid';
import { SyncHealth } from './SyncHealth';

export const metadata = { title: 'Integrations · Growth Center' };

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<PageParams>;
}) {
  if (!hasDb()) {
    return noDatabasePage('Integrations', 'Connect the platforms Growth Center reads from.');
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
        <ErrorBanner className="mb-4 rounded-lg py-2.5">
          <span className="font-mono">APP_ENCRYPTION_KEY</span> is not set, so credentials cannot be
          stored safely. Nothing can be connected until it is — generate one with{' '}
          <span className="font-mono">openssl rand -hex 32</span>.
        </ErrorBanner>
      ) : null}

      <ErrorBanner
        error={typeof params.error === 'string' ? params.error : null}
        className="mb-4 rounded-lg py-2.5"
      />
      {typeof params.connected === 'string' ? (
        <div className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-xs text-success">
          {params.connected} connected. Run a sync to pull its data in.
        </div>
      ) : null}

      <SyncHealth />

      <IntegrationGrid cards={list} canManage={can(user.role, 'integrations:manage')} />
    </>
  );
}
