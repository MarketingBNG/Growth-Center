// End-to-end exercise of the Phase 2 write path against the real database.
//
// This is the check the UI cannot give us until Google OAuth is configured: it runs
// the exact functions the pages and route handlers call, in the order a person would
// trigger them, and asserts the side effects the automation layer is supposed to
// produce.
//
// It creates rows and deletes them again at the end, so it is safe to run against the
// seeded demo database.
//
//   DATABASE_URL=… node --experimental-strip-types tools/smoke.ts

import { createLead, getLead, listLeads, setLeadStatus } from '../lib/leads.ts';
import { board, convertLead, moveOpportunity } from '../lib/pipeline.ts';
import { getCompany, getContact, listCompanies, listContacts } from '../lib/crm.ts';
import { db } from '../lib/prisma.ts';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const failures: string[] = [];
function check(ok: boolean, message: string) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures.push(message);
}

const q = { q: undefined, page: 1, perPage: 25, sort: undefined, dir: 'desc' as const };
const stamp = Date.now();
const email = `smoke.test.${stamp}@smoketestcorp.example`;

console.log('\nRead paths (the queries every page runs)');

const leads = await listLeads({}, q);
check(leads.rows.length > 0 && leads.total > 0, `listLeads returns rows (${leads.total} total)`);
check(
  leads.rows.every((l) => 'campaign' in l && 'channel' in l),
  'listLeads includes campaign and channel for the table columns',
);

const filtered = await listLeads({ status: 'qualified' }, q);
check(
  filtered.rows.every((l) => l.status === 'qualified'),
  `status filter is applied server-side (${filtered.total} qualified)`,
);

const searched = await listLeads({}, { ...q, q: 'a' });
check(searched.total > 0 && searched.total <= leads.total, 'search narrows rather than widens');

const companies = await listCompanies(q);
check(companies.total > 0, `listCompanies returns rows (${companies.total})`);
const contacts = await listContacts(q);
check(contacts.total > 0, `listContacts returns rows (${contacts.total})`);

const company = await getCompany(companies.rows[0].id);
check(!!company, 'getCompany resolves its detail includes');
const contact = await getContact(contacts.rows[0].id);
check(!!contact, 'getContact resolves its detail includes');

const theBoard = await board();
check(!!theBoard && theBoard.columns.length > 0, `board returns ${theBoard?.columns.length ?? 0} columns`);
check(
  !!theBoard && theBoard.columns.every((c) => c.cards.every((d) => d.stageId === c.stage.id)),
  'every card sits in its own stage column',
);
check(
  !!theBoard && theBoard.columns.flatMap((c) => c.cards).every((d) => d.closedAt === null),
  'the board shows only open deals',
);

console.log('\nWrite path: create -> dedupe -> qualify -> convert -> win');

const created = await createLead(
  {
    firstName: 'Smoke',
    lastName: `Test${stamp}`,
    email,
    companyName: 'Smoke Test Corp',
    sourceType: 'form',
    tags: [],
  },
  'marketing@usaindiacfo.com',
);
check(created.created, 'createLead created a new lead');
const leadId = created.leadId;

// The CRM should have been populated from the work-email domain, with no manual step.
const afterCreate = await getLead(leadId);
check(!!afterCreate?.companyId, 'a company was created or matched from the email domain');
check(!!afterCreate?.contactId, 'a contact was created from the email');
check(
  afterCreate?.company?.domain === 'smoketestcorp.example',
  `company domain came from the email (${afterCreate?.company?.domain})`,
);

// lead.created should have auto-assigned an owner.
check(!!afterCreate?.ownerEmail, `lead.created auto-assigned an owner (${afterCreate?.ownerEmail})`);
check(
  afterCreate!.activities.some((a) => a.type === 'owner_changed'),
  'the auto-assignment wrote an Activity row',
);

const duplicate = await createLead(
  { firstName: 'Smoke', lastName: 'Again', email: email.toUpperCase(), sourceType: 'form', tags: [] },
  null,
);
check(!duplicate.created, 'a second submission with the same email did not create a second lead');
check(duplicate.leadId === leadId, 'the duplicate resolved to the original lead');

const plusTagged = await createLead(
  { firstName: 'Smoke', lastName: 'Plus', email: email.replace('@', '+newsletter@'), sourceType: 'form', tags: [] },
  null,
);
check(!plusTagged.created, 'a +tagged variant of the same address was also caught as a duplicate');

await setLeadStatus(leadId, 'qualified', 'marketing@usaindiacfo.com');
const qualified = await getLead(leadId);
check(qualified?.status === 'qualified', 'status is qualified');
check(!!qualified?.qualifiedAt, 'qualifiedAt was stamped');
check(
  qualified!.activities.some((a) => a.type === 'status_changed'),
  'the status change is in the append-only history',
);
// lead.qualified should have created the follow-up task.
check(qualified!.tasks.length > 0, `lead.qualified created a follow-up task (${qualified!.tasks.length})`);

const converted = await convertLead(leadId, 'marketing@usaindiacfo.com', 42000);
check(converted.ok, 'convertLead succeeded');
const oppId = converted.ok ? converted.opportunityId : '';

const afterConvert = await getLead(leadId);
check(afterConvert?.status === 'converted', 'the lead is now converted');
check(afterConvert!.opportunities.length === 1, 'the lead links to exactly one opportunity');

const again = await convertLead(leadId, 'marketing@usaindiacfo.com', 1000);
check(!again.ok, 'converting an already-converted lead is refused');

const opp = await db().opportunity.findUnique({
  where: { id: oppId },
  select: { companyId: true, contactId: true, campaignId: true, value: true },
});
check(!!opp?.companyId && !!opp?.contactId, 'the deal carried company and contact across');
check(Number(opp?.value) === 42000, 'the deal value was recorded');

// Move it to Won and confirm the customer and revenue row follow.
const stages = await db().pipelineStage.findMany({ where: { isWon: true }, select: { id: true } });
const moved = await moveOpportunity(oppId, stages[0].id, 'marketing@usaindiacfo.com');
check(moved.ok, 'moveOpportunity to the won stage succeeded');

const won = await db().opportunity.findUnique({
  where: { id: oppId },
  select: { probability: true, closedAt: true, companyId: true },
});
check(won?.probability === 100, 'a won deal is 100% probable');
check(!!won?.closedAt, 'a won deal is closed');

const customer = await db().customer.findUnique({
  where: { companyId: won!.companyId! },
  select: { id: true, revenue: { select: { amount: true, opportunityId: true } } },
});
check(!!customer, 'opportunity.won created the customer');
check(
  !!customer?.revenue.some((r) => r.opportunityId === oppId && Number(r.amount) === 42000),
  'opportunity.won wrote a revenue row matching the deal value',
);

// Moving to won twice must not double-count revenue.
await moveOpportunity(oppId, stages[0].id, 'marketing@usaindiacfo.com');
const revenueRows = await db().revenueEntry.count({ where: { opportunityId: oppId } });
check(revenueRows === 1, `re-winning did not duplicate revenue (${revenueRows} row)`);

const badMove = await moveOpportunity(oppId, 'not-a-real-stage-id', 'marketing@usaindiacfo.com');
check(!badMove.ok, 'moving to a non-existent stage is refused');

console.log('\nCleaning up');
const companyId = won!.companyId!;
await db().revenueEntry.deleteMany({ where: { opportunityId: oppId } });
await db().customer.deleteMany({ where: { companyId } });
await db().opportunity.deleteMany({ where: { id: oppId } });
await db().task.deleteMany({ where: { leadId } });
await db().activity.deleteMany({ where: { leadId } });
await db().lead.deleteMany({ where: { id: leadId } });
await db().contact.deleteMany({ where: { companyId } });
await db().company.deleteMany({ where: { id: companyId } });
console.log('  removed the smoke-test rows');

await db().$disconnect();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
