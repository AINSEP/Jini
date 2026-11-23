---
"@jini-ai/admin": patch
---

SEC-9 (P9-SEC plan v2): catalog independence, unlisted providers, merged ordering, search, count copy
and numbered legacy labels on the Access Tokens tab.

- `SecurityApiPort.providers({ kind? })`: `'publish'` and `'source-control'` each hit only their own
  endpoint; no `kind` still returns both. The controller loads the two catalogs independently, so one
  failing leaves the other shown (`error` reports the failure).
- New rules: `providersWithSavedRows` (a bare `unlisted: true` entry keeps a saved row visible and
  removable after its plugin is switched off), `sortCredentialGroups` (saved first, category order,
  label), `legacyCredentialLabel` (numbered "{Provider} token N"; `credentialLabel` takes
  `{ rows }` to number), `rowMatchesQuery` / `providerMatchesQuery`, `credentialCountText`.
  `filterCredentials` also matches the provider's label and purpose. `CredentialProvider.unlisted?`.
- `useAccessTokensTab` returns merged `groups` (publish, source-control and custom), `hostingEmpty`
  and `countText`; the tab renders groups, "Not connected" providers and the empty-hosting hint.
