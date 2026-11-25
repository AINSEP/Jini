---
"@jini-ai/cms": patch
---

Redirect publish no longer overwrites a destination rule that changed after review: `UpdateRedirectInput` gains optional `expectedVersion`, compared inside the same writer transaction as the write (a mismatch raises `RedirectConflictError` and records nothing), and the publish contribution passes the version it checked. A destination rule in the Trash is now a `blocked` row (`EntityNotLiveError`) instead of aborting the run.
