import { describe, expect, it } from 'vitest';
import {
  formatNaira,
  formatNairaShort,
  koboToNairaNumber,
  koboToNairaString,
  MoneyError,
  nairaToKobo,
  parseAmountQuery,
  parseKoboInput,
} from '../../src/domain/money';

describe('nairaToKobo', () => {
  it.each([
    ['25000', 2500000n],
    ['25000.5', 2500050n],
    ['25000.50', 2500050n],
    ['25,000.00', 2500000n],
    ['0.01', 1n],
    ['  100 ', 10000n],
    ['21474836.48', 2147483648n], // above 32-bit Int: why money is BigInt
    ['999999999999.99', 99999999999999n],
  ])('parses string %s', (input, expected) => {
    expect(nairaToKobo(input)).toBe(expected);
  });

  it.each([
    [25000, 2500000n],
    [25000.5, 2500050n],
    [0.1 + 0.2, 30n], // 0.30000000000000004 rounds to 30 kobo
    [1.005, 101n], // half-up on the third decimal
    [0, 0n],
  ])('parses number %s', (input, expected) => {
    expect(nairaToKobo(input)).toBe(expected);
  });

  it.each(['1e3', '25000.505', '-5', 'abc', '', '25.000.00', '₦25000'])('rejects %s', (input) => {
    expect(() => nairaToKobo(input)).toThrow(MoneyError);
  });

  it.each([NaN, Infinity, -1, 1e21])('rejects number %s', (input) => {
    expect(() => nairaToKobo(input)).toThrow(MoneyError);
  });
});

describe('formatting', () => {
  it('formats kobo as naira', () => {
    expect(formatNaira(2500000n)).toBe('₦25,000.00');
    expect(formatNaira(2500050n)).toBe('₦25,000.50');
    expect(formatNaira(5n)).toBe('₦0.05');
    expect(formatNaira(-150n)).toBe('-₦1.50');
    expect(formatNaira(123456789012n)).toBe('₦1,234,567,890.12');
  });
  it('short form drops .00 only', () => {
    expect(formatNairaShort(2500000n)).toBe('₦25,000');
    expect(formatNairaShort(2500050n)).toBe('₦25,000.50');
  });
  it('round-trips through the Kora string format', () => {
    for (const k of [0n, 1n, 99n, 100n, 2500050n, 99999999999999n]) {
      expect(nairaToKobo(koboToNairaString(k))).toBe(k);
    }
    expect(koboToNairaNumber(2500050n)).toBe(25000.5);
  });
});

describe('parseKoboInput', () => {
  it('accepts digit strings and safe integers', () => {
    expect(parseKoboInput('2500000')).toBe(2500000n);
    expect(parseKoboInput(2500000)).toBe(2500000n);
    expect(parseKoboInput('0')).toBe(0n);
  });
  it.each(['25000.00', '-1', '1e6', '', ' 1', 1.5, -1, Number.MAX_SAFE_INTEGER + 2, null, undefined, {}])('rejects %s', (v) => {
    expect(() => parseKoboInput(v)).toThrow(MoneyError);
  });
});

describe('parseAmountQuery', () => {
  it.each([
    ['25000', 2500000n],
    ['25,000', 2500000n],
    ['₦25,000', 2500000n],
    ['N25000', 2500000n],
    ['ngn25000', 2500000n],
    ['25k', 2500000n],
    ['25K', 2500000n],
    ['1.5m', 150000000n],
    ['2.5k', 250000n],
    ['100.50', 10050n],
  ])('%s -> %s kobo', (q, expected) => {
    expect(parseAmountQuery(q)).toBe(expected);
  });
  it('allows kobo precision after a multiplier: 1.2345k = ₦1,234.50', () => {
    expect(parseAmountQuery('1.2345k')).toBe(123450n);
  });
  it.each(['tolu', '25kk', 'k', '1.234567k', 'abc'])('returns null for %s', (q) => {
    expect(parseAmountQuery(q)).toBeNull();
  });
});
