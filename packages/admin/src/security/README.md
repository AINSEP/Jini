# Security (`@jini-ai/admin/security`)

Saved credentials, other credential stores and the root key that seals them. Controllers are
headless; React views import no hook and receive every hook as a required input.

## Wiring

What the host injects, and where:

- **Ports** (`createAdmin({ ports })`): `securityApi` (required), `otherCredentials?`, `rootKey?`.
  `RootKeyPort.reveal?` is optional and human-only: omit it and no Reveal control renders.
  `createHttpRootKey(..., { reveal: true })` adds `POST <path>/reveal` (W15).
  `CredentialStorePort.snapshot?` adds store-level facts (publish `executionMode`); `verify?` (publish
  only) re-checks a saved credential. `SecurityApiPort.providers({ kind? })` serves each catalog from
  its own endpoint; the controller reads the two kinds independently (SEC-9).
- **Shared publish client** (SEC-8): Deployment and Security share `PublishCredentialsPort`
  (`createHttpPublishCredentials` / `createMemoryPublishCredentials`). Its wire types live in
  `@jini-ai/core/contracts/site/api-security-api-types`; hosts import them from there.
- **Module options** (`security({ ui }, { … })`):
  - `t?` and the live `t` on `feature.react.Provider`: the translator (a locale change never remounts).
  - `rootKeyTab?: { generate?, defaultEnvVarName?, previewRequired? }`: merged into the root-key tab's
    params. `previewRequired: false` lets a failed preview still open the confirm step (DC-5).
  - `describeError?({ error })`: reads a failure's `code`. Any `detail` is ignored (reader text that
    may echo the key).
  - `describeRefusal?({ code })`: approved, translated copy for a refusal code; otherwise fixed copy.
  - `clipboard?`: what Copy writes to; defaults to the browser clipboard; a denied write is silent.
  - `tabIcons?`, `rootKeyScopeNotice?`, and `ownerControls` on the Provider.
  - `otherStores?` (SEC-13): `{ [store]: { href, label } }` deep links to the screen that owns each other
    store; product routes stay in the host.
  - `refreshSignal?` (SEC-14, OD-3 d): the host's content-refresh subscription; both credential controllers
    subscribe when created and unsubscribe on dispose. `onCredentialsChanged?` is the host's publication
    callback (read with `useSecurityCredentialsHost`).
  - `describeCredentialError?` (SEC-14): actionable, translated copy for a failed credential write. Submitted
    secrets are cut out of it; without it, fixed copy shows.
- **HTTP other stores** (`createHttpOtherCredentials(…, { mediaOrder?, tokenHints?, mediaLabels? })`):
  `mediaOrder: 'replaced-last'` keeps a host's existing W12 byte order; `tokenHints: true` opts in to
  server-approved masked hints. Built-in MCP servers are never listed.
- **Shared Keys and project keys** (SEC-12, OD-3 c): `SecurityApiPort.sharedKeys?` and `useProjectKey?`. Omit them and
  no "Use a saved key" control or Use / Stop using action renders. `createHttpSecurityApi(..., { sharedKeys: true })`
  adds both; `createHttpCredentialCopy` serves the host's own client names. Hints shown are the server's masked
  `tokenHint` only. The dialog's parts carry `data-jini-part="security.shared-keys.{source,list,results}"` for host CSS.
- **Access tokens tab** (`security({ ui }, { accessTokensTab: { pluginsHref } })`): the host's plugins page, linked
  from the empty-hosting hint. Its copy comes from the translator (`messages.en.ts` keys).
- **View bindings** (`react/bindings.ts`): the module binds the page, access-tokens tab (view model, editor, Shared Keys) and root-key tab hooks
  (chrome, ports and `useController`) and passes them to the views as required inputs.
