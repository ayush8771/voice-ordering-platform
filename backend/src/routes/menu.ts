/**
 * Public menu route.
 *
 * `GET /api/v1/outlets/:outletId/menu` is unauthenticated: a QR code
 * identifies an outlet, not a trusted role (docs/SECURITY.md section 1). It
 * exposes only the priced public menu - never outlet configuration or
 * provider settings.
 *
 * `?lang=en|kn|hi` picks the language every string is resolved into. Omitting
 * it serves English, so an existing client's request is unchanged. An unknown
 * value is a `400`, unlike a malformed `outletId`, which stays a `404`: an
 * outlet ID must not disclose existence, a language code discloses nothing.
 */

import { Router } from 'express';
import { ApiError } from '../middleware/errors.js';
import { readLanguageParam } from '../models/language.js';
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

      const language = readLanguageParam(req.query['lang']);

      res.status(200).json(await menuService.getPublicMenu(outletId, language));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
