---
"@jini-ai/db": minor
---

`captureSqliteBackupBytes` accepts an optional `withTempRoot` scope so a host can run the backup in its own owned temporary folder instead of a nested `mkdtemp` directory.
