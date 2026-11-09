/**
 * The session-teardown workflow.
 *
 * What matters here is order and failure behaviour, so the two dependencies
 * are recorded doubles rather than real stores: the point is that the draft is
 * deleted before the session, that a transient failure is retried, and that a
 * draft that cannot be deleted never stops the capability being revoked.
 */

import { describe, expect, it } from 'vitest';
import { ApiError } from '../middleware/errors.js';
import { createCartStore } from '../services/cart/cartStore.js';
import { createOrderingSessionService } from '../services/sessions/orderingSessionService.js';
import type { CartStore } from '../services/cart/cartStore.js';
import type { OrderingSessionService } from '../services/sessions/orderingSessionService.js';
import { endOrderingSession } from './endOrderingSession.js';

/** Records the order of calls and can be told to fail a number of times. */
function doubles(options: { readonly draftFailures?: number } = {}): {
  readonly calls: string[];
  readonly cartStore: CartStore;
  readonly sessions: OrderingSessionService;
} {
  const calls: string[] = [];
  const real = createCartStore();
  let draftFailures = options.draftFailures ?? 0;

  const cartStore: CartStore = {
    ...real,
    async delete(sessionId) {
      calls.push('cart.delete');
      if (draftFailures > 0) {
        draftFailures -= 1;
        throw ApiError.unavailable('Draft storage is temporarily unavailable.');
      }
      await real.delete(sessionId);
    },
  };

  const realSessions = createOrderingSessionService();
  const sessions: OrderingSessionService = {
    ...realSessions,
    async end(sessionId) {
      calls.push('session.end');
      await realSessions.end(sessionId);
    },
  };

  return { calls, cartStore, sessions };
}

describe('endOrderingSession', () => {
  it('deletes the draft before ending the session', async () => {
    const { calls, cartStore, sessions } = doubles();

    const result = await endOrderingSession({ sessions, cartStore }, 'session-a');

    // Order is the point: once the session is gone, nothing can name the
    // draft again, so an orphan would be left behind.
    expect(calls).toEqual(['cart.delete', 'session.end']);
    expect(result.draftDeleted).toBe(true);
  });

  it('actually removes the draft and the session', async () => {
    const cartStore = createCartStore();
    const sessions = createOrderingSessionService();
    const created = await sessions.create('demo-outlet', 'qr');
    const scope = {
      sessionId: created.sessionId,
      outletId: 'demo-outlet',
      expiresAtMs: Date.parse(created.expiresAt),
    };
    await cartStore.save(
      {
        ...cartStore.create(scope.sessionId, scope.outletId, scope.expiresAtMs),
        revision: 1,
        lines: [
          {
            lineId: 'line-1',
            menuItemId: 'item-idli',
            optionIds: [],
            quantity: 1,
            nameSnapshot: 'Idli',
          },
        ],
      },
      scope.expiresAtMs,
    );

    await endOrderingSession({ sessions, cartStore }, created.sessionId);

    expect(await cartStore.get(scope.sessionId, scope.outletId)).toBeUndefined();
    expect(await sessions.find(created.sessionId)).toBeUndefined();
    expect(await cartStore.size()).toBe(0);
  });

  it('retries a transient draft-delete failure', async () => {
    const { calls, cartStore, sessions } = doubles({ draftFailures: 2 });

    const result = await endOrderingSession({ sessions, cartStore }, 'session-a');

    expect(calls).toEqual([
      'cart.delete',
      'cart.delete',
      'cart.delete',
      'session.end',
    ]);
    expect(result.draftDeleted).toBe(true);
  });

  it('still ends the session when the draft cannot be deleted', async () => {
    const { calls, cartStore, sessions } = doubles({ draftFailures: 99 });

    const result = await endOrderingSession({ sessions, cartStore }, 'session-a');

    // Revoking the capability is what the customer asked for; the draft left
    // behind is unreadable without it and expires on its own deadline.
    expect(result.draftDeleted).toBe(false);
    expect(calls.filter((call) => call === 'cart.delete')).toHaveLength(3);
    expect(calls.at(-1)).toBe('session.end');
  });

  it('rethrows when the session itself cannot be ended', async () => {
    const cartStore = createCartStore();
    let attempts = 0;
    const sessions: OrderingSessionService = {
      ...createOrderingSessionService(),
      async end() {
        attempts += 1;
        await Promise.resolve();
        throw ApiError.unavailable('Ordering is temporarily unavailable.');
      },
    };

    // The capability is still live, so the caller must see a retryable failure
    // rather than a success.
    await expect(
      endOrderingSession({ sessions, cartStore }, 'session-a'),
    ).rejects.toMatchObject({ status: 503 });
    expect(attempts).toBe(3);
  });

  it('honours a caller-supplied attempt count', async () => {
    const { calls, cartStore, sessions } = doubles({ draftFailures: 99 });

    const result = await endOrderingSession(
      { sessions, cartStore, attempts: 1 },
      'session-a',
    );

    expect(result.draftDeleted).toBe(false);
    expect(calls).toEqual(['cart.delete', 'session.end']);
  });
});
