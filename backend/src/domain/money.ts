/**
 * Money helpers. All money in Kobo-Exact is whole kobo held as `bigint`.
 * Nothing in this file goes through floating point.
 */

export type Kobo = bigint;

const DECIMAL_RE = /^(\d+)(?:\.(\d{1,2}))?$/;

/** Parse a naira amount (as Kora sends it) into kobo. "25000.5" -> 2500050n. */
export function nairaToKobo(input: string | number): Kobo {
  let s: string;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) throw new MoneyError(`Invalid naira amount: ${input}`);
    // Number#toString never uses exponent notation below 1e21, which is far above any real amount.
    s = input.toString();
    if (/e/i.test(s)) throw new MoneyError(`Invalid naira amount: ${input}`);
    // Floats like 0.1 + 0.2 stringify with many decimals; round half-up to kobo explicitly.
    const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) throw new MoneyError(`Invalid naira amount: ${input}`);
    const whole = BigInt(m[1]!);
    const frac = (m[2] ?? '').padEnd(3, '0');
    let kobo = whole * 100n + BigInt(frac.slice(0, 2));
    if (Number(frac[2]) >= 5) kobo += 1n;
    return kobo;
  }
  s = input.trim().replace(/,/g, '');
  const m = DECIMAL_RE.exec(s);
  if (!m) throw new MoneyError(`Invalid naira amount: "${input}"`);
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? '').padEnd(2, '0'));
  return whole * 100n + frac;
}

/** kobo -> "25000.50" (what Kora expects when we send an amount). */
export function koboToNairaString(kobo: Kobo): string {
  const neg = kobo < 0n;
  const abs = neg ? -kobo : kobo;
  const s = `${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/** kobo -> number of naira, for APIs that insist on a JSON number. Exact for amounts < ₦90 trillion. */
export function koboToNairaNumber(kobo: Kobo): number {
  return Number(koboToNairaString(kobo));
}

/** kobo -> "₦25,000.00" */
export function formatNaira(kobo: Kobo): string {
  const neg = kobo < 0n;
  const abs = neg ? -kobo : kobo;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}₦${whole}.${frac}`;
}

/** Short form for chat: "₦25,000" when there are no kobo, else full. */
export function formatNairaShort(kobo: Kobo): string {
  const full = formatNaira(kobo);
  return full.endsWith('.00') ? full.slice(0, -3) : full;
}

/** Parse a kobo value from the API (string of digits, or a safe JSON integer). */
export function parseKoboInput(input: unknown): Kobo {
  if (typeof input === 'string' && /^\d{1,18}$/.test(input)) return BigInt(input);
  if (typeof input === 'number' && Number.isSafeInteger(input) && input >= 0) return BigInt(input);
  throw new MoneyError('Amount must be a whole number of kobo, e.g. "2500000" for ₦25,000');
}

export function koboToString(kobo: Kobo): string {
  return kobo.toString();
}

/**
 * Parse an amount typed into the search bar: "25000", "25,000", "₦25,000", "25k", "1.5m", "N25000".
 * Returns kobo, or null when the token isn't an amount.
 */
export function parseAmountQuery(token: string): Kobo | null {
  const t = token.trim().toLowerCase().replace(/^(₦|ngn|n)/, '').replace(/,/g, '');
  const m = /^(\d+(?:\.\d+)?)([km])?$/.exec(t);
  if (!m) return null;
  const [, num, suffix] = m;
  const [whole, frac = ''] = num!.split('.');
  const multiplierDigits = suffix === 'k' ? 3 : suffix === 'm' ? 6 : 0;
  // Shift the decimal point right by multiplierDigits + 2 (naira -> kobo) using strings.
  const shift = multiplierDigits + 2;
  if (frac.length > shift) return null;
  const digits = whole! + frac.padEnd(shift, '0');
  return BigInt(digits);
}

export class MoneyError extends Error {}

export const sumKobo = (values: Iterable<Kobo>): Kobo => {
  let total = 0n;
  for (const v of values) total += v;
  return total;
};
