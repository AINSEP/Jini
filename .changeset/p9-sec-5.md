---
"@jini-ai/admin": minor
---

SEC-5 (P9-SEC plan v2): root-key status presentation, generate visibility and typed refusals.

- The root-key tab shows a status badge (none / key file / environment variable with its name, from
  the server or the host's `rootKeyTab.defaultEnvVarName`), the fingerprint with a hint, a
  source note (key file path shown as code), and a production-only storage line under the scope
  notice. The raw `state · fingerprint · source` line is gone.
- Create stays create-only: the controller also refuses a key whose source is `env` or `file`.
  `rootKeyTab: { generate: 'hidden' }` hides the create button.
- `createRootKeyController(…, { describeError })` and the module option `describeError` classify a
  generate failure as `locked` (`KEY_DEPENDENT_DATA`, `KEY_MISMATCH`), `refused` (`KEY_INVALID`,
  `SITE_META_UNREADABLE`), `already-exists` or `generic` (snapshot `generateFailure`). The shown
  error is the described detail or fixed copy; a raw `Error.message` never reaches the snapshot.
  A generic generate failure now reads "Root key could not be created." instead of the recovery copy.
- New exports (`./security`): `rootKeyBadge`, `rootKeySourceNote`, `classifyRootKeyGenerateFailure`,
  `rootKeyGenerateFailureText`, `ROOT_KEY_GENERATE_FAILED`, `ROOT_KEY_ALREADY_EXISTS` and the types
  `RootKeyCopy`, `RootKeyBadgeTone`, `RootKeyErrorDescription`, `DescribeRootKeyError`,
  `RootKeyGenerateFailure`. `./security/react`: `SecurityModuleOptions.describeError`.
