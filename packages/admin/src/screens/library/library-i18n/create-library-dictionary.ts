/**
 * @file Factory for the Library screen's dictionary. The data lives in `library-i18n-data.ts`; the host binds this
 * once with its own shared-words dictionary and may pass `productEntries` — per-locale entries whose key or value
 * names the product, which never ship in this package and are composed last so they win on a collision.
 * `t` looks up the feature's own key first, then the shared-words dictionary, then the raw English key.
 */
import { createDictionaryTranslator, mergeLocaleOverlays, type LocaleDictionary } from "@jini-ai/core/text";
import { LIBRARY_I18N } from "./library-i18n-data.js";

export function createLibraryDictionary(
  { commonDictionary, productEntries = {} }: { commonDictionary: LocaleDictionary; productEntries?: LocaleDictionary },
  _optional: Record<string, never> = {},
) {
  const dictionary = mergeLocaleOverlays({ base: LIBRARY_I18N }, { overlays: [productEntries] });
  const t = createDictionaryTranslator({ featureDictionary: dictionary }, { commonDictionary });
  return { dictionary, t };
}
