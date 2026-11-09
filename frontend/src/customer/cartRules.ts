import type { CartLineIssue, CartResponse } from '@vop/shared';

/**
 * Display rules for a server-side draft. Pure functions: they read what the
 * server returned and never change a price, a total or an availability flag.
 */

/**
 * Formats integer minor units for display. Money arithmetic never happens in
 * the client (docs/DATABASE.md section 1) - this only divides for display, on
 * an amount the server calculated.
 */
export function formatMoney(amountMinor: number, currency: 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

/**
 * Plain language for why a line can no longer be ordered, in the words
 * docs/UX_FLOWS.md flow 2 agreed on. A zero price on such a line is not a free
 * item, so the reason is always stated rather than implied by a struck-out
 * price.
 */
export function cartIssueMessage(issue: CartLineIssue): string {
  switch (issue) {
    case 'itemUnavailable':
      return 'Sold out right now.';
    case 'itemNotOnMenu':
      return 'No longer on the menu.';
    case 'optionUnavailable':
      return 'That customisation is unavailable right now.';
    case 'optionNotOnItem':
      return 'That customisation is no longer offered for this item.';
    case 'notPriceable':
      return 'This item cannot be priced right now.';
  }
}

/**
 * Why checkout is blocked, or `undefined` when the draft may be reviewed.
 *
 * An unavailable line blocks the quote request and every path to confirmation
 * until it is removed or replaced, so the customer never reaches a failed
 * confirmation (docs/UX_FLOWS.md flows 2 and 3).
 */
export function checkoutBlockedReason(
  cart: CartResponse | undefined,
): string | undefined {
  if (cart === undefined || cart.items.length === 0) {
    return 'Add something to your order first.';
  }
  if (cart.hasUnavailableItems) {
    return 'Remove or replace the unavailable items below before you continue.';
  }
  return undefined;
}
