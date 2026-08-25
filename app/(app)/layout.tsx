import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { currentUser } from '@/lib/auth';

/** The gate for every page inside this group. Server-side, so no client check can
 *  bypass it and no page needs to repeat it. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/signin');
  return <AppShell user={user}>{children}</AppShell>;
}
