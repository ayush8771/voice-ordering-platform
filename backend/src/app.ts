import express, { type Express } from 'express';
import cors from 'cors';
import { API_BASE_PATH } from '@vop/shared';
import type { AppConfig } from './config/env.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { createHealthRouter } from './routes/health.js';

/**
 * Builds the Express application.
 *
 * Kept separate from the server entry point so tests can exercise the app
 * without binding a port. Routes handle transport concerns only; domain rules
 * belong in services (docs/ARCHITECTURE.md section 5).
 */
export function createApp(config: AppConfig): Express {
  const app = express();

  // Do not advertise the server implementation.
  app.disable('x-powered-by');

  app.use(requestId);

  app.use(
    cors({
      origin: [...config.corsAllowedOrigins],
      credentials: true,
    }),
  );

  // Bounded request bodies (docs/SECURITY.md section 4).
  app.use(express.json({ limit: '32kb' }));

  app.use(API_BASE_PATH, createHealthRouter(config));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
