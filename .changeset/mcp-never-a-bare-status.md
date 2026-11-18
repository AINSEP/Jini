---
"@jini-ai/mcp": minor
---

The MCP client never shows a bare HTTP status or text the server did not write for the caller. A recognized error envelope (nested or flat) is shown as before; any other non-2xx answer becomes fixed words plus an error ID recorded once through the new `reportFailure` port (`McpToolServerOptions`, `RunToolHostOptions`, `ServeDeps`). `DaemonHttpError` carries `code`, `requestId` and `details`. `jini-mcp` builds the reporter from `@jini-ai/core/errors/reporter`.
