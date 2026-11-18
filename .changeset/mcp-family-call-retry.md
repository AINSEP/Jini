---
"@jini-ai/mcp": minor
---

`execute_delegated_tool` and `execute_readonly_delegated_tool` send one more, ordinary request when the daemon answers `404 UNKNOWN_TOOL` for a group of tools (`details.family`) and the call's own input names exactly one member through the group's selector: the second request is for the concrete member (selector key removed, new `toolUseId`, same run and `requireReadOnly`), and the result carries the note `"<group>" is a group; ran <member>`. Any other case keeps the original error. The daemon route is unchanged.
