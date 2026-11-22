---
"@jini-ai/daemon": patch
---

The model-proxy routes no longer stream an upstream failure's own text to the client. A provider turn that fails upstream (a refused connection, a blocked address, an error status) now sends an `error` event with fixed words and the request ID in `code`, and the full event goes to `ModelProxyHttpDeps.onInternalError` (or the host's incident log). Other events are unchanged.
