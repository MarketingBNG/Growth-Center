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
 * Delegates the whole decision to `leadSourceGroup`, whose keys ARE the channel slugs.
 * The two used to be separate near-copies of the same rules, and they drifted: the Leads
 * page called a lead Canada while the Marketing page filed its money under Meta Ads, and
 * Landing Page and Incorp existed on one page and not the other. One function now, so
 * they cannot disagree again.
 *
 * `sourceType` is only consulted when the CRM recorded no source at all — a lead created
 * in this app, or one of the 104 Zoho left blank.
 *
 * Null is a real answer and stays one: a source the mapping does not recognise reaches no
 * channel, because naming one would put invented attribution into every ROAS and
 * cost-per-lead figure on the Marketing page.
 */
export function channelSlugFor(sourceType: SourceType, sourceDetail?: string | null): string | null {
  const group = leadSourceGroup(sourceDetail);

  // Recognised, and the group name is the slug.
  if (group !== 'other' && group !== 'unattributed') return group;

  // `other` and `unattributed` both fall through to the enum, and it matters that `other`
  // does. The two functions were merged by having this one return null for anything the
  // group rules did not recognise, which quietly dropped the case where the CRM's string
  // is unfamiliar but the enum still knows what it is: "Trade Show" is an `event` and
  // "Web Download" a `website`, and both stopped reaching a channel at all. The group
  // rules are a superset of the old ones but not of leadSourceType's.
  //
  // Nothing is invented here — `import` and `manual` say the enum knows nothing either,
  // and they return null.
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
    case 'landing_page':
      return 'landing-page';
    case 'website':
    case 'form':
      return 'direct';
    default:
      return null;
  }
}

/**
 * Strips the "[MERGED]" tag Zoho prefixes onto the name of the record that survives a
 * duplicate merge. That tag is its own bookkeeping, written into the name field itself,
 * so the import copied it verbatim and eighteen people were called things like
 * "[MERGED] Arif Ibrahim" on screen and in search.
 *
 * Deliberately only this exact prefix. Square brackets appear legitimately in names here
 * — "Paramasivam [He/Him/His] PhD", "[AK] Anand", "Madiwalar [Target Leads Provider]" —
 * so a general bracket-stripping rule would eat real names to fix a Zoho artifact.
 *
 * Returns null for a name that was nothing but the tag, letting splitName fall through to
 * the next candidate rather than showing an empty name.
 */
export function cleanImportedName(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/^\s*\[merged\]\s*/i, '').trim();
  return cleaned || null;
}

/**
 * The lead source as Zoho actually named it, folded onto the names the team uses.
 *
 * Three vocabularies describe where a lead came from and none of them was the CRM's own:
 * `sourceType` is a shared enum that calls 17,989 of this account's leads `social`,
 * `channelSlugFor` is the business grouping the Marketing page reports against, and
 * `sourceDetail` is the only one Zoho wrote. The Leads page was showing the first — a
 * Source column reading "social" on twelve thousand rows the CRM had already told apart
 * as "ig", "fb" and "Incorporation LinkdIn".
 *
 * These are Zoho's 56 source strings, and the partition is exhaustive: every one of the
 * 27,401 leads lands in exactly one group, the 104 with no source included.
 *
 * The keys are channel slugs: `channelSlugFor` returns them verbatim, so the Source a
 * lead shows on the Leads page and the Channel its money is reported under on Marketing
 * are the same decision. `other` and `unattributed` are the two that reach no channel.
 *
 * Platform beats business line. "Incorporation Google Ads", "Hiring LinkedIn Ads" and
 * "Trademark_Meta" are Google, LinkedIn and Meta — the prefix names the campaign, not
 * the source, and there are five of those prefixes crossed with four platforms. Geography
 * does not: `canada` is tested first, because "Canada Meta Ads" is the only value that
 * carries a market and folding it into Meta Ads is what hid it.
 */
export const LEAD_SOURCES = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'google-ads', label: 'Google Ads' },
  { key: 'meta-ads', label: 'Meta Ads' },
  { key: 'canada', label: 'Canada' },
  { key: 'landing-page', label: 'Landing Page' },
  { key: 'incorp', label: 'Incorp' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'events', label: 'Events' },
  { key: 'referral', label: 'Referral' },
  { key: 'outreach', label: 'Outreach' },
  { key: 'email', label: 'Email' },
  { key: 'direct', label: 'Direct' },
  { key: 'other', label: 'Other' },
  { key: 'unattributed', label: 'Unattributed' },
] as const;

export type LeadSourceKey = (typeof LEAD_SOURCES)[number]['key'];

export const LEAD_SOURCE_KEYS = LEAD_SOURCES.map((s) => s.key) as unknown as [
  LeadSourceKey,
  ...LeadSourceKey[],
];

const LEAD_SOURCE_LABELS = new Map<LeadSourceKey, string>(
  LEAD_SOURCES.map((s) => [s.key, s.label]),
);

export function leadSourceGroup(sourceDetail: string | null | undefined): LeadSourceKey {
  // Underscores read as word separators, exactly as channelSlugFor treats them: the CRM
  // writes "Trademark_Meta".
  const v = (sourceDetail ?? '').trim().toLowerCase().replace(/_/g, ' ');
  // A lead the CRM recorded no source for is unattributed, and stays so. Guessing one
  // would put invented attribution into a column whose whole job is to say what Zoho said.
  if (!v) return 'unattributed';

  const word = (w: string) => new RegExp(String.raw`\b${w}\b`).test(v);

  // The market, before any platform. "Canada Meta Ads" is the only value naming one.
  if (v.includes('canada')) return 'canada';

  // Matched whole. `includes('ig')` would fire on "Landing Page" and `includes('fb')` on
  // anything with those letters adjacent.
  if (v === 'ig' || v.includes('instagram')) return 'instagram';
  if (v === 'fb' || v.includes('facebook')) return 'facebook';
  if (v.includes('whatsapp')) return 'whatsapp';
  // Misspelt as "LinkdIn" on 2,638 leads and "LinkediIn" on one, so the stem is matched
  // rather than either spelling. Before `incorp` below: "Incorporation LinkdIn" is
  // LinkedIn, and it is the third-largest source in the CRM.
  if (v.includes('linkedi') || v.includes('linkdin')) return 'linkedin';
  if (v.includes('google ad') || v.includes('adwords')) return 'google-ads';
  // Before landing-page, so "Meta - Landing Page" reads as the ad it is rather than the
  // page it points at — the same precedence leadSourceType applies.
  if (word('meta')) return 'meta-ads';

  // "Landing Page", "Trademark - Landingpage" and "Global Landing Page". Substring, not
  // a word: the CRM spells it both ways.
  if (v.includes('landing')) return 'landing-page';
  // Everything platform-led is already gone, so what is left is the incorporation
  // service itself: "BNG US Incorp".
  if (v.includes('incorp')) return 'incorp';

  // Anywhere the firm showed up at, in person or on a calendar.
  if (
    v.includes('calendly') ||
    v.includes('booking') ||
    v.includes('event') ||
    v.includes('expo') ||
    v.includes('summit') ||
    v.includes('conference') ||
    v.includes('webinar') ||
    v.includes('seminar')
  ) {
    return 'events';
  }

  // "Ref by AN", "Personal Ref", "Client Ref" — the word turns up at either end, and none
  // of them contain the double-r of "referral".
  if (word('ref') || v.includes('refer')) return 'referral';

  // Before the website test, which "Web Research" would otherwise satisfy: going looking
  // for a prospect is outreach. Smartlead is the cold-email tool.
  if (v.includes('research') || v.includes('smartlead') || word('call')) return 'outreach';
  if (v.includes('email')) return 'email';
  // The firm's own properties and its own show: "USAIndiaCFO Site", "NG Podcast". Direct
  // rather than a channel of their own, which is where the Marketing page has always
  // filed them.
  if (v.includes('site') || v.includes('website') || v.includes('podcast') || v.includes('desk')) {
    return 'direct';
  }

  // "Platform" and "Excel CRM" — three leads between them. Named rather than filed under
  // a channel nobody chose, so a source Zoho starts writing tomorrow shows up as
  // unrecognised instead of quietly joining Direct.
  return 'other';
}

/**
 * The group's display name, for the Source column and the filter.
 *
 * `sourceType` is the fallback for a lead with no CRM string at all — one created by the
 * New Lead button, or posted to /api/public/v1/leads by a website form, which defaults to
 * `form`. Only Zoho writes `sourceDetail`, so without this every lead this app creates
 * read "Unattributed" in the column while carrying a perfectly good channel underneath.
 *
 * `import` and `manual` stay "Unattributed": they are the enum's own words for not
 * knowing, and dressing them up as a source would be inventing one.
 */
export function leadSourceLabel(
  sourceDetail: string | null | undefined,
  sourceType?: SourceType | null,
): string {
  const group = leadSourceGroup(sourceDetail);
  if (group !== 'unattributed') return LEAD_SOURCE_LABELS.get(group)!;
  if (!sourceType || sourceType === 'import' || sourceType === 'manual') return 'Unattributed';
  return sourceType.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * The campaign a lead's CRM source names, or null.
 *
 * Zoho records no campaign: `Campaign_Source` is null on all 27,401 leads and every UTM
 * column is empty, so there is no id to join on and no honest way to link a lead to one of
 * the 44 Meta campaigns the ad account actually ran. Name-matching does not rescue it —
 * six campaigns say "Hiring", four say "Incorporation", and the largest lead campaign of
 * all (Trademark, 2,852 leads) runs on Google, which is not even connected.
 *
 * What the CRM DOES record is the business line, inside the source string itself:
 * "Trademark Google Ads", "Incorporation LinkdIn", "Canada Meta Ads". That is a campaign
 * at the granularity the team actually types, and it is theirs, not inferred — which is
 * why this reads only the words already in the string and returns null for the 19,753
 * leads whose source names no campaign at all.
 *
 * Deliberately NOT joined to Campaign/MarketingSpend. Spend belongs to a named ad
 * campaign and these are lines of business; multiplying one by the other would produce a
 * cost-per-lead nobody could defend.
 */
export const LEAD_CAMPAIGNS = [
  'Incorporation',
  'Trademark',
  'Canada',
  'Hiring',
  'VCFO',
  'IRS',
  'BTS Event',
  'Convergence India Expo 2026',
  'AI Impact Summit',
  'Ambiente & Biofach',
] as const;

export type LeadCampaign = (typeof LEAD_CAMPAIGNS)[number];

export function leadCampaign(sourceDetail: string | null | undefined): LeadCampaign | null {
  // Underscores as separators, as everywhere else here: "Trademark_Meta".
  const v = (sourceDetail ?? '').trim().toLowerCase().replace(/_/g, ' ');
  if (!v) return null;

  // The services the firm advertises.
  if (v.includes('incorp')) return 'Incorporation';
  if (v.includes('trademark')) return 'Trademark';
  // A market rather than a service, and the only one the CRM names. It reads as a
  // campaign here for the same reason it is its own channel: the team runs it as one.
  if (v.includes('canada')) return 'Canada';
  // Recruitment ads. Not a service the firm sells, which is exactly why separating them
  // matters — 208 leads that are job applicants, not prospects.
  if (v.includes('hiring')) return 'Hiring';
  if (v.includes('vcfo')) return 'VCFO';
  // Whole word: no other source contains it, and a substring rule would be waiting for
  // the first source that does.
  if (/\birs\b/.test(v)) return 'IRS';

  // The named events, each its own campaign. The CRM's own wording, tidied only where it
  // carries a prefix that is not part of the name.
  if (v.includes('convergence')) return 'Convergence India Expo 2026';
  if (v.includes('impact summit')) return 'AI Impact Summit';
  if (v.includes('ambiente') || v.includes('biofach')) return 'Ambiente & Biofach';
  if (/\bbts\b/.test(v)) return 'BTS Event';

  // "fb", "ig", "Landing Page", "Ref by NG" — a channel or a person, never a campaign.
  // Null rather than a guess: it is the honest answer for 19,753 of these leads.
  return null;
}
