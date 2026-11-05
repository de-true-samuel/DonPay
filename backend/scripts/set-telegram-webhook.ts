/**
 * Point the Telegram bot at this Worker.
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... WORKER_URL=https://... npm run telegram:set-webhook
 * The secret must match the Worker's TELEGRAM_WEBHOOK_SECRET (wrangler secret put).
 * Telegram requires a public HTTPS URL; locally, use a cloudflared tunnel.
 */
import 'dotenv/config';

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const workerUrl = process.env.WORKER_URL?.replace(/\/+$/, '');
if (!token || !secret || !workerUrl) {
  console.error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and WORKER_URL');
  process.exit(1);
}
if (!workerUrl.startsWith('https://')) {
  console.error('Telegram only delivers to HTTPS URLs. Use your staging URL or a cloudflared tunnel.');
  process.exit(1);
}

const api = (method: string, body: unknown) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const set = await api('setWebhook', {
  url: `${workerUrl}/webhooks/telegram`,
  secret_token: secret,
  allowed_updates: ['message'],
  drop_pending_updates: true,
});
console.log('setWebhook:', set);
await api('setMyCommands', {
  commands: [
    { command: 'login', description: 'Get a link to open your dashboard' },
    { command: 'today', description: 'Who paid, who is waiting' },
    { command: 'help', description: 'What this bot can do' },
  ],
});
console.log('Commands registered.');
