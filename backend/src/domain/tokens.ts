import { sha256Hex } from '../integrations/kora/signature';

/** URL-safe random token. 16 bytes = 128 bits for public pay links; 32 bytes for sessions. */
export function randomToken(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const hashToken = (raw: string) => sha256Hex(raw);

/** Our Kora reference for a request. The attempt suffix changes only if Kora reports a duplicate. */
export function koraReferenceFor(requestId: string, attempt = 1): string {
  return `KE-${requestId}-${attempt}`;
}

export function nextAttemptReference(current: string): string {
  const m = /^(KE-.+)-(\d+)$/.exec(current);
  if (!m) return `${current}-2`;
  return `${m[1]}-${Number(m[2]) + 1}`;
}

/** Short human receipt number from a payment id, e.g. "KE-7Q2M9X". */
export function receiptNumber(paymentId: string): string {
  return `KE-${paymentId.slice(-6).toUpperCase()}`;
}
