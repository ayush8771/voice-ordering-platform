import {
  API_BASE_PATH,
  type AddCartItemRequest,
  type ApiErrorBody,
  type CartResponse,
  type Channel,
  type ConversationTurnRequest,
  type ConversationTurnResponse,
  type CreateOrderRequest,
  type CreateOrderResponse,
  type CreateOrderingSessionResponse,
  type HealthResponse,
  type MenuResponse,
  type OrderResponse,
  type QuoteResponse,
  type UpdateCartItemRequest,
} from '@vop/shared';

/**
 * Typed API client. UI components call these functions and never talk to the
 * network, a database or a provider SDK directly (docs/ARCHITECTURE.md
 * section 5).
 *
 * Every price, total, availability flag and pickup token here comes from the
 * server and is displayed verbatim: nothing in the client computes, adjusts or
 * guesses one (docs/PRD.md invariants).
 */

/** An API failure carrying the server's safe message and correlation ID. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = (value as { error?: unknown }).error;
  return typeof candidate === 'object' && candidate !== null && 'code' in candidate;
}

/**
 * The ordering-session ID is an unguessable bearer capability: it is never put
 * in a URL, a QR code or a log (docs/SECURITY.md sections 1 and 5).
 *
 * It is held in module state and mirrored into `sessionStorage` so a reload
 * does not silently abandon the customer's draft. `sessionStorage` is per-tab
 * and cleared when the tab closes, which is also what keeps a shared kiosk
 * browser safe between customers.
 *
 * shortcut: a kiosk left idle keeps the token until the tab closes or the
 * server session expires; add an explicit idle reset when kiosk attendance
 * behaviour is decided.
 */
const SESSION_STORAGE_KEY = 'vop.orderingSessionId';
const ORDER_STORAGE_KEY = 'vop.orderAccess';

function readStored(key: string): string | undefined {
  try {
    return window.sessionStorage.getItem(key) ?? undefined;
  } catch {
    // Storage can be blocked; the in-memory value still works for this view.
    return undefined;
  }
}

function writeStored(key: string, value: string | undefined): void {
  try {
    if (value === undefined) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    /* a blocked store must not break ordering */
  }
}

let sessionId: string | undefined = readStored(SESSION_STORAGE_KEY);

export function getSessionId(): string | undefined {
  return sessionId;
}

function setSessionId(value: string | undefined): void {
  sessionId = value;
  writeStored(SESSION_STORAGE_KEY, value);
}

/** Forgets the session locally, after the server reports it is gone. */
export function clearSessionId(): void {
  setSessionId(undefined);
}

/**
 * The order read capability, issued once at creation and still valid after the
 * ordering session has expired - which is exactly when the customer is still
 * waiting for food. Stored with its order ID so a reload keeps tracking.
 */
export interface OrderAccess {
  readonly orderId: string;
  readonly token: string;
}

export function getStoredOrderAccess(): OrderAccess | undefined {
  const raw = readStored(ORDER_STORAGE_KEY);
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { orderId, token } = parsed as Partial<OrderAccess>;
    if (typeof orderId !== 'string' || typeof token !== 'string') return undefined;
    return { orderId, token };
  } catch {
    return undefined;
  }
}

function storeOrderAccess(access: OrderAccess | undefined): void {
  writeStored(
    ORDER_STORAGE_KEY,
    access === undefined ? undefined : JSON.stringify(access),
  );
}

export function clearStoredOrderAccess(): void {
  storeOrderAccess(undefined);
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  /** Omit to send the ordering session; set to send this bearer instead. */
  readonly bearer?: string;
  /** Send no Authorization header at all (session creation, menu, health). */
  readonly anonymous?: boolean;
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.extraHeaders,
  };

  const token = options.bearer ?? (options.anonymous === true ? undefined : sessionId);
  if (token !== undefined) headers['Authorization'] = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;

  try {
    response = await fetch(`${API_BASE_PATH}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    // Network/offline failure: the request never reached the server, so no
    // action can be assumed to have been saved.
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Could not reach the server.');
  }

  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    if (isApiErrorBody(body)) {
      throw new ApiRequestError(
        response.status,
        body.error.code,
        body.error.message,
        body.error.requestId,
      );
    }
    throw new ApiRequestError(
      response.status,
      'INTERNAL_ERROR',
      'The server returned an unexpected response.',
    );
  }

  return body as T;
}

/** Infrastructure probe used to verify client/server communication. */
export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health', { anonymous: true });
}

// --- Session -------------------------------------------------------------

/**
 * Starts an ordering session and keeps its ID for later calls. Outlet and
 * channel are the only inputs; everything else is decided server-side.
 */
export async function createOrderingSession(
  outletId: string,
  channel: Channel,
): Promise<CreateOrderingSessionResponse> {
  const session = await apiFetch<CreateOrderingSessionResponse>('/ordering-sessions', {
    method: 'POST',
    body: { outletId, channel },
    anonymous: true,
  });
  setSessionId(session.sessionId);
  return session;
}

/** Ends the session and its draft. The local token is dropped either way. */
export async function endOrderingSession(): Promise<void> {
  try {
    if (sessionId !== undefined) {
      await apiFetch<unknown>('/ordering-sessions', { method: 'DELETE' });
    }
  } finally {
    clearSessionId();
  }
}

// --- Menu ----------------------------------------------------------------

/** The public menu. Needs no session, so it loads before one is started. */
export function getMenu(outletId: string): Promise<MenuResponse> {
  return apiFetch<MenuResponse>(`/outlets/${encodeURIComponent(outletId)}/menu`, {
    anonymous: true,
  });
}

// --- Cart draft ----------------------------------------------------------

/**
 * `expectedRevision` is sent as `If-Match` on a change aimed at a line the
 * customer has actually seen. If the voice path moved the draft in between,
 * the server answers `409` and the client re-reads instead of overwriting the
 * other surface's edit (docs/UX_FLOWS.md flow 2).
 */
function ifMatch(expectedRevision?: number): Readonly<Record<string, string>> {
  return expectedRevision === undefined ? {} : { 'If-Match': String(expectedRevision) };
}

export function getCart(): Promise<CartResponse> {
  return apiFetch<CartResponse>('/cart');
}

export function addCartItem(item: AddCartItemRequest): Promise<CartResponse> {
  return apiFetch<CartResponse>('/cart/items', { method: 'POST', body: item });
}

export function updateCartItem(
  lineId: string,
  update: UpdateCartItemRequest,
  expectedRevision?: number,
): Promise<CartResponse> {
  return apiFetch<CartResponse>(`/cart/items/${encodeURIComponent(lineId)}`, {
    method: 'PATCH',
    body: update,
    extraHeaders: ifMatch(expectedRevision),
  });
}

export function removeCartItem(
  lineId: string,
  expectedRevision?: number,
): Promise<CartResponse> {
  return apiFetch<CartResponse>(`/cart/items/${encodeURIComponent(lineId)}`, {
    method: 'DELETE',
    extraHeaders: ifMatch(expectedRevision),
  });
}

export function clearCart(): Promise<CartResponse> {
  return apiFetch<CartResponse>('/cart', { method: 'DELETE' });
}

/** Quotes the session's own stored draft, for the review step. */
export function quoteCart(): Promise<QuoteResponse> {
  return apiFetch<QuoteResponse>('/cart/quote', { method: 'POST' });
}

// --- Conversation --------------------------------------------------------

/**
 * One customer utterance (typed, or a transcript from the STT adapter). The
 * response carries the authoritative draft and can never confirm an order.
 *
 * A `503` means the assistant is unavailable and the touch path must carry the
 * customer (docs/PRD.md section 5): callers treat it as a fallback signal, not
 * as a failure of the order.
 */
export function sendConversationTurn(
  turn: ConversationTurnRequest,
): Promise<ConversationTurnResponse> {
  return apiFetch<ConversationTurnResponse>('/conversation/turns', {
    method: 'POST',
    body: turn,
  });
}

// --- Orders --------------------------------------------------------------

/**
 * Creates the order. `customerConfirmed: true` is literal and only ever sent
 * from an explicit press of "Confirm order" (docs/SECURITY.md section 2).
 *
 * `idempotencyKey` is generated once per confirmation attempt and reused on
 * every retry of that attempt, so a retry cannot create a second order. The
 * access token, returned exactly once, is stored for tracking.
 */
export async function createOrder(
  request: Omit<CreateOrderRequest, 'customerConfirmed'>,
  idempotencyKey: string,
): Promise<CreateOrderResponse> {
  const order = await apiFetch<CreateOrderResponse>('/orders', {
    method: 'POST',
    body: { ...request, customerConfirmed: true },
    extraHeaders: { 'Idempotency-Key': idempotencyKey },
  });

  if (order.orderAccessToken !== undefined) {
    storeOrderAccess({ orderId: order.orderId, token: order.orderAccessToken });
  }
  return order;
}

/**
 * Tracks one order with its own read capability rather than the ordering
 * session, which expires while the customer may still be waiting.
 */
export function getOrder(access: OrderAccess): Promise<OrderResponse> {
  return apiFetch<OrderResponse>(`/orders/${encodeURIComponent(access.orderId)}`, {
    bearer: access.token,
  });
}
