import { describe, expect, it } from 'vitest';
import { formatPhone } from './phone';

describe('formatPhone', () => {
  it('shows Nigerian numbers the way people write them', () => {
    expect(formatPhone('+2348031234567')).toBe('0803 123 4567');
  });
  it('leaves other formats alone', () => {
    expect(formatPhone('+14155550100')).toBe('+14155550100');
  });
});
