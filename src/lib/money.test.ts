import { describe, expect, it } from 'vitest';
import { addKobo, compareKobo, formatNaira, parseNairaInput, splitNaira, subKobo } from './money';

describe('formatNaira', () => {
  it('formats whole naira with kobo', () => {
    expect(formatNaira('2500000')).toBe('₦25,000.00');
  });
  it('hides zero kobo in auto mode', () => {
    expect(formatNaira('2500000', 'auto')).toBe('₦25,000');
    expect(formatNaira('2500050', 'auto')).toBe('₦25,000.50');
  });
  it('handles negatives (overpaid balances)', () => {
    expect(formatNaira('-250000')).toBe('−₦2,500.00');
  });
  it('is exact on very large values', () => {
    expect(formatNaira('900719925474099300')).toBe('₦9,007,199,254,740,993.00');
  });
  it('splits parts for display', () => {
    expect(splitNaira('5')).toEqual({ neg: false, whole: '0', frac: '05' });
  });
});

describe('parseNairaInput', () => {
  it('parses plain and grouped numbers', () => {
    expect(parseNairaInput('25000')).toBe('2500000');
    expect(parseNairaInput('₦25,000')).toBe('2500000');
    expect(parseNairaInput('25,000.50')).toBe('2500050');
  });
  it('parses k and m shorthand exactly', () => {
    expect(parseNairaInput('25k')).toBe('2500000');
    expect(parseNairaInput('1.5m')).toBe('150000000');
    expect(parseNairaInput('2.5K')).toBe('250000');
  });
  it('rejects junk and sub-kobo precision', () => {
    expect(parseNairaInput('abc')).toBeNull();
    expect(parseNairaInput('')).toBeNull();
    expect(parseNairaInput('0.001')).toBeNull();
    expect(parseNairaInput('-5')).toBeNull();
  });
});

describe('arithmetic', () => {
  it('adds, subtracts and compares', () => {
    expect(addKobo('100', '250')).toBe('350');
    expect(subKobo('100', '250')).toBe('-150');
    expect(compareKobo('5', '7')).toBe(-1);
    expect(compareKobo('7', '7')).toBe(0);
  });
});
