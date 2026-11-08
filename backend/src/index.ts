import { loadConfig, loadEnvFile } from './config/env.js';
import { createApp } from './app.js';
import { connectToMongo, disconnectFromMongo } from './db/mongo.js';

/** Server entry point: load config, connect dependencies, listen, shut down cleanly. */
async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();

  try {
    await connectToMongo(config);
  } catch (error) {
    // A missing database must not prevent the API from starting during
    // foundation work; the health probe reports it as unreachable.
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'MongoDB connection failed; continuing without a database',
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
