import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '@vop/shared';
import { en } from './en';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  isLanguage,
  readStoredLanguage,
  selectLanguage,
  type LanguageStore,
} from './storage';
import {
  DICTIONARIES,
  MESSAGE_KEYS,
  interpolate,
  lookup,
  templateParts,
  translate,
  translatePlural,
} from './translate';

/** In-memory stand-in for localStorage. */
function memoryStore(initial: Record<string, string> = {}): LanguageStore & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (Object.hasOwn(data, key) ? (data[key] ?? null) : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const brokenStore: LanguageStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('translate', () => {
  it('looks up the same key in all three languages', () => {
    expect(translate('en', 'cart.heading')).toBe('Your order');
    expect(translate('kn', 'cart.heading')).toBe('ನಿಮ್ಮ ಆರ್ಡರ್');
    expect(translate('hi', 'cart.heading')).toBe('आपका ऑर्डर');
  });

  it('fills placeholders in every language', () => {
    expect(translate('en', 'item.add', { name: 'Masala Dosa' })).toBe(
      'Add Masala Dosa',
    );
    expect(translate('kn', 'item.add', { name: 'Masala Dosa' })).toContain(
      'Masala Dosa',
    );
    expect(translate('hi', 'item.add', { name: 'Masala Dosa' })).toContain(
      'Masala Dosa',
    );
  });

  it('keeps backend content verbatim inside translated text', () => {
    const name = 'ಮಸಾಲೆ ದೋಸೆ {weird}';
    expect(translate('hi', 'item.add', { name })).toContain(name);
  });

  it('chooses singular and plural forms', () => {
    expect(translatePlural('en', 'cart.view', 1)).toBe('View your order (1 item)');
    expect(translatePlural('en', 'cart.view', 3)).toBe('View your order (3 items)');
    expect(translatePlural('kn', 'cart.view', 3)).toContain('3');
  });

  it('leaves an unknown placeholder visible rather than dropping text', () => {
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}');
    expect(interpolate('Hello {name}')).toBe('Hello {name}');
  });

  it('splits a template around slots for inline markup', () => {
    const parts = templateParts('en', 'pay.cashHint');
    expect(parts.some((p) => p.kind === 'slot' && p.name === 'token')).toBe(true);
    expect(
      parts.map((p) => (p.kind === 'text' ? p.text : `{${p.name}}`)).join(''),
    ).toBe(en['pay.cashHint']);
  });
});

describe('English fallback', () => {
  it('uses English for a key missing from another language', () => {
    const sparse = { en, kn: {}, hi: { 'cart.heading': 'आपका ऑर्डर' } };
    expect(lookup(sparse, 'kn', 'cart.heading')).toBe('Your order');
    expect(lookup(sparse, 'hi', 'cart.remove')).toBe('Remove');
    expect(lookup(sparse, 'hi', 'cart.heading')).toBe('आपका ऑर्डर');
  });

  it('has no missing or empty keys in Kannada or Hindi today', () => {
    for (const language of LANGUAGES) {
      const missing = MESSAGE_KEYS.filter((key) => !DICTIONARIES[language][key]);
      expect({ language, missing }).toEqual({ language, missing: [] });
    }
  });

  it('keeps every placeholder of the English source in each translation', () => {
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
    for (const language of LANGUAGES) {
      for (const key of MESSAGE_KEYS) {
        const translated = DICTIONARIES[language][key];
        if (translated === undefined) continue;
        expect({ key, language, slots: placeholders(translated) }).toEqual({
          key,
          language,
          slots: placeholders(en[key]),
        });
      }
    }
  });

  it('has no translation keys outside the English source', () => {
    for (const language of LANGUAGES) {
      for (const key of Object.keys(DICTIONARIES[language])) {
        expect(Object.hasOwn(en, key)).toBe(true);
      }
    }
  });
});

describe('stored language', () => {
  it('defaults to English when nothing is stored', () => {
    expect(readStoredLanguage(memoryStore())).toBe('en');
    expect(readStoredLanguage(undefined)).toBe(DEFAULT_LANGUAGE);
  });

  it('ignores invalid stored values', () => {
    for (const value of ['fr', 'EN', '', 'kn ', 'null', '{"lang":"kn"}']) {
      expect(readStoredLanguage(memoryStore({ [LANGUAGE_STORAGE_KEY]: value }))).toBe(
        'en',
      );
    }
  });

  it('restores a valid stored language', () => {
    expect(readStoredLanguage(memoryStore({ [LANGUAGE_STORAGE_KEY]: 'kn' }))).toBe(
      'kn',
    );
    expect(readStoredLanguage(memoryStore({ [LANGUAGE_STORAGE_KEY]: 'hi' }))).toBe(
      'hi',
    );
  });

  it('falls back to English when storage throws', () => {
    expect(readStoredLanguage(brokenStore)).toBe('en');
  });

  it('validates language codes', () => {
    expect(isLanguage('kn')).toBe(true);
    expect(isLanguage('ta')).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
  });
});

describe('selecting a language', () => {
  it('switches and persists, so a reload restores it', () => {
    const store = memoryStore();
    expect(selectLanguage(store, 'hi', 'en')).toBe('hi');
    expect(store.data[LANGUAGE_STORAGE_KEY]).toBe('hi');
    expect(readStoredLanguage(store)).toBe('hi');
  });

  it('refuses an invalid selection and keeps the current language', () => {
    const store = memoryStore({ [LANGUAGE_STORAGE_KEY]: 'kn' });
    expect(selectLanguage(store, 'xx', 'kn')).toBe('kn');
    expect(store.data[LANGUAGE_STORAGE_KEY]).toBe('kn');
  });

  it('still switches for this page view when storage is blocked', () => {
    expect(selectLanguage(brokenStore, 'kn', 'en')).toBe('kn');
  });
});
