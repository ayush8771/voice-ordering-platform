/**
 * Field-level fallback and the content fingerprint.
 *
 * The rules under test are the contract in docs/API.md: English is canonical,
 * fallback is per field and only to English, a blank translation counts as
 * missing, and the content fingerprint moves for a text-only edit while
 * `menuVersion` does not (that half is asserted in `menuService.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import type { MenuCategoryDoc, MenuItemDoc, OutletDoc } from '../../models/menu.js';
import {
  categoryName,
  computeContentVersion,
  fallback,
  itemDescription,
  itemName,
  optionLabel,
  outletName,
  pick,
} from './localize.js';

const OUTLET: OutletDoc = {
  publicId: 'demo-outlet',
  name: 'Demo Tiffin Centre',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  active: true,
};

const DOSA: MenuItemDoc = {
  publicId: 'item-dosa',
  outletId: 'demo-outlet',
  name: 'Masala Dosa',
  description: 'Crisp dosa',
  translations: {
    kn: { name: 'ಮಸಾಲೆ ದೋಸೆ', description: 'ಗರಿಗರಿ ದೋಸೆ' },
    // Name only: the Hindi description must fall back on its own.
    hi: { name: 'मसाला डोसा' },
  },
  priceMinor: 8000,
  currency: 'INR',
  active: true,
  sortOrder: 1,
  options: [
    {
      publicId: 'opt-ghee',
      label: 'Ghee roast',
      translations: { kn: { label: 'ತುಪ್ಪ ರೋಸ್ಟ್' } },
      priceDeltaMinor: 2500,
      active: true,
    },
  ],
};

/** The same item with its translations removed, not set to `undefined`. */
function untranslated(): MenuItemDoc {
  const { translations: _translations, ...rest } = DOSA;
  return rest;
}

describe('fallback', () => {
  it('prefers a translation over the English base', () => {
    expect(fallback('Masala Dosa', 'ಮಸಾಲೆ ದೋಸೆ')).toBe('ಮಸಾಲೆ ದೋಸೆ');
  });

  it('falls back when a translation is absent', () => {
    expect(fallback('Masala Dosa', undefined)).toBe('Masala Dosa');
  });

  it('treats a blank or whitespace-only translation as missing', () => {
    // A half-finished edit, not an intentionally empty label.
    expect(fallback('Masala Dosa', '')).toBe('Masala Dosa');
    expect(fallback('Masala Dosa', '   ')).toBe('Masala Dosa');
  });

  it('trims a translation it does use', () => {
    expect(fallback('Idli', '  ಇಡ್ಲಿ  ')).toBe('ಇಡ್ಲಿ');
  });

  it('still shows a translation of a field English does not have', () => {
    expect(fallback(undefined, 'ಗರಿಗರಿ')).toBe('ಗರಿಗರಿ');
  });

  it('reports nothing when neither side has the field', () => {
    expect(fallback(undefined, undefined)).toBeUndefined();
  });
});

describe('pick', () => {
  it('never looks up a translation for English', () => {
    // The base field *is* the English value, so there is no second place an
    // English string could live and disagree.
    expect(pick(DOSA.translations, 'en')).toBeUndefined();
  });

  it('returns the requested language only', () => {
    expect(pick(DOSA.translations, 'hi')).toEqual({ name: 'मसाला डोसा' });
  });
});

describe('resolving one item', () => {
  it('serves the English base when English is asked for', () => {
    expect(itemName(DOSA, 'en')).toBe('Masala Dosa');
    expect(itemDescription(DOSA, 'en')).toBe('Crisp dosa');
  });

  it('serves a fully translated language', () => {
    expect(itemName(DOSA, 'kn')).toBe('ಮಸಾಲೆ ದೋಸೆ');
    expect(itemDescription(DOSA, 'kn')).toBe('ಗರಿಗರಿ ದೋಸೆ');
  });

  it('falls back per field, not per item', () => {
    // The whole point: a Hindi name with no Hindi description must not drag
    // the name back to English too.
    expect(itemName(DOSA, 'hi')).toBe('मसाला डोसा');
    expect(itemDescription(DOSA, 'hi')).toBe('Crisp dosa');
  });

  it('falls back for an item with no translations at all', () => {
    expect(itemName(untranslated(), 'kn')).toBe('Masala Dosa');
  });

  it('resolves option labels, categories and the outlet the same way', () => {
    const option = DOSA.options?.[0];
    expect(option).toBeDefined();
    expect(optionLabel(option!, 'kn')).toBe('ತುಪ್ಪ ರೋಸ್ಟ್');
    expect(optionLabel(option!, 'hi')).toBe('Ghee roast');

    const category: MenuCategoryDoc = {
      publicId: 'cat-tiffin',
      outletId: 'demo-outlet',
      name: 'Tiffin',
      translations: { kn: { name: 'ಟಿಫಿನ್' } },
      sortOrder: 1,
      active: true,
    };
    expect(categoryName(category, 'kn')).toBe('ಟಿಫಿನ್');
    expect(categoryName(category, 'hi')).toBe('Tiffin');

    expect(outletName(OUTLET, 'kn')).toBe('Demo Tiffin Centre');
  });
});

describe('computeContentVersion', () => {
  const version = (language: 'en' | 'kn' | 'hi', items: readonly MenuItemDoc[]) =>
    computeContentVersion(language, OUTLET, [], items);

  it('is stable for the same text', () => {
    expect(version('kn', [DOSA])).toBe(version('kn', [DOSA]));
  });

  it('differs between languages even when every field falls back', () => {
    const plain = untranslated();
    expect(version('kn', [plain])).not.toBe(version('en', [plain]));
  });

  it('changes when a translation in that language changes', () => {
    const edited: MenuItemDoc = {
      ...DOSA,
      translations: { ...DOSA.translations, kn: { name: 'ಮಸಾಲ ದೋಸೆ' } },
    };
    expect(version('kn', [edited])).not.toBe(version('kn', [DOSA]));
  });

  it('ignores a translation in another language', () => {
    // A Hindi fix must not invalidate a Kannada client's cache.
    const edited: MenuItemDoc = {
      ...DOSA,
      translations: { ...DOSA.translations, hi: { name: 'मसाला डोसा (नया)' } },
    };
    expect(version('kn', [edited])).toBe(version('kn', [DOSA]));
    expect(version('hi', [edited])).not.toBe(version('hi', [DOSA]));
  });

  it('changes when an option label is translated', () => {
    const edited: MenuItemDoc = {
      ...DOSA,
      options: (DOSA.options ?? []).map((option) => ({
        ...option,
        translations: { kn: { label: 'ತುಪ್ಪ' } },
      })),
    };
    expect(version('kn', [edited])).not.toBe(version('kn', [DOSA]));
  });

  it('does not depend on listing order', () => {
    const idli: MenuItemDoc = { ...DOSA, publicId: 'item-idli', name: 'Idli' };
    expect(version('kn', [DOSA, idli])).toBe(version('kn', [idli, DOSA]));
  });
});
