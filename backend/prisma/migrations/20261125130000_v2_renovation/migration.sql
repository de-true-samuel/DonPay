-- Paidar v2.0.0 Renovation Migration
-- Separates JobWorkStatus, ChargeAttempt (ephemeral Kora virtual accounts), ActivityEvent, WaitlistEntry,
-- and adds Provider/Customer/Job/PaymentRequest/Notification v2 fields.

-- 1. New Enums
CREATE TYPE "JobWorkStatus" AS ENUM ('AWAITING_PAYMENT', 'READY', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED');
CREATE TYPE "ChargeAttemptStatus" AS ENUM ('ACCOUNT_ACTIVE', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'SUPERSEDED');
CREATE TYPE "FeeBearer" AS ENUM ('OWNER', 'CLIENT');
CREATE TYPE "PaymentTermsV2" AS ENUM ('FULL', 'DEPOSIT', 'PAY_ON_DELIVERY');
CREATE TYPE "ActivityActor" AS ENUM ('OWNER', 'CLIENT', 'KORA', 'SYSTEM');
CREATE TYPE "ActivityCategory" AS ENUM ('PAYMENTS', 'STATUS', 'EDITS');

-- Extend existing enums
ALTER TYPE "RequestStatus" ADD VALUE IF NOT EXISTS 'NOT_REQUESTED';
ALTER TYPE "RequestStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT';
ALTER TYPE "RequestStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE "RequestStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';

ALTER TYPE "ReviewKind" ADD VALUE IF NOT EXISTS 'EXTRA_PAYMENT';
ALTER TYPE "ReviewKind" ADD VALUE IF NOT EXISTS 'UNKNOWN_REFERENCE';
ALTER TYPE "ReviewKind" ADD VALUE IF NOT EXISTS 'PAID_ON_CANCELLED';
ALTER TYPE "ReviewKind" ADD VALUE IF NOT EXISTS 'VERIFICATION_MISMATCH';
ALTER TYPE "ReviewKind" ADD VALUE IF NOT EXISTS 'REFUND_RECORDED';

-- 2. Provider v2 columns
ALTER TABLE "Provider"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "fullName" TEXT,
  ADD COLUMN "businessType" TEXT,
  ADD COLUMN "showPhoneOnPayPage" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "onboardingStep" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "workingHoursJson" JSONB,
  ADD COLUMN "defaultPaymentTerms" "PaymentTermsV2" NOT NULL DEFAULT 'FULL',
  ADD COLUMN "defaultDepositPercent" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "defaultFeeBearer" "FeeBearer" NOT NULL DEFAULT 'OWNER',
  ADD COLUMN "whatsappTemplate" TEXT,
  ADD COLUMN "dueSoonReminderDays" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "checklistDismissedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Provider_email_key" ON "Provider"("email");

-- 3. Customer v2 columns
ALTER TABLE "Customer"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

-- 4. Job v2 columns
ALTER TABLE "Job"
  ADD COLUMN "title" TEXT,
  ADD COLUMN "paymentTerms" "PaymentTermsV2" NOT NULL DEFAULT 'FULL',
  ADD COLUMN "depositPercent" INTEGER,
  ADD COLUMN "feeBearer" "FeeBearer" NOT NULL DEFAULT 'OWNER',
  ADD COLUMN "estimatedHours" DOUBLE PRECISION,
  ADD COLUMN "workStatus" "JobWorkStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
  ADD COLUMN "startedWithoutPayment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "overrideReason" TEXT,
  ADD COLUMN "isSample" BOOLEAN NOT NULL DEFAULT false;

-- 5. PaymentRequest v2 columns
ALTER TABLE "PaymentRequest"
  ADD COLUMN "feeBearer" "FeeBearer" NOT NULL DEFAULT 'OWNER',
  ADD COLUMN "acceptedAmountKobo" BIGINT,
  ADD COLUMN "feeKobo" BIGINT,
  ADD COLUMN "netKobo" BIGINT;

-- 6. Notification v2 columns
ALTER TABLE "Notification"
  ADD COLUMN "readAt" TIMESTAMP(3),
  ADD COLUMN "deepLink" TEXT,
  ADD COLUMN "entityId" TEXT;

CREATE INDEX "Notification_providerId_readAt_idx" ON "Notification"("providerId", "readAt");

-- 7. ChargeAttempt table (ephemeral Kora virtual account per attempt)
CREATE TABLE "ChargeAttempt" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "koraReference" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "status" "ChargeAttemptStatus" NOT NULL DEFAULT 'ACCOUNT_ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "supersededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChargeAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChargeAttempt_koraReference_key" ON "ChargeAttempt"("koraReference");
CREATE INDEX "ChargeAttempt_requestId_status_idx" ON "ChargeAttempt"("requestId", "status");

ALTER TABLE "ChargeAttempt"
  ADD CONSTRAINT "ChargeAttempt_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8. ActivityEvent table (immutable audit log)
CREATE TABLE "ActivityEvent" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "jobId" TEXT,
  "requestId" TEXT,
  "clientId" TEXT,
  "actor" "ActivityActor" NOT NULL,
  "category" "ActivityCategory" NOT NULL,
  "eventType" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "detail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActivityEvent_providerId_createdAt_idx" ON "ActivityEvent"("providerId", "createdAt");
CREATE INDEX "ActivityEvent_jobId_createdAt_idx" ON "ActivityEvent"("jobId", "createdAt");

ALTER TABLE "ActivityEvent"
  ADD CONSTRAINT "ActivityEvent_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivityEvent"
  ADD CONSTRAINT "ActivityEvent_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 9. WaitlistEntry table
CREATE TABLE "WaitlistEntry" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "whatsappPhone" TEXT,
  "businessType" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WaitlistEntry_email_key" ON "WaitlistEntry"("email");
