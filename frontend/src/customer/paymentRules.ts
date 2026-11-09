import type { Language, OrderResponse, PaymentMethod } from '@vop/shared';
import { translate } from '../i18n/translate';

/**
 * Customer payment display rules. Pure functions over what the server
 * returned: nothing here sets, infers or advances a payment status.
 *
 * Payment is confirmed only by a verified provider callback or an authorized
 * staff action (docs/SECURITY.md section 2). No provider is selected and the
 * payment QR source is an open decision (docs/PRD.md section 9), so:
 *  - no QR code, UPI ID or payment link is generated or shown;
 *  - `'verified'` is the only status that reads as paid, and it is only ever
 *    shown when the server returns it.
 *
 * Wording lives in the i18n dictionaries (`payview.*`, `method.*`); these
 * helpers take the UI language and default to English.
 */

/**
 * Whether an online UPI provider is wired up. False until a provider, its
 * QR/intent source and its verified callback exist on the backend. Kept as a
 * named constant so the "unavailable" copy is driven by one fact.
 */
export const UPI_ONLINE_PAYMENT_AVAILABLE = false;

export interface PaymentMethodCopy {
  readonly title: string;
  readonly summary: string;
  /** What happens after "Confirm order", in order. */
  readonly steps: readonly string[];
}

export function paymentMethodCopy(
  method: PaymentMethod,
  language: Language = 'en',
): PaymentMethodCopy {
  const t = (suffix: 'title' | 'summary' | 'step1' | 'step2' | 'step3'): string =>
    translate(language, `method.${method}.${suffix}`);
  return {
    title: t('title'),
    summary:
      method === 'upiQr' && UPI_ONLINE_PAYMENT_AVAILABLE
        ? translate(language, 'method.upiQr.summaryOnline')
        : t('summary'),
    steps: [t('step1'), t('step2'), t('step3')],
  };
}

/** Words for the payment line on the tracking screen. */
export function paymentMethodShort(
  method: PaymentMethod,
  language: Language = 'en',
): string {
  return translate(language, `method.${method}.short`);
}

export type PaymentTone = 'neutral' | 'pending' | 'success' | 'error';

/**
 * Every payment state the UI can draw. `source` says whether the state can
 * come from a real server response today, or exists only as a design
 * placeholder for a contract that does not exist yet.
 */
export const PAYMENT_VIEW_KINDS = [
  'notSelected',
  'awaitingUpi',
  'dueAtCounter',
  'pending',
  'successful',
  'failed',
  'refunded',
  'orderCancelled',
  'unknown',
  'providerUnavailable',
  'verifying',
  'paymentCancelled',
] as const;
export type PaymentViewKind = (typeof PAYMENT_VIEW_KINDS)[number];

export interface PaymentView {
  readonly kind: PaymentViewKind;
  readonly tone: PaymentTone;
  /**
   * `server`: driven by a value the API returns today.
   * `client`: a real fact the client knows (no selection, no provider).
   * `placeholder`: no contract value exists; never produced from an order.
   */
  readonly source: 'server' | 'client' | 'placeholder';
}

const view = (
  kind: PaymentViewKind,
  tone: PaymentTone,
  source: PaymentView['source'],
): PaymentView => ({ kind, tone, source });

export const PAYMENT_VIEWS: Record<PaymentViewKind, PaymentView> = {
  notSelected: view('notSelected', 'neutral', 'client'),
  awaitingUpi: view('awaitingUpi', 'pending', 'server'),
  dueAtCounter: view('dueAtCounter', 'pending', 'server'),
  pending: view('pending', 'pending', 'server'),
  successful: view('successful', 'success', 'server'),
  failed: view('failed', 'error', 'server'),
  refunded: view('refunded', 'neutral', 'server'),
  orderCancelled: view('orderCancelled', 'error', 'server'),
  unknown: view('unknown', 'neutral', 'server'),
  providerUnavailable: view('providerUnavailable', 'neutral', 'client'),
  verifying: view('verifying', 'pending', 'placeholder'),
  paymentCancelled: view('paymentCancelled', 'neutral', 'placeholder'),
};

/** Title and body for a payment state, in the UI language. */
export function paymentViewText(
  kind: PaymentViewKind,
  language: Language = 'en',
): { readonly title: string; readonly body: string } {
  return {
    title: translate(language, `payview.${kind}.title`),
    body: translate(language, `payview.${kind}.body`),
  };
}

/**
 * The payment state to show for a server-returned order. Only server values
 * are read; an unknown status never reads as paid. Placeholder kinds are
 * never returned.
 */
export function paymentViewForOrder(
  order: Pick<OrderResponse, 'orderStatus' | 'paymentStatus' | 'paymentMethod'>,
): PaymentView {
  // A refunded or confirmed payment is still worth stating on a cancelled
  // order; otherwise the cancellation is the headline.
  if (
    order.orderStatus === 'cancelled' &&
    order.paymentStatus !== 'verified' &&
    order.paymentStatus !== 'refunded'
  ) {
    return PAYMENT_VIEWS.orderCancelled;
  }
  switch (order.paymentStatus as string) {
    case 'verified':
      return PAYMENT_VIEWS.successful;
    case 'failed':
      return PAYMENT_VIEWS.failed;
    case 'refunded':
      return PAYMENT_VIEWS.refunded;
    case 'dueAtCounter':
      return PAYMENT_VIEWS.dueAtCounter;
    case 'pending':
      return order.paymentMethod === 'upiQr' && !UPI_ONLINE_PAYMENT_AVAILABLE
        ? PAYMENT_VIEWS.awaitingUpi
        : PAYMENT_VIEWS.pending;
    default:
      return PAYMENT_VIEWS.unknown;
  }
}
