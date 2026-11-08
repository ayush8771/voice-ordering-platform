/** Public surface of the menu service. */

export { createMenuLookup } from './menuLookup.js';
export type { MenuRepository } from './menuRepository.js';
export {
  computeMenuVersion,
  createMenuService,
  type MenuService,
  type MenuSnapshot,
} from './menuService.js';
export {
  createLazyMongoMenuRepository,
  ensureMenuIndexes,
  MongoMenuRepository,
} from './mongoMenuRepository.js';
