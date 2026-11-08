/**
 * Public menu route.
 *
 * `GET /api/v1/outlets/:outletId/menu` is unauthenticated: a QR code
 * identifies an outlet, not a trusted role (docs/SECURITY.md section 1). It
 * exposes only the priced public menu - never outlet configuration or
 * provider settings.
 */

import { Router } from 'express';
import { ApiError } from '../middleware/errors.js';
import { isValidPublicId } from '../models/menu.js';
import type { MenuService } from '../services/menu/menuService.js';

export function createMenuRouter(menuService: MenuService): Router {
  const router = Router();

  router.get('/outlets/:outletId/menu', async (req, res, next) => {
    try {
      const outletId = req.params.outletId;
      if (!isValidPublicId(outletId)) {
        // A malformed ID is reported as not found, like an unknown outlet, so
        // the response does not describe the ID format to a prober.
        throw ApiError.notFound('Outlet not found');
      }

      res.status(200).json(await menuService.getPublicMenu(outletId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
