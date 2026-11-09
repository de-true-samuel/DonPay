import { describe, expect, it } from 'vitest';
import { buildResolution, RESOLUTIONS } from './review';

describe('buildResolution', () => {
  it('joins the outcome and the note', () => {
    expect(buildResolution('Refund the customer', ' sent via transfer ')).toBe('Refund the customer. sent via transfer');
    expect(buildResolution('Accept the late payment', '')).toBe('Accept the late payment');
  });
  it('stays within the 500 characters a note may need', () => {
    expect(buildResolution('x', 'y'.repeat(900)).length).toBe(500);
  });
});

describe('RESOLUTIONS', () => {
  it('offers an "other" way out for every kind', () => {
    for (const list of Object.values(RESOLUTIONS)) expect(list.some((o) => o.value === 'other')).toBe(true);
  });
});
