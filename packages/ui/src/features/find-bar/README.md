# find-bar

The find-in-page bar view, exported from `@jini-ai/ui/find-bar`. Its companion
`createFindQueryScheduler` (the per-keystroke settle timer, in `../find/`) is exported from
`@jini-ai/ui/core`.

## Wiring

- **Needs injected:**
  - `<FindBar find labels />` — `find` is a `FindBarModel` (`open`, `query`, `countLabel`,
    `inputRef`, `setQuery`, `next`, `previous`, `close`) produced by the host's own find hook, which
    owns the IPC/webview search; `labels` is `FindBarLabels` (`field`, `previous`, `previousTip`,
    `next`, `nextTip`, `close`, `closeTip`), host copy.
- **Provides:** a stateless bar: Enter steps forward, Shift+Enter back, Escape closes;
  previous/next are disabled while the query is empty. Styling comes from the host stylesheet
  through the `jini-findbar`, `jini-findbar__input`, `__count`, `__act` and `__close` classes (no
  stylesheet ships yet).
- **Must never import:** host bridges/IPC, host hooks, product copy, `console`.
