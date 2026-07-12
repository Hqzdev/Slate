ALTER TABLE "MessengerOutboxEvent"
ADD COLUMN "leaseOwner" TEXT,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

ALTER TABLE "MessengerOutboxEvent"
ADD CONSTRAINT "MessengerOutboxEvent_lease_check"
CHECK (
    ("leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL)
    OR
    ("leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
);

DROP INDEX "MessengerOutboxEvent_pending_availableAt_createdAt_idx";

CREATE INDEX "MessengerOutboxEvent_pending_lease_availableAt_createdAt_idx"
ON "MessengerOutboxEvent"("availableAt", "leaseExpiresAt", "createdAt")
WHERE "status" = 'pending';

CREATE INDEX "MessengerOutboxEvent_leaseExpiresAt_idx"
ON "MessengerOutboxEvent"("leaseExpiresAt");
