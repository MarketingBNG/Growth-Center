-- D8: "Reviewed" was one state standing for two different acts. §5.1 has Abhuday review
-- and Shweta approve, and a queue that cannot tell them apart cannot show either person
-- what is waiting on them.
--
-- Additive and nullable. Every existing row keeps the state it has: a finding currently
-- `reviewed` stays reviewed, which is now the honest reading of it — reviewed, not yet
-- approved — rather than being promoted to a signature nobody gave.
ALTER TABLE "ai_insight" ADD COLUMN "approvedByEmail" TEXT;
ALTER TABLE "ai_insight" ADD COLUMN "approvedAt" TIMESTAMP(3);
