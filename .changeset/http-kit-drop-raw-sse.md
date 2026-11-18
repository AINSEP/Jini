---
"@jini-ai/http-kit": minor
---

`createSseResponse`, `CreateSseResponseOptions` and `SseConnection` are removed (no alias): their last user, the frontend-session stream, now returns a web `Response` built on core's `createSseStream`. A host that wrote its own raw SSE stream on `createSseResponse` moves to `createSseStream` (`@jini-ai/core/contracts/server`).
