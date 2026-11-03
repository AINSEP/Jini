# Plugin subpaths

Every agent plugin ships from `@jini-ai/agent-plugins`; provider runtime artifacts ship from
`@jini-ai/provider-plugins`. Standalone per-plugin npm wrappers are retired and must never be
published again. Resolving an agent subpath or loading a selected provider never imports a sibling.

| Agent manifest subpath | Provider artifact subpath |
| --- | --- |
| `@jini-ai/agent-plugins/langfuse` | `@jini-ai/provider-plugins/ai-trace-langfuse/*` |
| `@jini-ai/agent-plugins/posthog` | `@jini-ai/provider-plugins/analytics-posthog/*` |
| `@jini-ai/agent-plugins/opentelemetry` | `@jini-ai/provider-plugins/observability-opentelemetry/*` |
| `@jini-ai/agent-plugins/sentry` | `@jini-ai/provider-plugins/observability-sentry/*` |
| `@jini-ai/agent-plugins/stripe` | `@jini-ai/provider-plugins/payments-stripe/*` |
| `@jini-ai/agent-plugins/ui-ux-design` | — |

Other agent plugins use the same `./<id>` and `./<id>/*` exports. Charts remain provider subpaths.
`@jini-ai/plugin-catalog/catalog` is optional metadata and carries no plugin code. Its name is the
explicit metadata-library exception to the wrapper publication guard. The virtual host SDK import
alias is a resolver contract; it is not an npm wrapper package.

## Host migration

1. Depend on the two owning distributions and retain existing lifecycle and domain-contract
   packages. Remove standalone vendor dependencies, including development-only OTLP wrappers.
2. Resolve `@jini-ai/agent-plugins/<id>` to its `plugin.json`, then stage only that manifest's
   containing directory. Use `packAgentPluginDirectory`, installation, activation and trusted-file
   readers from the existing lifecycle. The inner agent version remains independent of npm versions.
3. Resolve `@jini-ai/provider-plugins/package.json` using the host's normal payload/shell search
   roots. Select `plugins/<id>/<package-version>` and pass it through the existing discovery,
   installer and `loadProviderPluginArtifact`. Provider subpaths expose these same files.
4. Keep settings, admission, consent, atomic cleanup and disposal unchanged. A dependency or
   catalog record grants no activation authority. Desktop staging follows declared production
   dependencies and required peers; development dependencies and extraneous linked packages stay out.

Tovu's design tool restrictions remain host policy. Stripe retains hosted Checkout, signed webhook
and commerce evidence behavior. No stored-site or activation migration is required.

## Release

Keep the fixed `@jini-ai/*` Changesets group and workspace wildcard; deleted directories require no
special exclusions. Build `provider-plugins` before generating the metadata catalog. Provider
artifacts retain each provider's README, LICENSE, NOTICE and changelog alongside bundled dependency
licenses, all sealed by the existing integrity owner. Agent assets publish in place, with their
tests excluded. The assembler and legacy standalone-agent publication map are removed.

The checked-in provider catalog may carry `expectedDigests: null` while awaiting a build. Release
catalog generation refuses missing or stale artifacts and computes exact digests; it never imports
provider code. Release versions, provider manifest export paths and the provider-local catalog must
advance together. The current provider distribution version still needs the normal release bump
above its previously published prereleases.

`publish-pending.ts`, `publish-all.ts` and the shared packing library refuse retired wrapper names
before publication effects. The private provider conformance fixture remains test-only and is also
refused by direct packing through that library. The release workflow includes the publication guard
regression tests. Existing published wrapper versions remain registry history; this change issues
no registry mutation or deprecation command.
