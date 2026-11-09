/**
 * Order creation and order reads.
 *
 * This is the only place a draft becomes a commercial record, and the rules it
 * enforces are the product invariants:
 *
 * - **The customer confirms explicitly.** `customerConfirmed: true` is a
 *   required field. No draft, quote, transcript or model output substitutes
 *   for it (docs/SECURITY.md section 2).
 * - **The server re-prices.** The quote fixes what the customer saw; the order
 *   is priced from the menu snapshot at confirmation time. If the menu moved
 *   under the quote, or the recomputed total differs by a single paisa, the
 *   order is refused with `409` rather than charged at either price.
 * - **Payment is never verified here.** Cash is `dueAtCounter`, UPI is
 *   `pending`, and nothing in this service can write `verified`: only a
 *   verified provider callback or an authorized staff action may, and neither
 *   is implemented (no provider is selected).
 * - **Creation is idempotent.** Same `Idempotency-Key` and same payload
 *   replays the original order; same key with a different payload is `409`
 *   (docs/API.md conventions).
 *
 * Scope: the session supplies outlet and channel, never the request body, so a
 * session cannot order for another outlet (docs/SECURITY.md section 1).
 *
 * Not in this milestone: staff status transitions and the merchant queue
 * (`GET /api/v1/merchant/orders`, `PATCH .../status`). They need the staff
 * authentication mechanism, which docs/API.md records as undecided; an order
 * is created as `accepted` with a `statusHistory` ready for them.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  DEFAULT_LANGUAGE,
  MAX_IDEMPOTENCY_KEY_CHARS,
  PAYMENT_METHODS,
  type Channel,
  type CreateOrderRequest,
  type CreateOrderResponse,
  type OrderResponse,
  type PaymentMethod,
  type PaymentStatus,
} from '@vop/shared';
import { ApiError } from '../../middleware/errors.js';
import { addMinor, multiplyMinor } from '../../models/money.js';
import type { OrderDoc, OrderItemDoc } from '../../models/orders.js';
import { itemName } from '../menu/localize.js';
import type { MenuService } from '../menu/menuService.js';
import { assertSelection } from '../quote/pricing.js';
import type { QuoteStore } from '../quote/quoteStore.js';
import { hashSessionKey } from '../sessions/sessionKey.js';
import { assertOutletTimezone, outletDateKey } from './pickupToken.js';
import type { OrderStore } from './orderStore.js';

/** The authenticated session an order is created under. Never from a body. */
export interface OrderSessionScope {
  readonly sessionId: string;
  readonly sessionRef: string;
  readonly outletId: string;
  readonly channel: Channel;
}

export interface OrderService {
  createOrder(
    body: unknown,
    scope: OrderSessionScope,
    idempotencyKey: string,
  ): Promise<{ readonly order: CreateOrderResponse; readonly replayed: boolean }>;
  /** The order behind an order-read capability. `404` when either is wrong. */
  getOrder(orderId: string, accessToken: string): Promise<OrderResponse>;
}

export interface OrderServiceDeps {
  readonly menuService: MenuService;
  readonly quoteStore: QuoteStore;
  readonly orderStore: OrderStore;
  readonly now?: () => number;
}

/** Longest `orderId` accepted before it reaches a query: a UUID is 36 chars. */
const MAX_ORDER_ID_CHARS = 64;
/** Bound on the order-read capability before it is hashed and looked up. */
const MAX_ACCESS_TOKEN_CHARS = 128;

/** Printable, bounded, no whitespace: safe to store and to compare. */
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,128}$/;

export function validateIdempotencyKey(raw: unknown): string {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (key === '') {
    throw ApiError.validation('Idempotency-Key header is required to create an order');
  }
  if (key.length > MAX_IDEMPOTENCY_KEY_CHARS || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw ApiError.validation(
      `Idempotency-Key must be 1-${MAX_IDEMPOTENCY_KEY_CHARS} printable characters`,
    );
  }
  return key;
}

function validateBody(body: unknown): CreateOrderRequest {
  if (typeof body !== 'object' || body === null) {
    throw ApiError.validation('An order request object is required');
  }
  const raw = body as Record<string, unknown>;

  const outletId = typeof raw['outletId'] === 'string' ? raw['outletId'].trim() : '';
  if (outletId === '') throw ApiError.validation('outletId is required');

  const quoteId = typeof raw['quoteId'] === 'string' ? raw['quoteId'].trim() : '';
  if (quoteId === '' || quoteId.length > MAX_ORDER_ID_CHARS) {
    throw ApiError.validation('quoteId is required');
  }

  const paymentMethod = raw['paymentMethod'];
  if (
    typeof paymentMethod !== 'string' ||
    !PAYMENT_METHODS.includes(paymentMethod as PaymentMethod)
  ) {
    throw ApiError.validation(
      `paymentMethod must be one of ${PAYMENT_METHODS.join(', ')}`,
    );
  }

  // Explicit, literal, and not coerced: a truthy value is not a confirmation.
  if (raw['customerConfirmed'] !== true) {
    throw ApiError.validation('customerConfirmed must be true to create an order');
  }

  return {
    outletId,
    quoteId,
    paymentMethod: paymentMethod as PaymentMethod,
    customerConfirmed: true,
  };
}

/** Payment state at creation. Neither value asserts that money was received. */
function initialPaymentStatus(method: PaymentMethod): PaymentStatus {
  // Cash is owed at the counter; staff verification of receipt is a separate
  // authorized action and is not implemented in this milestone.
  return method === 'cashAtCounter' ? 'dueAtCounter' : 'pending';
}

/** The request fields that define the order, for the idempotency check. */
function fingerprint(request: CreateOrderRequest): string {
  return createHash('sha256')
    .update(JSON.stringify([request.quoteId, request.paymentMethod]))
    .digest('hex');
}

function toResponse(doc: OrderDoc): OrderResponse {
  return {
    orderId: doc.publicOrderId,
    token: doc.token,
    outletId: doc.outletId,
    channel: doc.channel,
    orderStatus: doc.orderStatus,
    paymentMethod: doc.paymentMethod,
    paymentStatus: doc.paymentStatus,
    checkoutLanguage: doc.checkoutLanguage ?? DEFAULT_LANGUAGE,
    items: doc.items.map((item) => ({
      menuItemId: item.menuItemId,
      nameAtOrder: item.nameAtOrder,
      // An order stored before this milestone has no localized snapshot, and
      // the English name is exactly what it was displayed as.
      displayNameAtOrder: item.displayNameAtOrder ?? item.nameAtOrder,
      quantity: item.quantity,
      optionIds: item.optionIds,
      unitPriceMinor: item.unitPriceMinor,
      lineTotalMinor: item.lineTotalMinor,
    })),
    subtotalMinor: doc.subtotalMinor,
    totalMinor: doc.totalMinor,
    currency: doc.currency,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function createOrderService(deps: OrderServiceDeps): OrderService {
  const now = deps.now ?? Date.now;

  return {
    async createOrder(body, scope, idempotencyKey) {
      const request = validateBody(body);
      if (request.outletId !== scope.outletId) {
        throw ApiError.forbidden('This session cannot order for that outlet');
      }

      const stored = deps.quoteStore.get(request.quoteId, scope.sessionId);
      const sessionKeyHash = hashSessionKey(scope.sessionId);
      const requestFingerprint = fingerprint(request);

      if (stored === undefined) {
        // The quote is gone, but a retry of an order that already exists must
        // still succeed, so the idempotency record is consulted first. A probe
        // with the same key cannot learn anything: a different payload is the
        // same 409 it would get with a live quote.
        const replay = await deps.orderStore.findByIdempotency(
          scope.outletId,
          sessionKeyHash,
          idempotencyKey,
        );
        if (replay !== undefined) return assertSameRequest(replay, requestFingerprint);
        // Nothing was stored for this key, so there is genuinely no quote.
        throw ApiError.conflict('Quote has expired or is not available. Re-confirm.');
      }

      const quote = stored.quote;
      const snapshot = await deps.menuService.getSnapshot(scope.outletId);
      if (snapshot.menuVersion !== quote.menuVersion) {
        throw ApiError.conflict('The menu changed since this quote. Re-confirm.');
      }

      // Re-priced from the live menu rather than trusted from the quote: an
      // unknown item is 422 and an unavailable one 409, exactly as on a quote.
      // The language the customer reviewed in. Taken from the quote, not from
      // this request: the confirming call must not be able to restate what the
      // customer saw.
      const checkoutLanguage = quote.language;

      const items: OrderItemDoc[] = quote.items.map((line) => {
        const { item, unitPriceMinor } = assertSelection(snapshot, {
          menuItemId: line.menuItemId,
          optionIds: line.optionIds,
        });
        return {
          menuItemId: item.publicId,
          nameAtOrder: item.name,
          displayNameAtOrder: itemName(item, checkoutLanguage),
          quantity: line.quantity,
          optionIds: line.optionIds,
          unitPriceMinor,
          lineTotalMinor: multiplyMinor(
            unitPriceMinor,
            line.quantity,
            `order line ${item.publicId}`,
          ),
        };
      });

      const subtotalMinor = items.reduce(
        (total, line) => addMinor(total, line.lineTotalMinor, 'subtotalMinor'),
        0,
      );
      if (subtotalMinor !== quote.totalMinor) {
        // The fingerprint matched but the money did not: refuse rather than
        // charge either figure.
        throw ApiError.conflict('Prices changed since this quote. Re-confirm.');
      }

      const timezone = assertOutletTimezone(snapshot.outlet);
      const createdAtMs = now();
      const token = await deps.orderStore.allocateToken(
        scope.outletId,
        outletDateKey(timezone, createdAtMs),
      );

      const accessToken = randomBytes(32).toString('base64url');
      const createdAt = new Date(createdAtMs);
      const publicOrderId = randomUUID();
      const doc: OrderDoc = {
        _id: publicOrderId,
        publicOrderId,
        outletId: scope.outletId,
        sessionKeyHash,
        sessionRef: scope.sessionRef,
        channel: scope.channel,
        token: String(token),
        tokenDateKey: outletDateKey(timezone, createdAtMs),
        accessTokenHash: hashSessionKey(accessToken),
        items,
        subtotalMinor,
        // No tax or service-charge rule is configured (docs/PRD.md section 9).
        totalMinor: subtotalMinor,
        currency: snapshot.outlet.currency,
        paymentMethod: request.paymentMethod,
        paymentStatus: initialPaymentStatus(request.paymentMethod),
        orderStatus: 'accepted',
        idempotencyKey,
        requestFingerprint,
        quoteId: request.quoteId,
        menuVersion: snapshot.menuVersion,
        checkoutLanguage,
        createdAt,
        updatedAt: createdAt,
        statusHistory: [{ status: 'accepted', actorKind: 'customer', at: createdAt }],
      };

      const result = await deps.orderStore.insert(doc);
      if (result.replayed) return assertSameRequest(result.doc, requestFingerprint);

      // The capability is returned exactly once; only its hash is stored.
      return {
        order: { ...toResponse(result.doc), orderAccessToken: accessToken },
        replayed: false,
      };
    },

    async getOrder(orderId, accessToken) {
      const id = typeof orderId === 'string' ? orderId.trim() : '';
      const token = typeof accessToken === 'string' ? accessToken.trim() : '';
      // A malformed ID or capability is reported as absent, so neither the ID
      // format nor the existence of an order is disclosed.
      if (
        id === '' ||
        id.length > MAX_ORDER_ID_CHARS ||
        token === '' ||
        token.length > MAX_ACCESS_TOKEN_CHARS
      ) {
        throw ApiError.notFound('Order not found');
      }

      const doc = await deps.orderStore.findByAccessHash(id, hashSessionKey(token));
      if (doc === undefined) throw ApiError.notFound('Order not found');
      return toResponse(doc);
    },
  };
}

/**
 * A replay is only a replay when the payload matches; a reused key with a
 * different body is the caller's bug (docs/API.md conventions).
 *
 * The stored order is returned without the access capability: only its hash
 * was kept, so a replay cannot reissue it.
 */
function assertSameRequest(
  doc: OrderDoc,
  requestFingerprint: string,
): { readonly order: CreateOrderResponse; readonly replayed: true } {
  if (doc.requestFingerprint !== requestFingerprint) {
    throw ApiError.conflict(
      'This Idempotency-Key was already used for a different order',
    );
  }
  return { order: toResponse(doc), replayed: true };
}
