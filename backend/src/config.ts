import type { QueueMessage } from './queue/messages';

/** Worker bindings (see wrangler.jsonc). Secrets are set with `wrangler secret put`. */
export interface Env {
  HYPERDRIVE: { connectionString: string };
  QUEUE: { send(body: QueueMessage): Promise<void>; sendBatch(msgs: { body: QueueMessage }[]): Promise<void> };
  PUBLIC_RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };

  APP_ENV: string; // local | staging | production
  PUBLIC_BASE_URL: string; // this Worker's public origin, used in pay links and Kora notification_url
  FRONTEND_URL: string; // where the provider app lives (login links, deep links)
  FRONTEND_ORIGINS: string; // comma-separated CORS allow-list
  COOKIE_SAMESITE?: string; // Lax (same site) | None (frontend on another site)
  KORA_MODE: string; // fake | sandbox | live
  KORA_BASE_URL?: string;
  KORA_EXPIRY_MINUTES?: string;
  KORA_PLACEHOLDER_EMAIL_DOMAIN?: string;
  DEV_LOGIN_ENABLED?: string;
  TELEGRAM_BOT_USERNAME?: string;

  KORA_SECRET_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  ADMIN_SECRET?: string;
}

export type KoraMode = 'fake' | 'sandbox' | 'live';

export interface AppConfig {
  appEnv: string;
  publicBaseUrl: string;
  frontendUrl: string;
  frontendOrigins: string[];
  cookieSameSite: 'Lax' | 'None';
  koraMode: KoraMode;
  koraBaseUrl: string;
  koraSecretKey: string | null;
  koraExpiryMinutes: number;
  placeholderEmailDomain: string;
  devLoginEnabled: boolean;
  telegramBotToken: string | null;
  telegramBotUsername: string | null;
  telegramWebhookSecret: string | null;
  adminSecret: string | null;
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

export function loadConfig(env: Env): AppConfig {
  const koraMode = (env.KORA_MODE || 'fake') as KoraMode;
  if (!['fake', 'sandbox', 'live'].includes(koraMode)) throw new Error(`Invalid KORA_MODE: ${env.KORA_MODE}`);
  if (koraMode !== 'fake' && !env.KORA_SECRET_KEY) throw new Error('KORA_SECRET_KEY is required unless KORA_MODE=fake');
  const devLogin = env.DEV_LOGIN_ENABLED === 'true';
  if (devLogin && env.APP_ENV === 'production') throw new Error('DEV_LOGIN_ENABLED must not be set in production');
  if (koraMode === 'fake' && env.APP_ENV === 'production') throw new Error('KORA_MODE=fake is not allowed in production');
  return {
    appEnv: env.APP_ENV || 'local',
    publicBaseUrl: trimSlash(env.PUBLIC_BASE_URL),
    frontendUrl: trimSlash(env.FRONTEND_URL),
    frontendOrigins: (env.FRONTEND_ORIGINS || '')
      .split(',')
      .map((s) => trimSlash(s.trim()))
      .filter(Boolean),
    cookieSameSite: env.COOKIE_SAMESITE === 'None' ? 'None' : 'Lax',
    koraMode,
    koraBaseUrl: trimSlash(env.KORA_BASE_URL || 'https://api.korapay.com/merchant/api/v1'),
    koraSecretKey: env.KORA_SECRET_KEY || null,
    koraExpiryMinutes: Number(env.KORA_EXPIRY_MINUTES || 60),
    placeholderEmailDomain: env.KORA_PLACEHOLDER_EMAIL_DOMAIN || 'customers.kobo-exact.app',
    devLoginEnabled: devLogin,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || null,
    telegramBotUsername: env.TELEGRAM_BOT_USERNAME || null,
    telegramWebhookSecret: env.TELEGRAM_WEBHOOK_SECRET || null,
    adminSecret: env.ADMIN_SECRET || null,
  };
}
