# Provider Configuration and Verification

**Status:** The Sarvam conversational LLM adapter is implemented (see [As implemented](#as-implemented-sarvam-llm-adapter)); the Gnani speech providers remain planning only. No live provider call has been made from this repository and no credential is committed. Provider details below are limited to what official documentation states plus one manual request; current account access and balances are not observable here.

## Provider roles

| Capability | Planned provider | Responsibility |
|---|---|---|
| Conversational LLM | Sarvam AI Sarvam 105B Conversations (`sarvam-105b-conversations`) | Shared QR/kiosk dialogue and draft-intent suggestions |
| Speech to text | Gnani Prisma STT | Transcribe customer speech; exact API and support remain unverified |
| Text to speech | Gnani Timbre TTS | Speak assistant responses; exact API and support remain unverified |

The providers are independent. A provider-specific failure must not block touch ordering. The public/client app never receives any provider credential.

**Client-side speech boundary (declarations only).** `frontend/src/audio/types.ts` declares `AudioCapture`, `SpeechToTextClient` and `TextToSpeechClient`: the browser owns microphone permission and capture, and Prisma/Timbre are reached only through backend routes, so no key can reach a bundle. Those routes do not exist and the Gnani schemas are unverified, so the interfaces invent no provider field, audio format or error shape, nothing implements them, and no client call is made. The customer surface therefore ships touch-and-type, and an absent speech client renders as "voice input is not available in this build".

## Sarvam 105B Conversations facts verified from official documentation

Everything in this section is **verified**. Anything not listed here is **unverified** and must not be assumed by code: see [Unverified and deferred](#unverified-and-deferred-sarvam-behaviour).

Verified against Sarvam's official Model APIs docs on **2026-11-08**. One manual request on the same date additionally confirmed the endpoint, the `api-subscription-key` header and the model ID against the live service:

- Display name: **Sarvam 105B Conversations**; API model ID: `sarvam-105b-conversations`.
- Intended for conversational, customer-facing, multi-turn, and voice-agent workloads. It is text input to text output; speech recognition/synthesis remain separate.
- Context window: 32K tokens.
- Endpoint: `POST https://api.sarvam.ai/v1/chat/completions`. Sarvam documents the conversational variant on V1 only.
- Format: OpenAI-compatible chat completion request with `model` and `messages`.
- Authentication: official `api-subscription-key` header; `Authorization: Bearer <key>` is also accepted. Prefer the documented API subscription header.
- Streaming: supported, using server-sent events; streaming responses can provide a final usage chunk.
- Function/tool calling: documented with `tools` and `tool_choice`; application executes calls after checking them. Structured output: `response_format` supports JSON Schema and strict mode. These formats do not make model output authoritative or remove backend validation.
- Usage: non-streaming response documents `prompt_tokens`, `completion_tokens`, and `total_tokens`. Do not assume cached-token breakdown is returned by this endpoint or that this API response exposes account credit balance.
- Languages: Sarvam documents 11-language model support: Hindi, Bengali, Kannada, Malayalam, Tamil, Marathi, Telugu, Punjabi, Gujarati, Odia, and English. It also describes native-script, romanized, and code-mixed input. Hinglish support is therefore a documented capability direction, not a guarantee of accurate menu recognition or responses; evaluate using project data and consented test examples.
- Published token pricing: ₹15 per 1M input tokens, ₹5 per 1M eligible cached input tokens, and ₹60 per 1M output tokens, excluding GST. Reasoning tokens, where applicable, are billed at output rates. Pricing may change; recheck before testing and release.
- Signup credit policy: Sarvam states ₹100 free credits for each verified user; credits are universal and do not expire according to its pricing page. This does not establish that Ayush has been verified or granted credits.
- Exhausted balance: Sarvam documents HTTP 402 (`insufficient_quota_error`); retrying does not resolve it. Treat it as unavailable service and preserve touch ordering.
- Published Pay-as-you-go rate limit for the model: 60 requests/minute. Actual plan/account limits must be checked in the dashboard and rate-limit documentation.

Official sources:

- [Sarvam 105B model and conversational variant](https://docs.sarvam.ai/api/token-factory/models/sarvam-105b)
- [Chat Completion API: V1 endpoint, streaming, tools, structured output, usage](https://docs.sarvam.ai/api/token-factory/chat-completions)
- [Chat Completion V1 API reference](https://docs.sarvam.ai/api-reference/chat/chat-completions-v1)
- [Authentication and API-key handling](https://docs.sarvam.ai/api-reference/authentication)
- [Models and language coverage](https://docs.sarvam.ai/api/getting-started/models)
- [Pricing, credits, and rate limits](https://docs.sarvam.ai/api/getting-started/pricing)

## Unverified and deferred Sarvam behaviour

Documented by Sarvam but **not exercised by this repository**, so no code depends on it: streaming (SSE) framing and the final usage chunk, `tools`/`tool_choice` tool calling, `response_format` structured output, cached-token usage breakdown, and any field of the response body beyond those named above.

**Not documented anywhere and therefore assumed, not verified:** the sampling field names `temperature` and `max_tokens`. They are OpenAI-compatible conventions; the adapter sends them only when a caller explicitly supplies a value, so a default request carries `model` and `messages` only. Confirm them against the API reference before relying on them.

Also unverified: observed latency, the account's real rate limit, and the error response body schema. The adapter therefore classifies failures by HTTP status alone and never parses an error body.

## As implemented: Sarvam LLM adapter

Milestone 2 implemented the provider adapter only. No conversation service, prompt, tool allowlist, menu/cart logic or route calls it yet.

```
backend/src/providers/llm/types.ts      provider-neutral contract (no vendor names)
backend/src/providers/sarvam/config.ts  env loading and validation
backend/src/providers/sarvam/wire.ts    Sarvam request body types and response parsing
backend/src/providers/sarvam/provider.ts HTTP call, timeout, error classification
backend/src/providers/sarvam/index.ts   public surface
```

Domain services depend on `ConversationProvider` from `providers/llm/types.ts` and receive `{ text, finishReason, usage, model, providerId }`. Sarvam header, route, model ID, body field names and status mapping exist only under `providers/sarvam/`, so replacing the provider does not touch business services or UI contracts.

### Implemented environment variables

Server-side only, read by `loadSarvamConfig`. Placeholders are in `backend/.env.example` and the root `.env.example`.

| Variable | Status | Value/purpose |
|---|---|---|
| `SARVAM_API_KEY` | implemented, required | Secret key. Startup fails fast when it is missing. Never logged, and the config object's `toJSON` redacts it so serializing config cannot leak it |
| `SARVAM_BASE_URL` | implemented, default `https://api.sarvam.ai` | Must be an absolute http(s) URL; a trailing slash is trimmed |
| `SARVAM_MODEL` | implemented, default `sarvam-105b-conversations` | Model ID |
| `SARVAM_TIMEOUT_MS` | implemented, default `15000` | Per-request timeout, integer 1000-120000. Supersedes the earlier proposed name `SARVAM_REQUEST_TIMEOUT_MS`; the default is provisional until latency is measured |

Deliberately **not** adapter variables: the chat path `/v1/chat/completions` is a verified constant inside the adapter rather than configuration, so it cannot be misconfigured. `CONVERSATION_PROVIDER` is unnecessary while one adapter exists and belongs with provider selection in the conversation service.

Budget enforcement sits in the conversation service rather than the adapter, which owns transport only. Those variables are:

| Variable | Status | Value/purpose |
|---|---|---|
| `LLM_MAX_OUTPUT_TOKENS` | implemented, default `400` | Output cap passed to the provider on every call (32-4000) |
| `CONVERSATION_MAX_INPUT_CHARS` | implemented, default `600` | Longest accepted utterance. Bounded in characters, not tokens: measuring tokens would need a tokenizer dependency, so `LLM_MAX_INPUT_TOKENS` was not adopted |
| `CONVERSATION_HISTORY_TURNS` | implemented, default `8` | Prior exchanges replayed to the model |
| `CONVERSATION_MAX_TOOL_ROUNDS` | implemented, default `2` | Menu-lookup round trips allowed per turn |
| `CONVERSATION_SESSION_TTL_MS` | implemented, default `1800000` | Idle lifetime of in-memory conversation state |
| `CONVERSATION_MAX_SESSIONS` | implemented, default `500` | Cap on tracked sessions; a full store refuses new sessions rather than evicting live ones |
| `LLM_TEST_BUDGET_INR` | still a proposal | Spend ceiling would have to be estimated from measured usage; no cost accounting exists yet |

### Implemented failure mapping

| HTTP / condition | Code | Retryable |
|---|---|---|
| 400, 404, 422 | `provider_invalid_request` | no |
| 401, 403 | `provider_unauthorized` | no |
| 402 `insufficient_quota_error` | `provider_quota_exhausted` | no |
| 429 | `provider_rate_limited` | yes |
| 408, 504, timeout or caller abort | `provider_timeout` | yes |
| other 5xx, network failure | `provider_unavailable` | yes |
| non-JSON or unparseable body | `provider_bad_response` | no |

The adapter itself performs no retries and writes no logs: it throws a `ProviderError` carrying the code, HTTP status and a bounded (300 character) diagnostic with the API key scrubbed. Recording provider, model, latency, status class and token usage is the caller's responsibility, which keeps every log site outside the module holding the key.

Only the provider adapter may know Sarvam headers, route, model ID, request fields, stream framing, and response/error shape. It maps to the shared provider-neutral conversation contract in [API.md](API.md#shared-conversational-service-contract-provisional-provider-neutral). Domain services receive normalized assistant text and proposed draft actions, never raw Sarvam payloads.

Use no live Sarvam requests while this change is documentation-only. Before a later authorized test, Ayush should verify the dashboard balance and account verification status, create a key, store it in a local ignored secret store, confirm the current price/rate limit, and set a total test ceiling of ₹100. Stop testing when the confirmed credit balance is exhausted or the ₹100 test allocation is reached. Do not configure auto top-up or paid fallback without a separate decision. The provider's displayed balance and the application's estimated spend can differ; check the dashboard after each small test batch.

## Test and failure behavior

- Unit and integration tests use a fake provider adapter or an injected fake HTTP client. They never call Sarvam or consume credits. The adapter suite replaces the global `fetch` with a spy that fails the test if anything attempts a live request.
- Handle authentication/authorization errors, malformed responses, timeouts, rate limiting, server errors, and HTTP 402 as provider errors mapped to safe user-facing behavior. Use bounded retries only for transient failures; do not retry invalid input or 402.
- On failure, retain the draft and allow touch-only completion through the ordinary backend quote, explicit review, order creation, payment, and token steps.
- Record provider name, model, latency, status/error class, and token usage when available using redacted identifiers. Never log API keys, raw audio, full transcripts, or unnecessary personal data.
- Benchmark Kannada, English, Devanagari Hindi and Latin-script Hinglish restaurant requests, code-switching, noisy/ambiguous STT results, menu aliases, unavailable items, allergies, and corrections. The backend must validate items/options and answer product facts from the current menu rather than model memory.

## Open decisions

- Ayush's verified Sarvam dashboard account, available balance, key creation, and actual account rate limit.
- Whether to allow any spend beyond confirmed introductory credits; default is no auto top-up and no paid fallback.
- Measured prompt/input/output budgets, cost per completed order, acceptable latency, retry/time-out limits, and retention terms.
- Confirmation of `temperature` / `max_tokens` field names and of the error response schema against the API reference.
- Gnani Prisma/Timbre API schemas, account access, supported languages, limits, pricing, retention, and error behavior.
