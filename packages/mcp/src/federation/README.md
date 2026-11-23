# federation

Server-side MCP federation: connection config, admissions, approvals, hosted stores and transports.

## Wiring

`external-mcp-admissions.ts` takes the host's redacting log formatter through
`createServerAdmissionsReader({ describeErrorForLog })`; the host binds it once (its external MCP
host-copy module) and its callers import the bound `readServerAdmissions` from there.
