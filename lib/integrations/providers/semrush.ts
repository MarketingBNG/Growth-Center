import { IntegrationError, type IntegrationProvider, type MetricPoint } from '../types.ts';

// Semrush domain overview. An API-key provider rather than OAuth, which is why the
// interface has to support both.

type Stored = { apiKey: string };

export const semrush: IntegrationProvider = {
  id: 'semrush',
  name: 'Semrush',
  category: 'seo',
  authKind: 'apiKey',
  summary: 'Organic keywords, traffic estimates and ranking data for a domain.',
  provides: ['Organic keywords', 'Organic traffic', 'Ranking positions'],
  // Empty on purpose: the key is pasted into the connect form, not read from the
  // environment. Listing one here made the card say "requires API credentials" while
  // simultaneously offering an enabled Connect button.
  requiredEnv: [],
  docsUrl: 'https://developer.semrush.com/api/v3/analytics/overview-reports/',

  // The key may be pasted at connect time, so no environment variable is required.
  configFields: [
    {
      name: 'domain',
      label: 'Domain',
      placeholder: 'usaindiacfo.com',
      help: 'The site to track. No protocol, no path.',
      required: true,
      normalise: (v) => v.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase(),
    },
  ],

  isConfigured() {
    return true;
  },

  getAuthUrl() {
    return null;
  },

  async connect(input) {
    if (input.kind !== 'apiKey') throw new IntegrationError('Semrush uses an API key.');
    const apiKey = input.apiKey.trim();
    if (!apiKey) throw new IntegrationError('An API key is required.');

    const domain = typeof input.config?.domain === 'string' ? input.config.domain : '';
    if (!domain) throw new IntegrationError('A domain is required, e.g. usaindiacfo.com.');

    // Validate before storing, so a bad key fails at connect time rather than at the
    // first sync hours later.
    const params = new URLSearchParams({
      type: 'domain_ranks',
      key: apiKey,
      domain,
      export_columns: 'Or,Ot',
      database: 'us',
    });
    const res = await fetch(`https://api.semrush.com/?${params}`);
    const body = await res.text();
    if (!res.ok || body.startsWith('ERROR')) {
      throw new IntegrationError(body.split('\n')[0] || `Semrush rejected the key (${res.status}).`);
    }

    return { secret: JSON.stringify({ apiKey } satisfies Stored), config: { domain } };
  },

  async sync(credential, config) {
    const domain = config.domain;
    if (typeof domain !== 'string' || !domain) {
      throw new IntegrationError('No domain configured for this connection.');
    }

    const { apiKey } = JSON.parse(credential) as Stored;
    const params = new URLSearchParams({
      type: 'domain_ranks',
      key: apiKey,
      domain,
      export_columns: 'Or,Ot,Oc',
      database: 'us',
    });

    const res = await fetch(`https://api.semrush.com/?${params}`);
    const body = await res.text();
    if (!res.ok || body.startsWith('ERROR')) {
      throw new IntegrationError(body.split('\n')[0] || `Semrush request failed (${res.status}).`);
    }

    // Semrush answers with semicolon-separated CSV: a header row then one data row.
    const [header, row] = body.trim().split('\n');
    if (!row) return [];
    const columns = header.split(';');
    const values = row.split(';');

    const map: Record<string, string> = {
      'Organic Keywords': 'organic_keywords',
      'Organic Traffic': 'organic_traffic',
      'Organic Cost': 'organic_traffic_value',
    };

    // Semrush reports a current snapshot, not a time series, so today is the only date
    // it can honestly be stamped with.
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);

    const points: MetricPoint[] = [];
    columns.forEach((column, i) => {
      const metricKey = map[column.trim()];
      if (!metricKey) return;
      points.push({ entityType: 'domain', entityId: domain, metricKey, date, value: Number(values[i]) || 0 });
    });
    return points;
  },
};
