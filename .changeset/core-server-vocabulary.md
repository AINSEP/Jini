---
"@jini-ai/core": minor
"@jini-ai/http-kit": patch
---

Core's `contracts/server` now carries the framework-free route vocabulary (route table, middleware decorator, `jsonRoute`, bounded body and query reading, SSE stream, origin guard, verified-origin registry), plus in-memory `/testing` and `/conformance` entries. http-kit drops the definitions that moved and its `./verified-origin` entry.
