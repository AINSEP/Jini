# deploy/site

Site-host deploy seams: the deployment-provider port types, the deploy-config descriptor and generator kit,
and the plugin-contributed deploy-config generator registry.

## Wiring

- `ports.ts` — types only, generic over the host's HTTP client type (`THttpClient`, default
  `@jini-ai/core/primitives`' `HttpClientPort`). A host whose guarded client has another `send` shape pins
  its own client type at the use site.
- `deploy-config.ts` — the host injects the CLI command label used in error text, the declared secrets, the
  readiness route source (`relPath`, `pattern`, `sourceFile`), the repo root, the overlay root, its
  validation-error constructor and its migrations note. Bound in the host's `features/deployments/deploy-config.ts`.
- `deploy-config-registry.ts` — `createDeployConfigGeneratorSource` takes the product-named manifest
  filename, the bundled plugin source lister, agent-plugins' `defineExecutablePluginContribution` /
  `loadPluginContributionsFromSource` and a refusal logger (`warn`). Bound once in the host's
  `features/deployments/deploy-config-registry.ts`.
