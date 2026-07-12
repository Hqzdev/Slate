ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "onboardingDiscoverySource" TEXT;
ALTER TABLE "User" ADD COLUMN "onboardingIntendedUse" TEXT;
ALTER TABLE "User" ADD COLUMN "onboardingRole" TEXT;
ALTER TABLE "User" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "productGuideCompletedAt" TIMESTAMP(3);

UPDATE "User" SET "emailVerifiedAt" = NOW();

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

CREATE TABLE "EmailVerificationToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");
CREATE INDEX "EmailVerificationToken_userId_expiresAt_idx" ON "EmailVerificationToken"("userId", "expiresAt");
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
