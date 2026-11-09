import { describe, expect, it } from 'vitest';
import { ApiError } from '../../middleware/errors.js';
import type { MenuItemDoc } from '../../models/menu.js';
import {
  createInMemoryMenuRepository,
  SAMPLE_MENU,
  type MenuDataset,
} from './inMemoryMenuRepository.js';
import { computeMenuVersion, createMenuService } from './menuService.js';

function service(dataset: MenuDataset = SAMPLE_MENU) {
  return createMenuService(createInMemoryMenuRepository(dataset));
}

function withItems(items: readonly MenuItemDoc[]): MenuDataset {
  return { ...SAMPLE_MENU, items };
}

describe('getPublicMenu', () => {
  it('returns the outlet, categories and priced items', async () => {
    const menu = await service().getPublicMenu('demo-outlet');

    expect(menu.outlet).toEqual({
      id: 'demo-outlet',
      name: 'Demo Tiffin Centre',
      currency: 'INR',
    });
    expect(menu.categories).toEqual([
      { id: 'cat-tiffin', name: 'Tiffin', sortOrder: 1 },
      { id: 'cat-drinks', name: 'Drinks', sortOrder: 2 },
    ]);
    expect(menu.items.map((item) => item.id)).toEqual([
      'item-masala-dosa',
      'item-idli',
      'item-idli-sambar',
      'item-medu-vada',
      'item-filter-coffee',
      'item-cold-coffee',
    ]);
    expect(typeof menu.menuVersion).toBe('string');
  });

  it('omits an inactive category', async () => {
    const menu = await service().getPublicMenu('demo-outlet');
    expect(menu.categories.map((c) => c.id)).not.toContain('cat-hidden');
  });

  it('shows a sold-out item as unavailable rather than hiding it', async () => {
    const menu = await service().getPublicMenu('demo-outlet');
    const vada = menu.items.find((item) => item.id === 'item-medu-vada');

    expect(vada).toBeDefined();
    expect(vada?.available).toBe(false);
  });

  it('exposes only active options, with labels and deltas', async () => {
    const menu = await service().getPublicMenu('demo-outlet');
    const dosa = menu.items.find((item) => item.id === 'item-masala-dosa');

    expect(dosa?.options).toEqual([
      { id: 'opt-extra-chutney', label: 'Extra chutney', priceDeltaMinor: 1000 },
      { id: 'opt-ghee', label: 'Ghee roast', priceDeltaMinor: 2500 },
    ]);
  });

  it('treats a missing options array as no options', async () => {
    const menu = await service().getPublicMenu('demo-outlet');
    const sambar = menu.items.find((item) => item.id === 'item-idli-sambar');

    expect(sambar?.options).toEqual([]);
  });

  it('scopes items to the requested outlet', async () => {
    const menu = await service().getPublicMenu('other-outlet');

    expect(menu.items.map((item) => item.id)).toEqual(['item-poha']);
  });

  it('reports an inactive outlet exactly like an unknown one', async () => {
    const closed = await service()
      .getPublicMenu('closed-outlet')
      .catch((error: unknown) => error);
    const unknown = await service()
      .getPublicMenu('no-such-outlet')
      .catch((error: unknown) => error);

    for (const error of [closed, unknown]) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    }
    expect((closed as ApiError).message).toBe((unknown as ApiError).message);
  });

  it('exposes no outlet configuration beyond id, name and currency', async () => {
    const menu = await service().getPublicMenu('demo-outlet');

    expect(Object.keys(menu.outlet).sort()).toEqual(['currency', 'id', 'name']);
    expect(JSON.stringify(menu)).not.toContain('slug');
    expect(JSON.stringify(menu)).not.toContain('Asia/Kolkata');
  });

  it('refuses to serve a non-integer stored price', async () => {
    const broken = withItems([
      {
        publicId: 'item-broken',
        outletId: 'demo-outlet',
        name: 'Broken',
        priceMinor: 80.5,
        currency: 'INR',
        active: true,
        sortOrder: 1,
      },
    ]);

    await expect(service(broken).getPublicMenu('demo-outlet')).rejects.toThrow(
      /integer number of minor units/,
    );
  });
});

describe('getPublicMenu language', () => {
  it('serves English and echoes the language when none is asked for', async () => {
    const menu = await service().getPublicMenu('demo-outlet');

    expect(menu.language).toBe('en');
    expect(menu.items.find((item) => item.id === 'item-idli')?.name).toBe('Idli');
    expect(menu.contentVersion).toEqual(expect.any(String));
  });

  it('resolves every string into the requested language', async () => {
    const menu = await service().getPublicMenu('demo-outlet', 'kn');
    const dosa = menu.items.find((item) => item.id === 'item-masala-dosa');

    expect(menu.language).toBe('kn');
    expect(menu.outlet.name).toBe('ಡೆಮೊ ಟಿಫಿನ್ ಸೆಂಟರ್');
    expect(menu.categories.find((c) => c.id === 'cat-tiffin')?.name).toBe('ಟಿಫಿನ್');
    expect(dosa?.name).toBe('ಮಸಾಲೆ ದೋಸೆ');
    expect(dosa?.description).toBe('ಮಸಾಲೆ ಆಲೂಗಡ್ಡೆ ತುಂಬಿದ ಗರಿಗರಿ ದೋಸೆ');
    expect(dosa?.options.find((o) => o.id === 'opt-extra-chutney')?.label).toBe(
      'ಹೆಚ್ಚುವರಿ ಚಟ್ನಿ',
    );
  });

  it('falls back to English per field, not per item', async () => {
    const menu = await service().getPublicMenu('demo-outlet', 'hi');
    const dosa = menu.items.find((item) => item.id === 'item-masala-dosa');

    // The sample item has a Hindi name but no Hindi description.
    expect(dosa?.name).toBe('मसाला डोसा');
    expect(dosa?.description).toBe('Crisp dosa with spiced potato filling');
    // No Hindi outlet name at all.
    expect(menu.outlet.name).toBe('Demo Tiffin Centre');
    // No Hindi option label on this one.
    expect(dosa?.options.find((o) => o.id === 'opt-ghee')?.label).toBe('Ghee roast');
  });

  it('serves an untranslated item in English whatever the language', async () => {
    const menu = await service().getPublicMenu('demo-outlet', 'kn');

    expect(menu.items.find((item) => item.id === 'item-cold-coffee')?.name).toBe(
      'Cold Coffee',
    );
  });

  it('keeps menuVersion language-independent and moves contentVersion', async () => {
    const en = await service().getPublicMenu('demo-outlet');
    const kn = await service().getPublicMenu('demo-outlet', 'kn');

    // Same prices and availability, so a quote taken in one language is still
    // valid when the customer switches: `menuVersion` must not move.
    expect(kn.menuVersion).toBe(en.menuVersion);
    expect(kn.contentVersion).not.toBe(en.contentVersion);
  });

  it('exposes no outlet configuration in a translated response either', async () => {
    const menu = await service().getPublicMenu('demo-outlet', 'kn');

    expect(Object.keys(menu.outlet).sort()).toEqual(['currency', 'id', 'name']);
  });
});

describe('computeMenuVersion', () => {
  const base = SAMPLE_MENU.items.filter((item) => item.outletId === 'demo-outlet');
  const categories = SAMPLE_MENU.categories.filter((c) => c.outletId === 'demo-outlet');

  it('is stable for the same menu regardless of listing order', () => {
    expect(computeMenuVersion(categories, base)).toBe(
      computeMenuVersion([...categories].reverse(), [...base].reverse()),
    );
  });

  it('changes when a price changes', () => {
    const changed = base.map((item) =>
      item.publicId === 'item-idli' ? { ...item, priceMinor: 4500 } : item,
    );
    expect(computeMenuVersion(categories, changed)).not.toBe(
      computeMenuVersion(categories, base),
    );
  });

  it('changes when availability changes', () => {
    const changed = base.map((item) =>
      item.publicId === 'item-idli' ? { ...item, active: false } : item,
    );
    expect(computeMenuVersion(categories, changed)).not.toBe(
      computeMenuVersion(categories, base),
    );
  });

  it('changes when an option delta or option availability changes', () => {
    const deltaChanged = base.map((item) =>
      item.publicId === 'item-masala-dosa'
        ? {
            ...item,
            options: (item.options ?? []).map((option) =>
              option.publicId === 'opt-ghee'
                ? { ...option, priceDeltaMinor: 3000 }
                : option,
            ),
          }
        : item,
    );
    const activeChanged = base.map((item) =>
      item.publicId === 'item-masala-dosa'
        ? {
            ...item,
            options: (item.options ?? []).map((option) =>
              option.publicId === 'opt-ghee' ? { ...option, active: false } : option,
            ),
          }
        : item,
    );

    const original = computeMenuVersion(categories, base);
    expect(computeMenuVersion(categories, deltaChanged)).not.toBe(original);
    expect(computeMenuVersion(categories, activeChanged)).not.toBe(original);
  });

  it('does not change when a translation is added or edited', () => {
    // The invariant that keeps a Kannada typo fix from turning every
    // in-flight quote into a 409 "re-confirm" (docs/API.md menu section).
    const translated = base.map((item) =>
      item.publicId === 'item-idli'
        ? { ...item, translations: { kn: { name: 'ಇಡ್ಲಿ (ಹೊಸ)' } } }
        : item,
    );
    const categoriesTranslated = categories.map((category) =>
      category.publicId === 'cat-drinks'
        ? { ...category, translations: { hi: { name: 'पेय पदार्थ' } } }
        : category,
    );

    const original = computeMenuVersion(categories, base);
    expect(computeMenuVersion(categories, translated)).toBe(original);
    expect(computeMenuVersion(categoriesTranslated, base)).toBe(original);
  });

  it('changes when a category is renamed or reordered', () => {
    const renamed = categories.map((category) =>
      category.publicId === 'cat-drinks'
        ? { ...category, name: 'Beverages' }
        : category,
    );
    expect(computeMenuVersion(renamed, base)).not.toBe(
      computeMenuVersion(categories, base),
    );
  });
});
