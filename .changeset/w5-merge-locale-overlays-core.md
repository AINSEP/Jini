---
"@jini-ai/core": minor
"@jini-ai/admin": major
---

`mergeLocaleOverlays` moves from `@jini-ai/admin/shell/lib/merge-locale-overlays` to `@jini-ai/core/text` (next to `createDictionaryTranslator`), so the feature dictionaries in every admin domain (screens, posts, comments, widgets) can compose their slices without reaching the shell layer. **Breaking for `@jini-ai/admin`:** the `./shell/lib/merge-locale-overlays` subpath is removed; import `mergeLocaleOverlays` from `@jini-ai/core/text`. Its result type is exported as `MergedLocaleDictionary`; inputs take Core's readonly `LocaleDictionary`.

`createPostsDictionary` (`@jini-ai/admin/posts/posts-i18n/create-posts-dictionary`) takes the host's editor-failure dictionary as the required `editorFailureDictionary` field instead of importing the shell's `EDITOR_FAILURE_DICT`.
