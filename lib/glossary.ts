// Appendix C: what each word means in this application, and who decides.
//
// Pure, and importable from a client component — the page renders every field from here.
// The owner override is read and written in lib/settings.ts, for the reason lib/kpi.ts
// documents: a value import of a database-touching module from a client component
// follows the chain into the `pg` driver and breaks the build.
//
// ── Why this is not a copy of the manual's table ──────────────────────────────────────
//
// A glossary that restates the definitions the manual already carries is a second copy of
// a document, and the two drift. The useful thing is the definition the code *implements*,
// beside the manual's, with the difference said out loud — because every disagreement here
// is a figure two people read as the same number and mean differently.
//
// Eleven of the thirteen terms disagree with the manual or are not computed at all —
// eight where the code means something different, three where nothing computes it. Only
// "Lead" and "Insight" mean exactly what Appendix C says. That is the point of the page:
// a glossary that agreed with the manual on all thirteen would be telling the reader
// nothing they could not get from the manual.
//
// A term whose definition the code does not implement says so, and says why. It never
// carries a plausible-sounding definition nothing computes, which is the failure mode a
// glossary invites: the word gets used in a meeting on the strength of the entry.

/**
 * Whether the code's definition matches the manual's.
 *
 * `differs` is not a defect to be fixed on sight. Most of the differences here are the
 * code being right about this CRM and the manual being written from the vocabulary rather
 * than the data — there is no Deal_Type field, and qualifiedAt is stamped on conversion.
 * "Opportunity" is the one genuine disagreement about a rule rather than about the data.
 */
export type GlossaryAgreement = 'agrees' | 'differs' | 'not-computed';

export type GlossaryTerm = {
  slug: string;
  term: string;
  /** What this word means in the running application. */
  definition: string;
  /** Appendix C's wording, verbatim, so the two can be read against each other. */
  manual: string;
  agreement: GlossaryAgreement;
  /** Why they differ, or why nothing computes it. Absent when they agree. */
  note?: string;
  /** Where the definition is enforced, so the entry is checkable rather than asserted. */
  where?: string;
  /** Appendix C's "Owner of the definition". Overridable per term; see lib/settings.ts. */
  defaultOwner: string;
};

export const GLOSSARY: GlossaryTerm[] = [
  {
    slug: 'lead',
    term: 'Lead',
    definition:
      'Any hand-raise from any channel — one Lead row, however it arrived. 27,458 of them, and the count is never filtered by source.',
    manual: 'Any hand-raise from any channel',
    agreement: 'agrees',
    where: 'lib/metrics.ts — lead.count over the period',
    defaultOwner: 'Akshay',
  },
  {
    slug: 'qualified-lead',
    term: 'Qualified lead',
    definition:
      'Not reported. The CRM stamps qualifiedAt when a lead converts, not when a consultation is booked: 1,031 leads carry one and 1,028 of those are conversions. The dashboard reports Semi-qualified instead, which is the stage this team actually works.',
    manual: 'Consultation booked or partner call held — the CPQL numerator',
    agreement: 'differs',
    note:
      'The manual’s qualified event has no signal anywhere in the system. It arrives with Zoho Bookings and not before; until then a "Qualified" figure would be the Converted figure printed twice under two names, which is what it was.',
    where: 'lib/metrics.ts:1242 — the card comment records the counts',
    defaultOwner: 'Akshay',
  },
  {
    slug: 'semi-qualified',
    term: 'Semi-qualified',
    definition:
      'A lead that reached at least the CRM’s Semi-Qualified stage, or converted. 2,756 leads against the 3 the CRM calls qualified, which is why this is the figure on the card.',
    manual: 'A sales working stage. Not a marketing KPI',
    agreement: 'differs',
    note:
      'The manual rules it out as a marketing KPI and the application reports it anyway, deliberately: it is the only stage between "arrived" and "converted" that this CRM records. Labelled as the stage it is, not as qualification.',
    where: 'lib/metrics.ts:399',
    defaultOwner: 'Sales',
  },
  {
    slug: 'opportunity',
    term: 'Opportunity',
    definition:
      'Any deal created in the period — 8,072 in total, value or no value.',
    manual: 'A deal created with a value above zero',
    agreement: 'differs',
    note:
      'A real gap of 1,279 deals: 6,793 of the 8,072 carry a value above zero. Not silently narrowed to match the manual, because a deal with no value on it is usually a deal somebody has not finished writing rather than a deal that is not an opportunity, and dropping them would move the count without anybody being told.',
    where: 'lib/metrics.ts:403',
    defaultOwner: 'Akshay',
  },
  {
    slug: 'customer',
    term: 'Customer',
    definition:
      'A won deal, counted on the day it was won. 1,908 of them.',
    manual: 'Engagement letter signed or first invoice raised',
    agreement: 'differs',
    note:
      'The CRM records neither the engagement letter nor the invoice. Won is the closest event it stores, and it is the event the revenue entry is written from, so revenue and customer count agree with each other even where they both differ from the manual.',
    where: 'lib/metrics.ts:365 — customerWhere, on wonAt',
    defaultOwner: 'Akshay',
  },
  {
    slug: 'new-business',
    term: 'New business',
    definition:
      'An account’s first engagement, read from the deal-naming convention’s per-account counter — a deal numbered 1 is new, anything above it is repeat. Where the name carries no number, the account’s deal history answers instead, and the record says which of the two it was.',
    manual: 'Deal_Type = New Business. Excludes renewals, cross-sell and upsell',
    agreement: 'differs',
    note:
      'There is no Deal_Type field in this CRM. Reading it as the manual describes is what produced ₹277m of "new business" for twelve months when the real figure is ₹135m — the filter matched the whole book. The naming convention is where this organisation actually records it.',
    where: 'lib/deal-name.ts:101, lib/deal-origin.ts',
    defaultOwner: 'Akshay',
  },
  {
    slug: 'cpql',
    term: 'CPQL',
    definition:
      'Not reported, because it has no numerator: see Qualified lead. Cost per lead is reported instead, and is labelled blended — all paid spend over all leads however they arrived, most of them referrals and inbound.',
    manual: 'Acquisition spend (excluding hiring) ÷ qualified leads, by channel',
    agreement: 'not-computed',
    note:
      'Also blocked at the denominator: per-channel spend exists only for Meta, the one paid channel connected. An unlabelled blended CPL reads as the price of a Meta lead, which it is not, so the card says so.',
    where: 'lib/metrics.ts — the cpl card carries the hint',
    defaultOwner: 'Metrics layer',
  },
  {
    slug: 'attribution-health',
    term: 'Attribution health',
    definition:
      'The share of a period’s records that carry a channel, reported at three stages because they are in genuinely different health: leads 99.6%, deals 10.0%, revenue 10.2% over twelve months. Revenue is the one that gates a budget claim.',
    manual: '% of period leads carrying Channel and Campaign_ID',
    agreement: 'differs',
    note:
      'Campaign_ID is null on all 27,458 leads, so the manual’s definition would report 0% for ever and be read as a broken metric rather than a missing Zoho field. Leads alone would also read 99.6% and be mistaken for the health of the channel table, which is drawn from a tenth of the revenue.',
    where: 'lib/attribution.ts',
    defaultOwner: 'Metrics layer',
  },
  {
    slug: 'quality-score',
    term: 'Quality score',
    definition:
      'Not computed. Lead.score exists as a column and is 0 on all 27,458 rows; nothing in the codebase writes it.',
    manual:
      'Deterministic lead score from source tier, domain, phone, segment match and intent',
    agreement: 'not-computed',
    note:
      'The column being present and empty is worse than its being absent — it reads as a score of zero rather than as no score. Nothing displays it, and this entry exists so the word is not used in a meeting on the strength of the column.',
    defaultOwner: 'Metrics layer',
  },
  {
    slug: 'speed-to-lead',
    term: 'Speed to lead',
    definition:
      'The median time from a lead arriving to the first outbound touch logged against it. Untouched leads are excluded from the median and are not reported separately.',
    manual: 'Distribution of first-touch times, including untouched',
    agreement: 'differs',
    note:
      'A median, not a distribution, and the untouched are the half the manual most wants — they are the neglect. Including them in the median is not possible (they have no first touch), so they need their own figure, which does not exist yet.',
    where: 'lib/metrics.ts — the response card',
    defaultOwner: 'Metrics layer',
  },
  {
    slug: 'insight',
    term: 'Insight',
    definition:
      'A rule firing: a deterministic query, compared against a stored threshold, returning its figures as evidence, with a proposed action. The model writes only the title and two sentences and may not use a figure that is not in the evidence. Eleven of the manual’s twenty-five rules are live.',
    manual: 'A rule firing, with bound evidence and a proposed action',
    agreement: 'agrees',
    where: 'lib/insight-rules.ts, lib/ai.ts',
    defaultOwner: 'Growth Reviewer',
  },
  {
    slug: 'action-item',
    term: 'Action item',
    definition:
      'An insight assigned to an owner, in this application. A finding runs proposed → reviewed → assigned → in progress → done, and assigning without an owner is refused rather than defaulted.',
    manual: 'An approved insight with an owner, a due date and a Zoho Projects task',
    agreement: 'differs',
    note:
      'No due date and no Zoho Projects task: there is no Projects integration, so a task written here would exist nowhere the work is actually tracked. The owner and the state machine are real.',
    where: 'lib/insight-lifecycle.ts',
    defaultOwner: 'Shweta',
  },
  {
    slug: 'review-card',
    term: 'Review card',
    definition:
      'Not built. The nearest thing is the outreach linter, which attaches deterministic defects — placeholders, a missing subject, an unverified figure — to a sequence step, and outranks a signature: a template with placeholders in it cannot be signed.',
    manual: 'The pre-review output attached to an asset before approval',
    agreement: 'not-computed',
    note:
      'A pre-review of the manual’s kind needs a controlled corpus to check claims against, and there is none. The linter is the half that can be done without one, because it checks shape rather than truth.',
    where: 'lib/outreach-lint.ts',
    defaultOwner: 'Growth Reviewer',
  },
];

export const GLOSSARY_SLUGS = GLOSSARY.map((t) => t.slug);

export function isGlossarySlug(slug: unknown): slug is string {
  return typeof slug === 'string' && GLOSSARY_SLUGS.includes(slug);
}

/** The AppSetting key an owner override is stored under. */
export function ownerKey(slug: string): string {
  return `glossary.owner.${slug}`;
}

/**
 * An owner name, trimmed, or null to fall back to the default.
 *
 * Free text on purpose, and this is the one decision here worth defending. The obvious
 * shape is a picker over the accounts, and it would be wrong: the manual's owners are
 * Akshay, Shweta, Sales, Growth Reviewer and "Metrics layer", and only one of those is a
 * person who could ever hold an account. Two are roles and one is a layer of this codebase.
 * A picker would force every one of them to be misrepresented as a mailbox.
 */
export function parseOwner(value: unknown): string | null {
  const raw =
    typeof value === 'string' ? value : ((value as { owner?: unknown })?.owner as string | undefined);
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed ? trimmed.slice(0, 80) : null;
}

/** How many terms the code and the manual disagree about — the page's own headline. */
export function disagreementCount(terms: GlossaryTerm[] = GLOSSARY): number {
  return terms.filter((t) => t.agreement !== 'agrees').length;
}
