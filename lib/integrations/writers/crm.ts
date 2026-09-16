import { db } from '../../platform/prisma.ts';
import { channelSlugFor, cleanImportedName, leadSourceType, leadStatus, matchStage, taskPriority, taskStatus } from '../crm-mapping.ts';
import { normalizeCompanyName } from '../../crm/dedupe.ts';
import { resolveAttribution } from '../../money/attribution-confidence.ts';
import { lostReasonOf } from '../../leads/lead-lost-reason.ts';
import { SCORE_VERSION, scoreLead } from '../../leads/lead-score.ts';
import { parseDealName } from '../../pipeline/deal-name.ts';
import { applyHistoryOrigins } from '../../pipeline/deal-origin.ts';
import { currencySettings } from '../../platform/settings.ts';
import type { MetricPoint } from '../types.ts';
import { bulkUpsert, createdAtOf, importedEmail, meta, str } from '../persist.ts';

const STAGE_SELECT = {
  id: true,
  name: true,
  position: true,
  probability: true,
  isWon: true,
  isLost: true,
} as const;

/**
 * Puts a person's name into the two columns the schema has.
 *
 * Lead.firstName and Contact.firstName are NOT NULL, so something must fill them. The
 * obvious fallback — first name, else the display label — is wrong: Zoho makes Last_Name
 * mandatory and First_Name optional, so most records here carry the whole name in
 * Last_Name alone. Falling back to the label then copied that same name into firstName,
 * and 21,151 of 26,073 leads rendered as "Irshad Alli Irshad Alli".
 *
 * A lone name belongs in firstName with lastName empty, so joining the two reads correctly
 * whichever way round the source happened to store it.
 */
export function splitName(
  first: string | null,
  last: string | null,
  label: string | undefined,
  fallback: string,
): { firstName: string; lastName: string | null } {
  // Cleaned here rather than at the two call sites, so leads and contacts are both
  // covered and a third importer cannot forget.
  const f = cleanImportedName(first);
  const l = cleanImportedName(last);
  const lbl = cleanImportedName(label);
  if (f && l) return { firstName: f, lastName: l };
  return { firstName: f ?? l ?? lbl ?? fallback, lastName: null };
}

/**
 * Turns `crm_lead`, `crm_contact` and `crm_deal` points into real Lead, Contact and
 * Opportunity rows, plus the Company rows they hang off.
 *
 * Same reason writeCampaignSpend and writeSocialActivity exist. Zoho CRM shipped
 * reporting three `record_count` numbers into metric_snapshot and nothing else — and
 * nothing in the app reads metric_snapshot for CRM. The Leads, Contacts and Pipeline
 * pages all read these tables, so a Zoho sync could succeed completely and every one of
 * those pages would still show only what the seeder left behind.
 *
 * Records are matched on (source, externalId), so a re-sync updates in place. Within the
 * fields the provider reports, the provider wins: an edit made in Growth Center to a
 * Zoho-owned lead is overwritten on the next sync. That is the right default for a mirror
 * of an upstream CRM, and the things Growth Center owns alone — tags, notes, tasks,
 * activities, owner assignment — are never touched here.
 */
export async function writeCrmRecords(providerId: string, points: MetricPoint[]): Promise<number> {
  const accountPoints = points.filter((p) => p.entityType === 'crm_account' && p.entityId);
  const leadPoints = points.filter((p) => p.entityType === 'crm_lead' && p.entityId);
  const contactPoints = points.filter((p) => p.entityType === 'crm_contact' && p.entityId);
  const dealPoints = points.filter((p) => p.entityType === 'crm_deal' && p.entityId);
  if (!accountPoints.length && !leadPoints.length && !contactPoints.length && !dealPoints.length) {
    return 0;
  }

  let written = 0;

  // ── companies ───────────────────────────────────────────────────────────────
  // Two ways a company arrives, and the richer one goes first.
  //
  // The account module carries the details — website, phone, industry, country. Contacts
  // and deals only mention an account by id and name, which is all a company row used to
  // get: 2,761 of them with a name and nine empty columns.
  //
  // The name-only pass still runs, for an account referenced by a deal in this batch whose
  // own record has not been fetched yet. It sets `name` alone, so it cannot blank the
  // details a fuller row already has.
  //
  // `domain` is left alone deliberately. It is unique, and two companies sharing a website
  // — a group and its subsidiary, or two records for one client — would abort the whole
  // batch on that index rather than write anything.
  const companyIdByExternal = new Map<string, string>();

  if (accountPoints.length) {
    const rows = accountPoints.map((p) => {
      const m = meta(p);
      const externalId = p.entityId as string;
      const name = str(m.name) ?? p.entityLabel ?? externalId;
      return [
        name,
        normalizeCompanyName(name),
        str(m.website),
        str(m.phone),
        str(m.industry),
        str(m.country),
        str(m.size),
        str(m.notes),
        str(m.ownerEmail),
        createdAtOf(p),
        providerId,
        externalId,
      ];
    });
    const detailed = await bulkUpsert(
      'company',
      ['name', 'nameKey', 'website', 'phone', 'industry', 'country', 'size', 'notes', 'ownerEmail', 'createdAt', 'source', 'externalId'],
      rows,
      '"source", "externalId"',
      { createdAt: 'timestamp(3)' },
    );
    for (const r of detailed) if (r.externalId) companyIdByExternal.set(r.externalId, r.id);
    written += detailed.length;
  }

  const accounts = new Map<string, string>();
  for (const p of [...contactPoints, ...dealPoints]) {
    const id = str(meta(p).accountId);
    const name = str(meta(p).accountName);
    if (id && name && !companyIdByExternal.has(id)) accounts.set(id, name);
  }

  if (accounts.size) {
    const companyRows = [...accounts].map(([externalId, name]) => [
      name,
      normalizeCompanyName(name),
      providerId,
      externalId,
    ]);
    const companies = await bulkUpsert(
      'company',
      ['name', 'nameKey', 'source', 'externalId'],
      companyRows,
      '"source", "externalId"',
    );
    for (const r of companies) if (r.externalId) companyIdByExternal.set(r.externalId, r.id);
    written += companies.length;
  }

  // ── contacts ────────────────────────────────────────────────────────────────
  const contactIdByExternal = new Map<string, string>();
  if (contactPoints.length) {
    // Contact.email is globally unique, which a bulk insert cannot negotiate: a row whose
    // address already exists would abort the whole batch on the wrong index. So the
    // colliding addresses are resolved up front — rows already here are adopted (stamped
    // with this provider's id) one by one, and everything else goes out in batches.
    // Lower-cased, matching what is written: the stored address is now case-normalised,
    // so looking a clash up in the CRM's own casing would miss it — and the row would go
    // out in a batch that then aborts on the unique index, taking the whole chunk with it.
    const emails = [
      ...new Set(contactPoints.map((p) => importedEmail(meta(p).email)).filter((e): e is string => !!e)),
    ];
    const existing = emails.length
      ? await db().contact.findMany({
          where: { email: { in: emails } },
          select: { id: true, email: true, source: true, externalId: true },
        })
      : [];
    const byEmail = new Map(existing.map((c) => [c.email ?? '', c]));

    // Zoho permits two contacts to share an address; this schema does not. First occurrence
    // keeps the address, later ones are imported without it rather than being dropped.
    const claimedInBatch = new Set<string>();
    let deduped = 0;

    const adopt: { id: string; row: Record<string, unknown>; externalId: string; createdAt: Date }[] = [];
    const fresh: unknown[][] = [];

    for (const p of contactPoints) {
      const m = meta(p);
      const externalId = p.entityId as string;
      let email = importedEmail(m.email);

      if (email && claimedInBatch.has(email)) {
        email = null;
        deduped++;
      } else if (email) {
        claimedInBatch.add(email);
      }

      const accountId = str(m.accountId);
      const name = splitName(str(m.firstName), str(m.lastName), p.entityLabel, externalId);
      const row = {
        firstName: name.firstName,
        lastName: name.lastName,
        email,
        phone: str(m.phone),
        title: str(m.title),
        companyId: accountId ? (companyIdByExternal.get(accountId) ?? null) : null,
        ownerEmail: str(m.ownerEmail),
      };

      const clash = email ? byEmail.get(email) : undefined;
      const alreadyOurs = clash?.source === providerId && clash?.externalId === externalId;

      if (clash && !alreadyOurs) {
        adopt.push({ id: clash.id, row, externalId, createdAt: createdAtOf(p) });
      } else {
        fresh.push([row.firstName, row.lastName, row.email, row.phone, row.title, row.companyId, row.ownerEmail, createdAtOf(p), providerId, externalId]);
      }
    }

    for (const a of adopt) {
      await db().contact.update({
        where: { id: a.id },
        data: { ...a.row, createdAt: a.createdAt, source: providerId, externalId: a.externalId },
      });
      contactIdByExternal.set(a.externalId, a.id);
      written++;
    }

    const touched = await bulkUpsert(
      'contact',
      ['firstName', 'lastName', 'email', 'phone', 'title', 'companyId', 'ownerEmail', 'createdAt', 'source', 'externalId'],
      fresh,
      '"source", "externalId"',
      { createdAt: 'timestamp(3)' },
    );
    for (const t of touched) if (t.externalId) contactIdByExternal.set(t.externalId, t.id);
    written += touched.length;

    if (deduped) {
      console.warn(`[${providerId}] ${deduped} contacts imported without an email: address already used by another contact.`);
    }
  }

  // ── leads ───────────────────────────────────────────────────────────────────
  // Channels are looked up once. Without a channel on the lead, every figure on the
  // Marketing page groups by a column that is null on all 27,181 rows.
  const channelIdBySlug = new Map(
    (await db().channel.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]),
  );

  const leadRows = leadPoints.map((p) => {
    const m = meta(p);
    const externalId = p.entityId as string;
    const name = splitName(str(m.firstName), str(m.lastName), p.entityLabel, externalId);
    const status = leadStatus(str(m.status));
    const sourceDetail = str(m.leadSource);
    const sourceType = leadSourceType(sourceDetail);
    const channelSlug = channelSlugFor(sourceType, sourceDetail);

    // The funnel counts qualified leads by qualifiedAt, not by current status, so that
    // converting a lead cannot make the qualified count go down. An import that set the
    // status and left the timestamp null therefore reported nought qualified out of 1,711
    // — and a 0% qualification rate on a CRM full of qualified leads.
    //
    // The CRM records no date for the change, so the record's own date is the closest
    // honest answer: it says the lead qualified, not when.
    const reachedQualified = status === 'qualified' || status === 'converted';

    // Zoho keeps a converted lead in the module with a flag and a date rather than a
    // status, so conversion has to be read from those and not inferred from the status
    // text — which still says whatever it said the day the lead was converted.
    const convertedAt = m.converted ? new Date(String(m.convertedAt ?? '')) : null;
    const converted = convertedAt && !Number.isNaN(convertedAt.getTime()) ? convertedAt : null;

    // Scored from the same fields being written, so the stored score always describes the
    // stored record. Computing it in a later pass is how the two come apart.
    const quality = scoreLead({
      channelSlug,
      email: importedEmail(m.email),
      phone: str(m.phone),
      message: str(m.message),
      sourceDetail,
      companyName: str(m.companyName),
    });

    return [
      name.firstName,
      name.lastName,
      importedEmail(m.email),
      str(m.phone),
      str(m.companyName),
      str(m.title),
      str(m.message),
      m.converted ? 'converted' : status,
      // Kept beside the mapped status, not instead of it: the CRM page groups by this
      // team's own wording and the shared vocabulary cannot express it.
      str(m.status),
      sourceDetail,
      sourceType,
      channelSlug ? (channelIdBySlug.get(channelSlug) ?? null) : null,
      str(m.ownerEmail),
      // A converted lead was qualified on the way through, whatever its status says.
      reachedQualified || converted ? (converted ?? createdAtOf(p)) : null,
      converted,
      createdAtOf(p),
      // §7.3, §7.4, §7.6 and G1.2, written on every sync rather than only by the
      // backfill. A lead imported tomorrow that is never scored would sit at the
      // column's default 0 — indistinguishable from a genuinely worthless lead, which
      // is the state `score` was already in on all 27,575 rows.
      quality.total,
      SCORE_VERSION,
      quality.segment,
      lostReasonOf({ status: m.converted ? 'converted' : status, sourceStatus: str(m.status), message: str(m.message) }),
      resolveAttribution(sourceType, sourceDetail).confidence,
      providerId,
      externalId,
    ];
  });
  const leadsTouched = await bulkUpsert(
    'lead',
    ['firstName', 'lastName', 'email', 'phone', 'companyName', 'title', 'message', 'status', 'sourceStatus', 'sourceDetail', 'sourceType', 'channelId', 'ownerEmail', 'qualifiedAt', 'convertedAt', 'createdAt', 'score', 'scoreVersion', 'segment', 'lostReason', 'attributionConfidence', 'source', 'externalId'],
    leadRows,
    '"source", "externalId"',
    { status: '"LeadStatus"', sourceType: '"SourceType"', qualifiedAt: 'timestamp(3)', convertedAt: 'timestamp(3)', createdAt: 'timestamp(3)', score: 'int', scoreVersion: 'int' },
  );
  written += leadsTouched.length;

  // ── deals ───────────────────────────────────────────────────────────────────
  if (dealPoints.length) {
    // Opportunity.pipelineId and .stageId are both required, so a deal cannot be written
    // without a pipeline to put it in. Rather than inventing one, the deals are skipped —
    // and because this count is reported separately on the card, a skip shows up as a
    // smaller number instead of a silent success.
    const pipeline =
      (await db().pipeline.findFirst({
        where: { isDefault: true },
        select: { id: true, stages: { select: STAGE_SELECT } },
      })) ??
      (await db().pipeline.findFirst({
        select: { id: true, stages: { select: STAGE_SELECT } },
        orderBy: { createdAt: 'asc' },
      }));

    if (pipeline?.stages.length) {
      const dealRows: unknown[][] = [];

      // What a deal with no currency of its own is counted in.
      //
      // Not USD. The amount has to be stored in some currency, and tagging an unknown one
      // as USD is what put Meta's rupee spend on the page multiplied by the exchange rate.
      // The workspace's own reporting currency is the one label that cannot do that: it
      // converts by a factor of one, so an unknown amount is counted at face value rather
      // than inflated by a rate it never earned.
      const reporting = (await currencySettings()).reporting;
      let currencyless = 0;

      for (const p of dealPoints) {
        const m = meta(p);
        const externalId = p.entityId as string;
        const sourceStage = str(m.stage);
        const stage = matchStage(pipeline.stages, sourceStage);
        if (!stage) continue;

        const dealCurrency = str(m.currency) ?? reporting;
        if (!str(m.currency)) currencyless++;

        const closing = str(m.closingDate);
        const closingDate = closing ? new Date(closing) : null;
        const accountId = str(m.accountId);
        const contactId = str(m.contactId);

        // A deal in a won or lost stage is closed, and Closing_Date is the day it closed.
        //
        // Left null when the CRM has no date, never today's: 982 won deals carry no
        // Closing_Date, and stamping them with the moment of the import dropped them all
        // into whichever month the sync happened to run in.
        const closed = stage.isWon || stage.isLost;
        const validClosing = closingDate && !Number.isNaN(closingDate.getTime()) ? closingDate : null;

        // The deal's own Lead_Source, mapped the same way a lead's is.
        //
        // Zoho puts a source on the deal record as well as the lead, and this is the only
        // one most deals have: 6,886 of 7,810 here were never converted from a lead, so
        // walking deal -> lead -> channel left 88% of the revenue attributed to nothing
        // while the answer sat on the deal itself.
        const dealSource = str(m.leadSource);
        const dealChannelSlug = channelSlugFor(leadSourceType(dealSource), dealSource);

        // New business versus repeat, and one-off versus retainer, read out of the deal
        // name — this CRM has no field for either, but the naming convention carries both.
        const dealName = p.entityLabel ?? externalId;
        const named = parseDealName(dealName);

        dealRows.push([
          dealName,
          pipeline.id,
          stage.id,
          Number(m.amount) || 0,
          dealCurrency,
          Number(m.probability) || stage.probability,
          stage.isLost ? str(m.lostReason) : null,
          validClosing,
          closed ? validClosing : null,
          accountId ? (companyIdByExternal.get(accountId) ?? null) : null,
          contactId ? (contactIdByExternal.get(contactId) ?? null) : null,
          dealSource,
          dealChannelSlug ? (channelIdBySlug.get(dealChannelSlug) ?? null) : null,
          // Kept because a stage that fails to match is otherwise invisible: every deal
          // lands in the first open stage and the import looks like it worked. With the
          // CRM's own wording stored beside the mapped stage, a mismatch is one query away.
          sourceStage ? JSON.stringify({ stage: sourceStage }) : null,
          str(m.ownerEmail),
          named.origin,
          named.origin === 'unknown' ? null : 'name',
          named.engagementType,
          named.sequenceNo,
          createdAtOf(p),
          // G1.2. A deal in this CRM carries its own Lead_Source, so its confidence is
          // read from that rather than inherited — but most deals carry none, which is
          // why revenue attribution reaches 10.2% while leads reach 99.6%. A deal with no
          // source of its own and a lead behind it is weakened one step by the backfill;
          // see inheritedConfidence.
          resolveAttribution(leadSourceType(dealSource), dealSource).confidence,
          providerId,
          externalId,
        ]);
      }

      // Said out loud rather than absorbed: a silent default is the whole failure mode
      // being avoided here, and a count in the log is what makes it findable.
      if (currencyless) {
        console.warn(
          `[${providerId}] ${currencyless} deals had no currency and were counted as ${reporting}.`,
        );
      }

      const dealsTouched = await bulkUpsert(
        'opportunity',
        ['name', 'pipelineId', 'stageId', 'value', 'currency', 'probability', 'lostReason', 'expectedCloseDate', 'closedAt', 'companyId', 'contactId', 'sourceDetail', 'channelId', 'metadata', 'ownerEmail', 'dealOrigin', 'originSource', 'engagementType', 'accountSequenceNo', 'createdAt', 'attributionConfidence', 'source', 'externalId'],
        dealRows,
        '"source", "externalId"',
        { value: 'numeric', probability: 'int', accountSequenceNo: 'int', expectedCloseDate: 'timestamp(3)', closedAt: 'timestamp(3)', metadata: 'jsonb', createdAt: 'timestamp(3)' },
      );
      written += dealsTouched.length;
    }
  }

  // The names have had their say; account history now answers for the deals they left
  // unclassified. It runs once at the end rather than per deal because the rule is about
  // a deal's position among its siblings, which is not knowable one row at a time — and
  // because the upsert above rewrites `unknown` over any verdict a previous run reached,
  // so this must follow it, not precede it.
  if (written > 0) {
    await applyHistoryOrigins((sql, params) =>
      db().$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params),
    );
  }

  return written;
}

/**
 * Turns `crm_task` and `crm_activity` points into Task and Activity rows.
 *
 * Zoho keeps the work log in three modules — Tasks, Calls, Events — and until now none of
 * it was imported, so the activity feed and task list showed only what the seeder wrote.
 *
 * Both tables hang off whichever record the activity was about. Zoho names it in What_Id
 * (a lead or a deal) and Who_Id (a contact) without saying which module either belongs
 * to, so the ids are resolved here against the records already imported: whatever matches
 * wins, and an activity whose subject was never imported still lands, unattached, rather
 * than being dropped.
 */
export async function writeCrmActivity(providerId: string, points: MetricPoint[]): Promise<number> {
  const taskPoints = points.filter((p) => p.entityType === 'crm_task' && p.entityId);
  const activityPoints = points.filter((p) => p.entityType === 'crm_activity' && p.entityId);
  if (!taskPoints.length && !activityPoints.length) return 0;

  const referenced = new Set<string>();
  for (const p of [...taskPoints, ...activityPoints]) {
    const m = meta(p);
    const what = str(m.whatId);
    const who = str(m.whoId);
    if (what) referenced.add(what);
    if (who) referenced.add(who);
  }

  // One lookup per table over the whole referenced set, sliced so a large pull cannot
  // exceed Postgres's bind-parameter limit.
  const LOOKUP_CHUNK = 1000;
  const ids = [...referenced];
  const leadBy = new Map<string, string>();
  const contactBy = new Map<string, string>();
  const dealBy = new Map<string, string>();
  const dealCompany = new Map<string, string | null>();

  for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
    const slice = ids.slice(i, i + LOOKUP_CHUNK);
    const where = { source: providerId, externalId: { in: slice } };
    const [leads, contacts, deals] = await Promise.all([
      db().lead.findMany({ where, select: { id: true, externalId: true } }),
      db().contact.findMany({ where, select: { id: true, externalId: true } }),
      db().opportunity.findMany({ where, select: { id: true, externalId: true, companyId: true } }),
    ]);
    for (const r of leads) if (r.externalId) leadBy.set(r.externalId, r.id);
    for (const r of contacts) if (r.externalId) contactBy.set(r.externalId, r.id);
    for (const r of deals) {
      if (!r.externalId) continue;
      dealBy.set(r.externalId, r.id);
      dealCompany.set(r.externalId, r.companyId);
    }
  }

  /** Whatever the two Zoho ids turn out to point at. A contact reference also carries no
   *  company of its own, so only a deal can supply one. */
  const link = (whatId: string | null, whoId: string | null) => {
    const opportunityId = whatId ? (dealBy.get(whatId) ?? null) : null;
    const leadId = (whatId && leadBy.get(whatId)) || (whoId && leadBy.get(whoId)) || null;
    const contactId = (whoId && contactBy.get(whoId)) || (whatId && contactBy.get(whatId)) || null;
    const companyId = whatId ? (dealCompany.get(whatId) ?? null) : null;
    return { opportunityId, leadId, contactId, companyId };
  };

  let written = 0;

  if (taskPoints.length) {
    const rows: unknown[][] = [];
    for (const p of taskPoints) {
      const m = meta(p);
      const status = taskStatus(str(m.status));
      const due = str(m.dueDate);
      const dueDate = due ? new Date(due) : null;
      const { opportunityId, leadId, contactId, companyId } = link(str(m.whatId), str(m.whoId));

      rows.push([
        str(m.title) ?? p.entityLabel ?? (p.entityId as string),
        str(m.detail),
        status,
        taskPriority(str(m.priority)),
        dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null,
        str(m.ownerEmail),
        str(m.createdByEmail),
        // Zoho records no completion time, so a done task is dated by the day it was last
        // touched rather than left null, which the task list reads as still open.
        status === 'done' ? p.date : null,
        leadId,
        contactId,
        companyId,
        opportunityId,
        providerId,
        p.entityId as string,
      ]);
    }

    const touched = await bulkUpsert(
      'task',
      ['title', 'detail', 'status', 'priority', 'dueDate', 'assigneeEmail', 'createdByEmail', 'completedAt', 'leadId', 'contactId', 'companyId', 'opportunityId', 'source', 'externalId'],
      rows,
      '"source", "externalId"',
      { status: '"TaskStatus"', priority: '"Priority"', dueDate: 'timestamp(3)', completedAt: 'timestamp(3)' },
    );
    written += touched.length;
  }

  if (activityPoints.length) {
    const rows: unknown[][] = [];
    for (const p of activityPoints) {
      const m = meta(p);
      const { opportunityId, leadId, contactId, companyId } = link(str(m.whatId), str(m.whoId));

      rows.push([
        str(m.kind) === 'meeting' ? 'meeting' : 'call',
        str(m.summary) ?? p.entityLabel ?? (p.entityId as string),
        str(m.ownerEmail),
        JSON.stringify({
          detail: str(m.detail),
          direction: str(m.direction),
          duration: str(m.duration),
          endsAt: str(m.endsAt),
        }),
        leadId,
        contactId,
        companyId,
        opportunityId,
        // The feed is ordered by createdAt, so it has to be when the call or meeting
        // happened. Left to default(now()) every imported activity would stack up on the
        // day of the sync.
        p.date,
        providerId,
        p.entityId as string,
      ]);
    }

    const touched = await bulkUpsert(
      'activity',
      ['type', 'summary', 'actorEmail', 'detail', 'leadId', 'contactId', 'companyId', 'opportunityId', 'createdAt', 'source', 'externalId'],
      rows,
      '"source", "externalId"',
      { type: '"ActivityType"', detail: 'jsonb', createdAt: 'timestamp(3)' },
      false,
    );
    written += touched.length;
  }

  return written;
}

/**
 * Joins a converted lead to what it became.
 *
 * Zoho records the contact, account and deal a lead converted into, and without them the
 * three are unrelated rows: nothing can say which lead earned which revenue, and the
 * funnel's last step is an assertion rather than a join.
 *
 * Run as its own pass, after the records exist. The lead may be fetched pages before the
 * deal it points at — the modules are pulled one after another — so resolving the links
 * inline would drop every reference that pointed forwards.
 *
 * Set once and left alone: a link corrected by hand here should survive the next sync.
 */
export async function linkConvertedLeads(providerId: string, points: MetricPoint[]): Promise<number> {
  const rows = points
    .filter((p) => p.entityType === 'crm_lead' && p.entityId && meta(p).converted)
    .map((p) => {
      const m = meta(p);
      return {
        externalId: p.entityId as string,
        contactId: str(m.convertedContactId),
        accountId: str(m.convertedAccountId),
        dealId: str(m.convertedDealId),
      };
    })
    .filter((r) => r.contactId || r.accountId || r.dealId);

  if (!rows.length) return 0;

  let linked = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map((r) => [providerId, r.externalId, r.contactId, r.accountId, r.dealId]);
    const placeholders = values
      .map((_, n) => `($${n * 5 + 1}, $${n * 5 + 2}, $${n * 5 + 3}, $${n * 5 + 4}, $${n * 5 + 5})`)
      .join(', ');

    // A single statement per chunk, joining through the external ids both sides already
    // carry. COALESCE keeps a link that is already set, including one set by hand.
    linked += await db().$executeRawUnsafe(
      `WITH ref (source, lead_external, contact_external, account_external, deal_external)
         AS (VALUES ${placeholders})
       UPDATE lead l
          SET "contactId"  = COALESCE(l."contactId", c.id),
              "companyId"  = COALESCE(l."companyId", co.id)
         FROM ref
         LEFT JOIN contact c  ON c.source = ref.source  AND c."externalId" = ref.contact_external
         LEFT JOIN company co ON co.source = ref.source AND co."externalId" = ref.account_external
        WHERE l.source = ref.source
          AND l."externalId" = ref.lead_external
          AND (c.id IS NOT NULL OR co.id IS NOT NULL)`,
      ...values.flat(),
    );

    // The deal points back at the lead rather than the other way round: a lead produces
    // at most one deal here, but the column lives on Opportunity.
    await db().$executeRawUnsafe(
      `WITH ref (source, lead_external, contact_external, account_external, deal_external)
         AS (VALUES ${placeholders})
       UPDATE opportunity o
          SET "leadId" = l.id
         FROM ref
         JOIN lead l ON l.source = ref.source AND l."externalId" = ref.lead_external
        WHERE o.source = ref.source
          AND o."externalId" = ref.deal_external
          AND o."leadId" IS NULL`,
      ...values.flat(),
    );
  }

  return linked;
}

/**
 * Derives Customer and RevenueEntry rows from deals sitting in a won stage.
 *
 * There is no billing integration, so revenue has no other source. The CRM already knows
 * what closed and for how much, and the Dashboard and Revenue pages read these two tables
 * — without this step they stay empty however complete the CRM import is.
 *
 * Done in SQL rather than a read-modify-write loop because it runs over every won deal on
 * every sync: 7,746 round trips would not finish inside a serverless function.
 *
 * Idempotent in both directions. A revenue entry is keyed on its opportunity, so a
 * re-sync corrects the amount instead of adding a second row; and a deal dragged back out
 * of a won stage has its derived revenue removed, which a pure upsert would have left
 * behind as a sale that never happened.
 */
export async function writeRevenueFromWonDeals(): Promise<number> {
  // Customers whose deal stopped qualifying, removed before the rest runs.
  //
  // The claim above that this is "idempotent in both directions" held for revenue and not
  // for customers: the insert below only ever adds or lowers a date, so a customer derived
  // from a deal that is no longer won — or that lost its close date — was left standing
  // with whatever wonAt it was first given.
  //
  // It went wrong exactly that way. An earlier import stamped won deals that had no
  // Closing_Date with the date of the import; fixing that left those deals with a null
  // closedAt, which drops them out of the SELECT entirely, so 490 customer rows kept a
  // wonAt of the day the import ran. The CRM page then read 490 new customers on a day
  // that had four, and showed it as a 48,900% rise.
  //
  // Only rows this materialiser owns are touched — a customer with no opportunityId was
  // made by hand and is nobody's derived row.
  await db().$executeRawUnsafe(`
    DELETE FROM customer c
    WHERE c."opportunityId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM opportunity o
        JOIN pipeline_stage s ON s.id = o."stageId"
        WHERE o.id = c."opportunityId"
          AND s."isWon"
          AND o.value > 0
          AND o."closedAt" IS NOT NULL
          AND o."closedAt"::date <= current_date
      )
  `);

  // One customer per company — the schema allows only one — dated by that company's
  // earliest win, so "customer since" means what it says.
  //
  // The same three rules revenue is derived by, because a customer and their revenue
  // have to agree about what a win is. They did not: revenue excluded zero-value deals
  // and deals closing in the future, while this counted them — so 129 people whose deal
  // closes as late as 2027, and 478 whose deal is worth nothing, were customers with no
  // revenue. CAC divided spend by an inflated count and revenue-per-customer came out
  // low. Nothing is lost by waiting: this runs on every sync, so a future-dated win
  // becomes a customer by itself on the day its date arrives.
  await db().$executeRawUnsafe(`
    INSERT INTO customer (id, "companyId", "opportunityId", "wonAt", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, d."companyId", d.id, d.won_at, now(), now()
    FROM (
      SELECT DISTINCT ON (o."companyId")
             o."companyId", o.id, o."closedAt" AS won_at
      FROM opportunity o
      JOIN pipeline_stage s ON s.id = o."stageId"
      WHERE s."isWon"
        AND o."companyId" IS NOT NULL
        AND o.value > 0
        AND o."closedAt" IS NOT NULL
        AND o."closedAt"::date <= current_date
      ORDER BY o."companyId", o."closedAt" ASC
    ) d
    ON CONFLICT ("companyId") DO UPDATE
      SET "wonAt" = LEAST(customer."wonAt", EXCLUDED."wonAt"), "updatedAt" = now()
  `);

  // A deal that moved back out of a won stage, lost its value, or had its close date
  // pushed into the future must not leave revenue behind. Only derived rows are touched —
  // manual revenue carries no opportunity.
  await db().$executeRawUnsafe(`
    DELETE FROM revenue_entry r
    WHERE r."opportunityId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM opportunity o
        JOIN pipeline_stage s ON s.id = o."stageId"
        WHERE o.id = r."opportunityId"
          AND s."isWon"
          AND o.value > 0
          AND o."closedAt" IS NOT NULL
          AND o."closedAt"::date <= current_date
      )
  `);

  // Three exclusions, all so the total means money actually earned.
  //
  // Zero-value deals: a won deal with no amount is a bookkeeping gap in the CRM, and
  // importing it as £0 would drag the average down as if the work had been given away.
  //
  // Future close dates: 656 won deals here close as late as 2027, and counting them today
  // would put £2.9m of unearned money into the revenue total. They are not lost — this
  // runs on every sync, so each one appears by itself on the day its date arrives.
  //
  // No close date at all: 982 won deals have none. Revenue has to be dated, and the only
  // dates available are the import's own — which would file the money under whichever
  // month the sync ran in and move it again on the next re-import. Left out until the CRM
  // says when the deal closed.
  return db().$executeRawUnsafe(`
    INSERT INTO revenue_entry (id, "customerId", date, amount, currency, kind, "opportunityId", "campaignId", "channelId", "createdAt")
    SELECT gen_random_uuid()::text, c.id, o."closedAt"::date,
           o.value, o.currency, 'one_time', o.id, o."campaignId",
           COALESCE(l."channelId", o."channelId"), now()
    FROM opportunity o
    -- The channel the originating lead arrived through, so revenue can be attributed to
    -- the thing that produced it. Left join: a deal created directly has no lead.
    --
    -- The lead's channel wins where there is one: it records how the person first reached
    -- the firm, which is the question the Marketing page asks. The deal's own channel is
    -- the fallback, and for most of this CRM it is the only answer there is — 6,886 of
    -- 7,810 deals have no lead at all, so without it 88% of the revenue was unattributed.
    LEFT JOIN lead l ON l.id = o."leadId"
    JOIN pipeline_stage s ON s.id = o."stageId"
    JOIN customer c ON c."companyId" = o."companyId"
    WHERE s."isWon"
      AND o."companyId" IS NOT NULL
      AND o.value > 0
      AND o."closedAt" IS NOT NULL
      AND o."closedAt"::date <= current_date
    ON CONFLICT ("opportunityId") DO UPDATE
      SET amount = EXCLUDED.amount,
          date = EXCLUDED.date,
          currency = EXCLUDED.currency,
          "channelId" = COALESCE(EXCLUDED."channelId", revenue_entry."channelId")
  `);
}
