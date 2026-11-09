/**
 * Pickup token windows.
 *
 * A pickup token is what a counter calls out, so it must be short and must not
 * collide with another live order at the same outlet. The reset policy -
 * previously open in docs/DATABASE.md section 3 - is: **sequential from 1 per
 * outlet per outlet-local calendar day**.
 *
 * The outlet's own timezone decides the day, not the server's: a kitchen in
 * Asia/Kolkata closing at 23:30 IST must not see tokens reset mid-service
 * because UTC rolled over at 05:30 IST.
 *
 * Tokens never wrap. The counter is only incremented, so a busy outlet simply
 * reaches four digits rather than reusing `1` while order `1` is still waiting.
 */

import type { OutletDoc } from '../../models/menu.js';

/**
 * The outlet's timezone, verified usable.
 *
 * A missing or invalid timezone is a data fault, not a customer error, so it
 * throws loudly (the same choice `assertMinorUnits` makes for a broken price)
 * rather than silently defaulting to a timezone the merchant never chose: a
 * wrong one resets tokens at the wrong hour of the kitchen's day.
 */
export function assertOutletTimezone(outlet: OutletDoc): string {
  const timezone = outlet.timezone;
  if (timezone === undefined || timezone.trim() === '') {
    throw new Error(`outlet ${outlet.publicId} has no timezone configured`);
  }
  try {
    // Only a valid IANA zone survives this; Node throws RangeError otherwise.
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  } catch {
    throw new Error(`outlet ${outlet.publicId} has an invalid timezone: ${timezone}`);
  }
  return timezone;
}

/** The outlet-local calendar day as `YYYY-MM-DD`: the token reset window. */
export function outletDateKey(timezone: string, nowMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowMs));

  const field = (type: 'year' | 'month' | 'day'): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  // Built from parts rather than from the formatted string, so a locale or ICU
  // change in date ordering cannot silently change the key format.
  return `${field('year')}-${field('month')}-${field('day')}`;
}
