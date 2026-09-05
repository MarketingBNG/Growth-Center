-- §15.2, §15.3, §15.4 and §13.
--
-- content_piece holds zero rows, checked against the live database before writing this.
-- That is what makes replacing the enum safe: there is no value to migrate, so the type
-- can be swapped outright rather than through the usual add-then-backfill-then-drop
-- dance. If it ever holds rows, this migration is the wrong shape and a new one is needed.

-- §15.3's nine ordered statuses. `planned` becomes `brief`, `review` splits into
-- `technical_check`, `proofread` and `partner_approval` — the manual's point being that
-- Shweta's technical check and her proofread are two recorded steps, not one habit.
ALTER TYPE "ContentStatus" RENAME TO "ContentStatus_old";

CREATE TYPE "ContentStatus" AS ENUM (
  'idea',
  'brief',
  'draft',
  'technical_check',
  'proofread',
  'partner_approval',
  'scheduled',
  'published',
  'repurposed',
  'archived'
);

ALTER TABLE "content_piece"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "ContentStatus" USING (
    CASE "status"::text
      WHEN 'planned' THEN 'brief'
      WHEN 'review'  THEN 'technical_check'
      ELSE "status"::text
    END
  )::"ContentStatus",
  ALTER COLUMN "status" SET DEFAULT 'idea';

DROP TYPE "ContentStatus_old";

-- §15.2's record. The board had a title, a format and a brief; everything the agent
-- reviews and everything the reports count is below.
ALTER TABLE "content_piece" ADD COLUMN "topicCluster" TEXT;
ALTER TABLE "content_piece" ADD COLUMN "segment" TEXT;
ALTER TABLE "content_piece" ADD COLUMN "serviceLine" TEXT;
ALTER TABLE "content_piece" ADD COLUMN "targetKeyword" TEXT;
ALTER TABLE "content_piece" ADD COLUMN "designerEmail" TEXT;
ALTER TABLE "content_piece" ADD COLUMN "partnerVoice" TEXT;
ALTER TABLE "content_piece" ADD COLUMN "assetUrl" TEXT;
ALTER TABLE "content_piece" ADD COLUMN "createdBy" TEXT;

-- One idea into ten assets. SET NULL, not CASCADE: deleting a webinar must not delete the
-- three articles cut from it. They outlive their parent and go on earning.
ALTER TABLE "content_piece" ADD COLUMN "parentId" TEXT;
ALTER TABLE "content_piece" ADD CONSTRAINT "content_piece_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "content_piece"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "content_piece_parentId_idx" ON "content_piece"("parentId");

-- §13: profiles were the one owned thing in the app with no owner, so "the AA page has
-- not posted in three weeks" was a finding addressed to nobody.
ALTER TABLE "social_account" ADD COLUMN "ownerEmail" TEXT;
