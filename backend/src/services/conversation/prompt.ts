/**
 * Prompt construction.
 *
 * Provider-neutral: this produces `ChatMessage[]` for the internal provider
 * interface, with no Sarvam field names (docs/ARCHITECTURE.md section 5).
 *
 * The prompt states the rules the model is expected to follow, but every rule
 * that matters is also enforced in code after the response arrives
 * (docs/SECURITY.md section 2). A prompt is guidance; the service is the
 * control.
 *
 * Structured replies are requested as a JSON object in the message text rather
 * than through the provider's documented `response_format`, because structured
 * output is not implemented in the adapter and its behaviour is unverified
 * (docs/PROVIDERS.md). The parser therefore tolerates unstructured replies.
 */

import type { Language } from '@vop/shared';
import type { ChatMessage } from '../../providers/llm/types.js';
import { TOOL_SPECIFICATIONS } from './tools.js';
import type { ConversationRequest, DraftSummary } from './types.js';

const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  kn: 'Kannada',
  hi: 'Hindi',
};

/** Marker used to hand tool results back as text. See `buildToolResultMessage`. */
export const TOOL_RESULT_PREFIX = 'TOOL_RESULT';

function describeDraft(draft: DraftSummary | undefined): string {
  if (draft === undefined || draft.items.length === 0) return 'The draft is empty.';

  const lines = draft.items.map((item) => {
    const options =
      item.optionIds === undefined || item.optionIds.length === 0
        ? ''
        : ` options=${item.optionIds.join(',')}`;
    return `- ${item.quantity} x ${item.name} (id=${item.menuItemId})${options}`;
  });
  return `Current draft:\n${lines.join('\n')}`;
}

export interface PromptContext {
  readonly request: ConversationRequest;
  readonly proactiveRecommendationAllowed: boolean;
}

export function buildSystemPrompt(context: PromptContext): string {
  const { request, proactiveRecommendationAllowed } = context;
  const language = LANGUAGE_LABELS[request.language];

  const recommendationRule = proactiveRecommendationAllowed
    ? 'You may offer at most one unsolicited item suggestion on this turn. If the customer asks for a recommendation, always answer.'
    : 'Do NOT offer any unsolicited suggestion on this turn. Answer a recommendation only if the customer explicitly asks for one.';

  return [
    `You take food orders for one outlet at a ${request.channel === 'kiosk' ? 'self-service kiosk' : 'mobile web page opened from a table QR code'}.`,
    `Reply in ${language}. Mirror the customer's script and code-mixing where natural. Keep replies under 40 words and speakable.`,
    '',
    'Rules you must follow:',
    '- You cannot create, confirm or cancel an order, take payment, mark anything paid, change prices, or change item availability. Never say or imply that you have done any of these.',
    '- You only ever propose changes to a draft. The customer reviews and confirms the order themselves on screen.',
    '- Never invent menu items, options or prices. Use menu_search or menu_item_details, and only talk about items those tools returned.',
    '- If a request is unclear, ambiguous or not on the menu, ask one short clarifying question instead of guessing.',
    `- ${recommendationRule}`,
    '',
    'Available tools:',
    ...TOOL_SPECIFICATIONS.map((spec) => `- ${spec}`),
    '',
    'Respond with one JSON object and nothing else:',
    '{"reply": string, "toolCalls": [{"name": string, "arguments": object}], "suggestions": [{"menuItemRef": string, "kind": "requested"|"proactive"}], "needsClarification": boolean}',
    'Omit or use an empty array for anything you do not need. Put the words the customer should hear in "reply".',
    `Context: phase=${request.phase}; menuVersion=${request.menuVersion ?? 'unknown'}.`,
    describeDraft(request.draftSummary),
  ].join('\n');
}

/** Builds the message list for one provider call. */
export function buildMessages(
  context: PromptContext,
  history: readonly ChatMessage[],
  toolResults: readonly ChatMessage[],
): ChatMessage[] {
  return [
    { role: 'system', content: buildSystemPrompt(context) },
    ...history,
    { role: 'user', content: context.request.text },
    ...toolResults,
  ];
}

/**
 * Formats executed tool output as a message.
 *
 * The provider interface carries system/user/assistant roles only - provider
 * tool-call framing is documented but unverified and unimplemented
 * (docs/PROVIDERS.md) - so results ride back as a clearly delimited user
 * message. The content is backend menu data, never customer or model text.
 */
export function buildToolResultMessage(name: string, payload: unknown): ChatMessage {
  return {
    role: 'user',
    content: `${TOOL_RESULT_PREFIX} ${name}: ${JSON.stringify(payload)}`,
  };
}
