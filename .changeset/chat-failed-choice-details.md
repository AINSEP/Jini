---
"@jini-ai/chat": minor
---

A failed `assistant_ask_choice` tool row (bare, MCP-qualified, or normalized from a `call_mcp_tool` receipt) now shows "The assistant couldn't open the choice form. Ask it to try again." in its head, collapsed reader, and expanded panel, and never mounts the choice inputs or the raw protocol error. A Copy details button inside the expansion copies only the redacted diagnostic. `ToolCallDetailOptions` gains `resultPresentation?: "display" | "copy-diagnostic"`: the default keeps the plain-words wording for refused-arguments errors, and `"copy-diagnostic"` skips only that substitution while still applying the same formatter, redactor, and cap.
