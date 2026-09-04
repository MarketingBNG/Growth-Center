-- Approval on a content piece. §21.2: "Approve records her identity, the time and the
-- exact card version she saw. Return quotes the finding back to the author and keeps the
-- SLA clock running."
--
-- All nullable. Nothing has been approved, because until now nothing could be.
--
-- `approvedHash` is what makes the record mean anything: an approval without it says
-- somebody approved "this piece", which stops being true the moment the piece is edited.
ALTER TABLE "content_piece" ADD COLUMN "approvedByEmail" TEXT;
ALTER TABLE "content_piece" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "content_piece" ADD COLUMN "approvedHash" TEXT;
ALTER TABLE "content_piece" ADD COLUMN "returnedAt" TIMESTAMP(3);
ALTER TABLE "content_piece" ADD COLUMN "returnedNote" TEXT;
ALTER TABLE "content_piece" ADD COLUMN "reviewStartedAt" TIMESTAMP(3);
