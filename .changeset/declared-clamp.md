---
"@jini-ai/core": patch
"@jini-ai/mcp": patch
---

A numeric tool input property that declares `clamp: true` with a `minimum` and/or `maximum` has an out-of-range number moved to its nearest bound instead of refused, with a note that never carries the caller's value (`limit was lowered to its maximum, 8000`). `@jini-ai/core` adds `@jini-ai/core/tool-input-repairs` (`clampDeclaredBounds`, `assertRepairKeywords`) and `normalizeToolInput` applies it on every registry path (typed MCP tools, the registry's own execution path, batch items). MCP-local tools opt in with `argumentNormalization.clamp`; `read_tool_result` (`limit`) and `search_tools` (`limit`, `max_results`) do. Clamping stays opt-in per property: nothing is clamped unless the schema says so.
