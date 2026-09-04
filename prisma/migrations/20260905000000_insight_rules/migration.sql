-- Rule provenance on findings. §20.1: every insight originates in a deterministic rule,
-- and the model narrates rather than computes. These columns are what make that
-- checkable after the fact.
--
-- All nullable. The seeded samples were never produced by a rule and the findings written
-- before the engine existed were produced by the model alone; giving either a rule id
-- would be a false claim about where the number came from.
ALTER TABLE "ai_insight" ADD COLUMN "ruleId" TEXT;
ALTER TABLE "ai_insight" ADD COLUMN "ruleVersion" INTEGER;
ALTER TABLE "ai_insight" ADD COLUMN "section" TEXT;
ALTER TABLE "ai_insight" ADD COLUMN "evidence" JSONB;
ALTER TABLE "ai_insight" ADD COLUMN "periodStart" TIMESTAMP(3);
ALTER TABLE "ai_insight" ADD COLUMN "periodEnd" TIMESTAMP(3);

CREATE INDEX "ai_insight_ruleId_idx" ON "ai_insight"("ruleId");
