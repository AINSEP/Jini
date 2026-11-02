---
name: charts-recharts
version: 0.1.0
last_updated: 2026-11-02
description: Use when the user asks for a chart, graph or plot of data (counts, totals, trends over time, shares of a whole) and the Recharts chart provider is enabled. Covers finding the chart components, the data each takes, what Recharts draws, and when to use the generic chart.spec entry.
---

# Skill: Charts with Recharts

The Recharts provider draws charts the host shows in chat or on a canvas. You never write chart
code. You pick a chart component from the host's component catalog and hand it data as props.

## Find the components first

1. Call `search_components` with `"chart"` (or the shape you need, such as "bar chart of counts by
   category" or "trend over months").
2. Call `describe_component` on the one or two ids that fit, to read the exact props schema.
3. Render through the host's UI-rendering tool (the one that takes a component tree). Put the chart
   inside a layout component if the tool needs a root.

The catalog is the source of truth. Ids and schemas below are what it lists today; if the catalog
differs, follow the catalog.

## Which kind

| Question the chart answers | Kind |
|---|---|
| How do categories compare (posts by status, sales by region)? | `bar` |
| How did a value change over time (sign-ups per month)? | `line` |
| What share of a whole does each part take (pages vs posts)? | `pie` |

Recharts draws `bar`, `line` and `pie` only. For any other kind (area, scatter, stacked bars), check
`search_components "chart"` for another provider; if none draws it, the data shows as a table.

## The components and their data

**One series, simplest props** (bar and line share one schema):

- `recharts.bar-chart`, `recharts.line-chart`:
  `{ data: [rows], categoryKey, valueKey, valueLabel?, color? }`.
  Every row has the category (`categoryKey`) and a number (`valueKey`).
  `valueLabel` is the human name shown in the legend and tooltip ("Sign-ups"). Set it whenever
  the key is not already readable.
- `recharts.pie-chart`: `{ data: [{ name, value }], color? }`. One row per slice.

The catalog may also list `plugin.recharts.bar-chart` and similar ids. They take the same props and
always ask Recharts by name.

**Any kind, one or more series: `chart.spec`**

```json
{ "spec": {
  "kind": "bar",
  "categoryKey": "month",
  "series": [{ "key": "signups", "label": "Sign-ups" }],
  "data": [{ "month": "Jan", "signups": 12 }, { "month": "Feb", "signups": 19 }],
  "title": "Sign-ups by month"
} }
```

- Every row carries the category and a number (or `null` for a gap) for every series key.
- Series keys are unique. There is at least one row and one series.
- For a pie, `categoryKey` names the slices and the single series holds the values.
- `spec.provider: "plugin.recharts"` asks for Recharts when several providers are enabled.
- `chart.spec` is always in the catalog. With no provider enabled, it shows the data as a table.

## What Recharts draws, and what falls back

Recharts draws a spec only when all of these hold:

- the kind is `bar`, `line` or `pie`;
- there is exactly **one** series and a `categoryKey`;
- every value is a finite number (no `null` gaps);
- the spec sets no `axes` or `format`.

Anything else goes to another enabled provider that accepts it, or shows as a table. Nothing is
lost, but tell the user when you know the result will be a table (for example two series with only
Recharts enabled). Offer one chart per series instead.

## Making it read well

- Aggregate first. Send the counts or totals to plot, not raw records.
- Bars: about 12 categories or fewer. Sort by value unless the order means something (months,
  stages). Long labels wrap onto up to three lines; in narrow spaces some labels are skipped, and
  the full label stays in the tooltip.
- Lines: time in order, oldest first. Long series are fine; the axis thins its own labels.
- Pies: 6 slices or fewer, values that add up to a meaningful whole. Merge the small ones into
  "Other". Use a bar chart when the user needs to compare similar values.
- Whole-number data (counts) gets whole-number axis ticks automatically. Do not round other data
  to force it.
- Leave `color` out unless the user asks. The host theme colours the chart.
- Give a short title that states what is shown ("Posts by status"), and a description when the
  chart makes a point the title doesn't.
- Keep labels short and human: "Published", not `post_status_published`.

## Never

- Never paste Recharts, React, SVG or HTML chart code into the chat, a page or a file to draw a
  chart. The provider owns the drawing; your job is the data and the component choice.
- Never invent data. If you can't get the numbers, say so and ask.
- Never claim a chart rendered when the host reported a refusal. Read the error, fix the props
  (usually a missing key or a string where a number belongs), and try once more.

## When charts are off

If the chart entries `search_components` returns all report provider `core.table`, no chart
provider is enabled. The data will show as a table; say so, and tell the user an administrator can
turn the Recharts chart provider on.
