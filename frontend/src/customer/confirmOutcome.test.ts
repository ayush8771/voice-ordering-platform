import { describe, expect, it } from 'vitest';
import { classifyConfirmFailure } from './confirmOutcome';

describe('classifyConfirmFailure', () => {
  it('treats a lost session separately', () => {
    expect(classifyConfirmFailure(401, 'UNAUTHORIZED')).toBe('sessionLost');
  });

  it('re-quotes only when the server definitively refused the quote', () => {
    expect(classifyConfirmFailure(409, 'CONFLICT')).toBe('staleQuote');
    expect(classifyConfirmFailure(422, 'VALIDATION_ERROR')).toBe('staleQuote');
  });

  it('treats other client errors as refused, with nothing created', () => {
    expect(classifyConfirmFailure(400, 'VALIDATION_ERROR')).toBe('refused');
    expect(classifyConfirmFailure(403, 'FORBIDDEN')).toBe('refused');
    expect(classifyConfirmFailure(429, 'RATE_LIMITED')).toBe('refused');
  });

  it('keeps the outcome unknown for network failures and server errors', () => {
    expect(classifyConfirmFailure(0, 'NETWORK_ERROR')).toBe('unknown');
    expect(classifyConfirmFailure(500, 'INTERNAL_ERROR')).toBe('unknown');
    expect(classifyConfirmFailure(503, 'SERVICE_UNAVAILABLE')).toBe('unknown');
  });
});
