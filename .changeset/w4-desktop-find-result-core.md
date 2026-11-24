---
"@jini-ai/core": patch
"@jini-ai/desktop-host": patch
"@jini-ai/ui": patch
---

New `@jini-ai/core/contracts/find-in-page` owns `FindInPageResult`; desktop-host re-exports it and `@jini-ai/ui/find` uses it instead of a duplicate `FindMatchResult`.
