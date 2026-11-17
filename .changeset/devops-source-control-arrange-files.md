---
"@jini-ai/devops": minor
---

`CommitLayoutPort` gains an optional `arrangeFiles({ report })`: the host arranges the finished export into the files to commit (for example a static-download layout). Absent, the commit uses the succeeded routes then assets as before. A throw refuses the commit as `EXPORT_FAILED` worded by `describeError` with stage `'arrange'`, every arranged path is still validated against the destination folder, and `cleanup` runs once after the arrangement, also when it throws.
