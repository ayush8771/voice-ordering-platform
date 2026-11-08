import { describe, expect, it } from 'vitest';
import { ApiError } from '../../middleware/errors.js';
import {
  createOrderingSessionService,
  deriveSessionRef,
  SESSION_TTL_MS,
  validateCreateSessionBody,
} from './orderingSessionService.js';

describe('session creation', () => {
  it('issues an outlet- and channel-scoped session with an expiry', () => {
    const nowMs = 1_700_000_000_000;
    const sessions = createOrderingSessionService({ now: () => nowMs });

    const created = sessions.create('demo-outlet', 'qr');

    expect(created.outletId).toBe('demo-outlet');
    expect(created.channel).toBe('qr');
    expect(created.expiresAt).toBe(new Date(nowMs + SESSION_TTL_MS).toISOString());
  });

  it('issues unguessable, unique identifiers', () => {
    const sessions = createOrderingSessionService();
    const ids = new Set(
      Array.from(
        { length: 50 },
        () => sessions.create('demo-outlet', 'kiosk').sessionId,
      ),
    );

    expect(ids.size).toBe(50);
    for (const id of ids) {
      // 32 random bytes, base64url encoded.
      expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('isolates sessions from each other', () => {
    const sessions = createOrderingSessionService();
    const a = sessions.create('demo-outlet', 'qr');
    const b = sessions.create('other-outlet', 'kiosk');

    expect(sessions.find(a.sessionId)?.outletId).toBe('demo-outlet');
    expect(sessions.find(b.sessionId)?.outletId).toBe('other-outlet');
  });

  it('expires a session once its lifetime passes', () => {
    const clock = { value: 1_000_000 };
    const sessions = createOrderingSessionService({
      ttlMs: 1000,
      now: () => clock.value,
    });

    const created = sessions.create('demo-outlet', 'qr');
    clock.value += 1001;

    expect(sessions.find(created.sessionId)).toBeUndefined();
    expect(sessions.size()).toBe(0);
  });

  it('refuses a new session rather than evicting a live one when full', () => {
    const sessions = createOrderingSessionService({ maxSessions: 1 });
    const kept = sessions.create('demo-outlet', 'qr');

    const error = (() => {
      try {
        sessions.create('demo-outlet', 'qr');
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503 });
    expect(sessions.find(kept.sessionId)).toBeDefined();
  });

  it('forgets a session on end', () => {
    const sessions = createOrderingSessionService();
    const created = sessions.create('demo-outlet', 'qr');

    sessions.end(created.sessionId);
    expect(sessions.find(created.sessionId)).toBeUndefined();
  });

  it('returns undefined for an unknown identifier', () => {
    expect(createOrderingSessionService().find('made-up')).toBeUndefined();
  });
});

describe('deriveSessionRef', () => {
  it('is a short stable hash, not the session ID', () => {
    const sessionId = 'a-very-secret-capability-value';
    expect(deriveSessionRef(sessionId)).toBe(deriveSessionRef(sessionId));
    expect(deriveSessionRef(sessionId)).toHaveLength(12);
    expect(deriveSessionRef(sessionId)).not.toContain('secret');
  });
});

describe('validateCreateSessionBody', () => {
  it('accepts both channels', () => {
    expect(validateCreateSessionBody({ outletId: 'o1', channel: 'qr' })).toEqual({
      outletId: 'o1',
      channel: 'qr',
    });
    expect(validateCreateSessionBody({ outletId: 'o1', channel: 'kiosk' })).toEqual({
      outletId: 'o1',
      channel: 'kiosk',
    });
  });

  it('rejects a missing outlet, bad channel or non-object body', () => {
    expect(() => validateCreateSessionBody({ channel: 'qr' })).toThrow(/outletId/);
    expect(() => validateCreateSessionBody({ outletId: 'o1' })).toThrow(/channel/);
    expect(() => validateCreateSessionBody({ outletId: 'o1', channel: 'sms' })).toThrow(
      /channel/,
    );
    expect(() => validateCreateSessionBody('qr')).toThrow(/session request object/);
  });
});
