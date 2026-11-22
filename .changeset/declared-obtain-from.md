---
"@jini-ai/core": patch
"@jini-ai/mcp": patch
"@jini-ai/daemon": patch
---

A required tool input property can declare `obtainFrom: "<tool id>"`, the tool that lists its valid values. A call that leaves it out is told where to look, on both paths: a typed MCP tool answers `supply required argument \`themeId\`; list valid values with theme_list; Input schema: {…}`, and the delegated-tool gateways add `List valid values for \`themeId\` with theme_list.` to the handler's own validation text. The tool is named only when the run can see it, and nothing is added when the property is present, declares no `obtainFrom`, or the failure is about another field. `@jini-ai/core/tool-input-repairs` adds `missingArgumentGuidance` and `assertRepairKeywords` now refuses an `obtainFrom` that is not a non-empty string.
