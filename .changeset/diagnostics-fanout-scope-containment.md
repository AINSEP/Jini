---
"@jini-ai/diagnostics": patch
---

`combineObservabilityPorts`: a tracker whose `run()` throws (before or after its callback) or never calls it no longer blocks the application work or later scopes; the callback runs exactly once and its own result or error reaches the caller.
