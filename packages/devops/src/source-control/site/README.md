# source-control/site

Host-neutral pieces of a site's source-control (commit-to-git-host) feature, moved out of a host product.

## Wiring

- `commit-schema.ts`, `credential-form.ts` — see each file's header.
- `saved-key-bindings.ts` (`@jini-ai/devops/source-control/site/saved-key-bindings`, universal): `sourceControlSavedApiKeyLabels`, the provider id -> saved custom API-key label map. Only declared bindings may supply a commit fallback; explicit source-control connections always win. **Needs injected**: nothing; the host reads it when binding its saved-key lookup and its owner-store mapping.
- **Must never import**: a host credential store or a provider SDK.
- `provider-module.ts` (`@jini-ai/devops/source-control/site/provider-module`, universal): the contract a git-host provider module (shipped in a plugin) is written against, plus `SourceControlKitHttpClient`, the positional guarded client those modules call (`send(request, { redirect })`). **Needs injected**: nothing; types only.
- `provider-kit.ts` (`.../provider-kit`, universal): `createSourceControlProviderKit({ host }, { httpClient, fetchFn, sleep })`. **Needs injected**: `host.describeTransportError({ error })` (the raw transport error in; the host returns the caller-safe refusal text or `undefined`, plus the redacted log detail; the kit formats nothing) and optionally `host.observeFetch({ fetch })` (wraps raw fetch in an outbound span). The host's positional guarded client is passed as `httpClient` unchanged; without one, calls through `kit.httpClient` reject as a transport error.
- `commit-target.ts` (`.../commit-target`, universal): `validateCommitTarget`, the stricter branch/folder/message check run before a commit. **Needs injected**: the provider module's own `validateTarget`, when it has one.
- `static-site-packager-port.ts` (`.../static-site-packager-port`, universal): `StaticSitePackagerPort<R>`, implemented by the host's backup packager; `R` is the host's (possibly extended) export report. **Needs injected**: nothing; types only.
