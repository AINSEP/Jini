# custom-credentials

Small generic helpers for host credential cards and credentialed calls.

- `card-token` — `cleanCardToken`: strips edge whitespace and zero-width characters from a card-submitted
  token; refuses an interior non-visible-ASCII character (`CustomCredentialValidationError`) without quoting it.
- `credential-recovery` — `withCustomCredentialSetup`: turns a `CustomCredentialNotFoundError` into a
  `credential_save` setup diagnostic (prefilled with the label and URL origin) and, on explicit
  verification reporting `invalid`, attaches a rotation setup; any other failure is rethrown.

## Wiring

- The host injects `issueCredentialSetup` (type `IssueCredentialSetup`) on `withCustomCredentialSetup`'s
  required args: its daemon issuer bound to its own credential-free-field and secret-redaction checks.
  A host binds it once where it supplies `credentialed-http/tools`' `recovery.withSetup` operation.
- `cleanCardToken` needs no injection.
