# @jini-ai/plugin-observability-opentelemetry

Independently installable OpenTelemetry provider for Jini's existing plugin host.
This package ships the `observability-opentelemetry` provider and its `opentelemetry` agent plugin (the OpenTelemetry setup
skill and key card; no code). Vendor SDKs are bundled into the provider at build time.
It has no runtime, peer, optional, or other plugin dependencies and no install hook.
Installing the npm package does not activate either payload.

Resolve `@jini-ai/plugin-observability-opentelemetry/package.json` with Node's package resolver.
Discover `plugins/observability-opentelemetry/<package-version>/jini.plugin.json` beneath that root,
then use the existing preview/install/enable/configure flow and provider artifact loader.
The `./plugins/*` export exposes the same artifact files; no new loader is required.
The contribution remains `observability/opentelemetry`, contract version 1.

The provider implements `@jini-ai/diagnostics/observability`, exporting traces and metrics
to a host-configured OTLP/HTTP endpoint. Existing authentication and privacy behavior remains
with the provider. This server-only plugin has no browser consent adapter.

The agent plugin resolves at `@jini-ai/plugin-observability-opentelemetry/plugin.json` (payload `opentelemetry/`, exported
as `./opentelemetry/*`) and installs through the existing Agent Plugin lifecycle. It sets up the
provider and turns on and off with it; the host decides whether to stage it.

Sources remain in `packages/provider-plugins/src/observability-opentelemetry` and `packages/agent-plugins/opentelemetry`.
Both `build` and `prepack` call the existing single-plugin builder, using this package's
version for the generated artifact, then the agent plugin assembler. The npm release is **0.6.17** in Jini's fixed
Changesets release group. Build output under `plugins/` and `opentelemetry/` is generated and uncommitted.
Reviewed LICENSE and NOTICE files belong to this distribution; the builder retains them
and bundled dependency licenses inside the artifact before computing its integrity.


The host must pass `exportEnabled: true` in provider factory options to permit outbound
observability. Missing permission denies export while preserving local admission. Resolve the
boolean using `observabilityExportAllowed` from `@jini-ai/diagnostics/observability`; runtime
eligibility remains separate from configuration and consent. Rebuild this standalone artifact
when its provider implementation changes; installed bundles do not read workspace sources.
