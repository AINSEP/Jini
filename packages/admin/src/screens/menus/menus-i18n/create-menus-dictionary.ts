/**
 * @file Spanish dictionary for `Menus.tsx` (list) and `MenuEditor.tsx` (tree editor). `t()` falls
 * back to the host's shared-words dictionary via `createDictionaryTranslator`, same as `trash-i18n.ts`.
 *
 * Out of scope: the native `window.confirm()` prompt `ItemRow`'s Remove button opens for an item
 * with descendants — a browser-chrome dialog, not this app's own styled `ConfirmDialog` surface.
 *
 * Split by screen area (K4i: a dictionary file over 500 lines never blocks work, it is split by feature),
 * so the data lives in the `menus-*-i18n.ts` slices next to this file and this factory only composes
 * them. The host binds it once with its own shared-words dictionary (K4-i18n-common) and may pass
 * `productEntries` — per-locale entries whose key or value names the product (K3), which never ship in
 * this package and are composed last so they win on a collision.
 */
import { createDictionaryTranslator } from "@jini-ai/core/text";
import { mergeLocaleOverlays, type LocaleDictionary } from "../../../shell/lib/merge-locale-overlays.js";
import { MENUS_LIST_I18N } from "./menus-list-i18n.js";
import { MENUS_EDITOR_I18N } from "./menus-editor-i18n.js";
import { MENUS_ITEM_FIELDS_I18N } from "./menus-item-fields-i18n.js";
import { MENUS_ITEM_ADVANCED_I18N } from "./menus-item-advanced-i18n.js";
import { MENUS_PAGE_LINK_I18N } from "./menus-page-link-i18n.js";

/**
 * The composed Menus dictionary plus the translator the host's hooks and screens call. `MENUS_DICT` had
 * no exported `t` at all before the original S-I18N fix — `use-menus.hooks.ts` and `use-menu-editor.hooks.ts`
 * each built their own no-fallback `MENUS_DICT[locale]?.[key] ?? key` closure inline, which is why the
 * confirm dialog's own button (then "Delete permanently", absent from `MENUS_DICT` in most locales)
 * rendered English almost everywhere. That dialog is now the Trash rewrite's "Move to trash?" (2026-09-21,
 * `trash-delete-architecture.md` — see this feature's own hook/`Menus.tsx` header), but the fallback this
 * fixed still matters for every key this dict doesn't carry per-locale. `createDictionaryTranslator` falls
 * through to the shared dictionary before the raw English key, same as `trash-i18n.ts`.
 */
export function createMenusDictionary(
  { commonDictionary, productEntries = {} }: { commonDictionary: LocaleDictionary; productEntries?: LocaleDictionary },
  _optional: Record<string, never> = {},
) {
  const dictionary = mergeLocaleOverlays(
    { base: MENUS_LIST_I18N },
    { overlays: [MENUS_EDITOR_I18N, MENUS_ITEM_FIELDS_I18N, MENUS_ITEM_ADVANCED_I18N, MENUS_PAGE_LINK_I18N, productEntries] },
  );
  const t = createDictionaryTranslator({ featureDictionary: dictionary }, { commonDictionary });
  return { dictionary, t };
}
