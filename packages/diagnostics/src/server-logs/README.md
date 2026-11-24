# server-logs

The one read behind a host's "what went wrong on the server" surfaces: the admin server-logs
route and the read-only `system_read_server_logs` chat tool both call `parseServerLogFilters`
then `readServerLogs`, so a filter means the same thing in the UI and in chat.

## Wiring

- **Needs injected:** a `ServerLogSourcePort` (`read(): { entries, capturing }`) — wherever the
  host keeps its captured lines (an in-memory ring buffer, a rotating log file). Entry shapes are
  `ServerLogEntry` / `ServerLogLevel` from `@jini-ai/core/contracts/site/platform-server-logs`,
  which also owns the read's `ServerLogFilters` and `ServerLogsResult` (shared with the admin
  route and the admin client);
  lines are already redacted when the host captures them.
- **Provides:** `parseServerLogFilters` (accepts tool JSON or HTTP query strings; throws
  `ServerLogFilterError` naming the field), `readServerLogs` (newest matching lines, oldest first,
  plus `matched`/`buffered`/`truncated`/`capturing`), and the bounds `SERVER_LOG_LEVELS`,
  `DEFAULT_SERVER_LOG_LIMIT`, `MAX_SERVER_LOG_LIMIT`, `MAX_CONTAINS_LENGTH` a host builds its tool
  schema from.
- **Provides (`./agent-tools`):** `serverLogsAgentToolCatalog`, the catalog entry for the read-only
  `system_read_server_logs` chat tool (permission `system.read`, `sideEffects: "none"`), whose input
  schema bounds are the constants above.
- **Provides (`./tool-registrations`):** `contributeServerLogsTools({ serverLogs })`, the
  `system-server-logs` contributor (handler, `system.read` permission check via
  `@jini-ai/core`'s `requireToolPermission`, metadata from `@jini-ai/core/tool-metadata/server-logs`).
  The build reads `deps.serverLogs` when the deps carry one, else the `serverLogs` the host bound
  on the contributor (typically its own process log capture).
- **Host wiring example:**

  ```ts
  import { parseServerLogFilters, readServerLogs, ServerLogFilterError, type ServerLogSourcePort }
    from "@jini-ai/diagnostics/server-logs/read-server-logs";

  const logs: ServerLogSourcePort = { read: () => myLogBuffer.snapshot() };
  try {
    return readServerLogs({ logs }, parseServerLogFilters({ raw: query }));
  } catch (err) {
    if (err instanceof ServerLogFilterError) return badRequest(err.message);
    throw err;
  }
  ```
- **Must never import:** host paths, a concrete log buffer/file sink, a console formatter, or a
  server framework (the route itself is the host's or a `defineJsonRoute` spec). Permission checks
  (`system.read`) stay with the caller.

Architecture: `docs/decisions/DR-005-portable-package-boundaries.md`.
