import type { IntegrationProvider } from './types.ts';
import { googleAds } from './providers/google-ads.ts';
import { googleAnalytics } from './providers/google-analytics.ts';
import { googleBusiness } from './providers/google-business.ts';
import { linkedinAds } from './providers/linkedin-ads.ts';
import { metaAds } from './providers/meta-ads.ts';
import { metaSocial } from './providers/meta-social.ts';
import { pagespeed } from './providers/pagespeed.ts';
import { searchConsole } from './providers/search-console.ts';
import { smartlead } from './providers/smartlead.ts';
import { youtube } from './providers/youtube.ts';
import { zohoCrm } from './providers/zoho-crm.ts';
import { zohoProjects } from './providers/zoho-projects.ts';

// A plain map. The Integration Center renders from this, so a provider added here
// appears in the UI with no further change.
export const PROVIDERS: Record<string, IntegrationProvider> = {
  [googleAds.id]: googleAds,
  [googleAnalytics.id]: googleAnalytics,
  [googleBusiness.id]: googleBusiness,
  [linkedinAds.id]: linkedinAds,
  [metaAds.id]: metaAds,
  [metaSocial.id]: metaSocial,
  [pagespeed.id]: pagespeed,
  [searchConsole.id]: searchConsole,
  [smartlead.id]: smartlead,
  [youtube.id]: youtube,
  [zohoCrm.id]: zohoCrm,
  [zohoProjects.id]: zohoProjects,
};

export const providerList = () => Object.values(PROVIDERS);

export function getProvider(id: string): IntegrationProvider | null {
  return PROVIDERS[id] ?? null;
}
