---
"@jini-ai/desktop-host": minor
---

Add code-cache maintenance to `@jini-ai/desktop-host/electron/partitions`. `clearCodeCacheOnUpdate` treats the update flag or a changed launch version as an update launch, persists every managed partition as pending before writing the new launch version, then, under the writer lock, renames `Code Cache` aside only for partitions no holder lists and only with `'go'` evidence for the code-cache clear; busy and held partitions stay pending for the next start. `maybeClearCodeCacheAtOpen` runs only as the interlock's `openMaintenance` hook: with `'go'` evidence and a measured size over 64 MiB it awaits `session.clearCodeCaches({})` before first use; failure or timeout never marks success, and the actual settlement is reported apart from the observed timeout. The maintenance marker gains the code-cache pending list and last launch version.
