/** All money is whole kobo as a decimal string. Math goes through BigInt, never floats. */
export type Kobo = string;

export function toBig(v: string | number | bigint): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new Error('Unsafe money number');
    return BigInt(v);
  }
  return BigInt(v);
}

export const addKobo = (a: Kobo, b: Kobo): Kobo => (toBig(a) + toBig(b)).toString();
export const subKobo = (a: Kobo, b: Kobo): Kobo => (toBig(a) - toBig(b)).toString();
export const compareKobo = (a: Kobo, b: Kobo): -1 | 0 | 1 => {
  const x = toBig(a), y = toBig(b);
  return x < y ? -1 : x > y ? 1 : 0;
};
export const isPositiveKobo = (a: Kobo): boolean => toBig(a) > 0n;

export function splitNaira(k: Kobo): { neg: boolean; whole: string; frac: string } {
  const v = toBig(k);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (abs % 100n).toString().padStart(2, '0');
  return { neg, whole, frac };
}

export function formatNaira(k: Kobo, kobo: 'always' | 'auto' | 'never' = 'always'): string {
  const { neg, whole, frac } = splitNaira(k);
  const showFrac = kobo === 'always' || (kobo === 'auto' && frac !== '00');
  return `${neg ? '−' : ''}₦${whole}${showFrac ? '.' + frac : ''}`;
}

/**
 * Parses what people type: "25000", "25,000", "₦25,000.50", "25k", "1.5m".
 * Returns whole kobo, or null when it isn't a clean amount. Exact: no rounding.
 */
export function parseNairaInput(raw: string): Kobo | null {
  const s = raw.trim().toLowerCase().replace(/[₦\s,]/g, '').replace(/^ngn/, '').replace(/^n(?=\d)/, '');
  const m = /^(\d+)(?:\.(\d+))?(k|m)?$/.exec(s);
  if (!m) return null;
  const int = m[1];
  const frac = m[2] ?? '';
  const mult = m[3] === 'k' ? 1000n : m[3] === 'm' ? 1_000_000n : 1n;
  const scale = 10n ** BigInt(frac.length);
  const kobo = BigInt(int + frac) * 100n * mult;
  if (kobo % scale !== 0n) return null;
  return (kobo / scale).toString();
}
