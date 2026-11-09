/**
 * Conversation-to-cart integration: a model proposal reaching the real draft.
 *
 * Wired with the *real* conversation service, menu service, menu lookup port
 * and cart service, so this exercises the whole chain. Only the LLM is a fake:
 * it returns canned JSON and never touches the network, so this suite makes no
 * provider call and spends no credits (docs/TESTING.md section 2).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_CART_LINE_QUANTITY } from '@vop/shared';
import { ProviderError } from '../providers/llm/types.js';
import { createCartService, type CartService } from '../services/cart/cartService.js';
import { createCartStore } from '../services/cart/cartStore.js';
import { createConversationService } from '../services/conversation/service.js';
import { createFakeProvider, modelReply } from '../services/conversation/testFakes.js';
import type { FakeProvider } from '../services/conversation/testFakes.js';
import { createInMemoryMenuRepository } from '../services/menu/inMemoryMenuRepository.js';
import { SAMPLE_MENU } from '../services/menu/inMemoryMenuRepository.js';
import { createMenuLookup } from '../services/menu/menuLookup.js';
import { createMenuService } from '../services/menu/menuService.js';
import { runConversationTurn, type ConversationTurnInput } from './conversationTurn.js';

const SCOPE = {
  sessionId: 'session-a',
  outletId: 'demo-outlet',
  expiresAtMs: Number.MAX_SAFE_INTEGER,
} as const;

const OTHER_SCOPE = { ...SCOPE, sessionId: 'session-b' } as const;

const DOSA = 'item-masala-dosa';

/** A `propose_draft_update` tool call, as the model would emit it. */
function propose(args: Record<string, unknown>): unknown {
  return { name: 'propose_draft_update', arguments: args };
}

let cartService: CartService;

function harness(replies: readonly (string | ProviderError)[]): {
  provider: FakeProvider;
  turn: (
    text: string,
    overrides?: Partial<ConversationTurnInput>,
  ) => ReturnType<typeof runConversationTurn>;
} {
  const menuService = createMenuService(createInMemoryMenuRepository(SAMPLE_MENU));
  const provider = createFakeProvider(replies);
  const conversation = createConversationService({
    provider,
    menu: createMenuLookup(menuService),
  });
  cartService = createCartService({ menuService, cartStore: createCartStore() });

  return {
    provider,
    turn(text, overrides = {}) {
      return runConversationTurn(
        { conversation, cartService },
        {
          scope: SCOPE,
          channel: 'kiosk',
          language: 'en',
          phase: 'building',
          text,
          ...overrides,
        },
      );
    },
  };
}

beforeEach(() => {
  // Rebuilt per test by `harness`; assigned here so a test that never calls it
  // cannot read a previous test's cart.
  cartService = createCartService({
    menuService: createMenuService(createInMemoryMenuRepository(SAMPLE_MENU)),
    cartStore: createCartStore(),
  });
});

describe('runConversationTurn', () => {
  it('applies an add proposal to the real draft and prices it server-side', async () => {
    const { turn } = harness([
      modelReply({
        reply: 'Added two masala dosas.',
        toolCalls: [
          propose({ type: 'addItem', menuItemRef: 'Masala Dosa', quantity: 2 }),
        ],
      }),
    ]);

    const result = await turn('two masala dosa');

    expect(result.draftActions).toEqual([
      { action: { type: 'addItem', menuItemId: DOSA, quantity: 2 }, applied: true },
    ]);
    expect(result.cart.items).toHaveLength(1);
    expect(result.cart.items[0]?.quantity).toBe(2);
    // The amount comes from the menu, not from anything the model said.
    expect(result.cart.items[0]?.unitPriceMinor).toBe(8000);
    expect(result.cart.totalMinor).toBe(16000);
    expect(result.assistantText).toBe('Added two masala dosas.');
  });

  it('gives the model a referent so "two of those" resolves on a later turn', async () => {
    const { provider, turn } = harness([
      // Turn 1: the assistant mentions an item without touching the draft.
      modelReply({
        reply: 'The Masala Dosa is popular.',
        suggestions: [{ menuItemRef: 'Masala Dosa', kind: 'requested' }],
      }),
      // Turn 2: the model answers the deictic request with the referent's ID.
      modelReply({
        reply: 'Added two.',
        toolCalls: [propose({ type: 'addItem', menuItemRef: DOSA, quantity: 2 })],
      }),
    ]);

    await turn('what do you recommend');
    const second = await turn('add two of those');

    const prompt = provider.calls[1]?.messages[0]?.content ?? '';
    expect(prompt).toContain('Most recently discussed item: Masala Dosa');
    expect(prompt).toContain(`id=${DOSA}`);
    // The first turn's prompt had no referent to offer yet.
    expect(provider.calls[0]?.messages[0]?.content).not.toContain(
      'Most recently discussed item',
    );

    expect(second.cart.items[0]?.quantity).toBe(2);
  });

  it('never hands the model prices or totals from the draft', async () => {
    const { provider, turn } = harness([
      modelReply({
        toolCalls: [propose({ type: 'addItem', menuItemRef: 'Idli', quantity: 1 })],
      }),
      modelReply({ reply: 'You have one idli.' }),
    ]);

    await turn('one idli');
    const result = await turn('what is my total');

    const prompt = provider.calls[1]?.messages[0]?.content ?? '';
    expect(prompt).toContain('1 x Idli');
    expect(prompt).not.toContain('4000');
    expect(prompt).not.toContain('subtotal');
    // The authoritative amount travels in the result instead.
    expect(result.cart.totalMinor).toBe(4000);
  });

  it('updates and removes a line the model named by selection, not by line ID', async () => {
    const { turn } = harness([
      modelReply({
        toolCalls: [propose({ type: 'addItem', menuItemRef: 'Idli', quantity: 1 })],
      }),
      modelReply({
        toolCalls: [
          propose({ type: 'updateQuantity', menuItemRef: 'Idli', quantity: 3 }),
        ],
      }),
      modelReply({
        toolCalls: [propose({ type: 'removeItem', menuItemRef: 'Idli' })],
      }),
    ]);

    await turn('one idli');
    const updated = await turn('make it three');
    expect(updated.cart.items[0]?.quantity).toBe(3);

    const removed = await turn('actually remove the idli');
    expect(removed.draftActions[0]?.applied).toBe(true);
    expect(removed.cart.items).toHaveLength(0);
  });

  it('clears the whole draft on a clearDraft proposal', async () => {
    const { turn } = harness([
      modelReply({
        toolCalls: [propose({ type: 'addItem', menuItemRef: 'Idli', quantity: 2 })],
      }),
      modelReply({ toolCalls: [propose({ type: 'clearDraft' })] }),
    ]);

    await turn('two idli');
    const cleared = await turn('start over');

    expect(cleared.draftActions[0]?.applied).toBe(true);
    expect(cleared.cart.items).toHaveLength(0);
    expect(cleared.cart.totalMinor).toBe(0);
  });

  it('reports a change to something not in the draft instead of failing the turn', async () => {
    const { turn } = harness([
      modelReply({
        reply: 'Let me check.',
        toolCalls: [
          propose({ type: 'updateQuantity', menuItemRef: 'Idli', quantity: 2 }),
        ],
      }),
    ]);

    const result = await turn('make the idli two');

    expect(result.draftActions[0]).toMatchObject({
      applied: false,
      reason: 'not_in_draft',
    });
    // The customer still gets a reply and the real draft.
    expect(result.assistantText).toBe('Let me check.');
    expect(result.cart.items).toHaveLength(0);
  });

  it('refuses rather than guesses when two draft lines match the proposal', async () => {
    const { turn } = harness([
      modelReply({
        toolCalls: [
          propose({
            type: 'addItem',
            menuItemRef: DOSA,
            quantity: 1,
            optionRefs: ['opt-ghee'],
          }),
        ],
      }),
      modelReply({
        toolCalls: [
          propose({
            type: 'addItem',
            menuItemRef: DOSA,
            quantity: 1,
            optionRefs: ['opt-extra-chutney'],
          }),
        ],
      }),
      modelReply({
        toolCalls: [
          propose({ type: 'updateQuantity', menuItemRef: DOSA, quantity: 5 }),
        ],
      }),
    ]);

    await turn('a ghee roast dosa');
    await turn('and one with extra chutney');
    const ambiguous = await turn('make the dosa five');

    expect(ambiguous.draftActions[0]).toMatchObject({
      applied: false,
      reason: 'ambiguous_draft_line',
    });
    expect(ambiguous.cart.items.map((line) => line.quantity)).toEqual([1, 1]);
  });

  it('surfaces a cart-service refusal as a rejected action, draft unchanged', async () => {
    const { turn } = harness([
      modelReply({
        toolCalls: [
          propose({
            type: 'addItem',
            menuItemRef: 'Idli',
            quantity: MAX_CART_LINE_QUANTITY,
          }),
        ],
      }),
      modelReply({
        reply: 'That is more than I can add.',
        toolCalls: [propose({ type: 'addItem', menuItemRef: 'Idli', quantity: 5 })],
      }),
    ]);

    await turn('twenty idli');
    const refused = await turn('five more idli');

    expect(refused.draftActions[0]).toMatchObject({
      applied: false,
      reason: 'rejected_by_cart',
    });
    expect(refused.cart.items[0]?.quantity).toBe(MAX_CART_LINE_QUANTITY);
  });

  it('never adds an unavailable item, and records why', async () => {
    const { turn } = harness([
      modelReply({
        reply: 'Medu vada is sold out.',
        toolCalls: [
          propose({ type: 'addItem', menuItemRef: 'Medu Vada', quantity: 1 }),
        ],
      }),
    ]);

    const result = await turn('one medu vada');

    // Refused by the conversation service before the cart was ever called.
    expect(result.draftActions).toEqual([]);
    expect(result.violations.map((violation) => violation.kind)).toContain(
      'unavailable_menu_item',
    );
    expect(result.cart.items).toHaveLength(0);
  });

  it('leaves the draft intact and asks for touch when the provider fails', async () => {
    const { turn } = harness([
      modelReply({
        toolCalls: [propose({ type: 'addItem', menuItemRef: 'Idli', quantity: 1 })],
      }),
      new ProviderError('provider_unavailable', 'fake', 'down'),
    ]);

    await turn('one idli');
    const failed = await turn('add a coffee');

    expect(failed.assistantText).toBeUndefined();
    expect(failed.providerStatus).toMatchObject({ state: 'failed', fallback: 'touch' });
    expect(failed.draftActions).toEqual([]);
    // The draft the touch UI shows is untouched and still orderable.
    expect(failed.cart.items[0]?.quantity).toBe(1);
    expect(failed.cart.totalMinor).toBe(4000);
  });

  it('rejects a forbidden tool and changes nothing', async () => {
    const { turn } = harness([
      modelReply({
        reply: 'Done!',
        toolCalls: [{ name: 'create_order', arguments: { confirm: true } }],
      }),
    ]);

    const result = await turn('just order it for me');

    expect(result.violations.map((violation) => violation.kind)).toContain(
      'forbidden_tool',
    );
    expect(result.draftActions).toEqual([]);
    expect(result.cart.items).toHaveLength(0);
  });

  it('keeps one session turn out of another session draft', async () => {
    const { turn } = harness([
      modelReply({
        toolCalls: [propose({ type: 'addItem', menuItemRef: 'Idli', quantity: 2 })],
      }),
      modelReply({ reply: 'Your draft is empty.' }),
    ]);

    await turn('two idli');
    const other = await turn('what do I have', { scope: OTHER_SCOPE });

    expect(other.cart.items).toHaveLength(0);
    expect((await cartService.getCart(SCOPE)).items[0]?.quantity).toBe(2);
  });
});
