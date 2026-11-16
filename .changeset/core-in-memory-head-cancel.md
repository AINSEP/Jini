---
"@jini-ai/core": patch
---

The in-memory test server cancels the GET body it drops when answering HEAD, so a streaming producer (an SSE keepalive) stops.
