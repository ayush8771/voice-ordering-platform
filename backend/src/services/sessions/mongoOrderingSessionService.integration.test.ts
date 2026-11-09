/**
 * MongoDB integration tests for persisted ordering sessions.
 *
 * These run against a real `mongod`, so they cover what a stub cannot: that a
 * session survives a process restart, that expiry is enforced by the query
 * filter rather than by a background sweep, that the idle slide is one atomic
 * conditional write, and that no bearer token is written to disk
 * (docs/TESTING.md section 2).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Db, IndexDescription } from 'mongodb';
import {
  MONGO_HOOK_TIMEOUT_MS,
  startTestMongo,
  type TestMongo,
} from '../../db/testMongoServer.js';
import { ApiError } from '../../middleware/errors.js';
import { SESSION_COLLECTIONS } from '../../models/sessions.js';
import {
  createMongoOrderingSessionService,
  ensureOrderingSessionIndexes,
} from './mongoOrderingSessionService.js';
import {
  SESSION_IDLE_TTL_MS,
  SESSION_TTL_MS,
  deriveSessionRef,
} from './orderingSessionService.js';
import { hashSessionKey } from './sessionKey.js';

let mongo: TestMongo;

beforeAll(async () => {
  mongo = await startTestMongo();
}, MONGO_HOOK_TIMEOUT_MS);

afterAll(async () => {
  await mongo?.stop();
});

afterEach(async () => {
  await mongo.reset();
});

function db(): Db {
  return mongo.db;
}

/** A clock the test moves by hand, as the in-memory service tests do. */
function clockedService(start = 1_000_000): {
  readonly service: ReturnType<typeof createMongoOrderingSessionService>;
  advance(ms: number): void;
} {
  let clock = start;
  const service = createMongoOrderingSessionService(db, { now: () => clock });
  return {
    service,
    advance(ms) {
      clock += ms;
    },
  };
}

describe('persistence and restart recovery', () => {
  it('serves a session created before a restart', async () => {
    const before = createMongoOrderingSessionService(db);
    const created = await before.create('demo-outlet', 'kiosk');

    // A new service over the same database is exactly what a restarted
    // process, or a second instance, has.
    const after = createMongoOrderingSessionService(db);
    const found = await after.find(created.sessionId);

    expect(found?.outletId).toBe('demo-outlet');
    expect(found?.channel).toBe('kiosk');
    expect(found?.sessionId).toBe(created.sessionId);
    expect(found?.expiresAtMs).toBe(Date.parse(created.expiresAt));
  });

  it('reports a session ended on another instance as invalid', async () => {
    const first = createMongoOrderingSessionService(db);
    const second = createMongoOrderingSessionService(db);
    const created = await first.create('demo-outlet', 'qr');

    await second.end(created.sessionId);

    expect(await first.find(created.sessionId)).toBeUndefined();
  });
});

describe('stored shape', () => {
  it('never stores the session ID, only its hash and log reference', async () => {
    const sessions = createMongoOrderingSessionService(db);
    const { sessionId } = await sessions.create('demo-outlet', 'qr');

    const docs = await db()
      .collection(SESSION_COLLECTIONS.orderingSessions)
      .find({})
      .toArray();

    expect(docs).toHaveLength(1);
    expect(JSON.stringify(docs)).not.toContain(sessionId);
    expect(docs[0]?._id).toBe(hashSessionKey(sessionId));
    expect(docs[0]?.['sessionRef']).toBe(deriveSessionRef(sessionId));
  });

  it('declares only a TTL index, because the hash is the primary key', async () => {
    await ensureOrderingSessionIndexes(db());
    // Idempotent: startup and a later migration may both call it.
    await ensureOrderingSessionIndexes(db());

    const indexes = (await db()
      .collection(SESSION_COLLECTIONS.orderingSessions)
      .indexes()) as IndexDescription[];
    const ttl = indexes.find((index) => index.name === 'session_ttl');

    expect(ttl?.key).toEqual({ expiresAt: 1 });
    expect(ttl?.expireAfterSeconds).toBe(0);
    expect(indexes.map((index) => index.name).sort()).toEqual(['_id_', 'session_ttl']);
  });
});

describe('isolation', () => {
  it('keeps each session bound to the outlet it was minted for', async () => {
    const sessions = createMongoOrderingSessionService(db);
    const a = await sessions.create('demo-outlet', 'qr');
    const b = await sessions.create('other-outlet', 'kiosk');

    expect((await sessions.find(a.sessionId))?.outletId).toBe('demo-outlet');
    expect((await sessions.find(b.sessionId))?.outletId).toBe('other-outlet');
  });

  it('reports an unknown token exactly like a wrong one', async () => {
    const sessions = createMongoOrderingSessionService(db);
    await sessions.create('demo-outlet', 'qr');

    expect(await sessions.find('made-up-token')).toBeUndefined();
    expect(await sessions.find('')).toBeUndefined();
  });
});

describe('expiry', () => {
  it('refuses a session past its absolute deadline while the document is still there', async () => {
    const { service, advance } = clockedService();
    const created = await service.create('demo-outlet', 'kiosk');

    // Busy throughout, so only the absolute cap can end it.
    for (let minute = 1; minute < 30; minute += 1) {
      advance(60_000);
      expect(await service.find(created.sessionId), `minute ${minute}`).toBeDefined();
    }

    advance(SESSION_TTL_MS);
    expect(await service.find(created.sessionId)).toBeUndefined();

    // The TTL monitor has collected nothing yet, which is the point: the
    // filter is what makes the session unusable, not the sweep.
    const remaining = await db()
      .collection(SESSION_COLLECTIONS.orderingSessions)
      .countDocuments({});
    expect(remaining).toBe(1);
    expect(await service.size()).toBe(0);
  });

  it('refuses a session past its idle window', async () => {
    const { service, advance } = clockedService();
    const created = await service.create('demo-outlet', 'kiosk');

    advance(60_000);
    expect(await service.find(created.sessionId)).toBeDefined();

    advance(SESSION_IDLE_TTL_MS);
    expect(await service.find(created.sessionId)).toBeUndefined();
  });

  it('slides the idle window on use and clamps it to the absolute deadline', async () => {
    const start = 1_000_000;
    let clock = start;
    const service = createMongoOrderingSessionService(db, { now: () => clock });
    const created = await service.create('demo-outlet', 'qr');

    // Each use just inside the idle window pushes the deadline forward.
    let previous = (await service.find(created.sessionId))?.idleExpiresAtMs ?? 0;
    while (clock + SESSION_IDLE_TTL_MS - 1_000 < start + SESSION_TTL_MS) {
      clock += SESSION_IDLE_TTL_MS - 1_000;
      const slid = await service.find(created.sessionId);
      expect(slid, `at ${clock - start}ms`).toBeDefined();
      expect(slid!.idleExpiresAtMs).toBeGreaterThan(previous);
      expect(slid!.lastSeenAtMs).toBe(clock);
      previous = slid!.idleExpiresAtMs;
    }

    // Within one idle window of the cap, the new deadline is the cap itself.
    clock = start + SESSION_TTL_MS - 1_000;
    const late = await service.find(created.sessionId);
    expect(late?.idleExpiresAtMs).toBe(start + SESSION_TTL_MS);
    expect(late?.idleExpiresAtMs).toBeLessThanOrEqual(late!.expiresAtMs);

    clock = start + SESSION_TTL_MS;
    expect(await service.find(created.sessionId)).toBeUndefined();
  });
});

describe('concurrency', () => {
  it('lets concurrent lookups of one session all succeed and agree', async () => {
    const service = createMongoOrderingSessionService(db);
    const created = await service.create('demo-outlet', 'qr');

    const found = await Promise.all(
      Array.from({ length: 10 }, () => service.find(created.sessionId)),
    );

    expect(found.every((session) => session?.outletId === 'demo-outlet')).toBe(true);
    // The absolute deadline is immutable, so no concurrent slide can move it.
    const deadlines = new Set(found.map((session) => session?.expiresAtMs));
    expect(deadlines.size).toBe(1);
  });

  it('issues distinct tokens under concurrent creation', async () => {
    const service = createMongoOrderingSessionService(db);
    const created = await Promise.all(
      Array.from({ length: 25 }, () => service.create('demo-outlet', 'kiosk')),
    );

    expect(new Set(created.map((session) => session.sessionId)).size).toBe(25);
    expect(await service.size()).toBe(25);
  });

  it('refuses a new session rather than evicting a live one when full', async () => {
    const service = createMongoOrderingSessionService(db, { maxSessions: 1 });
    const kept = await service.create('demo-outlet', 'qr');

    const error = await service.create('demo-outlet', 'qr').then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503 });
    expect(await service.find(kept.sessionId)).toBeDefined();
  });
});

describe('database failure', () => {
  it('is a retryable 503 and mints no session when the database is absent', async () => {
    const service = createMongoOrderingSessionService(() => {
      throw new Error('MongoDB is not connected');
    });

    for (const call of [
      () => service.create('demo-outlet', 'qr'),
      () => service.find('anything'),
      () => service.end('anything'),
      () => service.size(),
    ]) {
      const error = await call().then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 503 });
    }
  });

  it('does not report an invalid session when the lookup itself fails', async () => {
    const service = createMongoOrderingSessionService(() => {
      throw new Error('MongoDB is not connected');
    });

    // A 503 rather than `undefined`: an unreachable store must not look like
    // an expired session, which would end a customer's order silently.
    await expect(service.find('anything')).rejects.toMatchObject({ status: 503 });
  });
});
