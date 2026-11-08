/**
 * Test doubles for the conversation service.
 *
 * Exported from `src` rather than a test file so every suite builds the same
 * fakes. Nothing here performs I/O: the fake provider never touches the
 * network, so conversation tests consume no Sarvam credits
 * (docs/TESTING.md section 2, docs/PROVIDERS.md).
 */

import {
  ProviderError,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type ConversationProvider,
  type TokenUsage,
} from '../../providers/llm/types.js';
import type { MenuItemSummary, MenuLookupPort } from './menuPort.js';

export interface FakeProvider extends ConversationProvider {
  /** Every request the service made, in order. */
  readonly calls: ChatCompletionRequest[];
}

const DEFAULT_USAGE: TokenUsage = {
  promptTokens: 10,
  completionTokens: 5,
  totalTokens: 15,
};

/**
 * Replies in order. A `ProviderError` entry is thrown instead of returned, and
 * the last entry repeats if the service asks for more turns.
 */
export function createFakeProvider(
  replies: readonly (string | ProviderError)[],
  usage: TokenUsage | undefined = DEFAULT_USAGE,
): FakeProvider {
  const calls: ChatCompletionRequest[] = [];
  let index = 0;

  return {
    id: 'fake',
    model: 'fake-model',
    calls,
    createChatCompletion(
      request: ChatCompletionRequest,
    ): Promise<ChatCompletionResult> {
      calls.push(request);
      const reply = replies[Math.min(index, replies.length - 1)];
      index += 1;

      if (reply instanceof ProviderError) return Promise.reject(reply);

      return Promise.resolve({
        text: reply ?? '',
        finishReason: 'stop',
        usage,
        model: 'fake-model',
        providerId: 'fake',
      });
    },
  };
}

/** Convenience builder for the JSON envelope the prompt asks the model for. */
export function modelReply(body: {
  reply?: string;
  toolCalls?: unknown[];
  suggestions?: unknown[];
  needsClarification?: boolean;
}): string {
  return JSON.stringify({
    reply: body.reply ?? 'ok',
    toolCalls: body.toolCalls ?? [],
    suggestions: body.suggestions ?? [],
    needsClarification: body.needsClarification ?? false,
  });
}

export interface FakeMenu extends MenuLookupPort {
  readonly searches: { outletId: string; query: string }[];
}

/**
 * Substring search over a fixed item list, scoped by outlet.
 *
 * Read-only, like the port it implements: there is deliberately no way for a
 * test (or a tool call) to mutate menu state through it.
 */
export function createFakeMenu(
  itemsByOutlet: Readonly<Record<string, readonly MenuItemSummary[]>>,
): FakeMenu {
  const searches: { outletId: string; query: string }[] = [];

  return {
    searches,
    search(outletId, query, limit) {
      searches.push({ outletId, query });
      const needle = query.trim().toLowerCase();
      const items = (itemsByOutlet[outletId] ?? []).filter((item) =>
        item.name.toLowerCase().includes(needle),
      );
      return Promise.resolve(items.slice(0, limit));
    },
    getById(outletId, menuItemId) {
      const items = itemsByOutlet[outletId] ?? [];
      return Promise.resolve(items.find((item) => item.id === menuItemId));
    },
  };
}

/** The menu used across conversation tests. */
export const TEST_MENU: Readonly<Record<string, readonly MenuItemSummary[]>> = {
  outlet_1: [
    {
      id: 'item_dosa',
      name: 'Masala Dosa',
      available: true,
      priceMinor: 8000,
      optionIds: ['opt_extra_chutney'],
    },
    { id: 'item_idli', name: 'Idli', available: true, priceMinor: 4000 },
    { id: 'item_vada', name: 'Medu Vada', available: false, priceMinor: 4500 },
    {
      id: 'item_coffee_filter',
      name: 'Filter Coffee',
      available: true,
      priceMinor: 3000,
    },
    { id: 'item_coffee_cold', name: 'Cold Coffee', available: true, priceMinor: 6000 },
  ],
  outlet_2: [{ id: 'item_other', name: 'Poha', available: true, priceMinor: 3500 }],
};
