-- Provenance for CRM records, so a sync can update the row it wrote last time instead of
-- inserting a duplicate on every run — the same (source, externalId) pair Campaign has
-- carried since the Meta Ads sync started materialising campaigns.
--
-- Nullable and additive: seeded and hand-entered rows keep NULL, which is the honest
-- answer for them. Postgres treats NULLs as distinct in a unique index, so every one of
-- those rows still coexists happily under this constraint.
ALTER TABLE "lead" ADD COLUMN "source" TEXT;
ALTER TABLE "lead" ADD COLUMN "externalId" TEXT;
ALTER TABLE "contact" ADD COLUMN "source" TEXT;
ALTER TABLE "contact" ADD COLUMN "externalId" TEXT;
ALTER TABLE "opportunity" ADD COLUMN "source" TEXT;
ALTER TABLE "opportunity" ADD COLUMN "externalId" TEXT;
ALTER TABLE "company" ADD COLUMN "source" TEXT;
ALTER TABLE "company" ADD COLUMN "externalId" TEXT;

CREATE UNIQUE INDEX "lead_source_externalId_key" ON "lead" ("source", "externalId");
CREATE UNIQUE INDEX "contact_source_externalId_key" ON "contact" ("source", "externalId");
CREATE UNIQUE INDEX "opportunity_source_externalId_key" ON "opportunity" ("source", "externalId");
CREATE UNIQUE INDEX "company_source_externalId_key" ON "company" ("source", "externalId");
