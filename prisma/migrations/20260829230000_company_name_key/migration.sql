-- The normalised form of the company name, for matching.
--
-- normalizeCompanyName exists so "Acme, Inc." and "acme inc" resolve to one account, but
-- the lookup compared the raw name case-insensitively and threw the normalised value
-- away — so those two produced two accounts, which is the duplicate the function was
-- written to prevent.
--
-- Stored rather than computed per query, so the match stays an indexed equality.
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "nameKey" TEXT;
CREATE INDEX IF NOT EXISTS "company_nameKey_idx" ON "company" ("nameKey");

-- Deliberately NOT backfilled in SQL.
--
-- A first attempt reimplemented normalizeCompanyName as nested regexp_replace calls, and
-- on this database the backslash classes did not survive the string literal: '\s+' struck
-- out literal "s" characters, turning "Solutions" into "olution", and '\y' matched nothing
-- so the legal-form suffixes were left in place. It would have written a corrupted key for
-- every one of the 2,953 companies, and a corrupted key matches nothing.
--
-- The rule now has one implementation, in TypeScript, and every writer applies it — the
-- CRM import rewrites all companies on its next pass, so the column fills itself with
-- exactly the values the lookup compares against.
