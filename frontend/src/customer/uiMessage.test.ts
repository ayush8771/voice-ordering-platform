import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../api/client';
import { messageOf } from './useOrdering';

describe('messageOf', () => {
  it('keeps a server message verbatim, never as a translation key', () => {
    const error = new ApiRequestError(409, 'CONFLICT', 'Quote has expired.', 'req-1');
    expect(messageOf(error)).toEqual({ kind: 'server', text: 'Quote has expired.' });
  });

  it('uses frontend-owned keys for messages the client wrote itself', () => {
    expect(messageOf(new ApiRequestError(0, 'NETWORK_ERROR', 'x'))).toEqual({
      kind: 'key',
      key: 'error.network',
    });
    expect(messageOf(new ApiRequestError(502, 'INTERNAL_ERROR', 'x'))).toEqual({
      kind: 'key',
      key: 'error.unexpected',
    });
    expect(messageOf(new Error('boom'))).toEqual({ kind: 'key', key: 'error.generic' });
  });

  it('keeps a non-revision 409 message from the server, not a draft-changed key', () => {
    const error = new ApiRequestError(
      409,
      'CONFLICT',
      'Selected item is unavailable',
      'req-2',
      [{ menuItemId: 'dosa' }],
    );
    expect(messageOf(error)).toEqual({
      kind: 'server',
      text: 'Selected item is unavailable',
    });
  });
});
