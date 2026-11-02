# @jini-ai/plugin-charts-recharts

Independently installable Recharts chart provider for Jini's existing plugin host, plus its
`charts-recharts` agent plugin (the charts skill; no code). Installing the npm package activates
neither payload. It has no runtime, peer, optional or other plugin dependencies and no install hook.

## Provider

`plugins/charts-recharts/<package-version>/jini.plugin.json` declares one browser provider:
`plugin.recharts`, kind `chart`, contract version 1, drawing `bar`, `line` and `pie` with one
series. Its client bundle (`client/provider.js`, `client/styles.css`) is self-contained: Recharts
and React are bundled at build time and the bundle has no imports. The server entry registers
nothing. Hosts admit the declared assets against the integrity map, then mount through
`@jini-ai/ui/charts`. Publisher id: `tovu/charts-recharts`.

Resolve `@jini-ai/plugin-charts-recharts/package.json` with Node's package resolver and read the
artifact beneath that root, or through the `./plugins/*` export, with the existing
preview/install/enable flow. No new loader is required.

## Agent plugin

`@jini-ai/plugin-charts-recharts/plugin.json` resolves the payload `charts-recharts/` (exported as
`./charts-recharts/*`). It installs through the existing Agent Plugin lifecycle. Its publisher id is
`jini/charts-recharts-agent`, distinct from the provider's, and it names the provider through
`providerPlugin: "charts-recharts"`, so a host that links faces switches it with the provider. The
skill teaches chart discovery (`search_components "chart"`), the data each chart component takes,
the generic `chart.spec` entry and what falls back to a table. The host decides whether to stage it.

## Build

Sources remain in `packages/provider-plugins/src/charts-recharts` and
`packages/agent-plugins/charts-recharts`. Both `build` and `prepack` call the existing
single-plugin builder, using this package's version for the generated artifact, then the agent
plugin assembler. The npm version follows Jini's fixed Changesets release group; the inner
`plugin.json` version is **0.1.0** and changes only when the skill changes. Build output under
`plugins/` and `charts-recharts/` is generated and uncommitted. Reviewed LICENSE and NOTICE files
belong to this distribution; the builder retains them and bundled dependency licenses inside the
artifact before computing its integrity.
