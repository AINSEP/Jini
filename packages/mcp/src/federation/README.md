# federation

Server-side MCP federation: connection config, admissions, approvals, hosted stores and transports.

## Wiring

`external-mcp-admissions.ts` takes the host's redacting failure report (its own log line and formatter; Jini never writes the console) through
`createServerAdmissionsReader({ reportReadFailure })`; the host binds it once (its external MCP
host-copy module) and its callers import the bound `readServerAdmissions` from there.

`external-mcp-probe.ts` (`@jini-ai/mcp/federation/external-mcp-probe`) takes the host's collaborators through
`createExternalMcpProbe({ host })`: `readEnabledConfigs({ deps, workspaceId })` (the host's bound hosted-store read
over its own deps bag), `connectHttpSession` (its HTTP MCP session binding, the default `connect`), `reauthRequired`
(its reauthorization error: code, settings link), `reauthResponseText` (its outward 409 copy for a row parked
`needs_reauth`; Jini never copies the error's stored message into a response), `settingsDeepLink`, `reauthCode` (the legacy code for a
reauthorization found during the call) and `connectFailureText` (its credential-free connect-failure copy). The host
binds it once in its external MCP host-copy module and its route and tool callers import the bound
`probeExternalMcpServer` (and the host's own `ExternalMcpProbeServiceDeps`) from there. It lives here rather than in
`external/` because it composes `hosted/probe.ts` and `adapter.http.ts` (subpath isolation keeps `external/` off them).
