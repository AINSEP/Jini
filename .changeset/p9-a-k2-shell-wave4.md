---
"@jini-ai/admin": patch
---

Admin shell moves (A-K2-shell-lib-5 / A-K2-shell-hooks-1 slices, move-only): new `@jini-ai/admin/shell/lib/tab-event-source`, `@jini-ai/admin/shell/lib/external-entry-refresh` and `@jini-ai/admin/shell/hooks/use-external-entry-refresh.hooks` entries. `typesVersions` now maps every `shell/*` subpath, so `moduleResolution: node` consumers resolve the shell declarations too. `shell/lib/addons-routes` and `shell/lib/import-export-routes` take the host's URL policy in their args (`AddonsRoutePolicy`, `MovedTabsRoutePolicy`); the host keeps its own workspace and API-base constants (`shell/lib/admin-http/config` is not published).

Shell collaborators are injected, not imported from core implementations: `devicePreviewButtonHandleProps` takes `agentHandle`, `asciiSlug` takes `trimChars`, `isEscapeOwnedByInnerLayer` takes `orFallbackSync`, `browserStreamPorts({ orFallbackSync })` (and `startBrowserStream` / `openTabEventSource` require `ports`), `browserQueuedStartPorts({ orFallback })` with a `readRefusal` port, `withAcceptanceCancellation` takes a `logger`, and `translateAdminNavGroups` takes the host-bound `translate` (the dictionary is exported as `ADMIN_NAV_DICT`, split into per-locale-group modules). Bus listener failures go to the logger the host binds with `bindShellFailureLogger` (`shell/lib/shell-failure-log`); Jini writes no console output.
