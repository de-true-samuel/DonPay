-- Clerk sign-in: link a provider to a Clerk user. Nullable, so existing Telegram/dev providers are untouched.
ALTER TABLE "Provider" ADD COLUMN "clerkUserId" TEXT;
CREATE UNIQUE INDEX "Provider_clerkUserId_key" ON "Provider"("clerkUserId");
