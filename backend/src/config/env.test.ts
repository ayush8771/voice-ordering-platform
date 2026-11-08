import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.js';

describe('loadConfig', () => {
  it('applies documented defaults when nothing is set', () => {
    const config = loadConfig({});

    expect(config.port).toBe(4000);
    expect(config.nodeEnv).toBe('development');
    expect(config.corsAllowedOrigins).toEqual(['http://localhost:5173']);
    expect(config.mongodbUri).toBeUndefined();
    expect(config.mongodbDbName).toBe('voice_ordering_dev');
  });

  it('parses an explicit origin allowlist', () => {
    const config = loadConfig({
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173, https://example.test',
    });

    expect(config.corsAllowedOrigins).toEqual([
      'http://localhost:5173',
      'https://example.test',
    ]);
  });

  it('rejects a wildcard CORS origin', () => {
    expect(() => loadConfig({ CORS_ALLOWED_ORIGINS: '*' })).toThrow(
      /explicit allowlist/,
    );
  });

  it('rejects a non-numeric or out-of-range port', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(/Invalid PORT/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/Invalid PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/Invalid NODE_ENV/);
  });

  it('treats a blank MONGODB_URI as unconfigured', () => {
    expect(loadConfig({ MONGODB_URI: '   ' }).mongodbUri).toBeUndefined();
  });
});
