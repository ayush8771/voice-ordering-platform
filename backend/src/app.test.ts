import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';

const app = createApp(loadConfig({ NODE_ENV: 'test' }));

describe('GET /api/v1/health', () => {
  it('returns the health contract', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.apiVersion).toBe('v1');
    // No database configured in tests, which is a valid state, not a failure.
    expect(response.body.dependencies.mongodb).toBe('unconfigured');
    expect(typeof response.body.timestamp).toBe('string');
  });

  it('sets a correlation ID header', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('does not advertise the server implementation', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('error envelope', () => {
  it('returns the documented shape for an unknown route', async () => {
    const response = await request(app).get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(typeof response.body.error.message).toBe('string');
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('gives each request a distinct correlation ID', async () => {
    const [first, second] = await Promise.all([
      request(app).get('/api/v1/health'),
      request(app).get('/api/v1/health'),
    ]);

    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });
});
