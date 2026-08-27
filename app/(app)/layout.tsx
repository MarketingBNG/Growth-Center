import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { currentUser } from '@/lib/auth';
import { getProvider } from '@/lib/integrations/registry';
import { db, hasDb } from '@/lib/prisma';

/** Fallback for a provider that has an Integration row but no registry entry yet —
 *  better than rendering the raw id in the header. */
const humanize = (id: string) =>
  id.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** The gate for every page inside this group. Server-side, so no client check can
 *  bypass it and no page needs to repeat it. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/signin');
  // Same condition the dashboard used to check on its own — the warning belongs to the
  // shell now, so it shows on every screen rather than only on `/`.
  //
  // Names, not just a count: once some providers are genuinely connected, "no source
  // connected" is false, and a bare count does not tell anyone which figures to distrust.
  const demoRows = hasDb()
    ? await db().integration.findMany({
        where: { state: 'demo_data' },
        select: { provider: true },
        orderBy: { provider: 'asc' },
      })
    : [];
  const demoSources = demoRows.map((r) => getProvider(r.provider)?.name ?? humanize(r.provider));
  return (
    <AppShell user={user} demoSources={demoSources}>
      {children}
    </AppShell>
  );
}
