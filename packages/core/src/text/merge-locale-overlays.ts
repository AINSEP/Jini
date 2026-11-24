/**
 * @file One shared way for a feature's i18n module to fold per-locale "overlay" tables (audit
 * strings, match-type labels, password-field copy, …) into its main per-locale dictionary.
 *
 * Several `*-i18n.ts` modules each hand-rolled the same `Object.fromEntries(Object.entries(BASE)
 * .map(([locale, entries]) => [locale, { ...entries, ...(OVERLAY[locale] ?? {}) }]))` expression.
 * Hoisting it here keeps the "an overlay may not cover every locale" guard in one tested place
 * instead of an untestable module-level branch in each dictionary file.
 */

import type { LocaleDictionary } from './dictionary-translator.js';

/** The merged result: a fresh, caller-owned locale → (English source string → translated string) table. */
export type MergedLocaleDictionary = Record<string, Record<string, string>>;

/**
 * Returns a new dictionary with one entry per locale of `base` (overlay-only locales are ignored,
 * matching the hand-rolled expressions this replaced). Each locale's entries are `base[locale]`
 * followed by every overlay's entries for that locale, in argument order, so a later overlay wins
 * on a key collision. An overlay that has no entry for a locale contributes nothing to it.
 * Inputs are never mutated.
 */
export function mergeLocaleOverlays(
  { base }: { base: LocaleDictionary },
  { overlays = [] }: { overlays?: readonly LocaleDictionary[] } = {},
): MergedLocaleDictionary {
  return Object.fromEntries(
    Object.entries(base).map(([locale, entries]) => [
      locale,
      Object.assign({}, entries, ...overlays.map((overlay) => overlay[locale] ?? {})) as Record<string, string>,
    ]),
  );
}
