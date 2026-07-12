ALTER TYPE "MessengerAiAttachmentExtractionStatus" ADD VALUE IF NOT EXISTS 'processing';

ALTER TABLE "MessengerAiInvocationAttachment"
ADD COLUMN "processingLeaseId" TEXT,
ADD COLUMN "processingStartedAt" TIMESTAMP(3),
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "MessengerAiInvocationAttachment_extractionStatus_availableAt_processingStartedAt_idx"
ON "MessengerAiInvocationAttachment"("extractionStatus", "availableAt", "processingStartedAt");

ALTER TABLE "MessengerAiInvocationAttachment"
ADD CONSTRAINT "MessengerAiInvocationAttachment_processing_lease_check"
CHECK (
    ("extractionStatus"::text = 'processing' AND "processingLeaseId" IS NOT NULL AND "processingStartedAt" IS NOT NULL)
    OR ("extractionStatus"::text <> 'processing' AND "processingLeaseId" IS NULL AND "processingStartedAt" IS NULL)
);

ALTER TABLE "MessengerAiInvocationAttachment"
ADD CONSTRAINT "MessengerAiInvocationAttachment_attempt_count_check"
CHECK ("attemptCount" >= 0);

ALTER TABLE "MessengerAiInvocationAttachment"
ADD CONSTRAINT "MessengerAiInvocationAttachment_completed_extract_check"
CHECK (
    "extractionStatus"::text <> 'completed'
    OR ("extractCiphertext" IS NOT NULL AND "extractNonce" IS NOT NULL AND "extractKeyVersion" >= 1 AND "characterCount" > 0 AND "verifiedContentHash" IS NOT NULL)
);
