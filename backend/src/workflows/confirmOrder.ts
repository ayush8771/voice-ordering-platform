/**
 * Confirming an order and discarding the draft it came from.
 *
 * Same division of labour as `endOrderingSession.ts`: the order service must
 * not know what a cart is, and the cart store must not know that an order
 * exists, so "no draft is retained after order creation"
 * (docs/DATABASE.md section 2) lives here.
 *
 * Order matters and so does failure handling. The order is created first,
 * because it is the commercial record; the draft is deleted afterwards and a
 * failure to delete it never fails the request - the customer's order exists,
 * and the draft is already unreadable once it expires. The result says whether
 * the draft was cleared so a caller never has to assume it.
 *
 * The session itself is kept: a customer may order again in the same sitting
 * (docs/DATABASE.md section 4, "a session can create zero or more orders"), so
 * the next `GET /api/v1/cart` simply returns a fresh empty draft.
 *
 * A replay deletes the draft again, which is a no-op: both the order insert
 * and the draft delete are idempotent.
 */

import type { CreateOrderResponse } from '@vop/shared';
import type { CartStore } from '../services/cart/cartStore.js';
import type {
  OrderService,
  OrderSessionScope,
} from '../services/orders/orderService.js';

export interface ConfirmOrderDeps {
  readonly orderService: OrderService;
  readonly cartStore: CartStore;
  /** Total attempts for the draft delete, including the first. */
  readonly attempts?: number;
}

export interface ConfirmOrderResult {
  readonly order: CreateOrderResponse;
  /** True for a brand-new order, false for an idempotent replay. */
  readonly created: boolean;
  /** False only when every attempt to delete the draft failed. */
  readonly draftCleared: boolean;
}

/** Three attempts: enough for a failover, few enough to keep a request short. */
export const DEFAULT_CONFIRM_ATTEMPTS = 3;

export async function confirmOrder(
  deps: ConfirmOrderDeps,
  input: {
    readonly body: unknown;
    readonly scope: OrderSessionScope;
    readonly idempotencyKey: string;
  },
): Promise<ConfirmOrderResult> {
  const attempts = deps.attempts ?? DEFAULT_CONFIRM_ATTEMPTS;
  const { order, replayed } = await deps.orderService.createOrder(
    input.body,
    input.scope,
    input.idempotencyKey,
  );

  let draftCleared = false;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await deps.cartStore.delete(input.scope.sessionId);
      draftCleared = true;
      break;
    } catch {
      // Deliberately swallowed: the order is already created, and reporting a
      // failure here would invite a retry that cannot change the outcome.
    }
  }

  return { order, created: !replayed, draftCleared };
}
