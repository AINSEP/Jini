# screens/collections

## Wiring

- `hooks/*-dependencies.hooks.ts` — `createCollectionsPort`, `createCollectionEntriesPort`,
  `createCollectionEntryEditorPort`, `createEditFieldsDialogPort` and `createNewContentTypeDialogPort`,
  each `({ api })` over the host-bound collections API client. The host builds each once at its
  composition root (module-level singletons); each file also ships an in-memory `createFake*Port`
  for tests.
- `api/collections-api.ts` — the collections admin API client. The host injects its authenticated admin
  `request` (it owns the base URL, auth, retries and error decoding) and builds the client once at its
  composition root.
- `collections-host-kit.ts` — `CollectionsHostKit { translate, isApiError, describeApiError,
  isVersionConflict, embedMarkerSnippet, nextDraftRowId }`: the host's collections dictionary, admin
  request error class (with its base-case copy), version-conflict test, the CMS marker module's
  `embedMarkerSnippet` (behind `collectionEmbedSnippet`), and ONE `createDraftRowIdCounter()` built at
  the composition root so the New and Edit field-list dialogs share a single row-id sequence.
- `rules.ts` — pure collections rules. Every rule that reads host knowledge takes `kit`;
  `bindCollectionsRules({ kit })` returns those rules with the kit bound, which the host builds once
  at its composition root so its call sites keep their kit-free shape.
- `hooks/use-collection-entry-editor.hooks.ts` — `useCollectionEntryEditor({ props, port, navigate,
  locale, t, kit, entryLifecycleFailureMessage, versionConflictMessage, slugRedirectPath,
  useBodyEditor }, _optional = {})`. This package carries no rich-text editor: the host injects
  `useBodyEditor({ ariaLabel })` returning its own editor (anything with `getJSON()` and
  `commands.setContent()`; the controller is generic over that editor type), plus its entry
  lifecycle-failure copy, its untranslated version-conflict copy key and the shell's slug-redirect rule.
- `LifecycleConfirmDialog.tsx` — the Deprecate/Tombstone confirm. The host passes
  `useLifecycleConfirmDialogHook` (its binding of `useLifecycleConfirmDialog` to locale + kit) as a
  required prop, imports its native-dialog stylesheet at the screen mount, and styles the
  `jini-collections-dialog` shell (buttons use the shared `jini-btn-*` / `jini-editor-actions` rules).
- `NewContentTypeDialog.tsx` / `EditFieldsDialog.tsx` — create a content type / edit its field schema.
  The host passes `useNewContentTypeDialogHook` / `useEditFieldsDialogHook` (its bindings of
  `useNewContentTypeDialog` / `useEditFieldsDialog` to port, locale or translator, and kit) as required
  props, plus its translator `t`. Both render the shared `ContentTypeFieldsSection.tsx` field list and the
  kit `Dialog`, and emit only `jini-*` classes: the host styles `jini-collections-dialog` +
  `jini-collections-type-dialog` (shell), `jini-collections-field-row`, and the shell-scoped
  `jini-field`, `jini-field-label`, `jini-form-checkbox-field`, `jini-editor-actions`, `jini-save-error`
  and `jini-btn-secondary`.
