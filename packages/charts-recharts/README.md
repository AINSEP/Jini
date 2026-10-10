# @jini-ai/charts-recharts — complete chart copy

Owner plan: Tovu `development/todos.md`, “Bring-your-own chart library”, OWNER 2026-10-09.
This is the step 3 head start: **copy**, statically bundle, register, and verify with real assistant data.
Nothing has been removed from `@jini-ai/ui`. Runtime plugin loading, framework-neutral mount,
ChartSpec, new chart kinds, and removal from ui remain future work.

Inventory checked 2026-10-09: ui has exactly three chart renderers/catalog entries: bar,
line (with area fill), and pie (rendered as a donut). All three were already copied by the
prototype. There are no additional area/radar/scatter/etc. components to extract. Chart-named
Remixicon glyphs are icons, not chart renderers, and stay in ui's shared icon system.

The bar, line, donut, config, tokens, and presentation are copied from
`@jini-ai/ui/src/features/interactive-ui/providers/recharts` (2026-10-08 shadcn-style theme).
`src/styles.css` and `src/chart-palette.css` copy the chart rules/palette, scoped to the plugin's
figure; base theme variables are imported from ui's public stylesheet. Host `--jini-chart-*`
overrides still win. Every copied “why” comment is retained. Apache-2.0; see LICENSE.

## Registration

```ts
import { registerChartProvider } from '@jini-ai/charts-recharts';
import '@jini-ai/charts-recharts/styles.css';

const chartRegistry = registerChartProvider({ registry: existingRegistry }, {});
```

Returns a new `InteractiveUiRegistry`; the input is unchanged. IDs are
`plugin.recharts.bar-chart`, `plugin.recharts.line-chart`, `plugin.recharts.pie-chart`, with
provider `plugin.recharts`. Registration puts these before the existing chart entries while
preserving the built-in fallback chain and non-chart providers. Repeated registration is idempotent.
React and ui are host peers; Recharts and Zod are this package's dependencies.

The public browser entry also exposes `ChartContainer`, `ChartTooltipContent`,
`ChartLegendContent`, `createChartConfig`, `formatChartValue`, `chartTickFormatter`,
`ChartConfig`, `ChartSeries`, and all `CHART_*` tokens from the copied provider.

Headless search/describe hosts can import `CHART_MANIFESTS`, `RECHARTS_WIRE_IDS`, and the individual
manifests/schemas from `@jini-ai/charts-recharts/manifests`. That universal entry imports no React,
Recharts, or CSS. The normal registry registration and ui's existing `buildA2uiCatalogFromRegistry`
turn these same manifests into A2UI catalog entries; no parallel catalog builder is introduced.

## Tovu admin wiring

`apps/admin/src/components/AssistantDock/chart-provider.ts` creates a stable registry at boot;
`RoutedA2uiSurfaceCard` supplies it to the real Jini `A2uiSurfaceCard` for both transcript and
Playground portal rendering. The chat card's optional `registry` prop supplies validation AND
component lookup. Keep the registry stable for a mounted card; remount to change catalogs.

The backend's existing `search_components` / `describe_component` catalog still advertises
`recharts.*`. The thin admin adapter uses the plugin-owned `RECHARTS_WIRE_IDS` map for all three IDs; the registered
built-in entries and schemas remain intact. No separate tool or component catalog is added.
Other components resolve unchanged, and an absent plugin entry falls back to the original ID.

Set `VITE_CHART_PLUGIN=1` to enable, `VITE_CHART_PLUGIN=0` to disable. When unset, it is on in dev
and off in production. Restart Vite (or rebuild) after changing the flag. This flag controls
registration/routing; this prototype is statically bundled, including its CSS.

In **Admin AI Assistant**, ask exactly:

> Call content_read.content_post twice: {kind:"post",status:"draft",limit:1} and
> {kind:"post",status:"published",limit:1}. Use each response's total as the real count,
> not the length of its capped posts array. Call search_components for bar-chart and
> describe_component for recharts.bar-chart, then call assistant_render_ui with one component:
> id root, component recharts.bar-chart, data containing those actual status/count pairs,
> categoryKey status, valueKey count. Do not invent values or create content. If both totals
> are zero, report that instead of fabricating a chart.

The render tool receives `{ components: [{ id: "root", component: "recharts.bar-chart",
data: <actual status/count rows>, categoryKey: "status", valueKey: "count" }] }`.
Check the rendered chart's **figure** for `data-chart-provider="plugin.recharts"`. In Playground
it appears on the canvas; elsewhere it appears inline. With the flag off the built-in still
renders and the plugin attribute is absent. The live assistant/browser check remains for the
coordinator; this implementation job does not launch servers or execute checks.

## Coordinator setup and verification

1. Run `pnpm install` in Jini; build the ui dependency if its dist is missing.
2. Build `@jini-ai/charts-recharts` and the changed `@jini-ai/chat` package.
3. Install Tovu dependencies and run `npm run link:jini` so the admin consumes the changed chat
   and new provider. Tovu's link list is derived from manifests, so no explicit list edit is needed.
4. Run the queued package, chat, and admin checks; then perform the live prompt above.

Tovu's admin manifest declares the normal published range `^0.1.0`, like the other Jini packages.
For local development, run `npm run link:jini` in Tovu; its manifest-derived discovery already
includes `charts-recharts`, so no new linking script or fixed package list is needed. The range
stays unchanged while local `node_modules` entries are symlinked. Release builds intentionally
reject those links; unlink and install the published package before shipping. Publishing 0.1.0
and coordinator install/lockfile refresh are still required; this job does not run installs/builds.

Build: `pnpm --filter @jini-ai/charts-recharts run build`.
Tests: `src/__tests__/provider.test.tsx` (registration and real SVG marks); the host/chat contract
tests cover the injected registry, flag, legacy wire IDs, canvas/inline paths, and updates.

## Later removal from @jini-ai/ui — checklist (do not apply yet)

Only remove ui's copies after the coordinator proves every plugin chart with real assistant data,
light/dark themes, host token overrides, tooltips, legends, keyboard access, and reduced motion.
Before removal, land the approved chart contract/table fallback and decide how legacy `recharts.*`
wire IDs stay valid when the plugin is unavailable. Today's flag-off behavior still uses ui charts.

- [ ] Delete these production files under `packages/ui/src/features/interactive-ui/providers/recharts/`:
  `bar-chart.tsx`, `line-chart.tsx`, `pie-chart.tsx`, `bar-chart.manifest.ts`,
  `line-chart.manifest.ts`, `pie-chart.manifest.ts`, `chart.tsx`, `chart-config.ts`,
  `chart-tokens.ts`, and `index.ts`. Their copies live in this package's `src/`.
- [ ] Remove the three imports, public chart exports/schema exports, and React entry registrations
  from `packages/ui/src/features/interactive-ui/index.ts` / `DEFAULT_INTERACTIVE_UI_REGISTRY`:
  `recharts.bar-chart`, `recharts.line-chart`, `recharts.pie-chart` (provider `recharts`).
- [ ] Remove the chart imports/exports and three `ALL_MANIFESTS` catalog entries from
  `packages/ui/src/features/interactive-ui/manifests.ts`. The replacement entries are
  `plugin.recharts.bar-chart`, `plugin.recharts.line-chart`, `plugin.recharts.pie-chart` in
  this package's `CHART_MANIFESTS`. Keep generic registry and A2UI catalog-building contracts in ui.
- [ ] Remove only the `.jini-chart*` rules, chart focus styling, and chart reduced-motion block
  from `packages/ui/src/features/interactive-ui/styles.css`. Copies are in `src/styles.css`,
  scoped to `[data-chart-provider="plugin.recharts"]`. Keep table CSS and non-chart Tailwind rules.
- [ ] Remove only the chart palette/comment blocks (`--jini-chart-default-1` through `-6`,
  both modes) from `packages/ui/src/styles/variables.css`. Copies are in `src/chart-palette.css`;
  keep shared surface/ink/font/radius/shadow theme tokens in ui, imported by this package.
- [ ] Remove `recharts` from ui's `devDependencies`, `peerDependencies`, and `peerDependenciesMeta`;
  regenerate Jini's lockfile through the normal install flow. Recharts remains this plugin's
  dependency. Keep Zod, React, Tailwind, Radix, and shared utilities while other ui features use them.
- [ ] Move/replace ui's chart tests under the provider's `__tests__/`: `bar-chart.test.tsx`,
  `line-chart.test.tsx`, `pie-chart.test.tsx`, the three `*-chart.manifest.test.ts` files,
  `chart.test.tsx`, `chart-config.test.ts`, `chart-styles.test.ts`, and
  `chart-default-palette-css.test.ts`. This package already has real rendering, catalog parity,
  config, tooltip/legend, and stylesheet checks; retain every relevant invariant before deleting.
- [ ] Update ui's `features/a2ui/__tests__/real-catalog-components.test.tsx`, interactive-ui
  registry/manifest tests, README, and capability documentation that assume built-in charts.
  Keep non-chart assertions. Switch host/tool catalog wiring to the plugin's universal manifests
  and verify the replacement no-plugin fallback before removing its existing schemas.
- [ ] Refresh Tovu lockfiles after publishing this package and unlinking local Jini packages;
  audit host-level `recharts` declarations separately (admin still needs it for ui's current fallback).
  No dependency or catalog entry in ui is removed by this copy step.

Checks added for this step: `src/__tests__/manifests.test.ts` (Node-safe export, complete copied
catalog and wire-schema parity), `provider.test.tsx` (preferred registry and merged A2UI catalog),
`chart-config.test.ts` and `chart.test.tsx` (copied support API through the public entry).
Admin's `chart-plugin.contract.unit.test.tsx` covers every kind with the flag on/off, alongside
the existing real canvas/inline and incremental-update checks. All checks are deferred to the
serial coordinator queue; build this package before running admin checks against its new exports.
