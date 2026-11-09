import type { JSX } from 'react';
import { CheckoutProgress, PaymentStateCard, UpiPresentation } from './PaymentStep';
import { PAYMENT_VIEWS, PAYMENT_VIEW_KINDS, type PaymentView } from './paymentRules';
import './ordering.css';

/**
 * DEVELOPMENT-ONLY design reference for every customer payment state
 * (`#/payment-preview`, mounted only when `import.meta.env.DEV`).
 *
 * Nothing here is a transaction: no API is called and no order exists. Each
 * card says whether the state is driven by a real server value today, by a
 * client-side fact, or is a design placeholder for a contract that does not
 * exist yet (no `verifying` or `cancelled` payment status is in
 * `PAYMENT_STATUSES`).
 */

const SOURCE_LABELS: Record<PaymentView['source'], string> = {
  server: 'Server-backed: shown when the API returns this status',
  client: 'Client state: no server call involved',
  placeholder: 'Design placeholder: no server state exists, never shown to customers',
};

export function PaymentStatePreview(): JSX.Element {
  return (
    <main className="vop-order vop-order--narrow">
      <h1>Payment states — design preview</h1>
      <p className="vop-pay-preview-banner" role="note">
        <strong>Development preview.</strong> These cards are not payments or orders. No
        server is called; nothing is charged or confirmed.
      </p>

      <CheckoutProgress current="payment" />

      <ul className="vop-list vop-pay-preview">
        {PAYMENT_VIEW_KINDS.map((kind) => {
          const view = PAYMENT_VIEWS[kind];
          return (
            <li key={kind}>
              <p
                className={`vop-pay-preview__source vop-pay-preview__source--${view.source}`}
              >
                <code>{kind}</code> · {SOURCE_LABELS[view.source]}
              </p>
              {kind === 'providerUnavailable' ? (
                // As customers see it on the payment step: the UPI area states it.
                <section className="vop-card">
                  <UpiPresentation />
                </section>
              ) : (
                <PaymentStateCard view={view} />
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
