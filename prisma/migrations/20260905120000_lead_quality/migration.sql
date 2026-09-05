-- §7.3, §7.4, §7.6, §7.7 and G1.2.
--
-- All nullable or defaulted, all additive. Nothing here changes a figure until
-- tools/backfill-lead-quality.ts runs, which is what makes the schema safe to deploy
-- separately from the classification it enables.
ALTER TABLE "lead" ADD COLUMN "scoreVersion" INTEGER;
ALTER TABLE "lead" ADD COLUMN "segment" TEXT;
ALTER TABLE "lead" ADD COLUMN "lostReason" TEXT;
ALTER TABLE "lead" ADD COLUMN "attributionConfidence" TEXT;
ALTER TABLE "lead" ADD COLUMN "isClient" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "lead" ADD COLUMN "isReferralPartner" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "opportunity" ADD COLUMN "attributionConfidence" TEXT;

-- The lead list filters and the dashboard's segment mix both group by these, over 27,575
-- rows. Partial where it is worth being: most leads carry no lost reason at all.
CREATE INDEX "lead_segment_idx" ON "lead"("segment") WHERE "segment" IS NOT NULL;
CREATE INDEX "lead_lostReason_idx" ON "lead"("lostReason") WHERE "lostReason" IS NOT NULL;
CREATE INDEX "lead_score_idx" ON "lead"("score");
