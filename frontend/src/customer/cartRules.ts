import type { CartLineIssue, CartResponse, MenuResponse } from '@vop/shared';

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

/**
 * Names for a line's add-ons, read from the menu the client already holds.
 *
 * Display only: the server stays authoritative for which options are valid
 * and what they cost. An ID the menu no longer lists (for example after a
 * menu change) is not guessed at; it is reported as a generic add-on so the
 * customer still sees that the line carries a customisation.
 */
export function resolveOptionLabels(
  menu: MenuResponse | undefined,
  menuItemId: string,
  optionIds: readonly string[],
): string[] {
  const options = menu?.items.find((item) => item.id === menuItemId)?.options ?? [];
  return optionIds.map(
    (id) => options.find((option) => option.id === id)?.label ?? 'Add-on',
  );
}

/** One display string for a line's add-ons, or `undefined` when it has none. */
export function describeOptions(
  menu: MenuResponse | undefined,
  menuItemId: string,
  optionIds: readonly string[],
): string | undefined {
  if (optionIds.length === 0) return undefined;
  return resolveOptionLabels(menu, menuItemId, optionIds).join(', ');
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  accepted: 'Order received',
  preparing: 'Being prepared',
  ready: 'Ready for pickup',
  collected: 'Collected',
  cancelled: 'Cancelled',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting payment confirmation',
  dueAtCounter: 'Pay at the counter',
  verified: 'Payment confirmed',
  failed: 'Payment failed - please ask at the counter',
  refunded: 'Refunded',
};

/**
 * Customer wording for a kitchen status. Takes a plain string so a status the
 * server adds later renders as a neutral message instead of a raw code.
 */
export function orderStatusLabel(status: string): string {
  return Object.hasOwn(ORDER_STATUS_LABELS, status)
    ? ORDER_STATUS_LABELS[status]!
    : 'Status updating - please check at the counter';
}

/**
 * Customer wording for a payment status. An unknown value never reads as paid.
 */
export function paymentStatusLabel(status: string): string {
  return Object.hasOwn(PAYMENT_STATUS_LABELS, status)
    ? PAYMENT_STATUS_LABELS[status]!
    : 'Payment status unknown - please ask at the counter';
}

/** Local clock time of the last successful status read, e.g. "2:05 pm". */
export function formatUpdatedTime(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
