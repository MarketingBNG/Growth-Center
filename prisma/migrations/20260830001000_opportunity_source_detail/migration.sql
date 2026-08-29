-- The CRM's own wording for a deal's source, kept beside the mapped channel.
--
-- 6,335 deals reached no channel and there is no way to tell whether Zoho holds no source
-- for them or holds one this app does not yet map. Lead.sourceDetail answers exactly that
-- question for leads; this is the same column for deals.
ALTER TABLE "opportunity" ADD COLUMN "sourceDetail" TEXT;
