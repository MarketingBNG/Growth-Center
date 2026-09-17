// The spine the backfills and one-off fixes in this directory share.
//
// Each of them had grown the same four blocks. Seven carried a byte-identical hand-rolled
// .env.local parser, while four others had already dropped theirs in favour of node's own
// --env-file-if-exists — two solutions to one problem, and the parser was the loser. Ten
// opened with the same `--apply` flag beside the same pg.Client. Ten ended a dry run with
// the same three lines. Seven wrapped their writes in the same BEGIN/COMMIT/ROLLBACK
// frame, character for character.
//
// None of them checked DATABASE_URL first, so a run that forgot the env flag failed inside
// the driver with a message about a missing password rather than about the flag.

import pg from 'pg';

/** Whether the run was asked to write. Dry by default: these scripts edit live rows. */
export const apply = process.argv.includes('--apply');

/**
 * A connected client, or a clear exit.
 *
 * The env flag is easy to leave off — half this directory's scripts document an invocation
 * without it — and pg's own failure for an undefined connection string names neither the
 * variable nor the flag.
 */
export async function connect(): Promise<pg.Client> {
  if (!process.env.DATABASE_URL) {
    console.error(
      'DATABASE_URL is not set.\n' +
        'Run with:  node --experimental-strip-types --env-file-if-exists=.env.local <script> [--apply]',
    );
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

/**
 * Ends a dry run.
 *
 * Takes the whole line rather than building one, because what a dry run should say differs
 * per script — how many rows would change, whether they would be written or deleted — and
 * a summary is the part somebody actually reads before passing --apply.
 */
export async function stopUnlessApplying(client: pg.Client, line: string): Promise<void> {
  if (apply) return;
  console.log(line);
  await client.end();
  process.exit(0);
}

/** Runs `write` inside a transaction, rolling back and rethrowing if it throws. */
export async function transact<T>(client: pg.Client, write: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await write();
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

/**
 * The `($1, $2), ($3, $4::int), …` of a chunked multi-row UPDATE.
 *
 * Three scripts computed these offsets by hand, each with its own arithmetic and its own
 * columns-per-row. A placeholder list that is wrong by one does not fail loudly — it binds
 * a value to the wrong column, which in a backfill means writing the wrong rows to the
 * wrong records.
 *
 * `casts` is one entry per column, naming a Postgres type where the column needs one and
 * null where it does not. A VALUES list carries no type information of its own, so the
 * cast is what stops an integer column arriving as text.
 */
export function placeholders(rows: number, casts: readonly (string | null)[], from = 1): string {
  return Array.from({ length: rows }, (_, r) =>
    `(${casts
      .map((cast, c) => `$${from + r * casts.length + c}${cast ? `::${cast}` : ''}`)
      .join(', ')})`,
  ).join(', ');
}

/**
 * The pass/fail tally the smoke scripts and verify-seed share.
 *
 * All three had the same three-line `check` and the same five-line exit, differing only in
 * whether the array was called `failures` or `problems`. `report` exits non-zero when
 * anything failed, which is what makes these usable from a shell.
 */
export function checker() {
  const failures: string[] = [];
  return {
    failures,
    check(ok: boolean, message: string) {
      console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
      if (!ok) failures.push(message);
    },
    report(): never | void {
      if (failures.length) {
        console.error(`\n${failures.length} check(s) failed.`);
        process.exit(1);
      }
      console.log('\nAll checks passed.');
    },
  };
}

/** Splits `items` into chunks of at most `size`. */
export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
