import { describe, expect, it } from 'vitest';
import { ApiError } from '../../middleware/errors.js';
import {
  createOrderingSessionService,
  deriveSessionRef,
  SESSION_TTL_MS,
  validateCreateSessionBody,
} from './orderingSessionService.js';

describe('session creation', () => {
  it('issues an outlet- and channel-scoped session with an expiry', async () => {
    const nowMs = 1_700_000_000_000;
    const sessions = createOrderingSessionService({ now: () => nowMs });

    const created = await sessions.create('demo-outlet', 'qr');

    expect(created.outletId).toBe('demo-outlet');
    expect(created.channel).toBe('qr');
    expect(created.expiresAt).toBe(new Date(nowMs + SESSION_TTL_MS).toISOString());
  });

  it('issues unguessable, unique identifiers', async () => {
    const sessions = createOrderingSessionService();
    const created = await Promise.all(
      Array.from({ length: 50 }, () => sessions.create('demo-outlet', 'kiosk')),
    );
    const ids = new Set(created.map((session) => session.sessionId));

    expect(ids.size).toBe(50);
    for (const id of ids) {
      // 32 random bytes, base64url encoded.
      expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('isolates sessions from each other', async () => {
    const sessions = createOrderingSessionService();
    const a = await sessions.create('demo-outlet', 'qr');
    const b = await sessions.create('other-outlet', 'kiosk');

    expect((await sessions.find(a.sessionId))?.outletId).toBe('demo-outlet');
    expect((await sessions.find(b.sessionId))?.outletId).toBe('other-outlet');
  });

  it('expires a session once its lifetime passes', async () => {
    const clock = { value: 1_000_000 };
    const sessions = createOrderingSessionService({
      ttlMs: 1000,
      now: () => clock.value,
    });

    const created = await sessions.create('demo-outlet', 'qr');
    clock.value += 1001;

    expect(await sessions.find(created.sessionId)).toBeUndefined();
    expect(await sessions.size()).toBe(0);
  });

  it('refuses a new session rather than evicting a live one when full', async () => {
    const sessions = createOrderingSessionService({ maxSessions: 1 });
    const kept = await sessions.create('demo-outlet', 'qr');

    const error = await sessions.create('demo-outlet', 'qr').then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503 });
    expect(await sessions.find(kept.sessionId)).toBeDefined();
  });

  it('forgets a session on end', async () => {
    const sessions = createOrderingSessionService();
    const created = await sessions.create('demo-outlet', 'qr');

    await sessions.end(created.sessionId);
    expect(await sessions.find(created.sessionId)).toBeUndefined();
  });

  it('returns undefined for an unknown identifier', async () => {
    expect(await createOrderingSessionService().find('made-up')).toBeUndefined();
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
