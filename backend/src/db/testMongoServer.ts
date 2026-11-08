/**
 * Test-only MongoDB harness.
 *
 * Starts a real `mongod` process (via `mongodb-memory-server`) and connects a
 * real driver client to it, so repository, index and seed behaviour is verified
 * against MongoDB itself rather than against a stub (docs/TESTING.md section 2).
 *
 * Excluded from the build output in `tsconfig.build.json`, so it cannot be
 * wired into a running server by accident. The first run on a machine
 * downloads a `mongod` binary; later runs reuse the cached one.
 */

import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

export interface TestMongo {
  readonly uri: string;
  readonly dbName: string;
  readonly db: Db;
  readonly client: MongoClient;
  /** Drops every collection so each test starts from a known state. */
  reset(): Promise<void>;
  stop(): Promise<void>;
}

/** Generous: only the very first run pays for the binary download. */
export const MONGO_HOOK_TIMEOUT_MS = 180_000;

export async function startTestMongo(dbName = 'vop_integration'): Promise<TestMongo> {
  const server = await MongoMemoryServer.create();
  const uri = server.getUri();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  const db = client.db(dbName);

  return {
    uri,
    dbName,
    db,
    client,
    async reset() {
      for (const { name } of await db.listCollections().toArray()) {
        await db.collection(name).drop();
      }
    },
    async stop() {
      await client.close();
      await server.stop();
    },
  };
}
