import { Router } from 'express';
import type { HealthResponse } from '@vop/shared';
import type { AppConfig } from '../config/env.js';
import { getMongoState } from '../db/mongo.js';

/**
 * Infrastructure health probe.
 *
 * Public and unauthenticated, so it reports only reachability - never menu,
 * order, outlet or configuration data.
 */
export function createHealthRouter(config: AppConfig): Router {
  const router = Router();

  router.get('/health', async (_req, res, next) => {
    try {
      const mongodb = await getMongoState(config);

      const body: HealthResponse = {
        // 'unconfigured' is an expected local state, not a degradation.
        status: mongodb === 'unreachable' ? 'degraded' : 'ok',
        apiVersion: 'v1',
        timestamp: new Date().toISOString(),
        dependencies: { mongodb },
      };

      res.status(200).json(body);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
