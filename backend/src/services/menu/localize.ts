/**
 * Resolving stored menu text into one language.
 *
 * Two rules, and nothing else:
 *
 * - **English is canonical.** The base field is the English string; a
 *   translation is an overlay. There is therefore no "missing English" case to
 *   handle and no second place an English name can live.
 * - **Fallback is per field, and only ever to English.** A Kannada name with
 *   no Kannada description yields the Kannada name and the English
 *   description, because a merchant translating a menu does it one field at a
 *   time and dropping the whole item back to English would be worse. There is
 *   no `hi -> en -> kn` chain and no regional variant.
 *
 * A blank or whitespace-only translation counts as missing: it is a
 * half-finished edit, not an intentionally empty label.
 */

import { createHash } from 'node:crypto';
import type { Language, Translations } from '@vop/shared';
import type { MenuCategoryDoc, MenuItemDoc, OutletDoc } from '../../models/menu.js';

/** The translated fields for one language, or none when English is asked for. */
export function pick<Field extends string>(
  translations: Translations<Field> | undefined,
  language: Language,
): Partial<Record<Field, string>> | undefined {
  // Not a lookup on `en`: the base field is the English value, so asking for
  // English can only ever mean "use the base".
  return language === 'en' ? undefined : translations?.[language];
}

export function fallback(base: string, translated: string | undefined): string;
export function fallback(
  base: string | undefined,
  translated: string | undefined,
): string | undefined;
export function fallback(
  base: string | undefined,
  translated: string | undefined,
): string | undefined {
  const value = translated?.trim();
  // A translation of a field the English menu does not have is still shown:
  // some text beats none, and the merchant clearly meant to say it.
  return value === undefined || value === '' ? base : value;
}

/** The item's name in one language. Always defined: English is the floor. */
export function itemName(item: MenuItemDoc, language: Language): string {
  return fallback(item.name, pick(item.translations, language)?.name);
}

export function itemDescription(
  item: MenuItemDoc,
  language: Language,
): string | undefined {
  return fallback(item.description, pick(item.translations, language)?.description);
}

export function categoryName(category: MenuCategoryDoc, language: Language): string {
  return fallback(category.name, pick(category.translations, language)?.name);
}

export function outletName(outlet: OutletDoc, language: Language): string {
  return fallback(outlet.name, pick(outlet.translations, language)?.name);
}

export function optionLabel(
  option: { readonly label: string; readonly translations?: Translations<'label'> },
  language: Language,
): string {
  return fallback(option.label, pick(option.translations, language)?.label);
}

/**
 * Fingerprint of the text a menu response actually displays in one language.
 *
 * Deliberately **separate from `menuVersion`**, which stays language
 * independent. `menuVersion` gates ordering: a quote whose `menuVersion` has
 * moved is refused with `409` "re-confirm", so folding translations into it
 * would make a merchant's Kannada typo fix bounce every customer mid-order
 * back to the review screen for a change that altered no price. This one is
 * for caching and client refresh only, and nothing in the ordering path reads
 * it.
 *
 * The language is part of the hash so two languages are never reported as the
 * same content even when every field has fallen back to English.
 */
export function computeContentVersion(
  language: Language,
  outlet: OutletDoc,
  categories: readonly MenuCategoryDoc[],
  items: readonly MenuItemDoc[],
): string {
  const canonicalCategories = [...categories]
    .map((category) => [category.publicId, categoryName(category, language)])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  const canonicalItems = [...items]
    .map((item) => [
      item.publicId,
      itemName(item, language),
      itemDescription(item, language) ?? '',
      [...(item.options ?? [])]
        .map((option) => [option.publicId, optionLabel(option, language)])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  return createHash('sha256')
    .update(
      JSON.stringify([
        language,
        outletName(outlet, language),
        canonicalCategories,
        canonicalItems,
      ]),
    )
    .digest('hex')
    .slice(0, 16);
}
