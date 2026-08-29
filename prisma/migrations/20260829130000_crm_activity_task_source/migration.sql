-- Activity and Task were seeder-only tables, so they carried no provenance. Importing
-- Zoho's Calls, Events and Tasks needs the same (source, externalId) key every other
-- imported table uses, or a nightly sync would insert the whole history again.
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "externalId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "activity_source_externalId_key" ON "activity" ("source", "externalId");
CREATE UNIQUE INDEX IF NOT EXISTS "task_source_externalId_key" ON "task" ("source", "externalId");

-- The activity feed is read newest-first per source.
CREATE INDEX IF NOT EXISTS "activity_source_createdAt_idx" ON "activity" ("source", "createdAt");
