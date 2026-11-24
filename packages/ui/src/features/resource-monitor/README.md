# resource-monitor

A process resource table (memory and CPU per process, grouped by owner), exported from
`@jini-ai/ui/resource-monitor`. Unrelated to `resource-dashboard`, which is a board of items.

## Wiring

- **Needs injected:**
  - `<ResourceTable groups onStop labels format classNames? />` — `groups` are
    `ResourceTableGroup`s the host builds from its own sampler snapshot (the host app first, then
    each running owner; `stop: null` where nothing can be stopped); `onStop({ id })` is the host's
    stop action; `labels` is `ResourceTableLabels` (caption, column headings, the spoken
    "unavailable"), host copy; `format` is `ResourceTableFormat` (`memory`, `cpu`, `warning`,
    `role`), the host's figure/warning/role wording; `classNames.visuallyHidden` is the host's
    screen-reader-only utility class, added beside `jini-resources-table__hidden`.
- **Provides:** a stateless table. An unknown reading renders a dash spoken as `labels.unavailable`,
  never a zero. Styling comes from the host stylesheet through the `jini-resources-table*`
  classes (no stylesheet ships yet).
- **Must never import:** host bridges/IPC, host hooks or wire contracts, product copy, `console`.

## Also in this folder (host-bound hooks)

Renderer half of a desktop resource readout (memory/CPU chip, per-site figures, process panel).

- `useResourceReadings` (standalone hook the host calls): pull-only polling of one shared snapshot.
  Polls only while the visibility source is visible, serializes reads across effect replacements,
  discards a reading that straddled a hide/show, logs only the first failure of a streak (through
  `describeErrorForLog`, never the raw native message) and retries a failed read promptly.
- `createResourceStop`: the panel's Stop action — stops only locally managed (no `externalUrl`),
  currently `running` sites through the host's power owner; never a stop-by-PID action.

Unlike `resource-dashboard` (board/list views over records the host already holds), this folder owns
the polling cadence for a live sampler; the two do not overlap.

## Wiring

The host injects:

- `ports.getBridge` — its preload bridge lookup exposing `getResources({ panelOpen })`; channel names
  and the wire snapshot type stay host-owned (the hook reads only `pollIntervalMs`). Keep `ports` stable.
- `ports.document` — the visibility source (normally `document`), plus `ports.setTimer`/`clearTimer`.
- `refreshKey` (optional) — changes when a site lifecycle changes, forcing an early reading.
- `retryDelayMs` (optional, default 5 s) — the retry delay after a failed read; normal cadence comes
  from the sampler's own `pollIntervalMs`.
- `createResourceStop({ projects, power })` — `power.toggle` is the host's existing site power owner.

The host's resources hook module binds the browser ports (bridge lookup, `document`, window timers)
and its resources panel module composes the chip, site figure and panel over the returned snapshot.
