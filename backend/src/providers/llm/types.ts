/**
 * Provider-neutral conversational LLM contract.
 *
 * Deliberately free of vendor names, wire shapes and ordering domain types:
 * the adapter under `providers/sarvam/` is replaceable behind this interface
 * (docs/ARCHITECTURE.md section 5, docs/CODE_STYLE.md section 2).
 *
 * Nothing here is authoritative for the product. Model output is untrusted
 * input that may populate a draft only (docs/SECURITY.md section 2).
 */

/** Roles accepted on an outgoing turn. Tool/function roles are out of scope. */
export const CHAT_ROLES = ['system', 'user', 'assistant'] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

/** One turn sent to the provider. */
export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

/**
 * A single completion request.
 *
 * Sampling fields are optional because the provider default is used unless a
 * caller has a reason to override it.
 */
export interface ChatCompletionRequest {
  readonly messages: readonly ChatMessage[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

/** Per-call overrides. A caller signal is combined with the adapter timeout. */
export interface ChatCompletionOptions {
  readonly signal?: AbortSignal;
}

/** Token accounting, when the provider reports it. */
export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/** Normalized successful result. */
export interface ChatCompletionResult {
  /** Assistant text. May be an empty string if the provider returned none. */
  readonly text: string;
  /** Provider-reported stop reason, passed through verbatim when present. */
  readonly finishReason: string | undefined;
  /** Absent when the provider omitted usage from the response. */
  readonly usage: TokenUsage | undefined;
  /** Model identifier the provider reported, else the configured model. */
  readonly model: string;
  /** Stable adapter identifier, for logging and metrics. */
  readonly providerId: string;
}

/** Replaceable conversational provider. */
export interface ConversationProvider {
  readonly id: string;
  readonly model: string;
  createChatCompletion(
    request: ChatCompletionRequest,
    options?: ChatCompletionOptions,
  ): Promise<ChatCompletionResult>;
}

/** Classified, client-safe provider failure codes. */
export const PROVIDER_ERROR_CODES = [
  'provider_invalid_request',
  'provider_unauthorized',
  'provider_quota_exhausted',
  'provider_rate_limited',
  'provider_timeout',
  'provider_unavailable',
  'provider_bad_response',
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

/**
 * Retry classification. `provider_quota_exhausted` is deliberately absent:
 * an exhausted balance is not transient and retrying does not clear it
 * (docs/PROVIDERS.md, docs/SECURITY.md section 2).
 */
const RETRYABLE: ReadonlySet<ProviderErrorCode> = new Set([
  'provider_rate_limited',
  'provider_timeout',
  'provider_unavailable',
]);

/**
 * Error raised by any provider adapter.
 *
 * `message` and `detail` must never carry credentials, so adapters redact
 * before constructing one (docs/SECURITY.md section 3). The HTTP layer maps
 * this to the documented error envelope; it is not returned to a client as-is.
 */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly providerId: string;
  readonly retryable: boolean;
  /** Optional bounded, redacted diagnostic kept for server-side logs. */
  readonly detail?: string;
  readonly status?: number;

  constructor(
    code: ProviderErrorCode,
    providerId: string,
    message: string,
    extra: {
      readonly status?: number;
      readonly detail?: string;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, extra.cause === undefined ? undefined : { cause: extra.cause });
    this.name = 'ProviderError';
    this.code = code;
    this.providerId = providerId;
    this.retryable = RETRYABLE.has(code);
    if (extra.status !== undefined) this.status = extra.status;
    if (extra.detail !== undefined) this.detail = extra.detail;
  }
}

/** Minimal HTTP response surface an adapter needs. */
export interface HttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

/** Minimal HTTP request surface, so adapters are testable without a network. */
export type FetchLike = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal: AbortSignal;
  },
) => Promise<HttpResponseLike>;
