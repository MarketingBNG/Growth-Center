-- Identity for AI findings across runs.
--
-- Regeneration deleted every generated row and wrote a new set, so a finding in its
-- fourth month was indistinguishable from one raised this morning, and a dismissal
-- survived until the next run. These columns let a run recognise a finding it has seen.
--
-- All nullable: the rows already in the table were written without a subject and cannot
-- be given one retrospectively. They keep a null fingerprint, which the unique index
-- permits any number of — Postgres does not treat nulls as equal — so they neither
-- collide with each other nor match anything a future run produces.
ALTER TABLE "ai_insight" ADD COLUMN "subject" TEXT;
ALTER TABLE "ai_insight" ADD COLUMN "fingerprint" TEXT;
ALTER TABLE "ai_insight" ADD COLUMN "firstSeenAt" TIMESTAMP(3);
ALTER TABLE "ai_insight" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "ai_insight" ADD COLUMN "resolvedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "ai_insight_fingerprint_key" ON "ai_insight"("fingerprint");
CREATE INDEX "ai_insight_resolvedAt_idx" ON "ai_insight"("resolvedAt");
