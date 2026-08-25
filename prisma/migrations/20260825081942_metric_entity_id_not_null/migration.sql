-- entityId becomes NOT NULL with '' meaning "no particular entity".
--
-- Postgres treats NULLs as distinct in a unique index, so while this column was
-- nullable the unique constraint did not actually dedupe whole-site metrics: the same
-- (source, entityType, metricKey, date) could be inserted repeatedly, and the upsert in
-- lib/integrations/service.ts could never match an existing row. Site metrics would
-- have double-counted as soon as a real provider synced alongside the seeded rows.
--
-- Backfill first, then tighten the column.
UPDATE "metric_snapshot" SET "entityId" = '' WHERE "entityId" IS NULL;

ALTER TABLE "metric_snapshot" ALTER COLUMN "entityId" SET DEFAULT '',
ALTER COLUMN "entityId" SET NOT NULL;
