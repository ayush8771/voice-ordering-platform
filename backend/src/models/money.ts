/**
 * Integer money helpers.
 *
 * Money is integer minor units (paise). Floating-point arithmetic on money is
 * prohibited (docs/DATABASE.md section 1), so every total is built from these
 * checked integer operations and a non-integer value is a hard error rather
 * than a silently rounded price.
 */

export type Currency = 'INR';

export const CURRENCY: Currency = 'INR';

/** Largest representable line or order total: ~21 lakh rupees in paise. */
export const MAX_MINOR_UNITS = 210_000_000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function assertMinorUnits(value: number, field: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${field} must be an integer number of minor units`);
  }
  if (value < 0) {
    throw new MoneyError(`${field} must not be negative`);
  }
  if (value > MAX_MINOR_UNITS) {
    throw new MoneyError(`${field} exceeds the maximum supported amount`);
  }
  return value;
}

/** Adds minor-unit amounts, refusing overflow instead of wrapping. */
export function addMinor(a: number, b: number, field: string): number {
  return assertMinorUnits(a + b, field);
}

/** Multiplies a unit price by a quantity, both already validated as integers. */
export function multiplyMinor(unit: number, quantity: number, field: string): number {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new MoneyError(`${field} quantity must be a positive integer`);
  }
  return assertMinorUnits(unit * quantity, field);
}
