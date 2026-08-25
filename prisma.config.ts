// Prisma 7 moved the connection URL out of schema.prisma. The CLI reads it here;
// the running app builds its own client in lib/prisma.ts.
//
// Read via process.env rather than Prisma's env() helper, which throws when the
// variable is absent — `prisma generate` needs no database and runs on every build.
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
