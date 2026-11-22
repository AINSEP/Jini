---
"@jini-ai/devops": patch
---

Documentation only: the source-control commit orchestration (`commitSiteToSourceControl`, `previewCommitExport`) now states, in its own doc comments, why it validates before any credential or network work, isolates each export run, refuses on a failed asset as well as a failed route, never throws for an expected outcome and routes a provider's throw through the host's `describeError`. No behaviour changes.
