---
"@jini-ai/admin": patch
---

Add `@jini-ai/admin/screens/plugins/composer-capabilities`: the composer-capability contract (`ComposerCapability`, `ComposerCapabilitySource`, `ComposerCapabilityProjection`, `ComposerHostBinding`), the fail-closed `projectComposerCapabilities`, `emptyComposerCapabilityProjection` and the name-first `rankComposerDiscoveryGroups`, moved from the reference host. Hosts pass their capability sources in; product catalogs and route resolvers stay in the host.
