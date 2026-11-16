---
"@jini-ai/core": patch
---

Adds `ignoreBestEffortFailure`, a debug-logging handler for cleanup that must not throw. `describeErrorForLog` keeps the error's message (credential-redacted, cut at 300 characters) next to the class label and approved code, so logs read `Error(EACCES): EACCES: permission denied` instead of `Error(EACCES)`; the same for the direct cause.
