-- The channel a deal was credited to by the CRM, on the deal itself.
--
-- Revenue attribution walked opportunity -> lead -> channel, and only 924 of 7,810 deals
-- carry a leadId: the rest were opened straight on an account or contact. So 88% of the
-- money could not be attributed to anything, while Zoho's own Lead_Source sat on every one
-- of those deals unread.
--
-- Nullable, and SET NULL on delete, matching how lead."channelId" already behaves.
ALTER TABLE "opportunity" ADD COLUMN "channelId" TEXT;

ALTER TABLE "opportunity"
  ADD CONSTRAINT "opportunity_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "opportunity_channelId_idx" ON "opportunity"("channelId");
