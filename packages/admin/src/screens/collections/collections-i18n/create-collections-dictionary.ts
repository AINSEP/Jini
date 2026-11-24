/**
 * @file Spanish dictionary for `Collections.tsx` (list + its three modals), `CollectionEntries.tsx`
 * (per-type entry list), and `CollectionEntryEditor.tsx` (entry editor). Same
 * `DICT[locale]?.[key] ?? key` shape `SettingsUi.tsx`'s own `const t` uses.
 *
 * A few entries are small `{placeholder}` templates rather than pre-split fragments — resolved with
 * a plain `.replace()` at the call site — since the interpolated value (a content-type or entry
 * label) sits in the middle of the Spanish sentence, not always in the same relative position
 * English puts it.
 *
 * Split by screen area (K4i: a dictionary file over 500 lines never blocks work, it is split by feature),
 * so the data lives in the `collections-*-i18n.ts` slices next to this file and this factory only composes
 * them. The host binds it once with its own shared-words dictionary (K4-i18n-common) and may pass
 * `productEntries` — per-locale entries whose key or value names the product (K3), which never ship in
 * this package and are composed last so they win on a collision.
 */
import { createDictionaryTranslator } from "@jini-ai/core/text";
import { mergeLocaleOverlays, type LocaleDictionary } from "@jini-ai/core/text";
import { COLLECTIONS_LIST_I18N } from "./collections-list-i18n.js";
import { COLLECTIONS_DIALOGS_I18N } from "./collections-dialogs-i18n.js";
import { COLLECTIONS_ENTRIES_I18N } from "./collections-entries-i18n.js";
import { COLLECTIONS_HOOKS_I18N } from "./collections-hooks-i18n.js";
import { COLLECTIONS_AUDIT_I18N, COLLECTIONS_EMBED_I18N } from "./collections-audit-embed-i18n.js";
import { entryLifecycleFailureMessage, lifecycleFailureMessage } from "./collections-lifecycle-i18n.js";

/**
 * The composed Collections dictionary, the translator the host's hooks and screens call, and the two
 * lifecycle failure messages. `t` is `COLLECTIONS_DICT[locale]?.[key] ?? commonDictionary[locale]?.[key] ?? key`
 * via `createDictionaryTranslator` (same fallback `trash-i18n.ts` uses) — a shared word this dict
 * doesn't carry for a locale still renders translated instead of falling straight to English.
 * Exported so the feature's `.hooks.ts` files (which have no JSX and build their own `t` closure
 * the way the `.tsx` screens in this feature do) can call it directly instead of duplicating the
 * lookup.
 */
export function createCollectionsDictionary(
  { commonDictionary, productEntries = {} }: { commonDictionary: LocaleDictionary; productEntries?: LocaleDictionary },
  _optional: Record<string, never> = {},
) {
  const dictionary = mergeLocaleOverlays(
    { base: COLLECTIONS_LIST_I18N },
    {
      overlays: [
        COLLECTIONS_DIALOGS_I18N, COLLECTIONS_ENTRIES_I18N, COLLECTIONS_HOOKS_I18N,
        COLLECTIONS_AUDIT_I18N, COLLECTIONS_EMBED_I18N, productEntries,
      ],
    },
  );
  const t = createDictionaryTranslator({ featureDictionary: dictionary }, { commonDictionary });
  return { dictionary, t, lifecycleFailureMessage, entryLifecycleFailureMessage };
}
