/**
 * @file Spanish dictionary for `@jini-ai/admin/forms/react` FormsList (list) and FormEditor (field editor, field
 * attributes modal, submissions list/detail). Same `DICT[locale]?.[key] ?? key` shape
 * `SettingsUi.tsx`'s own `const t` uses.
 *
 * Deliberately does NOT cover `FieldAttributesDialog`'s long `<SeeMore>` explainer paragraph (CSS
 * classes / HTML attribute allowlist copy) — mixed prose-and-`<code>` content, lower priority than
 * this pass's field labels/buttons/headers, left English for a follow-up pass.
 *
 * Split by screen area (K4i: a dictionary file over 500 lines never blocks work, it is split by feature),
 * so the data lives in the `forms-*-i18n.ts` slices next to this file and this factory only composes
 * them. The host binds it once with its own shared-words dictionary (K4-i18n-common) and may pass
 * `productEntries` — per-locale entries whose key or value names the product (K3), which never ship in
 * this package and are composed last so they win on a collision.
 */
import { createDictionaryTranslator } from "@jini-ai/core/text";
import { mergeLocaleOverlays, type LocaleDictionary } from "@jini-ai/core/text";
import { FORMS_EDITOR_CHROME_I18N } from "./forms-editor-chrome-i18n.js";
import { FORMS_LIST_I18N } from "./forms-list-i18n.js";
import { FORMS_FIELD_EDITOR_I18N } from "./forms-field-editor-i18n.js";
import { FORMS_SUBMISSIONS_I18N } from "./forms-submissions-i18n.js";
import { FORMS_EDITOR_I18N } from "./forms-editor-i18n.js";
import { FORMS_ATTRIBUTES_EXPLAINER_I18N } from "./forms-attributes-explainer-i18n.js";
import { FORMS_FIELD_SETTINGS_I18N } from "./forms-field-settings-i18n.js";
import { FORMS_LEAVE_GUARD_I18N } from "./forms-leave-guard-i18n.js";

/**
 * The composed Forms dictionary plus the translator the host's hooks and screens call: the
 * slices are folded through `mergeLocaleOverlays` (a function parameter, not an index into the
 * dictionary), so the dictionary is only ever indexed by `createDictionaryTranslator` — the
 * host's dictionary-lookup-sinks guard — and a shared word a slice lacks falls to `commonDictionary`.
 */
export function createFormsDictionary(
  { commonDictionary, productEntries = {} }: { commonDictionary: LocaleDictionary; productEntries?: LocaleDictionary },
  _optional: Record<string, never> = {},
) {
  const dictionary = mergeLocaleOverlays(
    { base: FORMS_EDITOR_CHROME_I18N },
    { overlays: [FORMS_LIST_I18N, FORMS_FIELD_EDITOR_I18N, FORMS_SUBMISSIONS_I18N, FORMS_EDITOR_I18N, FORMS_ATTRIBUTES_EXPLAINER_I18N, FORMS_FIELD_SETTINGS_I18N, FORMS_LEAVE_GUARD_I18N, productEntries] },
  );
  const t = createDictionaryTranslator({ featureDictionary: dictionary }, { commonDictionary });
  return { dictionary, t };
}
