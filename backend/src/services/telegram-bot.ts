/**
 * Telegram bot. Provider only (spec 4.7): sign-in, payment pings, reminders, the evening summary
 * and the "customer says paid" alert. The bot never messages customers; there is no customer flow.
 * Commands: login links, linking an existing account, and a quick /today summary.
 * Updates arrive at POST /webhooks/telegram (secret-token verified in the route).
 */
import { z } from 'zod';
import type { Deps } from '../deps';
import { hashToken, randomToken } from '../domain/tokens';
import { formatNairaShort } from '../domain/money';
import { issueLoginLink } from './auth';
import { getToday } from './today';

const updateSchema = z
  .object({
    message: z
      .object({
        text: z.string().optional(),
        chat: z.object({ id: z.number(), type: z.string() }),
        from: z.object({ first_name: z.string().optional(), username: z.string().optional() }).optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const LINK_TTL_MS = 10 * 60 * 1000;

/** Deep link the app shows under "Connect Telegram": t.me/<bot>?start=link_<token>. */
export async function createTelegramLink(deps: Deps, providerId: string): Promise<{ url: string; expiresAt: string }> {
  if (!deps.config.telegramBotUsername) throw new Error('TELEGRAM_BOT_USERNAME is not configured');
  const raw = randomToken(24);
  const expiresAt = new Date(deps.now().getTime() + LINK_TTL_MS);
  await deps.db.loginToken.create({ data: { tokenHash: await hashToken(`link:${raw}`), providerId, expiresAt } });
  return { url: `https://t.me/${deps.config.telegramBotUsername}?start=link_${raw}`, expiresAt: expiresAt.toISOString() };
}

const HELP = [
  'Paidar commands:',
  '/login: get a link to open your dashboard',
  '/today: who paid, who is waiting, what needs attention',
  '/help: this message',
].join('\n');

export async function handleTelegramUpdate(deps: Deps, rawUpdate: unknown): Promise<void> {
  const parsed = updateSchema.safeParse(rawUpdate);
  const msg = parsed.success ? parsed.data.message : undefined;
  if (!msg?.text || msg.chat.type !== 'private') return;
  const chatId = BigInt(msg.chat.id);
  const [command, arg] = msg.text.trim().split(/\s+/, 2);
  const cmd = command?.toLowerCase().replace(/@.*$/, '');
  const reply = (text: string, buttons?: { text: string; url: string }[][]) => deps.telegram.sendMessage(chatId, text, buttons);

  if (cmd === '/start' && arg?.startsWith('link_')) {
    return linkExistingAccount(deps, chatId, arg.slice(5), msg.from?.username ?? null, reply);
  }

  if (cmd === '/start' || cmd === '/login') {
    let provider = await deps.db.provider.findUnique({ where: { telegramChatId: chatId } });
    const isNew = !provider;
    if (!provider) {
      const first = msg.from?.first_name?.trim() || 'My';
      provider = await deps.db.provider.create({
        data: { businessName: `${first}'s business`, telegramChatId: chatId, telegramUsername: msg.from?.username ?? null },
      });
      deps.log.info('provider.created_via_telegram', { providerId: provider.id });
    }
    const link = await issueLoginLink(deps, provider.id);
    const intro = isNew
      ? `Welcome to Paidar! Your account "${provider.businessName}" is ready. You can change the business name in Settings.\n\nPaid alerts will arrive in this chat.`
      : 'Here is your login link.';
    return reply(`${intro}\n\nThis link works once and expires in 10 minutes.`, [[{ text: 'Open Paidar', url: link }]]);
  }

  if (cmd === '/today') {
    const provider = await deps.db.provider.findUnique({ where: { telegramChatId: chatId }, select: { id: true } });
    if (!provider) return reply('Send /start first to set up your account.');
    const t = await getToday(deps, provider.id);
    const paidTotal = t.justPaid.reduce((s, p) => s + BigInt(p.payment.amountKobo), 0n);
    const lines = [
      `✔ Paid today: ${t.counts.justPaid}${t.counts.justPaid ? ` (${formatNairaShort(paidTotal)})` : ''}`,
      `⏳ Waiting: ${t.counts.waiting}`,
      `📅 Balances due: ${t.counts.balancesDue}`,
      `⏰ Reminders due: ${t.counts.dueReminders}`,
      `↻ Expired, send again: ${t.counts.expired}`,
      `⚠ Needs review: ${t.counts.needsReview}`,
    ];
    return reply(lines.join('\n'), [[{ text: 'Open Today', url: `${deps.config.frontendUrl}/` }]]);
  }

  return reply(HELP);
}

async function linkExistingAccount(
  deps: Deps,
  chatId: bigint,
  rawToken: string,
  username: string | null,
  reply: (text: string) => Promise<void>,
): Promise<void> {
  const tokenHash = await hashToken(`link:${rawToken}`);
  const now = deps.now();
  const { count } = await deps.db.loginToken.updateMany({ where: { tokenHash, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
  if (!count) return reply('This connect link is invalid or has expired. Open Settings in the app and try again.');
  const token = await deps.db.loginToken.findUniqueOrThrow({ where: { tokenHash } });
  const holder = await deps.db.provider.findUnique({ where: { telegramChatId: chatId }, select: { id: true } });
  if (holder && holder.id !== token.providerId) {
    return reply('This Telegram account is already connected to another Paidar business.');
  }
  await deps.db.provider.update({ where: { id: token.providerId }, data: { telegramChatId: chatId, telegramUsername: username } });
  deps.log.info('provider.telegram_linked', { providerId: token.providerId });
  return reply('Connected ✔ Paid alerts and your daily digest will arrive here.');
}
