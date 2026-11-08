import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_TOOLS,
  FORBIDDEN_TOOL_NAMES,
  MAX_QUANTITY,
  MAX_SEARCH_RESULTS,
  validateToolCall,
} from './tools.js';

describe('tool allowlist', () => {
  it('exposes only menu lookups and a draft proposal', () => {
    expect([...CONVERSATION_TOOLS]).toEqual([
      'menu_search',
      'menu_item_details',
      'propose_draft_update',
    ]);
  });

  it.each(FORBIDDEN_TOOL_NAMES)('refuses the forbidden tool %s', (name) => {
    const result = validateToolCall({ name, arguments: { orderId: 'o1' } });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('forbidden_tool');
    }
  });

  it('refuses an unknown tool name', () => {
    const result = validateToolCall({ name: 'read_customer_cards', arguments: {} });
    expect(result).toMatchObject({ ok: false, kind: 'unknown_tool' });
  });

  it('refuses a non-object call', () => {
    expect(validateToolCall('create_order')).toMatchObject({
      ok: false,
      kind: 'invalid_tool_arguments',
    });
  });
});

describe('menu_search arguments', () => {
  it('accepts a query and caps the limit', () => {
    const result = validateToolCall({
      name: 'menu_search',
      arguments: { query: ' dosa ', limit: 99 },
    });

    expect(result).toEqual({
      ok: true,
      call: { name: 'menu_search', query: 'dosa', limit: MAX_SEARCH_RESULTS },
    });
  });

  it('defaults the limit when it is missing or nonsense', () => {
    for (const limit of [undefined, 0, -3, 2.5, 'many']) {
      const result = validateToolCall({
        name: 'menu_search',
        arguments: { query: 'x', limit },
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.call.name === 'menu_search') {
        expect(result.call.limit).toBe(MAX_SEARCH_RESULTS);
      }
    }
  });

  it('rejects a missing, empty or overlong query', () => {
    for (const query of [undefined, '', '   ', 'x'.repeat(200)]) {
      expect(
        validateToolCall({ name: 'menu_search', arguments: { query } }),
      ).toMatchObject({
        ok: false,
        kind: 'invalid_tool_arguments',
      });
    }
  });
});

describe('propose_draft_update arguments', () => {
  it('accepts an addItem proposal with options', () => {
    const result = validateToolCall({
      name: 'propose_draft_update',
      arguments: {
        type: 'addItem',
        menuItemRef: 'Masala Dosa',
        quantity: 2,
        optionRefs: ['opt_extra_chutney'],
      },
    });

    expect(result).toEqual({
      ok: true,
      call: {
        name: 'propose_draft_update',
        type: 'addItem',
        menuItemRef: 'Masala Dosa',
        quantity: 2,
        optionRefs: ['opt_extra_chutney'],
      },
    });
  });

  it('accepts clearDraft without an item reference', () => {
    expect(
      validateToolCall({
        name: 'propose_draft_update',
        arguments: { type: 'clearDraft' },
      }),
    ).toEqual({ ok: true, call: { name: 'propose_draft_update', type: 'clearDraft' } });
  });

  it('rejects an unknown action type', () => {
    expect(
      validateToolCall({
        name: 'propose_draft_update',
        arguments: { type: 'applyDiscount', menuItemRef: 'Idli', quantity: 1 },
      }),
    ).toMatchObject({ ok: false, kind: 'invalid_tool_arguments' });
  });

  it.each([0, -1, 1.5, MAX_QUANTITY + 1, '2', undefined])(
    'rejects quantity %p',
    (quantity) => {
      expect(
        validateToolCall({
          name: 'propose_draft_update',
          arguments: { type: 'addItem', menuItemRef: 'Idli', quantity },
        }),
      ).toMatchObject({ ok: false, kind: 'invalid_tool_arguments' });
    },
  );

  it('rejects an overlong option list or non-string option', () => {
    expect(
      validateToolCall({
        name: 'propose_draft_update',
        arguments: {
          type: 'addItem',
          menuItemRef: 'Idli',
          quantity: 1,
          optionRefs: Array.from({ length: 20 }, (_, i) => `opt_${i}`),
        },
      }),
    ).toMatchObject({ ok: false, kind: 'invalid_tool_arguments' });

    expect(
      validateToolCall({
        name: 'propose_draft_update',
        arguments: {
          type: 'addItem',
          menuItemRef: 'Idli',
          quantity: 1,
          optionRefs: [7],
        },
      }),
    ).toMatchObject({ ok: false, kind: 'invalid_tool_arguments' });
  });

  it('carries no price field through validation', () => {
    const result = validateToolCall({
      name: 'propose_draft_update',
      arguments: { type: 'addItem', menuItemRef: 'Idli', quantity: 1, priceMinor: 1 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.stringify(result.call)).not.toContain('price');
    }
  });
});
