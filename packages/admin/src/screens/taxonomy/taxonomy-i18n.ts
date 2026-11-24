import { createDictionaryTranslator, type DictionaryTranslator, type LocaleDictionary } from "@jini-ai/core/text";
import { TAXONOMY_DICT_PART_1 } from "./i18n/taxonomy-dict-1.js";
import { TAXONOMY_DICT_PART_2 } from "./i18n/taxonomy-dict-2.js";
import { TAXONOMY_DICT_PART_3, TERM_PICKER_I18N } from "./i18n/taxonomy-dict-3.js";
import { TERM_PICKER_ADD_I18N, TERM_PICKER_REVEAL_I18N } from "./i18n/taxonomy-dict-4.js";

/**
 * @file Spanish dictionary for `Taxonomy.tsx` — the Categories & Tags screen, its new-term/
 * new-taxonomy forms, the merge wizard, the term detail panel, and the two delete dialogs. Same
 * `DICT[locale]?.[key] ?? key` shape `SettingsUi.tsx`'s own `const t` uses.
 *
 * `{placeholder}` templates are resolved with a plain `.replace()` at the call site — see
 * `collections-i18n.ts`'s own header for why (the interpolated value's position in the Spanish
 * sentence doesn't always match English). `t()` falls back to `COMMON_I18N` via
 * `createDictionaryTranslator`, same as `trash-i18n.ts`.
 */

const TAXONOMY_DICT: Record<string, Record<string, string>> = { ...TAXONOMY_DICT_PART_1, ...TAXONOMY_DICT_PART_2, ...TAXONOMY_DICT_PART_3 };

// Same extension pattern as `forms-i18n.ts`/`collections-i18n.ts`: merging through a parameter keeps
// `TAXONOMY_DICT` itself indexed only by `createDictionaryTranslator` (dictionary-lookup-sinks guard).
function mergeDictionaryTranslations(
  dictionary: Record<string, Record<string, string>>,
  translationsByLocale: Record<string, Record<string, string>>,
) {
  for (const [locale, translations] of Object.entries(translationsByLocale)) {
    const block = dictionary[locale];
    if (block === undefined) throw new Error(`taxonomy dictionary has no ${locale} block to extend`);
    Object.assign(block, translations);
  }
}

mergeDictionaryTranslations(TAXONOMY_DICT, TERM_PICKER_I18N);
mergeDictionaryTranslations(TAXONOMY_DICT, TERM_PICKER_ADD_I18N);
mergeDictionaryTranslations(TAXONOMY_DICT, TERM_PICKER_REVEAL_I18N);

/** The host binds its commonDictionary once. `t` is `TAXONOMY_DICT[locale]?.[key] ?? commonDictionary[locale]?.[key] ?? key`
 *  via `createDictionaryTranslator`, so a shared word this dict doesn't carry for a locale still renders translated
 *  instead of falling straight to English. The host's `.hooks.ts` files (no JSX) import the bound `t` directly. */
export function createTaxonomyDictionary(
  { commonDictionary }: { commonDictionary: LocaleDictionary },
  _optional = {},
): { t: DictionaryTranslator } {
  const featureDictionary = TAXONOMY_DICT;
  return { t: createDictionaryTranslator({ featureDictionary }, { commonDictionary }) };
}