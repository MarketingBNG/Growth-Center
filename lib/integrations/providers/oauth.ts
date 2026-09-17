import { IntegrationError, httpTimeout } from '../types.ts';
import { vendorMessage } from '../messages.ts';

// The OAuth token-refresh and code-exchange code every provider needs, once. Five Google
// providers (analytics, ads, search console, YouTube, business) had byte-identical
// accessToken() and getAuthUrl() functions and an identical authorization_code exchange;
// the two Meta providers had a byte-identical long-lived-token exchange; the two Zoho
// providers had the same shape with one carrying a retry the other did not. This file is
// the one copy of each.
//
// What stays in each provider file: anything that differs. The scope string, the
// `input.kind !== 'oauth2'` guard and its provider name, the config a provider derives
// after exchanging a code (YouTube checks for a channel, Business Profile resolves a
// location), and every non-OAuth API call.

// ── Google ────────────────────────────────────────────────────────────────────────────

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * A short-lived access token, minted from the stored refresh token.
 *
 * Identical across every Google provider because the token endpoint is one endpoint: GA4,
 * Ads, Search Console, YouTube and Business Profile all authenticate against the same
 * Google account and the same client credentials, differing only in which scope was
 * granted at authorisation — which the refresh token itself already encodes.
 */
export async function googleAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: httpTimeout(),
  });
  if (!res.ok) {
    throw new IntegrationError(`Google rejected the refresh token (${res.status}). Reconnect the integration.`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new IntegrationError('Google returned no access token.');
  return json.access_token;
}

/**
 * Whether the Google OAuth client exists at all.
 *
 * One client serves all five Google providers, so this is the same question five times —
 * four of them spelled it identically and Google Ads asks it plus its developer token.
 * Named here so renaming either variable is one edit rather than four.
 */
export function googleConfigured(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

/** The consent-screen URL every Google provider sends the browser to. `scope` is the one
 *  thing that differs between them. `access_type=offline` and `prompt=consent` are both
 *  required for a refresh token to come back at all — Google returns one only on first
 *  consent for a client/scope pair, which is why every provider forces the prompt rather
 *  than letting Google skip it for a returning user. */
export function googleAuthUrl(scope: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Trades the authorization_code the consent screen produced for a refresh token. Every
 *  Google provider's connect() calls this first; some (YouTube, Business Profile) do
 *  another round trip afterwards to verify there is something behind the grant before
 *  reporting success. */
export async function googleExchangeCode(code: string, redirectUri: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: httpTimeout(),
  });
  if (!res.ok) throw new IntegrationError(`Token exchange failed (${res.status}).`);

  const json = (await res.json()) as { refresh_token?: string };
  if (!json.refresh_token) {
    // Google only returns a refresh token on the first consent, which is why
    // googleAuthUrl forces prompt=consent.
    throw new IntegrationError('Google returned no refresh token. Revoke access and reconnect.');
  }
  return json.refresh_token;
}

// ── Meta ──────────────────────────────────────────────────────────────────────────────

const META_TOKEN_URL = 'https://graph.facebook.com/v21.0/oauth/access_token';

/** Meta documents long-lived user tokens as ~60 days. When it omits expires_in this is
 *  assumed rather than storing no expiry at all: a null expiry made renewIfNearExpiry()
 *  skip renewal entirely and the card's expiry warning never render, so the connection
 *  could simply stop working one morning with nothing on screen saying why.
 *  Under-estimating is safe — an early renewal costs one extra request. */
const META_ASSUMED_LIFETIME_SECONDS = 60 * 24 * 60 * 60;

/**
 * Trades a token for a fresh long-lived one (~60 days).
 *
 * Used at connect, because the code exchange returns a short-lived token that would die
 * in about an hour, and again from refresh() to push the expiry out before it lapses.
 * Meta accepts a long-lived token as input here, which is what makes rolling renewal
 * possible at all. Identical for meta_ads and meta_social: both trade against the same
 * app credentials, and a long-lived user token carries whichever scopes were granted.
 */
export async function metaExchangeForLongLived(token: string): Promise<{ token: string; expiresIn: number }> {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: process.env.META_APP_ID ?? '',
    client_secret: process.env.META_APP_SECRET ?? '',
    fb_exchange_token: token,
  });

  const res = await fetch(`${META_TOKEN_URL}?${params}`, { signal: httpTimeout() });
  if (!res.ok) {
    throw new IntegrationError(
      (await vendorMessage(res)) ??
        `Meta refused to extend the token (${res.status}). Reconnect.`,
    );
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new IntegrationError('Meta returned no long-lived token.');
  return { token: json.access_token, expiresIn: json.expires_in ?? META_ASSUMED_LIFETIME_SECONDS };
}

/**
 * Rolling renewal for both Meta providers.
 *
 * meta_ads and meta_social had this byte for byte, expiry arithmetic included. Both store
 * a long-lived user token and both push its expiry out the same way, because it is one
 * Meta app behind them — the two differ in what they then ask the Graph for, not in how
 * they stay signed in.
 */
export async function metaRefresh(
  credential: string,
): Promise<{ secret: string; expiresAt: Date }> {
  const { accessToken } = JSON.parse(credential) as { accessToken: string };
  const long = await metaExchangeForLongLived(accessToken);
  return {
    secret: JSON.stringify({ accessToken: long.token }),
    expiresAt: new Date(Date.now() + long.expiresIn * 1000),
  };
}

// ── Zoho ──────────────────────────────────────────────────────────────────────────────

/**
 * The data centre. Zoho is region-partitioned — an account created in India lives on
 * accounts.zoho.IN and is invisible to accounts.zoho.COM — and it is a property of the
 * Zoho *account*, not of which product is talking to it, so CRM and Projects share one
 * value rather than each guessing separately. Defaulted to India, overridable for anyone
 * on another region.
 */
export const ZOHO_DC = (process.env.ZOHO_DC ?? 'in').replace(/[^a-z.]/gi, '').toLowerCase() || 'in';

export const ZOHO_ACCOUNTS = `https://accounts.zoho.${ZOHO_DC}`;

/** Errors a second attempt cannot get past: the client credentials themselves are wrong,
 *  and the retry would send the same pair. */
const PERMANENT_TOKEN_ERRORS = new Set(['invalid_client', 'invalid_client_secret']);

/** Long enough for a blip at Zoho's end to pass, short enough to be free in a 230s run. */
const TOKEN_RETRY_MS = 1_500;

/**
 * This endpoint answers in well under a second — the failure described below took 797ms
 * including its error — so the 60s default would only ever mean making the second attempt
 * against a socket that had already stopped answering.
 */
const TOKEN_TIMEOUT_MS = 15_000;

/**
 * A short-lived access token, minted from the stored refresh token. Shared by both Zoho
 * providers — CRM and Projects are separate OAuth clients but the same token-mint
 * mechanics — `label` is what tells the two apart in an error message.
 *
 * Attempted twice, because one bad answer here used to cost a day of syncing. On
 * 2026-09-06 the nightly cron died 797ms in with `Zoho: invalid_code` and the card
 * carried that error for 23 hours, until somebody pressed Sync now — at which point the
 * same stored refresh token pulled 43,750 records on the first try. The credential row
 * had not been rewritten in between, so the token had never been revoked. Zoho simply
 * answered badly once.
 *
 * Worth repeating because nothing else in a sync is this cheap to repeat: it is one
 * request, before a page has been fetched or a row written, and the thing it saves is the
 * entire nightly pull. Two attempts and no more — a refresh token that genuinely has been
 * revoked still fails inside four seconds, carrying the error Zoho gave for it, because
 * that error is the one that tells somebody to reconnect.
 */
export async function zohoAccessToken(opts: {
  refreshToken: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  /** "Zoho" for the CRM, "Zoho Projects" for Projects — the prefix each provider's error
   *  messages already used before this was shared. */
  label: string;
}): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: opts.refreshToken,
    client_id: opts.clientId ?? '',
    client_secret: opts.clientSecret ?? '',
    grant_type: 'refresh_token',
  });

  let last: IntegrationError | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, TOKEN_RETRY_MS));

    let json: { access_token?: string; error?: string };
    try {
      const res = await fetch(`${ZOHO_ACCOUNTS}/oauth/v2/token?${params}`, {
        method: 'POST',
        signal: httpTimeout(TOKEN_TIMEOUT_MS),
      });
      if (!res.ok) {
        last = new IntegrationError(`${opts.label} token refresh failed (${res.status}).`);
        continue;
      }
      json = (await res.json()) as { access_token?: string; error?: string };
    } catch (e) {
      // A dropped connection, or the timeout above. Worth one more attempt for the same
      // reason a bad answer is.
      last = new IntegrationError(`${opts.label} token refresh failed: ${(e as Error).message}`);
      continue;
    }

    if (json.access_token) return json.access_token;

    if (json.error) {
      if (PERMANENT_TOKEN_ERRORS.has(json.error)) throw new IntegrationError(`${opts.label}: ${json.error}`);
      last = new IntegrationError(`${opts.label}: ${json.error}`);
      continue;
    }

    last = new IntegrationError(`${opts.label} returned no access token.`);
  }

  throw last ?? new IntegrationError(`${opts.label} returned no access token.`);
}
