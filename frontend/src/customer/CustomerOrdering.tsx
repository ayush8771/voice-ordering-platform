import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import {
  type CartLine,
  type CartResponse,
  type Channel,
  type MenuCategory,
  type MenuItem,
  type MenuResponse,
  type PaymentMethod,
} from '@vop/shared';
import {
  OTHER_CATEGORY_ID,
  filterByCategory,
  itemCount,
  menuSections,
  searchSections,
} from './menuDiscovery';
import type { SpeechClients } from '../audio/types';
import {
  cartIssueMessage,
  checkoutBlockedReason,
  describeOptions,
  formatMoney,
  formatUpdatedTime,
  orderStatusLabel,
} from './cartRules';
import { CheckoutProgress, PaymentStatusPanel, PaymentStep } from './PaymentStep';
import { useI18n } from '../i18n/I18nProvider';
import { LanguageChoice } from '../i18n/LanguagePicker';
import { useOrdering } from './useOrdering';
import { VoiceKioskPanel } from './VoiceKioskPanel';
import './ordering.css';

/**
 * The customer ordering surface for both channels. Kiosk differs only in type
 * size, width and control size (docs/DESIGN_SYSTEM.md); the rules, the
 * backend calls and the confirmation step are identical (docs/PRD.md
 * invariants). Layout is responsive and lives in `ordering.css`.
 *
 * Touch alone completes an order. The assistant panel is additive: when it is
 * unavailable, or no speech client is supplied, every step below still works
 * (docs/PRD.md section 5).
 */

/** Smooth scrolling only when the customer has not asked for less motion. */
function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
}

/**
 * Scrolls to a section and moves focus to its heading, so keyboard and
 * screen-reader users land where sighted users see the page go.
 *
 * In-page anchors (`href="#..."`) are deliberately not used: the surface is
 * chosen from `location.hash` (App.tsx), so an anchor would switch a kiosk to
 * the QR surface.
 */
function jumpTo(heading: HTMLElement | null): void {
  if (heading === null) return;
  heading.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  heading.focus({ preventScroll: true });
}

/** Brings the menu results back into view if the customer scrolled past them. */
function revealIfAbove(element: HTMLElement | null): void {
  if (element === null) return;
  if (element.getBoundingClientRect().top < 0) {
    element.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }
}

/** React key for a category; the uncategorised group has an empty id. */
function categoryKey(category: MenuCategory): string {
  return category.id === OTHER_CATEGORY_ID ? 'other' : category.id;
}

/** How many portions the draft holds - a count for a label, not money. */
function portionCount(cart: CartResponse): number {
  return cart.items.reduce((sum, line) => sum + line.quantity, 0);
}

function ErrorMessage({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p aria-live="polite" className="vop-error">
      {children}
    </p>
  );
}

/** One menu item with its optional, multi-select customisations. */
function MenuItemCard({
  item,
  disabled,
  onAdd,
}: {
  item: MenuItem;
  disabled: boolean;
  onAdd: (optionIds: readonly string[]) => void;
}): JSX.Element {
  const { t, tp } = useI18n();
  const [selected, setSelected] = useState<readonly string[]>([]);

  const toggle = (optionId: string): void => {
    setSelected((current) =>
      current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId],
    );
  };

  const statusId = `vop-item-status-${item.id}`;

  return (
    <li
      className={`vop-card vop-item${item.available ? '' : ' vop-item--unavailable'}`}
      aria-describedby={statusId}
    >
      <div className="vop-item__head">
        <h4 className="vop-item__name">{item.name}</h4>
        <span className="vop-item__price">
          {formatMoney(item.priceMinor, item.currency)}
        </span>
      </div>

      <p
        id={statusId}
        className={`vop-badge ${item.available ? 'vop-badge--available' : 'vop-badge--unavailable'}`}
      >
        {item.available ? t('item.available') : t('item.soldOut')}
      </p>

      {item.description !== undefined && (
        <p className="vop-item__description vop-muted">{item.description}</p>
      )}

      {item.options.length > 0 && (
        <fieldset className="vop-options" disabled={!item.available}>
          <legend>
            {t('item.addOns')} <span className="vop-muted">{t('item.addOnsHint')}</span>
          </legend>
          <div className="vop-options__list">
            {item.options.map((option) => {
              const checked = selected.includes(option.id);
              const delta =
                option.priceDeltaMinor === 0
                  ? t('item.noExtraCharge')
                  : `${option.priceDeltaMinor > 0 ? '+' : '−'}${formatMoney(
                      Math.abs(option.priceDeltaMinor),
                      item.currency,
                    )}`;
              return (
                <label
                  key={option.id}
                  className={`vop-choice vop-option${checked ? ' vop-choice--selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(option.id)}
                  />
                  <span className="vop-option__label">{option.label}</span>
                  <span
                    className={`vop-options__delta${option.priceDeltaMinor === 0 ? ' vop-muted' : ''}`}
                  >
                    {delta}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="vop-item__add">
        {item.available ? (
          <button
            type="button"
            className="vop-button vop-button--primary vop-button--block"
            disabled={disabled}
            onClick={() => {
              onAdd(selected);
              setSelected([]);
            }}
          >
            {selected.length > 0
              ? tp('item.addWith', selected.length, { name: item.name })
              : t('item.add', { name: item.name })}
          </button>
        ) : (
          <button
            type="button"
            className="vop-button vop-button--block vop-item__soldout"
            disabled
          >
            {t('item.soldOutButton')}
          </button>
        )}
      </div>
    </li>
  );
}

/** One draft line. An unavailable line is named as such, never just greyed. */
function CartLineRow({
  line,
  menu,
  currency,
  disabled,
  onQuantity,
  onRemove,
}: {
  line: CartLine;
  menu: MenuResponse;
  currency: 'INR';
  disabled: boolean;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}): JSX.Element {
  const { t, language } = useI18n();
  const addOns = describeOptions(menu, line.menuItemId, line.optionIds, language);
  return (
    <li
      className={`vop-card vop-cart-line${line.available ? '' : ' vop-cart-line--unavailable'}`}
    >
      <div className="vop-line-head">
        <span>
          {line.name}
          {addOns !== undefined && (
            <span className="vop-line-options vop-muted">+ {addOns}</span>
          )}
        </span>
        {line.available && (
          <span className="vop-line-head__price">
            {formatMoney(line.lineTotalMinor, currency)}
          </span>
        )}
      </div>

      {!line.available && (
        <p className="vop-warning" style={{ margin: 'var(--space-2) 0' }}>
          {t('cart.notOrderable', {
            reasons: line.issues
              .map((issue) => cartIssueMessage(issue, language))
              .join(' '),
          })}
        </p>
      )}

      <div className="vop-qty">
        <button
          type="button"
          className="vop-button"
          disabled={disabled || !line.available}
          aria-label={t('cart.fewer', { name: line.name })}
          onClick={() => onQuantity(line.quantity - 1)}
        >
          −
        </button>
        <span
          className="vop-qty__value"
          aria-label={t('cart.quantityOf', { name: line.name })}
        >
          {line.quantity}
        </span>
        <button
          type="button"
          className="vop-button"
          disabled={disabled || !line.available}
          aria-label={t('cart.more', { name: line.name })}
          onClick={() => onQuantity(line.quantity + 1)}
        >
          +
        </button>
        <button
          type="button"
          className="vop-button vop-qty__remove"
          disabled={disabled}
          aria-label={t('cart.removeItem', { name: line.name })}
          onClick={onRemove}
        >
          {t('cart.remove')}
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
  const { t } = useI18n();
  const [text, setText] = useState('');
  const voiceReady = speech?.capture !== undefined && speech?.stt !== undefined;

  return (
    <section className="vop-card vop-assistant">
      <h2>{t('assistant.heading')}</h2>

      {unavailable ? (
        <p className="vop-warning">{t('assistant.unavailable')}</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = text.trim();
            if (value === '') return;
            setText('');
            onSend(value);
          }}
        >
          <label>
            <span className="vop-muted">{t('assistant.typeLabel')}</span>
            <input
              className="vop-input"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="vop-button vop-button--primary"
            disabled={disabled}
          >
            {t('assistant.send')}
          </button>
        </form>
      )}

      {!voiceReady && !unavailable && (
        <p className="vop-muted" style={{ marginBottom: 0 }}>
          {t('assistant.noVoice')}
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
  const { t, tp, language } = useI18n();
  const flow = useOrdering(outletId, channel, language);
  const { state } = flow;
  /** Frontend-owned errors are translated; server messages are shown as sent. */
  const errorText =
    state.error === undefined
      ? undefined
      : state.error.kind === 'key'
        ? t(state.error.key)
        : state.error.text;
  const languageBar = (
    <div className="vop-language-bar">
      <LanguageChoice />
    </div>
  );
  /**
   * No method is preselected: the customer chooses one on the payment step.
   * Cleared for the next customer so a shared kiosk never carries it over.
   */
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | undefined>(
    undefined,
  );
  const cartHeading = useRef<HTMLHeadingElement>(null);
  const menuResults = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  /** `undefined` shows every category. */
  const [activeCategory, setActiveCategory] = useState<string | undefined>(undefined);
  const isKiosk = channel === 'kiosk';
  const blocked = checkoutBlockedReason(state.cart, language);

  /**
   * Each checkout step replaces the whole screen, which would leave keyboard
   * and screen-reader focus on a button that no longer exists. Move it to the
   * new screen's heading instead (not on first load, so the menu is not
   * scrolled or announced twice).
   */
  const previousStep = useRef(state.step);
  useEffect(() => {
    if (previousStep.current === state.step) return;
    previousStep.current = state.step;
    const heading = document.querySelector<HTMLElement>('.vop-order h1');
    if (heading === null) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
  }, [state.step]);
  const startOver = (): void => {
    setPaymentMethod(undefined);
    void flow.finish();
  };

  const frameClass = (narrow: boolean, extra = ''): string =>
    [
      'vop-order',
      isKiosk ? 'vop-order--kiosk' : '',
      narrow ? 'vop-order--narrow' : '',
      extra,
    ]
      .filter((name) => name !== '')
      .join(' ');

  if (state.sessionLost) {
    return (
      <main className={frameClass(true)}>
        {languageBar}
        <h1>{t('session.endedTitle')}</h1>
        <p aria-live="polite">{t('session.endedBody')}</p>
        <div className="vop-actions">
          <button
            type="button"
            className="vop-button vop-button--primary"
            onClick={startOver}
          >
            {t('session.startNew')}
          </button>
        </div>
      </main>
    );
  }

  if (state.startupFailed || state.menu === undefined) {
    return (
      <main className={frameClass(true)}>
        {languageBar}
        <h1>{t('startup.title')}</h1>
        <p aria-live="polite">
          {state.startupFailed
            ? t('startup.failed', {
                reason: errorText ?? t('startup.connectionProblem'),
              })
            : t('startup.loading')}
        </p>
        {state.startupFailed && (
          <div className="vop-actions">
            <button
              type="button"
              className="vop-button vop-button--primary"
              onClick={() => void flow.start()}
            >
              {t('common.retry')}
            </button>
          </div>
        )}
      </main>
    );
  }

  const { menu, cart } = state;

  // --- Tracking ------------------------------------------------------------

  if (state.step === 'tracking' && state.order !== undefined) {
    const order = state.order;
    return (
      <main className={frameClass(true)}>
        {languageBar}
        <h1>{t('tracking.title')}</h1>
        <CheckoutProgress current="confirmed" />
        <div className="vop-pay-stack">
          <section className="vop-card" aria-live="polite">
            <p className="vop-muted" style={{ margin: 0 }}>
              {t('tracking.token')}
            </p>
            <p className="vop-token">{order.token}</p>
            <p className="vop-pay-order-state">
              <span className="vop-pay-tag">{t('tracking.orderConfirmed')}</span>
              <span className="vop-muted">
                {t('tracking.kitchen', {
                  status: orderStatusLabel(order.orderStatus, language),
                })}
              </span>
            </p>
          </section>

          <PaymentStatusPanel order={order} />

          {flow.canTrackLive ? (
            state.orderUpdatedAt !== undefined && (
              <p className="vop-muted" style={{ margin: 0 }}>
                {t('tracking.lastUpdated', {
                  time: formatUpdatedTime(state.orderUpdatedAt, language),
                })}
              </p>
            )
          ) : (
            <p className="vop-warning" style={{ margin: 0 }}>
              {t('tracking.noLive', { token: order.token })}
            </p>
          )}
        </div>

        <div className="vop-actions">
          {flow.canTrackLive && (
            <button
              type="button"
              className="vop-button"
              onClick={() => void flow.refreshOrder()}
            >
              {t('tracking.refresh')}
            </button>
          )}
          <button type="button" className="vop-button" onClick={startOver}>
            {t('tracking.another')}
          </button>
        </div>
        {errorText !== undefined && <ErrorMessage>{errorText}</ErrorMessage>}
      </main>
    );
  }

  // --- Review --------------------------------------------------------------

  if (state.step === 'review' && state.quote !== undefined) {
    const quote = state.quote;
    return (
      <main className={frameClass(true)}>
        {languageBar}
        <h1>{t('review.title')}</h1>
        <CheckoutProgress current="review" />
        <ul className="vop-list" style={{ margin: 'var(--space-4) 0' }}>
          {quote.items.map((line, index) => (
            <li
              key={`${line.menuItemId}-${index}`}
              className="vop-card vop-review-line"
            >
              <span>
                {line.quantity} × {line.name}
                {line.optionIds.length > 0 && (
                  <span className="vop-line-options vop-muted">
                    + {describeOptions(menu, line.menuItemId, line.optionIds, language)}
                  </span>
                )}
              </span>
              <span className="vop-review-line__price">
                {formatMoney(line.lineTotalMinor, quote.currency)}
              </span>
            </li>
          ))}
        </ul>
        <p className="vop-total">
          <span>{t('common.total')}</span>
          <span>{formatMoney(quote.totalMinor, quote.currency)}</span>
        </p>

        <p className="vop-muted" style={{ margin: 0 }}>
          {t('review.hint')}
        </p>

        <div className="vop-actions">
          <button
            type="button"
            className="vop-button vop-button--primary"
            disabled={state.busy}
            onClick={flow.openPayment}
          >
            {t('review.continue')}
          </button>
          <button type="button" className="vop-button" onClick={flow.backToOrdering}>
            {t('review.backToMenu')}
          </button>
        </div>

        {errorText !== undefined && <ErrorMessage>{errorText}</ErrorMessage>}
      </main>
    );
  }

  // --- Payment choice and confirmation -----------------------------------

  if (state.step === 'payment' && state.quote !== undefined) {
    return (
      <main className={frameClass(true)}>
        {languageBar}
        <PaymentStep
          quote={state.quote}
          menu={menu}
          method={state.lockedPaymentMethod ?? paymentMethod}
          lockedMethod={state.lockedPaymentMethod}
          busy={state.busy}
          error={errorText}
          onSelect={setPaymentMethod}
          onConfirm={(method) => void flow.confirm(method)}
          onBack={flow.backToReview}
        />
      </main>
    );
  }

  // --- Ordering ------------------------------------------------------------

  const allSections = menuSections(menu);
  const searched = searchSections(allSections, query);
  // A category that has disappeared from the menu falls back to all.
  const category = allSections.some((s) => s.category.id === activeCategory)
    ? activeCategory
    : undefined;
  const visible = filterByCategory(searched, category);
  const visibleCount = itemCount(visible);
  const searching = query.trim() !== '';
  const activeName = allSections.find((s) => s.category.id === category)?.category.name;
  const hasLines = cart !== undefined && cart.items.length > 0;

  const chooseCategory = (id: string | undefined): void => {
    setActiveCategory(id);
    revealIfAbove(menuResults.current);
  };
  const clearSearch = (): void => {
    setQuery('');
    searchInput.current?.focus();
  };

  const trimmed = query.trim();
  const resultSummary = searching
    ? activeName !== undefined
      ? tp('results.searchIn', visibleCount, { query: trimmed, category: activeName })
      : tp('results.search', visibleCount, { query: trimmed })
    : activeName !== undefined
      ? tp('results.showing', visibleCount, { category: activeName })
      : '';

  return (
    <main className={frameClass(false, hasLines ? 'vop-order--with-cart-bar' : '')}>
      <header className="vop-header">
        <h1>{menu.outlet.name}</h1>
        <p className="vop-muted" style={{ margin: 0 }}>
          {isKiosk ? t('order.kioskSubtitle') : t('order.qrSubtitle')}
        </p>

        <LanguageChoice />
      </header>

      <div className="vop-layout">
        <div className="vop-layout__menu">
          {isKiosk ? (
            <VoiceKioskPanel
              speech={speech}
              language={language}
              assistantUnavailable={state.assistantUnavailable}
              lastAssistantText={state.lastAssistantText}
              busy={state.busy}
              onSend={(text) => flow.sendUtterance(text)}
            />
          ) : (
            <AssistantPanel
              unavailable={state.assistantUnavailable}
              lastAssistantText={state.lastAssistantText}
              disabled={state.busy}
              speech={speech}
              onSend={(text) => void flow.sendUtterance(text)}
            />
          )}

          {errorText !== undefined && <ErrorMessage>{errorText}</ErrorMessage>}

          <h2>{t('menu.heading')}</h2>
          {allSections.length === 0 ? (
            <p>{t('menu.empty')}</p>
          ) : (
            <div className="vop-discovery">
              <form
                role="search"
                className="vop-search"
                onSubmit={(event) => {
                  // Results already update as the customer types.
                  event.preventDefault();
                }}
              >
                <label className="vop-search__label" htmlFor="vop-menu-search">
                  {t('search.label')}
                </label>
                <div className="vop-search__row">
                  <input
                    id="vop-menu-search"
                    ref={searchInput}
                    className="vop-input vop-search__input"
                    type="search"
                    autoComplete="off"
                    placeholder={t('search.placeholder')}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape' && query !== '') {
                        event.preventDefault();
                        setQuery('');
                      }
                    }}
                  />
                  {query !== '' && (
                    <button
                      type="button"
                      className="vop-button vop-search__clear"
                      onClick={clearSearch}
                    >
                      {t('search.clear')}
                    </button>
                  )}
                </div>
              </form>

              {allSections.length > 1 && (
                <nav className="vop-categories" aria-label={t('categories.label')}>
                  <ul>
                    <li>
                      <button
                        type="button"
                        className="vop-button vop-category-chip"
                        aria-pressed={category === undefined}
                        onClick={() => chooseCategory(undefined)}
                      >
                        {t('categories.all')}
                        {searching && (
                          <span className="vop-category-chip__count">
                            {itemCount(searched)}
                          </span>
                        )}
                      </button>
                    </li>
                    {allSections.map((section) => {
                      const matches =
                        searched.find((s) => s.category.id === section.category.id)
                          ?.items.length ?? 0;
                      return (
                        <li key={categoryKey(section.category)}>
                          <button
                            type="button"
                            className="vop-button vop-category-chip"
                            aria-pressed={category === section.category.id}
                            onClick={() => chooseCategory(section.category.id)}
                          >
                            {section.category.name}
                            {searching && (
                              <span className="vop-category-chip__count">
                                {matches}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              )}

              <p className="vop-visually-hidden" aria-live="polite">
                {resultSummary}
              </p>

              <div ref={menuResults} className="vop-menu-results">
                {visible.length === 0 ? (
                  <div className="vop-card vop-empty">
                    <p className="vop-empty__title">
                      {searching
                        ? activeName !== undefined
                          ? t('empty.searchIn', {
                              query: trimmed,
                              category: activeName,
                            })
                          : t('empty.search', { query: trimmed })
                        : t('empty.category')}
                    </p>
                    <p className="vop-muted">{t('empty.hint')}</p>
                    <div className="vop-actions">
                      {searching && (
                        <button
                          type="button"
                          className="vop-button vop-button--primary"
                          onClick={clearSearch}
                        >
                          {t('empty.clearSearch')}
                        </button>
                      )}
                      {category !== undefined && (
                        <button
                          type="button"
                          className="vop-button"
                          onClick={() => chooseCategory(undefined)}
                        >
                          {t('empty.showAll')}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  visible.map(({ category: section, items }) => (
                    <section
                      key={categoryKey(section)}
                      className="vop-category-section"
                    >
                      <h3>{section.name}</h3>
                      <ul className="vop-list vop-menu-grid">
                        {items.map((item) => (
                          <MenuItemCard
                            key={item.id}
                            item={item}
                            disabled={state.busy}
                            onAdd={(optionIds) => void flow.addItem(item.id, optionIds)}
                          />
                        ))}
                      </ul>
                    </section>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="vop-layout__cart" aria-label={t('cart.heading')}>
          <section aria-live="polite" className="vop-cart">
            <h2 ref={cartHeading} tabIndex={-1}>
              {t('cart.heading')}
            </h2>
            {cart === undefined || cart.items.length === 0 ? (
              <p className="vop-muted">{t('cart.empty')}</p>
            ) : (
              <>
                <ul className="vop-list">
                  {cart.items.map((line) => (
                    <CartLineRow
                      key={line.lineId}
                      line={line}
                      menu={menu}
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
                <p className="vop-total">
                  <span>{t('common.total')}</span>
                  <span>{formatMoney(cart.totalMinor, cart.currency)}</span>
                </p>
              </>
            )}

            <div className="vop-actions" style={{ flexDirection: 'column' }}>
              <button
                type="button"
                className="vop-button vop-button--primary vop-button--block"
                disabled={state.busy || blocked !== undefined}
                onClick={() => void flow.openReview()}
              >
                {t('cart.review')}
              </button>
              {hasLines && (
                <button
                  type="button"
                  className="vop-button vop-button--block"
                  onClick={() => void flow.clearDraft()}
                >
                  {t('cart.clear')}
                </button>
              )}
            </div>
            {blocked !== undefined && <p className="vop-muted">{blocked}</p>}
          </section>
        </aside>
      </div>

      {cart !== undefined && cart.items.length > 0 && (
        <div className="vop-cart-bar">
          <button
            type="button"
            className="vop-button vop-button--primary"
            onClick={() => jumpTo(cartHeading.current)}
          >
            <span>{tp('cart.view', portionCount(cart))}</span>
            <span>{formatMoney(cart.totalMinor, cart.currency)}</span>
          </button>
        </div>
      )}
    </main>
  );
}
