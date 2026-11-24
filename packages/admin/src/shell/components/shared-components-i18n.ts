import { ADMIN_COMMON_I18N } from "../../core/i18n-common.js";

import { createDictionaryTranslator } from '@jini-ai/core/text';
import { SHARED_COMPONENTS_ES_ID_DE } from "./shared-components-i18n/dict-es-id-de.js";
import { SHARED_COMPONENTS_ZH_CN_ZH_TW_PT_BR } from "./shared-components-i18n/dict-zh-cn-zh-tw-pt-br.js";
import { SHARED_COMPONENTS_RU_FA_AR } from "./shared-components-i18n/dict-ru-fa-ar.js";
import { SHARED_COMPONENTS_JA_KO_PL } from "./shared-components-i18n/dict-ja-ko-pl.js";
import { SHARED_COMPONENTS_HU_FR_UK } from "./shared-components-i18n/dict-hu-fr-uk.js";
import { SHARED_COMPONENTS_TR_TH_IT } from "./shared-components-i18n/dict-tr-th-it.js";
import { SHARED_COMPONENTS_HI_UR_BN } from "./shared-components-i18n/dict-hi-ur-bn.js";
/**
 * @file Dictionary for the reusable `components/` layer's own static copy — `Select`,
 * `WidgetPickerDialog`/`WidgetAddControl`, `WidgetConfigFields`, `MediaPickerDialog`, and
 * `EmbedInsertControl` (review finding 10 / handoff finding 10: this layer rendered raw English
 * with no `t()` at all before this file existed).
 *
 * ONE dictionary for the whole layer, not one per component — `components/` is a single layer
 * (unlike `features/`, where each screen owns its own dictionary), and a handful of these strings
 * (`"Media"`, `"Form"`, `"Menu"`) are shared verbatim across more than one of the components above,
 * so a single file lets them share one translated value instead of drifting across N files. See
 * `ADS-memory/.local-artifacts/terra-admin-review-2026-09-20/plan-components.md` Part 2 for the
 * full rationale and the per-component call-site table this file's keys are sourced from.
 *
 * Built with `createDictionaryTranslator`, same as every other `*-i18n.ts` in this app — falls
 * through to the shared `ADMIN_COMMON_I18N` (already carries "Cancel", "Title", "Save", "Delete", …) and
 * then to the English key itself, so a locale/key this file does not carry renders the English
 * source string rather than a placeholder. `"Cancel"` and `"Title"` are deliberately NOT repeated
 * here for that reason — see `dictionary-translator.ts`'s own header.
 *
 * Covers the same 21 locales every other feature dictionary in this app ships (confirmed against
 * `trash-i18n.ts`'s own header note, which cross-checked `comments-i18n.ts`/`media-i18n.ts`/
 * `external-mcp-i18n.ts`).
 *
 * Populated incrementally, one component group per commit (Batch D2's commit list) — this file's
 * key set grows with each commit that wires a new call site; each commit's own parity-test update
 * names exactly which keys it added, mirroring `trash-i18n.unit.test.ts`'s `CALL_SITE_KEYS` idiom.
 *
 * Commit 1: `Select` (search field, empty state, default placeholder) and
 * `WidgetPickerDialog`/`WidgetPickerDialog.hooks.tsx`/`useWidgetAddControl` (dialog chrome, form
 * validation messages, and the widget create/place error templates).
 *
 * This commit (2): `WidgetConfigFields.tsx`'s five per-type sub-forms — field labels/placeholders
 * (`Text`, `Social links`/`Link {n}`/`Platform`/`e.g. Git`/`URL`/`https://…`/`Remove`/`Add link`,
 * `Max items`/`Category term id (optional)`, `Menu`/`Choose a menu…`, `Form`/`Choose a form…`/
 * `Success message (optional)`) and the two IO sub-forms' loading/error copy (`Loading menus…`/
 * `failed to load menus`, `Loading forms…`/`failed to load forms`). Wired at both of this
 * component's callers: `WidgetPickerDialog.tsx`'s "create new" form (reuses that dialog's own `t`)
 * and `WidgetInstanceEditor.tsx` (builds its own `t` off this file's exported `t`, since that
 * screen's own `t` is bound to `widgets-i18n.ts`'s `WIDGETS_DICT`, a different dictionary).
 */
export const SHARED_COMPONENTS_DICT: Record<string, Record<string, string>> = {
  ...SHARED_COMPONENTS_ES_ID_DE,
  ...SHARED_COMPONENTS_ZH_CN_ZH_TW_PT_BR,
  ...SHARED_COMPONENTS_RU_FA_AR,
  ...SHARED_COMPONENTS_JA_KO_PL,
  ...SHARED_COMPONENTS_HU_FR_UK,
  ...SHARED_COMPONENTS_TR_TH_IT,
  ...SHARED_COMPONENTS_HI_UR_BN,
};

export const t = createDictionaryTranslator({ featureDictionary: SHARED_COMPONENTS_DICT }, { commonDictionary: ADMIN_COMMON_I18N });
