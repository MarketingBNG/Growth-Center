-- §8.2, §8.4 and §8.5.
--
-- Every column nullable or defaulted. These record facts the delivery team holds and
-- Zoho does not carry, so there is nothing to backfill and nothing to infer — a call
-- logged against an account is not evidence that a referral was asked for.

-- §8.2: the four lifecycle flags, as dates. "A review was requested in March" is a
-- stronger fact than "a review was requested", and the flag the manual asks for is about
-- recency for a client of three years, not about whether it happened once.
ALTER TABLE "customer" ADD COLUMN "reviewRequestedAt" TIMESTAMP(3);
ALTER TABLE "customer" ADD COLUMN "referralAskedAt" TIMESTAMP(3);
ALTER TABLE "customer" ADD COLUMN "crossSellOfferedAt" TIMESTAMP(3);
ALTER TABLE "customer" ADD COLUMN "renewalDueAt" TIMESTAMP(3);

-- §8.4: the dual-jurisdiction facts.
ALTER TABLE "company" ADD COLUMN "segment" TEXT;
ALTER TABLE "company" ADD COLUMN "entityType" TEXT;
ALTER TABLE "company" ADD COLUMN "jurisdictions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- §8.5: the referral partner registry.
CREATE TABLE "referral_partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partnerType" TEXT NOT NULL DEFAULT 'other',
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "notes" TEXT,
    "ownerEmail" TEXT,
    "lastTouchAt" TIMESTAMP(3),
    "acknowledgementSentAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "referral_partner_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "referral_partner_active_partnerType_idx" ON "referral_partner"("active", "partnerType");

ALTER TABLE "lead" ADD COLUMN "referralPartnerId" TEXT;
ALTER TABLE "opportunity" ADD COLUMN "referralPartnerId" TEXT;

-- SET NULL, not CASCADE. Deleting a partner must never delete the leads they sent: the
-- relationship ended, the business did not.
ALTER TABLE "lead" ADD CONSTRAINT "lead_referralPartnerId_fkey"
  FOREIGN KEY ("referralPartnerId") REFERENCES "referral_partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_referralPartnerId_fkey"
  FOREIGN KEY ("referralPartnerId") REFERENCES "referral_partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "lead_referralPartnerId_idx" ON "lead"("referralPartnerId") WHERE "referralPartnerId" IS NOT NULL;
CREATE INDEX "opportunity_referralPartnerId_idx" ON "opportunity"("referralPartnerId") WHERE "referralPartnerId" IS NOT NULL;
