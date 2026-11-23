import { ADMIN_COMMON_I18N } from "../core/i18n-common.js";
import { createDictionaryTranslator } from '@jini-ai/core/text';
import { PAGES_LOCALES_A } from "./pages-i18n.locales-a.js";
import { PAGES_LOCALES_B } from "./pages-i18n.locales-b.js";
import { PAGES_LOCALES_C } from "./pages-i18n.locales-c.js";
import { PAGES_LOCALES_D } from "./pages-i18n.locales-d.js";
/**
 * @file Spanish dictionary for the Pages list screen (`Pages.tsx`). `PageEditor.tsx` is
 * deliberately out of scope — see the admin translation dispatch notes — so its strings aren't
 * here.
 *
 * Keyed one level deeper by locale so a second locale is a second top-level entry rather than a
 * second file. `t()` falls back to `ADMIN_COMMON_I18N` via `createDictionaryTranslator`, same as
 * `trash-i18n.ts`.
 *
 * Also covers `rules.ts`'s `pageRowMenuItems` row-menu labels (Edit/Publish/Unpublish/Delete),
 * reusing the host Posts dictionary's exact vocabulary for the same words since
 * `pageRowMenuItems` mirrors `postRowMenuItems` verbatim. "Publish" was already shared with the
 * Theme Pages tab's own copy below; "Unpublish" (added 2026-09-22, replacing "Disable" — see
 * `rules.ts`'s own header for why) reuses the host Collections dictionary's translations
 * verbatim, the same word for the same action on a different entity type.
 *
 * The confirm dialog composes `{t("Move")} "{title}" {t("to trash? It will disappear…")}`.
 * In `ja`, `ko`, `tr`, `hi`, `ur`, and `bn`, the verb is in the trailing fragment after the
 * quoted title, so `Move` supplies a contextual prefix instead of repeating the verb. The parity
 * test still excludes this key in these locales because the prefixes were previously empty.
 */

export const PAGES_DICT: Record<string, Record<string, string>> = {
  ...PAGES_LOCALES_A, ...PAGES_LOCALES_B, ...PAGES_LOCALES_C,
  ...PAGES_LOCALES_D,
};

/** `PAGES_DICT` had no exported `t` at all before this fix — `rules.ts`'s `pageRowMenuItems` and
 *  `use-pages.hooks.ts` each built their own no-fallback `PAGES_DICT[locale]?.[key] ?? key` closure
 *  inline. `createDictionaryTranslator` falls through to `ADMIN_COMMON_I18N` before the raw English key,
 *  same as `trash-i18n.ts`. */
export const t = createDictionaryTranslator({ featureDictionary: PAGES_DICT }, { commonDictionary: ADMIN_COMMON_I18N });
