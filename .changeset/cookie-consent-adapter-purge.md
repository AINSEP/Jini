---
"@jini-ai/cookie-consent": minor
---

The client runtime hands every browser consent adapter its storage purge. `ConsentAdapter.onState` receives `{ state, purge }` and `GrantInput` gains a required `purge` (new exported type `PurgeStorage`, the shape of `purgeStorage`), on all four runtime call sites, so an adapter delivered as a separate browser module no longer imports the client to clean up. An adapter that ignores the field keeps working; code that calls `grant` or `onState` itself must now pass `purge`. The client bundle's gzip ceiling rises from 4,608 to 4,672 bytes (4,585 to 4,609 B measured).
