/**
 * Adapter tests.
 *
 * Every HTTP response is mocked through the injected `fetch`, and the global
 * fetch is replaced with a spy that fails the test if it is ever called, so the
 * suite cannot reach api.sarvam.ai or consume live API credits
 * (docs/TESTING.md section 2).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError, type FetchLike, type HttpResponseLike } from '../llm/types.js';
import { loadSarvamConfig, type SarvamConfig } from './config.js';
import { createSarvamProvider, redactSecret } from './provider.js';

const KEY = 'test-subscription-key';

type FetchInit = Parameters<FetchLike>[1];

function config(overrides: NodeJS.ProcessEnv = {}): SarvamConfig {
  return loadSarvamConfig({ SARVAM_API_KEY: KEY, ...overrides });
}

function httpResponse(status: number, body: string): HttpResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  };
}

const SUCCESS_BODY = JSON.stringify({
  id: 'chatcmpl-test',
  model: 'sarvam-105b-conversations',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Namaste! What would you like?' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 18, completion_tokens: 7, total_tokens: 25 },
});

function mockFetch(...responses: HttpResponseLike[]) {
  const fn = vi.fn<(url: string, init: FetchInit) => Promise<HttpResponseLike>>();
  for (const response of responses) fn.mockResolvedValueOnce(response);
  return fn;
}

let realFetch: typeof globalThis.fetch | undefined;

beforeEach(() => {
  realFetch = globalThis.fetch;
  // A live network call is a test failure, not a slow test.
  globalThis.fetch = vi.fn(() => {
    throw new Error('A test attempted a live HTTP request');
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  if (realFetch !== undefined) globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('createSarvamProvider request', () => {
  it('posts to the verified endpoint with the subscription-key header', async () => {
    const fetchMock = mockFetch(httpResponse(200, SUCCESS_BODY));
    const provider = createSarvamProvider({ config: config(), fetch: fetchMock });

    await provider.createChatCompletion({
      messages: [
        { role: 'system', content: 'You help customers order food.' },
        { role: 'user', content: 'one masala dosa' },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('https://api.sarvam.ai/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers['api-subscription-key']).toBe(KEY);
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.signal.aborted).toBe(false);

    expect(JSON.parse(init.body)).toEqual({
      model: 'sarvam-105b-conversations',
      messages: [
        { role: 'system', content: 'You help customers order food.' },
        { role: 'user', content: 'one masala dosa' },
      ],
    });
  });

  it('sends sampling fields only when the caller sets them', async () => {
    const fetchMock = mockFetch(httpResponse(200, SUCCESS_BODY));
    const provider = createSarvamProvider({ config: config(), fetch: fetchMock });

    await provider.createChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      maxOutputTokens: 256,
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body)).toMatchObject({ temperature: 0.2, max_tokens: 256 });
  });

  it('uses the configured model and base URL', async () => {
    const fetchMock = mockFetch(httpResponse(200, SUCCESS_BODY));
    const provider = createSarvamProvider({
      config: config({
        SARVAM_MODEL: 'some-other-model',
        SARVAM_BASE_URL: 'https://proxy.example.test',
      }),
      fetch: fetchMock,
    });

    await provider.createChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://proxy.example.test/v1/chat/completions');
    expect(JSON.parse(init.body).model).toBe('some-other-model');
  });

  it('rejects an empty message list without making a request', async () => {
    const fetchMock = mockFetch();
    const provider = createSarvamProvider({ config: config(), fetch: fetchMock });

    await expect(provider.createChatCompletion({ messages: [] })).rejects.toMatchObject(
      {
        code: 'provider_invalid_request',
      },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('createSarvamProvider response', () => {
  it('returns assistant text, finish reason and token usage', async () => {
    const provider = createSarvamProvider({
      config: config(),
      fetch: mockFetch(httpResponse(200, SUCCESS_BODY)),
    });

    const result = await provider.createChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result).toEqual({
      text: 'Namaste! What would you like?',
      finishReason: 'stop',
      usage: { promptTokens: 18, completionTokens: 7, totalTokens: 25 },
      model: 'sarvam-105b-conversations',
      providerId: 'sarvam',
    });
  });

  it('treats missing usage and finish reason as unknown, not as zero', async () => {
    const provider = createSarvamProvider({
      config: config(),
      fetch: mockFetch(
        httpResponse(
          200,
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'ok' } }],
          }),
        ),
      ),
    });

    const result = await provider.createChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.usage).toBeUndefined();
    expect(result.finishReason).toBeUndefined();
    // Falls back to the configured model when the body omits one.
    expect(result.model).toBe('sarvam-105b-conversations');
  });

  it('derives total tokens when only prompt and completion counts are present', async () => {
    const provider = createSarvamProvider({
      config: config(),
      fetch: mockFetch(
        httpResponse(
          200,
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'ok' } }],
            usage: { prompt_tokens: 4, completion_tokens: 6 },
          }),
        ),
      ),
    });

    const result = await provider.createChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.usage).toEqual({
      promptTokens: 4,
      completionTokens: 6,
      totalTokens: 10,
    });
  });

  it('preserves an empty assistant string rather than inventing content', async () => {
    const provider = createSarvamProvider({
      config: config(),
      fetch: mockFetch(
        httpResponse(
          200,
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: '' } }],
          }),
        ),
      ),
    });

    const result = await provider.createChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.text).toBe('');
  });

  it.each([
    ['not json at all'],
    [JSON.stringify({ choices: [] })],
    [JSON.stringify({ choices: [{}] })],
    [JSON.stringify({ choices: [{ message: { content: 42 } }] })],
    [JSON.stringify([1, 2, 3])],
  ])('rejects a malformed body (%#)', async (body) => {
    const provider = createSarvamProvider({
      config: config(),
      fetch: mockFetch(httpResponse(200, body)),
    });

    await expect(
      provider.createChatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'provider_bad_response', retryable: false });
  });
});

describe('createSarvamProvider failures', () => {
  it.each([
    [400, 'provider_invalid_request', false],
    [401, 'provider_unauthorized', false],
    [403, 'provider_unauthorized', false],
    // Documented exhausted-credit response; retrying cannot clear it.
    [402, 'provider_quota_exhausted', false],
    [429, 'provider_rate_limited', true],
    [500, 'provider_unavailable', true],
    [503, 'provider_unavailable', true],
    [504, 'provider_timeout', true],
  ])('maps HTTP %i to %s', async (status, code, retryable) => {
    const provider = createSarvamProvider({
      config: config(),
      fetch: mockFetch(
        httpResponse(status as number, JSON.stringify({ error: 'upstream detail' })),
      ),
    });

    const error = await provider
      .createChatCompletion({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code, retryable, status, providerId: 'sarvam' });
  });

  it('reports a network failure as retryable and unavailable', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const provider = createSarvamProvider({ config: config(), fetch: fetchMock });

    await expect(
      provider.createChatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'provider_unavailable', retryable: true });
  });

  it('aborts and reports a timeout once the configured budget elapses', async () => {
    // Waits on the signal the adapter supplies instead of resolving, which is
    // what a hung provider looks like.
    const fetchMock: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'TimeoutError';
          reject(error);
        });
      });

    const provider = createSarvamProvider({
      config: config({ SARVAM_TIMEOUT_MS: '1000' }),
      fetch: fetchMock,
    });

    await expect(
      provider.createChatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({
      code: 'provider_timeout',
      retryable: true,
      message: 'Sarvam request aborted after 1000ms',
    });
  }, 10_000);

  it('honours a caller abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const fetchMock: FetchLike = (_url, init) => {
      expect(init.signal.aborted).toBe(true);
      const error = new Error('aborted by caller');
      error.name = 'AbortError';
      return Promise.reject(error);
    };

    const provider = createSarvamProvider({ config: config(), fetch: fetchMock });

    await expect(
      provider.createChatCompletion(
        { messages: [{ role: 'user', content: 'hi' }] },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'provider_timeout' });
  });
});

describe('secret handling', () => {
  it('keeps the API key out of error messages and diagnostics', async () => {
    // An upstream body that echoes the key back must not be stored verbatim.
    const provider = createSarvamProvider({
      config: config(),
      fetch: mockFetch(
        httpResponse(401, JSON.stringify({ message: `invalid key ${KEY}` })),
      ),
    });

    const error = (await provider
      .createChatCompletion({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((caught: unknown) => caught)) as ProviderError;

    expect(error.message).not.toContain(KEY);
    expect(error.detail).not.toContain(KEY);
    expect(error.detail).toContain('[REDACTED]');
  });

  it('bounds the stored diagnostic length', async () => {
    const provider = createSarvamProvider({
      config: config(),
      fetch: mockFetch(httpResponse(500, 'x'.repeat(5_000))),
    });

    const error = (await provider
      .createChatCompletion({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((caught: unknown) => caught)) as ProviderError;

    expect(error.detail?.length).toBeLessThanOrEqual(305);
  });

  it('redacts every occurrence of the secret', () => {
    expect(redactSecret(`a ${KEY} b ${KEY}`, KEY)).toBe('a [REDACTED] b [REDACTED]');
    expect(redactSecret('nothing to do', '')).toBe('nothing to do');
  });
});
