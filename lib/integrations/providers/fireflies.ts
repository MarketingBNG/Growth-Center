import {
  IntegrationError,
  httpTimeout,
  type IntegrationProvider,
  type Json,
  type MetricPoint,
} from '../types.ts';
import { scrubTranscript, verifyScrubbed } from '../../content/transcript-scrub.ts';

// Fireflies — sales calls, as buyer language rather than as recordings.
//
// WP07. What the firm wants out of this is the words prospects actually use: the event
// that made them pick up the phone, the objection they raise, the question they ask twice.
// That is the strongest signal there is for what to write.
//
// What Fireflies actually holds is recordings of named clients discussing their tax
// affairs, which makes this the most sensitive integration in the application by a
// distance. Two rules shape everything below.
//
//   **Nothing identifying leaves this provider.** Every transcript is scrubbed by
//   lib/content/transcript-scrub.ts and verified before it becomes a point, and a
//   transcript that fails verification is dropped rather than stored. §3.12.
//
//   **No transcript text is stored at all by this provider.** metric_snapshot has no text
//   column and this does not try to invent one. What it writes is counts — how many calls,
//   how much was scrubbed — so the Integration Center can show the feed is alive. The
//   extraction into buyer phrases is WP07's second task and needs an Anthropic key, which
//   this account does not have set; when it lands it reads from a restricted table, not
//   from here.
//
// Endpoint, auth header, the 50-per-page ceiling and the field names come from
// docs.fireflies.ai/graphql-api/query/transcripts, read 19 September 2026.
//
// NOT YET RUN AGAINST THE LIVE API — there is no Fireflies key for this account. Written
// to the documentation, typechecked and unit-tested only.

const API = 'https://api.fireflies.ai/graphql';

/** "limit (max 50 per query)". */
const PAGE_SIZE = 50;

type Stored = { apiKey: string };

/**
 * The query.
 *
 * `sentences` is what carries the words, and it is requested with `speaker_name` so the
 * scrubber has something to strip rather than a wall of anonymous text it cannot attribute.
 * `participants` and `host_email` are requested for the same reason and for one more: they
 * are the known-parties list the scrubber needs, so asking for them is what makes the
 * redaction possible rather than a leak in itself.
 */
const TRANSCRIPTS = `
  query Transcripts($fromDate: DateTime, $toDate: DateTime, $limit: Int, $skip: Int) {
    transcripts(fromDate: $fromDate, toDate: $toDate, limit: $limit, skip: $skip) {
      id
      title
      date
      host_email
      participants
      speakers { name }
      sentences { speaker_name text }
    }
  }
`;

type Sentence = { speaker_name?: string | null; text?: string | null };
type Transcript = {
  id?: string;
  title?: string;
  date?: string | number;
  host_email?: string | null;
  participants?: unknown;
  speakers?: { name?: string | null }[];
  sentences?: Sentence[] | null;
};

async function graphql(apiKey: string, variables: Json): Promise<Transcript[]> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: TRANSCRIPTS, variables }),
    signal: httpTimeout(),
  });

  if (res.status === 401 || res.status === 403) {
    throw new IntegrationError('Fireflies rejected the API key. Check it in Fireflies → Settings → Developer.');
  }
  if (!res.ok) throw new IntegrationError(`Fireflies returned ${res.status}.`);

  const body = (await res.json()) as {
    data?: { transcripts?: Transcript[] };
    errors?: { message?: string }[];
  };

  // GraphQL reports failures inside a 200. Read only the status and an expired key looks
  // like an account with no calls in it.
  if (body.errors?.length) {
    throw new IntegrationError(`Fireflies refused the query: ${body.errors[0]?.message ?? 'unknown error'}`);
  }
  return body.data?.transcripts ?? [];
}

/** Fireflies dates arrive as epoch milliseconds on some fields and ISO on others. */
export function parseCallDate(value: unknown): Date | null {
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== 'string' || !value) return null;
  // A string of digits is still epoch milliseconds, just JSON-encoded as text.
  const d = /^\d+$/.test(value) ? new Date(Number(value)) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];

/**
 * Everyone the call can be traced back to, gathered for the scrubber.
 *
 * Speaker names, the host's address and the participant list. Fireflies returns
 * participants as bare email strings, so the local part of each is a name the scrubber
 * should also strip — "priya.sharma" said aloud identifies exactly as well as the address.
 */
export function knownParties(t: Transcript): { names: string[]; emails: string[] } {
  const emails = [...asStrings(t.participants), t.host_email ?? ''].filter(Boolean);
  const names = [
    ...(t.speakers ?? []).map((s) => s.name ?? '').filter(Boolean),
    ...(t.sentences ?? []).map((s) => s.speaker_name ?? '').filter(Boolean),
  ];
  return { names: [...new Set(names)], emails: [...new Set(emails)] };
}

/** The call as one passage of text, ready to be scrubbed. */
export const transcriptText = (t: Transcript): string =>
  (t.sentences ?? [])
    .map((s) => `${s.speaker_name ?? 'Speaker'}: ${s.text ?? ''}`)
    .join('\n')
    .trim();

export type ScrubbedCall = {
  id: string;
  date: Date;
  text: string;
  words: number;
  removed: Record<string, number>;
};

/**
 * One transcript, scrubbed, or null if it cannot be made safe.
 *
 * Dropping is the right answer to a verification failure. A call that will not come clean
 * is one call's worth of buyer language; storing it anyway is a client's identity in a
 * content table. Exported so the test can exercise the decision directly.
 */
export function safeCall(t: Transcript): ScrubbedCall | null {
  const id = typeof t.id === 'string' ? t.id : null;
  const date = parseCallDate(t.date);
  const raw = transcriptText(t);
  if (!id || !date || !raw) return null;

  const known = knownParties(t);
  const { text, removed } = scrubTranscript(raw, known);
  if (verifyScrubbed(text, known).length) return null;

  return { id, date, text, words: text.split(/\s+/).filter(Boolean).length, removed };
}

export const fireflies: IntegrationProvider = {
  id: 'fireflies',
  name: 'Fireflies',
  category: 'crm',
  authKind: 'apiKey',
  summary: 'Sales calls as buyer language. Names, addresses and tax identifiers are stripped before anything is stored.',
  provides: ['Calls recorded', 'Words of buyer language', 'Identifiers removed'],
  requiredEnv: [],
  docsUrl: 'https://docs.fireflies.ai/graphql-api/query/transcripts',

  isConfigured: () => true,
  getAuthUrl: () => null,

  async connect(input) {
    if (input.kind !== 'apiKey') throw new IntegrationError('Fireflies uses an API key.');
    const apiKey = input.apiKey.trim();
    if (!apiKey) throw new IntegrationError('Enter the API key from Fireflies → Settings → Developer.');

    // Validated with a real query rather than trusted. A key that parses but cannot read
    // transcripts fails on the first sync otherwise, hours later.
    await graphql(apiKey, { limit: 1, skip: 0 });
    return { secret: JSON.stringify({ apiKey } satisfies Stored) };
  },

  async sync(credential, _config, range) {
    const { apiKey } = JSON.parse(credential) as Stored;

    const calls: ScrubbedCall[] = [];
    let dropped = 0;

    for (let skip = 0; ; skip += PAGE_SIZE) {
      const page = await graphql(apiKey, {
        fromDate: range.from.toISOString(),
        toDate: range.to.toISOString(),
        limit: PAGE_SIZE,
        skip,
      });
      for (const t of page) {
        const safe = safeCall(t);
        if (safe) calls.push(safe);
        else dropped += 1;
      }
      if (page.length < PAGE_SIZE) break;
    }

    // Counts only. There is no text column in metric_snapshot and this deliberately does
    // not invent one — the scrubbed transcript exists inside this function and nowhere
    // else until WP07's extraction step has a restricted table to put it in.
    const byDay = new Map<string, { date: Date; calls: number; words: number; removed: number }>();
    for (const call of calls) {
      const day = new Date(
        Date.UTC(call.date.getUTCFullYear(), call.date.getUTCMonth(), call.date.getUTCDate()),
      );
      const key = day.toISOString().slice(0, 10);
      const entry = byDay.get(key) ?? { date: day, calls: 0, words: 0, removed: 0 };
      entry.calls += 1;
      entry.words += call.words;
      entry.removed += Object.values(call.removed).reduce((t, n) => t + n, 0);
      byDay.set(key, entry);
    }

    const points: MetricPoint[] = [];
    for (const { date, calls: n, words, removed } of byDay.values()) {
      points.push(
        { entityType: 'calls', entityId: 'fireflies', metricKey: 'calls_recorded', date, value: n },
        { entityType: 'calls', entityId: 'fireflies', metricKey: 'buyer_language_words', date, value: words },
        // Surfaced rather than logged: a day where nothing was redacted from a dozen calls
        // means the scrubber is not seeing what it should be, and that is worth noticing
        // on a card rather than in a server log nobody reads.
        { entityType: 'calls', entityId: 'fireflies', metricKey: 'identifiers_removed', date, value: removed },
      );
    }

    if (dropped) {
      console.warn(`[fireflies] ${dropped} transcript(s) could not be scrubbed clean and were skipped.`);
    }

    return points;
  },
};
