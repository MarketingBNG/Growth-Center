import { IntegrationError, type Entity, type IntegrationProvider, type MetricPoint } from '../types.ts';

// Zoho CRM. BNG already runs Zoho, and bng-command-center's lib/zoho.ts is the working
// reference for this token lifecycle — a long-lived refresh token minting short-lived
// access tokens per request.

const ACCOUNTS = 'https://accounts.zoho.com';
const API = 'https://www.zohoapis.com/crm/v6';
const SCOPE = 'ZohoCRM.modules.READ,ZohoCRM.settings.READ';

type Stored = { refreshToken: string };

async function accessToken(refreshToken: string): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: process.env.ZOHO_CLIENT_ID ?? '',
    client_secret: process.env.ZOHO_CLIENT_SECRET ?? '',
    grant_type: 'refresh_token',
  });
  const res = await fetch(`${ACCOUNTS}/oauth/v2/token?${params}`, { method: 'POST' });
  if (!res.ok) throw new IntegrationError(`Zoho token refresh failed (${res.status}).`);

  const json = (await res.json()) as { access_token?: string; error?: string };
  if (json.error) throw new IntegrationError(`Zoho: ${json.error}`);
  if (!json.access_token) throw new IntegrationError('Zoho returned no access token.');
  return json.access_token;
}

export const zohoCrm: IntegrationProvider = {
  id: 'zoho_crm',
  name: 'Zoho CRM',
  category: 'crm',
  authKind: 'oauth2',
  summary: 'Leads, contacts and deals from the CRM the firm already runs.',
  provides: ['Leads', 'Contacts', 'Deals', 'Deal stages'],
  requiredEnv: [
    { name: 'ZOHO_CLIENT_ID', description: 'Zoho API console self-client or server app' },
    { name: 'ZOHO_CLIENT_SECRET', description: 'Secret for that Zoho client' },
  ],
  docsUrl: 'https://www.zoho.com/crm/developer/docs/api/v6/',

  isConfigured() {
    return !!process.env.ZOHO_CLIENT_ID && !!process.env.ZOHO_CLIENT_SECRET;
  },

  getAuthUrl(redirectUri, state) {
    const params = new URLSearchParams({
      scope: SCOPE,
      client_id: process.env.ZOHO_CLIENT_ID ?? '',
      response_type: 'code',
      access_type: 'offline',
      redirect_uri: redirectUri,
      state,
    });
    return `${ACCOUNTS}/oauth/v2/auth?${params}`;
  },

  async connect(input) {
    if (input.kind !== 'oauth2') throw new IntegrationError('Zoho CRM uses OAuth.');

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.ZOHO_CLIENT_ID ?? '',
      client_secret: process.env.ZOHO_CLIENT_SECRET ?? '',
      redirect_uri: input.redirectUri,
      code: input.code,
    });
    const res = await fetch(`${ACCOUNTS}/oauth/v2/token?${params}`, { method: 'POST' });
    if (!res.ok) throw new IntegrationError(`Token exchange failed (${res.status}).`);

    const json = (await res.json()) as { refresh_token?: string; error?: string };
    if (json.error) throw new IntegrationError(`Zoho: ${json.error}`);
    if (!json.refresh_token) {
      throw new IntegrationError('Zoho returned no refresh token. Re-authorise with access_type=offline.');
    }
    return { secret: JSON.stringify({ refreshToken: json.refresh_token } satisfies Stored) };
  },

  async sync(credential, _config, range) {
    const { refreshToken } = JSON.parse(credential) as Stored;
    const token = await accessToken(refreshToken);

    // Counts per module, so the CRM's own totals can be compared against Growth
    // Center's without importing every record.
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);

    const points: MetricPoint[] = [];
    for (const moduleName of ['Leads', 'Contacts', 'Deals']) {
      const res = await fetch(`${API}/${moduleName}/actions/count`, {
        headers: { authorization: `Zoho-oauthtoken ${token}` },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { count?: string | number };
      points.push({
        entityType: 'zoho_module',
        entityId: moduleName.toLowerCase(),
        metricKey: 'record_count',
        date,
        value: Number(json.count) || 0,
      });
    }

    if (points.length === 0) {
      throw new IntegrationError('Zoho returned no module counts — check the granted scopes.');
    }
    void range;
    return points;
  },

  async getEntities(credential, _config, type) {
    const { refreshToken } = JSON.parse(credential) as Stored;
    const token = await accessToken(refreshToken);

    const moduleName = type === 'deal' ? 'Deals' : type === 'contact' ? 'Contacts' : 'Leads';
    const res = await fetch(`${API}/${moduleName}?per_page=50`, {
      headers: { authorization: `Zoho-oauthtoken ${token}` },
    });
    if (!res.ok) throw new IntegrationError(`Zoho ${moduleName} request failed (${res.status}).`);

    const json = (await res.json()) as { data?: Record<string, unknown>[] };
    return (json.data ?? []).map<Entity>((raw) => ({
      id: String(raw.id),
      type,
      label:
        (raw.Deal_Name as string) ??
        (raw.Full_Name as string) ??
        [raw.First_Name, raw.Last_Name].filter(Boolean).join(' ') ??
        String(raw.id),
      raw,
    }));
  },
};
