/**
 * Sarvam AI conversational LLM adapter.
 *
 * Verified facts (one successful manual request, plus official documentation
 * recorded in docs/PROVIDERS.md): provider Sarvam AI, model
 * `sarvam-105b-conversations`, base URL `https://api.sarvam.ai`, endpoint
 * `POST /v1/chat/completions`, auth header `api-subscription-key`.
 *
 * Scope: a single stateless, non-streaming completion call. Streaming (SSE),
 * tool calling, structured output, conversation management, recommendation
 * policy and every ordering rule are documented but deliberately NOT here. The
 * backend remains authoritative for menu, prices, cart, orders and payment,
 * and model output is untrusted (docs/SECURITY.md section 2).
 *
 * The adapter never logs. Diagnostics are attached to a thrown ProviderError
 * after redaction, so the API key cannot reach a log sink from here
 * (docs/SECURITY.md sections 3 and 5).
 */

import {
  ProviderError,
  type ChatCompletionOptions,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type ConversationProvider,
  type FetchLike,
} from '../llm/types.js';
import type { SarvamConfig } from './config.js';
import { parseSarvamChatResponse, type SarvamChatRequestBody } from './wire.js';

/** Stable identifier for logs and metrics. */
export const SARVAM_PROVIDER_ID = 'sarvam';

const CHAT_COMPLETIONS_PATH = '/v1/chat/completions';
const AUTH_HEADER = 'api-subscription-key';
const MAX_DETAIL_LENGTH = 300;

export interface SarvamProviderDeps {
  readonly config: SarvamConfig;
  /** Injected for tests; mocked responses consume zero live API credits. */
  readonly fetch?: FetchLike;
}

/** Removes the API key from any text before it can be stored or logged. */
export function redactSecret(text: string, secret: string): string {
  if (secret === '') return text;
  return text.split(secret).join('[REDACTED]');
}

function boundedDetail(text: string, secret: string): string | undefined {
  const redacted = redactSecret(text, secret).trim();
  if (redacted === '') return undefined;
  return redacted.length > MAX_DETAIL_LENGTH
    ? `${redacted.slice(0, MAX_DETAIL_LENGTH)}...`
    : redacted;
}

/**
 * Maps an HTTP status to a provider error code.
 *
 * 402 is Sarvam's documented exhausted-credit response
 * (`insufficient_quota_error`); it is classified as non-retryable so no caller
 * burns attempts on it, and the touch path stays the fallback
 * (docs/PROVIDERS.md, docs/SECURITY.md section 2).
 */
function classify(status: number): ProviderError['code'] {
  if (status === 400 || status === 404 || status === 422)
    return 'provider_invalid_request';
  if (status === 401 || status === 403) return 'provider_unauthorized';
  if (status === 402) return 'provider_quota_exhausted';
  if (status === 429) return 'provider_rate_limited';
  if (status === 408 || status === 504) return 'provider_timeout';
  return 'provider_unavailable';
}

function buildBody(
  config: SarvamConfig,
  request: ChatCompletionRequest,
): SarvamChatRequestBody {
  return {
    model: config.model,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    // Sent only when a caller asks for them: docs/PROVIDERS.md records
    // `model` and `messages` as the verified request fields, so the sampling
    // field names stay OpenAI-compatible assumptions rather than defaults.
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxOutputTokens === undefined
      ? {}
      : { max_tokens: request.maxOutputTokens }),
  };
}

/**
 * Combines the configured timeout with an optional caller signal so a caller
 * abort and a timeout both cancel the in-flight request.
 */
function buildSignal(timeoutMs: number, caller: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return caller === undefined ? timeout : AbortSignal.any([timeout, caller]);
}

/** Creates a Sarvam-backed implementation of the provider-neutral interface. */
export function createSarvamProvider(deps: SarvamProviderDeps): ConversationProvider {
  const { config } = deps;
  const doFetch: FetchLike =
    deps.fetch ??
    (globalThis.fetch as unknown as FetchLike | undefined) ??
    (() => {
      throw new ProviderError(
        'provider_unavailable',
        SARVAM_PROVIDER_ID,
        'No fetch implementation is available in this runtime',
      );
    });

  return {
    id: SARVAM_PROVIDER_ID,
    model: config.model,

    async createChatCompletion(
      request: ChatCompletionRequest,
      options: ChatCompletionOptions = {},
    ): Promise<ChatCompletionResult> {
      if (request.messages.length === 0) {
        throw new ProviderError(
          'provider_invalid_request',
          SARVAM_PROVIDER_ID,
          'A chat completion requires at least one message',
        );
      }

      let response;
      try {
        response = await doFetch(`${config.baseUrl}${CHAT_COMPLETIONS_PATH}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            [AUTH_HEADER]: config.apiKey,
          },
          body: JSON.stringify(buildBody(config, request)),
          signal: buildSignal(config.timeoutMs, options.signal),
        });
      } catch (error) {
        if (error instanceof ProviderError) throw error;

        const name = error instanceof Error ? error.name : '';
        if (name === 'TimeoutError' || name === 'AbortError') {
          throw new ProviderError(
            'provider_timeout',
            SARVAM_PROVIDER_ID,
            `Sarvam request aborted after ${config.timeoutMs}ms`,
            { cause: error },
          );
        }
        throw new ProviderError(
          'provider_unavailable',
          SARVAM_PROVIDER_ID,
          'Sarvam request failed before a response was received',
          { cause: error },
        );
      }

      const raw = await response.text();

      if (!response.ok) {
        const detail = boundedDetail(raw, config.apiKey);
        throw new ProviderError(
          classify(response.status),
          SARVAM_PROVIDER_ID,
          `Sarvam returned HTTP ${response.status}`,
          detail === undefined
            ? { status: response.status }
            : { status: response.status, detail },
        );
      }

      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch (error) {
        throw new ProviderError(
          'provider_bad_response',
          SARVAM_PROVIDER_ID,
          'Sarvam response body was not valid JSON',
          { status: response.status, cause: error },
        );
      }

      const parsed = parseSarvamChatResponse(body, SARVAM_PROVIDER_ID);

      return {
        text: parsed.text,
        finishReason: parsed.finishReason,
        usage: parsed.usage,
        model: parsed.model ?? config.model,
        providerId: SARVAM_PROVIDER_ID,
      };
    },
  };
}
