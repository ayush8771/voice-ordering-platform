import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  addCartItem,
  clearSessionId,
  createOrder,
  createOrderingSession,
  getCart,
  getMenu,
  getOrder,
  removeCartItem,
  updateCartItem,
} from './client';

/**
 * The client is the only place the browser talks to the API, so these tests
 * cover exactly what the server authorizes or de-duplicates on: the session
 * bearer, the draft revision in `If-Match`, the idempotency key, the literal
 * confirmation flag, and the separate order read capability.
 *
 * `fetch` is replaced throughout: no test here reaches a server or a provider.
 */

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

let calls: Call[];

function headerOf(call: Call, name: string): string | undefined {
  const headers = call.init.headers as Record<string, string> | undefined;
  return headers?.[name];
}

function respond(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

beforeEach(() => {
  calls = [];
  clearSessionId();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(responder: (call: Call) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const call = { url, init };
      calls.push(call);
      return Promise.resolve(responder(call));
    }),
  );
}

describe('session transport', () => {
  it('sends no Authorization header for public reads', async () => {
    stubFetch(() => respond({ outlet: {}, items: [], categories: [] }));

    await getMenu('demo-outlet');

    expect(calls[0]?.url).toBe('/api/v1/outlets/demo-outlet/menu');
    expect(headerOf(calls[0]!, 'Authorization')).toBeUndefined();
  });

  it('sends the created session as a bearer token on later calls', async () => {
    stubFetch((call) =>
      call.url.endsWith('/ordering-sessions')
        ? respond({ sessionId: 'sess-secret', outletId: 'demo-outlet', channel: 'qr' })
        : respond({ items: [] }),
    );

    await createOrderingSession('demo-outlet', 'qr');
    await getCart();

    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      outletId: 'demo-outlet',
      channel: 'qr',
    });
    expect(headerOf(calls[0]!, 'Authorization')).toBeUndefined();
    expect(headerOf(calls[1]!, 'Authorization')).toBe('Bearer sess-secret');
  });

  it('surfaces the server error envelope, including the request ID', async () => {
    stubFetch(() =>
      respond(
        {
          error: {
            code: 'CONFLICT',
            message: 'The draft has changed',
            requestId: 'req-1',
          },
        },
        409,
      ),
    );

    const error = await addCartItem({ menuItemId: 'a', quantity: 1 }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe('CONFLICT');
    expect((error as ApiRequestError).status).toBe(409);
    expect((error as ApiRequestError).requestId).toBe('req-1');
    expect((error as ApiRequestError).details).toBeUndefined();
  });

  it('keeps the envelope details, and drops a non-array value', async () => {
    let details: unknown = [{ revision: 4 }];
    stubFetch(() =>
      respond(
        { error: { code: 'CONFLICT', message: 'x', requestId: 'r', details } },
        409,
      ),
    );
    const first = await getCart().catch((caught: unknown) => caught);
    expect((first as ApiRequestError).details).toEqual([{ revision: 4 }]);

    details = { revision: 4 };
    const second = await getCart().catch((caught: unknown) => caught);
    expect((second as ApiRequestError).details).toBeUndefined();
  });

  it('reports an unreachable server without claiming the call was applied', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );

    const error = await getCart().catch((caught: unknown) => caught);

    expect((error as ApiRequestError).code).toBe('NETWORK_ERROR');
    expect((error as ApiRequestError).status).toBe(0);
  });
});

describe('draft mutations', () => {
  it('sends the seen revision as If-Match, and omits it when not given', async () => {
    stubFetch(() => respond({ items: [] }));

    await updateCartItem('line-1', { quantity: 2 }, 7);
    await removeCartItem('line-1');

    expect(calls[0]?.init.method).toBe('PATCH');
    expect(headerOf(calls[0]!, 'If-Match')).toBe('7');
    expect(calls[1]?.init.method).toBe('DELETE');
    expect(headerOf(calls[1]!, 'If-Match')).toBeUndefined();
  });

  it('escapes a line ID rather than pasting it into the path', async () => {
    stubFetch(() => respond({ items: [] }));

    await removeCartItem('a/b?c');

    expect(calls[0]?.url).toBe('/api/v1/cart/items/a%2Fb%3Fc');
  });
});

describe('order creation and tracking', () => {
  it('sends the idempotency key and a literal confirmation flag', async () => {
    stubFetch(() =>
      respond({ orderId: 'ord-1', token: '4', orderAccessToken: 'order-secret' }),
    );

    await createOrder(
      { outletId: 'demo-outlet', quoteId: 'quote-1', paymentMethod: 'cashAtCounter' },
      'key-1',
    );

    expect(headerOf(calls[0]!, 'Idempotency-Key')).toBe('key-1');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      outletId: 'demo-outlet',
      quoteId: 'quote-1',
      paymentMethod: 'cashAtCounter',
      customerConfirmed: true,
    });
  });

  it('tracks an order with the order token, not the ordering session', async () => {
    stubFetch((call) =>
      call.url.endsWith('/ordering-sessions')
        ? respond({ sessionId: 'sess-secret' })
        : respond({ orderId: 'ord-1', orderStatus: 'accepted' }),
    );

    await createOrderingSession('demo-outlet', 'qr');
    await getOrder({ orderId: 'ord-1', token: 'order-secret' });

    expect(calls[1]?.url).toBe('/api/v1/orders/ord-1');
    expect(headerOf(calls[1]!, 'Authorization')).toBe('Bearer order-secret');
  });
});
