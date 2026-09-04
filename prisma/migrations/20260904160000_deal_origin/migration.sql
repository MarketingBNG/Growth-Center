-- New business versus repeat, and one-off versus retainer (G1.4, §8.2).
--
-- Both facts are already in the data, written into the deal name by a convention this
-- organisation has used for thousands of records:
--
--     Mosaic Wellness INC_46_Apr'26_One Time
--
-- The counter is per account, so a deal numbered 1 is the first piece of work for that
-- client and anything above it is repeat business. Across the 8,072 deals here that is
-- 1,448 new, 4,426 repeat and 2,198 whose names carry no convention at all.
--
-- Indexed on dealOrigin because the revenue KPIs group by it on every dashboard read.

ALTER TABLE "opportunity"
  ADD COLUMN "dealOrigin"        TEXT,
  ADD COLUMN "engagementType"    TEXT,
  ADD COLUMN "accountSequenceNo" INTEGER;

CREATE INDEX "opportunity_dealOrigin_idx" ON "opportunity" ("dealOrigin");
