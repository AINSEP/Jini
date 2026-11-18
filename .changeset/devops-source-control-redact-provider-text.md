---
"@jini-ai/devops": patch
---

`commitSiteToSourceControl` redacts the resolved token from provider failure text and from the text a host's `describeError` returns for a thrown provider error, so a host or transport that echoes the credential cannot hand it back to the caller.
