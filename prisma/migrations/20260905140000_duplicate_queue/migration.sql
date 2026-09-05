-- §8.1 and G5.3: the duplicate merge queue.
--
-- A new table with no backfill. Nothing merges on its own — the scanner proposes and a
-- person decides, so deploying this cannot alter a single existing record.
CREATE TABLE "duplicate_candidate" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "primaryId" TEXT NOT NULL,
    "duplicateId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "matchedOn" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "dismissReason" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "duplicate_candidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "duplicate_candidate_entityType_primaryId_duplicateId_key"
    ON "duplicate_candidate"("entityType", "primaryId", "duplicateId");
CREATE INDEX "duplicate_candidate_status_confidence_idx"
    ON "duplicate_candidate"("status", "confidence");
