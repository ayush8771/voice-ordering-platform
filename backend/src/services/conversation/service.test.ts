/**
 * Conversation service behaviour.
 *
 * Every provider reply is scripted through a fake that never performs network
 * I/O, so this suite consumes no API credits (docs/TESTING.md section 2).
 */

import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../providers/llm/types.js';
import { CONVERSATION_DEFAULTS, type ConversationConfig } from './config.js';
import { createConversationService, type ConversationService } from './service.js';
import { ConversationSessionStore } from './sessionStore.js';
import {
  createFakeMenu,
  createFakeProvider,
  modelReply,
  TEST_MENU,
  type FakeMenu,
  type FakeProvider,
} from './testFakes.js';
import {
  ConversationError,
  type ConversationPhase,
  type ConversationRequest,
} from './types.js';

interface Harness {
  readonly service: ConversationService;
  readonly provider: FakeProvider;
  readonly menu: FakeMenu;
  readonly logs: Record<string, unknown>[];
}

function harness(
  replies: readonly (string | ProviderError)[],
  overrides: Partial<ConversationConfig> = {},
): Harness {
  const config: ConversationConfig = { ...CONVERSATION_DEFAULTS, ...overrides };
  const provider = createFakeProvider(replies);
  const menu = createFakeMenu(TEST_MENU);
  const logs: Record<string, unknown>[] = [];

  return {
    provider,
    menu,
    logs,
    service: createConversationService({
      provider,
      menu,
      config,
      store: new ConversationSessionStore(config),
      log: (entry) => logs.push(entry),
    }),
  };
}

function turn(overrides: Partial<ConversationRequest> = {}): ConversationRequest {
  return {
    sessionId: 'sess_a',
    outletId: 'outlet_1',
    channel: 'kiosk',
    language: 'en',
    text: 'one masala dosa please',
    phase: 'building',
    ...overrides,
  };
}

describe('happy path', () => {
  it('returns assistant text, provider status and mapped usage', async () => {
    const { service } = harness([modelReply({ reply: 'Added one Masala Dosa.' })]);

    const result = await service.handleTurn(turn());

    expect(result.assistantText).toBe('Added one Masala Dosa.');
    expect(result.providerStatus).toEqual({
      state: 'ok',
      providerId: 'fake',
      model: 'fake-model',
    });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(result.violations).toEqual([]);
  });

  it('passes the output budget and no unverified sampling field to the provider', async () => {
    const { service, provider } = harness([modelReply({})], { maxOutputTokens: 123 });

    await service.handleTurn(turn());

    expect(provider.calls[0]?.maxOutputTokens).toBe(123);
    expect(provider.calls[0]?.temperature).toBeUndefined();
  });

  it('replays bounded history on the next turn', async () => {
    const { service, provider } = harness([modelReply({ reply: 'Sure.' })]);

    await service.handleTurn(turn({ text: 'one dosa' }));
    await service.handleTurn(turn({ text: 'make it two' }));

    const second = provider.calls[1]?.messages ?? [];
    expect(second.map((m) => m.content)).toEqual([
      expect.stringContaining('You take food orders'),
      'one dosa',
      'Sure.',
      'make it two',
    ]);
  });

  it('forgets history when the session ends', async () => {
    const { service, provider } = harness([modelReply({ reply: 'Sure.' })]);

    await service.handleTurn(turn({ text: 'one dosa' }));
    service.endSession('sess_a');
    await service.handleTurn(turn({ text: 'two idli' }));

    expect(provider.calls[1]?.messages).toHaveLength(2);
  });

  it('puts the policy and phase in the system prompt', async () => {
    const { service, provider } = harness([modelReply({})]);

    await service.handleTurn(turn({ phase: 'review' }));

    const system = provider.calls[0]?.messages[0]?.content ?? '';
    expect(system).toContain('Do NOT offer any unsolicited suggestion');
    expect(system).toContain('phase=review');
    expect(system).toContain('cannot create, confirm or cancel an order');
  });
});

describe('draft proposals', () => {
  it('resolves a proposal to a backend menu ID with no price field', async () => {
    const { service } = harness([
      modelReply({
        reply: 'Added two dosas.',
        toolCalls: [
          {
            name: 'propose_draft_update',
            arguments: {
              type: 'addItem',
              menuItemRef: 'Masala Dosa',
              quantity: 2,
              optionRefs: ['opt_extra_chutney'],
            },
          },
        ],
      }),
    ]);

    const result = await service.handleTurn(turn());

    expect(result.draftActions).toEqual([
      {
        type: 'addItem',
        menuItemId: 'item_dosa',
        quantity: 2,
        optionIds: ['opt_extra_chutney'],
      },
    ]);
    expect(JSON.stringify(result.draftActions)).not.toContain('price');
  });

  it('never acts on an item that is not on the menu', async () => {
    const { service } = harness([
      modelReply({
        reply: 'Added biryani.',
        toolCalls: [
          {
            name: 'propose_draft_update',
            arguments: { type: 'addItem', menuItemRef: 'Chicken Biryani', quantity: 1 },
          },
        ],
      }),
    ]);

    const result = await service.handleTurn(turn());

    expect(result.draftActions).toEqual([]);
    expect(result.violations).toEqual([
      { kind: 'unresolved_menu_item', detail: 'Chicken Biryani' },
    ]);
  });

  it('refuses an unavailable item', async () => {
    const { service } = harness([
      modelReply({
        toolCalls: [
          {
            name: 'propose_draft_update',
            arguments: { type: 'addItem', menuItemRef: 'Medu Vada', quantity: 1 },
          },
        ],
      }),
    ]);

    const result = await service.handleTurn(turn());

    expect(result.draftActions).toEqual([]);
    expect(result.violations[0]?.kind).toBe('unavailable_menu_item');
  });

  it('refuses an ambiguous item instead of guessing', async () => {
    const { service } = harness([
      modelReply({
        toolCalls: [
          {
            name: 'propose_draft_update',
            arguments: { type: 'addItem', menuItemRef: 'Coffee', quantity: 1 },
          },
        ],
      }),
    ]);

    const result = await service.handleTurn(turn());

    expect(result.draftActions).toEqual([]);
    expect(result.violations[0]?.kind).toBe('ambiguous_menu_item');
  });

  it('rejects a whole proposal when an option does not exist on the item', async () => {
    const { service } = harness([
      modelReply({
        toolCalls: [
          {
            name: 'propose_draft_update',
            arguments: {
              type: 'addItem',
              menuItemRef: 'Idli',
              quantity: 1,
              optionRefs: ['opt_extra_chutney'],
            },
          },
        ],
      }),
    ]);

    const result = await service.handleTurn(turn());

    expect(result.draftActions).toEqual([]);
    expect(result.violations[0]?.kind).toBe('invalid_draft_action');
  });

  it('cannot reach another outlet through a session bound to this one', async () => {
    const { service } = harness([
      modelReply({
        toolCalls: [
          {
            name: 'propose_draft_update',
            arguments: { type: 'addItem', menuItemRef: 'Poha', quantity: 1 },
          },
        ],
      }),
    ]);

    const result = await service.handleTurn(turn());

    // Poha exists only in outlet_2.
    expect(result.draftActions).toEqual([]);
    expect(result.violations[0]?.kind).toBe('unresolved_menu_item');
  });
});

describe('tool allowlist enforcement', () => {
  it.each([
    'create_order',
    'confirm_order',
    'verify_payment',
    'update_order_status',
    'set_price',
  ])('refuses %s and produces no action', async (name) => {
    const { service } = harness([
      modelReply({
        reply: 'Order placed and paid.',
        toolCalls: [{ name, arguments: { orderId: 'o1', paymentStatus: 'verified' } }],
      }),
    ]);

    const result = await service.handleTurn(turn());

    expect(result.draftActions).toEqual([]);
    expect(result.violations).toContainEqual({ kind: 'forbidden_tool', detail: name });
    expect(result.toolRequests).toEqual([
      { name, accepted: false, reason: 'forbidden_tool' },
    ]);
  });

  it('records an unknown tool without executing anything', async () => {
    const { service, menu } = harness([
      modelReply({ toolCalls: [{ name: 'dump_sessions', arguments: {} }] }),
    ]);

    const result = await service.handleTurn(turn());

    expect(result.violations[0]?.kind).toBe('unknown_tool');
    expect(menu.searches).toEqual([]);
  });

  it('executes a menu lookup and feeds the result back for a second call', async () => {
    const { service, provider, menu } = harness([
      modelReply({
        toolCalls: [{ name: 'menu_search', arguments: { query: 'dosa' } }],
      }),
      modelReply({ reply: 'We have Masala Dosa.' }),
    ]);

    const result = await service.handleTurn(turn());

    expect(menu.searches).toEqual([{ outletId: 'outlet_1', query: 'dosa' }]);
    expect(result.toolRequests).toEqual([
      { name: 'menu_search', accepted: true, resultCount: 1 },
    ]);
    expect(result.assistantText).toBe('We have Masala Dosa.');

    const second = provider.calls[1]?.messages ?? [];
    expect(second[second.length - 1]?.content).toContain('TOOL_RESULT menu_search');
    expect(second[second.length - 1]?.content).toContain('item_dosa');
  });

  it('stops after the configured tool rounds', async () => {
    const { service, provider } = harness(
      [
        modelReply({
          toolCalls: [{ name: 'menu_search', arguments: { query: 'dosa' } }],
        }),
      ],
      { maxToolRounds: 1 },
    );

    const result = await service.handleTurn(turn());

    // One executed round, then one refusal: the loop cannot spin.
    expect(provider.calls).toHaveLength(2);
    expect(result.violations).toContainEqual({ kind: 'tool_round_limit', detail: '1' });
    expect(result.toolRequests).toContainEqual({
      name: 'menu_search',
      accepted: false,
      reason: 'tool_round_limit',
    });
  });

  it('sums usage across tool rounds', async () => {
    const { service } = harness([
      modelReply({
        toolCalls: [{ name: 'menu_search', arguments: { query: 'dosa' } }],
      }),
      modelReply({ reply: 'done' }),
    ]);

    const result = await service.handleTurn(turn());
    expect(result.usage).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
    });
  });
});

describe('recommendation policy', () => {
  const proactive = modelReply({
    reply: 'Would you like a Filter Coffee?',
    suggestions: [{ menuItemRef: 'Filter Coffee', kind: 'proactive' }],
  });

  it('allows one proactive suggestion per session and suppresses the next', async () => {
    const { service } = harness([proactive]);

    const first = await service.handleTurn(turn());
    expect(first.suggestions).toEqual([
      { menuItemId: 'item_coffee_filter', name: 'Filter Coffee', kind: 'proactive' },
    ]);
    expect(first.policy.proactiveSuppressed).toBe(false);

    const second = await service.handleTurn(turn({ text: 'and one idli' }));
    expect(second.suggestions).toEqual([]);
    expect(second.policy.proactiveSuppressed).toBe(true);
    expect(second.violations).toContainEqual({
      kind: 'proactive_recommendation_suppressed',
    });
  });

  it.each(['review', 'confirmation', 'payment'] as ConversationPhase[])(
    'suppresses proactive suggestions during %s',
    async (phase) => {
      const { service } = harness([proactive]);

      const result = await service.handleTurn(turn({ phase }));

      expect(result.suggestions).toEqual([]);
      expect(result.policy.proactiveAllowed).toBe(false);
      expect(result.policy.proactiveSuppressed).toBe(true);
    },
  );

  it('still answers a requested recommendation in a forbidden phase', async () => {
    const { service } = harness([
      modelReply({
        reply: 'The Masala Dosa is popular.',
        suggestions: [{ menuItemRef: 'Masala Dosa', kind: 'requested' }],
      }),
    ]);

    const result = await service.handleTurn(turn({ phase: 'payment' }));

    expect(result.suggestions).toEqual([
      { menuItemId: 'item_dosa', name: 'Masala Dosa', kind: 'requested' },
    ]);
    expect(result.policy.proactiveSuppressed).toBe(false);
  });

  it('stops proactive suggestions for the session after a decline', async () => {
    const { service } = harness([proactive]);

    const declined = await service.handleTurn(
      turn({ customerDeclinedRecommendation: true }),
    );
    expect(declined.suggestions).toEqual([]);
    expect(declined.policy.declinedThisSession).toBe(true);

    const later = await service.handleTurn(turn({ text: 'anything else?' }));
    expect(later.suggestions).toEqual([]);
    expect(later.policy.proactiveAllowed).toBe(false);
  });

  it('does not spend the allowance when the suggested item is unavailable', async () => {
    const { service } = harness([
      modelReply({
        reply: 'Try the vada?',
        suggestions: [{ menuItemRef: 'Medu Vada', kind: 'proactive' }],
      }),
      modelReply({
        reply: 'Try a coffee?',
        suggestions: [{ menuItemRef: 'Filter Coffee', kind: 'proactive' }],
      }),
    ]);

    const first = await service.handleTurn(turn());
    expect(first.suggestions).toEqual([]);
    expect(first.policy.proactiveUsedThisSession).toBe(false);

    const second = await service.handleTurn(turn({ text: 'what else' }));
    expect(second.suggestions).toHaveLength(1);
  });

  it('keeps policy state separate per session', async () => {
    const { service } = harness([proactive]);

    await service.handleTurn(turn({ sessionId: 'sess_a' }));
    const other = await service.handleTurn(turn({ sessionId: 'sess_b' }));

    expect(other.suggestions).toHaveLength(1);
    expect(other.policy.proactiveSuppressed).toBe(false);
  });
});

describe('provider failure', () => {
  it('degrades to the touch path without touching the draft', async () => {
    const { service } = harness([
      new ProviderError('provider_quota_exhausted', 'fake', 'no credits', {
        status: 402,
      }),
    ]);

    const result = await service.handleTurn(turn());

    expect(result.assistantText).toBeUndefined();
    expect(result.draftActions).toEqual([]);
    expect(result.suggestions).toEqual([]);
    expect(result.providerStatus).toEqual({
      state: 'failed',
      providerId: 'fake',
      model: 'fake-model',
      code: 'provider_quota_exhausted',
      retryable: false,
      fallback: 'touch',
    });
  });

  it('reports a retryable failure as retryable', async () => {
    const { service } = harness([
      new ProviderError('provider_timeout', 'fake', 'timed out'),
    ]);

    const result = await service.handleTurn(turn());
    expect(result.providerStatus.retryable).toBe(true);
  });

  it('does not poison history with a failed turn', async () => {
    const config = CONVERSATION_DEFAULTS;

    // Two services share one store, so the second turn sees the first's state.
    const failing = createFakeProvider([
      new ProviderError('provider_unavailable', 'fake', 'down'),
    ]);
    const working = createFakeProvider([modelReply({ reply: 'ok' })]);
    const store = new ConversationSessionStore(config);
    const sharedMenu = createFakeMenu(TEST_MENU);

    const first = createConversationService({
      provider: failing,
      menu: sharedMenu,
      config,
      store,
      log: () => {},
    });
    const second = createConversationService({
      provider: working,
      menu: sharedMenu,
      config,
      store,
      log: () => {},
    });

    await first.handleTurn(turn({ text: 'one dosa' }));
    await second.handleTurn(turn({ text: 'hello?' }));

    // Only the system prompt and the new utterance: the failed turn left nothing.
    expect(working.calls[0]?.messages).toHaveLength(2);
  });

  it('propagates a non-provider error instead of hiding it', async () => {
    const provider = createFakeProvider([modelReply({})]);
    const service = createConversationService({
      provider,
      menu: {
        search: () => Promise.reject(new Error('mongo down')),
        getById: () => Promise.reject(new Error('mongo down')),
      },
      log: () => {},
    });

    await expect(
      service.handleTurn(
        turn({
          text: 'one dosa',
        }),
      ),
    ).resolves.toMatchObject({ providerStatus: { state: 'ok' } });

    const withTool = createConversationService({
      provider: createFakeProvider([
        modelReply({ toolCalls: [{ name: 'menu_search', arguments: { query: 'x' } }] }),
      ]),
      menu: {
        search: () => Promise.reject(new Error('mongo down')),
        getById: () => Promise.reject(new Error('mongo down')),
      },
      log: () => {},
    });

    await expect(withTool.handleTurn(turn())).rejects.toThrow(/mongo down/);
  });
});

describe('unstructured output', () => {
  it('passes prose through as the reply with no actions', async () => {
    const { service } = harness(['We are out of vada today, sorry!']);

    const result = await service.handleTurn(turn());

    expect(result.assistantText).toBe('We are out of vada today, sorry!');
    expect(result.draftActions).toEqual([]);
    expect(result.violations).toEqual([{ kind: 'unstructured_output' }]);
  });
});

describe('request validation', () => {
  it.each([
    ['empty text', { text: '   ' }],
    ['missing session', { sessionId: '' }],
    ['missing outlet', { outletId: '' }],
    ['unsupported phase', { phase: 'checkout' as ConversationPhase }],
  ])('rejects %s before calling the provider', async (_label, overrides) => {
    const { service, provider } = harness([modelReply({})]);

    await expect(service.handleTurn(turn(overrides))).rejects.toThrow(
      ConversationError,
    );
    expect(provider.calls).toEqual([]);
  });

  it('rejects input longer than the configured bound', async () => {
    const { service, provider } = harness([modelReply({})], { maxInputChars: 50 });

    await expect(
      service.handleTurn(turn({ text: 'x'.repeat(51) })),
    ).rejects.toMatchObject({ code: 'input_too_long' });
    expect(provider.calls).toEqual([]);
  });

  it('refuses a session replayed against another outlet', async () => {
    const { service } = harness([modelReply({})]);

    await service.handleTurn(turn());

    await expect(
      service.handleTurn(turn({ outletId: 'outlet_2' })),
    ).rejects.toMatchObject({ code: 'session_scope_mismatch' });
  });
});

describe('logging', () => {
  it('logs a hashed session reference, never the session ID or transcript', async () => {
    const { service, logs } = harness([modelReply({ reply: 'Added one dosa.' })]);

    await service.handleTurn(turn({ sessionId: 'sess_secret_capability' }));

    const [entry] = logs;
    const serialized = JSON.stringify(entry);

    expect(entry?.['event']).toBe('conversation.turn');
    expect(typeof entry?.['sessionRef']).toBe('string');
    expect(serialized).not.toContain('sess_secret_capability');
    expect(serialized).not.toContain('masala dosa please');
    expect(serialized).not.toContain('Added one dosa.');
    expect(entry?.['inputChars']).toBe('one masala dosa please'.length);
    expect(entry?.['providerState']).toBe('ok');
  });

  it('logs a provider failure with its code', async () => {
    const { service, logs } = harness([
      new ProviderError('provider_rate_limited', 'fake', 'slow down', { status: 429 }),
    ]);

    await service.handleTurn(turn());

    expect(logs[0]).toMatchObject({
      providerState: 'failed',
      providerCode: 'provider_rate_limited',
      retryable: true,
    });
  });

  it('defaults to stdout JSON when no sink is provided', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const service = createConversationService({
      provider: createFakeProvider([modelReply({})]),
      menu: createFakeMenu(TEST_MENU),
    });
    await service.handleTurn(turn());

    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0]?.[0])).toContain('"event":"conversation.turn"');
    spy.mockRestore();
  });
});
