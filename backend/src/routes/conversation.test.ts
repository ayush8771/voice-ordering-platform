/**
 * HTTP contract for `POST /api/v1/conversation/turns`: authentication, outlet
 * scope, body validation, and the 503 a client must see when no conversational
 * provider is configured.
 *
 * The provider is a fake, so this suite makes no live call (docs/TESTING.md
 * section 2).
 */

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import { createCartService, createCartStore } from '../services/cart/index.js';
import { createConversationService } from '../services/conversation/service.js';
import { createFakeProvider, modelReply } from '../services/conversation/testFakes.js';
import {
  createInMemoryMenuRepository,
  SAMPLE_MENU,
} from '../services/menu/inMemoryMenuRepository.js';
import { createMenuLookup } from '../services/menu/menuLookup.js';
import { createMenuService } from '../services/menu/menuService.js';
import { createOrderingSessionService } from '../services/sessions/orderingSessionService.js';

/** `withAssistant: false` builds the app as it runs with no provider key. */
function app(options: { withAssistant?: boolean } = {}) {
  const menuService = createMenuService(createInMemoryMenuRepository(SAMPLE_MENU));
  const orderingSessions = createOrderingSessionService();
  const cartService = createCartService({ menuService, cartStore: createCartStore() });

  const conversationService =
    options.withAssistant === false
      ? undefined
      : createConversationService({
          provider: createFakeProvider([
            modelReply({
              reply: 'Added one idli.',
              toolCalls: [
                {
                  name: 'propose_draft_update',
                  arguments: { type: 'addItem', menuItemRef: 'Idli', quantity: 1 },
                },
              ],
            }),
          ]),
          menu: createMenuLookup(menuService),
        });

  return createApp(loadConfig({ NODE_ENV: 'test' }), {
    menuService,
    cartService,
    orderingSessions,
    ...(conversationService === undefined ? {} : { conversationService }),
  });
}

async function session(
  server: ReturnType<typeof app>,
  outletId = 'demo-outlet',
): Promise<string> {
  const response = await request(server)
    .post('/api/v1/ordering-sessions')
    .send({ outletId, channel: 'kiosk' });

  expect(response.status).toBe(201);
  return response.body.sessionId as string;
}

const TURN = { text: 'one idli please', language: 'en', phase: 'building' };

describe('POST /api/v1/conversation/turns', () => {
  it('applies the turn and returns the authoritative draft', async () => {
    const server = app();
    const token = await session(server);

    const response = await request(server)
      .post('/api/v1/conversation/turns')
      .set('Authorization', `Bearer ${token}`)
      .send(TURN);

    expect(response.status).toBe(200);
    expect(response.body.assistantText).toBe('Added one idli.');
    expect(response.body.cart.items).toHaveLength(1);
    expect(response.body.cart.totalMinor).toBe(4000);

    // The same draft is visible to the touch path.
    const cart = await request(server)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${token}`);
    expect(cart.body.items[0].menuItemId).toBe('item-idli');
  });

  it('requires an ordering session', async () => {
    const response = await request(app()).post('/api/v1/conversation/turns').send(TURN);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('refuses a body naming another outlet', async () => {
    const server = app();
    const token = await session(server);

    const response = await request(server)
      .post('/api/v1/conversation/turns')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...TURN, outletId: 'other-outlet' });

    expect(response.status).toBe(403);
  });

  it('rejects an unsupported phase or language', async () => {
    const server = app();
    const token = await session(server);

    for (const body of [
      { ...TURN, phase: 'checkout' },
      { ...TURN, language: 'fr' },
      { ...TURN, text: '' },
    ]) {
      const response = await request(server)
        .post('/api/v1/conversation/turns')
        .set('Authorization', `Bearer ${token}`)
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('answers 503 when no assistant is configured, leaving touch ordering intact', async () => {
    const server = app({ withAssistant: false });
    const token = await session(server);

    const response = await request(server)
      .post('/api/v1/conversation/turns')
      .set('Authorization', `Bearer ${token}`)
      .send(TURN);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');

    const added = await request(server)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ menuItemId: 'item-idli', quantity: 1 });
    expect(added.status).toBe(200);
  });
});
