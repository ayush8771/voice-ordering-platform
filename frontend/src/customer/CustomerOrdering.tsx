import { useState, type CSSProperties, type JSX } from 'react';
import {
  LANGUAGES,
  PAYMENT_METHODS,
  type CartLine,
  type Channel,
  type Language,
  type MenuItem,
  type PaymentMethod,
} from '@vop/shared';
import type { SpeechClients } from '../audio/types';
import { cartIssueMessage, checkoutBlockedReason, formatMoney } from './cartRules';
import { useOrdering } from './useOrdering';

/**
 * The customer ordering surface for both channels. Kiosk differs only in type
 * size and width (docs/DESIGN_SYSTEM.md); the rules, the backend calls and the
 * confirmation step are identical (docs/PRD.md invariants).
 *
 * Touch alone completes an order. The assistant panel is additive: when it is
 * unavailable, or no speech client is supplied, every step below still works
 * (docs/PRD.md section 5).
 */

const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  kn: 'ಕನ್ನಡ',
  hi: 'हिंदी',
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  upiQr: 'Pay by UPI QR',
  cashAtCounter: 'Pay cash at the counter',
};

const button: CSSProperties = {
  minHeight: 'var(--touch-target-min)',
  minWidth: 'var(--touch-target-min)',
  padding: '0 var(--space-4)',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  font: 'inherit',
  cursor: 'pointer',
};

const primaryButton: CSSProperties = {
  ...button,
  background: 'var(--color-primary)',
  borderColor: 'var(--color-primary-strong)',
  color: '#ffffff',
};

const card: CSSProperties = {
  padding: 'var(--space-4)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
};

/** One menu item with its optional, multi-select customisations. */
function MenuItemRow({
  item,
  disabled,
  onAdd,
}: {
  item: MenuItem;
  disabled: boolean;
  onAdd: (optionIds: readonly string[]) => void;
}): JSX.Element {
  const [selected, setSelected] = useState<readonly string[]>([]);

  const toggle = (optionId: string): void => {
    setSelected((current) =>
      current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId],
    );
  };

  return (
    <li style={{ ...card, marginBottom: 'var(--space-3)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0, fontSize: 'inherit' }}>{item.name}</h3>
        <span>{formatMoney(item.priceMinor, item.currency)}</span>
      </div>

      {item.description !== undefined && (
        <p style={{ margin: 'var(--space-2) 0', color: 'var(--color-text-muted)' }}>
          {item.description}
        </p>
      )}

      {item.options.length > 0 && (
        <fieldset
          style={{ border: 0, padding: 0, margin: 'var(--space-2) 0' }}
          disabled={!item.available}
        >
          <legend style={{ color: 'var(--color-text-muted)' }}>Add-ons</legend>
          {item.options.map((option) => (
            <label
              key={option.id}
              style={{
                display: 'inline-flex',
                gap: 'var(--space-2)',
                alignItems: 'center',
                minHeight: 'var(--touch-target-min)',
                marginRight: 'var(--space-4)',
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(option.id)}
                onChange={() => toggle(option.id)}
              />
              {option.label}
              {option.priceDeltaMinor !== 0 && (
                <span aria-hidden="true">
                  {' '}
                  ({formatMoney(option.priceDeltaMinor, item.currency)})
                </span>
              )}
            </label>
          ))}
        </fieldset>
      )}

      {item.available ? (
        <button
          type="button"
          style={primaryButton}
          disabled={disabled}
          onClick={() => {
            onAdd(selected);
            setSelected([]);
          }}
        >
          Add {item.name}
        </button>
      ) : (
        <p style={{ margin: 0, color: 'var(--color-warning)' }}>
          Sold out right now — not orderable.
        </p>
      )}
    </li>
  );
}

/** One draft line. An unavailable line is named as such, never just greyed. */
function CartLineRow({
  line,
  currency,
  disabled,
  onQuantity,
  onRemove,
}: {
  line: CartLine;
  currency: 'INR';
  disabled: boolean;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <li
      style={{
        ...card,
        marginBottom: 'var(--space-2)',
        borderColor: line.available ? 'var(--color-border)' : 'var(--color-warning)',
        borderWidth: line.available ? 1 : 2,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
        }}
      >
        <span>
          {line.name}
          {line.optionIds.length > 0 && (
            <span style={{ color: 'var(--color-text-muted)' }}>
              {' '}
              + {line.optionIds.length} add-on(s)
            </span>
          )}
        </span>
        {line.available && <span>{formatMoney(line.lineTotalMinor, currency)}</span>}
      </div>

      {!line.available && (
        <p style={{ margin: 'var(--space-2) 0', color: 'var(--color-warning)' }}>
          Not orderable: {line.issues.map(cartIssueMessage).join(' ')} It is not
          included in your total.
        </p>
      )}

      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          alignItems: 'center',
          marginTop: 'var(--space-2)',
        }}
      >
        <button
          type="button"
          style={button}
          disabled={disabled || !line.available}
          aria-label={`Fewer ${line.name}`}
          onClick={() => onQuantity(line.quantity - 1)}
        >
          −
        </button>
        <span aria-label={`Quantity of ${line.name}`}>{line.quantity}</span>
        <button
          type="button"
          style={button}
          disabled={disabled || !line.available}
          aria-label={`More ${line.name}`}
          onClick={() => onQuantity(line.quantity + 1)}
        >
          +
        </button>
        <button type="button" style={button} disabled={disabled} onClick={onRemove}>
          Remove
        </button>
      </div>
    </li>
  );
}

/**
 * Typed-or-spoken assistant input.
 *
 * Voice capture is wired to the interfaces in `audio/types.ts` and nothing
 * else: with no client supplied the microphone control is absent and says so,
 * which is the state this milestone ships in. A transcript, when one exists,
 * enters here as ordinary text - speech never confirms anything
 * (docs/SECURITY.md section 2).
 */
function AssistantPanel({
  unavailable,
  lastAssistantText,
  disabled,
  speech,
  onSend,
}: {
  unavailable: boolean;
  lastAssistantText: string | undefined;
  disabled: boolean;
  speech: SpeechClients | undefined;
  onSend: (text: string) => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const voiceReady = speech?.capture !== undefined && speech?.stt !== undefined;

  return (
    <section style={{ ...card, marginBottom: 'var(--space-4)' }}>
      <h2 style={{ marginTop: 0, fontSize: 'inherit' }}>Ask for something</h2>

      {unavailable ? (
        <p style={{ color: 'var(--color-warning)' }}>
          The assistant is unavailable right now. Please use the menu below — your order
          is unaffected.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = text.trim();
            if (value === '') return;
            setText('');
            onSend(value);
          }}
          style={{ display: 'flex', gap: 'var(--space-2)' }}
        >
          <label style={{ flex: 1 }}>
            <span style={{ color: 'var(--color-text-muted)' }}>
              Type what you would like
            </span>
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              style={{
                width: '100%',
                minHeight: 'var(--touch-target-min)',
                font: 'inherit',
                padding: '0 var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
              }}
            />
          </label>
          <button type="submit" style={primaryButton} disabled={disabled}>
            Send
          </button>
        </form>
      )}

      {!voiceReady && !unavailable && (
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 0 }}>
          Voice input is not available in this build. Typing and the menu work the same
          way.
        </p>
      )}

      {lastAssistantText !== undefined && (
        <p aria-live="polite" style={{ marginBottom: 0 }}>
          {lastAssistantText}
        </p>
      )}
    </section>
  );
}

export function CustomerOrdering({
  outletId,
  channel,
  speech,
}: {
  outletId: string;
  channel: Channel;
  /** Absent until the backend speech routes and Gnani schemas are verified. */
  speech?: SpeechClients;
}): JSX.Element {
  const flow = useOrdering(outletId, channel);
  const { state } = flow;
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cashAtCounter');
  const isKiosk = channel === 'kiosk';
  const blocked = checkoutBlockedReason(state.cart);

  const frame: CSSProperties = {
    maxWidth: isKiosk ? '900px' : '480px',
    margin: '0 auto',
    padding: 'var(--space-4)',
    fontSize: isKiosk ? 'var(--font-size-kiosk-body)' : 'var(--font-size-body)',
  };

  if (state.sessionLost) {
    return (
      <main style={frame}>
        <h1>Session ended</h1>
        <p aria-live="polite">
          This ordering session has expired, so the draft is gone. Start again, or order
          at the counter.
        </p>
        <button type="button" style={primaryButton} onClick={() => void flow.finish()}>
          Start a new order
        </button>
      </main>
    );
  }

  if (state.startupFailed || state.menu === undefined) {
    return (
      <main style={frame}>
        <h1>Ordering</h1>
        <p aria-live="polite">
          {state.startupFailed
            ? `We could not load the menu: ${state.error ?? 'connection problem.'} The menu is not empty — please retry or order at the counter.`
            : 'Loading the menu…'}
        </p>
        {state.startupFailed && (
          <button type="button" style={primaryButton} onClick={() => void flow.start()}>
            Retry
          </button>
        )}
      </main>
    );
  }

  const { menu, cart } = state;

  // --- Tracking ------------------------------------------------------------

  if (state.step === 'tracking' && state.order !== undefined) {
    const order = state.order;
    return (
      <main style={frame}>
        <h1>Order confirmed</h1>
        <section style={card} aria-live="polite">
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Pickup token</p>
          <p style={{ fontSize: '2em', margin: 'var(--space-2) 0' }}>{order.token}</p>
          <p style={{ margin: 0 }}>Kitchen status: {order.orderStatus}</p>
          <p style={{ margin: 0 }}>
            Payment: {PAYMENT_LABELS[order.paymentMethod]} — {order.paymentStatus}
          </p>
          <p style={{ color: 'var(--color-text-muted)' }}>
            {order.paymentStatus === 'verified'
              ? 'Payment confirmed by the outlet.'
              : 'Payment is not confirmed yet. Staff confirm it at the counter.'}
          </p>
          <p style={{ margin: 0 }}>
            Total {formatMoney(order.totalMinor, order.currency)}
          </p>
        </section>

        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            marginTop: 'var(--space-4)',
          }}
        >
          <button type="button" style={button} onClick={() => void flow.refreshOrder()}>
            Refresh status
          </button>
          <button type="button" style={button} onClick={() => void flow.finish()}>
            Start another order
          </button>
        </div>
        {state.error !== undefined && (
          <p aria-live="polite" style={{ color: 'var(--color-error)' }}>
            {state.error}
          </p>
        )}
      </main>
    );
  }

  // --- Review and confirmation --------------------------------------------

  if (state.step === 'review' && state.quote !== undefined) {
    const quote = state.quote;
    return (
      <main style={frame}>
        <h1>Review your order</h1>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {quote.items.map((line, index) => (
            <li
              key={`${line.menuItemId}-${index}`}
              style={{ ...card, marginBottom: 'var(--space-2)' }}
            >
              {line.quantity} × {line.name}
              {line.optionIds.length > 0 && (
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {' '}
                  + {line.optionIds.length} add-on(s)
                </span>
              )}
              <span style={{ float: 'right' }}>
                {formatMoney(line.lineTotalMinor, quote.currency)}
              </span>
            </li>
          ))}
        </ul>
        <p>
          <strong>Total {formatMoney(quote.totalMinor, quote.currency)}</strong>
        </p>

        <fieldset style={{ ...card, marginBottom: 'var(--space-4)' }}>
          <legend>How would you like to pay?</legend>
          {PAYMENT_METHODS.map((method) => (
            <label
              key={method}
              style={{
                display: 'flex',
                gap: 'var(--space-2)',
                alignItems: 'center',
                minHeight: 'var(--touch-target-min)',
              }}
            >
              <input
                type="radio"
                name="paymentMethod"
                checked={paymentMethod === method}
                onChange={() => setPaymentMethod(method)}
              />
              {PAYMENT_LABELS[method]}
            </label>
          ))}
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 0 }}>
            Payment is recorded by the outlet, not by this screen.
          </p>
        </fieldset>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" style={button} onClick={flow.backToOrdering}>
            Back to the menu
          </button>
          <button
            type="button"
            style={primaryButton}
            disabled={state.busy}
            onClick={() => void flow.confirm(paymentMethod)}
          >
            Confirm order
          </button>
        </div>

        {state.error !== undefined && (
          <p aria-live="polite" style={{ color: 'var(--color-error)' }}>
            {state.error} If you are not sure whether the order was created, press
            Confirm order again — a retry cannot create a second order.
          </p>
        )}
      </main>
    );
  }

  // --- Ordering ------------------------------------------------------------

  return (
    <main style={frame}>
      <h1>{menu.outlet.name}</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>
        {isKiosk ? 'Kiosk ordering' : 'Ordering on your phone'}
      </p>

      <fieldset style={{ border: 0, padding: 0, marginBottom: 'var(--space-4)' }}>
        <legend style={{ color: 'var(--color-text-muted)' }}>Language</legend>
        {LANGUAGES.map((language) => (
          <label
            key={language}
            style={{
              display: 'inline-flex',
              gap: 'var(--space-2)',
              alignItems: 'center',
              minHeight: 'var(--touch-target-min)',
              marginRight: 'var(--space-4)',
            }}
          >
            <input
              type="radio"
              name="language"
              checked={state.language === language}
              onChange={() => flow.setLanguage(language)}
            />
            {LANGUAGE_LABELS[language]}
          </label>
        ))}
      </fieldset>

      <AssistantPanel
        unavailable={state.assistantUnavailable}
        lastAssistantText={state.lastAssistantText}
        disabled={state.busy}
        speech={speech}
        onSend={(text) => void flow.sendUtterance(text)}
      />

      {state.error !== undefined && (
        <p aria-live="polite" style={{ color: 'var(--color-error)' }}>
          {state.error}
        </p>
      )}

      <section aria-live="polite" style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'inherit' }}>Your order</h2>
        {cart === undefined || cart.items.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)' }}>
            Nothing added yet. Browse the menu below, or ask for something above.
          </p>
        ) : (
          <>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {cart.items.map((line) => (
                <CartLineRow
                  key={line.lineId}
                  line={line}
                  currency={cart.currency}
                  disabled={state.busy}
                  onQuantity={(quantity) =>
                    quantity <= 0
                      ? void flow.removeLine(line.lineId)
                      : void flow.setQuantity(line.lineId, quantity)
                  }
                  onRemove={() => void flow.removeLine(line.lineId)}
                />
              ))}
            </ul>
            <p>
              <strong>Total {formatMoney(cart.totalMinor, cart.currency)}</strong>
            </p>
            <button type="button" style={button} onClick={() => void flow.clearDraft()}>
              Clear order
            </button>
          </>
        )}

        <div style={{ marginTop: 'var(--space-4)' }}>
          <button
            type="button"
            style={primaryButton}
            disabled={state.busy || blocked !== undefined}
            onClick={() => void flow.openReview()}
          >
            Review and confirm
          </button>
          {blocked !== undefined && (
            <p style={{ color: 'var(--color-text-muted)' }}>{blocked}</p>
          )}
        </div>
      </section>

      <h2 style={{ fontSize: 'inherit' }}>Menu</h2>
      {menu.categories.length === 0 && menu.items.length === 0 && (
        <p>This outlet has published no items yet. Please ask at the counter.</p>
      )}
      {[...menu.categories]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .concat(
          menu.items.some((item) => item.categoryId === undefined)
            ? [{ id: '', name: 'Other', sortOrder: Number.MAX_SAFE_INTEGER }]
            : [],
        )
        .map((category) => {
          const items = menu.items.filter(
            (item) => (item.categoryId ?? '') === category.id,
          );
          if (items.length === 0) return null;
          return (
            <section key={category.id === '' ? 'other' : category.id}>
              <h3 style={{ fontSize: 'inherit' }}>{category.name}</h3>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {items.map((item) => (
                  <MenuItemRow
                    key={item.id}
                    item={item}
                    disabled={state.busy}
                    onAdd={(optionIds) => void flow.addItem(item.id, optionIds)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
    </main>
  );
}
