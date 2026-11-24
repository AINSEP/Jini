# admin-http/routes/system

Framework-neutral `defineJsonRoute` specs (`@jini-ai/core/contracts/server`) for the admin
system/observability surface: module status, assistant-daemon restart, observability status +
test error, tool gaps and server logs. Each spec reads only its own small deps type; the workspace
404, the session principal, the RBAC 403 and the redacted 500 come from the host's `JsonRoutePorts`.
Why the routes are specs and the host owns those ports: [DR-005](../../../../../../docs/decisions/DR-005-portable-package-boundaries.md),
authorization at one boundary: [DR-002](../../../../../../docs/decisions/DR-002-single-authorization-boundary.md).

## Wiring

| spec (subpath `@jini-ai/cms/admin-http/routes/system/<file>`) | injected deps type | provides |
|---|---|---|
| `moduleStatusRoute` (`module-status`) | `AdminModuleStatusRouteDeps` (`getReadinessSnapshot`) | GET module-status, 503 on a failed critical module |
| `assistantDaemonRestartRoute` (`assistant-daemon`) | `AdminAssistantDaemonDeps` (`restartAssistantDaemon`) | POST restart, 409 on refusal |
| `observabilityStatusRoute`, `observabilityTestErrorRoute` (`observability-status`) | `AdminObservabilityStatusRouteDeps` / `AdminObservabilityTestErrorRouteDeps` (raw `authorize`, `observability`, `serviceName`, optional `observabilityEnabled`, `telemetryStatus`, `sendTelemetryTest`) | GET status (no endpoint/credential ever), POST test error (own 403/503 copy) |
| `toolGapsRoute` (`tool-gaps`) | `AdminToolGapsRouteDeps` = core `ToolGapsToolDeps` | owner-only GET (own 403), 503 without an audit store |
| `serverLogsRoute` (`server-logs`) | `AdminServerLogsRouteDeps` (`parseServerLogFilters`, `readServerLogs`, `isServerLogFilterError`) | GET filtered log buffer; filter errors answer 400 `VALIDATION_ERROR` after authorization |

Host wiring (Express host with `@jini-ai/http-kit` `mountJsonRoute` behind its admin ports):

```ts
import { serverLogsRoute } from "@jini-ai/cms/admin-http/routes/system/server-logs";

mountJsonRoute({ app, spec: { ...serverLogsRoute, ports: adminPorts }, deps: {
  workspaceId, authorize,                         // read by the host ports only
  parseServerLogFilters, readServerLogs: (filters) => readLogs({ logs }, filters),
  isServerLogFilterError: (e): e is Error => e instanceof MyFilterError,
} });
```

The host passes only the listed fields, never its whole route-deps bag, and supplies product
values (e.g. the observability `serviceName`) itself.

Must never import: a server framework (`express`), host paths, or another package's
implementation (e.g. a diagnostics log reader or telemetry sender) — those arrive as deps. Only
`@jini-ai/core` contracts/errors are imported.
