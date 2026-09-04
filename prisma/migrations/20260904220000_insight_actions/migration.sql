-- The action lifecycle for AI findings. §20.1: every insight becomes an action item with
-- an owner, or it is dismissed with a written reason.
--
-- `status` is NOT NULL with a default, so every row already in the table becomes
-- 'proposed' — which is what they are: written, never acted on, because until now there
-- was nothing to act with.
--
-- The one exception is the rows someone has already dismissed. Those carry a dismissedAt
-- and must not come back as open work, so they are moved to 'dismissed' in the same
-- migration. They have no review note and cannot be given one retrospectively; the column
-- stays null and the page reads that as "dismissed before a reason was asked for", which
-- is true.
ALTER TABLE "ai_insight" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'proposed';
ALTER TABLE "ai_insight" ADD COLUMN "severity" TEXT;
ALTER TABLE "ai_insight" ADD COLUMN "proposedAction" TEXT;
ALTER TABLE "ai_insight" ADD COLUMN "ownerEmail" TEXT;
ALTER TABLE "ai_insight" ADD COLUMN "reviewNote" TEXT;
ALTER TABLE "ai_insight" ADD COLUMN "reviewedByEmail" TEXT;
ALTER TABLE "ai_insight" ADD COLUMN "reviewedAt" TIMESTAMP(3);

UPDATE "ai_insight" SET "status" = 'dismissed' WHERE "dismissedAt" IS NOT NULL;

CREATE INDEX "ai_insight_status_idx" ON "ai_insight"("status");
