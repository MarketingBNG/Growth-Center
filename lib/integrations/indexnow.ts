// IndexNow — telling search engines a URL changed, instead of waiting to be crawled.
//
// One of the few places this application writes to something outside itself, so the
// justification belongs here rather than in a contract nobody opens. What it sends is a
// list of URLs on our own domain and nothing else: no content, no personal data, no
// change to any record anywhere. The engines treat it as a hint and crawl on their own
// schedule. The cost of it being wrong is a crawl of a page that had not changed; the cost
// of not having it is a rewritten page sitting unindexed for days.
//
// It publishes nothing. WP12's publishing flow calls this AFTER a human has authorised a
// publish, and this function has no opinion about whether that happened — it cannot
// publish, only announce.
//
// Endpoint, limits and status codes below are from the protocol documentation at
// https://www.indexnow.org/documentation, read 19 Sep 2026, rather than from memory.

import { IntegrationError, httpTimeout } from './types.ts';
import { recordAudit } from '../platform/audit.ts';
import { hasDb } from '../platform/prisma.ts';

/** The shared endpoint. Submitting here forwards to every participating engine, so there
 *  is no value in calling Bing and Yandex separately. */
const ENDPOINT = 'https://api.indexnow.org/indexnow';

/** "You can submit up to 10,000 URLs per post." Longer lists are split. */
export const MAX_URLS_PER_REQUEST = 10_000;

/** "a minimum of 8 and a maximum of 128 hexadecimal characters", from the same page,
 *  which then permits a-z, A-Z, 0-9 and dashes. The stated character set is what is
 *  enforced; "hexadecimal" is the documentation's own word for a set that includes `z`. */
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

export type IndexNowOutcome = {
  host: string;
  urls: number;
  status: number;
  ok: boolean;
  /** What the status means, in words, for the audit row and the integration card. */
  message: string;
};

/**
 * What each documented status means.
 *
 * Spelled out because the failures are all silent otherwise: a 403 is a key file that was
 * never uploaded to the website, and a 422 is almost always a URL on the wrong host. Both
 * return promptly and both look like "it ran" in a log that records only the number.
 */
export function explainStatus(status: number): { ok: boolean; message: string } {
  switch (status) {
    case 200:
      return { ok: true, message: 'Accepted.' };
    case 202:
      return { ok: true, message: 'Accepted; the key is still being validated.' };
    case 400:
      return { ok: false, message: 'Rejected as malformed (400).' };
    case 403:
      return {
        ok: false,
        message: 'Key rejected (403). The key file is missing from the website, or holds a different key.',
      };
    case 422:
      return {
        ok: false,
        message: 'URLs rejected (422). They do not all belong to the host they were submitted under.',
      };
    case 429:
      return { ok: false, message: 'Rate limited (429). Submitting too often.' };
    default:
      return { ok: false, message: `Unexpected response (${status}).` };
  }
}

/** Throws unless the key matches the published format. */
export function assertValidKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new IntegrationError(
      'INDEXNOW_KEY must be 8 to 128 characters of letters, numbers or dashes.',
    );
  }
}

/**
 * Groups URLs by host, dropping anything unusable.
 *
 * A submission carries one `host` and every URL in it must belong to that host or the
 * whole batch is refused with a 422 — so a single stray URL would silently cost the other
 * nine hundred. Grouping means a mixed list becomes one request per host instead of one
 * failure.
 */
export function groupByHost(urls: string[]): { valid: Map<string, string[]>; rejected: string[] } {
  const valid = new Map<string, string[]>();
  const rejected: string[] = [];

  for (const raw of urls) {
    const url = raw.trim();
    if (!url) continue;
    let host: string;
    try {
      const parsed = new URL(url);
      // The protocol is about web pages. A mailto: or javascript: URL parses cleanly and
      // would be sent as-is.
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        rejected.push(url);
        continue;
      }
      host = parsed.host;
    } catch {
      rejected.push(url);
      continue;
    }
    const list = valid.get(host) ?? [];
    // De-duplicated per host: submitting the same URL twice in one batch counts twice
    // against the rate limit and tells the engine nothing new.
    if (!list.includes(url)) list.push(url);
    valid.set(host, list);
  }

  return { valid, rejected };
}

/** Splits a list into requests no larger than the documented maximum. */
export function chunk<T>(items: T[], size: number = MAX_URLS_PER_REQUEST): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type NotifyResult = {
  submitted: number;
  rejected: string[];
  outcomes: IndexNowOutcome[];
  /** True when every request was accepted. False if any was refused. */
  ok: boolean;
};

/**
 * Tells the search engines that these URLs changed.
 *
 * Never throws for a refusal — a 403 from a missing key file must not take down the
 * publish that called it, and the caller needs the per-request outcomes to record. It
 * throws only when it was never configured to run at all, which is a deployment fault
 * rather than a result.
 *
 * `INDEXNOW_KEY_LOCATION` is optional and only needed when the key file cannot be served
 * from the site root. The key file itself lives on the public website, not in this app —
 * this application is not what the engines fetch it from.
 */
export async function notifyIndexNow(
  urls: string[],
  opts: { actorEmail?: string } = {},
): Promise<NotifyResult> {
  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key) {
    throw new IntegrationError('INDEXNOW_KEY is not set, so search engines cannot be notified.');
  }
  assertValidKey(key);
  const keyLocation = process.env.INDEXNOW_KEY_LOCATION?.trim() || undefined;

  const { valid, rejected } = groupByHost(urls);
  const outcomes: IndexNowOutcome[] = [];
  let submitted = 0;

  for (const [host, hostUrls] of valid) {
    for (const batch of chunk(hostUrls)) {
      let status: number;
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ host, key, keyLocation, urlList: batch }),
          signal: httpTimeout(),
        });
        status = res.status;
      } catch (e) {
        // A timeout or a DNS failure is not a status. Recorded as 0 so the outcome still
        // exists in the log rather than the call vanishing.
        outcomes.push({
          host,
          urls: batch.length,
          status: 0,
          ok: false,
          message: `Could not reach IndexNow: ${e instanceof Error ? e.message : 'unknown error'}.`,
        });
        continue;
      }

      const { ok, message } = explainStatus(status);
      if (ok) submitted += batch.length;
      outcomes.push({ host, urls: batch.length, status, ok, message });
    }
  }

  const result: NotifyResult = {
    submitted,
    rejected,
    outcomes,
    // Vacuously true with nothing to send would read as success in a log. An empty call is
    // not a failure either, so it reports ok only when something was actually accepted.
    ok: outcomes.length > 0 && outcomes.every((o) => o.ok),
  };

  await logCall(result, opts.actorEmail);
  return result;
}

/**
 * Records the call and what came back.
 *
 * Every outcome, refusals included — a 403 that leaves no trace is the exact failure this
 * log exists to catch, because nothing else about a silent non-indexing is visible.
 *
 * Audit rows resolve to a person. A publish job runs under the authority of whoever
 * authorised the publish and passes their address; `system` is the honest answer when
 * there genuinely is no human, rather than attributing it to one.
 *
 * Never throws. Failing to write the log must not fail the notification it describes.
 */
async function logCall(result: NotifyResult, actorEmail?: string): Promise<void> {
  if (!hasDb()) return;
  try {
    await recordAudit({
      actorEmail: actorEmail ?? 'system',
      action: 'seo.indexnow',
      entityType: 'seo_page',
      detail: {
        submitted: result.submitted,
        rejected: result.rejected.length,
        ok: result.ok,
        // Per request, so a partial failure across two hosts is legible afterwards.
        responses: result.outcomes.map((o) => ({
          host: o.host,
          urls: o.urls,
          status: o.status,
          message: o.message,
        })),
      },
    });
  } catch (e) {
    console.error('[indexnow] could not record the call:', e);
  }
}
