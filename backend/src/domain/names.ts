/**
 * Payer-name check. This is a *secondary* signal only: a missing name is "unknown", never a match,
 * and a mismatch only raises a review item; it never blocks a verified payment.
 */
const STOP = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'chief', 'alhaji', 'alhaja', 'pastor', 'engr', 'ltd', 'limited', 'enterprises', 'and']);

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

export type NameMatch = 'match' | 'different' | 'unknown';

export function comparePayerName(payerName: string | null | undefined, customerName: string): NameMatch {
  if (!payerName || !payerName.trim()) return 'unknown';
  const payer = tokens(payerName);
  const customer = tokens(customerName);
  if (!payer.length || !customer.length) return 'unknown';
  const overlap = customer.some((c) => payer.some((p) => p === c || (c.length >= 4 && (p.startsWith(c) || c.startsWith(p)))));
  return overlap ? 'match' : 'different';
}
