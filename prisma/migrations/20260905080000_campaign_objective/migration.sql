-- G4: hiring advertising is not acquisition spend.
--
-- Nullable with no default and no backfill here. `isAcquisition` treats null as
-- acquisition, so every existing row keeps counting exactly as it does today until
-- tools/backfill-campaign-objective.ts classifies it — this migration cannot change a
-- figure on a screen, which is what makes it safe to deploy ahead of the backfill.
ALTER TABLE "campaign" ADD COLUMN "objective" TEXT;
ALTER TABLE "campaign" ADD COLUMN "platformObjective" TEXT;
ALTER TABLE "campaign" ADD COLUMN "landingPage" TEXT;
