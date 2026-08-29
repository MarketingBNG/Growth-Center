-- The currency a campaign's budget is stated in, matching the spend rows beneath it.
-- Budget pacing divides one by the other, so a budget in rupees against spend in dollars
-- would report a figure wrong by the exchange rate and give no sign of it.
ALTER TABLE "campaign" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'USD';
