# @jini-ai/plugin-charts-recharts

## Unreleased

### Minor Changes

- New package: the Recharts chart provider (`charts-recharts`, browser provider `plugin.recharts`,
  kinds bar, line and pie; publisher id `tovu/charts-recharts`) and its `charts-recharts` agent
  plugin (publisher id `jini/charts-recharts-agent`, `providerPlugin: "charts-recharts"`), each
  installable on its own. The agent plugin is one skill: finding chart components, their data
  shapes, `chart.spec`, Recharts' single-series limits and the table fallback. No MCP server.
