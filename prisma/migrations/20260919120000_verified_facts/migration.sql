-- Verified facts register (pack WP09).
--
-- Additive only: one new enum, one new table, its indexes and a self-referencing foreign
-- key. Nothing here touches an existing table.
--
-- Written by hand rather than taken from `prisma migrate diff`. The generated diff also
-- carried statements removing lead_score_idx and opportunity_channelId_idx, and an ALTER
-- on app_setting.updatedAt — pre-existing drift between the live database and
-- schema.prisma that has nothing to do with this change. They are left out deliberately:
-- folding them in would have dropped two production indexes under the title of a facts
-- migration. The drift is real and worth settling, separately and on purpose.

-- CreateEnum
CREATE TYPE "FactStatus" AS ENUM ('draft', 'proposed', 'approved', 'retired');

-- CreateTable
CREATE TABLE "verified_fact" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "numericValue" DECIMAL(18,4),
    "unit" TEXT,
    "jurisdiction" TEXT NOT NULL,
    "authority" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceExcerpt" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "status" "FactStatus" NOT NULL DEFAULT 'draft',
    "reviewerEmail" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "supersedesId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verified_fact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verified_fact_key_key" ON "verified_fact"("key");

-- CreateIndex
CREATE UNIQUE INDEX "verified_fact_supersedesId_key" ON "verified_fact"("supersedesId");

-- CreateIndex
CREATE INDEX "verified_fact_status_idx" ON "verified_fact"("status");

-- CreateIndex
CREATE INDEX "verified_fact_jurisdiction_idx" ON "verified_fact"("jurisdiction");

-- AddForeignKey
ALTER TABLE "verified_fact" ADD CONSTRAINT "verified_fact_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "verified_fact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
