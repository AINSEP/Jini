---
"@jini-ai/ui": patch
---

Add desktop renderer hooks as standalone feature exports: `./zoom` (`useZoom` + per-guest zoom helpers), `./app-version` (`useAppVersion`, `useUpdateCheck` around injected loader/check factories), `./live-views` (`useLiveViews`, `useSiteViewPreference`, `liveViewLimit`, `useWebviewLoadFailure`), `./import-handoff` (`useImportHandoff`, `handoffAddress`), and `navAvailability` on `./core`. Bridges, storage key prefixes, probe scripts, validators and copy are injected by the host.
