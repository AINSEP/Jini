/**
 * @file Spanish dictionary for `Taxonomy.tsx` — the Categories & Tags screen, its new-term/
 * new-taxonomy forms, the merge wizard, the term detail panel, and the two delete dialogs. Same
 * `DICT[locale]?.[key] ?? key` shape `SettingsUi.tsx`'s own `const t` uses.
 *
 * `{placeholder}` templates are resolved with a plain `.replace()` at the call site — see
 * `collections-i18n.ts`'s own header for why (the interpolated value's position in the Spanish
 * sentence doesn't always match English). `t()` falls back to `COMMON_I18N` via
 * `createDictionaryTranslator`, same as `trash-i18n.ts`.
 *
 * Split by screen area (K4i: a dictionary file over 500 lines never blocks work, it is split by feature),
 * so the data lives in the `taxonomy-*-i18n.ts` slices next to this file and this factory only composes
 * them. The host binds it once with its own shared-words dictionary (K4-i18n-common) and may pass
 * `productEntries` — per-locale entries whose key or value names the product (K3), which never ship in
 * this package and are composed last so they win on a collision.
 */
import { createDictionaryTranslator } from "@jini-ai/core/text";
import { mergeLocaleOverlays, type LocaleDictionary } from "../../../shell/lib/merge-locale-overlays.js";
import { TAXONOMY_SCREEN_I18N } from "./taxonomy-screen-i18n.js";
import { TAXONOMY_MERGE_I18N } from "./taxonomy-merge-i18n.js";
import { TAXONOMY_DETAIL_I18N } from "./taxonomy-detail-i18n.js";
import { TAXONOMY_HOOKS_I18N } from "./taxonomy-hooks-i18n.js";
import { TAXONOMY_TERM_PICKER_I18N, TAXONOMY_TERM_PICKER_ADD_I18N, TAXONOMY_TERM_PICKER_REVEAL_I18N } from "./taxonomy-term-picker-i18n.js";

/**
 * The composed Categories & Tags dictionary plus the translator the host's hooks and screens call: the
 * slices are folded through `mergeLocaleOverlays` (a function parameter, not an index into the
 * dictionary), so the dictionary is only ever indexed by `createDictionaryTranslator` — the
 * host's dictionary-lookup-sinks guard — and a shared word a slice lacks falls to `commonDictionary`.
 */
export function createTaxonomyDictionary(
  { commonDictionary, productEntries = {} }: { commonDictionary: LocaleDictionary; productEntries?: LocaleDictionary },
  _optional: Record<string, never> = {},
) {
  const dictionary = mergeLocaleOverlays(
    { base: TAXONOMY_SCREEN_I18N },
    { overlays: [TAXONOMY_MERGE_I18N, TAXONOMY_DETAIL_I18N, TAXONOMY_HOOKS_I18N, TAXONOMY_TERM_PICKER_I18N, TAXONOMY_TERM_PICKER_ADD_I18N, TAXONOMY_TERM_PICKER_REVEAL_I18N, productEntries] },
  );
  const t = createDictionaryTranslator({ featureDictionary: dictionary }, { commonDictionary });
  return { dictionary, t };
}
