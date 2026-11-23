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
  isVersionConflict }`: the host's collections dictionary, admin request error class (with its
  base-case copy) and version-conflict test.
- `rules.ts` — pure collections rules. Every rule that reads host knowledge takes `kit`;
  `bindCollectionsRules({ kit })` returns those rules with the kit bound, which the host builds once
  at its composition root so its call sites keep their kit-free shape.
