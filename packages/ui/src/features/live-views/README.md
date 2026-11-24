# live-views

Embedded-guest lifecycles for a desktop window that shows sites in `<webview>` tabs.

- `live-views.ts` (framework-free, exported from `@jini-ai/ui/core`): recency order, release
  candidates, the release-probe reader and scroll restoration.
- `@jini-ai/ui/live-views` (React, standalone hooks the host calls): `useLiveViews` (which open tabs
  keep a running guest), `useSiteViewPreference` + `liveViewLimit` (the live-view limit preference,
  one ordering owner for settings and admission), and `useWebviewLoadFailure` (failed vs stalled vs
  loaded guest, with injectable timers). Guests are structural ports; no Electron import.

## Wiring

The host injects:

- `getBridge` — its preload bridge lookup (`getMaximumLiveSiteViews`, `onMaximumLiveSiteViewsChanged`);
  channel names stay host-owned. Pass a stable function.
- `bounds` — the limit's `{ min, max, fallback }` (a module-level constant from the host's contracts).
- `probe` — the release probe script run in each hidden guest; it encodes which host routes have
  audited release guards and which element is the inner scroller, so it stays host-owned.
- `timers` (optional, `useWebviewLoadFailure`) and `timeoutMs` (optional, `useLiveViews`).

The host's live-views adapter supplies the bridge lookup, bounds and probe; its workspace view calls
it. The host's app hooks barrel binds `useWebviewLoadFailure` to its own `<webview>` element type,
and its loaded-sites settings hook calls `useSiteViewPreference` with the same bounds.
