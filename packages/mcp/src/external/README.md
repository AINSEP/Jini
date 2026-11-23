# external

The external MCP domain's model-facing surface: the setup tool catalog (`agent-tools.ts`), the live
diagnostics tools (`operations-tools.ts`), (the server admissions reader is `../federation/external-mcp-admissions.ts`, next to the federation
admissions it reads) and the managed built-in roster (`built-in-connections.ts`).

## Wiring

The host injects, and binds once in its own external MCP host-copy module:

- `copy: ExternalMcpHostCopy` (`external-mcp-host-copy.ts`) — the host's settings-screen location and
  the host tool the model calls to read configured servers. Passed to
  `createExternalMcpAgentToolCatalog({ copy })` and `createExternalMcpOperationsToolCatalog({ copy })`,
  and as `operations.copy` to `buildExternalMcpOperationsRegistrations` /
  `contributeExternalMcpOperationsTools`, whose refusal messages name the same screen and tool.
- `operations.createProbeLimiter({ clock })` — the probe budget's limiter, built from the host's own
  outbound-call rate-limit profile.
- `createServerAdmissionsReader({ describeErrorForLog })` (`@jini-ai/mcp/federation/external-mcp-admissions`) — the host's redacting log formatter for a
  failed admissions read; the host exports the bound `readServerAdmissions` its callers import.

The deps the operations handlers read are structural (`ExternalMcpOperationsDeps`: workspace id,
authorize, clock); the host's full tool deps bag satisfies them.
