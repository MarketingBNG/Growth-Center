-- Per-row provenance for the SEO tables, so the SEO page can tell a ranking reported by
-- a provider from one the seeder invented. Nullable and additive: existing rows keep
-- NULL, which is exactly the right answer for them — they came from the seeder.
ALTER TABLE "seo_keyword" ADD COLUMN "source" TEXT;
ALTER TABLE "seo_page" ADD COLUMN "source" TEXT;
