-- Resumable, incremental syncs.
--
-- A provider with tens of thousands of records cannot be pulled in one request: Zoho CRM
-- here holds ~39,000, which is roughly 195 API calls. Any single-request design is one
-- slow response away from a timeout, and re-pulls everything nightly for no reason.
--
-- syncCursor  — where a pull stopped when it ran out of time. Non-null means a backfill
--               is in progress and the next run should resume rather than start over.
-- syncedThrough — the high-water mark. Once a full pass completes, later syncs ask the
--               provider only for records modified since this instant.
ALTER TABLE "integration" ADD COLUMN "syncCursor" JSONB;
ALTER TABLE "integration" ADD COLUMN "syncedThrough" TIMESTAMP(3);
