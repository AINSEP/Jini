# @jini-ai/plugin-analytics-posthog

Independently installable PostHog provider for Jini's existing plugin host.
This package ships only `analytics-posthog`; vendor SDKs are bundled at build time.
It has no runtime, peer, optional, or other plugin dependencies and no install hook.
Installing the npm package does not activate the plugin.

Resolve `@jini-ai/plugin-analytics-posthog/package.json` with Node's package resolver.
Discover `plugins/analytics-posthog/<package-version>/jini.plugin.json` beneath that root,
then use the existing preview/install/enable/configure flow and provider artifact loader.
The `./plugins/*` export exposes the same artifact files; no new loader is required.
The contribution remains `product_analytics/posthog`, contract version 1.

The provider implements `@jini-ai/analytics/product`. Hosts retain product analytics privacy
and consent guards. The consent contribution loads the byte-pinned browser SDK only after
the applicable consent choice; its adapter and SDK stay within this plugin's artifact.

Sources remain in `packages/provider-plugins/src/analytics-posthog`.
Both `build` and `prepack` call the existing single-plugin builder, using this package's
version for the generated artifact. The npm release is **0.6.15** in Jini's fixed
Changesets release group. Build output under `plugins/` is generated and uncommitted.
Reviewed LICENSE and NOTICE files belong to this distribution; the builder retains them
and bundled dependency licenses inside the artifact before computing its integrity.
