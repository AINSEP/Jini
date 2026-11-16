---
"@jini-ai/server": patch
---

Shutdown-failure logs now keep the failure's redacted message (via `describeErrorForLog`), so a failed graceful shutdown says what failed.
