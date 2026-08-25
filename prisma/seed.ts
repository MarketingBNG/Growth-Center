// Demo dataset for Growth Center.
//
// Everything here is generated from one seeded PRNG, so two runs produce identical
// data and a number that looks wrong can be reproduced. Nothing is random at read
// time.
//
// The hard requirement is internal consistency: revenue rows are generated FROM won
// opportunities, and won opportunities FROM converted leads, so the dashboard funnel,
// the pipeline board, the company pages and the marketing ROAS all agree. Numbers
// invented per-page would not.
//
// Integrations are seeded as `demo_data` or `disconnected` — never `connected`. There
// is no credential behind them and the UI must not imply there is.

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../lib/generated/prisma/client.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Add it to .env.local first.');
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

// mulberry32 — small, fast, and identical across runs.
let state = 20260825;
function rnd(): number {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;

const MONTHS = 12;
const today = new Date('2026-08-25T00:00:00Z');

function dayOffset(days: number): Date {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const OWNERS = [
  'shweta@usaindiacfo.com',
  'dakshita@usaindiacfo.com',
  'tanisha.murkya@usaindiacfo.com',
];

const CHANNELS = [
  { name: 'Organic Search', slug: 'organic-search', kind: 'organic' },
  { name: 'Google Ads', slug: 'google-ads', kind: 'paid' },
  { name: 'Meta Ads', slug: 'meta-ads', kind: 'paid' },
  { name: 'LinkedIn', slug: 'linkedin', kind: 'social' },
  { name: 'Referral', slug: 'referral', kind: 'referral' },
  { name: 'Email', slug: 'email', kind: 'email' },
  { name: 'Direct', slug: 'direct', kind: 'direct' },
];

// Each campaign carries the cost-per-click and lead rate that generate its spend rows,
// so ROAS differences between channels are a property of the data, not a fudge.
const CAMPAIGNS = [
  { name: 'Outsourced CFO — Search', channel: 'google-ads', cpc: 8.4, dailyClicks: [18, 46], leadRate: 0.055, source: 'google_ads' },
  { name: 'Bookkeeping for US SMBs', channel: 'google-ads', cpc: 5.1, dailyClicks: [22, 60], leadRate: 0.041, source: 'google_ads' },
  { name: 'CFO Services Retargeting', channel: 'meta-ads', cpc: 2.3, dailyClicks: [40, 120], leadRate: 0.016, source: 'meta_ads' },
  { name: 'Founder Finance Guide', channel: 'meta-ads', cpc: 1.7, dailyClicks: [60, 180], leadRate: 0.021, source: 'meta_ads' },
  { name: 'LinkedIn ABM — Series A', channel: 'linkedin', cpc: 14.2, dailyClicks: [6, 20], leadRate: 0.072, source: 'linkedin' },
  { name: 'Tax Season Content Push', channel: 'organic-search', cpc: 0, dailyClicks: [80, 240], leadRate: 0.014, source: null },
  { name: 'Partner Referral Programme', channel: 'referral', cpc: 0, dailyClicks: [4, 14], leadRate: 0.19, source: null },
  { name: 'Monthly CFO Digest', channel: 'email', cpc: 0, dailyClicks: [30, 90], leadRate: 0.028, source: null },
];

const STAGES = [
  { name: 'Discovery', probability: 15 },
  { name: 'Scoping', probability: 35 },
  { name: 'Proposal', probability: 60 },
  { name: 'Negotiation', probability: 80 },
  { name: 'Won', probability: 100, isWon: true },
  { name: 'Lost', probability: 0, isLost: true },
];

const COMPANY_NAMES = [
  ['Northwind Logistics', 'northwindlogistics.com', 'Logistics', 'United States'],
  ['Verity Health', 'verityhealth.io', 'Healthcare', 'United States'],
  ['Bluepeak Robotics', 'bluepeakrobotics.com', 'Manufacturing', 'United States'],
  ['Halcyon Interactive', 'halcyoninteractive.com', 'Media', 'United Kingdom'],
  ['Stonebridge Capital', 'stonebridgecap.com', 'Financial Services', 'United States'],
  ['Larkspur Foods', 'larkspurfoods.com', 'Consumer Goods', 'United States'],
  ['Meridian Labs', 'meridianlabs.ai', 'Software', 'United States'],
  ['Cobalt Freight', 'cobaltfreight.com', 'Logistics', 'Canada'],
  ['Aster Biotech', 'asterbiotech.com', 'Biotech', 'United States'],
  ['Kestrel Energy', 'kestrelenergy.com', 'Energy', 'United States'],
  ['Fernbrook Retail', 'fernbrookretail.com', 'Retail', 'United States'],
  ['Sightline Analytics', 'sightlineanalytics.com', 'Software', 'India'],
  ['Junipero Construction', 'juniperoconstruction.com', 'Construction', 'United States'],
  ['Palewater Ventures', 'palewaterventures.com', 'Financial Services', 'Singapore'],
  ['Orchard & Vine', 'orchardandvine.com', 'Hospitality', 'United States'],
  ['Tidewater Marine', 'tidewatermarine.com', 'Marine', 'United States'],
  ['Grayling Software', 'graylingsoftware.com', 'Software', 'United Kingdom'],
  ['Windrow Agritech', 'windrowagritech.com', 'Agriculture', 'United States'],
  ['Copperline Mining', 'copperlinemining.com', 'Mining', 'Australia'],
  ['Ashgrove Education', 'ashgroveedu.org', 'Education', 'United States'],
  ['Belmont Dental Group', 'belmontdental.com', 'Healthcare', 'United States'],
  ['Riverbend Insurance', 'riverbendins.com', 'Insurance', 'United States'],
  ['Quillon Legal', 'quillonlegal.com', 'Legal', 'United States'],
  ['Sandpiper Travel', 'sandpipertravel.com', 'Travel', 'United States'],
] as const;

const FIRST = ['Alice', 'Marcus', 'Priya', 'Daniel', 'Rachel', 'Tom', 'Nadia', 'Owen', 'Grace', 'Victor',
  'Elena', 'Samuel', 'Farrah', 'Ian', 'Beatrice', 'Hugo', 'Lena', 'Ravi', 'Claire', 'Jonas',
  'Maya', 'Peter', 'Sofia', 'Andre', 'Nina', 'Colin', 'Talia', 'Dev', 'Rosa', 'Miles'];
const LAST = ['Okafor', 'Whitfield', 'Raman', 'Brennan', 'Sokolov', 'Larsen', 'Haddad', 'Pierce',
  'Nakamura', 'Alvarez', 'Petrova', 'Osei', 'Lindqvist', 'Moreau', 'Vance', 'Castellanos',
  'Bhatt', 'Ferreira', 'Donnelly', 'Kowalski'];

const TITLES = ['CEO', 'Founder', 'CFO', 'COO', 'VP Finance', 'Head of Finance', 'Controller',
  'Director of Operations', 'Managing Partner'];

async function wipe() {
  // Child rows first — the schema cascades, but being explicit keeps the order obvious.
  await db.outreachMessage.deleteMany();
  await db.prospect.deleteMany();
  await db.sequenceStep.deleteMany();
  await db.sequence.deleteMany();
  await db.socialPost.deleteMany();
  await db.socialAccount.deleteMany();
  await db.seoKeywordRanking.deleteMany();
  await db.seoKeyword.deleteMany();
  await db.seoPage.deleteMany();
  await db.website.deleteMany();
  await db.contentPiece.deleteMany();
  await db.aiInsight.deleteMany();
  await db.notification.deleteMany();
  await db.auditEvent.deleteMany();
  await db.metricSnapshot.deleteMany();
  await db.integrationCredential.deleteMany();
  await db.integration.deleteMany();
  await db.apiKey.deleteMany();
  await db.activity.deleteMany();
  await db.note.deleteMany();
  await db.task.deleteMany();
  await db.revenueEntry.deleteMany();
  await db.customer.deleteMany();
  await db.opportunity.deleteMany();
  await db.lead.deleteMany();
  await db.pipelineStage.deleteMany();
  await db.pipeline.deleteMany();
  await db.marketingSpend.deleteMany();
  await db.campaign.deleteMany();
  await db.contact.deleteMany();
  await db.company.deleteMany();
  await db.channel.deleteMany();
}

async function main() {
  console.log('Clearing existing rows…');
  await wipe();

  console.log('Channels and campaigns…');
  const channels = new Map<string, string>();
  for (const c of CHANNELS) {
    const row = await db.channel.create({ data: c, select: { id: true } });
    channels.set(c.slug, row.id);
  }

  const campaigns: { id: string; name: string; channelId: string; leadRate: number }[] = [];
  for (const c of CAMPAIGNS) {
    const row = await db.campaign.create({
      data: {
        name: c.name,
        channelId: channels.get(c.channel)!,
        status: 'active',
        startDate: dayOffset(MONTHS * 30),
        budget: c.cpc > 0 ? int(15000, 60000) : null,
        source: c.source,
        externalId: c.source ? `demo-${c.channel}-${campaigns.length + 1}` : null,
      },
      select: { id: true },
    });
    campaigns.push({ id: row.id, name: c.name, channelId: channels.get(c.channel)!, leadRate: c.leadRate });

    // Daily spend for paid campaigns; organic/email/referral get clicks with no cost.
    const spend: { campaignId: string; date: Date; amount: number; impressions: number; clicks: number }[] = [];
    for (let d = MONTHS * 30; d >= 0; d--) {
      const clicks = int(c.dailyClicks[0], c.dailyClicks[1]);
      const impressions = clicks * int(18, 45);
      spend.push({
        campaignId: row.id,
        date: dayOffset(d),
        amount: Number((clicks * c.cpc).toFixed(2)),
        impressions,
        clicks,
      });
    }
    await db.marketingSpend.createMany({ data: spend });
  }

  console.log('Pipeline…');
  const pipeline = await db.pipeline.create({
    data: { name: 'New Business', isDefault: true },
    select: { id: true },
  });
  const stages: { id: string; name: string; probability: number; isWon: boolean; isLost: boolean }[] = [];
  for (const [i, s] of STAGES.entries()) {
    const row = await db.pipelineStage.create({
      data: {
        pipelineId: pipeline.id,
        name: s.name,
        position: i,
        probability: s.probability,
        isWon: !!s.isWon,
        isLost: !!s.isLost,
      },
    });
    stages.push({ id: row.id, name: row.name, probability: row.probability, isWon: row.isWon, isLost: row.isLost });
  }
  const wonStage = stages.find((s) => s.isWon)!;
  const lostStage = stages.find((s) => s.isLost)!;
  const openStages = stages.filter((s) => !s.isWon && !s.isLost);

  console.log('Companies and contacts…');
  const companies: { id: string; name: string; domain: string }[] = [];
  for (const [name, domain, industry, country] of COMPANY_NAMES) {
    const row = await db.company.create({
      data: {
        name,
        domain,
        industry,
        country,
        size: pick(['1-10', '11-50', '51-200', '201-500']),
        website: `https://${domain}`,
        ownerEmail: pick(OWNERS),
        tags: chance(0.3) ? [pick(['inbound', 'enterprise', 'smb', 'referral-source'])] : [],
      },
      select: { id: true, name: true, domain: true },
    });
    companies.push({ id: row.id, name: row.name, domain: row.domain! });
  }

  const contacts: { id: string; companyId: string; name: string; email: string }[] = [];
  for (const company of companies) {
    for (let i = 0; i < int(1, 3); i++) {
      const first = pick(FIRST);
      const last = pick(LAST);
      const email = `${first.toLowerCase()}.${last.toLowerCase()}@${company.domain}`;
      if (contacts.some((c) => c.email === email)) continue;
      const row = await db.contact.create({
        data: {
          firstName: first,
          lastName: last,
          email,
          phone: `+1 ${int(200, 989)} ${int(200, 999)} ${int(1000, 9999)}`,
          title: pick(TITLES),
          companyId: company.id,
          ownerEmail: pick(OWNERS),
        },
        select: { id: true },
      });
      contacts.push({ id: row.id, companyId: company.id, name: `${first} ${last}`, email });
    }
  }

  console.log('Leads…');
  // Lead volume grows month over month so the trend charts show a real direction.
  type SeededLead = { id: string; companyId: string | null; contactId: string | null; campaignId: string; channelId: string; status: string; createdAt: Date };
  const leads: SeededLead[] = [];

  for (let month = MONTHS - 1; month >= 0; month--) {
    const growth = 1 + (MONTHS - 1 - month) * 0.06;
    const count = Math.round(int(26, 34) * growth);

    for (let i = 0; i < count; i++) {
      const campaign = pick(campaigns);
      const daysAgo = month * 30 + int(0, 29);
      const createdAt = dayOffset(daysAgo);

      // Two thirds of leads belong to a known company (so the CRM has depth); the rest
      // are fresh names that only exist as leads.
      const known = chance(0.65);
      const company = known ? pick(companies) : null;
      const contact = company ? contacts.find((c) => c.companyId === company.id) ?? null : null;

      const first = contact ? contact.name.split(' ')[0] : pick(FIRST);
      const last = contact ? contact.name.split(' ')[1] : pick(LAST);
      const email = contact
        ? contact.email
        : `${first.toLowerCase()}.${last.toLowerCase()}${int(1, 99)}@${pick(['gmail.com', 'outlook.com', 'proton.me'])}`;

      // Older leads have had time to progress; recent ones are mostly still new.
      const maturity = daysAgo / (MONTHS * 30);
      let status: string;
      if (chance(0.10)) status = 'unqualified';
      else if (chance(0.08)) status = 'lost';
      else if (maturity > 0.25 && chance(0.22)) status = 'converted';
      else if (maturity > 0.15 && chance(0.30)) status = 'qualified';
      else if (chance(0.45)) status = 'contacted';
      else status = 'new';

      const utmMedium = campaign.leadRate > 0.05 ? 'cpc' : pick(['cpc', 'organic', 'email', 'referral']);

      const lead = await db.lead.create({
        data: {
          firstName: first,
          lastName: last,
          email,
          phone: chance(0.6) ? `+1 ${int(200, 989)} ${int(200, 999)} ${int(1000, 9999)}` : null,
          companyName: company?.name ?? null,
          title: chance(0.7) ? pick(TITLES) : null,
          message: chance(0.4)
            ? pick([
                'We need help closing our books monthly and preparing investor reporting.',
                'Looking for an outsourced CFO ahead of a Series A raise.',
                'Our bookkeeping is six months behind. Can you help?',
                'Interested in a quote for controller services.',
                'Referred by our attorney. Want to discuss cash flow forecasting.',
              ])
            : null,
          status: status as never,
          sourceType: pick(['website', 'form', 'paid_ads', 'organic_search', 'social', 'referral', 'landing_page']) as never,
          ownerEmail: chance(0.9) ? pick(OWNERS) : null,
          score: int(10, 95),
          campaignId: campaign.id,
          channelId: campaign.channelId,
          utmSource: campaign.name.toLowerCase().includes('meta') ? 'facebook' : pick(['google', 'linkedin', 'newsletter', 'partner']),
          utmMedium,
          utmCampaign: campaign.name.toLowerCase().replaceAll(' ', '-'),
          landingPage: pick(['/outsourced-cfo', '/bookkeeping', '/pricing', '/contact', '/guides/founder-finance']),
          referrer: chance(0.5) ? pick(['https://www.google.com/', 'https://www.linkedin.com/', 'https://news.ycombinator.com/']) : null,
          companyId: company?.id ?? null,
          contactId: contact?.id ?? null,
          qualifiedAt: ['qualified', 'converted'].includes(status) ? dayOffset(Math.max(0, daysAgo - int(1, 6))) : null,
          convertedAt: status === 'converted' ? dayOffset(Math.max(0, daysAgo - int(4, 20))) : null,
          createdAt,
          updatedAt: createdAt,
        },
        select: { id: true, companyId: true, contactId: true, createdAt: true },
      });

      leads.push({
        id: lead.id,
        companyId: lead.companyId,
        contactId: lead.contactId,
        campaignId: campaign.id,
        channelId: campaign.channelId,
        status,
        createdAt: lead.createdAt,
      });

      await db.activity.create({
        data: {
          type: 'created',
          summary: 'Lead created from website form',
          actorEmail: null,
          detail: { seeded: true },
          leadId: lead.id,
          createdAt,
        },
      });
    }
  }
  console.log(`  ${leads.length} leads`);

  console.log('Opportunities, customers and revenue…');
  // Every opportunity comes from a converted or qualified lead, so the funnel counts
  // line up with the pipeline board.
  const convertible = leads.filter(
    (l) => (l.status === 'converted' || l.status === 'qualified') && l.companyId,
  );
  let wonCount = 0;

  for (const lead of convertible) {
    const isConverted = lead.status === 'converted';
    const value = int(12, 140) * 1000;
    const daysOld = Math.round((today.getTime() - lead.createdAt.getTime()) / 86400000);

    // Converted leads either won, lost, or are still working. Qualified leads that got
    // an opportunity are always still open.
    let stage = pick(openStages);
    let closedAt: Date | null = null;
    if (isConverted) {
      const roll = rnd();
      if (roll < 0.42) {
        stage = wonStage;
        closedAt = dayOffset(Math.max(0, daysOld - int(10, 45)));
      } else if (roll < 0.62) {
        stage = lostStage;
        closedAt = dayOffset(Math.max(0, daysOld - int(10, 50)));
      }
    }

    const createdAt = dayOffset(Math.max(0, daysOld - int(2, 10)));
    const company = lead.companyId ? companies.find((c) => c.id === lead.companyId) : null;

    const opp = await db.opportunity.create({
      data: {
        name: `${company?.name ?? 'New prospect'} — ${pick(['CFO retainer', 'Bookkeeping', 'Controller services', 'Financial cleanup', 'Advisory engagement'])}`,
        pipelineId: pipeline.id,
        stageId: stage.id,
        value,
        probability: stage.probability,
        expectedCloseDate: dayOffset(-int(5, 70)),
        closedAt,
        ownerEmail: pick(OWNERS),
        leadId: lead.id,
        contactId: lead.contactId,
        companyId: lead.companyId,
        campaignId: lead.campaignId,
        lostReason: stage.isLost ? pick(['Price', 'Went in-house', 'No decision', 'Chose competitor']) : null,
        createdAt,
        updatedAt: closedAt ?? createdAt,
      },
      select: { id: true },
    });

    await db.activity.create({
      data: {
        type: 'created',
        summary: 'Created from lead',
        actorEmail: null,
        opportunityId: opp.id,
        createdAt,
      },
    });

    if (!stage.isWon) continue;
    wonCount++;

    const wonAt = closedAt!;
    const customer = await db.customer.upsert({
      where: { companyId: lead.companyId! },
      create: { companyId: lead.companyId!, opportunityId: opp.id, wonAt },
      update: {},
      select: { id: true, wonAt: true },
    });

    // The won deal value, then monthly recurring revenue from the win date onward.
    // This is why company revenue, dashboard revenue and campaign ROAS all agree:
    // there is exactly one generator.
    await db.revenueEntry.create({
      data: {
        customerId: customer.id,
        date: wonAt,
        amount: value,
        kind: 'one_time',
        opportunityId: opp.id,
        campaignId: lead.campaignId,
        channelId: lead.channelId,
      },
    });

    const monthly = Math.round(value / int(8, 16));
    const monthsSinceWin = Math.floor((today.getTime() - wonAt.getTime()) / (30 * 86400000));
    for (let m = 1; m <= Math.min(monthsSinceWin, 11); m++) {
      const d = new Date(wonAt);
      d.setUTCMonth(d.getUTCMonth() + m);
      if (d > today) break;
      await db.revenueEntry.create({
        data: {
          customerId: customer.id,
          date: d,
          amount: monthly,
          kind: 'recurring',
          opportunityId: opp.id,
          campaignId: lead.campaignId,
          channelId: lead.channelId,
        },
      });
    }
  }
  console.log(`  ${convertible.length} opportunities, ${wonCount} won`);

  console.log('Traffic metrics…');
  // Site sessions per day, the top of the funnel. Weekends dip, and the trend rises
  // in step with lead volume so the funnel's conversion rate stays believable.
  const snapshots: { source: string; entityType: string; entityId: string; metricKey: string; date: Date; value: number }[] = [];
  for (let d = MONTHS * 30; d >= 0; d--) {
    const date = dayOffset(d);
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    const growth = 1 + (MONTHS * 30 - d) * 0.0011;
    const sessions = Math.round(int(380, 520) * growth * (weekend ? 0.55 : 1));

    snapshots.push(
      { source: 'demo', entityType: 'site', entityId: '', metricKey: 'sessions', date, value: sessions },
      { source: 'demo', entityType: 'site', entityId: '', metricKey: 'users', date, value: Math.round(sessions * 0.82) },
      { source: 'demo', entityType: 'site', entityId: '', metricKey: 'pageviews', date, value: Math.round(sessions * int(2, 4)) },
      { source: 'demo', entityType: 'site', entityId: '', metricKey: 'bounce_rate', date, value: Number((int(38, 62) + rnd()).toFixed(2)) },
    );
  }
  for (let i = 0; i < snapshots.length; i += 1000) {
    await db.metricSnapshot.createMany({ data: snapshots.slice(i, i + 1000), skipDuplicates: true });
  }
  console.log(`  ${snapshots.length} metric snapshots`);

  console.log('SEO…');
  const website = await db.website.create({
    data: { domain: 'usaindiacfo.com', name: 'USAIndiaCFO' },
    select: { id: true },
  });
  const KEYWORDS = [
    'outsourced cfo services', 'virtual cfo for startups', 'bookkeeping services for small business',
    'fractional cfo cost', 'controller services usa', 'startup financial modeling',
    'monthly close checklist', 'cfo services for ecommerce', 'india based accounting team',
    'accounts payable outsourcing', 'cash flow forecasting service', 'series a financial due diligence',
  ];
  for (const keyword of KEYWORDS) {
    const kw = await db.seoKeyword.create({
      data: {
        websiteId: website.id,
        keyword,
        searchVolume: int(120, 4800),
        difficulty: int(18, 78),
        cpc: Number((rnd() * 22 + 2).toFixed(2)),
        intent: pick(['informational', 'commercial', 'transactional']),
      },
      select: { id: true },
    });

    // A slow drift rather than noise, so the ranking chart shows a trajectory.
    let position = int(8, 60);
    const rankings: { keywordId: string; date: Date; position: number }[] = [];
    for (let week = 25; week >= 0; week--) {
      position = Math.max(1, Math.min(100, position + int(-3, 2)));
      rankings.push({ keywordId: kw.id, date: dayOffset(week * 7), position });
    }
    await db.seoKeywordRanking.createMany({ data: rankings, skipDuplicates: true });
  }

  const PAGES = ['/outsourced-cfo', '/bookkeeping', '/pricing', '/guides/founder-finance', '/about',
    '/contact', '/blog/monthly-close', '/blog/fractional-cfo-vs-full-time'];
  for (const url of PAGES) {
    const impressions = int(900, 22000);
    const clicks = Math.round(impressions * (rnd() * 0.06 + 0.005));
    await db.seoPage.create({
      data: {
        websiteId: website.id,
        url,
        title: url.replace(/[/-]/g, ' ').trim() || 'Home',
        clicks,
        impressions,
        ctr: Number(((clicks / impressions) * 100).toFixed(2)),
        avgPosition: Number((rnd() * 30 + 3).toFixed(1)),
        issues: chance(0.4)
          ? [{ code: pick(['missing-meta-description', 'slow-lcp', 'thin-content', 'no-h1']), severity: pick(['low', 'medium', 'high']), message: 'Detected by the demo dataset, not a live crawl.' }]
          : [],
      },
    });
  }

  console.log('Social…');
  const SOCIAL = [
    { network: 'linkedin', handle: 'usaindiacfo', followers: 8420 },
    { network: 'instagram', handle: 'usaindiacfo', followers: 3110 },
    { network: 'facebook', handle: 'usaindiacfo', followers: 1980 },
    { network: 'x', handle: 'usaindiacfo', followers: 1240 },
  ] as const;
  for (const account of SOCIAL) {
    const row = await db.socialAccount.create({
      data: { network: account.network as never, handle: account.handle, name: 'USAIndiaCFO', followers: account.followers },
      select: { id: true },
    });
    const posts = [];
    for (let i = 0; i < 18; i++) {
      const reach = int(400, 9000);
      posts.push({
        accountId: row.id,
        externalId: `demo-${account.network}-${i}`,
        publishedAt: dayOffset(int(1, 180)),
        caption: pick([
          'Three signs your startup has outgrown its bookkeeper.',
          'What a monthly close should actually look like.',
          'Fractional CFO vs full-time: the real cost comparison.',
          'How we cut one client\'s close from 21 days to 5.',
        ]),
        reach,
        impressions: Math.round(reach * (1 + rnd())),
        likes: Math.round(reach * (rnd() * 0.05)),
        comments: int(0, 24),
        shares: int(0, 18),
        clicks: Math.round(reach * (rnd() * 0.03)),
      });
    }
    await db.socialPost.createMany({ data: posts, skipDuplicates: true });
  }

  console.log('Content, outreach, tasks…');
  for (let i = 0; i < 22; i++) {
    const status = pick(['idea', 'planned', 'draft', 'review', 'published', 'published', 'archived']);
    const published = status === 'published';
    await db.contentPiece.create({
      data: {
        title: pick([
          'The founder\'s guide to monthly close',
          'When to hire your first finance leader',
          'Cash flow forecasting for seasonal businesses',
          'What investors actually read in your reporting pack',
          'Bookkeeping cleanup: a 30-day plan',
          'Fractional CFO pricing, explained',
          'Revenue recognition for SaaS founders',
          'Building a board reporting rhythm',
        ]) + (i > 7 ? ` (part ${i - 6})` : ''),
        status: status as never,
        format: pick(['blog', 'video', 'social', 'email', 'case_study']),
        authorEmail: pick(OWNERS),
        channelSlug: pick(['organic-search', 'email', 'linkedin']),
        campaignId: chance(0.6) ? pick(campaigns).id : null,
        brief: 'Seeded content record.',
        url: published ? `https://usaindiacfo.com/blog/post-${i + 1}` : null,
        publishDate: published ? dayOffset(int(5, 300)) : chance(0.5) ? dayOffset(-int(3, 40)) : null,
        views: published ? int(120, 9400) : 0,
        leadsGenerated: published ? int(0, 26) : 0,
      },
    });
  }

  const sequence = await db.sequence.create({
    data: { name: 'Series A founders — Q3', status: 'active', ownerEmail: 'shweta@usaindiacfo.com' },
    select: { id: true },
  });
  const steps = [
    { position: 0, waitDays: 0, subject: 'Quick question about your close process', body: 'Hi {{firstName}} — noticed {{company}} recently raised. How are you handling monthly close today?' },
    { position: 1, waitDays: 3, subject: 'Re: your close process', body: 'Following up — we take close from three weeks to five days for companies at your stage.' },
    { position: 2, waitDays: 5, subject: 'Worth a look?', body: 'Last note from me. Here is a one-pager on how we work with Series A teams.' },
  ];
  const stepIds: string[] = [];
  for (const s of steps) {
    const row = await db.sequenceStep.create({
      data: { sequenceId: sequence.id, ...s, channel: 'email' },
      select: { id: true },
    });
    stepIds.push(row.id);
  }
  for (const contact of contacts.slice(0, 14)) {
    const status = pick(['pending', 'active', 'active', 'replied', 'completed', 'bounced']);
    const currentStep = status === 'pending' ? 0 : int(1, 3);
    const prospect = await db.prospect.create({
      data: {
        sequenceId: sequence.id,
        contactId: contact.id,
        email: contact.email,
        firstName: contact.name.split(' ')[0],
        lastName: contact.name.split(' ')[1],
        companyName: companies.find((c) => c.id === contact.companyId)?.name ?? null,
        status: status as never,
        currentStep,
      },
      select: { id: true },
    });
    for (let s = 0; s < currentStep; s++) {
      await db.outreachMessage.create({
        data: {
          prospectId: prospect.id,
          stepId: stepIds[s],
          status: 'sent',
          // Named so nobody reads these as real sends.
          providerId: 'console (nothing was actually sent)',
          sentAt: dayOffset(int(2, 40)),
          openedAt: chance(0.55) ? dayOffset(int(1, 30)) : null,
          repliedAt: status === 'replied' && s === currentStep - 1 ? dayOffset(int(1, 20)) : null,
        },
      });
    }
  }

  const openLeads = leads.filter((l) => l.status === 'qualified' || l.status === 'contacted').slice(0, 12);
  for (const lead of openLeads) {
    await db.task.create({
      data: {
        title: pick([
          'Send proposal',
          'Book discovery call',
          'Follow up on pricing questions',
          'Share case study',
          'Confirm scope with client',
        ]),
        detail: 'Seeded task.',
        status: chance(0.25) ? 'done' : 'open',
        priority: pick(['low', 'normal', 'high', 'urgent']),
        dueDate: dayOffset(-int(-14, 10)),
        assigneeEmail: pick(OWNERS),
        createdByEmail: 'shweta@usaindiacfo.com',
        leadId: lead.id,
        completedAt: null,
      },
    });
  }

  console.log('Integrations and AI insights…');
  // demo_data where the module has seeded numbers to show; disconnected where it does
  // not. Nothing is `connected` — there is no credential behind any of these.
  const INTEGRATIONS = [
    { provider: 'zoho_crm', state: 'disconnected' },
    { provider: 'meta_ads', state: 'demo_data' },
    { provider: 'google_analytics', state: 'demo_data' },
    { provider: 'semrush', state: 'demo_data' },
    { provider: 'google_search_console', state: 'disconnected' },
    { provider: 'google_ads', state: 'disconnected' },
    { provider: 'linkedin_ads', state: 'disconnected' },
    { provider: 'instagram', state: 'disconnected' },
    { provider: 'smtp_email', state: 'disconnected' },
  ] as const;
  for (const i of INTEGRATIONS) {
    await db.integration.create({
      data: {
        provider: i.provider,
        state: i.state as never,
        lastSyncAt: i.state === 'demo_data' ? dayOffset(0) : null,
        lastSyncRows: i.state === 'demo_data' ? int(400, 4000) : null,
        config: i.state === 'demo_data' ? { note: 'Seeded demo data. No live connection.' } : undefined,
      },
    });
  }

  const INSIGHTS = [
    { kind: 'opportunity', title: 'LinkedIn ABM produces the most valuable customers', body: 'Leads from LinkedIn ABM — Series A convert to closed-won at roughly twice the rate of Meta retargeting, and their average deal value is materially higher. The channel is spend-constrained rather than demand-constrained.' },
    { kind: 'risk', title: 'Meta retargeting cost per lead is drifting up', body: 'Cost per lead on CFO Services Retargeting has risen over the last quarter while lead quality has not improved. Worth testing a creative refresh before increasing budget.' },
    { kind: 'anomaly', title: 'Unassigned leads cluster at weekends', body: 'Leads arriving Saturday and Sunday wait noticeably longer for an owner. Auto-assignment covers this, but the first human touch still lands on Monday.' },
    { kind: 'recommendation', title: 'Qualified leads without a follow-up task', body: 'A handful of qualified leads have no open task attached. These are the cheapest pipeline available — they have already raised a hand.' },
  ] as const;
  for (const i of INSIGHTS) {
    await db.aiInsight.create({
      data: {
        kind: i.kind as never,
        title: i.title,
        body: i.body,
        // Explicitly 'seed', so the UI labels these as examples rather than analysis.
        provider: 'seed',
        confidence: null,
      },
    });
  }

  await db.notification.create({
    data: {
      title: 'Demo data loaded',
      body: 'Every figure in Growth Center is currently seeded. Connect an integration to replace it with live data.',
      level: 'info',
      href: '/integrations',
    },
  });

  const counts = {
    channels: await db.channel.count(),
    campaigns: await db.campaign.count(),
    spendRows: await db.marketingSpend.count(),
    companies: await db.company.count(),
    contacts: await db.contact.count(),
    leads: await db.lead.count(),
    opportunities: await db.opportunity.count(),
    customers: await db.customer.count(),
    revenueRows: await db.revenueEntry.count(),
    metrics: await db.metricSnapshot.count(),
    tasks: await db.task.count(),
  };

  const revenue = await db.revenueEntry.aggregate({ _sum: { amount: true } });
  const spend = await db.marketingSpend.aggregate({ _sum: { amount: true } });

  console.log('');
  console.log('Seeded:');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(14)} ${v}`);
  console.log(`  revenue       $${Number(revenue._sum.amount ?? 0).toLocaleString('en-US')}`);
  console.log(`  spend         $${Number(spend._sum.amount ?? 0).toLocaleString('en-US')}`);
  console.log('\nAll integrations are seeded as demo_data or disconnected — none are connected.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
