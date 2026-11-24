import { createDictionaryTranslator, type DictionaryTranslator, type LocaleDictionary } from "@jini-ai/core/text";
import { COMMENTS_DICT_ES_TO_AR } from "./i18n/comments-dict-es-to-ar.js";
import { COMMENTS_DICT_JA_TO_TR } from "./i18n/comments-dict-ja-to-tr.js";
import { COMMENTS_DICT_TH_TO_BN } from "./i18n/comments-dict-th-to-bn.js";

/**
 * @file Dictionary for the Comments feature, covering all 18 target locales. Covers `rules.ts`'s
 * moderation-queue row-menu labels (`commentRowMenuItems`: Approve/Spam/Trash/Restore/Purge), the
 * hook-level notice/error strings from `use-comment-queue.hooks.ts` and
 * `use-comment-settings.hooks.ts` (`describeApiError` fallbacks, `setNotice` copy), and
 * `Jini packages/admin/src/comments/react/pages/CommentsPage.tsx`'s own markup (table headers, queue/settings copy, the purge-confirm dialog) — the
 * last of these was the one gap left after the rest of this admin app's JSX-only i18n pass (see
 * `redirects-i18n.tsx`/`integrations-i18n.tsx`/`recovery-i18n.tsx`'s matching notes for that
 * earlier pass), now closed.
 */

const COMMENTS_DICT: Record<string, Record<string, string>> = {
  ...COMMENTS_DICT_ES_TO_AR,
  ...COMMENTS_DICT_JA_TO_TR,
  ...COMMENTS_DICT_TH_TO_BN,
};

/** The host binds its commonDictionary once; `t` falls back to the common copy on a miss. */
export function createCommentsDictionary(
  { commonDictionary }: { commonDictionary: LocaleDictionary },
  _optional = {},
): { t: DictionaryTranslator } {
  const featureDictionary = COMMENTS_DICT;
  return { t: createDictionaryTranslator({ featureDictionary }, { commonDictionary }) };
}
