-- The envelope period becomes text, holding "YYYY-MM-DD".
--
-- As DATE columns these were written by Prisma from the JS Date's UTC parts and read back
-- by node-postgres as midnight in the process's own timezone. An envelope for Q3 2026
-- stored as 2026-06-30 in an IST process; the lookup only found it because both halves
-- were wrong in the same direction. A row written in one timezone and read in another
-- would not have matched — which is precisely dev in IST and production in UTC.
--
-- A date-only value has no timezone. As text it compares exactly, sorts correctly, and
-- reads in the database as the day somebody chose.
--
-- The cast goes through the DATE's own text form, so any row already written keeps the
-- day Postgres holds for it. There is one, set while this was being built.
ALTER TABLE "budget_envelope"
  ALTER COLUMN "periodStart" TYPE TEXT USING to_char("periodStart", 'YYYY-MM-DD'),
  ALTER COLUMN "periodEnd"   TYPE TEXT USING to_char("periodEnd", 'YYYY-MM-DD');
