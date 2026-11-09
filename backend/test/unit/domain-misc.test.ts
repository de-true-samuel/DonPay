import { describe, expect, it } from 'vitest';
import { comparePayerName } from '../../src/domain/names';
import { looksLikePhone, normalizeNigerianPhone, phoneSearchDigits, redactPhone } from '../../src/domain/phone';
import { assertTransition, canTransition, isActionAllowed, InvalidTransitionError } from '../../src/domain/request-state';
import { parseSearchQuery } from '../../src/domain/search-query';
import {
  formatDueDay,
  formatLagosDateTime,
  lagosDateString,
  lagosMinuteOfDay,
  lagosStartOfDay,
  lagosStartOfWeek,
  parseHHMM,
  parseLagosDate,
} from '../../src/domain/time';
import { koraReferenceFor, nextAttemptReference, randomToken } from '../../src/domain/tokens';
import { parseCsv } from '../../src/services/customers';

describe('phone', () => {
  it.each([
    ['0803 123 4567', '+2348031234567'],
    ['08031234567', '+2348031234567'],
    ['2348031234567', '+2348031234567'],
    ['+234 803 123 4567', '+2348031234567'],
    ['+2340803 123 4567', '+2348031234567'],
    ['8031234567', '+2348031234567'],
    ['0703-123-4567', '+2347031234567'],
  ])('%s -> %s', (input, out) => expect(normalizeNigerianPhone(input)).toBe(out));

  it.each(['12345', '0803123456', '+1 415 555 0100', 'abc', ''])('rejects %s', (input) => expect(normalizeNigerianPhone(input)).toBeNull());

  it('search helpers', () => {
    expect(looksLikePhone('0803')).toBe(false);
    expect(looksLikePhone('080312')).toBe(true);
    expect(looksLikePhone('+23480312')).toBe(true);
    expect(looksLikePhone('+234803')).toBe(false);
    expect(phoneSearchDigits('0803 123')).toBe('803123');
    expect(redactPhone('+2348031234567')).toBe('+234•••••4567');
  });
});

describe('request state machine', () => {
  it('allows the happy path and late payments', () => {
    expect(canTransition('DRAFT', 'SENT')).toBe(true);
    expect(canTransition('SENT', 'PAID')).toBe(true);
    expect(canTransition('EXPIRED', 'PAID')).toBe(true);
    expect(canTransition('CANCELLED', 'PAID')).toBe(true);
  });
  it('blocks impossible transitions', () => {
    expect(canTransition('PAID', 'SENT')).toBe(false);
    expect(canTransition('DRAFT', 'PAID')).toBe(false);
    expect(canTransition('EXPIRED', 'SENT')).toBe(false);
    expect(() => assertTransition('PAID', 'CANCELLED')).toThrow(InvalidTransitionError);
  });
  it('actions', () => {
    expect(isActionAllowed('resend', 'EXPIRED')).toBe(true);
    expect(isActionAllowed('resend', 'DRAFT')).toBe(false);
    expect(isActionAllowed('cancel', 'PAID')).toBe(false);
  });
});

describe('Lagos time (UTC+1, no DST)', () => {
  const t = new Date('2026-11-05T23:30:00.000Z'); // 00:30 on Fri 6 Nov in Lagos
  it('day boundaries', () => {
    expect(lagosDateString(t)).toBe('2026-11-06');
    expect(lagosStartOfDay(t).toISOString()).toBe('2026-11-05T23:00:00.000Z');
    expect(lagosMinuteOfDay(t)).toBe(30);
    expect(parseLagosDate('2026-11-06')!.toISOString()).toBe('2026-11-05T23:00:00.000Z');
    expect(parseLagosDate('06/11/2026')).toBeNull();
  });
  it('week starts Monday', () => {
    // Fri 6 Nov 2026 -> Mon 2 Nov 00:00 Lagos = 1 Nov 23:00Z
    expect(lagosStartOfWeek(t).toISOString()).toBe('2026-11-01T23:00:00.000Z');
  });
  it('formatting', () => {
    expect(formatLagosDateTime(new Date('2026-11-05T14:45:00.000Z'))).toBe('3:45 PM, Thu 5 Nov');
    expect(formatLagosDateTime(new Date('2026-11-04T23:05:00.000Z'))).toBe('12:05 AM, Thu 5 Nov');
    const now = new Date('2026-11-05T10:00:00.000Z'); // Thursday
    expect(formatDueDay(new Date('2026-11-05T20:00:00.000Z'), now)).toBe('today');
    expect(formatDueDay(new Date('2026-11-06T09:00:00.000Z'), now)).toBe('tomorrow');
    expect(formatDueDay(new Date('2026-11-09T09:00:00.000Z'), now)).toBe('Monday');
    expect(formatDueDay(new Date('2026-11-20T09:00:00.000Z'), now)).toBe('Fri 20 Nov');
  });
  it('HH:MM', () => {
    expect(parseHHMM('19:30')).toBe(1170);
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('7:30')).toBeNull();
  });
});

describe('search query parsing', () => {
  it('splits phone, amount and text', () => {
    expect(parseSearchQuery('tolu 25k')).toEqual({ text: 'tolu', phoneDigits: null, amountKobo: 2500000n });
    expect(parseSearchQuery('0803 123 4567')).toEqual({ text: null, phoneDigits: '8031234567', amountKobo: null });
    expect(parseSearchQuery('bridal makeup')).toEqual({ text: 'bridal makeup', phoneDigits: null, amountKobo: null });
    expect(parseSearchQuery('₦25,000')).toEqual({ text: null, phoneDigits: null, amountKobo: 2500000n });
  });
  it('keeps small bare numbers as text', () => {
    expect(parseSearchQuery('room 3')).toEqual({ text: 'room 3', phoneDigits: null, amountKobo: null });
  });
  it('empty', () => {
    expect(parseSearchQuery('')).toEqual({ text: null, phoneDigits: null, amountKobo: null });
  });
});

describe('payer name check', () => {
  it.each([
    ['TOLU ADEYEMI', 'Tolu Adeyemi', 'match'],
    ['ADEYEMI TOLULOPE', 'Tolu Adeyemi', 'match'],
    ['MRS ADEYEMI F', 'Tolu Adeyemi', 'match'],
    ['CHINEDU OKAFOR', 'Tolu Adeyemi', 'different'],
    [null, 'Tolu Adeyemi', 'unknown'],
    ['', 'Tolu Adeyemi', 'unknown'],
  ] as const)('%s vs %s -> %s', (payer, customer, expected) => {
    expect(comparePayerName(payer, customer)).toBe(expected);
  });
});

describe('tokens and references', () => {
  it('random tokens are url-safe and long enough', () => {
    const t = randomToken(16);
    expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(new Set(Array.from({ length: 200 }, () => randomToken(16))).size).toBe(200);
  });
  it('Kora references', () => {
    expect(koraReferenceFor('abc')).toBe('KE-abc-1');
    expect(nextAttemptReference('KE-abc-1')).toBe('KE-abc-2');
    expect(nextAttemptReference('KE-abc-9')).toBe('KE-abc-10');
  });
});

describe('CSV parser', () => {
  it('handles quotes, commas, CRLF and BOM', () => {
    const csv = '﻿name,phone\r\n"Adeyemi, Tolu",0803 123 4567\r\n"Bola ""B"" Ade",08099998888\n\n';
    expect(parseCsv(csv)).toEqual([
      ['name', 'phone'],
      ['Adeyemi, Tolu', '0803 123 4567'],
      ['Bola "B" Ade', '08099998888'],
    ]);
  });
});
