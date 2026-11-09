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
export type Step = 'ordering' | 'review' | 'tracking';

export interface OrderingState {
  readonly step: Step;
  readonly menu: MenuResponse | undefined;
  readonly cart: CartResponse | undefined;
  readonly quote: QuoteResponse | undefined;
  readonly order: OrderResponse | undefined;
  readonly language: Language;
  /** Set when the server said the assistant is unavailable for this session. */
  readonly assistantUnavailable: boolean;
  readonly lastAssistantText: string | undefined;
  /** A customer-safe message about the last failure, if any. */
  readonly error: string | undefined;
  /** True while the session itself must be restarted before anything works. */
  readonly sessionLost: boolean;
  readonly busy: boolean;
  readonly startupFailed: boolean;
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

function messageOf(error: unknown): string {
  return error instanceof ApiRequestError
    ? error.message
    : 'Something went wrong. Please try again or ask at the counter.';
}

export function useOrdering(outletId: string, channel: Channel) {
  const [state, setState] = useState<OrderingState>({
    step: 'ordering',
    menu: undefined,
    cart: undefined,
    quote: undefined,
    order: undefined,
    language: 'en',
    assistantUnavailable: false,
    lastAssistantText: undefined,
    error: undefined,
    sessionLost: false,
    busy: true,
    startupFailed: false,
  });

  /**
   * One key per confirmation attempt, reused by every retry of that attempt so
   * a retry cannot create a second order (docs/UX_FLOWS.md flow 3).
   */
  const idempotencyKey = useRef<string | undefined>(undefined);

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
          patch({ sessionLost: true, busy: false, error: error.message });
          return;
        }
        if (error instanceof ApiRequestError && error.code === 'CONFLICT') {
          const cart = await api.getCart().catch(() => undefined);
          patch({
            ...(cart === undefined ? {} : { cart }),
            busy: false,
            error: 'Your order changed while you were editing. Please check it below.',
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
        step: 'ordering',
        sessionLost: false,
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
    idempotencyKey.current = crypto.randomUUID();
    return run(
      () => api.quoteCart(),
      (quote) => ({ quote, step: 'review' as Step }),
    );
  }, [run]);

  const backToOrdering = useCallback(() => {
    patch({ step: 'ordering', quote: undefined, error: undefined });
  }, [patch]);

  const confirm = useCallback(
    (paymentMethod: PaymentMethod) => {
      const quote = state.quote;
      if (quote === undefined) {
        patch({ error: 'Please review your order again before confirming.' });
        return Promise.resolve();
      }
      const key = idempotencyKey.current ?? crypto.randomUUID();
      idempotencyKey.current = key;

      return run(
        () => api.createOrder({ outletId, quoteId: quote.quoteId, paymentMethod }, key),
        (order) => ({ order, step: 'tracking' as Step, quote: undefined }),
      );
    },
    [outletId, patch, run, state.quote],
  );

  // --- Tracking ------------------------------------------------------------

  const refreshOrder = useCallback(async (): Promise<void> => {
    const access = api.getStoredOrderAccess();
    if (access === undefined) return;
    try {
      patch({ order: await api.getOrder(access) });
    } catch (error) {
      patch({ error: messageOf(error) });
    }
  }, [patch]);

  useEffect(() => {
    const status = state.order?.orderStatus;
    if (status === undefined || FINAL_STATUSES.includes(status)) return;
    const timer = window.setInterval(() => void refreshOrder(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refreshOrder, state.order?.orderStatus]);

  /** Ends the session and starts a clean one, for the next customer. */
  const finish = useCallback(async (): Promise<void> => {
    api.clearStoredOrderAccess();
    await api.endOrderingSession().catch(() => undefined);
    await start();
  }, [start]);

  // --- Conversation --------------------------------------------------------

  const setLanguage = useCallback((language: Language) => patch({ language }), [patch]);

  /**
   * Sends one utterance. The reply is text; the draft shown afterwards is the
   * server's, never the assistant's account of it. A `503` switches the
   * surface to touch-only and loses nothing from the draft.
   */
  const sendUtterance = useCallback(
    async (text: string, declinedRecommendation = false): Promise<void> => {
      const phase: ConversationPhase =
        state.step === 'review'
          ? 'review'
          : (state.cart?.items.length ?? 0) === 0
            ? 'browsing'
            : 'building';

      patch({ busy: true, error: undefined });
      try {
        const turn: ConversationTurnResponse = await api.sendConversationTurn({
          language: state.language,
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
    [patch, state.cart?.items.length, state.language, state.step],
  );

  return {
    state,
    start,
    addItem,
    setQuantity,
    removeLine,
    clearDraft,
    openReview,
    backToOrdering,
    confirm,
    refreshOrder,
    finish,
    setLanguage,
    sendUtterance,
  };
}
