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
import { createCartRouter } from './routes/cart.js';
import { createOrderRouter } from './routes/orders.js';
import { createConversationRouter } from './routes/conversation.js';
import { getDb } from './db/mongo.js';
import {
  createCartService,
  createMongoCartStore,
  type CartService,
  type CartStore,
} from './services/cart/index.js';
import {
  createMongoOrderStore,
  createOrderService,
  type OrderService,
} from './services/orders/index.js';
import {
  createLazyMongoMenuRepository,
  createMenuService,
  type MenuService,
} from './services/menu/index.js';
import {
  createQuoteService,
  createQuoteStore,
  type QuoteService,
  type QuoteStore,
} from './services/quote/index.js';
import {
  createConversationService,
  loadConversationConfig,
  type ConversationService,
} from './services/conversation/index.js';
import { createMenuLookup } from './services/menu/index.js';
import {
  createSarvamProvider,
  isSarvamConfigured,
  loadSarvamConfig,
} from './providers/sarvam/index.js';
import { createMongoOrderingSessionService } from './services/sessions/mongoOrderingSessionService.js';
import type { OrderingSessionService } from './services/sessions/orderingSessionService.js';

/**
 * Service overrides. Tests inject in-memory implementations; production leaves
 * them unset and gets the MongoDB-backed defaults.
 */
export interface AppDeps {
  readonly menuService?: MenuService;
  readonly quoteService?: QuoteService;
  readonly cartService?: CartService;
  readonly orderService?: OrderService;
  readonly orderingSessions?: OrderingSessionService;
  /**
   * The stores are overridable because two consumers share each of them: the
   * quote store is read by order creation, and the cart store is deleted from
   * by the confirm workflow. A test that injects `quoteService` or
   * `cartService` must inject the matching store, or order creation will look
   * in a different one.
   */
  readonly quoteStore?: QuoteStore;
  readonly cartStore?: CartStore;
  /**
   * Left unset in production, where it is built only when a conversational
   * provider is configured. Tests inject one with a fake provider, so no suite
   * makes a live call or spends credits (docs/TESTING.md section 2).
   */
  readonly conversationService?: ConversationService;
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
  // Sessions and drafts are persisted so a restart or a second instance does
  // not end a session or empty a draft mid-order (docs/DATABASE.md section 2).
  // The database is resolved per call, so the API still starts without one and
  // reports the dependency as unavailable instead of failing to boot.
  const orderingSessions =
    deps.orderingSessions ?? createMongoOrderingSessionService(getDb);
  // Shared: order creation re-validates against the same issued quotes, and
  // the confirm workflow deletes the draft from the same store the cart
  // service writes.
  const quoteStore = deps.quoteStore ?? createQuoteStore();
  const cartStore = deps.cartStore ?? createMongoCartStore(getDb);
  const quoteService =
    deps.quoteService ?? createQuoteService({ menuService, quoteStore });
  const cartService = deps.cartService ?? createCartService({ menuService, cartStore });
  const orderService =
    deps.orderService ??
    createOrderService({
      menuService,
      quoteStore,
      orderStore: createMongoOrderStore(getDb),
    });

  // Built only when a provider key is present. Without one the conversational
  // route answers 503 and every touch path keeps working, which is the
  // required degradation (docs/PRD.md section 5) and also means the API starts
  // with no AI credentials at all.
  const conversationService =
    deps.conversationService ??
    (isSarvamConfigured()
      ? createConversationService({
          provider: createSarvamProvider({ config: loadSarvamConfig() }),
          menu: createMenuLookup(menuService),
          config: loadConversationConfig(),
        })
      : undefined);

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
  app.use(
    API_BASE_PATH,
    createOrderingSessionRouter(
      orderingSessions,
      menuService,
      cartStore,
      conversationService,
    ),
  );
  app.use(API_BASE_PATH, createQuoteRouter(quoteService, orderingSessions));
  app.use(API_BASE_PATH, createCartRouter(cartService, quoteService, orderingSessions));
  app.use(API_BASE_PATH, createOrderRouter(orderService, cartStore, orderingSessions));
  app.use(
    API_BASE_PATH,
    createConversationRouter(conversationService, cartService, orderingSessions),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
