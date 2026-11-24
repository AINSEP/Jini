---
"@jini-ai/admin": patch
---

SEC-12 (P9-SEC plan v2, OD-3 c) and the SEC-9 leftovers on the Access Tokens tab.

- `SecurityApiPort.sharedKeys?` (`SharedKeysPort`: `list` / `grant`, W9) and `useProjectKey?({ keyId, use })` (W10).
  `createHttpSecurityApi(..., { sharedKeys: true })` adds both; `createHttpCredentialCopy({ transport, workspacePath })`
  exposes the host names `listCredentialCopySources` / `copyCredentials`. Inventory rows, sources and grant results are
  projected field by field; nested `connection`, `secret` and `ciphertext` never leave the adapter. The grant body is
  `{"sourceSiteId":"shared-keys","ids":[id],"overwrite":false}`.
- `createSharedKeysController` (`controllers/shared-keys.controller.ts`): one metadata read per open, one selected key,
  a second submit sends nothing, `onGranted` runs before results render; failures are fixed copy.
- `CredentialSummary` gains `tokenHint?` (masked `{ length, last4 }`, displayed exactly as sent), `scope?`, `usedBy?`,
  `usedByThisSite?`; `CredentialStoreSnapshot.projectKeysAvailable?`; `CredentialInput.scope?` (sent on a custom create
  only when the store reported `projectKeysAvailable`). The access-tokens controller adds `attachKey({ row, use })`
  with a per-row `keyUse` state. New rules `formatTokenHint`, `sharedKeyRotationWarning`.
- UI: "Use a saved key" dialog (`react/components/SharedKeysDialog.tsx`, parts `data-jini-part="security.shared-keys.*"`),
  per-row hint and project-key usage with Use / Stop using, the 30-second revoke note, the rotation warning and the
  storage choice in the editor.
- SEC-9 leftovers: other credential stores join the merged ordering (`sections`), "Add another {provider} token",
  the empty-hosting hint links `security({ ui }, { accessTokensTab: { pluginsHref } })` (host value, K3), and the count
  sentence uses translator keys (`tokenCount*`). `credentialCountText`'s `t` now receives a key plus variables.
- The Access Tokens tab and the credential editor take every hook as a required input; `loadAccessTokensTab` binds them.
