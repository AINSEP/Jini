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
- **View bindings** (`react/bindings.ts`): the module binds the page and root-key tab hooks
  (chrome, ports and `useController`) and passes them to the views as required inputs.
