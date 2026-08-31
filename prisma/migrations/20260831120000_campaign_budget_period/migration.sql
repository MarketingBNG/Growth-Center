-- Whether Campaign.budget is a per-day allowance or one for the whole run.
ALTER TABLE "campaign" ADD COLUMN "budgetPeriod" TEXT;

-- Every budget on record came from Meta's campaigns edge, which is read daily-first and
-- only falls back to a lifetime figure. The next sync restates each one from the API;
-- this makes the existing rows readable before it runs, rather than leaving pacing to
-- treat a daily budget as a lifetime one for another day.
UPDATE "campaign" SET "budgetPeriod" = 'daily'
 WHERE "budget" IS NOT NULL AND "source" = 'meta_ads';
