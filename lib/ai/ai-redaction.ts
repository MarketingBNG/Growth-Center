// §20.7: "No taxpayer PII in any prompt. Client financial and identity fields are stripped
// at ingestion, not at prompt time."
//
// Stripped at the read, which is the closest this application can get to ingestion: the
// data arrives from Zoho because the CRM is the system of record and the app is a reader of
// it, so there is no ingestion point at which a name could be dropped without breaking the
// Leads page, which exists to show names to the people who own those leads.
//
// What this does instead is narrow the one path that sends data to a third party. The
// screens still show a lead's name and email to a signed-in colleague, and the model never
// receives them.
//
// ── Columns, not tables ───────────────────────────────────────────────────────────────
//
// The obvious move is to drop `lead` and `contact` from the allowlist, and it would cost
// far more than it saves: deal-to-lead attribution runs through those tables, and "which
// channel produced the revenue" is answered by joining them. Every question the assistant
// is actually asked is about counts, values, owners and dates — none of which is PII.
//
// So the tables stay and the identifying columns go. What is lost is narrow and worth
// naming: nothing can answer "what did this lead say" or "give me their email", and a
// question about a specific named person cannot be answered at all.
//
// ── Why `where` and `by` are filtered too ─────────────────────────────────────────────
//
// Removing a column from the output is half a redaction. `count` with
// `where: { email: 'someone@example.com' }` returns 1 or 0 and reveals the value that was
// hidden; `group` by `email` lists every address in the table under the guise of a total.
// Both are refused rather than silently ignored, because a filter that is dropped without
// a word turns a question about one person into a figure about everybody.

/**
 * The columns the model never sees, per table.
 *
 * Staff addresses are deliberately absent. `ownerEmail`, `assigneeEmail`, `actorEmail` and
 * `authorEmail` are colleagues, not clients — they are already on every screen, they are
 * how ownership questions are answered at all, and the findings name them by design.
 *
 * `companyName` is absent for the same kind of reason: a company is not a person, and the
 * firm's clients are businesses whose names appear in the pipeline the model is asked
 * about. Redacting it would leave every revenue question unanswerable.
 */
export const REDACTED: Record<string, string[]> = {
  // The enquiry itself. `message` is whatever a stranger typed into a form, which is the
  // single most likely place for a tax detail or a figure about their own affairs.
  lead: ['firstName', 'lastName', 'email', 'phone', 'message'],
  // People at client companies. Named individuals at the firm's own clients.
  contact: ['firstName', 'lastName', 'email', 'phone', 'linkedin'],
  // A company's switchboard is business contact detail, but its free-text notes are where
  // somebody records what was discussed.
  company: ['phone', 'notes'],
  // Free text written about a record, by staff, about a client's affairs.
  note: ['body'],
  // The summary of a call or meeting. The activity's type and date are the useful part and
  // stay; what was said does not.
  activity: ['summary', 'detail'],
  // Outreach recipients: people who have not asked to hear from the firm at all.
  prospect: ['email', 'firstName', 'lastName'],
};

/** Whether a table has anything redacted. */
export function hasRedactions(table: string): boolean {
  return (REDACTED[table]?.length ?? 0) > 0;
}

/** The Prisma `omit` clause for a table, or undefined when it has nothing redacted. */
export function omitFor(table: string): Record<string, true> | undefined {
  const fields = REDACTED[table];
  if (!fields?.length) return undefined;
  return Object.fromEntries(fields.map((f) => [f, true as const]));
}

/**
 * A redacted field named anywhere in a `where` clause, however deeply nested.
 *
 * Recurses through `AND`/`OR`/`NOT` and through relation filters, because
 * `{ contact: { is: { email: 'x' } } }` reaches the same value by a longer route. A
 * redaction that only checked top-level keys would be a redaction in name.
 */
export function redactedInFilter(table: string, where: unknown, depth = 0): string | null {
  if (depth > 8 || where === null || typeof where !== 'object') return null;

  if (Array.isArray(where)) {
    for (const item of where) {
      const found = redactedInFilter(table, item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const fields = REDACTED[table] ?? [];
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (fields.includes(key)) return key;

    // The boolean combinators stay on the same table.
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      const found = redactedInFilter(table, value, depth + 1);
      if (found) return found;
      continue;
    }

    // A relation filter changes which table's redactions apply. The relation's name is not
    // the table's name in every case, so this checks the key against every table that has
    // redactions rather than trying to resolve the relation — broader than necessary, and
    // the failure mode of being too broad is a refused query rather than a leaked one.
    if (value !== null && typeof value === 'object') {
      for (const other of Object.keys(REDACTED)) {
        const found = redactedInFilter(other, value, depth + 1);
        if (found) return found;
      }
    }
  }
  return null;
}

/** A redacted field asked for in a `select`, or in `group`'s `by`. */
export function redactedInFields(table: string, fields: unknown): string | null {
  const redacted = REDACTED[table] ?? [];
  if (Array.isArray(fields)) {
    return fields.find((f): f is string => typeof f === 'string' && redacted.includes(f)) ?? null;
  }
  if (fields !== null && typeof fields === 'object') {
    const asked = Object.entries(fields as Record<string, unknown>)
      .filter(([, v]) => v)
      .map(([k]) => k);
    return asked.find((f) => redacted.includes(f)) ?? null;
  }
  return null;
}

/**
 * What the model is told when it asks for something redacted.
 *
 * Names the field and says why, rather than reporting it as an unknown column. A model
 * told a field does not exist calls describe_tables, finds it missing, and then tries the
 * next-nearest name; one told the field is withheld reports the limit to the person who
 * asked, which is the honest outcome.
 */
export function refusal(table: string, field: string): string {
  return `\`${field}\` on \`${table}\` is withheld: identifying and free-text fields are not readable here, so nothing that reaches this assistant carries a client's name, contact details or what they wrote. Counts, values, owners, dates and channels are all readable — ask in those terms.`;
}

/**
 * A table's field signature with the withheld fields removed.
 *
 * The signature is a space-separated `name:Type` list. Splitting on whitespace is safe
 * because no type in it contains a space — and if one ever did, the failure would be a
 * field left in the list that is still refused at query time, not one that becomes
 * readable.
 */
export function withoutRedacted(table: string, fields: string): string {
  const redacted = REDACTED[table];
  if (!redacted?.length) return fields;
  return fields
    .split(/\s+/)
    .filter((token) => !redacted.includes(token.split(':')[0]))
    .join(' ');
}

/** The sentence appended to a redacted table's description, so the limit is known upfront. */
export function describeRedactions(table: string): string {
  const fields = REDACTED[table];
  if (!fields?.length) return '';
  return ` Withheld and not readable: ${fields.join(', ')}.`;
}
