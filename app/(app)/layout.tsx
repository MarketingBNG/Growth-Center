import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { currentUser } from '@/lib/auth';
import { db, hasDb } from '@/lib/prisma';

/** The gate for every page inside this group. Server-side, so no client check can
 *  bypass it and no page needs to repeat it. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/signin');
  // Same condition the dashboard used to check on its own — the warning belongs to the
  // shell now, so it shows on every screen rather than only on `/`.
  const demoIntegrations = hasDb()
    ? await db().integration.count({ where: { state: 'demo_data' } })
    : 0;
  return (
    <AppShell user={user} demoData={demoIntegrations > 0}>
      {children}
    </AppShell>
  );
}
