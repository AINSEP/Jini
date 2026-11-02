# @jini-ai/plugin-analytics-posthog

Independently installable PostHog provider for Jini's existing plugin host.
This package ships the `analytics-posthog` provider and its `posthog` agent plugin (the PostHog setup
skill and key card; no code). Vendor SDKs are bundled into the provider at build time.
It has no runtime, peer, optional, or other plugin dependencies and no install hook.
Installing the npm package does not activate either payload.

Resolve `@jini-ai/plugin-analytics-posthog/package.json` with Node's package resolver.
Discover `plugins/analytics-posthog/<package-version>/jini.plugin.json` beneath that root,
then use the existing preview/install/enable/configure flow and provider artifact loader.
The `./plugins/*` export exposes the same artifact files; no new loader is required.
The contribution remains `product_analytics/posthog`, contract version 1.

The provider implements `@jini-ai/analytics/product`. Hosts retain product analytics privacy
and consent guards. The consent contribution loads the byte-pinned browser SDK only after
the applicable consent choice; its adapter and SDK stay within this plugin's artifact.

The agent plugin resolves at `@jini-ai/plugin-analytics-posthog/plugin.json` (payload `posthog/`, exported
as `./posthog/*`) and installs through the existing Agent Plugin lifecycle. It sets up the
provider and turns on and off with it; the host decides whether to stage it.

Sources remain in `packages/provider-plugins/src/analytics-posthog` and `packages/agent-plugins/posthog`.
Both `build` and `prepack` call the existing single-plugin builder, using this package's
version for the generated artifact, then the agent plugin assembler. The npm release is **0.6.17** in Jini's fixed
Changesets release group. Build output under `plugins/` and `posthog/` is generated and uncommitted.
Reviewed LICENSE and NOTICE files belong to this distribution; the builder retains them
and bundled dependency licenses inside the artifact before computing its integrity.
