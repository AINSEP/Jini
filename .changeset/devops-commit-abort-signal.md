---
"@jini-ai/devops": patch
---

`commitSiteToSourceControl` accepts an optional `signal` and checks it before the credential read, the export and the push; a stopped run returns `ABORTED` and never calls the provider.
