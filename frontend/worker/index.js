/**
 * Paidar web: serves the built app (./dist) and forwards backend routes to the backend Worker
 * through a service binding, so the browser only ever talks to ONE origin:
 * no CORS, the session cookie is first-party, and Clerk's token reaches the backend unchanged.
 *
 * Forwarded to the backend (env.BACKEND):
 *   /api/*                       every API call
 *   /p/:token/status             the payment page's status poll
 *   /p/:token/claim-paid         the payment page's "I've paid"
 * Everything else (including the /p/:token page itself) is the app, from env.ASSETS.
 */
const BACKEND_PATH = /^\/(api\/|p\/[^/]+\/(status|claim-paid)$)/;

export default {
  /**
   * @param {Request} request
   * @param {{ ASSETS: { fetch: typeof fetch }, BACKEND?: { fetch: typeof fetch } }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (BACKEND_PATH.test(url.pathname)) {
      if (!env.BACKEND) {
        return Response.json(
          { error: { code: 'INTERNAL', message: 'The backend is not connected to this site yet.' } },
          { status: 503 },
        );
      }
      return env.BACKEND.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
