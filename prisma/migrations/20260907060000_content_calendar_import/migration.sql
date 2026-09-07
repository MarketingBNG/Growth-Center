-- The content calendar, imported.
--
-- The board's own empty state said it: "Nothing imports content — this board is filled by
-- hand." §15.4 says a hand-filled board decays in three weeks, and the month's plan is
-- usually already written in a spreadsheet before anybody opens this application.
--
-- `content_import` is the provenance row: which month, who uploaded it, what the file was
-- called, and how many of its rows became pieces. Nothing on content_piece could answer
-- "who imported this and which month is it for", which is the question the calendar has
-- to answer above the grid.
CREATE TABLE "content_import" (
    "id" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "importedByEmail" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileFormat" TEXT NOT NULL,
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "skippedReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "content_import_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_import_month_idx" ON "content_import"("month");

-- Additive and nullable: every existing piece keeps its provenance, which is `createdBy`
-- — null for one a person made, a system name for one a sync created. An imported piece
-- now also carries the import it arrived on.
ALTER TABLE "content_piece" ADD COLUMN "importId" TEXT;

-- SET NULL, not CASCADE. Replacing a calendar deletes that import's pieces explicitly, in
-- a transaction that keeps anything already published; a cascade here would take the
-- published piece and its views and leads with it, and re-uploading a spreadsheet is not
-- a reason to lose a month of performance history.
ALTER TABLE "content_piece" ADD CONSTRAINT "content_piece_importId_fkey"
    FOREIGN KEY ("importId") REFERENCES "content_import"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "content_piece_importId_idx" ON "content_piece"("importId") WHERE "importId" IS NOT NULL;

-- The calendar reads one month at a time, which is a range scan on this column. The board
-- reads every row and sorts in memory, so nothing needed it until now.
CREATE INDEX "content_piece_publishDate_idx" ON "content_piece"("publishDate");
