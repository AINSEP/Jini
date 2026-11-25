---
"@jini-ai/platform": minor
---

Add `withOwnedTempRoot` and `sweepOwnedTempRoots` to `@jini-ai/platform/fs`: writer-owned temporary folders (lock before folder, exact UUID names, provenance marker) and a sweeper that removes only roots whose owner is proven dead, reporting older leftovers instead.
