-- Contract 1.1.0 (Paidar). Every new column is nullable, so this is safe to deploy before the code.
-- Reverse with down.sql in this folder (Prisma does not run it; apply by hand with psql).
-- NOTE: the trigram search indexes from *_constraints are hand-written; never let Prisma drop them.

-- CreateEnum
CREATE TYPE "MessageLanguage" AS ENUM ('en', 'pcm');

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'CUSTOMER_CLAIMED_PAID';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "messageLanguage" "MessageLanguage";

-- AlterTable
ALTER TABLE "PaymentRequest" ADD COLUMN     "customerClaimedPaidAt" TIMESTAMP(3),
ADD COLUMN     "detailsCopiedAt" TIMESTAMP(3),
ADD COLUMN     "followUpPromptedAt" TIMESTAMP(3),
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "phoneE164" TEXT;

-- CreateTable
CREATE TABLE "ClaimEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "status" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaimEvent_requestId_createdAt_idx" ON "ClaimEvent"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_providerId_key_key" ON "IdempotencyKey"("providerId", "key");

-- CreateIndex
CREATE INDEX "PaymentRequest_status_lastCheckedAt_idx" ON "PaymentRequest"("status", "lastCheckedAt");

-- AddForeignKey
ALTER TABLE "ClaimEvent" ADD CONSTRAINT "ClaimEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BE-10: existing providers have already been through the app, so treat them as onboarded.
UPDATE "Provider" SET "onboardedAt" = "createdAt" WHERE "onboardedAt" IS NULL;

-- 5.3 duplicate-account guard: no two LIVE requests may share a bank account. Kora should never
-- hand out the same number twice, but if it did, money could be credited to the wrong request.
-- Partial (status = 'SENT') rather than global, because a provider bank may recycle a virtual
-- account number after the earlier one has expired (confirm with Kora, D2).
CREATE UNIQUE INDEX "one_live_request_per_account"
  ON "PaymentRequest" ("bankName", "accountNumber")
  WHERE "status" = 'SENT' AND "accountNumber" IS NOT NULL;
