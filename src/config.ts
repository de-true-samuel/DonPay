const env = import.meta.env;

/** Backend origin, no trailing slash. Empty = same origin (a proxy in dev, or a reverse proxy in production). */
export const API_URL: string = String(env.VITE_API_URL ?? '').replace(/\/$/, '');

/**
 * Mock API. In development it is on by default when no backend is set.
 * In a production build it is OFF unless VITE_MOCK=true, so a deploy can never fall back to demo data by accident.
 */
export const MOCK: boolean = env.VITE_MOCK ? env.VITE_MOCK === 'true' : !!env.DEV && !API_URL && !env.VITE_DEV_PROXY;
export const DEV_LOGIN: boolean = MOCK || env.VITE_DEV_LOGIN === 'true';
export const BOT_URL: string = String(env.VITE_TELEGRAM_BOT_URL ?? '');
export const SIMULATE: boolean = MOCK || env.VITE_SIMULATE_PAYMENTS === 'true';

/** Things that must never be true in a real release. Shown as a loud banner in production builds. */
export const RELEASE_RISKS: string[] = [];
if (!env.DEV) {
  if (MOCK) RELEASE_RISKS.push('Demo mode is on: nothing is saved to a server.');
  if (!MOCK && env.VITE_DEV_LOGIN === 'true') RELEASE_RISKS.push('Developer sign-in is enabled.');
  if (!MOCK && env.VITE_SIMULATE_PAYMENTS === 'true') RELEASE_RISKS.push('Payment simulation is enabled.');
}
