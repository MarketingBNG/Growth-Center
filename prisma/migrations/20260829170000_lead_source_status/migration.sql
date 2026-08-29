-- The status exactly as the CRM wrote it, beside the one it maps to.
--
-- The mapped LeadStatus is a small fixed vocabulary shared across providers, so it has to
-- collapse "Dead Lead", "Follow-up" and "Not Reachable" into `lost` and `contacted`. Those
-- distinctions are the ones this team works to — SQ, Follow-up, CNR, Dead — so the
-- original has to survive the import for the CRM page to show them.
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "sourceStatus" TEXT;
CREATE INDEX IF NOT EXISTS "lead_sourceStatus_idx" ON "lead" ("sourceStatus");
