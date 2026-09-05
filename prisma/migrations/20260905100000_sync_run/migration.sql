-- G5.1: every sync writes a run row.
--
-- A new table with no backfill. The history starts at the first run after deploy, and the
-- freshness panel says so rather than presenting an empty chart as "no failures" — an
-- absence of records is not a record of absence.
CREATE TABLE "sync_run" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "rows" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "detail" TEXT,
    "error" TEXT,
    "complete" BOOLEAN NOT NULL DEFAULT true,
    "actorEmail" TEXT,
    CONSTRAINT "sync_run_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sync_run_provider_startedAt_idx" ON "sync_run"("provider", "startedAt");
CREATE INDEX "sync_run_startedAt_idx" ON "sync_run"("startedAt");
