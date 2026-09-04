-- The sequence registry (§14.2 of the Build and Operating Manual).
--
-- Purpose, segment, service line and sending domain describe what a campaign is for; the
-- four approval columns record who signed the copy and who verified the figures in it.
--
-- The two hash columns are the part worth explaining. An approval is an approval of what
-- was read, and these templates are re-synced from Smartlead nightly — so without a record
-- of the text at sign-off, an approval given on Monday silently stands over whatever the
-- copy says on Friday. Each hash is taken from the steps at the moment of approval and
-- compared on read; a mismatch reports the approval as stale rather than valid.
--
-- Every column is nullable and none is written by a sync. writeOutreach() upserts only
-- name, status, source and externalId, so a nightly pull cannot clear an approval.

ALTER TABLE "sequence"
  ADD COLUMN "purpose"                TEXT,
  ADD COLUMN "segment"                TEXT,
  ADD COLUMN "serviceLine"            TEXT,
  ADD COLUMN "sendingDomain"          TEXT,
  ADD COLUMN "copyApprovedByEmail"    TEXT,
  ADD COLUMN "copyApprovedAt"         TIMESTAMP(3),
  ADD COLUMN "numbersVerifiedByEmail" TEXT,
  ADD COLUMN "numbersVerifiedAt"      TIMESTAMP(3),
  ADD COLUMN "copyApprovedHash"       TEXT,
  ADD COLUMN "numbersVerifiedHash"    TEXT;
