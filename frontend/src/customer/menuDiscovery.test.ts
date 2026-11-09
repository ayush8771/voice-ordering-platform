import { describe, expect, it } from 'vitest';
import type { MenuItem, MenuResponse } from '@vop/shared';
import {
  OTHER_CATEGORY_ID,
  filterByCategory,
  itemCount,
  matchesSearch,
  menuSections,
  normaliseSearch,
  searchSections,
} from './menuDiscovery';

function item(overrides: Partial<MenuItem> & { id: string; name: string }): MenuItem {
  return {
    priceMinor: 8000,
    currency: 'INR',
    available: true,
    options: [],
    ...overrides,
  };
}

const menu: MenuResponse = {
  outlet: { id: 'demo-outlet', name: 'Demo' } as MenuResponse['outlet'],
  menuVersion: 'v1',
  language: 'en',
  contentVersion: 'c1',
  categories: [
    { id: 'drinks', name: 'Drinks', sortOrder: 2 },
    { id: 'tiffin', name: 'Tiffin', sortOrder: 1 },
  ],
  items: [
    item({ id: 'dosa', name: 'Masala Dosa', categoryId: 'tiffin' }),
    item({ id: 'idli', name: 'Idli Vada', categoryId: 'tiffin', available: false }),
    item({ id: 'coffee', name: 'Filter Coffee', categoryId: 'drinks' }),
    item({ id: 'sweet', name: 'Mysore Pak' }),
  ],
};

describe('menuSections', () => {
  it('orders categories and adds Other for uncategorised items', () => {
    const sections = menuSections(menu);
    expect(sections.map((s) => s.category.name)).toEqual(['Tiffin', 'Drinks', 'Other']);
    expect(sections[2]!.category.id).toBe(OTHER_CATEGORY_ID);
  });

  it('keeps unavailable items so they can be shown as sold out', () => {
    expect(menuSections(menu)[0]!.items.map((i) => i.id)).toContain('idli');
  });
});

describe('search', () => {
  it('normalises case, spacing and accents', () => {
    expect(normaliseSearch('  Masala   DOSA ')).toBe('masala dosa');
    expect(normaliseSearch('Café')).toBe('cafe');
  });

  it('matches by dish name substring, and an empty query matches all', () => {
    const dosa = menu.items[0]!;
    expect(matchesSearch(dosa, 'dosa')).toBe(true);
    expect(matchesSearch(dosa, 'coffee')).toBe(false);
    expect(matchesSearch(dosa, '   ')).toBe(true);
  });

  it('drops sections with no matches', () => {
    const result = searchSections(menuSections(menu), 'coffee');
    expect(result.map((s) => s.category.id)).toEqual(['drinks']);
    expect(itemCount(searchSections(menuSections(menu), 'zzz'))).toBe(0);
  });
});

describe('filterByCategory', () => {
  it('returns all sections when no category is chosen', () => {
    expect(filterByCategory(menuSections(menu), undefined)).toHaveLength(3);
  });

  it('narrows to the chosen category, and to nothing when search excluded it', () => {
    const sections = menuSections(menu);
    expect(filterByCategory(sections, 'drinks').map((s) => s.category.id)).toEqual([
      'drinks',
    ]);
    expect(filterByCategory(searchSections(sections, 'dosa'), 'drinks')).toEqual([]);
  });
});
