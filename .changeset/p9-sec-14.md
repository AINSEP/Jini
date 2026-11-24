---
"@jini-ai/admin": patch
---

SEC-14 (P9-SEC plan v2): host refresh, live locale, redacted actionable failures.

- OD-3 (d), no new token: `security({ ui }, { refreshSignal })` takes the host's content-refresh
  subscription (`SecurityRefreshSignal.subscribe({ onRefresh }) => unsubscribe`). Both credential
  controllers subscribe when created (`createAccessTokensController(..., { refreshSignal })`,
  `createOtherCredentialsController(..., { refreshSignal })`) and unsubscribe on dispose.
- `onCredentialsChanged?` on the same options reaches views through `useSecurityCredentialsHost` for
  SEC-12's grant to publish.
- `describeCredentialError?` gives actionable, translated copy for a failed credential write. The
  controllers redact every submitted secret (draft token and connection values, raw and trimmed) out of the
  described text; without a describer the fixed copy shows and no raw error detail reaches the screen.
- Controller messages and other-store labels go through the live translator, so a locale switch relabels
  without disposing a controller.
- New exports: `SecurityRefreshSignal`, `DescribeCredentialError`, `redactSecrets`,
  `credentialFailureText`, `REDACTED`, `SecurityCredentialsHost`, `useSecurityCredentialsHost`.
