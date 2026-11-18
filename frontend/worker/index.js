/**
 * Paidar web: serves the built app (./dist) and forwards backend routes to the backend Worker,
 * so the browser only ever talks to ONE origin: no CORS, the session cookie is first-party,
 * and Clerk's token reaches the backend unchanged.
 *
 * Forwarded to the backend:
 *   /api/*                       every API call
 *   /p/:token/status             the payment page's status poll
 *   /p/:token/claim-paid         the payment page's "I've paid"
 * Everything else (including the /p/:token page itself) is the app, from env.ASSETS.
 *
 * How it reaches the backend (first that is configured):
 *   env.BACKEND         service binding: backend Worker on the SAME Cloudflare account
 *   env.BACKEND_ORIGIN  public URL, e.g. https://kobo-exact-staging.<sub>.workers.dev (works across accounts)
 * With BACKEND_ORIGIN, the visitor's IP goes in x-paidar-client-ip together with env.PROXY_SECRET
 * (x-paidar-proxy); the backend trusts that IP only when the secret matches its own PROXY_SECRET.
 */
const BACKEND_PATH = /^\/(api\/|p\/[^/]+\/(status|claim-paid)$)/;

export default {
  /**
   * @param {Request} request
   * @param {{ ASSETS: { fetch: typeof fetch }, BACKEND?: { fetch: typeof fetch }, BACKEND_ORIGIN?: string, PROXY_SECRET?: string }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!BACKEND_PATH.test(url.pathname)) return env.ASSETS.fetch(request);

    if (env.BACKEND) return env.BACKEND.fetch(request);

    if (env.BACKEND_ORIGIN) {
      const target = new URL(url.pathname + url.search, env.BACKEND_ORIGIN);
      const headers = new Headers(request.headers);
      headers.delete('x-paidar-proxy');
      headers.delete('x-paidar-client-ip');
      const ip = request.headers.get('cf-connecting-ip');
      if (env.PROXY_SECRET && ip) {
        headers.set('x-paidar-proxy', env.PROXY_SECRET);
        headers.set('x-paidar-client-ip', ip);
      }
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      return fetch(target, {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
        redirect: 'manual',
      });
    }

    return Response.json(
      { error: { code: 'INTERNAL', message: 'The backend is not connected to this site yet.' } },
      { status: 503 },
    );
  },
};
