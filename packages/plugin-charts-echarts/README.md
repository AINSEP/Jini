# @jini-ai/plugin-charts-echarts

Independently installable Apache ECharts chart provider for Jini's existing plugin host, plus its
`charts-echarts` agent plugin (the charts skill; no code). Installing the npm package activates
neither payload. It has no runtime, peer, optional or other plugin dependencies and no install hook.
No host selects it by default; Recharts stays the default chart provider.

## Provider

`plugins/charts-echarts/<package-version>/jini.plugin.json` declares one browser provider:
`plugin.echarts`, kind `chart`, contract version 1, drawing `bar`, `line`, `area`, `pie`, `donut`,
`scatter` and `stacked-bar` with one or more series (pie and donut take one). It draws axis names and
`format` / axis number formats; scatter reads `categoryKey` as the numeric x and each series as a y.
It renders SVG only, with ECharts' aria description on, and paints with the host's `--jini-chart-*`
tokens. Specs it would draw incompletely are refused through `supportsEChartsSpec`, so the host falls
back to the next provider or the data table.

Its client bundle (`client/provider.js`, `client/styles.css`) is self-contained: ECharts' modular
core (bar, line, pie and scatter charts; aria, grid, legend, title and tooltip components; the SVG
renderer only) and ZRender are bundled at build time and the bundle has no imports. The server entry
registers nothing. Hosts admit the declared assets against the integrity map, then mount through
`@jini-ai/ui/charts`. Publisher id: `jini/charts-echarts`.

Resolve `@jini-ai/plugin-charts-echarts/package.json` with Node's package resolver and read the
artifact beneath that root, or through the `./plugins/*` export, with the existing
preview/install/enable flow. No new loader is required.

## Size

**Not measured yet.** The size comes from the build's esbuild metafile, and this package was written
without running a build. Measure the exact bundle the builder emits (same esbuild settings) with:

```sh
cd packages/provider-plugins
npx esbuild src/charts-echarts/client/provider.ts --bundle --format=esm --platform=browser \
  --target=es2022 --minify --legal-comments=inline --define:process.env.NODE_ENV='"production"' \
  --metafile=/tmp/echarts-meta.json --outfile=/tmp/echarts-provider.js
wc -c /tmp/echarts-provider.js && gzip -9c /tmp/echarts-provider.js | wc -c
```

Then replace this paragraph with the minified and gzipped bytes and the ECharts version (6.1.0).

## Agent plugin

`@jini-ai/plugin-charts-echarts/plugin.json` resolves the payload `charts-echarts/` (exported as
`./charts-echarts/*`). It installs through the existing Agent Plugin lifecycle. Its publisher id is
`jini/charts-echarts-agent`, distinct from the provider's, and it names the provider through
`providerPlugin: "charts-echarts"`, so a host that links faces switches it with the provider. The
skill teaches chart discovery (`search_components "chart"`), the data each chart component takes,
`chart.spec` with several series, axis names and number formats, and what falls back to a table.
The host decides whether to stage it.

## Build

Sources remain in `packages/provider-plugins/src/charts-echarts` and
`packages/agent-plugins/charts-echarts`. Both `build` and `prepack` call the existing
single-plugin builder, using this package's version for the generated artifact, then the agent
plugin assembler. The npm version follows Jini's fixed Changesets release group; the inner
`plugin.json` version is **0.1.0** and changes only when the skill changes. Build output under
`plugins/` and `charts-echarts/` is generated and uncommitted. Reviewed LICENSE and NOTICE files
belong to this distribution; the builder retains them and bundled dependency licenses inside the
artifact before computing its integrity.
