// Prisma 7 moved the connection URL out of schema.prisma. The CLI reads it here;
// the running app builds its own client in lib/prisma.ts.
//
// Read via process.env rather than Prisma's env() helper, which throws when the
// variable is absent — `prisma generate` needs no database and runs on every build.
import { defineConfig } from 'prisma/config';

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
