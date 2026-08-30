-- "Semi-Qualified Lead" is this CRM's own status and its largest worked segment.
-- It was reaching LeadStatus.qualified through a substring match, so the qualified
-- count was 2,480 semi-qualified leads and 10 genuinely qualified ones.
--
-- BEFORE 'qualified' so the enum reads in funnel order. Postgres allows this without
-- a table rewrite; existing rows are untouched and keep whatever they already hold.
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'semi_qualified' BEFORE 'qualified';
