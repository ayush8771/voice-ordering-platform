import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CartResponse,
  Channel,
  ConversationPhase,
  ConversationTurnResponse,
  Language,
  MenuResponse,
  OrderResponse,
  PaymentMethod,
  QuoteResponse,
} from '@vop/shared';
import * as api from '../api/client';
import { ApiRequestError } from '../api/client';
import type { MessageKey } from '../i18n/translate';
import { classifyCartConflict } from './cartConflict';
import { classifyConfirmFailure } from './confirmOutcome';

/**
 * The customer ordering flow, as one hook: session, menu, draft, quote,
 * confirmation and tracking.
 *
 * It holds no ordering authority. Every amount, availability flag, pickup
 * token and status here is whatever the server last returned, and the only
 * step that creates an order is `confirm`, called from an explicit press
 * (docs/SECURITY.md section 2).
 *
 * The draft lives on the server, so each mutation replaces the whole cart with
 * the server's repriced answer - the touch path and the conversational path
 * amend the same draft and see each other's changes (docs/UX_FLOWS.md flow 2).
 */

/** Which screen the customer is on. Drives the conversational `phase`. */
export type Step = 'ordering' | 'review' | 'payment' | 'tracking';

export interface OrderingState {
  readonly step: Step;
  readonly menu: MenuResponse | undefined;
  readonly cart: CartResponse | undefined;
  readonly quote: QuoteResponse | undefined;
  readonly order: OrderResponse | undefined;
  /** When the order was last read successfully from the server. */
  readonly orderUpdatedAt: Date | undefined;
  /** Set when the server said the assistant is unavailable for this session. */
  readonly assistantUnavailable: boolean;
  readonly lastAssistantText: string | undefined;
  /**
   * The last failure, if any: a frontend-owned message key (translated when
   * shown) or the server's own safe message, shown exactly as sent.
   */
  readonly error: UiMessage | undefined;
  /** True while the session itself must be restarted before anything works. */
  readonly sessionLost: boolean;
  readonly busy: boolean;
  readonly startupFailed: boolean;
  /**
   * Set when a confirmation may have reached the server without an answer
   * (network failure or 5xx). A retry must resend the same payload under the
   * same idempotency key, so the payment choice is fixed until it resolves.
   */
  readonly lockedPaymentMethod: PaymentMethod | undefined;
}

const POLL_INTERVAL_MS = 15_000;
const FINAL_STATUSES = ['collected', 'cancelled'];

/** The outlet is resolved from the QR/kiosk URL; a session is scoped to it. */
export function readOutletId(search: string, hash: string): string | undefined {
  const fromSearch = new URLSearchParams(search).get('outlet');
  if (fromSearch !== null && fromSearch !== '') return fromSearch;
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
  const fromHash = new URLSearchParams(query).get('outlet');
  return fromHash === null || fromHash === '' ? undefined : fromHash;
}

/** A failure message: a frontend-owned key, or server text kept verbatim. */
export type UiMessage =
  | { readonly kind: 'key'; readonly key: MessageKey }
  | { readonly kind: 'server'; readonly text: string };

function uiKey(key: MessageKey): UiMessage {
  return { kind: 'key', key };
}

/**
 * The client writes its own messages for a network failure (status 0) and for
 * a response without the server's error envelope (no request ID); those are
 * translated. A message from the server's envelope is shown as sent.
 */
export function messageOf(error: unknown): UiMessage {
  if (!(error instanceof ApiRequestError)) return uiKey('error.generic');
  if (error.status === 0) return uiKey('error.network');
  if (error.requestId === undefined) return uiKey('error.unexpected');
  return { kind: 'server', text: error.message };
}

/**
 * `language` is the UI language (from the i18n provider). It is sent with
 * each conversation turn and never resets the session, draft or order.
 */
export function useOrdering(outletId: string, channel: Channel, language: Language) {
  const [state, setState] = useState<OrderingState>({
    step: 'ordering',
    menu: undefined,
    cart: undefined,
    quote: undefined,
    order: undefined,
    orderUpdatedAt: undefined,
    assistantUnavailable: false,
    lastAssistantText: undefined,
    error: undefined,
    sessionLost: false,
    busy: true,
    startupFailed: false,
    lockedPaymentMethod: undefined,
  });

  /**
   * One key per confirmation attempt, reused by every retry of that attempt so
   * a retry cannot create a second order (docs/UX_FLOWS.md flow 3).
   */
  const idempotencyKey = useRef<string | undefined>(undefined);
  /** Payment method last sent under `idempotencyKey`, if any. */
  const attemptMethod = useRef<PaymentMethod | undefined>(undefined);

  /** Starts a fresh confirmation attempt: new key, no method sent yet. */
  const newAttempt = useCallback((): void => {
    idempotencyKey.current = crypto.randomUUID();
    attemptMethod.current = undefined;
  }, []);

  const patch = useCallback((next: Partial<OrderingState>): void => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  /**
   * Runs one server call and folds its outcome into the state.
   *
   * A `401` means the session is gone: ordering stops and the customer is
   * offered a restart rather than being shown a draft that no longer exists.
   * A `409` means the draft moved under us - typically the voice path - so the
   * current draft is re-read and shown instead of being overwritten.
   */
  const run = useCallback(
    async <T>(call: () => Promise<T>, apply: (result: T) => Partial<OrderingState>) => {
      patch({ busy: true, error: undefined });
      try {
        patch({ ...apply(await call()), busy: false });
      } catch (error) {
        if (error instanceof ApiRequestError && error.code === 'UNAUTHORIZED') {
          api.clearSessionId();
          patch({ sessionLost: true, busy: false, error: messageOf(error) });
          return;
        }
        if (
          error instanceof ApiRequestError &&
          error.code === 'CONFLICT' &&
          classifyCartConflict(error.details) === 'revision'
        ) {
          const cart = await api.getCart().catch(() => undefined);
          patch({
            ...(cart === undefined ? {} : { cart }),
            busy: false,
            error: uiKey('error.draftChanged'),
          });
          return;
        }
        // Any other 409 is a refusal that left the draft as it was: say why,
        // never that it changed.
        if (error instanceof ApiRequestError && error.status === 409) {
          const message = messageOf(error);
          patch({
            busy: false,
            error: message.kind === 'server' ? message : uiKey('error.cartConflict'),
          });
          return;
        }
        patch({ busy: false, error: messageOf(error) });
      }
    },
    [patch],
  );

  /** Starts (or restarts) the session and loads the menu and draft. */
  const start = useCallback(async (): Promise<void> => {
    patch({ busy: true, error: undefined, startupFailed: false });
    try {
      const menu = await api.getMenu(outletId);
      if (api.getSessionId() === undefined) {
        await api.createOrderingSession(outletId, channel);
      }
      // A stored session may have expired; a failed read starts a fresh one
      // rather than leaving the customer on a dead session.
      const cart = await api.getCart().catch(async (error: unknown) => {
        if (error instanceof ApiRequestError && error.code === 'UNAUTHORIZED') {
          api.clearSessionId();
          await api.createOrderingSession(outletId, channel);
          return api.getCart();
        }
        throw error;
      });
      patch({
        menu,
        cart,
        quote: undefined,
        order: undefined,
        orderUpdatedAt: undefined,
        step: 'ordering',
        sessionLost: false,
        lockedPaymentMethod: undefined,
        busy: false,
      });
    } catch (error) {
      // Never show an empty menu as if the outlet had no food
      // (docs/UX_FLOWS.md flow 1).
      patch({ busy: false, startupFailed: true, error: messageOf(error) });
    }
  }, [channel, outletId, patch]);

  useEffect(() => {
    void start();
  }, [start]);

  // --- Draft ---------------------------------------------------------------

  const addItem = useCallback(
    (menuItemId: string, optionIds: readonly string[]) =>
      run(
        () =>
          api.addCartItem({
            menuItemId,
            quantity: 1,
            ...(optionIds.length === 0 ? {} : { optionIds }),
          }),
        (cart) => ({ cart, quote: undefined }),
      ),
    [run],
  );

  const setQuantity = useCallback(
    (lineId: string, quantity: number) =>
      run(
        () => api.updateCartItem(lineId, { quantity }, state.cart?.revision),
        (cart) => ({ cart, quote: undefined }),
      ),
    [run, state.cart?.revision],
  );

  const removeLine = useCallback(
    (lineId: string) =>
      run(
        () => api.removeCartItem(lineId, state.cart?.revision),
        (cart) => ({ cart, quote: undefined }),
      ),
    [run, state.cart?.revision],
  );

  const clearDraft = useCallback(
    () =>
      run(
        () => api.clearCart(),
        (cart) => ({ cart, quote: undefined }),
      ),
    [run],
  );

  // --- Review and confirmation --------------------------------------------

  /** Quotes the stored draft and opens review. A fresh attempt, a fresh key. */
  const openReview = useCallback(() => {
    newAttempt();
    return run(
      () => api.quoteCart(),
      (quote) => ({ quote, step: 'review' as Step, lockedPaymentMethod: undefined }),
    );
  }, [newAttempt, run]);

  const backToOrdering = useCallback(() => {
    patch({ step: 'ordering', quote: undefined, error: undefined });
  }, [patch]);

  /**
   * Moves from review to the payment choice. The quote and the confirmation
   * attempt's idempotency key are kept: choosing how to pay is part of the
   * same confirmation, and creates nothing.
   */
  const openPayment = useCallback(() => {
    if (state.quote === undefined) {
      patch({ error: uiKey('error.reviewBeforePay') });
      return;
    }
    patch({ step: 'payment', error: undefined });
  }, [patch, state.quote]);

  const backToReview = useCallback(() => {
    patch({ step: 'review', error: undefined });
  }, [patch]);

  /**
   * Creates the order. Outcomes:
   *  - success: tracking.
   *  - 409/422: the server refused the quote (expired, menu or price change,
   *    or a now-unavailable line). A matching earlier order under this key
   *    would have been replayed instead, so no order exists: the draft is
   *    re-quoted under a fresh key and the customer reviews it again.
   *  - other 4xx: refused, nothing created; the customer may retry or go back.
   *  - network failure or 5xx: the outcome is unknown. The key and the payment
   *    method are kept so a retry replays rather than duplicates.
   */
  const confirm = useCallback(
    async (paymentMethod: PaymentMethod): Promise<void> => {
      const quote = state.quote;
      if (quote === undefined) {
        patch({ error: uiKey('error.reviewBeforeConfirm') });
        return;
      }
      const sent = attemptMethod.current;
      if (sent !== undefined && sent !== paymentMethod) {
        patch({
          error: uiKey('error.sameMethod'),
        });
        return;
      }
      const key = idempotencyKey.current ?? crypto.randomUUID();
      idempotencyKey.current = key;
      attemptMethod.current = paymentMethod;

      patch({ busy: true, error: undefined });
      try {
        const order = await api.createOrder(
          { outletId, quoteId: quote.quoteId, paymentMethod },
          key,
        );
        attemptMethod.current = undefined;
        patch({
          order,
          orderUpdatedAt: new Date(),
          step: 'tracking',
          quote: undefined,
          lockedPaymentMethod: undefined,
          busy: false,
        });
      } catch (error) {
        const failure =
          error instanceof ApiRequestError
            ? classifyConfirmFailure(error.status, error.code)
            : 'unknown';

        if (failure === 'sessionLost') {
          api.clearSessionId();
          patch({ sessionLost: true, busy: false, error: messageOf(error) });
          return;
        }

        if (failure === 'staleQuote') {
          newAttempt();
          try {
            const fresh = await api.quoteCart();
            patch({
              quote: fresh,
              step: 'review',
              lockedPaymentMethod: undefined,
              busy: false,
              error: uiKey('error.staleQuote'),
            });
          } catch {
            const cart = await api.getCart().catch(() => undefined);
            patch({
              ...(cart === undefined ? {} : { cart }),
              quote: undefined,
              step: 'ordering',
              lockedPaymentMethod: undefined,
              busy: false,
              error: uiKey('error.menuChanged'),
            });
          }
          return;
        }

        if (failure === 'refused') {
          // Refused outright; nothing was created under this key.
          attemptMethod.current = undefined;
          patch({
            busy: false,
            lockedPaymentMethod: undefined,
            error: messageOf(error),
          });
          return;
        }

        patch({
          busy: false,
          lockedPaymentMethod: paymentMethod,
          error: messageOf(error),
        });
      }
    },
    [newAttempt, outletId, patch, state.quote],
  );

  // --- Tracking ------------------------------------------------------------

  /**
   * Whether this tab holds the read capability for the order on screen. The
   * server issues it only on first creation; an idempotent replay (a retry
   * after a lost response) omits it, and the order then cannot be re-read.
   */
  const orderId = state.order?.orderId;
  const canTrackLive =
    orderId !== undefined && api.getStoredOrderAccess()?.orderId === orderId;

  const refreshOrder = useCallback(async (): Promise<void> => {
    const access = api.getStoredOrderAccess();
    // Never apply another order's capability to the order on screen.
    if (access === undefined || access.orderId !== orderId) {
      patch({
        error: uiKey('error.noLiveStatus'),
      });
      return;
    }
    try {
      patch({ order: await api.getOrder(access), orderUpdatedAt: new Date() });
    } catch (error) {
      patch({ error: messageOf(error) });
    }
  }, [orderId, patch]);

  useEffect(() => {
    const status = state.order?.orderStatus;
    if (!canTrackLive || status === undefined || FINAL_STATUSES.includes(status))
      return;
    const timer = window.setInterval(() => void refreshOrder(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [canTrackLive, refreshOrder, state.order?.orderStatus]);

  /** Ends the session and starts a clean one, for the next customer. */
  const finish = useCallback(async (): Promise<void> => {
    api.clearStoredOrderAccess();
    await api.endOrderingSession().catch(() => undefined);
    await start();
  }, [start]);

  // --- Conversation --------------------------------------------------------

  /**
   * Sends one utterance. The reply is text; the draft shown afterwards is the
   * server's, never the assistant's account of it. A `503` switches the
   * surface to touch-only and loses nothing from the draft.
   */
  const sendUtterance = useCallback(
    async (text: string, declinedRecommendation = false): Promise<void> => {
      const phase: ConversationPhase =
        state.step === 'payment'
          ? 'payment'
          : state.step === 'review'
            ? 'review'
            : (state.cart?.items.length ?? 0) === 0
              ? 'browsing'
              : 'building';

      patch({ busy: true, error: undefined });
      try {
        const turn: ConversationTurnResponse = await api.sendConversationTurn({
          language,
          phase,
          text,
          ...(declinedRecommendation ? { customerDeclinedRecommendation: true } : {}),
        });
        patch({
          cart: turn.cart,
          quote: undefined,
          lastAssistantText: turn.assistantText,
          assistantUnavailable: turn.providerStatus.fallback === 'touch',
          busy: false,
        });
      } catch (error) {
        // The assistant being unavailable is not an ordering failure: the draft
        // is untouched and the touch path still completes the order
        // (docs/PRD.md section 5).
        const unavailable =
          error instanceof ApiRequestError &&
          (error.code === 'SERVICE_UNAVAILABLE' || error.status === 0);
        patch({
          busy: false,
          assistantUnavailable: unavailable,
          error: messageOf(error),
        });
      }
    },
    [language, patch, state.cart?.items.length, state.step],
  );

  return {
    state,
    canTrackLive,
    start,
    addItem,
    setQuantity,
    removeLine,
    clearDraft,
    openReview,
    backToOrdering,
    openPayment,
    backToReview,
    confirm,
    refreshOrder,
    finish,
    sendUtterance,
  };
}
