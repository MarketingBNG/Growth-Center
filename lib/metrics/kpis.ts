/**
 * One KPI set per module screen.
 *
 * Split from core.ts because these compose rather than compute: each one picks the
 * figures its screen shows, asks for them over the current window and the one before, and
 * hands the pair to comparableDeltas. Nothing here queries anything core.ts does not
 * already expose, which is why the dependency runs one way and can stay that way.
 */
import { type Range } from '../range.ts';
import { db } from '../prisma.ts';
import { costPer } from '../calc.ts';
import { type Kpi } from '../kpi.ts';
import { windowFor } from './window.ts';
import {
  accountMetrics,
  budgetPacing,
  comparableDeltas,
  convertedLeads,
  customerShare,
  decidedDeals,
  duplicatesMerged,
  funnel,
  leadsByWeekday,
  medianResponseHours,
  openPipeline,
  siteMetrics,
  stageFlags,
  unassignedLeads,
} from './core.ts';


/**
 * Median lead quality in a period. §7.3.
 *
 * Median, not mean: 24,762 of 27,575 leads score under 35 because they arrived through a
 * chat thread that asked them nothing, and a mean over that tail moves with volume rather
 * than with quality — which is the opposite of what the score is for.
 *
 * Only leads the rules have actually scored. A row with a null `scoreVersion` carries the
 * column's placeholder 0, and folding those in would report a collapse in quality on the
 * day the feature shipped.
 */
async function medianLeadScore(range: Range): Promise<number | null> {
  const rows = await db().$queryRaw<{ median: number | null }[]>`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY score)::float AS median
      FROM lead
     WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
       AND "scoreVersion" IS NOT NULL`;
  const median = rows[0]?.median;
  return median === null || median === undefined ? null : Math.round(median);
}

/** Leads: New · Converted · Qualified · Cost per lead · Median response · Unassigned. */
export async function leadsKpis(spec: number | Range) {
  const { current, previous } = windowFor(spec);
  const [now, before, medianNow, medianBefore, unassignedNow, unassignedBefore, weekday, convNow, convBefore, medianScoreNow, medianScoreBefore] =
    await Promise.all([
      funnel(current),
      funnel(previous),
      medianResponseHours(current),
      medianResponseHours(previous),
      unassignedLeads(current),
      unassignedLeads(previous),
      leadsByWeekday(current),
      convertedLeads(current),
      convertedLeads(previous),
      medianLeadScore(current),
      medianLeadScore(previous),
    ]);

  const cards: Kpi[] = [
    { key: 'leads', label: 'New leads', value: now.leads, previous: before.leads, format: 'number', higherIsBetter: true },
    // Semi-qualified rather than qualified. This CRM stamps `qualifiedAt` only when a lead
    // converts — 1,028 leads carry one and 1,025 of those are converted — so a "Qualified"
    // card here printed the Converted card's number beside it, twice, in every period.
    // "Semi-Qualified Lead" is the stage this team actually works: 1,713 leads against 3.
    { key: 'semiQualified', label: 'Semi-qualified', value: now.semiQualified, previous: before.semiQualified, format: 'number', higherIsBetter: true, hint: 'Reached at least semi-qualified — the stage this CRM actually works' },
    { key: 'converted', label: 'Converted', value: convNow, previous: convBefore, format: 'number', higherIsBetter: true, hint: 'Counted on the day the CRM converted them' },
    // §7.1: the blended cost per lead used to sit here. It divided all paid spend by all
    // leads however they arrived — most of them referrals and inbound — so it read as the
    // price of a Meta lead and was not. "Nobody can buy blended." The per-channel figures
    // are on the Cost per lead by channel card below the table, where a channel's own
    // spend sits beside its own leads.
    //
    // Median rather than mean quality, and for the usual reason: 24,762 leads score under
    // 35 and 121 score above 60, so a mean is dragged by a long tail of leads that said
    // nothing about themselves.
    { key: 'quality', label: 'Median lead quality', value: medianScoreNow, previous: medianScoreBefore, format: 'number', higherIsBetter: true, hint: 'Deterministic 0–100 from source, company email, phone, segment and stated intent. Computed in code, never by the model.' },
    { key: 'response', label: 'Median response', value: medianNow, previous: medianBefore, format: 'duration', higherIsBetter: false, hint: 'First outbound touch; untouched leads excluded' },
    // Reads zero on this workspace and that is the truth, not a gap: the CRM assigns an
    // owner on creation, so all 27,256 imported leads have one. The hint says so rather
    // than leaving a permanent nought looking like a broken query.
    { key: 'unassigned', label: 'Unassigned', value: unassignedNow, previous: unassignedBefore, format: 'number', higherIsBetter: false, hint: 'Leads with no owner. The CRM assigns one on creation, so only leads added here can appear.' },
  ];

  return {
    cards: await comparableDeltas(cards, current, previous),
    current: now,
    weekday,
    qualificationRate: now.leadToSemiQualified,
  };
}

/** CRM: Companies · Contacts · Customers · Avg account value · Duplicates merged. */
export async function crmKpis(spec: number | Range) {
  const { current, previous } = windowFor(spec);
  const [now, before, dupNow, dupBefore, share, weekday] = await Promise.all([
    accountMetrics(current),
    accountMetrics(previous),
    duplicatesMerged(current),
    duplicatesMerged(previous),
    customerShare(),
    leadsByWeekday(current),
  ]);

  const cards: Kpi[] = [
    { key: 'companies', label: 'Companies', value: now.companies, previous: before.companies, format: 'number', higherIsBetter: true },
    { key: 'contacts', label: 'Contacts', value: now.contacts, previous: before.contacts, format: 'number', higherIsBetter: true },
    // "Customers" read as a subset of the Companies card beside it, and it is not: these
    // are the accounts WON in the window, and a company added in 2024 can be won today.
    // The card said 100 next to Companies 88 and looked like an arithmetic fault.
    { key: 'customers', label: 'Customers won', value: now.customers, previous: before.customers, format: 'number', higherIsBetter: true, hint: 'Accounts won in this period, whenever the company was first added' },
    { key: 'avgAccount', label: 'Avg account value', value: now.avgAccountValue, previous: before.avgAccountValue, format: 'money', currency: now.currency, higherIsBetter: true, hint: 'Averaged over accounts that billed this period' },
    // §8.1: "show candidates, never 0." A zero here used to mean "nothing is scanning",
    // and the hint now says which of the two it is — merged on arrival by the public
    // form, or merged by somebody working the queue.
    { key: 'duplicates', label: 'Duplicates merged', value: dupNow, previous: dupBefore, format: 'number', higherIsBetter: true, hint: 'Repeat submissions folded in on arrival, plus pairs merged from the duplicate queue' },
  ];

  return { cards: await comparableDeltas(cards, current, previous), customerShare: share, weekday };
}

/** Pipeline: Open deals · Total value · Weighted · Win rate · Avg cycle.
 *
 *  The first three are snapshots with no previous period — a pipeline is a standing
 *  balance, not a flow — so their delta renders as "No prior period" rather than a
 *  fabricated comparison. */
export async function pipelineKpis(spec: number | Range) {
  const { current, previous } = windowFor(spec);
  // One read per period rather than four: win rate and cycle come from the same set of
  // closed deals, and the stage flags they need are fetched once for both.
  const flags = await stageFlags();
  const [open, decidedNow, decidedPrev, weekday] = await Promise.all([
    openPipeline(),
    decidedDeals(current, flags),
    decidedDeals(previous, flags),
    leadsByWeekday(current),
  ]);
  const { winRate: rateNow, avgCycleDays: cycleNow } = decidedNow;
  const { winRate: ratePrev, avgCycleDays: cyclePrev } = decidedPrev;

  const cards: Kpi[] = [
    { key: 'openDeals', label: 'Open deals', value: open.count, previous: null, format: 'number', higherIsBetter: true, hint: 'Snapshot — ignores the date range' },
    { key: 'totalValue', label: 'Total value', value: open.total, previous: null, format: 'money', currency: open.currency, higherIsBetter: true, hint: 'Snapshot — ignores the date range' },
    // §9.5. Was value × the stage's probability, which never moved: a deal untouched
    // since November weighed exactly what it did the day it opened, and the figure was a
    // stage count wearing a forecast's clothes. Decayed, 810 of 967 open deals have gone
    // quiet long enough to lose value and the weighted total falls from ₹9.5m to ₹4.1m.
    { key: 'weighted', label: 'Weighted', value: open.weighted, previous: null, format: 'money', currency: open.currency, higherIsBetter: true, hint: 'Value × probability, reduced for silence: odds halve every 90 days a deal goes without activity, after a 30-day grace period, and never fall below a fifth of the stage figure.' },
    { key: 'winRate', label: 'Win rate', value: rateNow, previous: ratePrev, format: 'percent', higherIsBetter: true, hint: 'Won ÷ decided, over deals closed this period' },
    { key: 'cycle', label: 'Avg cycle', value: cycleNow, previous: cyclePrev, format: 'days', higherIsBetter: false, hint: 'Created to won, for deals won this period' },
  ];

  return { cards: await comparableDeltas(cards, current, previous), open, winRate: rateNow, weekday };
}

/** Marketing: Spend · Leads · CPL · ROAS · CAC. */
export async function marketingKpis(spec: number | Range, channelId?: string) {
  const { current, previous } = windowFor(spec);
  const [now, before, pacing, weekday] = await Promise.all([
    funnel(current, channelId),
    funnel(previous, channelId),
    budgetPacing(current, channelId),
    leadsByWeekday(current, channelId),
  ]);

  const cards: Kpi[] = [
    { key: 'spend', label: 'Spend', value: now.spend, previous: before.spend, format: 'money', currency: now.currency, higherIsBetter: false },
    { key: 'leads', label: 'Leads', value: now.leads, previous: before.leads, format: 'number', higherIsBetter: true },
    { key: 'cpl', label: 'CPL', value: costPer(now.spend, now.leads), previous: costPer(before.spend, before.leads), format: 'money', currency: now.currency, higherIsBetter: false },
    // Scoped to a channel these ARE that channel's own figures. Unfiltered they cover
    // every paid channel together, which is still a statement about ad spend rather than
    // about the whole business.
    {
      key: 'roas', label: 'ROAS', value: now.roas, previous: before.roas, format: 'ratio', higherIsBetter: true,
      hint: channelId
        ? 'This channel’s new business over its own spend'
        : 'New business booked against a paid channel, over all paid spend. Revenue that reached no channel is not a return on ad spend',
    },
    {
      key: 'cac', label: 'CAC', value: now.cac, previous: before.cac, format: 'money', currency: now.currency, higherIsBetter: false,
      hint: channelId
        ? 'This channel’s spend over the customers it brought'
        : 'All paid spend over the customers won through a paid channel. Customers who arrived another way are not counted against ad spend',
    },
  ];

  return { cards: await comparableDeltas(cards, current, previous), current: now, budgetPacing: pacing, weekday };
}

/** Analytics: Sessions · Visitor→lead · Lead→qualified · Opp→customer · Revenue. */
export async function analyticsKpis(spec: number | Range) {
  const { current, previous } = windowFor(spec);
  const [now, before, weekday] = await Promise.all([
    funnel(current),
    funnel(previous),
    leadsByWeekday(current),
  ]);

  // Pageviews and users were synced daily from GA4 and never read — the band showed
  // sessions alone while two of the three metrics the provider fetches sat unused.
  const [nowMetrics, beforeMetrics] = await Promise.all([
    siteMetrics(['pageviews', 'users'], current),
    siteMetrics(['pageviews', 'users'], previous),
  ]);
  const views = nowMetrics.pageviews;
  const viewsBefore = beforeMetrics.pageviews;
  const people = nowMetrics.users;
  const peopleBefore = beforeMetrics.users;

  const cards: Kpi[] = [
    { key: 'sessions', label: 'Sessions', value: now.visitors, previous: before.visitors, format: 'number', higherIsBetter: true },
    { key: 'users', label: 'Users', value: people, previous: peopleBefore, format: 'number', higherIsBetter: true },
    { key: 'pageviews', label: 'Pageviews', value: views, previous: viewsBefore, format: 'number', higherIsBetter: true },
    { key: 'visitorToLead', label: 'Visitor→lead', value: now.visitorToLead, previous: before.visitorToLead, format: 'percent', higherIsBetter: true },
    { key: 'leadToQualified', label: 'Lead→qualified', value: now.leadToQualified, previous: before.leadToQualified, format: 'percent', higherIsBetter: true },
    { key: 'oppToCustomer', label: 'Opp→customer', value: now.opportunityToCustomer, previous: before.opportunityToCustomer, format: 'percent', higherIsBetter: true },
    { key: 'revenue', label: 'Revenue', value: now.revenue, previous: before.revenue, format: 'money', currency: now.currency, higherIsBetter: true },
  ];

  return { cards: await comparableDeltas(cards, current, previous), current: now, weekday };
}
