---
"@jini-ai/devops": minor
---

`CommitExportArgs.describeError` receives an optional `stage` (`CommitErrorStage`: `'export'`, `'arrange'`, `'credential'` or `'commit'`) naming where the error arose, so a host can word each stage's failure on its own. Additive: a describer that ignores `stage` behaves as before.
