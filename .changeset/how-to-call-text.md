---
"@jini-ai/core": patch
"@jini-ai/mcp": patch
---

`describe_tool` says how to call the tool it described, by the name the server actually offers. The result gains `callAs` (`direct`, `gateway` or `none`) and `call`: the wire name of a published tool (which is not always its registry id: ids with dots, hyphens or over the length limit are published as `tool_<readable>_<hash>`), or the `execute_delegated_tool` / `execute_readonly_delegated_tool` call with the registry id when the tool is not published (full tool list, full schema budget, or a server without dynamic publication). A schema-less group answers `callAs: "none"`. `McpToolContext.publishTool` returns `{ wireName }` or `{ skipped: reason }` instead of `void`, so a skipped publication is no longer silent, and the description no longer promises that every described tool appears in `tools/list`. A published tool whose wire name differs from its id now always reaches the daemon with its registry id, even when the id equals an MCP-local tool name. `@jini-ai/core/tool-call-text` adds `toolCallText`.
