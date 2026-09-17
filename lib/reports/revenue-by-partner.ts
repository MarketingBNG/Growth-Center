import { db } from '../platform/prisma.ts';
import { leadSourceLabel } from '../integrations/crm-mapping.ts';
import { int, pct, sumByKey, type ReportContext, type Section } from './shared.ts';

export async function revenueByPartner({ current, money, inFx }: ReportContext): Promise<Section[]> {
  // Revenue reaches a person only through a deal: every revenue_entry carries an
  // opportunityId and is derived from a won one. So both breakdowns below start there —
  // the owner is on the deal, and the referring partner is on the source string of the
  // deal or of the lead behind it.
  const rows = await db().revenueEntry.findMany({
    where: { date: { gte: current.from, lte: current.to } },
    select: {
      amount: true,
      currency: true,
      channelId: true,
      opportunity: {
        select: {
          ownerEmail: true,
          sourceDetail: true,
          lead: { select: { sourceDetail: true } },
        },
      },
    },
  });

  const total = rows.reduce((t, r) => t + inFx(r.amount, r.currency), 0);
  const share = (n: number) => (total ? pct((n / total) * 100) : '—');

  const tally = (keyOf: (r: (typeof rows)[number]) => string | null) =>
    sumByKey(rows, keyOf, (r) => inFx(r.amount, r.currency));

  const byOwner = tally((r) => r.opportunity?.ownerEmail ?? 'Unassigned');

  // The lead's source first, then the deal's — the same precedence revenue itself uses
  // to pick a channel, so a partner's revenue here matches their channel's there.
  const sourceOf = (r: (typeof rows)[number]) =>
    r.opportunity?.lead?.sourceDetail ?? r.opportunity?.sourceDetail ?? null;

  // Only the sources that name a referrer. "Reference", "Client Ref", "Ref by NG" —
  // leadSourceGroup calls all of these `referral`, which is the point: this splits them
  // back apart into who actually sent the business.
  const byReferrer = tally((r) => {
    const s = sourceOf(r);
    if (!s) return null;
    return /\bref\b|refer/i.test(s) ? s : null;
  });
  const referralTotal = byReferrer.reduce((t, v) => t + v.amount, 0);

  const bySource = tally((r) => leadSourceLabel(sourceOf(r)));
  const attributed = rows.filter((r) => r.channelId !== null);
  const attributedTotal = attributed.reduce((t, r) => t + inFx(r.amount, r.currency), 0);

  return [
    {
      kind: 'stats',
      title: 'Revenue in period',
      rows: [
        { label: 'Total', value: money(total), hint: `${int(rows.length)} payments, all from won deals` },
        { label: 'People with revenue', value: int(byOwner.length) },
        {
          label: 'Referred by a partner',
          value: money(referralTotal),
          hint: total ? `${share(referralTotal)} of revenue, across ${byReferrer.length} referrers` : undefined,
        },
        {
          label: 'Traceable to a source',
          value: money(attributedTotal),
          hint: `${share(attributedTotal)} — the rest reaches no channel, see the note below`,
        },
      ],
    },
    {
      kind: 'table',
      title: 'By deal owner',
      columns: ['Owner', 'Deals', 'Revenue', 'Share'],
      align: ['left', 'right', 'right', 'right'],
      rows: byOwner.map((v) => [v.key, int(v.count), money(v.amount), share(v.amount)]),
    },
    {
      kind: 'table',
      title: 'By referring partner',
      columns: ['Referred by', 'Deals', 'Revenue', 'Share'],
      align: ['left', 'right', 'right', 'right'],
      rows: byReferrer.length
        ? byReferrer.map((v) => [v.key, int(v.count), money(v.amount), share(v.amount)])
        : [['No referred revenue in this period', '—', '—', '—']],
    },
    {
      kind: 'table',
      title: 'By source',
      columns: ['Source', 'Deals', 'Revenue', 'Share'],
      align: ['left', 'right', 'right', 'right'],
      rows: bySource.map((v) => [v.key, int(v.count), money(v.amount), share(v.amount)]),
    },
    {
      kind: 'note',
      title: 'How far the source is knowable',
      body:
        `${share(attributedTotal)} of this revenue can be traced to a channel. The rest cannot: ` +
        'Zoho links only a minority of won deals back to the lead that produced them, so most ' +
        'payments arrive with no source of any kind. Those are counted in the total and shown as ' +
        'Unattributed rather than spread across the sources that can be identified — splitting ' +
        'them would inflate every channel in proportion to how well it already reports.',
    },
  ];
}
