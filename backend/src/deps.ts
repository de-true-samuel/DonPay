import { loadConfig, type AppConfig, type Env } from './config';
import { createDb, type Db } from './db/client';
import { FakeKoraClient } from './integrations/kora/fake-client';
import { KoraHttpClient } from './integrations/kora/http-client';
import type { KoraClient } from './integrations/kora/types';
import { ConsoleTelegramSender, TelegramHttpSender, type TelegramSender } from './integrations/telegram/sender';
import { createLogger, type Logger } from './log';
import type { QueueMessage } from './queue/messages';

/** Everything a service needs. Built once per invocation; replaced with fakes in tests. */
export interface Deps {
  db: Db;
  kora: KoraClient;
  telegram: TelegramSender;
  queue: { send(msg: QueueMessage): Promise<void> };
  config: AppConfig;
  now: () => Date;
  log: Logger;
}

export function buildDeps(env: Env, logFields: Record<string, unknown> = {}): Deps {
  const config = loadConfig(env);
  const now = () => new Date();
  const kora: KoraClient =
    config.koraMode === 'fake'
      ? new FakeKoraClient(config.koraExpiryMinutes, now)
      : new KoraHttpClient({
          baseUrl: config.koraBaseUrl,
          secretKey: config.koraSecretKey!,
          defaultExpiryMinutes: config.koraExpiryMinutes,
          sandbox: config.koraMode === 'sandbox',
          now,
        });
  const telegram = config.telegramBotToken ? new TelegramHttpSender(config.telegramBotToken) : new ConsoleTelegramSender();
  return {
    db: createDb(env.HYPERDRIVE.connectionString),
    kora,
    telegram,
    queue: { send: (msg) => env.QUEUE.send(msg) },
    config,
    now,
    log: createLogger({ env: config.appEnv, ...logFields }),
  };
}
