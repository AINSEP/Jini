/**
 * @file Spanish dictionary for `Posts.tsx` (list) and `PostEditor.tsx` (shared post/page editor
 * screen — see that file's header for why one editor serves both kinds). `t()` falls back to the host's
 * shared-words dictionary via `createDictionaryTranslator`, same as `trash-i18n.ts`.
 *
 * Also covers `rules.ts`'s `postRowMenuItems` row-menu labels (Edit/Publish/Unpublish/Delete) —
 * outside the original `.tsx`-only pass's scope, closed here since this dictionary already owns the
 * rest of this screen's vocabulary.
 *
 * Split by feature (K4i: a dictionary file over 500 lines never blocks work, it is split by feature),
 * so the data lives in the `posts-*-i18n.ts` slices next to this file and this factory only composes
 * them. The host binds it once with its own shared-words dictionary (K4-i18n-common) and may pass
 * `productEntries` — per-locale entries whose key or value names the product (K3), which never ship in
 * this package and are composed last so they win on a collision.
 *
 * The editor-header, save-feedback and errors slices hold the screen requirements that previously
 * bypassed this dictionary or were absent in every locale.
 *
 * Composition order: the slices share no key (the former single file's main table and its later
 * overlays were disjoint), so their order is immaterial; `EDITOR_FAILURE_DICT` follows them because the
 * original assigned it last, so it keeps winning over any slice on a collision.
 */
import { createDictionaryTranslator } from "@jini-ai/core/text";
import { mergeLocaleOverlays, type LocaleDictionary } from "@jini-ai/core/text";
import { POSTS_LIST_I18N } from "./posts-list-i18n.js";
import { POSTS_LIST_SORT_I18N } from "./posts-list-sort-i18n.js";
import { POSTS_TRASH_DIALOG_I18N } from "./posts-trash-dialog-i18n.js";
import { POSTS_EDITOR_HEADER_I18N } from "./posts-editor-header-i18n.js";
import { POSTS_SAVE_FEEDBACK_I18N } from "./posts-save-feedback-i18n.js";
import { POSTS_ERRORS_I18N } from "./posts-errors-i18n.js";
import { POSTS_SETTINGS_DIALOG_I18N } from "./posts-settings-dialog-i18n.js";
import { POSTS_TOOLBAR_MARKS_I18N } from "./posts-toolbar-marks-i18n.js";
import { POSTS_TOOLBAR_BLOCKS_I18N } from "./posts-toolbar-blocks-i18n.js";
import { POSTS_TOOLBAR_STYLE_I18N } from "./posts-toolbar-style-i18n.js";
import { POSTS_URL_DIALOG_I18N } from "./posts-url-dialog-i18n.js";
import { POSTS_SLUG_COLLISION_I18N } from "./posts-slug-collision-i18n.js";
import { POSTS_TEMPLATE_PREVIEW_I18N } from "./posts-template-preview-i18n.js";

/**
 * The composed Posts dictionary plus the translator the host's hooks and screens call. `POSTS_DICT` had
 * no exported `t` at all before this fix — `Posts.tsx`, `rules.ts`'s `postRowMenuItems`, and
 * `use-post-editor.hooks.ts` each built their own no-fallback `POSTS_DICT[locale]?.[key] ?? key` closure
 * inline. `createDictionaryTranslator` falls through to the shared dictionary before the raw English
 * key, same as `trash-i18n.ts`.
 */
export function createPostsDictionary(
  { commonDictionary, editorFailureDictionary, productEntries = {} }: {
    commonDictionary: LocaleDictionary;
    /** The host's shared editor-failure copy (`EDITOR_FAILURE_DICT`), injected: posts may not reach the admin shell layer. */
    editorFailureDictionary: LocaleDictionary;
    productEntries?: LocaleDictionary;
  },
  _optional: Record<string, never> = {},
) {
  const dictionary = mergeLocaleOverlays(
    { base: POSTS_LIST_I18N },
    {
      overlays: [
        POSTS_LIST_SORT_I18N, POSTS_TRASH_DIALOG_I18N, POSTS_EDITOR_HEADER_I18N, POSTS_SAVE_FEEDBACK_I18N,
        POSTS_ERRORS_I18N, POSTS_SETTINGS_DIALOG_I18N, POSTS_TOOLBAR_MARKS_I18N, POSTS_TOOLBAR_BLOCKS_I18N,
        POSTS_TOOLBAR_STYLE_I18N, POSTS_URL_DIALOG_I18N, POSTS_SLUG_COLLISION_I18N, POSTS_TEMPLATE_PREVIEW_I18N,
        editorFailureDictionary, productEntries,
      ],
    },
  );
  const t = createDictionaryTranslator({ featureDictionary: dictionary }, { commonDictionary });
  return { dictionary, t };
}
