---
"@jini-ai/agent-runtime": patch
---

The JSON event parser's shared types and pure helpers move to an internal leaf file, which removes a runtime import cycle between the dispatcher and five agent handlers. The public surface and behaviour are unchanged.
