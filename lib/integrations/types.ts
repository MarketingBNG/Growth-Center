// The contract every integration implements. Adding a provider is a new file plus one
// line in registry.ts — no new UI, no new tables, no new code path.

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'error'
  | 'demo_data';

export type Category = 'analytics' | 'ads' | 'social' | 'crm' | 'seo' | 'email';

export type AuthKind = 'oauth2' | 'apiKey';

/** What a provider needs from the environment before it can be connected at all. */
export type EnvRequirement = { name: string; description: string };

export type SyncResult = {
  rows: number;
  /** Human-readable summary shown on the integration card after a sync. */
  detail: string;
};

export type DateRange = { from: Date; to: Date };

export type MetricPoint = {
  entityType: string;
  entityId: string | null;
  metricKey: string;
  date: Date;
  value: number;
};

/** A record the provider can hand over, e.g. a Zoho lead or a Meta campaign. */
export type Entity = { id: string; type: string; label: string; raw: Record<string, unknown> };

export interface IntegrationProvider {
  readonly id: string;
  readonly name: string;
  readonly category: Category;
  readonly authKind: AuthKind;
  /** One sentence, shown on the card. */
  readonly summary: string;
  /** What this provider writes into MetricSnapshot, listed on the card so the value is
   *  visible before connecting. */
  readonly provides: string[];
  readonly requiredEnv: EnvRequirement[];
  /** Documentation the person connecting it will need. */
  readonly docsUrl?: string;

  /** True when the environment holds everything needed to attempt a connection. */
  isConfigured(): boolean;

  /** OAuth providers return a URL to send the browser to. API-key providers return
   *  null — they are connected by submitting the key instead. */
  getAuthUrl(redirectUri: string, state: string): string | null;

  /** Exchanges an OAuth code, or validates a submitted API key. Returns the secret to
   *  seal and any non-secret config to store alongside it. */
  connect(input: ConnectInput): Promise<ConnectResult>;

  /** Pulls data and returns MetricSnapshot rows. Throws on failure — the caller records
   *  the error against the integration and emits integration.sync_failed. */
  sync(credential: string, config: Record<string, unknown>, range: DateRange): Promise<MetricPoint[]>;

  getEntities?(credential: string, config: Record<string, unknown>, type: string): Promise<Entity[]>;
}

export type ConnectInput =
  | { kind: 'oauth2'; code: string; redirectUri: string }
  | { kind: 'apiKey'; apiKey: string; config?: Record<string, unknown> };

export type ConnectResult = {
  /** Sealed by lib/crypto before it touches the database. */
  secret: string;
  config?: Record<string, unknown>;
  expiresAt?: Date;
};

/** Thrown by a provider when it cannot do what was asked. Carries a message safe to
 *  show on the integration card. */
export class IntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationError';
  }
}
