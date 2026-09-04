import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ROWS, MAX_TOOL_ROUNDS, READ_TOOLS, TABLES, runReadTool } from '../lib/ai-tools.ts';

// The allowlist IS the security boundary, so it is asserted rather than trusted. These run
// without a database: the invariants worth protecting are properties of the table list and
// the tool definitions, not of any query result.

test('the tables holding secrets are not readable', () => {
  // integration_credential holds sealed OAuth refresh tokens for Zoho, Meta and Google;
  // api_key holds hashed keys. Their absence from this list is the whole of their
  // protection — there is no second check further down.
  assert.equal(TABLES.integrationCredential, undefined);
  assert.equal(TABLES.apiKey, undefined);
});

test('the allowlist is a list, not a filter over everything', () => {
  // The point of an allowlist is that a table added to the schema later is unreadable until
  // somebody puts it here deliberately. If this ever starts deriving from the Prisma client
  // or the DMMF, that property is gone and the test above stops meaning anything.
  assert.ok(Object.keys(TABLES).length > 20, 'suspiciously few tables — did the list break?');
  assert.ok(Object.keys(TABLES).length < 40, 'suspiciously many — is this deriving from the client?');
  for (const [name, purpose] of Object.entries(TABLES)) {
    assert.equal(typeof purpose, 'string');
    assert.ok(purpose.length > 10, `${name} has no usable description`);
  }
});

test('an unlisted table is refused by name, before any query runs', async () => {
  for (const table of ['integrationCredential', 'apiKey', 'appSetting', 'nonsense', '', 'user']) {
    const result = await runReadTool('count', { table });
    assert.equal(result.ok, false, `${table} was not refused`);
    assert.match(result.error, /not a readable table/);
  }
});

test('a non-string table cannot slip through', async () => {
  // The arguments arrive as parsed JSON from the model, so the type is whatever it sent.
  for (const table of [null, undefined, 42, {}, ['lead'], true]) {
    const result = await runReadTool('query', { table });
    assert.equal(result.ok, false, `${JSON.stringify(table)} was not refused`);
  }
});

test('an unknown tool name is refused', async () => {
  const result = await runReadTool('delete_everything', { table: 'lead' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown tool/);
});

test('describe_tables lists the tables without touching the database', async () => {
  const result = await runReadTool('describe_tables', {});

  assert.equal(result.ok, true);
  const listed = result.data as Record<string, string>;
  assert.deepEqual(Object.keys(listed), Object.keys(TABLES));
  for (const [table, purpose] of Object.entries(TABLES)) {
    assert.ok(listed[table].startsWith(purpose), table);
  }
});

// The withheld fields are named in the list, not only in the per-table detail and not only
// in a refusal. A model that learns a field is unreadable by being refused spends a round
// trip finding out and reports it to the reader as an error rather than as a limit.
test('the table list says which fields are withheld', async () => {
  const result = await runReadTool('describe_tables', {});
  const listed = (result as { data: Record<string, string> }).data;

  assert.match(listed.lead, /Withheld and not readable: .*email/);
  // A table with nothing redacted gets no such sentence, so its absence means something.
  assert.ok(!listed.opportunity.includes('Withheld'));
});

test('describe_tables gives fields for a named table', async () => {
  const result = await runReadTool('describe_tables', { tables: ['lead'] });

  assert.equal(result.ok, true);
  const described = result.data as Record<string, { purpose: string; fields: string }>;
  // The fields are generated from the schema, so this asserts a few that must be there for
  // the model to answer anything about lead ownership or the CRM's own status wording.
  assert.match(described.lead.fields, /ownerEmail/);
  assert.match(described.lead.fields, /sourceStatus/);
  assert.match(described.lead.fields, /qualifiedAt/);
});

test('describe_tables refuses an unlisted table too', async () => {
  // Otherwise it becomes a way to read the field names of the credential tables, which is
  // not a leak of secrets but is a map of where they are.
  const result = await runReadTool('describe_tables', { tables: ['lead', 'integrationCredential'] });

  assert.equal(result.ok, false);
  assert.match(result.error, /not a readable table/);
});

test('group refuses to run without a grouping field', async () => {
  const result = await runReadTool('group', { table: 'lead', by: [] });

  assert.equal(result.ok, false);
  assert.match(result.error, /at least one field/);
});

// ── the tool definitions the model is given ───────────────────────────────────

test('every tool is a read', () => {
  // The names are the contract. A tool called anything that implies a write should never
  // appear here, and the four that do exist map onto findMany, count and groupBy only.
  assert.deepEqual(
    READ_TOOLS.map((t) => t.name).sort(),
    ['count', 'describe_tables', 'group', 'query'],
  );
  for (const tool of READ_TOOLS) {
    assert.equal(tool.type, 'function');
    assert.doesNotMatch(tool.name, /create|update|delete|insert|write|upsert|set/);
  }
});

test('the row cap is stated to the model, not just enforced', () => {
  // A cap the model does not know about produces confident answers off the first 50 rows.
  const query = READ_TOOLS.find((t) => t.name === 'query');
  assert.ok(query);
  assert.match(query.description, new RegExp(String(MAX_ROWS)));
});

test('the caps are set to values that bound a single question', () => {
  assert.ok(MAX_ROWS <= 100, 'a row cap above 100 stops bounding context size');
  assert.ok(MAX_TOOL_ROUNDS <= 10, 'more rounds than this is a bill, not an answer');
});
