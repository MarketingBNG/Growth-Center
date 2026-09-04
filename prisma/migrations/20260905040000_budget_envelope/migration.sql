-- §22: Akshay "sets the budget envelope by channel", per quarter, "recorded with his
-- identity". Shweta approves movements inside it.
--
-- Not Campaign.budget, which is the ad platform's own figure imported by the sync — that
-- is what Meta was told to spend, and pacing against it can only say whether the platform
-- did as it was told. This is what the firm decided to spend.
CREATE TABLE "budget_envelope" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "setByEmail" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_envelope_pkey" PRIMARY KEY ("id")
);

-- One envelope per channel per period. A second would make "the envelope" ambiguous and
-- every figure derived from it would depend on which row was read first.
CREATE UNIQUE INDEX "budget_envelope_channelId_periodStart_periodEnd_key"
    ON "budget_envelope"("channelId", "periodStart", "periodEnd");
CREATE INDEX "budget_envelope_periodStart_periodEnd_idx"
    ON "budget_envelope"("periodStart", "periodEnd");

ALTER TABLE "budget_envelope" ADD CONSTRAINT "budget_envelope_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
