---
"@jini-ai/chat": patch
---

AG-UI projection and reduction now carry a tool call's `toolOrigin` and `bridgeCall` as extra fields on `TOOL_CALL_START`, and a tool result's `isError`, `media` and `outcome` as extra fields on `TOOL_CALL_RESULT`. Each is written only when set, so a plain call and a plain successful result are unchanged on the wire. A stream without the fields still reads as before (`isError: false`, no correlation).
