/**
 * Ending an ordering session, draft included.
 *
 * A draft is deleted when its session ends (docs/DATABASE.md section 2), but
 * neither service may own that rule: the session service must not know what a
 * cart is, and the cart store must not know when a capability is revoked. So
 * the cleanup lives here, in an application-level workflow that depends on
 * both and is depended on by neither.
 *
 * Order matters. The draft is keyed by a hash of the session ID, and that ID
 * exists only inside the customer's bearer token - once the session record is
 * gone, nothing can name the draft again. The draft is therefore deleted
 * first; deleting the session first would leave an orphan that only the TTL
 * index could collect.
 *
 * Retries: both deletes are idempotent, so a transient store failure is safe
 * to repeat. If the draft still cannot be deleted, the session is ended
 * anyway - revoking the capability is the part a customer asked for, and the
 * draft left behind is already unreadable (every read is filtered by session
 * and outlet) and expires on its own deadline. The result says plainly whether
 * the draft was deleted, so a caller never has to assume it was.
 *
 * A session that cannot be ended is a failure the caller must see: the
 * capability is still live, so the error is rethrown and the request is
 * retryable (docs/ARCHITECTURE.md section 6).
 */

import type { CartStore } from '../services/cart/cartStore.js';
import type { OrderingSessionService } from '../services/sessions/orderingSessionService.js';

export interface EndOrderingSessionDeps {
  readonly sessions: OrderingSessionService;
  readonly cartStore: CartStore;
  /** Total attempts per delete, including the first. */
  readonly attempts?: number;
}

export interface EndOrderingSessionResult {
  /** False only when every attempt to delete the draft failed. */
  readonly draftDeleted: boolean;
}

/** Three attempts: enough for a failover, few enough to keep a request short. */
export const DEFAULT_END_SESSION_ATTEMPTS = 3;

async function retry(task: () => Promise<void>, attempts: number): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await task();
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
    }
  }
}

export async function endOrderingSession(
  deps: EndOrderingSessionDeps,
  sessionId: string,
): Promise<EndOrderingSessionResult> {
  const attempts = deps.attempts ?? DEFAULT_END_SESSION_ATTEMPTS;

  let draftDeleted = true;
  try {
    await retry(() => deps.cartStore.delete(sessionId), attempts);
  } catch {
    // Reported, not thrown: the session must still be revoked.
    draftDeleted = false;
  }

  await retry(() => deps.sessions.end(sessionId), attempts);

  return { draftDeleted };
}
