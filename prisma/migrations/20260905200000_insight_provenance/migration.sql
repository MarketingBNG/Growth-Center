-- Appendix B's last three fields, and §19.3's idempotency key.
--
-- All nullable. Existing insights genuinely have no prompt version and no context hash —
-- they were written before either was recorded — and a default would assert a provenance
-- that does not exist, which is the opposite of what these columns are for.
ALTER TABLE "ai_insight" ADD COLUMN "promptVersion" TEXT;
ALTER TABLE "ai_insight" ADD COLUMN "contextHash" TEXT;
ALTER TABLE "ai_insight" ADD COLUMN "taskId" TEXT;

-- Unique, which is the whole of §19.3: "one task per insight, ever". A task renamed in
-- Zoho Projects stays matched, because the key is the id and not the title.
CREATE UNIQUE INDEX "ai_insight_taskId_key" ON "ai_insight"("taskId");
