import { describe, expect, it } from 'vitest';
import {
  isSarvamConfigured,
  loadSarvamConfig,
  SARVAM_DEFAULT_BASE_URL,
  SARVAM_DEFAULT_MODEL,
  SARVAM_DEFAULT_TIMEOUT_MS,
} from './config.js';

const KEY = 'test-subscription-key';

describe('loadSarvamConfig', () => {
  it('applies the documented defaults', () => {
    const config = loadSarvamConfig({ SARVAM_API_KEY: KEY });

    expect(config.apiKey).toBe(KEY);
    expect(config.baseUrl).toBe(SARVAM_DEFAULT_BASE_URL);
    expect(config.model).toBe(SARVAM_DEFAULT_MODEL);
    expect(config.timeoutMs).toBe(SARVAM_DEFAULT_TIMEOUT_MS);
  });

  it('requires an API key', () => {
    expect(() => loadSarvamConfig({})).toThrow(/Missing SARVAM_API_KEY/);
    expect(() => loadSarvamConfig({ SARVAM_API_KEY: '   ' })).toThrow(
      /Missing SARVAM_API_KEY/,
    );
  });

  it('allows overriding the model and base URL, trimming trailing slashes', () => {
    const config = loadSarvamConfig({
      SARVAM_API_KEY: KEY,
      SARVAM_MODEL: 'some-other-model',
      SARVAM_BASE_URL: 'https://proxy.example.test/sarvam/',
    });

    expect(config.model).toBe('some-other-model');
    expect(config.baseUrl).toBe('https://proxy.example.test/sarvam');
  });

  it('rejects a non-URL base URL', () => {
    expect(() =>
      loadSarvamConfig({ SARVAM_API_KEY: KEY, SARVAM_BASE_URL: 'api.sarvam.ai' }),
    ).toThrow(/Invalid SARVAM_BASE_URL/);
  });

  it('rejects an out-of-range or non-numeric timeout', () => {
    expect(() =>
      loadSarvamConfig({ SARVAM_API_KEY: KEY, SARVAM_TIMEOUT_MS: 'soon' }),
    ).toThrow(/Invalid SARVAM_TIMEOUT_MS/);
    expect(() =>
      loadSarvamConfig({ SARVAM_API_KEY: KEY, SARVAM_TIMEOUT_MS: '10' }),
    ).toThrow(/Invalid SARVAM_TIMEOUT_MS/);
    expect(() =>
      loadSarvamConfig({ SARVAM_API_KEY: KEY, SARVAM_TIMEOUT_MS: '500000' }),
    ).toThrow(/Invalid SARVAM_TIMEOUT_MS/);
  });

  it('never serializes the API key', () => {
    const config = loadSarvamConfig({ SARVAM_API_KEY: KEY });
    const serialized = JSON.stringify(config);

    expect(serialized).not.toContain(KEY);
    expect(JSON.parse(serialized)).toEqual({
      baseUrl: SARVAM_DEFAULT_BASE_URL,
      model: SARVAM_DEFAULT_MODEL,
      timeoutMs: SARVAM_DEFAULT_TIMEOUT_MS,
      apiKeyConfigured: true,
    });
  });

  it('reports whether a key is configured', () => {
    expect(isSarvamConfigured({ SARVAM_API_KEY: KEY })).toBe(true);
    expect(isSarvamConfigured({ SARVAM_API_KEY: '' })).toBe(false);
    expect(isSarvamConfigured({})).toBe(false);
  });
});
