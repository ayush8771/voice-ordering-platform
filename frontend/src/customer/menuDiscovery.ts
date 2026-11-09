import type { MenuCategory, MenuItem, MenuResponse } from '@vop/shared';

/**
 * Display-only menu browsing rules: grouping, search and category filtering.
 * Pure functions over the menu the server returned. They never change a
 * price, an availability flag or an option, and they never decide what may be
 * ordered - the backend stays authoritative for that.
 */

export interface MenuSection {
  readonly category: MenuCategory;
  readonly items: readonly MenuItem[];
}

/** Category id used for items the menu does not place in any category. */
export const OTHER_CATEGORY_ID = '';

/** Categories in display order, plus "Other" for uncategorised items. */
export function menuSections(menu: MenuResponse): MenuSection[] {
  const categories = [...menu.categories].sort((a, b) => a.sortOrder - b.sortOrder);
  if (menu.items.some((item) => item.categoryId === undefined)) {
    categories.push({
      id: OTHER_CATEGORY_ID,
      name: 'Other',
      sortOrder: Number.MAX_SAFE_INTEGER,
    });
  }
  return categories
    .map((category) => ({
      category,
      items: menu.items.filter(
        (item) => (item.categoryId ?? OTHER_CATEGORY_ID) === category.id,
      ),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * Lower-cased, accent-stripped, whitespace-collapsed text for matching, so
 * "  masala   DOSA " finds "Masala Dosa". Indic scripts pass through
 * unchanged apart from case folding, which they do not use.
 */
export function normaliseSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the dish name contains the query. An empty query matches all. */
export function matchesSearch(item: MenuItem, query: string): boolean {
  const needle = normaliseSearch(query);
  if (needle === '') return true;
  return normaliseSearch(item.name).includes(needle);
}

/**
 * Applies the name search to every section, dropping sections left empty.
 * Category order is kept, so the chip bar and the list stay in step.
 */
export function searchSections(
  sections: readonly MenuSection[],
  query: string,
): MenuSection[] {
  return sections
    .map((section) => ({
      category: section.category,
      items: section.items.filter((item) => matchesSearch(item, query)),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * Narrows search results to one category. `undefined` means all categories.
 * A category with no matches yields an empty list rather than silently
 * falling back to all, so the empty state can say what happened.
 */
export function filterByCategory(
  sections: readonly MenuSection[],
  categoryId: string | undefined,
): MenuSection[] {
  if (categoryId === undefined) return [...sections];
  return sections.filter((section) => section.category.id === categoryId);
}

/** Total dishes across sections - a count for a label. */
export function itemCount(sections: readonly MenuSection[]): number {
  return sections.reduce((sum, section) => sum + section.items.length, 0);
}
