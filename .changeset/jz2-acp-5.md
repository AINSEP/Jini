---
"@jini-ai/agent-runtime": patch
"@jini-ai/daemon": patch
---

ACP release records live descendants before closing stdin or signalling the child, then stops the recorded processes on close.
