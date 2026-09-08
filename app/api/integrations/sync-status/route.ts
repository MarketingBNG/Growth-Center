import { route } from '@/lib/api';
import { syncStatus } from '@/lib/integrations/service';

/**
 * What is syncing right now, for the Integrations page to poll.
 *
 * Small and uncached on purpose. `cards()` is cached for 300 seconds, which is right for
 * "is this connected" and useless for "is this still running" — polling that would have
 * gone on showing an idle button for five minutes after a sync started.
 *
 * `growth:read` rather than `integrations:manage`: seeing that an import is in progress is
 * why a figure looks low, which everyone with the page needs; starting one is the part
 * held to admins.
 */
export const dynamic = 'force-dynamic';

export const GET = route('growth:read', async () => ({ providers: await syncStatus() }));
