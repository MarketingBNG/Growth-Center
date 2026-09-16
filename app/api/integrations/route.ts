import { route } from '@/lib/platform/api';
import { cards } from '@/lib/integrations/service';

export const GET = route('growth:read', async () => ({ cards: await cards() }));
