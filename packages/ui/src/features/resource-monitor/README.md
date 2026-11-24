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
