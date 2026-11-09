import { describe, expect, it } from 'vitest';
import { isValidNgPhone, parseDatePhrase, parseQuickEntry } from './quickEntry';

// Friday 6 Nov 2026, 10:00 Lagos
const NOW = new Date('2026-11-06T10:00:00+01:00');

describe('parseQuickEntry', () => {
  it('reads a full line with deposit and balance date', () => {
    const r = parseQuickEntry('Tolu 0803 123 4567 bridal makeup 50k, 25k deposit, balance friday', NOW);
    expect(r.name).toBe('Tolu');
    expect(r.phone).toBe('08031234567');
    expect(r.service).toBe('Bridal makeup');
    expect(r.totalKobo).toBe('5000000');
    expect(r.depositKobo).toBe('2500000');
    expect(r.plan).toBe('DEPOSIT_BALANCE');
    expect(r.balanceDueDate).toBe('2026-11-13');
    expect(r.assumed).toEqual([]);
  });
  it('reads a simple full payment', () => {
    const r = parseQuickEntry('Ada 08099998888 aso-ebi fitting 15,000', NOW);
    expect(r).toMatchObject({ name: 'Ada', service: 'Aso-ebi fitting', totalKobo: '1500000', plan: 'FULL' });
  });
  it('handles a phone number at the end and a ₦ sign', () => {
    const r = parseQuickEntry('Emeka photo shoot ₦120,000 0701 222 3333', NOW);
    expect(r).toMatchObject({ name: 'Emeka', service: 'Photo shoot', totalKobo: '12000000', phone: '07012223333' });
  });
  it('handles +234 numbers', () => {
    expect(parseQuickEntry('Kemi +234 803 123 4567 hair braiding 40k', NOW).phone).toBe('+2348031234567');
  });
  it('works with only a name and amount', () => {
    const r = parseQuickEntry('tolu 25k', NOW);
    expect(r).toMatchObject({ name: 'Tolu', phone: '', service: '', totalKobo: '2500000' });
  });
  it('flags a guessed deposit when two plain amounts appear', () => {
    const r = parseQuickEntry('Bode 0803 111 2222 cake 80k 40k', NOW);
    expect(r.totalKobo).toBe('8000000');
    expect(r.depositKobo).toBe('4000000');
    expect(r.assumed).toEqual(['deposit']);
  });
  it('adds deposit and balance amounts to get the total', () => {
    const r = parseQuickEntry('Ngozi 0803 123 4567 catering 25k deposit, balance 25k friday', NOW);
    expect(r.totalKobo).toBe('5000000');
    expect(r.depositKobo).toBe('2500000');
  });
  it('does not treat small numbers as money', () => {
    const r = parseQuickEntry('Sade 0803 123 4567 2 layer cake 30k', NOW);
    expect(r.totalKobo).toBe('3000000');
    expect(r.service).toBe('2 layer cake');
  });
  it('never throws on junk', () => {
    expect(() => parseQuickEntry('', NOW)).not.toThrow();
    expect(parseQuickEntry('???', NOW).totalKobo).toBeNull();
  });
});

describe('parseDatePhrase', () => {
  it('reads relative and named dates', () => {
    expect(parseDatePhrase('tomorrow', NOW)).toBe('2026-11-07');
    expect(parseDatePhrase('in 2 weeks', NOW)).toBe('2026-11-20');
    expect(parseDatePhrase('12 nov', NOW)).toBe('2026-11-12');
    expect(parseDatePhrase('next week', NOW)).toBe('2026-11-13');
    expect(parseDatePhrase('whenever', NOW)).toBeNull();
  });
  it('rolls a past date to next year', () => {
    expect(parseDatePhrase('2 nov', NOW)).toBe('2027-11-02');
  });
});

describe('isValidNgPhone', () => {
  it('accepts common formats and rejects bad ones', () => {
    expect(isValidNgPhone('0803 123 4567')).toBe(true);
    expect(isValidNgPhone('+2348031234567')).toBe(true);
    expect(isValidNgPhone('12345')).toBe(false);
  });
});
