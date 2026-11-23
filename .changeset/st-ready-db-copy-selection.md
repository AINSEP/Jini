---
"@jini-ai/db": patch
---

`@jini-ai/db/sqlite` adds `selectDatabaseCopiesToPrune` (ST-5): pure selection of the database copies a scheduled retention pass may remove. It selects nothing unless the verified copy is the newest local copy, compares resolved paths rather than spellings (an alias of a retained or verified copy never takes a window slot and is never selected; relative protected paths protect their absolute candidates), keeps protected copies beyond `keep`, and never touches the filesystem. `pruneDatabaseCopies` is unchanged.
