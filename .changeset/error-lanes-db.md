---
"@jini-ai/db": patch
---

`DatabaseTransferToolPorts.describeError` is optional and deprecated: failure lines name the error class through core's `describeErrorForLog`. Postgres pool and socket-server warnings log the error class only. **Host action:** you may stop passing `describeError`.
