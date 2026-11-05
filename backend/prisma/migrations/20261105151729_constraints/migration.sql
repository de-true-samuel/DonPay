-- Constraints Prisma's schema language can't express. See ARCHITECTURE.md §4.3.

-- At most one live (SCHEDULED or SENT) request per job: no double-requesting the balance.
CREATE UNIQUE INDEX "one_open_request_per_job"
  ON "PaymentRequest" ("jobId")
  WHERE status IN ('SCHEDULED', 'SENT');

-- Money sanity. All amounts are whole kobo.
ALTER TABLE "Job" ADD CONSTRAINT "job_total_positive" CHECK ("totalKobo" > 0);
ALTER TABLE "Job" ADD CONSTRAINT "job_deposit_valid"
  CHECK ("depositKobo" IS NULL OR ("depositKobo" > 0 AND "depositKobo" < "totalKobo"));
ALTER TABLE "Job" ADD CONSTRAINT "job_deposit_matches_plan"
  CHECK (("plan" = 'DEPOSIT_BALANCE') = ("depositKobo" IS NOT NULL));
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "request_amount_positive" CHECK ("amountKobo" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "payment_amount_positive" CHECK ("amountKobo" > 0);

-- A Kora-verified payment always belongs to a request; a manual one never does.
ALTER TABLE "Payment" ADD CONSTRAINT "payment_source_request"
  CHECK (("source" = 'KORA_VERIFIED') = ("requestId" IS NOT NULL));

-- A SENT/PAID request must carry the account it was sent with.
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "request_sent_has_account"
  CHECK ("status" NOT IN ('SENT', 'PAID') OR ("accountNumber" IS NOT NULL AND "expiresAt" IS NOT NULL AND "koraReference" IS NOT NULL));

-- Search: trigram indexes make ILIKE '%term%' on names/services fast.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "customer_name_trgm" ON "Customer" USING gin ("name" gin_trgm_ops);
CREATE INDEX "customer_phone_trgm" ON "Customer" USING gin ("phoneE164" gin_trgm_ops);
CREATE INDEX "job_service_trgm" ON "Job" USING gin ("service" gin_trgm_ops);
