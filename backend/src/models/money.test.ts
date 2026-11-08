import { describe, expect, it } from 'vitest';
import { addMinor, assertMinorUnits, MAX_MINOR_UNITS, multiplyMinor } from './money.js';

describe('assertMinorUnits', () => {
  it('accepts zero and whole paise', () => {
    expect(assertMinorUnits(0, 'x')).toBe(0);
    expect(assertMinorUnits(8000, 'x')).toBe(8000);
  });

  it.each([12.5, Number.NaN, Number.POSITIVE_INFINITY, -1, MAX_MINOR_UNITS + 1])(
    'rejects %p',
    (value) => {
      expect(() => assertMinorUnits(value, 'priceMinor')).toThrow(/priceMinor/);
    },
  );
});

describe('addMinor', () => {
  it('adds integer amounts', () => {
    expect(addMinor(4000, 6000, 'subtotal')).toBe(10000);
  });

  it('refuses a sum beyond the supported maximum', () => {
    expect(() => addMinor(MAX_MINOR_UNITS, 1, 'subtotal')).toThrow(/maximum/);
  });
});

describe('multiplyMinor', () => {
  it('multiplies a unit price by a quantity', () => {
    expect(multiplyMinor(4000, 3, 'line')).toBe(12000);
  });

  it('rejects a non-positive or fractional quantity', () => {
    expect(() => multiplyMinor(4000, 0, 'line')).toThrow(/positive integer/);
    expect(() => multiplyMinor(4000, 1.5, 'line')).toThrow(/positive integer/);
  });

  it('refuses a product beyond the supported maximum', () => {
    expect(() => multiplyMinor(MAX_MINOR_UNITS, 2, 'line')).toThrow(/maximum/);
  });

  it('uses exact integer arithmetic, never floating point', () => {
    // 0.1 + 0.2 style drift is impossible because the inputs are paise.
    expect(multiplyMinor(10, 3, 'line')).toBe(30);
    expect(addMinor(multiplyMinor(10, 3, 'line'), 1, 'sum')).toBe(31);
  });
});
