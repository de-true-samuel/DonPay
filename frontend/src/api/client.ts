import type { ZodType } from 'zod';
import { API_URL, MOCK, MOCK_FALLBACK } from '../config';
import type { ErrorCode } from '../contract/contract';
import { authHeader } from './authHooks';
import { mockFetch } from './mock';

export const UNAUTH_EVENT = 'paidar:unauthenticated';
export type ClientErrorCode = ErrorCode | 'NETWORK' | 'CONTRACT_MISMATCH' | 'UNKNOWN';

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: ClientErrorCode,
    message: string,
    public details?: unknown,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
interface Options<T> {
  method?: Method;
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  schema?: ZodType<T>;
  headers?: Record<string, string>;
}

function buildUrl(path: string, query?: Record<string, string | number | undefined | null>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return `${API_URL}${path}${s ? `?${s}` : ''}`;
}

function errorFrom(res: Response, json: unknown, path: string, requestId?: string): ApiRequestError {
  const e = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event(UNAUTH_EVENT));
  return new ApiRequestError(
    res.status, (e?.code as ClientErrorCode | undefined) ?? 'UNKNOWN', e?.message ?? res.statusText, e?.details, requestId,
  );
}

/** Every call: JSON, session cookie, and the CSRF header on anything that changes data. */
export async function api<T = unknown>(path: string, opts: Options<T> = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    headers['X-Requested-With'] = 'kobo-exact'; // required by contract §1.2
    if (!headers['Idempotency-Key']) {
      headers['Idempotency-Key'] = `ik_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
  }
  if (!MOCK) Object.assign(headers, await authHeader()); // Clerk session, when Clerk sign-in is on
  const init: RequestInit = {
    method,
    headers,
    credentials: 'include',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };
  const url = buildUrl(path, opts.query);

  let res: Response;
  try {
    if (MOCK) {
      res = await mockFetch(url, init);
    } else {
      res = await fetch(url, init);
      // Auto-fallback: if calling a relative /api route on a static host returns 405 (Method Not Allowed),
      // 404 (Not Found), or returns HTML (SPA rewrite fallback on missing backend), seamlessly use mockFetch.
      const contentType = res.headers.get('content-type') ?? '';
      if (MOCK_FALLBACK && !contentType.includes('application/json') && (res.status === 405 || res.status === 404 || (res.status === 200 && contentType.includes('text/html')))) {
        console.info(`[api] No live backend responding at ${path} (status ${res.status}). Using local in-browser mock engine.`);
        res = await mockFetch(url, init);
      }
    }
  } catch {
    if (MOCK_FALLBACK) {
      try {
        res = await mockFetch(url, init);
      } catch {
        throw new ApiRequestError(0, 'NETWORK', 'No connection.');
      }
    } else {
      throw new ApiRequestError(0, 'NETWORK', 'No connection.');
    }
  }

  const requestId = res.headers.get('x-request-id') ?? undefined;
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }

  if (!res.ok) throw errorFrom(res, json, path, requestId);

  if (opts.schema) {
    const parsed = opts.schema.safeParse(json);
    if (parsed.success) return parsed.data;
    console.warn(`[contract] ${method} ${path} does not match the contract`, parsed.error.issues);
    if (import.meta.env.DEV) {
      throw new ApiRequestError(res.status, 'CONTRACT_MISMATCH', 'The server replied in an unexpected shape.', parsed.error.issues, requestId);
    }
  }
  return json as T;
}

/** For file downloads (CSV). Same session and error handling as `api`, but returns the file. */
export async function apiDownload(
  path: string, query?: Record<string, string | undefined | null>,
): Promise<{ blob: Blob; filename: string }> {
  const init: RequestInit = {
    method: 'GET', credentials: 'include', headers: { Accept: 'text/csv', ...(MOCK ? {} : await authHeader()) },
  };
  const url = buildUrl(path, query);
  let res: Response;
  try {
    if (MOCK) {
      res = await mockFetch(url, init);
    } else {
      res = await fetch(url, init);
      const contentType = res.headers.get('content-type') ?? '';
      if (MOCK_FALLBACK && !contentType.includes('application/json') && (res.status === 405 || res.status === 404 || (res.status === 200 && contentType.includes('text/html')))) {
        res = await mockFetch(url, init);
      }
    }
  } catch {
    if (MOCK_FALLBACK) {
      try {
        res = await mockFetch(url, init);
      } catch {
        throw new ApiRequestError(0, 'NETWORK', 'No connection.');
      }
    } else {
      throw new ApiRequestError(0, 'NETWORK', 'No connection.');
    }
  }
  const requestId = res.headers.get('x-request-id') ?? undefined;
  if (!res.ok) {
    let json: unknown = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    throw errorFrom(res, json, path, requestId);
  }
  const m = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '');
  return { blob: await res.blob(), filename: m?.[1] ?? 'paidar-payments.csv' };
}
