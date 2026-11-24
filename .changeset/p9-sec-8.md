---
"@jini-ai/admin": patch
"@jini-ai/core": patch
---

SEC-8 (P9-SEC plan v2): the publish credential contract is shared with Deployment.

- New `@jini-ai/core/contracts/site/api-security-api-types` (types only): the publish, custom and
  Shared Keys credential wire shapes, moved verbatim from the host admin's `security-api.types.ts`.
  It is the one neutral owner, so Security and the host Deployment feature import it directly.
- `createHttpPublishCredentials({ transport, workspacePath })` (`./security/adapters/http`) and
  `createMemoryPublishCredentials({ rows?, executionMode? })` (`./security/adapters/memory`)
  implement `PublishCredentialsPort` (W1–W5: list, create, update, delete, verify). Requests are
  byte-identical to the host wire; responses are projected field by field (no token, ciphertext or
  connection; `tokenHint` copied as `{ length, last4 }`).
- `runPublishCredentialsConformance({ createClient, connection })` (`./security/conformance`).
- `CredentialStorePort` gains optional `snapshot?` (rows plus the publish `executionMode`) and
  `verify?` (publish only). `CredentialSummary` gains optional `credentialType`, `worksFor` and
  `lastVerification`; new `CredentialStoreSnapshot`.
- The access-tokens controller snapshot carries `executionMode` and a per-row `verifications` map
  that survives refetch, plus a `verify({ row })` action; `useAccessTokensTab` exposes
  `executionMode` and each row's `verification`.
