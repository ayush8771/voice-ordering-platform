/**
 * The real `MenuLookupPort`, including an end-to-end check that the
 * conversation service now resolves spoken item names to backend menu IDs.
 */

import { describe, expect, it } from 'vitest';
import { createConversationService } from '../conversation/service.js';
import { createFakeProvider, modelReply } from '../conversation/testFakes.js';
import { createInMemoryMenuRepository, SAMPLE_MENU } from './inMemoryMenuRepository.js';
import { createMenuLookup } from './menuLookup.js';
import { createMenuService } from './menuService.js';

function lookup() {
  return createMenuLookup(createMenuService(createInMemoryMenuRepository(SAMPLE_MENU)));
}

describe('menu lookup search', () => {
  it('finds an item by exact name, case-insensitively', async () => {
    const results = await lookup().search('demo-outlet', 'masala dosa', 5);

    expect(results).toEqual([
      {
        id: 'item-masala-dosa',
        name: 'Masala Dosa',
        available: true,
        priceMinor: 8000,
        optionIds: ['opt-extra-chutney', 'opt-ghee'],
      },
    ]);
  });

  it('prefers an exact match over a longer name containing it', async () => {
    const results = await lookup().search('demo-outlet', 'Idli', 5);

    // "Idli Sambar" also matches as a prefix, but an exact hit must not be
    // reported as ambiguous.
    expect(results.map((item) => item.id)).toEqual(['item-idli']);
  });

  it('returns several candidates for a partial name', async () => {
    const results = await lookup().search('demo-outlet', 'coffee', 5);

    expect(results.map((item) => item.id).sort()).toEqual([
      'item-cold-coffee',
      'item-filter-coffee',
    ]);
  });

  it('reports a sold-out item as unavailable instead of hiding it', async () => {
    const results = await lookup().search('demo-outlet', 'medu vada', 5);

    expect(results).toHaveLength(1);
    expect(results[0]?.available).toBe(false);
  });

  it('exposes only active option IDs', async () => {
    const results = await lookup().search('demo-outlet', 'masala dosa', 5);
    expect(results[0]?.optionIds).not.toContain('opt-seasonal');
  });

  it('honours the limit and an empty query', async () => {
    expect(await lookup().search('demo-outlet', 'i', 1)).toHaveLength(1);
    expect(await lookup().search('demo-outlet', '   ', 5)).toEqual([]);
  });

  it('never crosses outlets', async () => {
    expect(await lookup().search('demo-outlet', 'poha', 5)).toEqual([]);
    expect(await lookup().search('other-outlet', 'idli', 5)).toEqual([]);
  });

  it('returns nothing for an unknown or inactive outlet instead of failing', async () => {
    expect(await lookup().search('ghost-outlet', 'idli', 5)).toEqual([]);
    expect(await lookup().search('closed-outlet', 'idli', 5)).toEqual([]);
    expect(await lookup().getById('closed-outlet', 'item-idli')).toBeUndefined();
  });
});

describe('menu lookup getById', () => {
  it('returns one item scoped to its outlet', async () => {
    expect((await lookup().getById('demo-outlet', 'item-idli'))?.name).toBe('Idli');
    expect(await lookup().getById('demo-outlet', 'item-poha')).toBeUndefined();
    expect(await lookup().getById('demo-outlet', 'nope')).toBeUndefined();
  });

  it('returns the name in the requested language', async () => {
    expect((await lookup().getById('demo-outlet', 'item-idli', 'kn'))?.name).toBe(
      'ಇಡ್ಲಿ',
    );
    expect((await lookup().getById('demo-outlet', 'item-idli', 'hi'))?.name).toBe(
      'इडली',
    );
    // Untranslated: English, not a blank.
    expect(
      (await lookup().getById('demo-outlet', 'item-cold-coffee', 'kn'))?.name,
    ).toBe('Cold Coffee');
  });
});

describe('multilingual menu lookup', () => {
  it('finds an item by its Kannada name', async () => {
    const results = await lookup().search('demo-outlet', 'ಮಸಾಲೆ ದೋಸೆ', 5, 'kn');

    expect(results.map((item) => item.id)).toEqual(['item-masala-dosa']);
    // The model is handed the words the customer used.
    expect(results[0]?.name).toBe('ಮಸಾಲೆ ದೋಸೆ');
  });

  it('finds an item by its Hindi name', async () => {
    const results = await lookup().search('demo-outlet', 'मसाला डोसा', 5, 'hi');

    expect(results.map((item) => item.id)).toEqual(['item-masala-dosa']);
    expect(results[0]?.name).toBe('मसाला डोसा');
  });

  it('still resolves the English name inside a non-English session', async () => {
    // Code-switched speech is the norm ("two dosa, ಒಂದು ಕಾಫಿ"), so the
    // canonical name is matched alongside the translated one.
    const results = await lookup().search('demo-outlet', 'masala dosa', 5, 'kn');

    expect(results.map((item) => item.id)).toEqual(['item-masala-dosa']);
    expect(results[0]?.name).toBe('ಮಸಾಲೆ ದೋಸೆ');
  });

  it('does not match another language than the one asked for', async () => {
    // A Hindi session must not resolve a Kannada name it cannot have heard.
    expect(await lookup().search('demo-outlet', 'ಮಸಾಲೆ ದೋಸೆ', 5, 'hi')).toEqual([]);
    expect(await lookup().search('demo-outlet', 'ಮಸಾಲೆ ದೋಸೆ', 5)).toEqual([]);
  });

  it('ranks a translated exact match above a translated prefix match', async () => {
    // "ಇಡ್ಲಿ" is also a prefix of nothing else translated, so this pins the
    // English half of the same rule: an exact hit is never ambiguous.
    const results = await lookup().search('demo-outlet', 'ಇಡ್ಲಿ', 5, 'kn');
    expect(results.map((item) => item.id)).toEqual(['item-idli']);
  });
});

describe('conversation service over the real menu lookup', () => {
  function conversation(reply: string) {
    const menuService = createMenuService(createInMemoryMenuRepository(SAMPLE_MENU));
    return createConversationService({
      provider: createFakeProvider([reply]),
      menu: createMenuLookup(menuService),
      log: () => {},
    });
  }

  const turn = {
    sessionId: 'sess_a',
    outletId: 'demo-outlet',
    channel: 'kiosk' as const,
    language: 'en' as const,
    text: 'two masala dosa',
    phase: 'building' as const,
  };

  it('resolves a spoken item name to a real menu ID', async () => {
    const service = conversation(
      modelReply({
        reply: 'Added two Masala Dosa.',
        toolCalls: [
          {
            name: 'propose_draft_update',
            arguments: {
              type: 'addItem',
              menuItemRef: 'masala dosa',
              quantity: 2,
              optionRefs: ['opt-ghee'],
            },
          },
        ],
      }),
    );

    const result = await service.handleTurn(turn);

    expect(result.draftActions).toEqual([
      {
        type: 'addItem',
        menuItemId: 'item-masala-dosa',
        quantity: 2,
        optionIds: ['opt-ghee'],
      },
    ]);
    expect(result.violations).toEqual([]);
  });

  it('resolves a Kannada item name spoken in a Kannada turn', async () => {
    const service = conversation(
      modelReply({
        reply: 'ಎರಡು ಮಸಾಲೆ ದೋಸೆ ಸೇರಿಸಿದೆ.',
        toolCalls: [
          {
            name: 'propose_draft_update',
            arguments: {
              type: 'addItem',
              menuItemRef: 'ಮಸಾಲೆ ದೋಸೆ',
              quantity: 2,
            },
          },
        ],
      }),
    );

    const result = await service.handleTurn({
      ...turn,
      language: 'kn',
      text: 'ಎರಡು ಮಸಾಲೆ ದೋಸೆ',
    });

    expect(result.draftActions).toEqual([
      { type: 'addItem', menuItemId: 'item-masala-dosa', quantity: 2 },
    ]);
    expect(result.violations).toEqual([]);
  });

  it('hands the model menu search results in the turn language', async () => {
    const menuService = createMenuService(createInMemoryMenuRepository(SAMPLE_MENU));
    const provider = createFakeProvider([
      modelReply({
        toolCalls: [{ name: 'menu_search', arguments: { query: 'ಇಡ್ಲಿ' } }],
      }),
      modelReply({ reply: 'ಇಡ್ಲಿ ಇದೆ.' }),
    ]);
    const service = createConversationService({
      provider,
      menu: createMenuLookup(menuService),
      log: () => {},
    });

    await service.handleTurn({ ...turn, language: 'kn', text: 'ಇಡ್ಲಿ ಇದೆಯಾ' });

    const messages = provider.calls[1]?.messages ?? [];
    const toolResult = messages[messages.length - 1]?.content ?? '';
    expect(toolResult).toContain('item-idli');
    expect(toolResult).toContain('ಇಡ್ಲಿ');
  });

  it('refuses a sold-out item the model proposed', async () => {
    const service = conversation(
      modelReply({
        toolCalls: [
          {
            name: 'propose_draft_update',
            arguments: { type: 'addItem', menuItemRef: 'Medu Vada', quantity: 1 },
          },
        ],
      }),
    );

    const result = await service.handleTurn(turn);

    expect(result.draftActions).toEqual([]);
    expect(result.violations[0]?.kind).toBe('unavailable_menu_item');
  });

  it('refuses an inactive option the model proposed', async () => {
    const service = conversation(
      modelReply({
        toolCalls: [
          {
            name: 'propose_draft_update',
            arguments: {
              type: 'addItem',
              menuItemRef: 'Masala Dosa',
              quantity: 1,
              optionRefs: ['opt-seasonal'],
            },
          },
        ],
      }),
    );

    const result = await service.handleTurn(turn);

    expect(result.draftActions).toEqual([]);
    expect(result.violations[0]?.kind).toBe('invalid_draft_action');
  });

  it('treats an ambiguous name as a clarification, not a guess', async () => {
    const service = conversation(
      modelReply({
        toolCalls: [
          {
            name: 'propose_draft_update',
            arguments: { type: 'addItem', menuItemRef: 'coffee', quantity: 1 },
          },
        ],
      }),
    );

    const result = await service.handleTurn(turn);

    expect(result.draftActions).toEqual([]);
    expect(result.violations[0]?.kind).toBe('ambiguous_menu_item');
  });

  it('returns menu search results to the model with real IDs and prices', async () => {
    const menuService = createMenuService(createInMemoryMenuRepository(SAMPLE_MENU));
    const provider = createFakeProvider([
      modelReply({
        toolCalls: [{ name: 'menu_search', arguments: { query: 'coffee' } }],
      }),
      modelReply({ reply: 'We have Filter Coffee and Cold Coffee.' }),
    ]);
    const service = createConversationService({
      provider,
      menu: createMenuLookup(menuService),
      log: () => {},
    });

    const result = await service.handleTurn({
      ...turn,
      text: 'what coffee do you have',
    });

    const messages = provider.calls[1]?.messages ?? [];
    const toolResult = messages[messages.length - 1]?.content ?? '';
    expect(toolResult).toContain('item-filter-coffee');
    expect(toolResult).toContain('3000');
    expect(result.toolRequests[0]).toEqual({
      name: 'menu_search',
      accepted: true,
      resultCount: 2,
    });
  });
});
