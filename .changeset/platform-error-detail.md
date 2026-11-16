---
"@jini-ai/platform": patch
---

A failed login-shell read now names the failure class or code, a failed guarded file open names its code (ELOOP, EACCES), and an invalid object-store descriptor file says why its JSON was rejected. Logs through `describeErrorForLog` keep the cause's redacted message.
