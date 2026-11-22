---
"@jini-ai/sidecar": patch
---

**Behaviour change:** a json-ipc error reply's `error` field is the error class label (`TypeError`, `Error(ENOENT)`) instead of the redacted message; the log line carries the class only. **Host action:** a client that showed or parsed that text should use the `traceId` to find the detail in host logs.
