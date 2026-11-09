/**
 * Kora webhook signature check.
 *
 * ⚠ Confirm with Kora: per their docs, the `x-korapay-signature` header is the hex HMAC-SHA256
 * of JSON.stringify(payload.data), keyed with the merchant secret key. If Kora confirms a
 * different scheme, only this file changes.
 */

const encoder = new TextEncoder();

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return toHex(new Uint8Array(sig));
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The exact bytes Kora signs. Kept separate so it can be swapped if Kora signs the raw body. */
export function signedPortion(payload: unknown): string {
  const data = (payload as { data?: unknown } | null)?.data;
  return JSON.stringify(data ?? null);
}

export async function signKoraPayload(secret: string, payload: unknown): Promise<string> {
  return hmacSha256Hex(secret, signedPortion(payload));
}

export async function verifyKoraSignature(secret: string, payload: unknown, header: string | null | undefined): Promise<boolean> {
  if (!header) return false;
  const expected = await signKoraPayload(secret, payload);
  return timingSafeEqualHex(expected, header.trim().toLowerCase());
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return toHex(new Uint8Array(digest));
}
