import type { IntegrationProvider } from './types.ts';
import { googleAnalytics } from './providers/google-analytics.ts';
import { metaAds } from './providers/meta-ads.ts';
import { semrush } from './providers/semrush.ts';
import { zohoCrm } from './providers/zoho-crm.ts';

// A plain map. The Integration Center renders from this, so a provider added here
// appears in the UI with no further change.
export const PROVIDERS: Record<string, IntegrationProvider> = {
  [googleAnalytics.id]: googleAnalytics,
  [metaAds.id]: metaAds,
  [semrush.id]: semrush,
  [zohoCrm.id]: zohoCrm,
};

export const providerList = () => Object.values(PROVIDERS);

export function getProvider(id: string): IntegrationProvider | null {
  return PROVIDERS[id] ?? null;
}
