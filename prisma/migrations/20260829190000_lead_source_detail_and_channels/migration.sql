-- The lead source exactly as the CRM wrote it, beside the SourceType it maps to.
--
-- SourceType is a shared vocabulary and collapses "ig", "fb", "Whatsapp" and
-- "Incorporation LinkdIn" into one value, `social` — 17,789 leads, the largest group in
-- the account. Which platform actually produced them is the question the Marketing page
-- exists to answer, so the original has to survive the import.
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "sourceDetail" TEXT;
CREATE INDEX IF NOT EXISTS "lead_sourceDetail_idx" ON "lead" ("sourceDetail");

-- Channels for the sources this account actually uses. Organic social had none at all,
-- and LinkedIn is not a synonym for Instagram.
INSERT INTO "channel" ("id", "name", "slug", "kind", "createdAt") VALUES
  (gen_random_uuid()::text, 'Instagram', 'instagram', 'social',   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Facebook',  'facebook',  'social',   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'WhatsApp',  'whatsapp',  'social',   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Events',    'events',    'other',    CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Outreach',  'outreach',  'other',    CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
