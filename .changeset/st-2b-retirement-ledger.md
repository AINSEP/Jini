---
"@jini-ai/desktop-host": minor
---

Add `createRetirementLedger` to `@jini-ai/desktop-host/electron/partitions`: a profile-bound, synchronous durable ledger of positive proofs for whole-partition removal. Records bind profile, session root, partition, an opaque subject ID, the site path, its directory identity (dev/ino/birthtime), parent device and erase version/time. Transitions are compare-and-set by record ID; only `pending` moves, `removed` and `invalidated` are terminal, and removal commits only for the exact aside folder recorded before the rename. A corrupt or foreign ledger grants no removal authority. Terminal records are pruned after 90 days unless their aside folder is still on disk.
