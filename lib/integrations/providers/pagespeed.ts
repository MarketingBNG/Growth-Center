import {
  httpTimeout,
  IntegrationError,
  type IntegrationProvider,
  type MetricPoint,
  type SyncCursor,
} from '../types.ts';

// Google PageSpeed Insights — Core Web Vitals for the pages Search Console already found.
//
// An API key rather than OAuth: the key identifies the caller for quota and nothing else.
// There is no user to consent, no account to scope to and no token to refresh.
//
// Two things about this API shape everything below, and both were measured against the
// live site rather than assumed:
//
//   1. A single call takes 17-51 seconds. That is not a slow network; Google is running a
//      full Lighthouse pass in a real browser. See BUDGET_MS and CONCURRENCY.
//   2. Field data is per-origin far more often than it is per-URL. See readField.

const API = 'https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed';

/** Both strategies are stored. Mobile is the headline — it is what Google ranks on — and
 *  desktop is kept beside it because a page can be fine on one and not the other. */
const STRATEGIES = ['mobile', 'desktop'] as const;
type Strategy = (typeof STRATEGIES)[number];

/**
 * How many pages to measure, most-trafficked first — see DEFAULT_PAGE_LIMIT — is what
 * bounds a run here. There is deliberately no time budget of this provider's own.
 *
 * Two attempts at one were written and both were useless, which is worth recording so a
 * third is not attempted. Capping a single slice does nothing, because `runPaged` calls
 * `syncPaged` in a loop and simply calls it again. Capping across slices does nothing
 * either, for the same reason: returning a cursor is an invitation to be called back, and
 * the contract has no way to say "finished for now but not complete". The first real sync
 * run took 244 seconds against a 90-second cap that was doing nothing at all.
 *
 * The problem was never this provider's to solve. It is that a slow provider must not
 * share the nightly function with fast ones — which is what `ownSchedule` and the weekly
 * cron in vercel.json settle. Within its own run, using the full 230s budget is correct.
 */

/**
 * URLs measured at once.
 *
 * The quota is 25,000 queries a day and 240 a minute, so concurrency is not what is
 * scarce here — wall-clock time is. Four concurrent calls measured 36s against roughly
 * 100s for the same four in sequence. Higher would be allowed and is not worth it: each
 * call holds a Lighthouse run open, and the slowest in a batch sets the batch's cost, so
 * widening it mostly buys more time spent waiting on one straggler.
 */
const CONCURRENCY = 4;

/**
 * How many pages to measure, most-trafficked first.
 *
 * The site has 251 pages in `seo_page` and 204 of them have earned zero clicks. The top
 * 40 carry 98.9% of all traffic and the top 60 carry 100%. Measuring all 251 would spend
 * about nine tenths of a very expensive API on pages nobody has visited, to report a
 * number no decision depends on.
 *
 * 25, which is more than one run reliably finishes — deliberately. Measured passes
 * covered 22 pages in 237s and 15 in 317s; the spread is Google's, not ours. Sizing the
 * default to the worse of those would have cut coverage to about the top twelve pages to
 * buy a property nothing needs, since a pass that spans two runs keeps its cursor and
 * finishes without re-measuring anything. The cron runs twice a week for exactly this
 * reason, so a pass always completes well inside the week.
 *
 * The top 25 pages carry roughly 95% of all traffic, and 204 of this site's 251 pages have
 * never been clicked at all.
 *
 * Configurable, because "which pages are worth measuring" is a judgement about this site
 * rather than a fact about the API.
 */
const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 250;

/**
 * One call's own timeout, passed to the shared `httpTimeout` helper.
 *
 * Longer than its 60s default, which is why the default is not used here: 60s is a sound
 * definition of "hung" for an API that answers in a few seconds, and a wrong one for an
 * API whose *normal* answer took 51s on the first URL measured against this site. A 60s
 * cap would have abandoned healthy calls and reported the site unmeasurable.
 *
 * 90s rather than longer because it is also what bounds the overshoot past the sync
 * budget — see SAFETY_MS. The slowest call measured against this site was 51s.
 */
const CALL_TIMEOUT_MS = 90_000;

/**
 * How much of the sync budget to leave unspent rather than start another batch.
 *
 * `runPaged` and this loop both check the clock *between* batches, never during one, so
 * the run always overshoots its deadline by however long the batch in flight takes. A run
 * measured here took 317 seconds against a 230-second budget — and the route's
 * maxDuration is 300, so the function would have been killed mid-write and left the
 * integration marked `syncing` until the ten-minute lease expired.
 *
 * Refusing to start a batch inside the last 60s bounds the overshoot to one call timeout:
 * 230s - 60s to begin the final batch, plus at most 90s to finish it, is 260s — inside
 * the 300s limit with room to spare. The cost is a slightly shorter pass, which the
 * cursor makes free.
 */
const SAFETY_MS = 60_000;

type Stored = { apiKey: string };
type Json = Record<string, unknown>;

/**
 * The five field metrics CrUX reports, onto the names stored.
 *
 * INP rather than FID: FID was retired as a Core Web Vital in March 2024 and CrUX no
 * longer reports it. There is no lab equivalent — INP needs a real person interacting —
 * which is why the field half of this provider exists at all rather than being derived
 * from the Lighthouse run.
 */
const FIELD_METRICS: Record<string, string> = {
  LARGEST_CONTENTFUL_PAINT_MS: 'lcp',
  INTERACTION_TO_NEXT_PAINT: 'inp',
  CUMULATIVE_LAYOUT_SHIFT_SCORE: 'cls',
  FIRST_CONTENTFUL_PAINT_MS: 'fcp',
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: 'ttfb',
};

/** The lab audits worth keeping as numbers. TBT is here and INP is not: TBT is the lab's
 *  stand-in for responsiveness, and the two are not interchangeable. */
const LAB_AUDITS: Record<string, string> = {
  'largest-contentful-paint': 'lcp',
  'cumulative-layout-shift': 'cls',
  'first-contentful-paint': 'fcp',
  'total-blocking-time': 'tbt',
  'speed-index': 'speed_index',
  'server-response-time': 'ttfb',
};

const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const str = (value: unknown): string | null => {
  const s = value == null ? '' : String(value).trim();
  return s === '' ? null : s;
};

/**
 * CrUX scores CLS in hundredths of a unit and reports it as an integer, so a real 0.05
 * arrives as 5. Every other field metric is already in milliseconds.
 *
 * Storing the raw 5 would have put a page comfortably inside the 0.1 "good" threshold on
 * record as scoring 5.0 — fifty times worse than it is — and the insight rules read these
 * numbers.
 */
function fieldValue(key: string, percentile: number): number {
  return key === 'CUMULATIVE_LAYOUT_SHIFT_SCORE' ? percentile / 100 : percentile;
}

/** Midnight UTC. Keeps a metric point's unique key stable so a re-measure updates the
 *  day's row rather than adding another. */
function today(): Date {
  return new Date(new Date().setUTCHours(0, 0, 0, 0));
}

export function buildUrl(url: string, strategy: Strategy, apiKey: string): string {
  const q = new URLSearchParams({ url, strategy, key: apiKey });
  // Appended rather than passed in the object: `category` is a repeated parameter and an
  // object key can only hold one value. Only PERFORMANCE is asked for — the other four
  // categories each add their own audits to the run and nothing here reads them.
  q.append('category', 'PERFORMANCE');
  return `${API}?${q}`;
}

/**
 * One measurement, or null if this URL could not be measured.
 *
 * The distinction that matters here is whether a failure is about *this call* or about
 * *every call*. Only the second kind may throw: a thrown IntegrationError ends the whole
 * pass, and a pass covers up to a hundred calls.
 *
 * Google returns sporadic 500s under load — one appeared on the first real sync run here
 * and the URL measured fine seconds later. Treating that as fatal meant a single flaky
 * call threw away every page measured alongside it. Server errors are retried once and
 * then skipped, the same as a URL Google cannot fetch.
 */
async function measure(url: string, strategy: Strategy, apiKey: string): Promise<Json | null> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(buildUrl(url, strategy, apiKey), {
      headers: { accept: 'application/json' },
      signal: httpTimeout(CALL_TIMEOUT_MS),
    });

    if (res.ok) return (await res.json()) as Json;

    // About the key, and true of every call in the pass. Worth stopping for.
    if (res.status === 401 || res.status === 403) {
      throw new IntegrationError(
        'Google rejected the PageSpeed API key. Check it is enabled for the PageSpeed Insights API.',
      );
    }
    // About the quota, equally run-wide. The cursor is kept, so the pass resumes tomorrow
    // from where it stopped rather than starting over.
    if (res.status === 429) {
      throw new IntegrationError('Google is rate-limiting PageSpeed requests. It will resume on the next run.');
    }

    // Google refuses a URL it cannot fetch — a page since removed, or one behind a login.
    // That is this URL's problem and nobody else's.
    if (res.status === 400) return null;

    // Anything left is a server-side wobble. One retry, then give this URL up and let the
    // rest of the pass continue without it.
    if (res.status >= 500 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 2_000));
      continue;
    }
    return null;
  }
}

/**
 * Field (CrUX) metrics from one response, and whether they are actually about this URL.
 *
 * `origin_fallback` is the whole reason this is a separate function. Google sets it when
 * it has no per-URL sample for the page and is handing back the origin's numbers instead.
 * Measured against this site, only the homepage has per-URL field data; the other four
 * pages tested all came back with origin_fallback true — meaning the *same five numbers*
 * for every page.
 *
 * Writing those per page would have put identical, confident Core Web Vitals on 250 pages
 * and presented each as a measurement of that page. They are stored against the origin
 * once instead, and the per-URL row is written only when the data is genuinely per-URL.
 */
export function readField(payload: Json): { metrics: Record<string, number>; originFallback: boolean } {
  const le = payload.loadingExperience as Json | undefined;
  const metrics: Record<string, number> = {};
  if (!le || typeof le !== 'object') return { metrics, originFallback: true };

  for (const [cruxKey, name] of Object.entries(FIELD_METRICS)) {
    const m = (le.metrics as Json | undefined)?.[cruxKey] as Json | undefined;
    const p = m ? num(m.percentile) : null;
    if (p !== null) metrics[name] = fieldValue(cruxKey, p);
  }

  return { metrics, originFallback: le.origin_fallback === true };
}

/** Lab (Lighthouse) metrics. Always genuinely about the URL asked for — the run happened
 *  on that page — which is what makes these safe to store per page when field data is not. */
export function readLab(payload: Json): { metrics: Record<string, number>; score: number | null } {
  const lr = payload.lighthouseResult as Json | undefined;
  const metrics: Record<string, number> = {};
  if (!lr || typeof lr !== 'object') return { metrics, score: null };

  const audits = (lr.audits ?? {}) as Json;
  for (const [auditId, name] of Object.entries(LAB_AUDITS)) {
    const a = audits[auditId] as Json | undefined;
    const v = a ? num(a.numericValue) : null;
    if (v !== null) metrics[name] = v;
  }

  const categories = (lr.categories ?? {}) as Json;
  const perf = (categories.performance ?? {}) as Json;
  // Google reports 0-1; stored as 0-100, which is how it is spoken about and displayed.
  const raw = num(perf.score);
  return { metrics, score: raw === null ? null : Math.round(raw * 100) };
}

/**
 * Lighthouse's failing opportunities, in the shape `SeoPage.issues` documents.
 *
 * Only audits that actually failed are kept. A clean page produces an empty array rather
 * than no array: "measured, nothing wrong" and "never measured" are different states and
 * the SEO page needs to be able to tell them apart.
 */
export function readIssues(payload: Json): { code: string; severity: string; message: string }[] {
  const lr = payload.lighthouseResult as Json | undefined;
  const audits = ((lr?.audits ?? {}) as Json) ?? {};
  const issues: { code: string; severity: string; message: string; savings: number }[] = [];

  for (const [code, value] of Object.entries(audits)) {
    const a = value as Json;
    if (!a || typeof a !== 'object') continue;

    // The null check is explicit and comes first, because `Number(null)` is 0 and 0 is
    // finite — so running an informative audit through `num` scored it zero and made every
    // diagnostic Lighthouse offers come out as a high-severity finding. Roughly half the
    // audits in a run carry a null score.
    if (a.score === null || a.score === undefined) continue;

    const score = num(a.score);
    // 0.9 and up is a pass in Lighthouse's own terms.
    if (score === null || score >= 0.9) continue;

    const details = (a.details ?? {}) as Json;
    const savings = num(details.overallSavingsMs) ?? 0;
    const title = str(a.title);
    if (!title) continue;

    const display = str(a.displayValue);
    issues.push({
      code,
      // Lighthouse's own scoring, not a second opinion invented here.
      severity: score < 0.5 ? 'high' : 'medium',
      message: display ? `${title} — ${display}` : title,
      savings,
    });
  }

  // Biggest estimated saving first, so the list reads as a priority order.
  issues.sort((a, b) => b.savings - a.savings || a.code.localeCompare(b.code));
  // Ten is what a person will act on. The full list runs to dozens and the tail is noise.
  return issues.slice(0, 10).map(({ code, severity, message }) => ({ code, severity, message }));
}

/**
 * Where a pass stopped.
 *
 * `urls` is carried rather than re-read so a resumed run measures the same set it started
 * with. Without it, a Search Console sync landing mid-pass could reorder the pages by
 * clicks and the run would re-measure pages it had already done while skipping others.
 */
type Cursor = { urls: string[]; index: number };

export function readCursor(raw: unknown): Cursor | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Json;
  if (!Array.isArray(c.urls)) return null;

  const urls = c.urls.map(String).filter(Boolean);
  if (!urls.length) return null;

  const index = Number(c.index);
  return { urls, index: Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0 };
}

export const pagespeed: IntegrationProvider = {
  id: 'pagespeed',
  name: 'PageSpeed Insights',
  category: 'seo',
  authKind: 'apiKey',
  summary: "Core Web Vitals and Lighthouse findings for the site's most-visited pages.",
  provides: ['LCP', 'INP', 'CLS', 'Performance score', 'Technical findings'],
  requiredEnv: [],
  docsUrl: 'https://developers.google.com/speed/docs/insights/v5/get-started',

  // Too slow to share the nightly sync. Runs from /api/cron/pagespeed instead.
  ownSchedule: true,

  configFields: [
    {
      name: 'pageLimit',
      label: 'Pages to measure',
      placeholder: String(DEFAULT_PAGE_LIMIT),
      help: `The most-visited pages first. Measuring every known page mostly measures pages nobody visits — one call takes up to a minute. Default ${DEFAULT_PAGE_LIMIT}.`,
      required: false,
      normalise(value) {
        const trimmed = value.trim();
        if (!trimmed) return String(DEFAULT_PAGE_LIMIT);
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n < 1) throw new Error('Enter a number of pages, at least 1.');
        return String(Math.min(Math.floor(n), MAX_PAGE_LIMIT));
      },
    },
  ],

  // The key is supplied through the Integration Center like Smartlead's, so there is
  // nothing the environment has to hold before this can be connected.
  isConfigured() {
    return true;
  },

  getAuthUrl() {
    return null;
  },

  async connect(input) {
    if (input.kind !== 'apiKey') throw new IntegrationError('PageSpeed Insights uses an API key.');

    const apiKey = input.apiKey.trim();
    if (!apiKey) throw new IntegrationError('An API key is required.');

    // Validated against a real measurement rather than a format check. A key that is well
    // formed but not enabled for this API is indistinguishable from a good one until it is
    // used, and finding that out on the first nightly cron is finding it out too late.
    //
    // example.com rather than this firm's own site, and rather than google.com: it is the
    // smallest page on the public web that is certain to be fetchable, so a failure here is
    // unambiguously about the key rather than about the site. It measured 7.8s against
    // 25.6s for the firm's homepage and 14.5s for google.com — and this call is made with
    // somebody waiting on a form.
    //
    // Retried once on a rate limit. A 429 here says the API is busy, not that the key is
    // bad, and refusing the connection would send someone off to reissue a key that was
    // fine — which is exactly what happened while this was being built.
    let probe = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        probe = await measure('https://example.com/', 'mobile', apiKey);
        break;
      } catch (e) {
        const busy = e instanceof IntegrationError && e.message.includes('rate-limiting');
        if (!busy || attempt === 1) throw e;
        await new Promise((r) => setTimeout(r, 3_000));
      }
    }
    if (!probe) throw new IntegrationError('Google could not complete a test measurement with this key.');

    return { secret: JSON.stringify({ apiKey } satisfies Stored) };
  },

  async syncPaged(credential, config, ctx) {
    const { apiKey } = JSON.parse(credential) as Stored;
    const points: MetricPoint[] = [];
    const date = today();

    // The caller's budget, used in full. This provider has the run to itself.
    const deadline = ctx.deadline;

    let cursor = readCursor(ctx.cursor);
    const freshPass = !cursor;

    if (!cursor) {
      const limit = Math.min(Number(config.pageLimit) || DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
      const urls = await pagesToMeasure(limit);
      if (!urls.length) {
        throw new IntegrationError(
          'No pages to measure. Connect Search Console first so there is a page list to work from.',
        );
      }
      cursor = { urls, index: 0 };
    }

    let firstBatch = freshPass;

    while (cursor.index < cursor.urls.length) {
      // Checked before the batch, not after it. Checking only afterwards is what let a run
      // start a fresh batch with seconds left on the clock and overrun by a minute.
      if (Date.now() > deadline - SAFETY_MS) {
        return { points, cursor: cursor as unknown as SyncCursor };
      }

      const batch = cursor.urls.slice(cursor.index, cursor.index + CONCURRENCY);

      // Concurrent, and settled rather than all: one URL Google refuses must not discard
      // the three measured alongside it, which is what Promise.all would have done.
      const results = await Promise.allSettled(
        batch.flatMap((url) =>
          STRATEGIES.map(async (s) => ({ url, strategy: s, payload: await measure(url, s, apiKey) })),
        ),
      );

      for (const r of results) {
        if (r.status === 'rejected') {
          // An IntegrationError here is about the key or the quota and applies to every
          // call, not this one — so it is worth stopping for. Anything else is this URL's
          // problem and the pass carries on without it.
          if (r.reason instanceof IntegrationError) throw r.reason;
          continue;
        }
        const { url, strategy, payload } = r.value;
        if (!payload) continue;

        const lab = readLab(payload);
        const field = readField(payload);

        // ── lab: genuinely per-page, so stored per page ──────────────────────────────
        for (const [name, value] of Object.entries(lab.metrics)) {
          points.push({
            entityType: 'web_vitals',
            entityId: url,
            metricKey: `${strategy}_lab_${name}`,
            date,
            value,
          });
        }
        if (lab.score !== null) {
          points.push({
            entityType: 'web_vitals',
            entityId: url,
            metricKey: `${strategy}_score`,
            date,
            value: lab.score,
          });
        }

        // ── field: per page only when Google says it is about this page ──────────────
        if (!field.originFallback) {
          for (const [name, value] of Object.entries(field.metrics)) {
            points.push({
              entityType: 'web_vitals',
              entityId: url,
              metricKey: `${strategy}_field_${name}`,
              date,
              value,
            });
          }
        }

        // The lab findings for this page, mobile only — desktop would overwrite them with
        // a second opinion about the same page and the SEO page shows one list.
        if (strategy === 'mobile') {
          points.push({
            entityType: 'web_vitals_issues',
            entityId: url,
            metricKey: 'record',
            date,
            value: 1,
            entityMeta: { issues: readIssues(payload) },
          });
        }
      }

      // Origin-level field data, written once per pass rather than per page: it is the
      // same figure in every response, and it is the only Core Web Vitals number that is
      // true of pages with too little traffic for CrUX to report them individually.
      if (firstBatch) {
        // One response per strategy, not one response overall. Breaking on the first
        // fulfilled result recorded whichever strategy happened to answer first and left
        // the other with no origin figures at all — the first real run stored mobile and
        // no desktop.
        const seen = new Set<Strategy>();
        for (const r of results) {
          if (r.status !== 'fulfilled' || !r.value.payload) continue;
          if (seen.has(r.value.strategy)) continue;

          const origin = r.value.payload.originLoadingExperience as Json | undefined;
          const metrics = (origin?.metrics ?? {}) as Json;
          if (!origin) continue;
          seen.add(r.value.strategy);

          for (const [cruxKey, name] of Object.entries(FIELD_METRICS)) {
            const m = metrics[cruxKey] as Json | undefined;
            const p = m ? num(m.percentile) : null;
            if (p === null) continue;
            points.push({
              entityType: 'web_vitals_origin',
              // "" is how this schema spells "no particular entity" — see MetricSnapshot.
              entityId: '',
              metricKey: `${r.value.strategy}_field_${name}`,
              date,
              value: fieldValue(cruxKey, p),
            });
          }
          if (seen.size === STRATEGIES.length) break;
        }
        firstBatch = false;
      }

      cursor = { ...cursor, index: cursor.index + batch.length };

      // Finished on the very last batch: the pass is complete however little time is left,
      // and saying otherwise would make it start over having done everything.
      if (cursor.index >= cursor.urls.length) break;

      if (Date.now() > deadline - SAFETY_MS) {
        return { points, cursor: cursor as unknown as SyncCursor };
      }
    }

    return { points, cursor: null };
  },
};

/**
 * The pages worth measuring, most-visited first.
 *
 * Read from `seo_page`, which Search Console populates — this provider discovers nothing
 * on its own and is not meant to. Imported inside the function rather than at module
 * scope so the file stays loadable without a database, which is what the provider tests
 * rely on.
 */
async function pagesToMeasure(limit: number): Promise<string[]> {
  const { db } = await import('../../prisma.ts');
  const rows = await db().seoPage.findMany({
    orderBy: [{ clicks: 'desc' }, { impressions: 'desc' }],
    take: limit,
    select: { url: true },
  });
  return rows.map((r) => r.url).filter((u) => /^https?:\/\//.test(u));
}
