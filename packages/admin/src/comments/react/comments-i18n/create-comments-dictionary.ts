/**
 * @file Dictionary for the Comments feature, covering all 18 target locales. Covers `rules.ts`'s
 * moderation-queue row-menu labels (`commentRowMenuItems`: Approve/Spam/Trash/Restore/Purge), the
 * hook-level notice/error strings from `use-comment-queue.hooks.ts` and
 * `use-comment-settings.hooks.ts` (`describeApiError` fallbacks, `setNotice` copy), and
 * `Jini packages/admin/src/comments/react/pages/CommentsPage.tsx`'s own markup (table headers, queue/settings copy, the purge-confirm dialog) — the
 * last of these was the one gap left after the rest of this admin app's JSX-only i18n pass (see
 * `redirects-i18n.tsx`/`integrations-i18n.tsx`/`recovery-i18n.tsx`'s matching notes for that
 * earlier pass), now closed.
 *
 * Split by screen area (K4i: a dictionary file over 500 lines never blocks work, it is split by feature),
 * so the data lives in the `comments-*-i18n.ts` slices next to this file and this factory only composes
 * them. The host binds it once with its own shared-words dictionary (K4-i18n-common) and may pass
 * `productEntries` — per-locale entries whose key or value names the product (K3), which never ship in
 * this package and are composed last so they win on a collision.
 */
import { createDictionaryTranslator } from "@jini-ai/core/text";
import { mergeLocaleOverlays, type LocaleDictionary } from "../../../shell/lib/merge-locale-overlays.js";
import { COMMENTS_ROW_MENU_I18N } from "./comments-row-menu-i18n.js";
import { COMMENTS_QUEUE_I18N } from "./comments-queue-i18n.js";
import { COMMENTS_SETTINGS_I18N } from "./comments-settings-i18n.js";
import { COMMENTS_HOOKS_I18N } from "./comments-hooks-i18n.js";

/**
 * The composed Comments dictionary plus the translator the host's hooks and screens call: the
 * slices are folded through `mergeLocaleOverlays` (a function parameter, not an index into the
 * dictionary), so the dictionary is only ever indexed by `createDictionaryTranslator` — the
 * host's dictionary-lookup-sinks guard — and a shared word a slice lacks falls to `commonDictionary`.
 */
export function createCommentsDictionary(
  { commonDictionary, productEntries = {} }: { commonDictionary: LocaleDictionary; productEntries?: LocaleDictionary },
  _optional: Record<string, never> = {},
) {
  const dictionary = mergeLocaleOverlays(
    { base: COMMENTS_ROW_MENU_I18N },
    { overlays: [COMMENTS_QUEUE_I18N, COMMENTS_SETTINGS_I18N, COMMENTS_HOOKS_I18N, productEntries] },
  );
  const t = createDictionaryTranslator({ featureDictionary: dictionary }, { commonDictionary });
  return { dictionary, t };
}
