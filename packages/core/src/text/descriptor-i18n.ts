/**
 * @file The optional `i18n` block a plugin descriptor carries so its own person-facing text (labels,
 * help, guidance) renders in the viewer's language without core naming the plugin's strings.
 *
 * Shape: `{ "<locale>": { "<English source text>": "<translation>" } }`. Keyed by the exact English
 * string the descriptor declares, so the admin looks a string up by the text it already has and falls
 * back to that English when a locale or a string has no entry. A key that matches no descriptor string
 * is harmless (never shown), so a reworded English string only loses its translation, never the host.
 *
 * Shared by every descriptor parser that has person-facing text (deploy targets,
 * `@jini-ai/devops/deploy`'s `parseDeployTargetsFile`; a host's own descriptor parsers).
 */

/** Locale → English source text → translation. */
export type DescriptorI18n = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** A BCP 47-shaped tag as the admin's locales spell them (`es`, `pt-BR`, `zh-TW`). */
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const MAX_LOCALES = 64;
const MAX_ENTRIES_PER_LOCALE = 200;
/** Matches the longest descriptor string (a help text). */
const MAX_SOURCE_LENGTH = 500;
/** Translations run longer than their English source. */
const MAX_TRANSLATION_LENGTH = 2000;

/**
 * A descriptor's `i18n` block (absent = English only), or the reason it is invalid.
 *
 * @complexity O(l·e) in locales times entries, both capped.
 */
export function parseDescriptorI18n({ value, at }: { readonly value: unknown; readonly at: string }, _optional: Record<string, never> = {}): DescriptorI18n | undefined | string {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return `${at} must map locales to translations`;
  const locales = Object.entries(value);
  if (locales.length > MAX_LOCALES) return `${at} must declare at most ${MAX_LOCALES} locales`;

  const parsed: Record<string, Record<string, string>> = {};
  for (const [locale, entries] of locales) {
    if (!LOCALE_PATTERN.test(locale)) return `${at} has an invalid locale '${locale}'`;
    const translations = parseLocaleTranslations({ entries, at: `${at}.${locale}` });
    if (typeof translations === "string") return translations;
    parsed[locale] = translations;
  }
  return parsed;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate one locale's bounded dictionary, retaining the first invalid entry's reason. */
function parseLocaleTranslations(input: { readonly entries: unknown; readonly at: string }, _options = {}): Record<string, string> | string {
  const { entries, at } = input;
  if (!isPlainObject(entries)) return `${at} must map English text to its translation`;
  const pairs = Object.entries(entries);
  if (pairs.length > MAX_ENTRIES_PER_LOCALE) return `${at} must declare at most ${MAX_ENTRIES_PER_LOCALE} strings`;
  for (const [source, translation] of pairs) {
    if (source.trim() === "" || source.length > MAX_SOURCE_LENGTH) return `${at} keys must be non-empty English text of at most ${MAX_SOURCE_LENGTH} characters`;
    if (typeof translation !== "string" || translation.trim() === "" || translation.length > MAX_TRANSLATION_LENGTH) {
      return `${at} translations must be non-empty strings of at most ${MAX_TRANSLATION_LENGTH} characters`;
    }
  }
  return Object.fromEntries(pairs) as Record<string, string>;
}
