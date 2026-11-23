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
