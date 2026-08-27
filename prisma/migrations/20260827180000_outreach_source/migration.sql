-- Provenance for the outreach tables, so a sequence pulled from Smartlead can be updated
-- in place on the next sync instead of inserted again, and so the Outreach page can tell
-- a real campaign from one the seeder invented.
--
-- Same (source, externalId) pair Campaign, Lead, Contact and Opportunity already carry.
-- Nullable and additive: seeded rows keep NULL, and Postgres treats NULLs as distinct in
-- a unique index, so they all coexist.
ALTER TABLE "sequence" ADD COLUMN "source" TEXT;
ALTER TABLE "sequence" ADD COLUMN "externalId" TEXT;
ALTER TABLE "prospect" ADD COLUMN "source" TEXT;
ALTER TABLE "prospect" ADD COLUMN "externalId" TEXT;

CREATE UNIQUE INDEX "sequence_source_externalId_key" ON "sequence" ("source", "externalId");
CREATE UNIQUE INDEX "prospect_source_externalId_key" ON "prospect" ("source", "externalId");
