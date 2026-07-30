---
"@jini-ai/mcp": patch
---

Enforce a tool's declared `inputSchema` server-side before its handler runs.

`createMcpToolServer` wires tools through the MCP SDK's low-level `Server.setRequestHandler`, not
the schema-validating `McpServer.registerTool()` helper — the former never checked a real client's
`tools/call` arguments against the tool's own declared `inputSchema`. A wire-level test (a real SDK
`Client` and `Server` over `InMemoryTransport`, not the existing `FakeTransport` suite, which calls
handlers directly either way and so cannot see this) proved schema-violating arguments — wrong
type, an undeclared property under `additionalProperties: false` — reached every handler completely
unvalidated.

`handleToolCall` now validates `rawArgs` against `tool.inputSchema` via the MCP SDK's own
`@modelcontextprotocol/sdk/validation/cfworker` provider (no `eval`/codegen, matching this package's
Node CLI runtime) before invoking the handler, returning the same `{isError:true}` shape as an
unknown-tool-name or thrown-error result rather than ever calling the handler with unvalidated
input. Each tool's compiled validator is cached (`WeakMap` keyed by the `McpToolDef` instance, stable
for a server's whole lifetime) since compiling one is real work the SDK's validator does not cache
internally. Adds `@cfworker/json-schema` (already an optional peer of the installed SDK version) as
a direct dependency.
