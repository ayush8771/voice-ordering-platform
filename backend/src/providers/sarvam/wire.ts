/**
 * Sarvam `POST /v1/chat/completions` wire shapes and response parsing.
 *
 * CONTRACT STATUS (docs/PROVIDERS.md): the endpoint, base URL, auth header and
 * model name are confirmed by one successful manual request and by official
 * documentation, which also records `prompt_tokens`, `completion_tokens` and
 * `total_tokens` on a non-streaming response. The full body schema is still not
 * pinned field by field, so parsing stays narrow: it requires only the fields
 * needed to produce assistant text, treats `usage` and `finish_reason` as
 * optional, and ignores every unknown field - including the documented
 * streaming, tool-call and structured-output fields this milestone does not
 * use - instead of guessing at its meaning (docs/CODE_STYLE.md section 6).
 *
 * These types stay inside the adapter and never reach domain models
 * (docs/ARCHITECTURE.md section 5).
 */

import { ProviderError, type TokenUsage } from '../llm/types.js';

/** Request body. Only `model` and `messages` are verified fields. */
export interface SarvamChatRequestBody {
  readonly model: string;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  /**
   * Standard OpenAI-compatible sampling fields. Sent only when a caller
   * supplies them, because Sarvam's acceptance of them is unverified here.
   */
  readonly temperature?: number;
  readonly max_tokens?: number;
}

/** Normalized text + usage extracted from a response body. */
export interface SarvamParsedResponse {
  readonly text: string;
  readonly finishReason: string | undefined;
  readonly usage: TokenUsage | undefined;
  readonly model: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readUsage(raw: unknown): TokenUsage | undefined {
  if (!isRecord(raw)) return undefined;

  const prompt = raw['prompt_tokens'];
  const completion = raw['completion_tokens'];
  const total = raw['total_tokens'];

  // Partial or non-numeric usage is reported as absent rather than as zeros,
  // so a caller cannot mistake "unknown" for "no tokens consumed".
  if (
    typeof prompt !== 'number' ||
    typeof completion !== 'number' ||
    !Number.isFinite(prompt) ||
    !Number.isFinite(completion)
  ) {
    return undefined;
  }

  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens:
      typeof total === 'number' && Number.isFinite(total) ? total : prompt + completion,
  };
}

/**
 * Parses a response body that has already been JSON-decoded.
 *
 * Throws a `provider_bad_response` ProviderError when the assistant text
 * cannot be located, so a malformed body never surfaces as an empty but
 * apparently successful completion.
 */
export function parseSarvamChatResponse(
  body: unknown,
  providerId: string,
): SarvamParsedResponse {
  if (!isRecord(body)) {
    throw new ProviderError(
      'provider_bad_response',
      providerId,
      'Sarvam response was not a JSON object',
    );
  }

  const choices = body['choices'];
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ProviderError(
      'provider_bad_response',
      providerId,
      'Sarvam response contained no choices',
    );
  }

  const [choice] = choices;
  if (!isRecord(choice) || !isRecord(choice['message'])) {
    throw new ProviderError(
      'provider_bad_response',
      providerId,
      'Sarvam response choice contained no message',
    );
  }

  const content = choice['message']['content'];
  if (typeof content !== 'string') {
    throw new ProviderError(
      'provider_bad_response',
      providerId,
      'Sarvam response message content was not a string',
    );
  }

  const finishReason = choice['finish_reason'];
  const model = body['model'];

  return {
    text: content,
    finishReason: typeof finishReason === 'string' ? finishReason : undefined,
    usage: readUsage(body['usage']),
    model: typeof model === 'string' && model !== '' ? model : undefined,
  };
}
