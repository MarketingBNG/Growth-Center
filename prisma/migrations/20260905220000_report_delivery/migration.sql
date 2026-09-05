-- §17's delivery log.
--
-- The history starts here. The digest and the weekly pack were fire-and-forget, so there
-- is nothing to backfill: SMTP was refusing every message for six weeks and the only
-- evidence was a log line nobody reads.
CREATE TABLE "report_delivery" (
    "id" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "status" TEXT NOT NULL,
    "messageId" TEXT,
    "error" TEXT,
    "itemCount" INTEGER,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "report_delivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "report_delivery_report_sentAt_idx" ON "report_delivery"("report", "sentAt");
CREATE INDEX "report_delivery_status_sentAt_idx" ON "report_delivery"("status", "sentAt");
