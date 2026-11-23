# source-control/site

Host-neutral pieces of a site's source-control (commit-to-git-host) feature, moved out of a host product.

## Wiring

- `commit-schema.ts`, `credential-form.ts` — see each file's header.
- `saved-key-bindings.ts` (`@jini-ai/devops/source-control/site/saved-key-bindings`, universal): `sourceControlSavedApiKeyLabels`, the provider id -> saved custom API-key label map. Only declared bindings may supply a commit fallback; explicit source-control connections always win. **Needs injected**: nothing; the host reads it when binding its saved-key lookup and its owner-store mapping.
- **Must never import**: a host credential store or a provider SDK.
