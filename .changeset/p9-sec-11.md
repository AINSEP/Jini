---
"@jini-ai/admin": patch
---

SEC-11 (P9-SEC plan v2): custom provider forms and compatibility (W8).

- Custom create body is `{ scope?, label, worksFor?, category, baseUrl, additionalHosts?, connection }`: no top-level
  `username` (it travels in `connection`), and `additionalHosts` only when any were typed. `scope` is sent (first)
  only when the store reported `projectKeysAvailable`.
- Custom update sends only the changed fields: `label`, `connection` (with a typed token), `worksFor`, `category`,
  `baseUrl`, `additionalHosts` (replaces the list; `[]` clears) and `username` (`null` clears, no token retype).
- Every additional host is validated as its own http(s) origin ("Each additional host must be a valid http:// or
  https:// URL."), inline in the editor and on save.
- `createHttpCustomCredentials({ transport, workspacePath })` (`@jini-ai/admin/security/adapters/http`) exposes the
  host's method names `listCustomCredentials`, `createCustomCredential`, `updateCustomCredential`,
  `deleteCustomCredential`; bodies go out exactly as given and ids are path-encoded. Types `CustomCredentialCreateBody`,
  `CustomCredentialUpdateBody` (wire types from `@jini-ai/core/contracts/site/api-security-api-types`).
