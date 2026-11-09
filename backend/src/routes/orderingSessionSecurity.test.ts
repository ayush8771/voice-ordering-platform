/**
 * Security properties of the ordering-session bearer token.
 *
 * NEEDS JOINT AGREEMENT (provisionally approved): session transport is
 * `Authorization: Bearer <sessionId>` (docs/API.md). These tests are the
 * conditions that approval was made subject to - token entropy, outlet
 * isolation, absolute and idle expiry, and the token never reaching a log or a
 * response body.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import {
  createInMemoryMenuRepository,
  SAMPLE_MENU,
} from '../services/menu/inMemoryMenuRepository.js';
import { createMenuService } from '../services/menu/menuService.js';
import { createQuoteService } from '../services/quote/quoteService.js';
import { createQuoteStore } from '../services/quote/quoteStore.js';
import {
  createOrderingSessionService,
  deriveSessionRef,
  SESSION_IDLE_TTL_MS,
  SESSION_TTL_MS,
  type OrderingSessionService,
} from '../services/sessions/orderingSessionService.js';
import type { QuoteService } from '../services/quote/quoteService.js';

function build(
  overrides: {
    readonly orderingSessions?: OrderingSessionService;
    readonly quoteService?: QuoteService;
  } = {},
) {
  const menuService = createMenuService(createInMemoryMenuRepository(SAMPLE_MENU));
  const orderingSessions = overrides.orderingSessions ?? createOrderingSessionService();
  const quoteService =
    overrides.quoteService ??
    createQuoteService({ menuService, quoteStore: createQuoteStore() });

  return {
    app: createApp(loadConfig({ NODE_ENV: 'test' }), {
      menuService,
      quoteService,
      orderingSessions,
    }),
    orderingSessions,
  };
}

async function mint(
  app: ReturnType<typeof build>['app'],
  outletId = 'demo-outlet',
): Promise<string> {
  const response = await request(app)
    .post('/api/v1/ordering-sessions')
    .send({ outletId, channel: 'qr' });
  expect(response.status).toBe(201);
  return response.body.sessionId as string;
}

const DRAFT = {
  outletId: 'demo-outlet',
  items: [{ menuItemId: 'item-idli', quantity: 1 }],
} as const;

describe('session token entropy', () => {
  it('issues 256 bits of CSPRNG output in a URL-safe encoding', async () => {
    const sessions = createOrderingSessionService();
    const { sessionId } = await sessions.create('demo-outlet', 'qr');

    // 32 bytes base64url, unpadded.
    expect(sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(sessionId, 'base64url')).toHaveLength(32);
  });

  it('never repeats a token', async () => {
    const sessions = createOrderingSessionService();
    const issued = new Set<string>();

    for (let index = 0; index < 2000; index += 1) {
      issued.add((await sessions.create('demo-outlet', 'qr')).sessionId);
    }

    expect(issued.size).toBe(2000);
  });

  it('derives a log reference that does not reveal the token', async () => {
    const sessions = createOrderingSessionService();
    const { sessionId } = await sessions.create('demo-outlet', 'qr');
    const ref = deriveSessionRef(sessionId);

    expect(ref).toMatch(/^[0-9a-f]{12}$/);
    expect(sessionId).not.toContain(ref);
    expect(ref).not.toContain(sessionId.slice(0, 8));
    // Same input, same reference - so logs can be correlated without the token.
    expect(deriveSessionRef(sessionId)).toBe(ref);
  });

  it('keeps the token out of the create response beyond the token itself', async () => {
    const { app } = build();
    const response = await request(app)
      .post('/api/v1/ordering-sessions')
      .send({ outletId: 'demo-outlet', channel: 'kiosk' });

    expect(Object.keys(response.body).sort()).toEqual([
      'channel',
      'expiresAt',
      'outletId',
      'sessionId',
    ]);
    // No internal reference or absolute timestamps leak to the client.
    expect(response.body).not.toHaveProperty('sessionRef');
    expect(response.body).not.toHaveProperty('createdAtMs');
  });
});

describe('outlet isolation', () => {
  it('refuses a quote for an outlet the session was not minted for', async () => {
    const { app } = build();
    const sessionId = await mint(app, 'demo-outlet');

    const response = await request(app)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${sessionId}`)
      .send({
        outletId: 'other-outlet',
        items: [{ menuItemId: 'item-poha', quantity: 1 }],
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('refuses an item that belongs to another outlet, even under its own outletId', async () => {
    const { app } = build();
    const sessionId = await mint(app, 'demo-outlet');

    // `item-poha` exists, but only for `other-outlet`. Scoped by session, so it
    // must be unknown here rather than priced.
    const response = await request(app)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${sessionId}`)
      .send({
        outletId: 'demo-outlet',
        items: [{ menuItemId: 'item-poha', quantity: 1 }],
      });

    expect(response.status).toBe(422);
  });

  it('cannot be re-pointed at another outlet by a second session for it', async () => {
    const { app } = build();
    const demo = await mint(app, 'demo-outlet');
    const other = await mint(app, 'other-outlet');

    // Each token works only for its own outlet.
    expect(
      (
        await request(app)
          .post('/api/v1/quotes')
          .set('Authorization', `Bearer ${other}`)
          .send({
            outletId: 'other-outlet',
            items: [{ menuItemId: 'item-poha', quantity: 1 }],
          })
      ).status,
    ).toBe(200);

    expect(
      (
        await request(app)
          .post('/api/v1/quotes')
          .set('Authorization', `Bearer ${demo}`)
          .send({
            outletId: 'other-outlet',
            items: [{ menuItemId: 'item-poha', quantity: 1 }],
          })
      ).status,
    ).toBe(403);
  });

  it('reports a malformed outlet ID on session creation as not found', async () => {
    const { app } = build();

    for (const outletId of ['not valid', 'a'.repeat(65), '{"$ne":null}']) {
      const response = await request(app)
        .post('/api/v1/ordering-sessions')
        .send({ outletId, channel: 'qr' });

      expect(response.status, outletId).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('session expiry', () => {
  it('stops working at the absolute deadline however active the customer was', async () => {
    let clock = 1_000_000;
    const sessions = createOrderingSessionService({ now: () => clock });
    const { sessionId } = await sessions.create('demo-outlet', 'kiosk');

    // Busy throughout: a request every minute keeps sliding the idle window.
    for (let minute = 1; minute < 30; minute += 1) {
      clock = 1_000_000 + minute * 60_000;
      expect(await sessions.find(sessionId), `minute ${minute}`).toBeDefined();
    }

    clock = 1_000_000 + SESSION_TTL_MS;
    expect(await sessions.find(sessionId)).toBeUndefined();
  });

  it('stops working after the idle window, well before the absolute deadline', async () => {
    let clock = 1_000_000;
    const sessions = createOrderingSessionService({ now: () => clock });
    const { sessionId } = await sessions.create('demo-outlet', 'kiosk');

    // A kiosk walk-away: used once, then abandoned.
    clock += 60_000;
    expect(await sessions.find(sessionId)).toBeDefined();

    clock += SESSION_IDLE_TTL_MS;
    expect(await sessions.find(sessionId)).toBeUndefined();
    // And it died long before the absolute cap would have ended it.
    expect(SESSION_IDLE_TTL_MS + 60_000).toBeLessThan(SESSION_TTL_MS);
  });

  it('slides the idle window on each use but never past the absolute deadline', async () => {
    const start = 1_000_000;
    let clock = start;
    const sessions = createOrderingSessionService({ now: () => clock });
    const { sessionId } = await sessions.create('demo-outlet', 'qr');

    // Each use just inside the idle window pushes the deadline forward.
    let previous = (await sessions.find(sessionId))?.idleExpiresAtMs ?? 0;
    while (clock + SESSION_IDLE_TTL_MS - 1_000 < start + SESSION_TTL_MS) {
      clock += SESSION_IDLE_TTL_MS - 1_000;
      const refreshed = await sessions.find(sessionId);
      expect(refreshed, `at ${clock - start}ms`).toBeDefined();
      expect(refreshed!.idleExpiresAtMs).toBeGreaterThan(previous);
      expect(refreshed!.idleExpiresAtMs).toBeLessThanOrEqual(refreshed!.expiresAtMs);
      expect(refreshed!.lastSeenAtMs).toBe(clock);
      previous = refreshed!.idleExpiresAtMs;
    }

    // Within one idle window of the cap, the idle deadline is clamped to it.
    clock = start + SESSION_TTL_MS - 1_000;
    const late = await sessions.find(sessionId);
    expect(late?.idleExpiresAtMs).toBe(start + SESSION_TTL_MS);

    // So activity cannot extend the session past the cap.
    clock = start + SESSION_TTL_MS;
    expect(await sessions.find(sessionId)).toBeUndefined();
  });

  it('drops an expired session from the store rather than holding it', async () => {
    let clock = 1_000_000;
    const sessions = createOrderingSessionService({ now: () => clock });
    await sessions.create('demo-outlet', 'qr');
    expect(await sessions.size()).toBe(1);

    clock += SESSION_IDLE_TTL_MS;
    expect(await sessions.size()).toBe(0);
  });

  it('reports an expired token exactly like an unknown one over HTTP', async () => {
    let clock = 1_000_000;
    const orderingSessions = createOrderingSessionService({ now: () => clock });
    const { app } = build({ orderingSessions });
    const sessionId = await mint(app);

    clock += SESSION_IDLE_TTL_MS;

    const expired = await request(app)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${sessionId}`)
      .send(DRAFT);
    const unknown = await request(app)
      .post('/api/v1/quotes')
      .set('Authorization', 'Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
      .send(DRAFT);

    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe(unknown.body.error.code);
    expect(expired.body.error.message).toBe(unknown.body.error.message);
  });
});

describe('bearer header parsing', () => {
  it.each([
    ['no header', undefined],
    ['empty bearer', 'Bearer '],
    ['wrong scheme', 'Basic abc'],
    ['scheme only', 'Bearer'],
    ['no separator', 'Bearerabc'],
    ['two tokens', 'Bearer abc def'],
    ['query-style value', '?sessionId=abc'],
  ])('rejects %s with 401', async (_label, header) => {
    const { app } = build();
    const pending = request(app).post('/api/v1/quotes');
    if (header !== undefined) pending.set('Authorization', header);

    const response = await pending.send(DRAFT);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it.each(['Bearer', 'bearer', 'BEARER'])('accepts the %s scheme', async (scheme) => {
    const { app } = build();
    const sessionId = await mint(app);

    const response = await request(app)
      .post('/api/v1/quotes')
      .set('Authorization', `${scheme} ${sessionId}`)
      .send(DRAFT);

    expect(response.status).toBe(200);
  });

  it('ignores a session ID supplied anywhere other than the header', async () => {
    const { app } = build();
    const sessionId = await mint(app);

    const viaQuery = await request(app)
      .post(`/api/v1/quotes?sessionId=${sessionId}`)
      .send(DRAFT);
    expect(viaQuery.status).toBe(401);

    const viaBody = await request(app)
      .post('/api/v1/quotes')
      .send({ ...DRAFT, sessionId });
    expect(viaBody.status).toBe(401);

    const viaCookie = await request(app)
      .post('/api/v1/quotes')
      .set('Cookie', `sessionId=${sessionId}`)
      .send(DRAFT);
    expect(viaCookie.status).toBe(401);
  });
});

describe('token redaction in logs and responses', () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((value) => String(value)).join(' '));
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never writes the token when an unexpected error is handled', async () => {
    const { app } = build({
      quoteService: {
        createQuote: () => {
          throw new Error('deliberate failure inside the quote service');
        },
      },
    });
    const sessionId = await mint(app);

    const response = await request(app)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${sessionId}`)
      .send(DRAFT);

    expect(response.status).toBe(500);
    // The 500 path is the one that logs, so there is something to inspect.
    expect(logged.join('\n')).toContain('Unhandled request error');
    expect(logged.join('\n')).not.toContain(sessionId);
    expect(logged.join('\n')).not.toMatch(/authorization/i);
    expect(JSON.stringify(response.body)).not.toContain(sessionId);
    expect(JSON.stringify(response.headers)).not.toContain(sessionId);
  });

  it('never writes the token on a rejected authentication', async () => {
    const { app } = build();

    const response = await request(app)
      .post('/api/v1/quotes')
      .set('Authorization', 'Bearer dGhpcy1pcy1hLXNlY3JldC1zZXNzaW9uLXRva2Vu')
      .send(DRAFT);

    expect(response.status).toBe(401);
    expect(logged.join('\n')).not.toContain('dGhpcy1pcy1hLXNlY3JldC1zZXNzaW9uLXRva2Vu');
    expect(JSON.stringify(response.body)).not.toContain(
      'dGhpcy1pcy1hLXNlY3JldC1zZXNzaW9uLXRva2Vu',
    );
  });

  it('never writes the token on a successful request', async () => {
    const { app } = build();
    const sessionId = await mint(app);

    await request(app)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${sessionId}`)
      .send(DRAFT);

    expect(logged.join('\n')).not.toContain(sessionId);
  });
});

describe('malformed and oversized request bodies', () => {
  it('rejects unparseable JSON as a client error, not a server fault', async () => {
    const { app } = build();
    const sessionId = await mint(app);

    const response = await request(app)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${sessionId}`)
      .set('Content-Type', 'application/json')
      .send('{"outletId": "demo-outlet", items: ');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });

  it('rejects a body over the 32kb limit with 413', async () => {
    const { app } = build();
    const sessionId = await mint(app);

    const response = await request(app)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${sessionId}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ outletId: 'demo-outlet', padding: 'x'.repeat(40_000) }));

    expect(response.status).toBe(413);
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });

  it('does not echo the malformed body back to the client', async () => {
    const { app } = build();
    const sessionId = await mint(app);

    const response = await request(app)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${sessionId}`)
      .set('Content-Type', 'application/json')
      .send('{"secret-ish": "do-not-echo-me", ');

    expect(JSON.stringify(response.body)).not.toContain('do-not-echo-me');
  });
});
