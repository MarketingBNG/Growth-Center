-- Revenue is derived from won deals rather than entered, so a re-sync must update the
-- same row instead of adding another. One revenue entry per opportunity; NULLs stay
-- unconstrained, which leaves manually entered revenue unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "revenue_entry_opportunityId_key"
  ON "revenue_entry" ("opportunityId");
