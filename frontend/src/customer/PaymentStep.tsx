import type { JSX, ReactNode } from 'react';
import {
  PAYMENT_METHODS,
  type MenuResponse,
  type OrderResponse,
  type PaymentMethod,
  type QuoteResponse,
} from '@vop/shared';
import { describeOptions, formatMoney } from './cartRules';
import {
  PAYMENT_METHOD_COPY,
  PAYMENT_METHOD_SHORT,
  PAYMENT_VIEWS,
  UPI_ONLINE_PAYMENT_AVAILABLE,
  paymentViewForOrder,
  type PaymentView,
} from './paymentRules';
import './payment.css';

/**
 * Customer payment UI: the payment-choice step before confirmation, and the
 * payment status shown after the server has created the order.
 *
 * Choosing a method here is a selection, not a payment. The only thing the
 * Confirm button does is the existing explicit order confirmation; the payment
 * status afterwards is whatever the server returns (docs/UX_FLOWS.md flow 3).
 */

export type CheckoutStage = 'review' | 'payment' | 'confirmed';

const STAGES: readonly { id: CheckoutStage; label: string }[] = [
  { id: 'review', label: 'Review' },
  { id: 'payment', label: 'Payment' },
  { id: 'confirmed', label: 'Confirmed' },
];

/** Three-step progress indicator shared by review, payment and tracking. */
export function CheckoutProgress({ current }: { current: CheckoutStage }): JSX.Element {
  const currentIndex = STAGES.findIndex((s) => s.id === current);
  return (
    <ol className="vop-pay-progress" aria-label="Checkout progress">
      {STAGES.map((stage, index) => {
        const state =
          index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
        return (
          <li
            key={stage.id}
            className={`vop-pay-progress__step vop-pay-progress__step--${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="vop-pay-progress__dot" aria-hidden="true">
              {state === 'done' ? '✓' : index + 1}
            </span>
            <span>
              {stage.label}
              {state === 'done' && <span className="vop-visually-hidden"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Where a real UPI QR code will go. Today it states plainly that there is no
 * code: no QR, UPI ID or payment link is generated or invented (the payment QR
 * source is an open decision, docs/PRD.md section 9).
 */
export function UpiPresentation({
  compact = false,
}: {
  compact?: boolean;
}): JSX.Element {
  const view = PAYMENT_VIEWS.providerUnavailable;
  return (
    <div className={`vop-pay-upi${compact ? ' vop-pay-upi--compact' : ''}`}>
      <div
        className="vop-pay-qr"
        role="img"
        aria-label="UPI QR code area. No QR code is shown because online UPI payment is not connected."
      >
        <span className="vop-pay-qr__label">UPI QR code</span>
        <span className="vop-pay-qr__note">Not available yet</span>
      </div>
      <div className="vop-pay-upi__text">
        <p className="vop-pay-tag vop-pay-tag--neutral">{view.title}</p>
        <p className="vop-muted">{view.body}</p>
      </div>
    </div>
  );
}

/** One payment state as a card. Status is written, never colour alone. */
export function PaymentStateCard({
  view,
  children,
  live = false,
}: {
  view: PaymentView;
  children?: ReactNode;
  live?: boolean;
}): JSX.Element {
  return (
    <section
      className={`vop-card vop-pay-state vop-pay-state--${view.tone}`}
      aria-live={live ? 'polite' : undefined}
    >
      <p className="vop-pay-state__label">Payment</p>
      <h2 className="vop-pay-state__title">{view.title}</h2>
      <p className="vop-pay-state__body">{view.body}</p>
      {children}
    </section>
  );
}

/** The server's payment status for a created order. */
export function PaymentStatusPanel({ order }: { order: OrderResponse }): JSX.Element {
  const view = paymentViewForOrder(order);
  const showCash = view.kind === 'dueAtCounter';
  const showUpi =
    order.paymentMethod === 'upiQr' &&
    !UPI_ONLINE_PAYMENT_AVAILABLE &&
    view.kind === 'awaitingUpi';

  return (
    <PaymentStateCard view={view} live>
      <dl className="vop-pay-facts">
        <div>
          <dt>Method</dt>
          <dd>{PAYMENT_METHOD_SHORT[order.paymentMethod]}</dd>
        </div>
        <div>
          <dt>{view.kind === 'successful' ? 'Paid' : 'Amount to pay'}</dt>
          <dd>{formatMoney(order.totalMinor, order.currency)}</dd>
        </div>
      </dl>
      {showCash && (
        <p className="vop-pay-hint">
          Show token <strong>{order.token}</strong> at the counter and pay in cash.
          Staff will mark your order as paid.
        </p>
      )}
      {showUpi && <UpiPresentation compact />}
    </PaymentStateCard>
  );
}

/** Payment choice and the explicit order confirmation. */
export function PaymentStep({
  quote,
  menu,
  method,
  lockedMethod,
  busy,
  error,
  onSelect,
  onConfirm,
  onBack,
}: {
  quote: QuoteResponse;
  menu: MenuResponse;
  method: PaymentMethod | undefined;
  /**
   * Set while an earlier confirmation's outcome is unknown: the retry must
   * reuse this method (same idempotency key, same payload).
   */
  lockedMethod: PaymentMethod | undefined;
  busy: boolean;
  error: string | undefined;
  onSelect: (method: PaymentMethod) => void;
  onConfirm: (method: PaymentMethod) => void;
  onBack: () => void;
}): JSX.Element {
  const portions = quote.items.reduce((sum, line) => sum + line.quantity, 0);
  const total = formatMoney(quote.totalMinor, quote.currency);
  const hintId = 'vop-pay-confirm-hint';

  return (
    <>
      <h1>Payment</h1>
      <CheckoutProgress current="payment" />

      <section className="vop-card vop-pay-summary" aria-labelledby="vop-pay-summary-h">
        <h2 id="vop-pay-summary-h" className="vop-pay-section-title">
          Order summary
          <span className="vop-muted vop-pay-summary__count">
            {portions} {portions === 1 ? 'item' : 'items'}
          </span>
        </h2>
        <ul className="vop-list vop-pay-summary__lines">
          {quote.items.map((line, index) => {
            const addOns = describeOptions(menu, line.menuItemId, line.optionIds);
            return (
              <li key={`${line.menuItemId}-${index}`} className="vop-review-line">
                <span>
                  {line.quantity} × {line.name}
                  {addOns !== undefined && (
                    <span className="vop-line-options vop-muted">+ {addOns}</span>
                  )}
                </span>
                <span className="vop-review-line__price">
                  {formatMoney(line.lineTotalMinor, quote.currency)}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="vop-pay-payable">
          <span>Total payable</span>
          <span>{total}</span>
        </p>
      </section>

      <fieldset className="vop-pay-methods">
        <legend className="vop-pay-section-title">How would you like to pay?</legend>
        {PAYMENT_METHODS.map((m) => {
          const copy = PAYMENT_METHOD_COPY[m];
          const selected = method === m;
          const locked = lockedMethod !== undefined && lockedMethod !== m;
          return (
            <label
              key={m}
              className={`vop-choice vop-pay-method${selected ? ' vop-choice--selected' : ''}${locked ? ' vop-pay-method--locked' : ''}`}
            >
              <input
                type="radio"
                name="paymentMethod"
                value={m}
                checked={selected}
                disabled={locked}
                onChange={() => onSelect(m)}
              />
              <span className="vop-pay-method__text">
                <span className="vop-pay-method__title">
                  {copy.title}
                  {m === 'upiQr' && !UPI_ONLINE_PAYMENT_AVAILABLE && (
                    <span className="vop-pay-tag vop-pay-tag--neutral">
                      Online payment unavailable
                    </span>
                  )}
                </span>
                <span className="vop-muted vop-pay-method__summary">
                  {copy.summary}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {method === undefined ? (
        <PaymentStateCard view={PAYMENT_VIEWS.notSelected} />
      ) : (
        <section className="vop-card vop-pay-instructions" aria-live="polite">
          <h2 className="vop-pay-section-title">
            {method === 'upiQr' ? 'Paying by UPI' : 'Paying cash on pickup'}
          </h2>
          {method === 'upiQr' && <UpiPresentation />}
          <ol className="vop-pay-steps">
            {PAYMENT_METHOD_COPY[method].steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      )}

      <p className="vop-pay-notice" id={hintId}>
        <strong>Confirming places your order. It does not take a payment.</strong> The
        outlet confirms your payment separately, and this screen shows it once they do.
      </p>

      <div className="vop-actions">
        <button
          type="button"
          className="vop-button vop-button--primary"
          disabled={busy || method === undefined}
          aria-describedby={hintId}
          onClick={() => method !== undefined && onConfirm(method)}
        >
          Confirm order · {total}
        </button>
        <button type="button" className="vop-button" onClick={onBack}>
          Back to review
        </button>
      </div>
      {method === undefined && (
        <p className="vop-muted vop-pay-select-hint">
          Choose a payment method to continue.
        </p>
      )}

      {error !== undefined && (
        <p aria-live="polite" className="vop-error">
          {error}
          {lockedMethod !== undefined &&
            ' We could not tell whether your order was created. Press Confirm order again — a retry cannot create a second order. Your payment choice is kept so the retry matches.'}
        </p>
      )}
    </>
  );
}
