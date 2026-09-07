-- Real time slots on the content calendar.
--
-- September's master sheet schedules every post to the minute — "9:30 AM IST", "6:00 PM
-- IST" — and there was nowhere to put it, so the slot survived only as a line of prose
-- inside the brief. A calendar where the times are text is a calendar that cannot put
-- three posts on the 7th in the order they go out.
--
-- Minutes from midnight, wall-clock, in the firm's own timezone: 570 is 09:30, 1080 is
-- 18:00. NOT folded into publishDate, which is a day held as midnight UTC and read back
-- with getUTCDate() throughout the calendar — a time on that column would move anything
-- before 05:30 IST into the previous day's cell.
ALTER TABLE "content_piece" ADD COLUMN "publishMinute" INTEGER;

-- The asset in the studio's own words. `format` has six values and every social post is
-- `social` under it, which left a single static and a five-slide carousel identical after
-- import. This is what a producer reads.
ALTER TABLE "content_piece" ADD COLUMN "assetShape" TEXT;

-- The running order within a day is the query the calendar now makes.
DROP INDEX IF EXISTS "content_piece_publishDate_idx";
CREATE INDEX "content_piece_publishDate_publishMinute_idx"
    ON "content_piece"("publishDate", "publishMinute");
