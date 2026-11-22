/**
 * @file Builds a `{ locale: { key: translation } }` table from index-aligned lists: one English
 * key list and, per locale, its translations in the same order. Shared by the forms dictionaries
 * that store their strings this way (`forms-leave-guard-i18n.ts`, `forms-field-settings-i18n.ts`).
 */

/**
 * A missing position (a locale's list shorter than the keys) falls back to the English key, so a
 * dropped translation shows English rather than `undefined`. The per-file tests pin that every
 * shipped list is complete; this fallback is what a future partial locale would get.
 *
 * @complexity O(locales × keys).
 */
export function indexAlignedTranslations({ keys, translations }: {
  keys: readonly string[];
  translations: Readonly<Record<string, readonly string[]>>;
}): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(translations).map(([locale, values]) => [
      locale,
      Object.fromEntries(keys.map((key, index) => [key, values[index] ?? key])),
    ]),
  );
}
