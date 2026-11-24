---
"@jini-ai/admin": patch
---

SEC-13 (P9-SEC plan v2): other credential stores.

- `createHttpOtherCredentials` drops built-in MCP servers (`builtIn: true`) before projection, so they are
  never listed or removable on the Secrets page.
- New `mediaOrder: 'in-place' | 'replaced-last'` option (default `'in-place'`, Jini's existing order). With
  `'replaced-last'` the replaced provider moves last as `{ apiKey, ...kept }`. A provider not yet in the map is
  now written last as `{ apiKey }` in both orders (before, `'in-place'` silently dropped it). Siblings are
  echoed as `{ baseUrl?, model? }` only.
- New opt-in `tokenHints: true` projects server-approved masked hints as `OtherCredentialSummary.tokenHint`
  (`{ last4, length? }`, at most four characters). Off by default: no hint is read.
- The other-credentials controller records `loaded` stores, the `pending` row and per-row `rowErrors`; a
  failed write now lands on its row (`rowErrors['store:id']`), no longer in the store-level `errors`.
- The Access tokens tab renders other-store rows through the new `OtherCredentialRow`, keeps settled empty
  stores as "Not configured" placeholders with host deep links (`security({ ui }, { otherStores })`), words
  MCP env-name counts in whole-sentence plural forms, and states each store's own removal consequence.
- New exports: `OTHER_STORE_INFO`, `otherStorePlaceholders`, `otherValueFact`, `otherRemoveBodyKey`,
  `OtherStoreLinks`, `OtherStoreLink`, `MediaWriteOrder`; message keys `other*`.
