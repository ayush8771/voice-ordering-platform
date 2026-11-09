import type { CartLineIssue, CartResponse, Language, MenuResponse } from '@vop/shared';
import { LOCALES, translate, type MessageKey } from '../i18n/translate';

/**
 * Display rules for a server-side draft. Pure functions: they read what the
 * server returned and never change a price, a total or an availability flag.
 *
 * Wording functions take the UI language (default English). They translate
 * only frontend-owned words; names from the menu are returned untouched.
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
export function cartIssueMessage(
  issue: CartLineIssue,
  language: Language = 'en',
): string {
  return translate(language, `issue.${issue}`);
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
  language: Language = 'en',
): string | undefined {
  if (cart === undefined || cart.items.length === 0) {
    return translate(language, 'blocked.empty');
  }
  if (cart.hasUnavailableItems) {
    return translate(language, 'blocked.unavailable');
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
  language: Language = 'en',
): string[] {
  const options = menu?.items.find((item) => item.id === menuItemId)?.options ?? [];
  return optionIds.map(
    (id) =>
      options.find((option) => option.id === id)?.label ??
      translate(language, 'option.generic'),
  );
}

/** One display string for a line's add-ons, or `undefined` when it has none. */
export function describeOptions(
  menu: MenuResponse | undefined,
  menuItemId: string,
  optionIds: readonly string[],
  language: Language = 'en',
): string | undefined {
  if (optionIds.length === 0) return undefined;
  return resolveOptionLabels(menu, menuItemId, optionIds, language).join(', ');
}

const ORDER_STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
  accepted: 'orderStatus.accepted',
  preparing: 'orderStatus.preparing',
  ready: 'orderStatus.ready',
  collected: 'orderStatus.collected',
  cancelled: 'orderStatus.cancelled',
};

const PAYMENT_STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
  pending: 'paymentStatus.pending',
  dueAtCounter: 'paymentStatus.dueAtCounter',
  verified: 'paymentStatus.verified',
  failed: 'paymentStatus.failed',
  refunded: 'paymentStatus.refunded',
};

/**
 * Customer wording for a kitchen status. Takes a plain string so a status the
 * server adds later renders as a neutral message instead of a raw code.
 */
export function orderStatusLabel(status: string, language: Language = 'en'): string {
  return translate(
    language,
    Object.hasOwn(ORDER_STATUS_KEYS, status)
      ? ORDER_STATUS_KEYS[status]!
      : 'orderStatus.unknown',
  );
}

/**
 * Customer wording for a payment status. An unknown value never reads as paid.
 */
export function paymentStatusLabel(status: string, language: Language = 'en'): string {
  return translate(
    language,
    Object.hasOwn(PAYMENT_STATUS_KEYS, status)
      ? PAYMENT_STATUS_KEYS[status]!
      : 'paymentStatus.unknown',
  );
}

/** Local clock time of the last successful status read, e.g. "2:05 pm". */
export function formatUpdatedTime(date: Date, language: Language = 'en'): string {
  return new Intl.DateTimeFormat(LOCALES[language], {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
