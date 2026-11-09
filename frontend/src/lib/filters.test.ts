import { describe, expect, it } from 'vitest';
import { exportFilename, isDateParam, parseStatuses, parseView, toStatusParam, toggleStatus } from './filters';

describe('status filters', () => {
  it('parses only known statuses', () => {
    expect(parseStatuses('paid,bogus,waiting')).toEqual(['paid', 'waiting']);
    expect(parseStatuses(null)).toEqual([]);
  });
  it('toggles on and off, keeping a stable order', () => {
    expect(toggleStatus(['waiting'], 'paid')).toEqual(['paid', 'waiting']);
    expect(toggleStatus(['paid', 'waiting'], 'paid')).toEqual(['waiting']);
  });
  it('turns an empty list into no parameter at all', () => {
    expect(toStatusParam([])).toBeNull();
    expect(toStatusParam(['paid', 'expired'])).toBe('paid,expired');
  });
});

describe('view and date params', () => {
  it('accepts only real saved views', () => {
    expect(parseView('this_week')).toBe('this_week');
    expect(parseView('nope')).toBeNull();
  });
  it('accepts only YYYY-MM-DD dates', () => {
    expect(isDateParam('2026-11-06')).toBe(true);
    expect(isDateParam('6/11/2026')).toBe(false);
    expect(isDateParam(null)).toBe(false);
  });
  it('names the export file after its range', () => {
    expect(exportFilename('2026-11-01', '2026-11-06')).toBe('paidar-payments-2026-11-01-to-2026-11-06.csv');
    expect(exportFilename('', '')).toBe('paidar-payments-start-to-today.csv');
  });
});
