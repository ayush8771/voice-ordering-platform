import express, { type Express } from 'express';
import cors from 'cors';
import { API_BASE_PATH } from '@vop/shared';
import type { AppConfig } from './config/env.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { createHealthRouter } from './routes/health.js';
import { createMenuRouter } from './routes/menu.js';
import { createOrderingSessionRouter } from './routes/orderingSessions.js';
import { createQuoteRouter } from './routes/quotes.js';
import { getDb } from './db/mongo.js';
import {
  createLazyMongoMenuRepository,
  createMenuService,
  type MenuService,
} from './services/menu/index.js';
import {
  createQuoteService,
  createQuoteStore,
  type QuoteService,
} from './services/quote/index.js';
import {
  createOrderingSessionService,
  type OrderingSessionService,
} from './services/sessions/orderingSessionService.js';

/**
 * Service overrides. Tests inject in-memory implementations; production leaves
 * them unset and gets the MongoDB-backed defaults.
 */
export interface AppDeps {
  readonly menuService?: MenuService;
  readonly quoteService?: QuoteService;
  readonly orderingSessions?: OrderingSessionService;
}

/**
 * Builds the Express application.
 *
 * Kept separate from the server entry point so tests can exercise the app
 * without binding a port. Routes handle transport concerns only; domain rules
 * belong in services (docs/ARCHITECTURE.md section 5).
 */
export function createApp(config: AppConfig, deps: AppDeps = {}): Express {
  const app = express();

  const menuService =
    deps.menuService ?? createMenuService(createLazyMongoMenuRepository(getDb));
  const orderingSessions = deps.orderingSessions ?? createOrderingSessionService();
  const quoteService =
    deps.quoteService ??
    createQuoteService({ menuService, quoteStore: createQuoteStore() });

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
  app.use(API_BASE_PATH, createMenuRouter(menuService));
  app.use(API_BASE_PATH, createOrderingSessionRouter(orderingSessions, menuService));
  app.use(API_BASE_PATH, createQuoteRouter(quoteService, orderingSessions));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
