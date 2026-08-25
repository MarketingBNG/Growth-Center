// Event handlers, registered once at server start by instrumentation.ts.
//
// These are the "automation" layer: small reactions to writes elsewhere. Kept here
// rather than inline at the call sites so the set of automatic behaviours is one file
// to read.

import { on } from './events.ts';
import { db } from './prisma.ts';
import { pickOwner } from './leads.ts';

let registered = false;

export function registerAutomations() {
  if (registered) return;
  registered = true;

  on('lead.created', async ({ leadId }) => {
    const lead = await db().lead.findUnique({
      where: { id: leadId },
      select: { ownerEmail: true, firstName: true, lastName: true },
    });
    if (!lead || lead.ownerEmail) return;

    const owner = await pickOwner();
    if (!owner) return;

    await db().lead.update({ where: { id: leadId }, data: { ownerEmail: owner } });
    await db().activity.create({
      data: {
        type: 'owner_changed',
        summary: `Auto-assigned to ${owner}`,
        actorEmail: null,
        detail: { rule: 'least-loaded marketing owner' },
        leadId,
      },
    });
  });

  on('lead.qualified', async ({ leadId }) => {
    const lead = await db().lead.findUnique({
      where: { id: leadId },
      select: { firstName: true, lastName: true, companyName: true, ownerEmail: true },
    });
    if (!lead) return;

    const who = [lead.firstName, lead.lastName].filter(Boolean).join(' ');
    const due = new Date();
    due.setDate(due.getDate() + 2);

    await db().task.create({
      data: {
        title: `Follow up with ${who}${lead.companyName ? ` (${lead.companyName})` : ''}`,
        detail: 'Created automatically when the lead was qualified.',
        priority: 'high',
        dueDate: due,
        assigneeEmail: lead.ownerEmail,
        leadId,
      },
    });
  });

  on('opportunity.won', async ({ opportunityId }) => {
    const opp = await db().opportunity.findUnique({
      where: { id: opportunityId },
      select: {
        id: true,
        companyId: true,
        value: true,
        currency: true,
        campaignId: true,
        closedAt: true,
        lead: { select: { channelId: true } },
      },
    });
    if (!opp?.companyId) return;

    const wonAt = opp.closedAt ?? new Date();

    // Customer keyed on the company, so a second won deal for an existing customer
    // records revenue without creating a duplicate customer row.
    const customer = await db().customer.upsert({
      where: { companyId: opp.companyId },
      create: { companyId: opp.companyId, opportunityId: opp.id, wonAt },
      update: { churnedAt: null },
      select: { id: true },
    });

    const already = await db().revenueEntry.findFirst({
      where: { opportunityId: opp.id },
      select: { id: true },
    });
    if (already) return;

    await db().revenueEntry.create({
      data: {
        customerId: customer.id,
        date: wonAt,
        amount: opp.value,
        currency: opp.currency,
        kind: 'one_time',
        opportunityId: opp.id,
        campaignId: opp.campaignId,
        channelId: opp.lead?.channelId ?? null,
      },
    });
  });

  on('integration.sync_failed', async ({ provider, message }) => {
    await db().notification.create({
      data: {
        title: `${provider} sync failed`,
        body: message,
        level: 'error',
        href: '/integrations',
      },
    });
  });
}
