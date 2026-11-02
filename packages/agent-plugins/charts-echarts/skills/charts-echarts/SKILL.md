---
name: charts-echarts
version: 0.1.0
last_updated: 2026-11-02
description: Use when the user asks for a chart, graph or plot of data (comparisons, trends, shares of a whole, stacked totals, correlations) and the ECharts chart provider is enabled. Covers finding the chart components, the data each takes, several series in one chart, axis names and number formats, and what falls back to a table.
---

# Skill: Charts with ECharts

The ECharts provider draws charts the host shows in chat or on a canvas. You never write chart
code. You pick a chart component from the host's component catalog and hand it data as props.

## Find the components first

1. Call `search_components` with `"chart"` (or the shape you need, such as "stacked bar of revenue
   and cost by month" or "scatter of height against weight").
2. Call `describe_component` on the one or two ids that fit, to read the exact props schema.
3. Render through the host's UI-rendering tool (the one that takes a component tree). Put the chart
   inside a layout component if the tool needs a root.

The catalog is the source of truth. Ids and schemas below are what it lists today; if the catalog
differs, follow the catalog.

## Which kind

| Question the chart answers | Kind |
|---|---|
| How do categories compare (posts by status, sales by region)? | `bar` |
| How do parts add up per category (revenue split by product, per month)? | `stacked-bar` |
| How did a value change over time (sign-ups per month)? | `line` |
| How did a volume change over time, filled to the axis? | `area` |
| What share of a whole does each part take (pages vs posts)? | `pie` or `donut` |
| Do two measures move together (price against rating)? | `scatter` |

ECharts draws `bar`, `line`, `area`, `pie`, `donut`, `scatter` and `stacked-bar` only.

## The components and their data

**One series, simplest props** (`bar`, `line` and `pie` keep the shared single-series shapes):

- `plugin.echarts.bar-chart`, `plugin.echarts.line-chart`:
  `{ data: [rows], categoryKey, valueKey, valueLabel?, color? }`.
- `plugin.echarts.pie-chart`: `{ data: [{ name, value }], color? }`. One row per slice.

**Every other kind, and any chart with several series: `{ spec }`**

`plugin.echarts.area-chart`, `.donut-chart`, `.scatter-chart` and `.stacked-bar-chart` take
`{ spec }` with that `spec.kind`. `chart.spec` takes the same `{ spec }` for any kind:

```json
{ "spec": {
  "kind": "stacked-bar",
  "categoryKey": "month",
  "series": [{ "key": "revenue", "label": "Revenue" }, { "key": "cost", "label": "Cost" }],
  "data": [{ "month": "Jan", "revenue": 120, "cost": 80 }, { "month": "Feb", "revenue": 150, "cost": null }],
  "title": "Revenue and cost by month",
  "axes": { "y": { "label": "USD", "format": { "notation": "compact" } } },
  "provider": "plugin.echarts"
} }
```

- Every row carries the category and a number (or `null` for a gap) for every series key.
- Series keys are unique. There is at least one row and one series.
- `spec.provider: "plugin.echarts"` asks for ECharts when several chart providers are enabled.
- `axes.x.label` / `axes.y.label` name the axes. `format` (or `axes.x.format` / `axes.y.format`,
  which win) takes `{ locale?, notation? }`, with `notation` `"standard"` or `"compact"` (1.5K).

## Kind rules

- `pie` and `donut`: exactly **one** series of numbers that are zero or more, with a total above
  zero. `categoryKey` names the slices. No gaps.
- `scatter`: `categoryKey` is the numeric **x** of every point; each series is a **y**. Points with
  a `null` y are left out.
- `bar`, `stacked-bar`, `line`, `area`: any number of series; `null` leaves a gap.

## What falls back

ECharts draws a spec only when the kind is one of its seven, there is a `categoryKey`, at least
one row and series, every value is a finite number or `null` (at least one is a number), the kind
rules above hold and any `locale` is a valid language tag. Anything else goes to another enabled
provider that accepts it, or shows as a table. Nothing is lost, but tell the user when you know
the result will be a table.

## Making it read well

- Aggregate first. Send the counts or totals to plot, not raw records.
- Bars: about 12 categories or fewer. Sort by value unless the order means something (months,
  stages). In narrow spaces some category labels are skipped; the tooltip keeps every value.
- Stacked bars: 2 to 5 series, in a fixed order the user would read top to bottom.
- Lines and areas: time in order, oldest first; up to about 5 series.
- Pies and donuts: 6 slices or fewer, values that add up to a meaningful whole. Merge the small
  ones into "Other". Use a bar chart when the user needs to compare similar values.
- Whole-number data (counts) gets whole-number axis ticks automatically.
- Leave `color` out unless the user asks. The host theme colours the chart.
- Give a short title that states what is shown, and a description when the chart makes a point
  the title doesn't. Keep labels short and human: "Published", not `post_status_published`.

## Never

- Never paste ECharts, SVG or HTML chart code into the chat, a page or a file to draw a chart.
  The provider owns the drawing; your job is the data and the component choice.
- Never invent data. If you can't get the numbers, say so and ask.
- Never claim a chart rendered when the host reported a refusal. Read the error, fix the props
  (usually a missing key or a string where a number belongs), and try once more.

## When charts are off

If the chart entries `search_components` returns all report provider `core.table`, no chart
provider is enabled. The data will show as a table; say so, and tell the user an administrator can
turn the ECharts chart provider on.
