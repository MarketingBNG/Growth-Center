// Turning one CRM's vocabulary into this one's.
//
// Split out of service.ts because these are the only decisions in the CRM import that
// can be got wrong quietly — a mis-mapped stage moves money between pipeline columns and
// a mis-mapped status hides a live lead. Pure and import-free so tools/providers.test.ts
// can assert them without a database.

import type { LeadStatus, Priority, SourceType, TaskStatus } from '../generated/prisma/client.ts';

/**
 * Zoho's Lead_Status is free text configured per org, so anything unrecognised stays
 * `new` rather than being forced into a status nobody chose.
 *
 * Order matters: "Not Qualified" contains "qualified", so it has to be tested first.
 */
export function leadStatus(value: string | null | undefined): LeadStatus {
  const v = (value ?? '').toLowerCase();
  if (v.includes('convert')) return 'converted';
  // "Dead Lead" is this org's wording for a lead that went nowhere, and it is the single
  // most common status here — 22,554 leads read as untouched because nothing matched it.
  if (v.includes('lost') || v.includes('junk') || v.includes('dead')) return 'lost';
  // A job seeker is not a prospect. Unqualified rather than lost: nothing was lost.
  if (v.includes('not qualified') || v.includes('unqualified') || v.includes('looking for job')) {
    return 'unqualified';
  }
  // Before the plain `qualified` test, and for the same reason "Not Qualified" is:
  // "Semi-Qualified Lead" contains the word. It is this org's largest worked segment —
  // 2,480 leads against 10 that are fully qualified — so folding the two together made
  // "qualified" mean almost nothing.
  if (v.includes('semi') && v.includes('qualif')) return 'semi_qualified';
  if (v.includes('qualified')) return 'qualified';
  // "Not Contacted" says the opposite of what `includes('contact')` reads it as. Same
  // trap as "Not Qualified" above, and tested before the positive case for the same
  // reason — this CRM writes both spellings.
  if (v.includes('not contacted') || v.includes('uncontacted')) return 'new';
  // "Follow-up" and "Not Reachable" both describe an attempt that has already been made,
  // which is what `contacted` means. Left as `new` they made the funnel's first stage
  // look untouched.
  if (
    v.includes('contact') ||
    v.includes('attempted') ||
    v.includes('follow') ||
    v.includes('not reachable') ||
    v.includes('unreachable')
  ) {
    return 'contacted';
  }
  return 'new';
}

/**
 * Maps Zoho's Lead_Source onto SourceType.
 *
 * Written first against Zoho's stock source list, which this CRM does not use: 22,887 of
 * 26,151 leads landed in `import` and exactly one in `referral`, on an account whose
 * largest single source is a partner referral. The vocabulary here is the org's own —
 * "Ref by AN", "ig", "Canada Meta Ads", "Incorporation LinkdIn" — so the tests below are
 * the real values, not invented ones.
 *
 * `import` stays the default rather than a guess: the lead did arrive by import, and
 * naming a channel the CRM never named would put invented attribution into the funnel.
 */
export function leadSourceType(value: string | null | undefined): SourceType {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return 'import';

  // Two-letter source names, matched whole. `includes('fb')` would also fire on any word
  // containing those letters, and `includes('ig')` on "Landing Page".
  if (v === 'ig' || v === 'fb') return 'social';

  // Paid before landing: "Meta - Landing Page" is an ad that happens to point at one, and
  // the money spent is the more useful fact about it.
  if (
    // Anything Meta-branded is paid here: the organic Facebook and Instagram sources are
    // spelled "Facebook" and "ig", never "Meta".
    v.startsWith('meta') ||
    v.includes('meta ad') ||
    v.includes('google ad') ||
    v.includes('adwords') ||
    v.includes('ppc') ||
    v.includes('advertis') ||
    v.includes('paid')
  ) {
    return 'paid_ads';
  }

  // "Ref by AN", "Ref by NG", "Personal Ref", "Reference" — none of which contain the
  // double-r of "referral", which is why only one lead in the whole CRM was a referral.
  // `ref` rather than a prefix test: the word turns up at either end — "Ref by AN"
  // and "Personal Ref" are both referrals.
  if (/\bref\b/.test(v) || v.includes('refer') || v.includes('partner')) {
    return 'referral';
  }

  if (v.includes('landing')) return 'landing_page';

  // "Incorporation LinkdIn" is misspelled in the CRM and there are thousands of them.
  if (
    v.includes('instagram') ||
    v.includes('facebook') ||
    v.includes('linkedin') ||
    v.includes('linkdin') ||
    v.includes('twitter') ||
    v.includes('whatsapp') ||
    v.includes('social')
  ) {
    return 'social';
  }

  // A booked meeting is closer to an event than to a form: someone chose a time.
  if (
    v.includes('calendly') ||
    v.includes('booking') ||
    v.includes('seminar') ||
    v.includes('trade show') ||
    v.includes('event') ||
    v.includes('conference')
  ) {
    return 'event';
  }

  // Before the organic-search test, which "Web Research" would otherwise satisfy. Someone
  // going looking for a prospect is outreach; the prospect arriving via Google is not.
  if (v.includes('research') || v.includes('cold') || v.includes('outreach') || v.includes('call')) {
    return 'outreach';
  }
  if (v.includes('search') || v.includes('seo') || v.includes('organic')) return 'organic_search';
  // Whole word: "Platform" contains "form" and is not one.
  if (/\bform\b/.test(v)) return 'form';
  if (v.includes('web') || v.includes('chat') || v.includes('desk')) return 'website';
  return 'import';
}

export type StageLike = {
  id: string;
  name: string;
  position: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
};

/**
 * Picks the PipelineStage a Zoho deal belongs in.
 *
 * Stage names are each org's own, so an exact (case-insensitive) name match is the only
 * reliable mapping. Zoho's two built-in closed stages are recognised by name because they
 * are near-universal. Everything else unrecognised lands in the first open stage — never
 * in Won or Lost, because a guess there would move real money into closed-won revenue.
 */
export function matchStage(stages: StageLike[], zohoStage: string | null | undefined): StageLike | null {
  if (!stages.length) return null;

  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const v = (zohoStage ?? '').trim().toLowerCase();

  const exact = ordered.find((s) => s.name.toLowerCase() === v);
  if (exact) return exact;

  if (v.includes('closed won')) {
    const won = ordered.find((s) => s.isWon);
    if (won) return won;
  }
  if (v.includes('closed lost')) {
    const lost = ordered.find((s) => s.isLost);
    if (lost) return lost;
  }

  return ordered.find((s) => !s.isWon && !s.isLost) ?? ordered[0];
}

/**
 * Zoho's Task Status onto TaskStatus.
 *
 * "Deferred" and "Waiting for input" are still open work — nobody has done them and
 * nobody has called them off — so they stay `open` rather than being hidden as done.
 */
export function taskStatus(value: string | null | undefined): TaskStatus {
  const v = (value ?? '').toLowerCase();
  if (v.includes('complet')) return 'done';
  if (v.includes('cancel')) return 'cancelled';
  // "In Proress" is a real, misspelt status on nine tasks in this CRM. Matched rather
  // than left to fall through to `open`, which would have said nobody had started them.
  if (v.includes('progress') || v.includes('proress')) return 'in_progress';
  return 'open';
}

/**
 * Zoho's Task Priority onto Priority.
 *
 * Order matters: "Highest" and "Lowest" contain "high" and "low", so the extremes are
 * tested first or every Lowest task would arrive as low-but-not-lowest — and worse,
 * "Highest" would match the `high` test and lose its urgency.
 */
export function taskPriority(value: string | null | undefined): Priority {
  const v = (value ?? '').toLowerCase();
  if (v.includes('highest')) return 'urgent';
  if (v.includes('lowest')) return 'low';
  if (v.includes('high')) return 'high';
  if (v.includes('low')) return 'low';
  return 'normal';
}

/**
 * The channel slug a lead's source belongs to, or null.
 *
 * Matched on the CRM's own wording first, because SourceType cannot tell Instagram from
 * Facebook — it calls all of them `social`, which is 17,789 of this account's leads and
 * the single thing the Marketing page most needs to break apart.
 *
 * Null is a real answer and stays one: a lead the CRM recorded no source for is
 * unattributed, and naming a channel for it would put invented attribution into every
 * ROAS and cost-per-lead figure on the page.
 */
export function channelSlugFor(sourceType: SourceType, sourceDetail?: string | null): string | null {
  // Underscores read as word separators. The CRM writes "Trademark_Meta", and matching on
  // whole words is what keeps a rule for "meta" off "metallurgy".
  const v = (sourceDetail ?? '').trim().toLowerCase().replace(/_/g, ' ');
  const word = (w: string) => new RegExp(String.raw`\b${w}\b`).test(v);

  if (v) {
    // Paid first: "Meta Ads" is an ad, not organic Facebook.
    // `word('meta')` rather than startsWith: the campaign name is not always the prefix —
    // 44 leads came in under "Trademark_Meta" and reached no channel at all.
    if (word('meta') || v.includes('meta ad')) return 'meta-ads';
    if (v.includes('google ad') || v.includes('adwords')) return 'google-ads';

    if (v === 'ig' || v.includes('instagram')) return 'instagram';
    if (v === 'fb' || v.includes('facebook')) return 'facebook';
    if (v.includes('whatsapp')) return 'whatsapp';
    // Misspelt in this CRM as "LinkdIn" on thousands of leads and "LinkediIn" on one, so
    // the stem is matched rather than either spelling.
    if (v.includes('linkedi') || v.includes('linkdin')) return 'linkedin';

    // Anything the firm showed up at in person. Expos and summits were landing nowhere.
    if (
      v.includes('calendly') ||
      v.includes('booking') ||
      v.includes('expo') ||
      v.includes('summit') ||
      v.includes('conference') ||
      v.includes('webinar')
    ) {
      return 'events';
    }
    // Smartlead is the cold-email tool, so a lead credited to it came from outreach.
    if (v.includes('smartlead') || v.includes('call') || v.includes('research')) return 'outreach';
    if (v.includes('email')) return 'email';
    // The firm's own web properties, and the firm's own brands. "BNG US Incorp" is the
    // incorporation service and "NG Podcast" is the firm's own show — 957 leads between
    // them that reached no channel at all, because neither name contains any word the
    // rules above look for.
    if (
      v.includes('site') ||
      v.includes('website') ||
      v.includes('incorp') ||
      v.includes('podcast')
    ) {
      return 'direct';
    }
  }

  switch (sourceType) {
    case 'paid_ads':
      return 'meta-ads';
    case 'organic_search':
      return 'organic-search';
    case 'referral':
      return 'referral';
    case 'event':
      return 'events';
    case 'outreach':
      return 'outreach';
    case 'website':
    case 'landing_page':
    case 'form':
      return 'direct';
    default:
      return null;
  }
}
