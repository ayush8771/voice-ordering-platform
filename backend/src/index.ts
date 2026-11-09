import { loadConfig, loadEnvFile } from './config/env.js';
import { createApp } from './app.js';
import { connectToMongo, disconnectFromMongo, getDb } from './db/mongo.js';
import { ensureCartDraftIndexes } from './services/cart/index.js';
import { ensureMenuIndexes } from './services/menu/index.js';
import { ensureOrderIndexes } from './services/orders/index.js';
import { ensureOrderingSessionIndexes } from './services/sessions/mongoOrderingSessionService.js';

/** Server entry point: load config, connect dependencies, listen, shut down cleanly. */
async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();

  try {
    await connectToMongo(config);
    // Idempotent, and TTL cleanup only: expiry is enforced in every query
    // filter, so a server running before these exist is still correct.
    await ensureOrderingSessionIndexes(getDb());
    await ensureCartDraftIndexes(getDb());
    // Not cleanup: the unique order indexes are what enforce idempotency and
    // token uniqueness, so a deployment must have them.
    await ensureOrderIndexes(getDb());
    // Also not cleanup: these are the uniqueness guarantee every menu lookup,
    // cart line and quote/order price relies on. `db/seedMenu.ts` already
    // creates them, but the API must not depend on that script having run -
    // a menu managed any other way needs this guarantee just as much.
    await ensureMenuIndexes(getDb());
  } catch (error) {
    // A missing database must not prevent the API from starting during
    // foundation work; the health probe reports it as unreachable.
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'MongoDB setup failed; continuing without a database',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    );
  }

  const app = createApp(config);
  const server = app.listen(config.port, () => {
    console.info(
      JSON.stringify({
        level: 'info',
        message: 'API listening',
        port: config.port,
        nodeEnv: config.nodeEnv,
      }),
    );
  });

  const shutdown = (signal: string): void => {
    console.info(JSON.stringify({ level: 'info', message: 'Shutting down', signal }));
    server.close(() => {
      void disconnectFromMongo().finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'Fatal startup error',
      error: error instanceof Error ? error.message : 'Unknown error',
    }),
  );
  process.exit(1);
});
