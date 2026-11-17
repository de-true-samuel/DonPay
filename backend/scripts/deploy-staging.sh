#!/usr/bin/env bash
# One-shot staging deploy of the backend Worker (DEPLOY.md steps 3–7). Safe to re-run.
#
#   CLOUDFLARE_ACCOUNT_ID=<id> bash scripts/deploy-staging.sh <workers.dev subdomain>
#
# Reads secrets from local, git-ignored files and pipes them to Cloudflare. Never prints them.
#   .env.staging  DATABASE_URL_UNPOOLED (Neon direct), ADMIN_SECRET, TELEGRAM_WEBHOOK_SECRET
#   .env          KORA_SECRET_KEY (sandbox sk_test_…)
#   .dev.vars     CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY
set -euo pipefail
cd "$(dirname "$0")/.."

SUB="${1:?usage: deploy-staging.sh <workers.dev subdomain, e.g. detruesamuel>}"
: "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
NAME=kobo-exact-staging
API="https://$NAME.$SUB.workers.dev"
WEB="https://paidar.$SUB.workers.dev"

val() { grep -E "^$2=" "$1" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
DIRECT="$(val .env.staging DATABASE_URL_UNPOOLED)"
[[ "$DIRECT" == *-pooler* ]] && { echo "DATABASE_URL_UNPOOLED must be the direct (non -pooler) string"; exit 1; }

echo "1/6 Hyperdrive"
HD_ID="$(npx wrangler hyperdrive list 2>/dev/null | grep -E "\b$NAME\b" | grep -oE '[0-9a-f]{32}' | head -1 || true)"
if [ -z "$HD_ID" ]; then
  HD_ID="$(npx wrangler hyperdrive create "$NAME" --connection-string="$DIRECT" --caching-disabled 2>&1 | grep -oE '[0-9a-f]{32}' | head -1)"
fi
[ -n "$HD_ID" ] || { echo "Could not create or find the Hyperdrive config"; exit 1; }
echo "    id $HD_ID"

echo "2/6 Queues"
for q in "$NAME" "$NAME-dlq"; do
  npx wrangler queues create "$q" >/dev/null 2>&1 && echo "    created $q" || echo "    $q exists"
done

echo "3/6 wrangler.jsonc (staging hostnames, Hyperdrive id, Clerk publishable key)"
PK="$(val .dev.vars CLERK_PUBLISHABLE_KEY)"
HD_ID="$HD_ID" API="$API" WEB="$WEB" PK="$PK" node -e '
const fs = require("fs"); let s = fs.readFileSync("wrangler.jsonc", "utf8");
const i = s.indexOf("\"staging\": {"), j = s.indexOf("\"production\": {");
let st = s.slice(i, j);
st = st.replace(/"PUBLIC_BASE_URL": "[^"]*"/, `"PUBLIC_BASE_URL": "${process.env.API}"`)
       .replace(/"FRONTEND_URL": "[^"]*"/, `"FRONTEND_URL": "${process.env.WEB}"`)
       .replace(/"FRONTEND_ORIGINS": "[^"]*"/, `"FRONTEND_ORIGINS": "${process.env.WEB}"`)
       .replace(/"CLERK_PUBLISHABLE_KEY": "[^"]*"/, `"CLERK_PUBLISHABLE_KEY": "${process.env.PK}"`)
       .replace(/("binding": "HYPERDRIVE", "id": ")[^"]*"/, `$1${process.env.HD_ID}"`);
fs.writeFileSync("wrangler.jsonc", s.slice(0, i) + st + s.slice(j));'

echo "4/6 Secrets"
put() { [ -n "$2" ] || { echo "    $1 missing, skipped"; return; }; printf '%s' "$2" | npx wrangler secret put "$1" --env staging >/dev/null 2>&1 && echo "    $1 set"; }
# The Worker must exist before secrets can be attached: first deploy creates it.
npx wrangler deploy --env staging >/dev/null 2>&1 || true
put KORA_SECRET_KEY "$(val .env KORA_SECRET_KEY)"
put CLERK_SECRET_KEY "$(val .dev.vars CLERK_SECRET_KEY)"
put ADMIN_SECRET "$(val .env.staging ADMIN_SECRET)"
put TELEGRAM_WEBHOOK_SECRET "$(val .env.staging TELEGRAM_WEBHOOK_SECRET)"

echo "5/6 Migrations (Neon, direct connection)"
DATABASE_URL="$DIRECT" npx prisma migrate deploy 2>&1 | grep -E "applied|No pending|up to date|Error" || true

echo "6/6 Deploy"
npx wrangler deploy --env staging 2>&1 | grep -E "Uploaded|Deployed|https://|Current Version|✘" || true
sleep 3
echo "Health: $(curl -s "$API/health")"
