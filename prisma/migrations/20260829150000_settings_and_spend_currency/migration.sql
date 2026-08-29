-- A small key/value store for workspace preferences. JSON rather than a column per
-- setting: these are read as a block by the app and adding one should not be a migration.
CREATE TABLE IF NOT EXISTS "app_setting" (
  "key"       TEXT PRIMARY KEY,
  "value"     JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Spend had no currency at all. The Meta account here bills in INR and every figure was
-- rendered with a dollar sign, so a ₹292 cost per lead read as $292 and ROAS divided
-- dollars of revenue by rupees of spend.
ALTER TABLE "marketing_spend" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'USD';
