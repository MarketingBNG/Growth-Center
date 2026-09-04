-- Where dealOrigin came from: 'name' (read off the deal name) or 'account-history'
-- (inferred from whether the account had an earlier deal). Nullable, and null wherever
-- dealOrigin is null or 'unknown'.
--
-- Backfilled by tools/backfill-deal-origin.ts, which sets it in both passes.
ALTER TABLE "opportunity" ADD COLUMN "originSource" TEXT;
