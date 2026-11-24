/**
 * @file Host dictionary for the four screens now in `@jini-ai/admin/widgets/react`:
 * `WidgetRegions.tsx` (region list),
 * `WidgetsLibrary.tsx` (widget list), `WidgetRegionEditor.tsx` (per-region placement list), and
 * `WidgetInstanceEditor.tsx` (create/edit one widget). `t()` falls back to `COMMON_I18N` via
 * `createDictionaryTranslator`, same as `trash-i18n.ts`.
 *
 * Also covers `@jini-ai/admin/widgets`'s `widgetTypeLabel` — the five v1 widget type display names
 * ("Text"/"Social Links"/"Collection list"/"Menu"/"Contact Form", read off `WIDGET_TYPE_OPTIONS` in
 * `components/WidgetConfigFields/WidgetConfigFields.tsx`). That constant itself stays untouched
 * (shared with the config-form dispatch, out of this pass's scope) — `widgetTypeLabel` resolves
 * the English label first, then looks up its Spanish translation here by that resolved text, same
 * "translate the resolved display string" shape `lib/admin-nav-i18n.ts`'s `translateAdminNavLabel`
 *
 * Collections plan A1 (2026-09-23): `recent-entries`'s label changed from "Recent Entries" to
 * "Collection list" (the type key itself is unchanged). The dictionary KEY below was renamed to
 * match so the lookup still resolves — the translated VALUES were not re-translated (they still
 * literally say "recent entries" in each language), a known gap left for a real localization pass,
 * not invented English-only copy in the meantime.
 *
 * Split by screen area (K4i: a dictionary file over 500 lines never blocks work, it is split by feature),
 * so the data lives in the `widgets-*-i18n.ts` slices next to this file and this factory only composes
 * them. The host binds it once with its own shared-words dictionary (K4-i18n-common) and may pass
 * `productEntries` — per-locale entries whose key or value names the product (K3), which never ship in
 * this package and are composed last so they win on a collision.
 */
import { createDictionaryTranslator } from "@jini-ai/core/text";
import { mergeLocaleOverlays, type LocaleDictionary } from "../../../shell/lib/merge-locale-overlays.js";
import { WIDGETS_REGIONS_I18N } from "./widgets-regions-i18n.js";
import { WIDGETS_LIBRARY_I18N } from "./widgets-library-i18n.js";
import { WIDGETS_EDITORS_I18N } from "./widgets-editors-i18n.js";
import { WIDGETS_HOOKS_I18N } from "./widgets-hooks-i18n.js";
import { WIDGETS_PREVIEW_I18N } from "./widgets-preview-i18n.js";

/**
 * The composed Widgets dictionary plus the translator the host's hooks and screens call: the
 * slices are folded through `mergeLocaleOverlays` (a function parameter, not an index into the
 * dictionary), so the dictionary is only ever indexed by `createDictionaryTranslator` — the
 * host's dictionary-lookup-sinks guard — and a shared word a slice lacks falls to `commonDictionary`.
 */
export function createWidgetsDictionary(
  { commonDictionary, productEntries = {} }: { commonDictionary: LocaleDictionary; productEntries?: LocaleDictionary },
  _optional: Record<string, never> = {},
) {
  const dictionary = mergeLocaleOverlays(
    { base: WIDGETS_REGIONS_I18N },
    { overlays: [WIDGETS_LIBRARY_I18N, WIDGETS_EDITORS_I18N, WIDGETS_HOOKS_I18N, WIDGETS_PREVIEW_I18N, productEntries] },
  );
  const t = createDictionaryTranslator({ featureDictionary: dictionary }, { commonDictionary });
  return { dictionary, t };
}
