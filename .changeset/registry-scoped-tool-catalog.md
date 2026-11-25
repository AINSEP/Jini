---
"@jini-ai/registry": minor
---

Add `createScopedToolCatalog` and `projectEntityDiscriminator` to `@jini-ai/registry/tool-catalog-builder`. One shared, identity-neutral discovery index is now served per principal: each request resolves a server-derived scope (workspace, principal, permission version, registry revision, allowed tools), an unknown scope discovers nothing and never falls back to the unscoped index, and personalized results are cached only when the host injects a cache and names a permission version, keyed by the full scope. An entity discriminator enum is narrowed per tool and principal on a cloned schema; no permitted entity type means the tool is not offered. The returned `catalogFor` fits `@jini-ai/daemon/http`'s existing `ScopedToolCatalogHttpDeps` port unchanged.
