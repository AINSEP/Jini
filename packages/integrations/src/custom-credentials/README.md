# custom-credentials

Small generic helpers for host credential cards and credentialed calls.

- `card-token` — `cleanCardToken`: strips edge whitespace and zero-width characters from a card-submitted
  token; refuses an interior non-visible-ASCII character (`CustomCredentialValidationError`) without quoting it.
- `credential-recovery` — `withCustomCredentialSetup`: turns a `CustomCredentialNotFoundError` into a
  `credential_save` setup diagnostic (prefilled with the label and URL origin) and, on explicit
  verification reporting `invalid`, attaches a rotation setup; any other failure is rethrown.
- `custom-credential-create-ui` / `custom-credential-set-token-ui` — the in-chat secret forms (and their
  replacing outcome documents) for creating an API credential and replacing its token.
- `provider-settings-card` — the `credential_save` adapter that renders a provider plugin's declared
  settings as a secret card and saves them through host ports.
- `agent-tools` — `buildCustomCredentialsAgentToolCatalog`: the list / verify / make-request / set-username /
  write-files tool input-schema shapes the credential handlers validate against.
- `credential-ports` — `classifyCredentialedRequestError` and `bindCredentialedRequestPort`, the core
  `CredentialedRequestPort` bound over a host's existing request functions.

## Wiring

- The host injects `issueCredentialSetup` (type `IssueCredentialSetup`) on `withCustomCredentialSetup`'s
  required args: its daemon issuer bound to its own credential-free-field and secret-redaction checks.
  A host binds it once where it supplies `credentialed-http/tools`' `recovery.withSetup` operation.
- `cleanCardToken` needs no injection.
- `buildCreateForm` / `buildCreateOutcome` / `setTokenForm` / `setTokenOutcome` take the host's card `app`
  identity (its `CredentialCardIdentity.appNames.*`); `buildCreateForm` also takes the host's closed
  `categories` set, `suggestWorksFor` (`suggestCredentialWorksFor` from `@jini-ai/platform/secrets/credential-sets`)
  and `baseUrlHint` (the Base URL field's help text, which carries the host's example URL), and `setTokenForm` its `secretField` marker (the `credential_save` secret-form
  definition). A host binds them where it supplies `credentialed-http/tools`' `credentialCardForms`.
- `buildProviderSettingsCredentialHandler` takes `cards` (`defineSecretCardTool` from `@jini-ai/ui/mcp-ui/secret-card`
  and `askThenReport` from `@jini-ai/daemon/surface-exchanges`, which this package may not import) and
  `identity` (`ProviderSettingsCardIdentity`: tool id, `ui://` namespace, form/outcome app names);
  `buildProviderSettingsForm` takes the form `app`. The host binds both where it assembles its
  `credential_save` adapters.
- `bindCredentialedRequestPort` takes `operations` — the host's existing `makeCredentialedRequest`,
  `resolveRequestTarget`, `verifyCustomCredential` and `probeCredentialConnection` — alongside the `deps`
  they consume, plus `EgressRefusedError` — the host's guarded-client refusal class (`@jini-ai/platform/http/guarded`),
  which this package may not import. `classifyCredentialedRequestError` takes the same class on its required
  args; the port forwards its own. A host binds the class at each call site (its tool registrations
  and deploy-ops runner).
- `buildCustomCredentialsAgentToolCatalog` takes the host's tool `ids`, `permissions` (read/write), every
  description sentence (`copy`) and its enforced `writeFilesLimits.maxFiles`. The host binds it where it
  declares its credential tool catalog (the same catalog it passes as `vocabulary.catalog`).
