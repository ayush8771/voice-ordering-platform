import { MongoClient, type Db } from 'mongodb';
import type { DependencyState } from '@vop/shared';
import type { AppConfig } from '../config/env.js';

/**
 * MongoDB connection lifecycle.
 *
 * The connection is optional at this stage: MONGODB_URI may be empty so a
 * developer can run the API and clients without a local database. Product
 * services added later must treat an absent database as a retryable failure
 * and must never report a write as succeeded (docs/ARCHITECTURE.md section 6).
 */

let client: MongoClient | undefined;
let database: Db | undefined;

export async function connectToMongo(config: AppConfig): Promise<void> {
  if (config.mongodbUri === undefined) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        message: 'MONGODB_URI is not configured; starting without a database',
      }),
    );
    return;
  }

  const created = new MongoClient(config.mongodbUri, {
    serverSelectionTimeoutMS: 5000,
  });
  await created.connect();

  client = created;
  database = created.db(config.mongodbDbName);

  // Logs the database name only - a connection string can contain credentials.
  console.info(
    JSON.stringify({
      level: 'info',
      message: 'Connected to MongoDB',
      database: config.mongodbDbName,
    }),
  );
}

export async function disconnectFromMongo(): Promise<void> {
  await client?.close();
  client = undefined;
  database = undefined;
}

/** Throws when a caller needs the database but none is connected. */
export function getDb(): Db {
  if (database === undefined) {
    throw new Error('MongoDB is not connected');
  }
  return database;
}

/** Reachability for the health probe. Never throws. */
export async function getMongoState(config: AppConfig): Promise<DependencyState> {
  if (config.mongodbUri === undefined) return 'unconfigured';
  if (client === undefined) return 'unreachable';

  try {
    await client.db(config.mongodbDbName).command({ ping: 1 });
    return 'ok';
  } catch {
    return 'unreachable';
  }
}
