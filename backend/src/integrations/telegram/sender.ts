/** Minimal outbound Telegram Bot API client (sending only). Incoming updates go through grammY. */

export interface InlineButton {
  text: string;
  url: string;
}

export interface TelegramSender {
  sendMessage(chatId: bigint | string, text: string, buttons?: InlineButton[][]): Promise<void>;
}

export class TelegramSendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export class TelegramHttpSender implements TelegramSender {
  constructor(
    private readonly botToken: string,
    private readonly apiBase = 'https://api.telegram.org',
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  async sendMessage(chatId: bigint | string, text: string, buttons?: InlineButton[][]): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiBase}/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId.toString(),
          text,
          link_preview_options: { is_disabled: true },
          ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new TelegramSendError(`Telegram network error: ${(err as Error).message}`, true);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 403 = bot blocked by user; 400 = bad chat id. Retrying won't help.
      throw new TelegramSendError(`Telegram ${res.status}: ${body.slice(0, 200)}`, res.status === 429 || res.status >= 500);
    }
  }
}

/** Used when no bot token is configured (local dev): logs instead of sending. */
export class ConsoleTelegramSender implements TelegramSender {
  readonly sent: { chatId: string; text: string; buttons?: InlineButton[][] }[] = [];
  async sendMessage(chatId: bigint | string, text: string, buttons?: InlineButton[][]): Promise<void> {
    this.sent.push({ chatId: chatId.toString(), text, buttons });
    console.log(JSON.stringify({ evt: 'telegram.console', chatId: chatId.toString(), text }));
  }
}
