# @jini-ai/plugin-observability-opentelemetry

Independently installable OpenTelemetry provider for Jini's existing plugin host.
This package ships only `observability-opentelemetry`; vendor SDKs are bundled at build time.
It has no runtime, peer, optional, or other plugin dependencies and no install hook.
Installing the npm package does not activate the plugin.

Resolve `@jini-ai/plugin-observability-opentelemetry/package.json` with Node's package resolver.
Discover `plugins/observability-opentelemetry/<package-version>/jini.plugin.json` beneath that root,
then use the existing preview/install/enable/configure flow and provider artifact loader.
The `./plugins/*` export exposes the same artifact files; no new loader is required.
The contribution remains `observability/opentelemetry`, contract version 1.

The provider implements `@jini-ai/diagnostics/observability`, exporting traces and metrics
to a host-configured OTLP/HTTP endpoint. Existing authentication and privacy behavior remains
with the provider. This server-only plugin has no browser consent adapter.

Sources remain in `packages/provider-plugins/src/observability-opentelemetry`.
Both `build` and `prepack` call the existing single-plugin builder, using this package's
version for the generated artifact. The npm release is **0.6.15** in Jini's fixed
Changesets release group. Build output under `plugins/` is generated and uncommitted.
Reviewed LICENSE and NOTICE files belong to this distribution; the builder retains them
and bundled dependency licenses inside the artifact before computing its integrity.
