// Prisma 7 moved the connection URL out of schema.prisma. The CLI reads it here;
// the running app builds its own client in lib/prisma.ts.
//
// Read via process.env rather than Prisma's env() helper, which throws when the
// variable is absent — `prisma generate` needs no database and runs on every build.
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env.local — it reads .env only, and Next.js is the thing
// that reads .env.local. So every CLI command (`db:migrate`, `db:deploy`, `db:push`)
// failed with "Connection url is empty" while the variables sat right there in the file.
// Loaded here, nearest-first, rather than adding a dotenv dependency.
//
// Existing environment variables always win, so a real deployment's own DIRECT_URL is
// never overwritten by a stray local file.
for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    process.env[match[1]] ??= match[2].trim().replace(/^["']|["']$/g, '');
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // DIRECT_URL first, and it matters: DATABASE_URL is Neon's -pooler endpoint, and
  // migrations must not go through pgbouncer.
  //
  // `prisma migrate` guards itself with a session-level advisory lock. pgbouncer pools at
  // transaction level, so when migrate exits the lock stays stranded on a pooled server
  // connection that outlives it — and every later deploy fails with P1002, "Timed out
  // trying to acquire a postgres advisory lock", against a connection sitting idle.
  //
  // DIRECT_URL is the same Neon host without the `-pooler` suffix. Only the CLI reads
  // this; the running app still builds its client from DATABASE_URL in lib/prisma.ts,
  // which is exactly where pooling belongs.
  datasource: { url: process.env.DIRECT_URL || process.env.DATABASE_URL || '' },
});
