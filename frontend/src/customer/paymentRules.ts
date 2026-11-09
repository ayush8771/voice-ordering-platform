import type { OrderResponse, PaymentMethod } from '@vop/shared';

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

export const PAYMENT_METHOD_COPY: Record<PaymentMethod, PaymentMethodCopy> = {
  upiQr: {
    title: 'UPI',
    summary: UPI_ONLINE_PAYMENT_AVAILABLE
      ? 'Pay with any UPI app.'
      : 'Online UPI is not connected yet. Staff confirm your payment at the counter.',
    steps: [
      'Confirm your order to get a pickup token.',
      'Go to the counter with your token to pay.',
      'Staff confirm your payment. This screen updates once they do.',
    ],
  },
  cashAtCounter: {
    title: 'Cash on pickup',
    summary: 'Pay in cash at the counter when you collect your order.',
    steps: [
      'Confirm your order to get a pickup token.',
      'Pay in cash at the counter when you collect your order.',
      'Staff record your payment. This screen updates once they do.',
    ],
  },
};

/** Words for the payment line on the tracking screen. */
export const PAYMENT_METHOD_SHORT: Record<PaymentMethod, string> = {
  upiQr: 'UPI',
  cashAtCounter: 'Cash on pickup',
};

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
  readonly title: string;
  readonly body: string;
  /**
   * `server`: driven by a value the API returns today.
   * `client`: a real fact the client knows (no selection, no provider).
   * `placeholder`: no contract value exists; never produced from an order.
   */
  readonly source: 'server' | 'client' | 'placeholder';
}

const NOT_PAID_YET = 'Your order is confirmed, but your payment is not yet.';

export const PAYMENT_VIEWS: Record<PaymentViewKind, PaymentView> = {
  notSelected: {
    kind: 'notSelected',
    tone: 'neutral',
    title: 'Choose how to pay',
    body: 'Pick UPI or cash on pickup to continue. Nothing is charged on this screen.',
    source: 'client',
  },
  awaitingUpi: {
    kind: 'awaitingUpi',
    tone: 'pending',
    title: 'Payment pending',
    body: `${NOT_PAID_YET} Online UPI is not connected, so nothing has been charged. Pay at the counter with your token; staff will confirm it.`,
    source: 'server',
  },
  dueAtCounter: {
    kind: 'dueAtCounter',
    tone: 'pending',
    title: 'Pay at the counter',
    body: `${NOT_PAID_YET} Pay in cash at the counter when you collect your order.`,
    source: 'server',
  },
  pending: {
    kind: 'pending',
    tone: 'pending',
    title: 'Payment pending',
    body: `${NOT_PAID_YET} Staff will confirm it at the counter.`,
    source: 'server',
  },
  successful: {
    kind: 'successful',
    tone: 'success',
    title: 'Payment confirmed',
    body: 'The outlet has confirmed your payment.',
    source: 'server',
  },
  failed: {
    kind: 'failed',
    tone: 'error',
    title: 'Payment failed',
    body: 'No payment was recorded for this order. Please pay at the counter or ask staff for help.',
    source: 'server',
  },
  refunded: {
    kind: 'refunded',
    tone: 'neutral',
    title: 'Payment refunded',
    body: 'The outlet has recorded a refund for this order. Ask at the counter if you have questions.',
    source: 'server',
  },
  orderCancelled: {
    kind: 'orderCancelled',
    tone: 'error',
    title: 'Order cancelled',
    body: 'This order was cancelled. Please ask at the counter about any payment you made.',
    source: 'server',
  },
  unknown: {
    kind: 'unknown',
    tone: 'neutral',
    title: 'Payment status unknown',
    body: 'We could not read your payment status. Please ask at the counter.',
    source: 'server',
  },
  providerUnavailable: {
    kind: 'providerUnavailable',
    tone: 'neutral',
    title: 'Online UPI payment unavailable',
    body: 'Online UPI is not connected yet, so no QR code, UPI ID or payment link is shown here. You can still order and pay at the counter.',
    source: 'client',
  },
  verifying: {
    kind: 'verifying',
    tone: 'pending',
    title: 'Checking your payment',
    body: 'We are waiting for the payment provider to confirm your payment.',
    source: 'placeholder',
  },
  paymentCancelled: {
    kind: 'paymentCancelled',
    tone: 'neutral',
    title: 'Payment cancelled',
    body: 'The payment was cancelled before it completed. Your order is still confirmed — pay at the counter.',
    source: 'placeholder',
  },
};

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
