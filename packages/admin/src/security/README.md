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
  - `tabIcons?`, `rootKeyScopeNotice?`, and `ownerControls` on the Provider.
  - `otherStores?` (SEC-13): `{ [store]: { href, label } }` deep links to the screen that owns each other
    store; product routes stay in the host.
  - `refreshSignal?` (SEC-14, OD-3 d): the host's content-refresh subscription; both credential controllers
    subscribe when created and unsubscribe on dispose. `onCredentialsChanged?` is the host's publication
    callback (read with `useSecurityCredentialsHost`); a Shared Keys grant calls it exactly once. When both
    are wired the publication's own subscription does the reload; otherwise the tab also reloads directly.
  - `describeCredentialError?` (SEC-14): actionable, translated copy for a failed credential write. Submitted
    secrets are cut out of it; without it, fixed copy shows.
  - `credentialDraftError?` (SEC-14): the draft token check run before any write (`required` on a create).
    The host binds the exported `credentialDraftError({ value, assertToken, describeInputError }, { required })`
    to its token validator and its locale copy; the returned copy is cut against the typed draft.
- **HTTP other stores** (`createHttpOtherCredentials(…, { tokenHints?, mediaLabels? })`): a media key
  Replace is one `PATCH …/media/providers/:providerId` carrying only `{ apiKey }`, and Remove is one
  `DELETE` on that row — never a read-then-rewrite of the whole map, so the revision-guarded whole-map
  PUT is not used and no sibling is touched. The host transport must forward `PATCH`. `mediaOrder` is
  deprecated and has no effect. `tokenHints: true` opts in to server-approved masked hints. Built-in MCP
  servers are never listed.
- **Shared Keys and project keys** (SEC-12, OD-3 c): `SecurityApiPort.sharedKeys?` and `useProjectKey?`. Omit them and
  no "Use a saved key" control or Use / Stop using action renders. `createHttpSecurityApi(..., { sharedKeys: true })`
  adds both; `createHttpCredentialCopy` serves the host's own client names. Hints shown are the server's masked
  `tokenHint` only. The dialog's parts carry `data-jini-part="security.shared-keys.{source,list,results}"` for host CSS.
- **Access tokens tab** (`security({ ui }, { accessTokensTab: { pluginsHref } })`): the host's plugins page, linked
  from the empty-hosting hint. Its copy comes from the translator (`messages.en.ts` keys).
- **Clipboard** (required): `security({ ui, ChipField, clipboard })`. `clipboard` (`{ writeText }`) is what the root-key
  Copy writes to; the host binds its browser clipboard (Jini reads no ambient `navigator.clipboard`). A denied write is silent.
- **Chip field slot** (SEC-10/11, required): `security({ ui, ChipField })`. `ChipField` is the host's multiple-choice chip
  component, typed by the Security-owned `SecurityChipFieldProps` (`{ multiple: true, label, options, value, onChange }`); no kit
  name exists for it. The module passes it through `loadAccessTokensTab({ ChipField })` to the credential editor, which renders
  "Works for" for publish and custom credentials (a saved id whose plugin is off stays as its own chip). The host binds its own chip
  field at cutover.
- **Custom credentials client** (SEC-11): `createHttpCustomCredentials({ transport, workspacePath })` serves the host's own
  method names (`listCustomCredentials`, `createCustomCredential`, `updateCustomCredential`, `deleteCustomCredential`), bodies
  exactly as given (W8).
- **Remove copy** (SEC-10): the confirm label is the translator key `removeCredentialConfirm`; a host passes its product
  wording through `t`.
- **View bindings** (`react/bindings.ts`): the module binds the page, access-tokens tab (view model, editor, Shared Keys) and root-key tab hooks
  (chrome, ports and `useController`) and passes them to the views as required inputs.
