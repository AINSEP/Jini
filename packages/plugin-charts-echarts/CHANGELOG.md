# @jini-ai/plugin-charts-echarts

## Unreleased

### Minor Changes

- New package: the Apache ECharts chart provider (`charts-echarts`, browser provider `plugin.echarts`,
  kinds bar, line, area, pie, donut, scatter and stacked-bar, several series; publisher id
  `jini/charts-echarts`) and its `charts-echarts` agent plugin (publisher id
  `jini/charts-echarts-agent`, `providerPlugin: "charts-echarts"`), each installable on its own. The
  agent plugin is one skill: finding chart components, their data shapes, `chart.spec` with several
  series, axis names and number formats, the pie and scatter rules and the table fallback. No MCP
  server. Not selected by default in any host.
