ALTER TABLE "AiMessage"
ADD COLUMN "processingLeaseId" TEXT,
ADD COLUMN "processingStartedAt" TIMESTAMP(3);
