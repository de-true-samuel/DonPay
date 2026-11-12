-- Reverses migration.sql. Run by hand: psql "$DATABASE_URL" -f down.sql
-- then delete this migration's row from "_prisma_migrations".
-- The CUSTOMER_CLAIMED_PAID enum value cannot be dropped in Postgres without recreating the type;
-- it is harmless to leave, but notification rows of that kind are removed first.
BEGIN;
DROP INDEX IF EXISTS "one_live_request_per_account";
DROP TABLE IF EXISTS "IdempotencyKey";
DROP TABLE IF EXISTS "ClaimEvent";
DROP INDEX IF EXISTS "PaymentRequest_status_lastCheckedAt_idx";
ALTER TABLE "PaymentRequest"
  DROP COLUMN IF EXISTS "customerClaimedPaidAt",
  DROP COLUMN IF EXISTS "detailsCopiedAt",
  DROP COLUMN IF EXISTS "followUpPromptedAt",
  DROP COLUMN IF EXISTS "lastCheckedAt";
ALTER TABLE "Provider" DROP COLUMN IF EXISTS "onboardedAt", DROP COLUMN IF EXISTS "phoneE164";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "messageLanguage";
DROP TYPE IF EXISTS "MessageLanguage";
DELETE FROM "Notification" WHERE "kind" = 'CUSTOMER_CLAIMED_PAID';
COMMIT;
