---
"@jini-ai/devops": patch
---

Add the background account-label heal scheduler (`@jini-ai/devops/deploy/site/publish-credentials/account-label-heal-scheduler`), moved from the host. The error reporter `onHealError` is a required input: the package never logs, so the host binds its own reporter.
