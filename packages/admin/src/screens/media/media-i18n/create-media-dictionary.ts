/**
 * @file Spanish dictionary for `Media.tsx`'s own UI chrome — page header, tab strip, toolbar,
 * empty states, the metadata edit panel, and the lightbox/purge dialogs.
 *
 * Deliberately does NOT cover the media-provider catalog rendered by the "External Providers" tab
 * (`media-provider-catalog.ts`'s real, engine-canonical `MEDIA_PROVIDER_CATALOG` — see that file's
 * own header) — those are real third-party provider names ("xAI Grok Imagine", "ElevenLabs", …),
 * not UI copy this screen authored, so they stay as-is regardless of locale. Same
 * `DICT[locale]?.[key] ?? key` shape `SettingsUi.tsx`'s own `const t` uses.
 *
 * `"Media providers"` (in `media-library-i18n.ts`) is an unused leftover from before the tab was renamed "External
 * Providers" (2026-09-10) — kept rather than deleted (harmless, reversible), same policy
 * `providers-i18n.ts`'s own header documents for its own unused leftovers from the same rename.
 *
 * `t()` falls back to the host's shared-words dictionary via `createDictionaryTranslator`, same as `trash-i18n.ts`.
 *
 * Split by screen area (K4i: a dictionary file over 500 lines never blocks work, it is split by feature),
 * so the data lives in the `media-*-i18n.ts` slices next to this file and this factory only composes
 * them. The host binds it once with its own shared-words dictionary (K4-i18n-common) and may pass
 * `productEntries` — per-locale entries whose key or value names the product (K3), which never ship in
 * this package and are composed last so they win on a collision.
 */
import { createDictionaryTranslator } from "@jini-ai/core/text";
import { mergeLocaleOverlays, type LocaleDictionary } from "../../../shell/lib/merge-locale-overlays.js";
import { MEDIA_LIBRARY_I18N } from "./media-library-i18n.js";
import { MEDIA_TOOLBAR_BASE_I18N } from "./media-toolbar-i18n.js";
import { MEDIA_EDIT_PANEL_I18N } from "./media-edit-panel-i18n.js";
import { MEDIA_HTML_ATTRIBUTES_I18N } from "./media-html-attributes-i18n.js";
import { MEDIA_DIALOGS_BASE_I18N } from "./media-dialogs-i18n.js";
import { MEDIA_HOOKS_I18N } from "./media-hooks-i18n.js";
import {
  MEDIA_AUDIT_STRINGS, MEDIA_IMPORT_STRINGS, MEDIA_PROVENANCE_STRINGS, MEDIA_DIALOG_STRINGS,
  MEDIA_TRASH_STRINGS, MEDIA_SHAPE_STRINGS, MEDIA_LINK_STRINGS, MEDIA_TOOLBAR_STRINGS,
} from "./media-addons-i18n.js";

/**
 * The composed Media dictionary plus the translator the host's hooks, `rules.ts` and screens call:
 * `MEDIA_DICT[locale]?.[key] ?? commonDictionary[locale]?.[key] ?? key` via `createDictionaryTranslator`
 * (same fallback `trash-i18n.ts` uses) — a shared word this dict doesn't carry for a locale still
 * renders translated instead of falling straight to English. The add-on tables fold over the base
 * slices in the original order, so a locale absent from one of them still merges cleanly.
 */
export function createMediaDictionary(
  { commonDictionary, productEntries = {} }: { commonDictionary: LocaleDictionary; productEntries?: LocaleDictionary },
  _optional: Record<string, never> = {},
) {
  const dictionary = mergeLocaleOverlays(
    { base: MEDIA_LIBRARY_I18N },
    {
      overlays: [
        MEDIA_TOOLBAR_BASE_I18N, MEDIA_EDIT_PANEL_I18N, MEDIA_HTML_ATTRIBUTES_I18N, MEDIA_DIALOGS_BASE_I18N, MEDIA_HOOKS_I18N,
        MEDIA_AUDIT_STRINGS, MEDIA_IMPORT_STRINGS, MEDIA_PROVENANCE_STRINGS, MEDIA_DIALOG_STRINGS,
        MEDIA_TRASH_STRINGS, MEDIA_SHAPE_STRINGS, MEDIA_LINK_STRINGS, MEDIA_TOOLBAR_STRINGS, productEntries,
      ],
    },
  );
  const t = createDictionaryTranslator({ featureDictionary: dictionary }, { commonDictionary });
  return { dictionary, t };
}
