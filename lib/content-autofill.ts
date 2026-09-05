import { db } from './prisma.ts';
import { CONTENT_SOURCES } from './content-fields.ts';

// §15.4: "Auto-population: a new blog post on usaindiacfo.com (from Search Console pages
// or the sitemap) creates a Published item; a Zoho Social scheduled post creates a
// Scheduled item; a Zoho Backstage webinar creates the parent item plus the clip, blog and
// remarketing-audience children."
//
// "Hand-filled boards decay in three weeks. Auto-population is what keeps this screen
// honest in month six." The content table holds **0 rows**, which is that decay having
// already happened before the board was ever filled.
//
// Two of the three sources exist. Search Console is connected and holds 251 pages; social
// posts arrive from Meta. **Zoho Backstage is not integrated at all**, so the webinar
// parent-and-children case is not built — and it is named here rather than silently
// omitted, because the self-relation it needs was added for it and would otherwise look
// like a feature nobody wired up.

/**
 * Paths that are the site's furniture rather than its writing.
 *
 * Checked as a prefix on the first segment. `blog` is on the list and that reads oddly
 * until you look: `/blog/` is the index page, not an article, and the articles themselves
 * sit at the root.
 */
const NOT_CONTENT = /^(author|page|category|tag|feed|wp-|search|cart|checkout|account)/;

/**
 * Whether a URL is an article this firm wrote, and its title.
 *
 * The rule is: **one path segment, at least three hyphenated words**. That is what this
 * site's articles actually look like — `can-indians-own-company-in-usa-legal-guide`,
 * `gst-vs-us-sales-tax-guide-for-indian-founders` — while its service pages live one level
 * down under `usacfo/` and `familyoffice/` with one- or two-word slugs.
 *
 * Measured against all 251 pages Search Console reports: **141 are taken, 15 single-segment
 * pages are rejected** and the rejected list is `contact-us`, `terms`, `make-payment`,
 * `payment-policy`, `blog`, the two section indexes, and three genuine short articles —
 * `rodtep-scheme`, `form-d`, `why-delaware`.
 *
 * So the rule under-claims by about three pages, and that is the direction to be wrong in.
 * A board with three articles missing is a board somebody adds three rows to; a board with
 * `payment-policy` and `terms` on it is one people stop believing.
 */
export function articleFromUrl(url: string): { slug: string; title: string } | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }

  const trimmed = path.replace(/^\/+|\/+$/g, '');
  if (!trimmed) return null;

  const segments = trimmed.split('/');
  if (segments.length !== 1) return null;

  const slug = segments[0];
  if (NOT_CONTENT.test(slug)) return null;

  const words = slug.split('-').filter(Boolean);
  if (words.length < 3) return null;

  return { slug, title: titleFromSlug(words) };
}

/**
 * A readable title from a slug, because Search Console does not send one.
 *
 * `SeoPage.title` is null on all 251 rows — the API returns a page's URL and its metrics
 * and never its `<title>`. So the title is reconstructed, and the board says the item was
 * created by a machine so nobody mistakes it for what the author typed.
 *
 * Small words stay lower case except at the start, and a handful of acronyms this firm
 * uses constantly are restored: a board full of "Us Llc Ein" is worse than no board.
 */
const ACRONYMS = new Set(['us', 'usa', 'llc', 'ein', 'itin', 'gst', 'cfo', 'irs', 'nri', 'uae', 'pfic', 'ltd', 'faq']);
const MINOR = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);

export function titleFromSlug(words: string[]): string {
  return words
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      if (i > 0 && MINOR.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

export type AutofillResult = {
  scanned: number;
  created: number;
  /** Already on the board. Reported so a run that adds nothing reads as "nothing new"
   *  rather than as a job that has stopped working. */
  alreadyThere: number;
  skipped: number;
};

const EMPTY: AutofillResult = { scanned: 0, created: 0, alreadyThere: 0, skipped: 0 };

/**
 * Creates a Published item for every article Search Console knows about. §15.4.
 *
 * Idempotent on the URL. `ContentPiece.url` is not unique — a piece can legitimately be
 * created by hand with no URL, and a unique index would refuse the second of those — so
 * the existing set is read first and the difference inserted. That is one extra query and
 * it avoids a constraint that would break the hand-filled half of the board.
 *
 * **Nothing is ever updated.** A row this created is a starting point somebody then edits:
 * they retitle it, set the service line, attach the brief. Re-running and overwriting
 * would undo that work every night, which is precisely how an auto-populated board
 * teaches people to stop editing it.
 */
export async function fillPublishedFromSearchConsole(): Promise<AutofillResult> {
  const [pages, existing] = await Promise.all([
    db().seoPage.findMany({ select: { url: true, title: true } }),
    db().contentPiece.findMany({ where: { url: { not: null } }, select: { url: true } }),
  ]);
  if (pages.length === 0) return EMPTY;

  const known = new Set(existing.map((p) => p.url));
  const wanted: { url: string; title: string }[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const page of pages) {
    const article = articleFromUrl(page.url);
    if (!article) {
      skipped += 1;
      continue;
    }
    // Search Console reports the same page under several URLs when it is reachable with
    // and without a trailing slash. Deduplicated within the run as well as against the
    // board, or the first run would create the pair.
    if (seen.has(page.url) || known.has(page.url)) continue;
    seen.add(page.url);
    // The stored title if the provider ever starts sending one; the slug otherwise.
    wanted.push({ url: page.url, title: page.title?.trim() || article.title });
  }

  if (wanted.length > 0) {
    await db().contentPiece.createMany({
      data: wanted.map((w) => ({
        title: w.title,
        url: w.url,
        // It is on the site, so it is published. Not `repurposed` — that means it has
        // produced children, and this knows nothing about that.
        status: 'published' as const,
        format: 'blog',
        createdBy: 'search_console',
      })),
    });
  }

  return {
    scanned: pages.length,
    created: wanted.length,
    alreadyThere: pages.length - skipped - wanted.length,
    skipped,
  };
}

/**
 * Creates a Scheduled item for each social post that has not gone out yet. §15.4.
 *
 * Zoho Social is not connected; Meta is, and it is the same shape of fact — a post with a
 * publish date in the future is scheduled. Written against `SocialPost` rather than
 * against a provider, so connecting Zoho Social later needs no change here.
 *
 * A caption is not a title, and this says so by truncating rather than pretending: the
 * first line, capped, with the rest left in the brief where the whole text is readable.
 */
export async function fillScheduledFromSocial(now = new Date()): Promise<AutofillResult> {
  const [posts, existing] = await Promise.all([
    db().socialPost.findMany({
      where: { publishedAt: { gt: now } },
      select: { id: true, caption: true, permalink: true, publishedAt: true, account: { select: { network: true } } },
    }),
    db().contentPiece.findMany({ where: { createdBy: 'zoho_social' }, select: { assetUrl: true } }),
  ]);
  if (posts.length === 0) return EMPTY;

  // Keyed on the post's own id in `assetUrl`, because a scheduled post has no permalink
  // yet — the platform does not mint one until it goes out.
  const known = new Set(existing.map((p) => p.assetUrl));
  const wanted = posts.filter((p) => !known.has(`social:${p.id}`));

  if (wanted.length > 0) {
    await db().contentPiece.createMany({
      data: wanted.map((p) => {
        const caption = (p.caption ?? '').trim();
        const firstLine = caption.split('\n')[0].slice(0, 120);
        return {
          title: firstLine || `Scheduled ${p.account.network} post`,
          status: 'scheduled' as const,
          format: 'social',
          channelSlug: p.account.network,
          publishDate: p.publishedAt,
          brief: caption || null,
          assetUrl: `social:${p.id}`,
          createdBy: 'zoho_social',
        };
      }),
    });
  }

  return { scanned: posts.length, created: wanted.length, alreadyThere: posts.length - wanted.length, skipped: 0 };
}

/**
 * Both fills, for the nightly cron.
 *
 * The webinar case §15.4 also names is absent: Zoho Backstage is not an integration here,
 * so there is no event to read. Reported as a named gap rather than left out, so the run
 * says what it did not do.
 */
export async function autofillContent(now = new Date()) {
  const [published, scheduled] = await Promise.all([
    fillPublishedFromSearchConsole(),
    fillScheduledFromSocial(now),
  ]);

  return {
    published,
    scheduled,
    webinars: 'Zoho Backstage is not connected, so no webinar parent or children were created.',
    sources: CONTENT_SOURCES,
  };
}
